import React, { useMemo, useState } from 'react';
import { AlertTriangle, Bell, Check, CheckCircle2, Film, HardDrive, PlaySquare, RefreshCw, Search, Server, Video } from 'lucide-react';
import type { CCTVEvent, MotionEventContext, MotionReviewStatus, RecordingSegment, AiEventContext, AiReviewStatus } from '../../types/cctv';
import { acknowledgeOperationalEvent, getEventRecordings, getMotionEventContext, updateMotionEventReview, getAiEventContext, getAiEventRecordings, updateAiEventReview } from '../../api';

interface EventsViewProps {
  events: CCTVEvent[];
  setEvents: React.Dispatch<React.SetStateAction<CCTVEvent[]>>;
  onRefresh?: () => Promise<void> | void;
  onViewCameraRecordings?: (cameraName: string) => void;
}

type CategoryFilter = 'all' | 'camera' | 'system' | 'storage';
type SeverityFilter = 'all' | 'info' | 'warning' | 'critical';
type AckFilter = 'all' | 'open' | 'acknowledged';

function eventIcon(event: CCTVEvent) {
  if (event.category === 'camera') return <Video className="w-4 h-4" />;
  if (event.category === 'storage') return <HardDrive className="w-4 h-4" />;
  return <Server className="w-4 h-4" />;
}

function severityClasses(severity: CCTVEvent['severity']) {
  if (severity === 'critical') return 'bg-rose-50 text-rose-700 border-rose-200';
  if (severity === 'warning') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-blue-50 text-blue-700 border-blue-200';
}

export const EventsView: React.FC<EventsViewProps> = ({ events, setEvents, onRefresh, onViewCameraRecordings }) => {
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [severity, setSeverity] = useState<SeverityFilter>('all');
  const [ack, setAck] = useState<AckFilter>('all');
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string>('');
  const [error, setError] = useState('');
  const [linkBusyId, setLinkBusyId] = useState<string>('');
  const [linkedRecordings, setLinkedRecordings] = useState<Record<string, RecordingSegment[]>>({});
  const [linkedLoaded, setLinkedLoaded] = useState<Record<string, boolean>>({});
  const [motionContexts, setMotionContexts] = useState<Record<string, MotionEventContext>>({});
  const [reviewBusyId, setReviewBusyId] = useState<string>('');
  const [aiContexts, setAiContexts] = useState<Record<string, AiEventContext>>({});
  const [aiRecordings, setAiRecordings] = useState<Record<string, RecordingSegment[]>>({});
  const [aiLoaded, setAiLoaded] = useState<Record<string, boolean>>({});

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return events.filter((event) => {
      if (category !== 'all' && event.category !== category) return false;
      if (severity !== 'all' && event.severity !== severity) return false;
      if (ack === 'open' && event.acknowledgedAt) return false;
      if (ack === 'acknowledged' && !event.acknowledgedAt) return false;
      if (!needle) return true;
      return [event.title, event.message, event.camera, event.eventType].some((value) => String(value || '').toLowerCase().includes(needle));
    });
  }, [events, category, severity, ack, query]);

  const openCritical = events.filter((event) => event.severity === 'critical' && !event.acknowledgedAt).length;
  const openWarnings = events.filter((event) => event.severity === 'warning' && !event.acknowledgedAt).length;

  const refresh = async () => {
    if (!onRefresh) return;
    setRefreshing(true); setError('');
    try { await onRefresh(); }
    catch (e: any) { setError(e?.message || 'Unable to refresh operational events.'); }
    finally { setRefreshing(false); }
  };

  const loadLinkedRecordings = async (event: CCTVEvent) => {
    setLinkBusyId(event.id); setError('');
    try {
      const [rows, context] = await Promise.all([getEventRecordings(event.id), getMotionEventContext(event.id)]);
      setLinkedRecordings((current) => ({ ...current, [event.id]: rows }));
      setMotionContexts((current) => ({ ...current, [event.id]: context }));
      setLinkedLoaded((current) => ({ ...current, [event.id]: true }));
    } catch (e: any) { setError(e?.message || 'Unable to load motion review and linked recordings.'); }
    finally { setLinkBusyId(''); }
  };

  const loadAiContext = async (event: CCTVEvent) => {
    setLinkBusyId(event.id); setError('');
    try {
      const [context, rows] = await Promise.all([getAiEventContext(event.id), getAiEventRecordings(event.id)]);
      setAiContexts((current) => ({ ...current, [event.id]: context }));
      setAiRecordings((current) => ({ ...current, [event.id]: rows }));
      setAiLoaded((current) => ({ ...current, [event.id]: true }));
    } catch (e: any) { setError(e?.message || 'Unable to load AI detection details.'); }
    finally { setLinkBusyId(''); }
  };

  const reviewMotion = async (event: CCTVEvent, status: MotionReviewStatus) => {
    const context = motionContexts[event.id] || await getMotionEventContext(event.id);
    setReviewBusyId(event.id); setError('');
    try {
      const review = await updateMotionEventReview(event.id, status, context.review.note || '');
      setMotionContexts((current) => ({ ...current, [event.id]: { ...(current[event.id] || context), review } }));
    } catch (e: any) { setError(e?.message || 'Unable to save motion review.'); }
    finally { setReviewBusyId(''); }
  };

  const saveReviewNote = async (event: CCTVEvent) => {
    const context = motionContexts[event.id];
    if (!context) return;
    setReviewBusyId(event.id); setError('');
    try {
      const review = await updateMotionEventReview(event.id, context.review.status, context.review.note || '');
      setMotionContexts((current) => ({ ...current, [event.id]: { ...context, review } }));
    } catch (e: any) { setError(e?.message || 'Unable to save review note.'); }
    finally { setReviewBusyId(''); }
  };


  const reviewAi = async (event: CCTVEvent, status: AiReviewStatus) => {
    const context = aiContexts[event.id] || await getAiEventContext(event.id);
    setReviewBusyId(event.id); setError('');
    try {
      const review = await updateAiEventReview(event.id, status, context.review.note || '');
      setAiContexts((current) => ({ ...current, [event.id]: { ...(current[event.id] || context), review } }));
    } catch (e: any) { setError(e?.message || 'Unable to save AI review.'); }
    finally { setReviewBusyId(''); }
  };

  const saveAiReviewNote = async (event: CCTVEvent) => {
    const context = aiContexts[event.id]; if (!context) return;
    setReviewBusyId(event.id); setError('');
    try { const review = await updateAiEventReview(event.id, context.review.status, context.review.note || ''); setAiContexts((current) => ({ ...current, [event.id]: { ...context, review } })); }
    catch (e: any) { setError(e?.message || 'Unable to save AI review note.'); }
    finally { setReviewBusyId(''); }
  };

  const acknowledge = async (event: CCTVEvent) => {
    setBusyId(event.id); setError('');
    try {
      const updated = await acknowledgeOperationalEvent(event.id);
      setEvents((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (e: any) { setError(e?.message || 'Unable to acknowledge this event.'); }
    finally { setBusyId(''); }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#f4f6fa] overflow-y-auto">
      <div className="p-6 space-y-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100"><Bell className="w-5 h-5" /></div>
            <div><h1 className="text-2xl font-bold text-slate-900">Operational Events</h1><p className="text-xs text-slate-500">Persisted CCTV runtime transitions — separate from security/user audit activity</p></div>
          </div>
          <button onClick={() => void refresh()} disabled={refreshing} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-700 disabled:opacity-50"><RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />Refresh</button>
        </div>

        {error && <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-xs p-3">{error}</div>}

        <div className="grid sm:grid-cols-3 gap-3">
          <div className="bg-white rounded-xl border border-slate-200 p-4"><div className="text-[11px] text-slate-400 uppercase tracking-wide">Recent events</div><div className="text-2xl font-bold text-slate-900 mt-1">{events.length}</div><div className="text-[11px] text-slate-400">latest events loaded</div></div>
          <div className="bg-white rounded-xl border border-slate-200 p-4"><div className="text-[11px] text-slate-400 uppercase tracking-wide">Open warnings</div><div className="text-2xl font-bold text-amber-600 mt-1">{openWarnings}</div><div className="text-[11px] text-slate-400">not acknowledged</div></div>
          <div className="bg-white rounded-xl border border-slate-200 p-4"><div className="text-[11px] text-slate-400 uppercase tracking-wide">Critical</div><div className="text-2xl font-bold text-rose-600 mt-1">{openCritical}</div><div className="text-[11px] text-slate-400">requires review</div></div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 flex gap-3 flex-wrap items-center">
          <div className="relative min-w-[220px] flex-1"><Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search event, camera, reason…" className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-xs outline-none focus:ring-2 focus:ring-blue-100" /></div>
          <select value={category} onChange={(e) => setCategory(e.target.value as CategoryFilter)} className="px-3 py-2 rounded-lg border border-slate-200 text-xs bg-white"><option value="all">All categories</option><option value="camera">Camera</option><option value="system">System</option><option value="storage">Storage</option></select>
          <select value={severity} onChange={(e) => setSeverity(e.target.value as SeverityFilter)} className="px-3 py-2 rounded-lg border border-slate-200 text-xs bg-white"><option value="all">All severities</option><option value="info">Info</option><option value="warning">Warning</option><option value="critical">Critical</option></select>
          <select value={ack} onChange={(e) => setAck(e.target.value as AckFilter)} className="px-3 py-2 rounded-lg border border-slate-200 text-xs bg-white"><option value="all">All status</option><option value="open">Open</option><option value="acknowledged">Acknowledged</option></select>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {filtered.length === 0 ? (
            <div className="py-14 text-center"><CheckCircle2 className="w-9 h-9 text-slate-300 mx-auto" /><div className="mt-3 text-sm font-semibold text-slate-700">No matching operational events</div><div className="mt-1 text-xs text-slate-400">Runtime events appear here when the server, camera, media server, or storage state changes.</div></div>
          ) : (
            <div className="divide-y divide-slate-100">
              {filtered.map((event) => (
                <div key={event.id} className={`p-4 flex gap-4 ${event.acknowledgedAt ? 'bg-slate-50/60' : ''}`}>
                  <div className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 ${severityClasses(event.severity)}`}>{event.severity === 'critical' ? <AlertTriangle className="w-4 h-4" /> : eventIcon(event)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0"><div className="flex items-center gap-2 flex-wrap"><span className="font-semibold text-sm text-slate-900">{event.title || event.eventType}</span><span className={`px-2 py-0.5 rounded-full border text-[10px] uppercase font-semibold ${severityClasses(event.severity)}`}>{event.severity}</span>{event.category && <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[10px] uppercase">{event.category}</span>}</div><p className="text-xs text-slate-600 mt-1 leading-relaxed">{event.message}</p><div className="text-[10px] text-slate-400 mt-2 flex gap-3 flex-wrap"><span>{new Date(event.timestamp).toLocaleString()}</span>{event.cameraId && <span>{event.camera}</span>}<span>{event.eventType}</span>{event.acknowledgedAt && <span className="text-emerald-600 flex items-center gap-1"><Check className="w-3 h-3" />Acknowledged {new Date(event.acknowledgedAt).toLocaleString()}</span>}</div>
                        {event.eventType === 'MOTION_DETECTED' && event.cameraId && (
                          <div className="mt-3 rounded-lg border border-violet-100 bg-violet-50/60 p-2.5 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 text-[11px] font-semibold text-violet-800"><Film className="w-3.5 h-3.5" />Motion review & linked footage</div>
                              <div className="flex items-center gap-2">
                                <button onClick={() => void loadLinkedRecordings(event)} disabled={linkBusyId === event.id} className="px-2 py-1 rounded border border-violet-200 bg-white text-[10px] font-semibold text-violet-700 disabled:opacity-50">{linkBusyId === event.id ? 'Loading…' : linkedLoaded[event.id] ? 'Refresh' : 'Review event'}</button>
                                {onViewCameraRecordings && <button onClick={() => onViewCameraRecordings(event.camera)} className="px-2 py-1 rounded border border-slate-200 bg-white text-[10px] font-semibold text-slate-600">All camera recordings</button>}
                              </div>
                            </div>
                            {linkedLoaded[event.id] && (() => {
                              const context = motionContexts[event.id];
                              return <div className="space-y-2">
                                {context && <div className="grid md:grid-cols-[180px_1fr] gap-2">
                                  <div className="rounded-lg border border-violet-100 bg-slate-950/5 overflow-hidden min-h-[100px] flex items-center justify-center">
                                    {context.snapshotUrl ? <img src={`${context.snapshotUrl}?t=${encodeURIComponent(context.detectedAt)}`} alt="Motion snapshot" className="w-full h-auto object-cover" /> : <div className="text-[10px] text-slate-400 p-4 text-center">Snapshot was not captured for this event.</div>}
                                  </div>
                                  <div className="space-y-2">
                                    <div className="text-[10px] text-slate-600"><span className="font-semibold">Zone:</span> {context.zoneName || 'Whole frame'} • <span className="font-semibold">Scene score:</span> {context.sceneScore.toFixed(3)} • <span className="font-semibold">Sensitivity:</span> {context.sensitivity}%</div>
                                    <textarea value={context.review.note} maxLength={1000} onChange={(e) => setMotionContexts((current) => ({ ...current, [event.id]: { ...context, review: { ...context.review, note: e.target.value } } }))} placeholder="Optional reviewer note…" className="w-full min-h-[58px] px-2 py-1.5 rounded border border-slate-200 bg-white text-[10px]" />
                                    <div className="flex gap-1 flex-wrap">
                                      {(['confirmed','dismissed','unreviewed'] as MotionReviewStatus[]).map((status) => <button key={status} disabled={reviewBusyId === event.id} onClick={() => void reviewMotion(event, status)} className={`px-2 py-1 rounded border text-[9px] font-semibold ${context.review.status === status ? status === 'confirmed' ? 'bg-emerald-600 text-white border-emerald-600' : status === 'dismissed' ? 'bg-slate-600 text-white border-slate-600' : 'bg-violet-600 text-white border-violet-600' : 'bg-white border-slate-200 text-slate-600'}`}>{status === 'confirmed' ? 'Confirm motion' : status === 'dismissed' ? 'Dismiss / false alarm' : 'Reset review'}</button>)}
                                      <button disabled={reviewBusyId === event.id} onClick={() => void saveReviewNote(event)} className="px-2 py-1 rounded border border-violet-200 bg-white text-[9px] font-semibold text-violet-700">Save note</button>
                                    </div>
                                    <div className="text-[9px] text-slate-400">Review: {context.review.status}{context.review.reviewedAt ? ` • ${new Date(context.review.reviewedAt).toLocaleString()}` : ''}</div>
                                  </div>
                                </div>}
                                <div className="space-y-1.5">
                                  {(linkedRecordings[event.id] || []).length === 0 ? <div className="text-[10px] text-violet-700">No finalized segment overlaps this motion window yet. Continuous Recording must be armed for linked footage.</div> : (linkedRecordings[event.id] || []).map((clip) => (
                                    <div key={clip.id} className="flex items-center justify-between gap-2 rounded bg-white border border-violet-100 px-2 py-1.5">
                                      <div className="text-[10px] text-slate-600">{new Date(clip.startedAt).toLocaleTimeString()}–{new Date(clip.endedAt).toLocaleTimeString()} • {(clip.sizeBytes / 1024 / 1024).toFixed(1)} MB</div>
                                      <a href={clip.mediaUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] font-semibold text-violet-700"><PlaySquare className="w-3 h-3" />Play</a>
                                    </div>
                                  ))}
                                </div>
                              </div>;
                            })()}
                          </div>
                        )}
                        {(event.eventType === 'PERSON_DETECTED' || event.eventType === 'VEHICLE_DETECTED') && event.cameraId && (
                          <div className="mt-3 rounded-lg border border-cyan-100 bg-cyan-50/60 p-2.5 space-y-2">
                            <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2 text-[11px] font-semibold text-cyan-800"><Film className="w-3.5 h-3.5"/>Local AI detection</div><button onClick={()=>void loadAiContext(event)} disabled={linkBusyId===event.id} className="px-2 py-1 rounded border border-cyan-200 bg-white text-[10px] font-semibold text-cyan-700 disabled:opacity-50">{linkBusyId===event.id?'Loading…':aiLoaded[event.id]?'Refresh':'View detection'}</button></div>
                            {aiLoaded[event.id] && aiContexts[event.id] && (()=>{ const ctx=aiContexts[event.id]; return <div className="space-y-2">
                              <div className="grid md:grid-cols-[220px_1fr] gap-2">
                                <div className="relative rounded-lg border border-cyan-100 bg-slate-950/5 overflow-hidden min-h-[120px] flex items-center justify-center">
                                  {ctx.snapshotUrl?<><img src={`${ctx.snapshotUrl}?t=${encodeURIComponent(ctx.detectedAt)}`} alt="AI detection snapshot" className="w-full h-auto object-cover"/>{ctx.boxes.slice(0,10).map((box,i)=><div key={`${box.className}-${i}`} className={`absolute border-2 ${box.classId===0?'border-emerald-400':'border-amber-400'}`} style={{left:`${box.x*100}%`,top:`${box.y*100}%`,width:`${box.width*100}%`,height:`${box.height*100}%`}}><span className={`absolute -top-5 left-0 px-1 py-0.5 rounded text-[8px] font-bold text-white whitespace-nowrap ${box.classId===0?'bg-emerald-600':'bg-amber-600'}`}>{box.className} {(box.confidence*100).toFixed(0)}%</span></div>)}</>:<div className="text-[10px] text-slate-400 p-4 text-center">Snapshot unavailable.</div>}
                                </div>
                                <div className="text-[10px] text-slate-600 space-y-2"><div><span className="font-semibold">Type:</span> {ctx.objectType} • <span className="font-semibold">Count:</span> {ctx.objectCount} • <span className="font-semibold">Best:</span> {(ctx.confidence*100).toFixed(1)}%</div><div><span className="font-semibold">Classes:</span> {ctx.classes.join(', ')||'—'}</div><div><span className="font-semibold">Model:</span> {ctx.modelName}</div><div className="text-slate-400">No face recognition or identity matching is performed.</div>
                                  <textarea value={ctx.review.note} maxLength={1000} onChange={(e)=>setAiContexts(cur=>({...cur,[event.id]:{...ctx,review:{...ctx.review,note:e.target.value}}}))} placeholder="Optional AI review note…" className="w-full min-h-[54px] px-2 py-1.5 rounded border border-cyan-100 bg-white text-[10px]"/>
                                  <div className="flex gap-1 flex-wrap"><button disabled={reviewBusyId===event.id} onClick={()=>void reviewAi(event,'confirmed_person')} className={`px-2 py-1 rounded border text-[9px] font-semibold ${ctx.review.status==='confirmed_person'?'bg-emerald-600 text-white border-emerald-600':'bg-white border-slate-200 text-slate-600'}`}>Confirm person</button><button disabled={reviewBusyId===event.id} onClick={()=>void reviewAi(event,'confirmed_vehicle')} className={`px-2 py-1 rounded border text-[9px] font-semibold ${ctx.review.status==='confirmed_vehicle'?'bg-blue-600 text-white border-blue-600':'bg-white border-slate-200 text-slate-600'}`}>Confirm vehicle</button><button disabled={reviewBusyId===event.id} onClick={()=>void reviewAi(event,'false_detection')} className={`px-2 py-1 rounded border text-[9px] font-semibold ${ctx.review.status==='false_detection'?'bg-slate-700 text-white border-slate-700':'bg-white border-slate-200 text-slate-600'}`}>False detection</button><button disabled={reviewBusyId===event.id} onClick={()=>void reviewAi(event,'unreviewed')} className="px-2 py-1 rounded border border-slate-200 bg-white text-[9px] font-semibold text-slate-600">Reset</button><button disabled={reviewBusyId===event.id} onClick={()=>void saveAiReviewNote(event)} className="px-2 py-1 rounded border border-cyan-200 bg-white text-[9px] font-semibold text-cyan-700">Save note</button></div>
                                  <div className="text-[9px] text-slate-400">Review: {ctx.review.status}{ctx.review.reviewedBy?` • ${ctx.review.reviewedBy}`:''}{ctx.review.reviewedAt?` • ${new Date(ctx.review.reviewedAt).toLocaleString()}`:''}</div>
                                </div>
                              </div>
                              <div className="space-y-1.5">{(aiRecordings[event.id]||[]).length===0?<div className="text-[10px] text-cyan-700">No finalized recording overlaps this AI detection window yet.</div>:(aiRecordings[event.id]||[]).map((clip)=><div key={clip.id} className="flex items-center justify-between gap-2 rounded bg-white border border-cyan-100 px-2 py-1.5"><div className="text-[10px] text-slate-600">{new Date(clip.startedAt).toLocaleTimeString()}–{new Date(clip.endedAt).toLocaleTimeString()} • {(clip.sizeBytes/1024/1024).toFixed(1)} MB</div><a href={clip.mediaUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] font-semibold text-cyan-700"><PlaySquare className="w-3 h-3"/>Play</a></div>)}</div>
                            </div>;})()}
                          </div>
                        )}
                      </div>
                      {!event.acknowledgedAt && <button onClick={() => void acknowledge(event)} disabled={busyId === event.id} className="shrink-0 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">{busyId === event.id ? 'Saving…' : 'Acknowledge'}</button>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-xs text-blue-900"><span className="font-semibold">Operational events are transition-driven.</span> Repeated supervisor polls in the same state do not create duplicate rows. Account logins, user changes, and permission changes remain in the separate Audit screen.</div>
      </div>
    </div>
  );
};
