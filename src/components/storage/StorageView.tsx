import React, { useEffect, useState } from 'react';
import { AlertTriangle, Database, HardDrive, RefreshCw, ShieldCheck } from 'lucide-react';
import { getRecordingHealth, getRecordingPolicy, getSystemStatus } from '../../api';
import type { Camera, RecordingHealth, RecordingRetentionPolicy, SystemStatus } from '../../types/cctv';

interface StorageViewProps { cameras: Camera[]; }
function bytes(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'Unavailable';
  const units = ['B', 'KB', 'MB', 'GB', 'TB']; let n = value; let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return `${n >= 10 || i === 0 ? n.toFixed(0) : n.toFixed(1)} ${units[i]}`;
}

export const StorageView: React.FC<StorageViewProps> = ({ cameras }) => {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [policy, setPolicy] = useState<RecordingRetentionPolicy | null>(null);
  const [health, setHealth] = useState<RecordingHealth | null>(null);
  const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    try {
      const [system, retention, recordingHealth] = await Promise.all([getSystemStatus(), getRecordingPolicy(), getRecordingHealth()]);
      setStatus(system); setPolicy(retention); setHealth(recordingHealth.health); setError('');
    } catch (e: any) { setError(e?.message || 'Storage status unavailable.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const storage = status?.storage;
  const percent = storage?.totalBytes && storage.usedBytes != null ? Math.max(0, Math.min(100, Math.round((storage.usedBytes / storage.totalBytes) * 100))) : 0;

  return <div className="flex-1 flex flex-col h-full bg-[#f4f6fa] overflow-y-auto"><div className="p-6 space-y-6">
    <div className="flex items-center justify-between"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100"><Database className="w-5 h-5" /></div><div><h1 className="text-2xl font-bold text-slate-900">Storage</h1><p className="text-xs text-slate-500">Real host-volume usage, recording health, and safe retention status.</p></div></div><button onClick={() => void load()} disabled={loading} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-700 disabled:opacity-50"><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh</button></div>
    {error && <div className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-xs text-rose-800">{error}</div>}

    <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-5">
      <div className="flex items-start justify-between gap-4"><div className="flex items-center gap-3"><div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center"><HardDrive className="w-4 h-4 text-slate-700" /></div><div><h2 className="text-base font-bold text-slate-900">Host Volume</h2><p className="text-xs text-slate-400 font-mono break-all">{storage?.path || 'data/recordings'}{storage?.volumeRoot ? ` • volume ${storage.volumeRoot}` : ''}</p></div></div><span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border ${storage?.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>{storage?.ok ? (storage?.writable ? 'Writable' : 'Read only') : 'Unavailable'}</span></div>
      <div className="w-full h-4 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-blue-600 rounded-full" style={{ width: `${percent}%` }} /></div>
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4 text-xs"><div className="p-3 bg-slate-50 rounded-lg border border-slate-100"><div className="text-slate-400">Used on host volume</div><div className="font-bold text-slate-900 mt-1">{bytes(storage?.usedBytes)}</div></div><div className="p-3 bg-slate-50 rounded-lg border border-slate-100"><div className="text-slate-400">Free on host volume</div><div className="font-bold text-slate-900 mt-1">{bytes(storage?.freeBytes)}</div></div><div className="p-3 bg-slate-50 rounded-lg border border-slate-100"><div className="text-slate-400">Total capacity</div><div className="font-bold text-slate-900 mt-1">{bytes(storage?.totalBytes)}</div></div><div className="p-3 bg-slate-50 rounded-lg border border-slate-100"><div className="text-slate-400">SQLite database</div><div className="font-bold text-slate-900 mt-1">{bytes(storage?.databaseBytes)}</div></div></div>
    </div>

    <div className="grid lg:grid-cols-2 gap-5">
      <div className="bg-white rounded-xl border border-slate-200 p-5"><h2 className="text-base font-bold text-slate-900">Recording Storage</h2><div className="mt-4 grid grid-cols-2 gap-3 text-xs"><div className="p-3 rounded-lg bg-slate-50 border border-slate-100"><div className="text-slate-400">Recording files</div><div className="font-bold text-slate-900 mt-1">{bytes(storage?.recordingsBytes)}</div></div><div className="p-3 rounded-lg bg-slate-50 border border-slate-100"><div className="text-slate-400">Retention engine</div><div className="font-bold text-slate-900 mt-1">{storage?.retentionImplemented ? (policy?.enabled ? 'Enabled' : 'Available — disabled') : 'Unavailable'}</div></div><div className="p-3 rounded-lg bg-slate-50 border border-slate-100"><div className="text-slate-400">Protected segments</div><div className="font-bold text-slate-900 mt-1">{health?.protected ?? '—'}</div></div><div className="p-3 rounded-lg bg-slate-50 border border-slate-100"><div className="text-slate-400">Quarantined</div><div className="font-bold text-slate-900 mt-1">{health?.quarantined ?? '—'}</div></div></div>
        <div className={`mt-4 rounded-xl border p-4 flex gap-3 ${policy?.enabled ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><div className="text-xs"><div className="font-semibold">{policy?.enabled ? 'Safe retention is enabled' : 'Automatic retention is disabled'}</div><p className="mt-1 leading-relaxed">{policy?.enabled ? `Oldest unlocked finalized segments may be removed to satisfy the configured age/storage/free-space thresholds. Protected and quarantined footage is excluded.` : 'Enable retention from Recordings only after reviewing your age, maximum storage, and minimum-free-space thresholds.'}</p></div></div>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 p-5"><h2 className="text-base font-bold text-slate-900">Configured Cameras</h2><div className="mt-4 space-y-2">{cameras.length ? cameras.map(camera => <div key={camera.id} className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-100 text-xs"><div><div className="font-semibold text-slate-800">{camera.name}</div><div className="text-[11px] text-slate-400">{camera.source_type?.toUpperCase() || 'UNKNOWN'} • {camera.location}</div></div><span className={`font-semibold ${camera.recording ? 'text-rose-600' : 'text-slate-500'}`}>{camera.source_type==='usb' ? (camera.recording ? 'Continuous recording armed' : 'Recording off') : 'Recording: USB qualified only'}</span></div>) : <div className="text-xs text-slate-400 py-6 text-center">No cameras configured.</div>}</div></div>
    </div>

    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 flex gap-3 text-xs text-emerald-900"><ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" /><div><div className="font-semibold">Retention safety rules</div><p className="mt-1">Automatic retention can delete only indexed, finalized, unlocked recordings within the configured recording root. Active, protected, quarantined, and unknown files are excluded.</p></div></div>
  </div></div>;
};
