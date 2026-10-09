import React, { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, BarChart2, ChevronRight, Database, HardDrive, Radio, RefreshCw, Server, Tv, Video } from 'lucide-react';
import { getSystemStatus } from '../../api';
import type { Camera, CCTVEvent, SystemStatus } from '../../types/cctv';

interface DashboardViewProps {
  cameras: Camera[];
  events: CCTVEvent[];
  onNavigateToLive: () => void;
  onNavigateToEvents: () => void;
  onNavigateToRecordings: (cameraId?: string) => void;
  onNavigateToStorage: () => void;
  onNavigateToDiagnostics: () => void;
}

function formatBytes(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'Unavailable';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = value; let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return `${n >= 10 || i === 0 ? n.toFixed(0) : n.toFixed(1)} ${units[i]}`;
}

function formatUptime(seconds?: number): string {
  if (!Number.isFinite(seconds)) return 'Unavailable';
  const s = Math.max(0, Number(seconds));
  const d = Math.floor(s / 86400); const h = Math.floor((s % 86400) / 3600); const m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h ${m}m` : h ? `${h}h ${m}m` : `${m}m`;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ cameras, events, onNavigateToLive, onNavigateToEvents, onNavigateToRecordings, onNavigateToStorage, onNavigateToDiagnostics }) => {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try { setStatus(await getSystemStatus()); setError(''); }
    catch (e: any) { setError(e?.message || 'System status is unavailable.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 5000); return () => window.clearInterval(timer); }, []);

  const summary = status?.cameraSummary || {
    total: cameras.length,
    online: cameras.filter(c => c.status === 'online').length,
    offline: cameras.filter(c => c.status === 'offline').length,
    transitional: cameras.filter(c => ['configured', 'starting', 'retrying', 'reconnecting', 'degraded'].includes(c.status)).length,
    disabled: cameras.filter(c => c.status === 'disabled').length,
    error: cameras.filter(c => c.status === 'error').length,
  };
  const attention = summary.offline + summary.error + summary.transitional;
  const servicesHealthy = Boolean(status?.backend.ok && status?.database.ok && status?.ffmpeg.ok && status?.mediamtx.ok);
  const usedPercent = status?.storage.totalBytes && status.storage.usedBytes != null ? Math.round((status.storage.usedBytes / status.storage.totalBytes) * 100) : null;
  const runtimeByCamera = useMemo(() => new Map((status?.cameras || []).map(c => [c.cameraId, c])), [status]);

  const card = (title: string, value: React.ReactNode, note: React.ReactNode, icon: React.ReactNode) => (
    <div className="bg-white rounded-xl p-4 border border-slate-200/80 shadow-xs flex items-center gap-4 min-w-0">
      <div className="w-11 h-11 rounded-xl bg-slate-50 text-blue-600 flex items-center justify-center shrink-0">{icon}</div>
      <div className="min-w-0"><div className="text-xs text-slate-500 font-medium">{title}</div><div className="text-2xl font-bold text-slate-900 leading-tight truncate">{value}</div><div className="text-[11px] text-slate-400 truncate">{note}</div></div>
    </div>
  );

  const serviceRow = (name: string, ok: boolean, detail: string, onClick?: () => void) => (
    <button onClick={onClick} className="w-full py-3 flex items-center justify-between hover:bg-slate-50 rounded-lg px-2 text-left transition-colors">
      <div className="flex items-center gap-3"><span className={`w-2 h-2 rounded-full ${ok ? 'bg-emerald-500' : 'bg-amber-500'}`} /><div><div className="font-semibold text-slate-800 text-xs">{name}</div><div className="text-slate-400 text-[11px]">{detail}</div></div></div><ChevronRight className="w-4 h-4 text-slate-400" />
    </button>
  );

  return (
    <div className="flex-1 flex flex-col h-full bg-[#f4f6fa] overflow-y-auto">
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100"><BarChart2 className="w-5 h-5" /></div><div><h1 className="text-2xl font-bold text-slate-900">Dashboard</h1><p className="text-xs text-slate-500">Live backend state — no simulated operational metrics</p></div></div>
          <button onClick={() => void refresh()} disabled={loading} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-700 disabled:opacity-50"><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
        </div>

        {error && <div className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-xs text-rose-800">{error}</div>}

        <div className="grid sm:grid-cols-2 xl:grid-cols-5 gap-4">
          {card('Total Cameras', summary.total, 'Configured in SQLite', <Tv className="w-5 h-5" />)}
          {card('Online', summary.online, summary.total ? `${Math.round((summary.online / summary.total) * 100)}% of configured cameras` : 'No cameras configured', <Radio className="w-5 h-5" />)}
          {card('Needs Attention', attention, `${summary.error} error • ${summary.offline} offline`, <AlertTriangle className="w-5 h-5" />)}
          {card('Recording', status?.recording.active ? `${status.recording.activeCount} active` : 'Idle', `${status?.recording.segmentCount ?? 0} segments • ${formatBytes(status?.recording.bytes)}`, <Video className="w-5 h-5" />)}
          {card('Disk Free', formatBytes(status?.storage.freeBytes), usedPercent == null ? 'Storage status unavailable' : `${usedPercent}% of host volume used`, <HardDrive className="w-5 h-5" />)}
        </div>

        <div className="grid xl:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100"><div><h2 className="text-base font-bold text-slate-900 flex items-center gap-2"><Activity className="w-4 h-4" />System Health</h2><p className="text-xs text-slate-400">Authoritative checks from the running backend</p></div><span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border ${servicesHealthy ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>{servicesHealthy ? 'Core services healthy' : 'Check diagnostics'}</span></div>
            <div className="divide-y divide-slate-100">
              {serviceRow('CCTV API', Boolean(status?.backend.ok), `Uptime ${formatUptime(status?.backend.uptimeSeconds)} • v${status?.version || '—'}`, onNavigateToDiagnostics)}
              {serviceRow('MediaMTX', Boolean(status?.mediamtx.ok), `WebRTC ${status?.mediamtx.webrtcReachable ? 'ready' : 'unavailable'} • HLS ${status?.mediamtx.hlsReachable ? 'ready' : 'unavailable'}`, onNavigateToDiagnostics)}
              {serviceRow('FFmpeg', Boolean(status?.ffmpeg.ok), status?.ffmpeg.path || 'Not found', onNavigateToDiagnostics)}
              {serviceRow('SQLite', Boolean(status?.database.ok), `Schema v${status?.database.schemaVersion ?? '—'}`, onNavigateToStorage)}
              {serviceRow('Recording service', Boolean(status?.recording.supported), status?.recording.active ? `${status.recording.activeCount} active recorder(s)` : `${status?.recording.desiredCount ?? 0} camera(s) armed • ${status?.recording.segmentCount ?? 0} finalized segments`, () => onNavigateToRecordings())}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100"><div><h2 className="text-base font-bold text-slate-900">Operational Events</h2><p className="text-xs text-slate-400">Real state transitions persisted in SQLite</p></div><button onClick={onNavigateToEvents} className="text-xs font-semibold text-blue-600">Open Events</button></div>
            {events.length === 0 ? <div className="py-10 text-center"><Database className="w-8 h-8 text-slate-300 mx-auto mb-2" /><div className="text-xs font-semibold text-slate-600">No operational events yet</div><div className="text-[11px] text-slate-400 mt-1">Camera, MediaMTX, storage, and system transitions will appear here.</div></div> : <div className="divide-y divide-slate-100">{events.slice(0, 5).map(event => <button key={event.id} onClick={onNavigateToEvents} className="w-full py-3 text-left flex gap-3 items-start hover:bg-slate-50 px-1 rounded"><span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${event.severity === 'critical' ? 'bg-rose-500' : event.severity === 'warning' ? 'bg-amber-500' : 'bg-blue-500'}`} /><div className="min-w-0 flex-1"><div className="text-xs font-semibold text-slate-800 truncate">{event.title || event.eventType}</div><div className="text-[11px] text-slate-500 truncate">{event.message}</div></div><div className="text-[10px] text-slate-400 shrink-0">{event.timeOnly}</div></button>)}</div>}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3"><div><h2 className="text-base font-bold text-slate-900">Camera Runtime</h2><p className="text-xs text-slate-400">Current registry and worker state</p></div><button onClick={onNavigateToLive} className="text-xs font-semibold text-blue-600 flex items-center gap-1">View Live <ChevronRight className="w-3.5 h-3.5" /></button></div>
          {cameras.length === 0 ? <div className="py-8 text-center text-xs text-slate-400">No cameras configured.</div> : <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-100"><th className="py-2">Camera</th><th>Source</th><th>Status</th><th>Worker</th><th>Resolution</th><th>Last Seen</th></tr></thead><tbody>{cameras.map(camera => { const rt = runtimeByCamera.get(camera.id); return <tr key={camera.id} className="border-b border-slate-50 last:border-0"><td className="py-3"><div className="font-semibold text-slate-800">{camera.name}</div><div className="text-[11px] text-slate-400">{camera.location}</div></td><td className="uppercase text-slate-600">{camera.source_type || 'unknown'}</td><td><div><span className={`font-semibold ${(rt?.state || camera.status) === 'online' ? 'text-emerald-600' : (rt?.state || camera.status) === 'error' ? 'text-rose-600' : 'text-amber-600'}`}>{rt?.state || camera.status}</span>{rt?.reason && <div className="text-[10px] text-slate-400 mt-0.5">{rt.reason}</div>}</div></td><td className="text-slate-600">{rt?.running ? `Running${rt.pid ? ` • PID ${rt.pid}` : ''}` : rt?.reconnectScheduled ? `Retry ${rt.nextRetryAt ? new Date(rt.nextRetryAt).toLocaleTimeString() : 'scheduled'}` : rt?.circuitOpenUntil ? 'Recovery paused' : 'Stopped'}</td><td className="text-slate-600">{camera.resolution}</td><td className="text-slate-500">{camera.lastSeen}</td></tr>; })}</tbody></table></div>}
        </div>

        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-xs text-blue-900 flex gap-3"><Server className="w-4 h-4 shrink-0 mt-0.5" /><div><div className="font-semibold">Feature state is explicit.</div><div className="mt-1">USB and RTSP live viewing are implemented. Continuous recording, recording protection, safe retention, and USB motion detection, event-linked footage, motion snapshots, rectangular zones, and event review are available in P0.16.1. In-app notification rules, optional browser desktop alerts, and queued SMTP email delivery with retry history are available. P0.15 added responsive tablet/phone navigation, focused mobile live view, swipe/quick camera switching, touch controls, and connection context. Local AI person/vehicle detection is available in P0.16.1 when the verified ONNX model is installed. ONVIF discovery, AI identity/face recognition, SMS/cloud push, generic webhooks, PTZ control, and two-way audio remain planned.</div></div></div>
      </div>
    </div>
  );
};
