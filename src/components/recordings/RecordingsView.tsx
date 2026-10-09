import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CheckSquare, CircleStop, DatabaseZap, Download, Film, Lock, PlaySquare,
  RefreshCw, Save, Settings2, ShieldCheck, Trash2, Tv, Unlock, Video,
} from 'lucide-react';
import type {
  Camera, RecordingHealth, RecordingRetentionPolicy, RecordingRuntime, RecordingSegment, RecordingSummary,
} from '../../types/cctv';
import {
  deleteRecording, deleteRecordingsBulk, getRecordingHealth, getRecordingPolicy, getRecordingRuntime, getRecordings,
  reconcileRecordings, runRecordingRetention, setRecordingProtected, startContinuousRecording, stopContinuousRecording,
  updateRecordingPolicy,
} from '../../api';

const demoMode = import.meta.env.VITE_CCTV_DEMO_MODE === 'true';

interface RecordingsViewProps {
  cameras: Camera[];
  initialCameraId?: string;
  onNavigateToLive: () => void;
  canDownload?: boolean;
  canManage?: boolean;
}

function bytes(value: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']; let n = Math.max(0, value || 0); let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return `${n >= 10 || i === 0 ? n.toFixed(0) : n.toFixed(1)} ${units[i]}`;
}
function duration(value: number): string {
  const total = Math.max(0, Math.round(value || 0)); const h = Math.floor(total / 3600); const m = Math.floor((total % 3600) / 60); const s = total % 60;
  return h ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
}
function localDateTime(iso: string): string { try { return new Date(iso).toLocaleString(); } catch { return iso; } }
const GB = 1024 ** 3;

export const RecordingsView: React.FC<RecordingsViewProps> = ({ cameras, initialCameraId = '', onNavigateToLive, canDownload = false, canManage = false }) => {
  const [selectedCameraId, setSelectedCameraId] = useState(initialCameraId || cameras[0]?.id || '');
  const [date, setDate] = useState('');
  const [protectedOnly, setProtectedOnly] = useState(false);
  const [segments, setSegments] = useState<RecordingSegment[]>([]);
  const [runtimes, setRuntimes] = useState<RecordingRuntime[]>([]);
  const [summary, setSummary] = useState<RecordingSummary | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [policy, setPolicy] = useState<RecordingRetentionPolicy | null>(null);
  const [health, setHealth] = useState<RecordingHealth | null>(null);
  const [policyEnabled, setPolicyEnabled] = useState(false);
  const [maxAgeDays, setMaxAgeDays] = useState(14);
  const [maxStorageGb, setMaxStorageGb] = useState(0);
  const [minFreeGb, setMinFreeGb] = useState(5);

  useEffect(() => {
    if (initialCameraId && cameras.some((camera) => camera.id === initialCameraId)) setSelectedCameraId(initialCameraId);
    else if (!selectedCameraId && cameras[0]) setSelectedCameraId(cameras[0].id);
  }, [initialCameraId, cameras, selectedCameraId]);

  const load = useCallback(async () => {
    if (demoMode) { setSegments([]); setError('Recording is not simulated in demo mode. Run the local server to use the real recording engine.'); return; }
    if (!selectedCameraId) { setSegments([]); return; }
    setLoading(true);
    try {
      const [items, runtime] = await Promise.all([
        getRecordings({ cameraId: selectedCameraId, date: date || undefined, protectedOnly, limit: 1000 }),
        getRecordingRuntime(),
      ]);
      setSegments(items); setRuntimes(runtime.runtimes); setSummary(runtime.summary); setError('');
      setSelectedId((current) => current && items.some((item) => item.id === current) ? current : (items[0]?.id || null));
      setChecked((current) => new Set([...current].filter((id) => items.some((item) => item.id === id))));
    } catch (e: any) { setError(e?.message || 'Unable to load recordings.'); }
    finally { setLoading(false); }
  }, [selectedCameraId, date, protectedOnly]);

  const loadManagement = useCallback(async () => {
    if (!canManage || demoMode) return;
    try {
      const [nextPolicy, nextHealth] = await Promise.all([getRecordingPolicy(), getRecordingHealth()]);
      setPolicy(nextPolicy); setHealth(nextHealth.health);
      setPolicyEnabled(nextPolicy.enabled); setMaxAgeDays(nextPolicy.maxAgeDays);
      setMaxStorageGb(Number((nextPolicy.maxStorageBytes / GB).toFixed(2))); setMinFreeGb(Number((nextPolicy.minFreeBytes / GB).toFixed(2)));
    } catch (e: any) { setError(e?.message || 'Unable to load recording management settings.'); }
  }, [canManage]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadManagement(); }, [loadManagement]);
  useEffect(() => { const timer = window.setInterval(() => void load(), 10000); return () => window.clearInterval(timer); }, [load]);

  const selectedCamera = cameras.find((camera) => camera.id === selectedCameraId) || cameras[0];
  const runtime = runtimes.find((item) => item.cameraId === selectedCameraId);
  const selected = segments.find((item) => item.id === selectedId) || segments[0] || null;
  const supported = selectedCamera?.source_type === 'usb';
  const canStart = Boolean(canManage && selectedCamera && supported && !runtime?.desired);
  const canStop = Boolean(canManage && selectedCamera && supported && runtime?.desired);
  const statusLabel = !supported ? 'USB recording only' : runtime?.active ? 'Recording now' : runtime?.desired ? 'Armed — waiting for live stream' : 'Off';
  const statusClass = runtime?.active ? 'bg-rose-50 border-rose-200 text-rose-700' : runtime?.desired ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-slate-50 border-slate-200 text-slate-600';
  const selectedUnlockedIds = [...checked].filter((id) => !segments.find((item) => item.id === id)?.protected);

  const toggleRecording = async (enabled: boolean) => {
    if (!selectedCamera) return; setActionBusy(true); setNotice('');
    try { if (enabled) await startContinuousRecording(selectedCamera.id); else await stopContinuousRecording(selectedCamera.id); await load(); }
    catch (e: any) { setError(e?.message || 'Recording control failed.'); } finally { setActionBusy(false); }
  };

  const toggleProtection = async (segment: RecordingSegment) => {
    setActionBusy(true); setNotice('');
    try { await setRecordingProtected(segment.id, !segment.protected); setNotice(segment.protected ? 'Recording unlocked.' : 'Recording protected from deletion/retention.'); await Promise.all([load(), loadManagement()]); }
    catch (e: any) { setError(e?.message || 'Unable to update protection.'); } finally { setActionBusy(false); }
  };

  const removeOne = async (segment: RecordingSegment) => {
    if (segment.protected) { setError('Unlock this recording before deleting it.'); return; }
    if (!window.confirm(`Delete this finalized recording permanently?\n\n${localDateTime(segment.startedAt)} • ${bytes(segment.sizeBytes)}`)) return;
    setActionBusy(true); setNotice('');
    try { await deleteRecording(segment.id); setNotice('Recording deleted.'); await Promise.all([load(), loadManagement()]); }
    catch (e: any) { setError(e?.message || 'Unable to delete recording.'); } finally { setActionBusy(false); }
  };

  const removeSelected = async () => {
    if (!selectedUnlockedIds.length) { setError('Select at least one unlocked recording. Protected recordings are never bulk-deleted.'); return; }
    if (!window.confirm(`Permanently delete ${selectedUnlockedIds.length} selected unlocked recording(s)?`)) return;
    setActionBusy(true); setNotice('');
    try {
      const result = await deleteRecordingsBulk(selectedUnlockedIds); setChecked(new Set());
      setNotice(`Deleted ${result.deletedCount} recording(s), ${bytes(result.deletedBytes)}. ${result.skippedProtected ? `${result.skippedProtected} protected item(s) skipped.` : ''}`);
      await Promise.all([load(), loadManagement()]);
    } catch (e: any) { setError(e?.message || 'Bulk delete failed.'); } finally { setActionBusy(false); }
  };

  const savePolicy = async () => {
    setActionBusy(true); setNotice('');
    try {
      const next = await updateRecordingPolicy({ enabled: policyEnabled, maxAgeDays, maxStorageBytes: Math.max(0, maxStorageGb) * GB, minFreeBytes: Math.max(0, minFreeGb) * GB });
      setPolicy(next); setNotice(next.enabled ? 'Retention policy saved and enabled.' : 'Retention policy saved; automatic deletion is disabled.'); await loadManagement();
    } catch (e: any) { setError(e?.message || 'Unable to save retention policy.'); } finally { setActionBusy(false); }
  };

  const runRetention = async () => {
    if (!policyEnabled) { setError('Enable and save the retention policy before running it.'); return; }
    if (!window.confirm('Run safe retention now? Only finalized, indexed, unlocked recordings can be deleted.')) return;
    setActionBusy(true); setNotice('');
    try { const result = await runRecordingRetention(); setNotice(`Retention completed: ${result.deletedCount} segment(s), ${bytes(result.deletedBytes)} removed.`); await Promise.all([load(), loadManagement()]); }
    catch (e: any) { setError(e?.message || 'Retention run failed.'); } finally { setActionBusy(false); }
  };

  const reconcile = async () => {
    setActionBusy(true); setNotice('');
    try { const result = await reconcileRecordings(); setHealth(result.health); setNotice(`Reconciliation complete. ${result.health.missing} missing, ${result.health.corrupt} corrupt, ${result.health.quarantined} quarantined.`); await load(); }
    catch (e: any) { setError(e?.message || 'Reconciliation failed.'); } finally { setActionBusy(false); }
  };

  const timeline = useMemo(() => [...segments].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt)), [segments]);
  const allChecked = segments.length > 0 && segments.every((item) => checked.has(item.id));
  const toggleAll = () => setChecked(allChecked ? new Set() : new Set(segments.map((item) => item.id)));

  return <div className="flex-1 flex flex-col h-full bg-[#f4f6fa] overflow-y-auto"><div className="p-3 sm:p-6 space-y-4 sm:space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100"><PlaySquare className="w-5 h-5" /></div><div><h1 className="text-xl sm:text-2xl font-bold text-slate-900">Recordings</h1><p className="text-xs text-slate-500">Finalized MP4 playback, protection, deletion, reconciliation, and safe retention.</p></div></div>
      <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto"><button onClick={() => void load()} disabled={loading} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-700 disabled:opacity-50"><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh</button><button onClick={onNavigateToLive} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-700"><Tv className="w-3.5 h-3.5 text-blue-600" />Live View</button></div>
    </div>
    {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">{error}<button onClick={()=>setError('')} className="ml-3 underline">Dismiss</button></div>}
    {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">{notice}</div>}

    <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-end gap-4">
      <div className="min-w-0 basis-full sm:basis-auto sm:min-w-64 flex-1"><label className="block text-[11px] font-semibold text-slate-500 mb-1">Camera</label><select value={selectedCameraId} onChange={(e)=>setSelectedCameraId(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-semibold text-slate-800">{cameras.map((camera)=><option key={camera.id} value={camera.id}>{camera.name} — {camera.location}</option>)}</select></div>
      <div><label className="block text-[11px] font-semibold text-slate-500 mb-1">Date</label><input type="date" value={date} onChange={(e)=>setDate(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-semibold text-slate-800" /></div>
      <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 pb-2"><input type="checkbox" checked={protectedOnly} onChange={(e)=>setProtectedOnly(e.target.checked)} />Protected only</label>
      <div className={`px-3 py-2 rounded-lg border text-xs font-semibold ${statusClass}`}>{statusLabel}</div>
      {canStart && <button disabled={actionBusy} onClick={()=>void toggleRecording(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-rose-600 text-white text-xs font-semibold disabled:opacity-50"><Video className="w-4 h-4" />Start Continuous</button>}
      {canStop && <button disabled={actionBusy} onClick={()=>void toggleRecording(false)} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 text-white text-xs font-semibold disabled:opacity-50"><CircleStop className="w-4 h-4" />Stop Recording</button>}
    </div>

    {!supported && selectedCamera && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex gap-3 text-xs text-amber-900"><AlertTriangle className="w-4 h-4 shrink-0" /><div><div className="font-semibold">Recording qualification remains USB-only</div><p className="mt-1">RTSP/Tenda live viewing remains available, but recording is not enabled for network cameras until hardware qualification.</p></div></div>}

    <div className="grid sm:grid-cols-2 xl:grid-cols-5 gap-3">
      <div className="bg-white border border-slate-200 rounded-xl p-4"><div className="text-[11px] text-slate-400">Indexed segments</div><div className="text-xl font-bold text-slate-900 mt-1">{summary?.segmentCount ?? segments.length}</div></div>
      <div className="bg-white border border-slate-200 rounded-xl p-4"><div className="text-[11px] text-slate-400">Recording storage</div><div className="text-xl font-bold text-slate-900 mt-1">{bytes(summary?.bytes || 0)}</div></div>
      <div className="bg-white border border-slate-200 rounded-xl p-4"><div className="text-[11px] text-slate-400">Protected</div><div className="text-xl font-bold text-slate-900 mt-1">{health?.protected ?? segments.filter((item)=>item.protected).length}</div></div>
      <div className="bg-white border border-slate-200 rounded-xl p-4"><div className="text-[11px] text-slate-400">Quarantined</div><div className="text-xl font-bold text-slate-900 mt-1">{health?.quarantined ?? 0}</div></div>
      <div className="bg-white border border-slate-200 rounded-xl p-4"><div className="text-[11px] text-slate-400">Active recorders</div><div className="text-xl font-bold text-slate-900 mt-1">{summary?.activeCount ?? 0}</div></div>
    </div>

    {canManage && <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-center gap-3"><div className="w-9 h-9 rounded-lg bg-violet-50 text-violet-700 flex items-center justify-center"><Settings2 className="w-4 h-4" /></div><div><h2 className="font-bold text-slate-900">Safe Retention Policy</h2><p className="text-[11px] text-slate-400">Disabled by default. Protected, active, quarantined, and unknown files are never automatic-deletion candidates.</p></div></div><div className="flex gap-2"><button disabled={actionBusy} onClick={()=>void reconcile()} className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 flex items-center gap-2"><DatabaseZap className="w-4 h-4" />Reconcile</button><button disabled={actionBusy || !policyEnabled} onClick={()=>void runRetention()} className="px-3 py-2 rounded-lg border border-amber-200 bg-amber-50 text-xs font-semibold text-amber-800">Run retention now</button></div></div>
      <div className="grid md:grid-cols-4 gap-3 items-end">
        <label className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-700 flex items-center gap-2"><input type="checkbox" checked={policyEnabled} onChange={(e)=>setPolicyEnabled(e.target.checked)} />Enable automatic retention</label>
        <div><label className="text-[11px] text-slate-500 font-semibold">Maximum age (days, 0=off)</label><input type="number" min="0" max="3650" value={maxAgeDays} onChange={(e)=>setMaxAgeDays(Math.max(0, Number(e.target.value)||0))} className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-xs" /></div>
        <div><label className="text-[11px] text-slate-500 font-semibold">Maximum indexed storage (GB, 0=off)</label><input type="number" min="0" step="0.1" value={maxStorageGb} onChange={(e)=>setMaxStorageGb(Math.max(0, Number(e.target.value)||0))} className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-xs" /></div>
        <div><label className="text-[11px] text-slate-500 font-semibold">Minimum free disk (GB, 0=off)</label><div className="flex gap-2 mt-1"><input type="number" min="0" step="0.1" value={minFreeGb} onChange={(e)=>setMinFreeGb(Math.max(0, Number(e.target.value)||0))} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs" /><button disabled={actionBusy} onClick={()=>void savePolicy()} className="px-3 py-2 bg-blue-600 text-white rounded-lg"><Save className="w-4 h-4" /></button></div></div>
      </div>
      <div className="text-[11px] text-slate-400">Saved policy: {policy ? `${policy.enabled ? 'Enabled' : 'Disabled'} • age ${policy.maxAgeDays || 'off'} day(s) • cap ${policy.maxStorageBytes ? bytes(policy.maxStorageBytes) : 'off'} • keep ${policy.minFreeBytes ? bytes(policy.minFreeBytes) : 'no minimum'} free` : 'Loading…'}</div>
    </div>}

    {canManage && segments.length > 0 && <div className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex flex-wrap items-center justify-between gap-3"><label className="flex items-center gap-2 text-xs font-semibold text-slate-700"><input type="checkbox" checked={allChecked} onChange={toggleAll} /><CheckSquare className="w-4 h-4" />Select displayed ({checked.size})</label><button disabled={actionBusy || selectedUnlockedIds.length===0} onClick={()=>void removeSelected()} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-xs font-semibold disabled:opacity-40"><Trash2 className="w-4 h-4" />Delete selected unlocked ({selectedUnlockedIds.length})</button></div>}

    <div className="grid xl:grid-cols-[minmax(0,2fr)_minmax(340px,1fr)] gap-5">
      <div className="bg-slate-950 rounded-xl border border-slate-800 overflow-hidden min-h-[360px] sm:min-h-[480px] flex flex-col">
        <div className="p-3 bg-slate-900 border-b border-slate-800 text-white flex items-center justify-between"><div className="flex items-center gap-2"><Film className="w-4 h-4 text-blue-400" /><div><div className="text-sm font-semibold">{selected ? `${selected.cameraName} playback` : 'No finalized segment selected'}</div><div className="text-[11px] text-slate-400">{selected ? `${localDateTime(selected.startedAt)} • ${duration(selected.durationSeconds)} • ${bytes(selected.sizeBytes)}${selected.protected ? ' • PROTECTED' : ''}` : 'Finalized recording files appear here.'}</div></div></div>{selected?.protected && <Lock className="w-4 h-4 text-amber-400" />}</div>
        <div className="flex-1 flex items-center justify-center bg-black min-h-[260px] sm:min-h-[400px]">{selected && selected.status === 'complete' ? <video key={selected.id} src={selected.mediaUrl} controls preload="metadata" className="w-full h-full max-h-[70vh] object-contain" /> : <div className="text-center text-slate-500 text-sm px-8"><Film className="w-10 h-10 mx-auto mb-3 opacity-50" />{runtime?.active ? 'Recording is active. The newest segment appears after it closes.' : 'No playable recording is available for this camera/date.'}</div>}</div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden"><div className="p-4 border-b border-slate-200"><h2 className="font-bold text-slate-900">Recorded Segments</h2><p className="text-[11px] text-slate-400 mt-1">Protection prevents both manual and automatic deletion.</p></div><div className="max-h-[560px] overflow-y-auto divide-y divide-slate-100">{segments.length ? segments.map((segment)=><div key={segment.id} className={`${selected?.id===segment.id?'bg-blue-50':''} hover:bg-blue-50/50`}><div className="p-4 flex items-start gap-3"><input type="checkbox" checked={checked.has(segment.id)} onChange={(e)=>{setChecked(prev=>{const next=new Set(prev); if(e.target.checked)next.add(segment.id);else next.delete(segment.id);return next;});}} className="mt-1" /><button onClick={()=>setSelectedId(segment.id)} className="text-left flex-1 min-w-0"><div className="text-xs font-semibold text-slate-800">{new Date(segment.startedAt).toLocaleTimeString()} – {new Date(segment.endedAt).toLocaleTimeString()}</div><div className="text-[11px] text-slate-400 mt-1">{new Date(segment.startedAt).toLocaleDateString()} • {duration(segment.durationSeconds)} • {bytes(segment.sizeBytes)}</div><div className="text-[10px] uppercase tracking-wide mt-1 text-slate-400">{segment.codec || 'H.264'} • {segment.status}{segment.protected ? ' • protected' : ''}</div></button><div className="flex items-center gap-1">{canManage && <button disabled={actionBusy} onClick={()=>void toggleProtection(segment)} className={`p-2 rounded-lg border ${segment.protected?'border-amber-200 text-amber-700 bg-amber-50':'border-slate-200 text-slate-500'}`} title={segment.protected?'Unlock recording':'Protect recording'}>{segment.protected?<Lock className="w-4 h-4" />:<Unlock className="w-4 h-4" />}</button>}{canDownload && segment.status==='complete' && <a href={segment.downloadUrl} className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:text-blue-600" title="Download MP4"><Download className="w-4 h-4" /></a>}{canManage && <button disabled={actionBusy || segment.protected} onClick={()=>void removeOne(segment)} className="p-2 rounded-lg border border-rose-200 text-rose-600 disabled:opacity-30" title={segment.protected?'Unlock before deleting':'Delete recording'}><Trash2 className="w-4 h-4" /></button>}</div></div></div>) : <div className="p-8 text-center text-xs text-slate-400">No finalized recording segments found.</div>}</div></div>
    </div>

    {timeline.length > 0 && <div className="bg-white rounded-xl border border-slate-200 p-4"><h2 className="text-sm font-bold text-slate-900 mb-3">Segment Timeline</h2><div className="flex flex-wrap gap-2">{timeline.map((segment)=><button key={segment.id} onClick={()=>setSelectedId(segment.id)} className={`px-3 py-2 rounded-lg border text-[11px] font-mono flex items-center gap-1 ${selected?.id===segment.id?'bg-blue-600 border-blue-600 text-white':'bg-slate-50 border-slate-200 text-slate-600'}`}>{segment.protected && <ShieldCheck className="w-3 h-3" />}{new Date(segment.startedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})}</button>)}</div></div>}
  </div></div>;
};
