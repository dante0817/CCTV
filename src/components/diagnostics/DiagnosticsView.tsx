import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Play, Download, RotateCw, Database, Network, Check, Radio, Cpu, AlertTriangle, Camera as CameraIcon, Square, ShieldCheck, HardDrive } from 'lucide-react';
import type { Camera, HealthState, SystemStatus } from '../../types/cctv';
import { downloadSupportBundle, getCameraDiagnostics, getSystemDiagnostics } from '../../api';

interface DiagnosticsViewProps {
  cameras: Camera[];
  selectedCameraId?: string;
}

type DiagnosticCheck = { id: string; label: string; state: HealthState; detail: string };
type LogEntry = { time: string; type: 'INFO' | 'PASS' | 'WARN' | 'FAIL'; message: string; component: string };

const stateTone = (state: HealthState) => state === 'healthy' ? 'PASS' : state === 'unhealthy' ? 'FAIL' : 'WARN';

export const DiagnosticsView: React.FC<DiagnosticsViewProps> = ({ cameras = [], selectedCameraId = '' }) => {
  const [currentCameraId, setCurrentCameraId] = useState(selectedCameraId);
  const [isRunningFullTest, setIsRunningFullTest] = useState(false);
  const [lastCheckedTime, setLastCheckedTime] = useState('Not checked yet');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [systemChecks, setSystemChecks] = useState<DiagnosticCheck[]>([]);
  const [cameraDiagnostics, setCameraDiagnostics] = useState<any>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [browserMediaActive, setBrowserMediaActive] = useState(false);
  const [browserMediaError, setBrowserMediaError] = useState('');
  const browserMediaRef = useRef<HTMLVideoElement | null>(null);
  const browserStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => { if (selectedCameraId) setCurrentCameraId(selectedCameraId); }, [selectedCameraId]);
  const activeCamera = useMemo(() => cameras.find(c => c.id === currentCameraId) || cameras[0] || null, [cameras, currentCameraId]);
  useEffect(() => { if (!currentCameraId && activeCamera) setCurrentCameraId(activeCamera.id); }, [activeCamera, currentCameraId]);

  const showToast = (msg: string) => { setToastMessage(msg); setTimeout(() => setToastMessage(null), 3000); };

  const refreshSystem = async () => {
    try {
      const data = await getSystemDiagnostics();
      setSystemStatus(data.status || null);
      setSystemChecks(Array.isArray(data.checks) ? data.checks : []);
      return data;
    } catch (error: any) {
      setSystemStatus(null);
      setSystemChecks([{ id: 'backend', label: 'CCTV API', state: 'unknown', detail: error?.message || 'Status unavailable' }]);
      throw error;
    }
  };

  const refreshCamera = async (cameraId?: string) => {
    if (!cameraId) { setCameraDiagnostics(null); return null; }
    try {
      const data = await getCameraDiagnostics(cameraId);
      setCameraDiagnostics(data);
      return data;
    } catch (error: any) {
      setCameraDiagnostics({ checks: [{ id: 'camera', label: 'Camera diagnostics', state: 'unknown', detail: error?.message || 'Unavailable' }] });
      throw error;
    }
  };

  useEffect(() => { void refreshSystem().catch(() => undefined); }, []);
  useEffect(() => { void refreshCamera(activeCamera?.id).catch(() => undefined); }, [activeCamera?.id]);

  const stopBrowserMediaTest = () => {
    browserStreamRef.current?.getTracks().forEach((track) => track.stop());
    browserStreamRef.current = null;
    if (browserMediaRef.current) { browserMediaRef.current.pause(); browserMediaRef.current.srcObject = null; }
    setBrowserMediaActive(false);
  };

  const startBrowserMediaTest = async () => {
    stopBrowserMediaTest();
    setBrowserMediaError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Browser camera access is unavailable. Remote HTTP pages may require HTTPS for camera permission.');
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      browserStreamRef.current = stream;
      setBrowserMediaActive(true);
      if (browserMediaRef.current) { browserMediaRef.current.srcObject = stream; await browserMediaRef.current.play().catch(() => undefined); }
    } catch (error: any) { setBrowserMediaError(error?.message || 'Browser camera permission failed.'); }
  };

  useEffect(() => () => stopBrowserMediaTest(), []);
  useEffect(() => { if (browserMediaActive && browserMediaRef.current && browserStreamRef.current) { browserMediaRef.current.srcObject = browserStreamRef.current; void browserMediaRef.current.play().catch(() => undefined); } }, [browserMediaActive]);

  const handleRunFullTest = async () => {
    setIsRunningFullTest(true);
    const now = new Date();
    const time = now.toLocaleTimeString();
    const next: LogEntry[] = [{ time, type: 'INFO', message: 'Starting read-only live diagnostics.', component: 'system' }];
    try {
      const system = await refreshSystem();
      for (const check of (system.checks || []) as DiagnosticCheck[]) next.push({ time, type: stateTone(check.state), message: `${check.label}: ${check.detail}`, component: check.id });
      if (activeCamera) {
        const camera = await refreshCamera(activeCamera.id);
        for (const check of (camera?.checks || []) as DiagnosticCheck[]) next.push({ time, type: stateTone(check.state), message: `${check.label}: ${check.detail}`, component: `camera:${check.id}` });
      } else next.push({ time, type: 'WARN', message: 'No camera is configured.', component: 'camera' });
      setLogs(next);
      setLastCheckedTime(now.toLocaleString());
      const failures = next.filter(x => x.type === 'FAIL').length;
      showToast(failures ? `Diagnostics completed with ${failures} failure${failures === 1 ? '' : 's'}.` : 'Diagnostics completed with no detected failures.');
    } catch (error: any) {
      next.push({ time, type: 'FAIL', message: error?.message || 'Diagnostics failed.', component: 'system' });
      setLogs(next);
      setLastCheckedTime(now.toLocaleString());
    } finally { setIsRunningFullTest(false); }
  };

  const handleDownloadReport = () => {
    const text = [`CCTV Monitor Diagnostics`, `Checked: ${lastCheckedTime}`, '', ...logs.map(l => `[${l.time}] [${l.type}] [${l.component}] ${l.message}`)].join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a'); a.href = url; a.download = `cctv_diagnostics_${Date.now()}.txt`; a.click(); URL.revokeObjectURL(url);
  };

  const handleSupportBundle = async () => { try { await downloadSupportBundle(); showToast('Support bundle exported.'); } catch (error: any) { showToast(error?.message || 'Support bundle export failed. Admin access is required.'); } };
  const formatUptime = (seconds: number | undefined) => { if (!Number.isFinite(seconds)) return 'Unavailable'; const total = Math.max(0, Number(seconds)); const h = Math.floor(total / 3600); const m = Math.floor((total % 3600) / 60); const sec = total % 60; return `${h}h ${m}m ${sec}s`; };

  const card = (title: string, state: HealthState, detail: string, icon: React.ReactNode) => {
    const ok = state === 'healthy'; const unknown = ['unknown', 'not_configured', 'not_supported'].includes(state);
    return <div className="p-4 rounded-xl border border-slate-200/90 bg-slate-50/30 space-y-3"><div className="flex items-center justify-between"><div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center">{icon}</div><span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${ok ? 'text-emerald-600' : unknown ? 'text-amber-600' : 'text-rose-600'}`}><span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-emerald-500' : unknown ? 'bg-amber-500' : 'bg-rose-500'}`}></span>{state.replace('_', ' ')}</span></div><div><div className="font-bold text-slate-900 text-xs">{title}</div><div className="text-[11px] text-slate-500 mt-2 break-all">{detail}</div></div></div>;
  };

  const checkIcon = (id: string) => id.includes('storage') ? <HardDrive className="w-4 h-4" /> : id.includes('database') ? <Database className="w-4 h-4" /> : id.includes('ffmpeg') ? <Cpu className="w-4 h-4" /> : id.includes('webrtc') || id.includes('hls') || id.includes('mediamtx') ? <Radio className="w-4 h-4" /> : <Network className="w-4 h-4" />;

  return <div className="flex-1 flex flex-col h-full bg-[#f4f6fa] overflow-y-auto">
    {toastMessage && <div className="fixed bottom-10 right-10 z-50 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-2xl border border-slate-700 text-xs flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" />{toastMessage}</div>}
    <div className="p-6 space-y-6 flex-1">
      <div className="flex items-center justify-between"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100"><Activity className="w-5 h-5" /></div><div><h1 className="text-2xl font-bold text-slate-900">Diagnostics</h1><p className="text-xs text-slate-500">Read-only health checks. Repair/restart actions remain explicit in Camera Management.</p></div></div><div className="flex items-center gap-3"><button onClick={handleRunFullTest} disabled={isRunningFullTest} className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg disabled:opacity-50"><Play className="w-3.5 h-3.5" />{isRunningFullTest ? 'Testing…' : 'Run Full Test'}</button><button onClick={handleDownloadReport} className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 text-xs font-semibold rounded-lg"><Download className="w-3.5 h-3.5" />Report</button><button onClick={() => void handleSupportBundle()} className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white text-xs font-semibold rounded-lg"><Download className="w-3.5 h-3.5" />Support Bundle</button></div></div>

      <div className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-xs space-y-4"><div className="flex items-center justify-between pb-3 border-b border-slate-100"><div><h2 className="text-base font-bold text-slate-900">System Health</h2><p className="text-xs text-slate-400">Last checked: {lastCheckedTime}</p></div><button onClick={() => void refreshSystem().catch(() => undefined)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold"><RotateCw className="w-3.5 h-3.5" />Refresh</button></div><div className="grid md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">{systemChecks.map(check => <React.Fragment key={check.id}>{card(check.label, check.state, check.detail, checkIcon(check.id))}</React.Fragment>)}</div></div>

      <div className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-xs"><div className="grid md:grid-cols-4 gap-4 text-xs"><div><div className="text-slate-400">Runtime Mode</div><div className="font-bold mt-1 text-slate-800">{systemStatus?.backend?.mode || 'unknown'}</div></div><div><div className="text-slate-400">Application Uptime</div><div className="font-bold mt-1 text-slate-800">{formatUptime(systemStatus?.backend?.uptimeSeconds)}</div></div><div><div className="text-slate-400">Active Media Sessions</div><div className="font-bold mt-1 text-slate-800">{systemStatus?.activeMediaSessions ?? 0}</div></div><div><div className="text-slate-400">Recovery Attempts</div><div className="font-bold mt-1 text-slate-800">{systemStatus?.cameras?.reduce((n, c) => n + Number(c.restartCount || 0), 0) ?? 0}</div></div></div></div>

      <div className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-xs space-y-4"><div className="flex items-center justify-between"><div><h2 className="text-base font-bold text-slate-900">Camera Diagnostics</h2><p className="text-xs text-slate-400">Backend-reported worker and media state; no automatic repair is performed from this screen.</p></div><select value={activeCamera?.id || ''} onChange={e => setCurrentCameraId(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-lg text-xs"><option value="" disabled>Select camera</option>{cameras.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>{activeCamera ? <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">{(cameraDiagnostics?.checks || []).map((check: DiagnosticCheck) => <React.Fragment key={check.id}>{card(check.label, check.state, check.detail, checkIcon(check.id))}</React.Fragment>)}</div> : <div className="p-8 text-center text-slate-400 text-xs">No camera configured.</div>}{cameraDiagnostics?.runtime?.reason && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><strong>Runtime reason:</strong> {cameraDiagnostics.runtime.reason}{cameraDiagnostics.runtime.nextRetryAt ? ` • next retry ${new Date(cameraDiagnostics.runtime.nextRetryAt).toLocaleTimeString()}` : ''}</div>}</div>

      <div className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-xs space-y-4"><div className="flex items-center justify-between gap-4"><div><h2 className="text-base font-bold text-slate-900 flex items-center gap-2"><CameraIcon className="w-4 h-4 text-blue-600" />Browser Media Test</h2><p className="text-xs text-slate-500 mt-1">Optional client-side permission test only. It does not prove server-side DirectShow capture or WebRTC playback.</p></div>{browserMediaActive ? <button onClick={stopBrowserMediaTest} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold"><Square className="w-3.5 h-3.5" />Stop Browser Camera</button> : <button onClick={() => void startBrowserMediaTest()} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-700 text-xs font-semibold hover:bg-slate-50"><Play className="w-3.5 h-3.5 text-blue-600" />Test This Browser Camera</button>}</div>{browserMediaError && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 flex gap-2"><AlertTriangle className="w-4 h-4 shrink-0" />{browserMediaError}</div>}<div className="aspect-video max-w-2xl rounded-xl overflow-hidden bg-slate-950 border border-slate-200 flex items-center justify-center"><video ref={browserMediaRef} autoPlay playsInline muted className={`w-full h-full object-cover ${browserMediaActive ? '' : 'hidden'}`} />{!browserMediaActive && <div className="text-center text-slate-500 text-xs px-6"><CameraIcon className="w-8 h-8 mx-auto mb-2 text-slate-600" />No browser camera is open.</div>}</div></div>

      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 flex gap-3 text-xs text-emerald-900"><ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" /><div><div className="font-semibold">Diagnostic semantics are explicit.</div><p className="mt-1">“Available” means the backend can verify that service/listener. Browser playback is separately confirmed by the live player when it establishes WebRTC/HLS.</p></div></div>

      <div className="bg-slate-950 rounded-xl border border-slate-800 p-4 text-xs font-mono text-slate-300 min-h-[180px]">{logs.length === 0 ? <div className="text-slate-500">Run Full Test to generate live diagnostic results.</div> : logs.map((l, i) => <div key={i} className="py-1"><span className="text-slate-500">[{l.time}]</span> <span className={l.type === 'PASS' ? 'text-emerald-400' : l.type === 'FAIL' ? 'text-rose-400' : l.type === 'WARN' ? 'text-amber-400' : 'text-blue-400'}>[{l.type}]</span> {l.message}</div>)}</div>
    </div>
  </div>;
};
