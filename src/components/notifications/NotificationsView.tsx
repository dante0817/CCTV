import React, { useEffect, useMemo, useState } from 'react';
import { Bell, BellRing, CheckCheck, Mail, Plus, RefreshCw, RotateCcw, Save, Send, ShieldAlert, Trash2 } from 'lucide-react';
import type { AlertNotification, Camera, EventSeverity, MotionZone, NotificationDelivery, NotificationEmailSettings, NotificationRule } from '../../types/cctv';
import {
  createNotificationRule, deleteNotificationRule, getMotionZones, getNotificationDeliveries, getNotificationEmailSettings,
  getNotificationRules, getNotifications, markAllNotificationsRead, markNotificationRead, retryNotificationDelivery,
  testNotificationEmail, updateNotificationEmailSettings, updateNotificationRule,
} from '../../api';

interface Props { cameras: Camera[]; }
const EVENT_TYPES = [
  ['*', 'Any event'], ['MOTION_DETECTED', 'Motion detected'], ['PERSON_DETECTED', 'Person detected'], ['VEHICLE_DETECTED', 'Vehicle detected'], ['CAMERA_OFFLINE', 'Camera offline'], ['CAMERA_ERROR', 'Camera error'],
  ['CAMERA_RECOVERED', 'Camera recovered'], ['MEDIAMTX_OFFLINE', 'Media server offline'], ['STORAGE_WARNING', 'Storage warning'],
  ['RECORDING_ERROR', 'Recording interrupted'],
] as const;

const defaultSmtp: NotificationEmailSettings = {
  enabled: false, host: '', port: 587, secureMode: 'starttls', username: '', passwordConfigured: false,
  fromAddress: '', recipients: [], baseUrl: '', updatedAt: '',
};

function severityClass(severity: EventSeverity) {
  return severity === 'critical' ? 'bg-rose-50 text-rose-700 border-rose-200' : severity === 'warning' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-blue-50 text-blue-700 border-blue-200';
}
function deliveryClass(status: NotificationDelivery['status']) {
  if (status === 'sent') return 'bg-emerald-50 text-emerald-700';
  if (status === 'failed') return 'bg-rose-50 text-rose-700';
  if (status === 'retrying') return 'bg-amber-50 text-amber-700';
  return 'bg-blue-50 text-blue-700';
}

export const NotificationsView: React.FC<Props> = ({ cameras }) => {
  const [items, setItems] = useState<AlertNotification[]>([]);
  const [rules, setRules] = useState<NotificationRule[]>([]);
  const [deliveries, setDeliveries] = useState<NotificationDelivery[]>([]);
  const [smtp, setSmtp] = useState<NotificationEmailSettings>(defaultSmtp);
  const [smtpPassword, setSmtpPassword] = useState('');
  const [recipientText, setRecipientText] = useState('');
  const [zonesByCamera, setZonesByCamera] = useState<Record<string, MotionZone[]>>({});
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [draft, setDraft] = useState<Partial<NotificationRule>>({ name: 'Motion alert', enabled: true, eventType: 'MOTION_DETECTED', minimumSeverity: 'info', cameraId: null, zoneId: null, cooldownSeconds: 20, desktopEnabled: true, emailEnabled: false });

  const refresh = async () => {
    setBusy(true); setError('');
    try {
      const [inbox, ruleRows, smtpSettings, deliveryRows] = await Promise.all([
        getNotifications({ limit: 300, unreadOnly }), getNotificationRules(), getNotificationEmailSettings(), getNotificationDeliveries(150),
      ]);
      setItems(inbox.notifications); setRules(ruleRows); setSmtp(smtpSettings); setRecipientText(smtpSettings.recipients.join(', ')); setDeliveries(deliveryRows);
    } catch (e: any) { setError(e?.message || 'Unable to load notifications.'); }
    finally { setBusy(false); }
  };
  useEffect(() => { void refresh(); }, [unreadOnly]);

  const unread = items.filter((item) => !item.readAt).length;
  const cameraMap = useMemo(() => new Map(cameras.map((c) => [c.id, c])), [cameras]);

  const ensureZones = async (cameraId: string | null | undefined) => {
    if (!cameraId || zonesByCamera[cameraId]) return;
    try {
      const zones = await getMotionZones(cameraId);
      setZonesByCamera((current) => ({ ...current, [cameraId]: zones }));
    } catch {}
  };

  const saveRule = async (rule: NotificationRule, patch: Partial<NotificationRule>) => {
    setError('');
    try { const next = await updateNotificationRule(rule.id, patch); setRules((rows) => rows.map((row) => row.id === next.id ? next : row)); }
    catch (e: any) { setError(e?.message || 'Unable to update alert rule.'); }
  };

  const addRule = async () => {
    setError('');
    try {
      const row = await createNotificationRule(draft);
      setRules((current) => [...current, row]);
      setDraft({ name: 'Motion alert', enabled: true, eventType: 'MOTION_DETECTED', minimumSeverity: 'info', cameraId: null, zoneId: null, cooldownSeconds: 20, desktopEnabled: true, emailEnabled: false });
    } catch (e: any) { setError(e?.message || 'Unable to create alert rule.'); }
  };

  const requestDesktopPermission = async () => {
    if (!('Notification' in window)) return setError('This browser does not support desktop notifications.');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') setError('Desktop notifications were not allowed by the browser. In-app alerts still work.');
  };

  const saveSmtp = async () => {
    setBusy(true); setError(''); setSuccess('');
    try {
      const next = await updateNotificationEmailSettings({ ...smtp, password: smtpPassword || undefined, recipients: recipientText.split(/[;,\n]/).map((x) => x.trim()).filter(Boolean) });
      setSmtp(next); setRecipientText(next.recipients.join(', ')); setSmtpPassword(''); setSuccess('Email delivery settings saved.');
    } catch (e: any) { setError(e?.message || 'Unable to save SMTP settings.'); }
    finally { setBusy(false); }
  };

  const sendTest = async () => {
    setBusy(true); setError(''); setSuccess('');
    try { await testNotificationEmail(); setSuccess('Test email accepted by the SMTP server.'); }
    catch (e: any) { setError(e?.message || 'SMTP test failed.'); }
    finally { setBusy(false); }
  };

  return <div className="flex-1 overflow-y-auto bg-[#f5f7fb]">
    <div className="max-w-[1600px] mx-auto p-6 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div><div className="flex items-center gap-2"><BellRing className="w-5 h-5 text-blue-600"/><h1 className="text-xl font-bold text-slate-900">Notifications & Alert Rules</h1></div><p className="text-xs text-slate-500 mt-1">In-app alerts are immediate. Desktop and queued email delivery are optional channels and never block camera operation.</p></div>
        <div className="flex gap-2"><button onClick={requestDesktopPermission} className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700"><Bell className="w-3.5 h-3.5 inline mr-1"/>Desktop permission</button><button onClick={()=>void refresh()} disabled={busy} className="px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold disabled:opacity-50"><RefreshCw className={`w-3.5 h-3.5 inline mr-1 ${busy?'animate-spin':''}`}/>Refresh</button></div>
      </div>
      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}
      {success && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{success}</div>}

      <div className="grid xl:grid-cols-[1.08fr_0.92fr] gap-5">
        <section className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between"><div><div className="font-semibold text-sm text-slate-900">Alert inbox</div><div className="text-[11px] text-slate-400">{unread} unread in the current view</div></div><div className="flex gap-2"><label className="text-[11px] text-slate-600 flex items-center gap-2"><input type="checkbox" checked={unreadOnly} onChange={(e)=>setUnreadOnly(e.target.checked)}/>Unread only</label><button onClick={async()=>{await markAllNotificationsRead();await refresh();}} className="px-2.5 py-1.5 rounded border border-slate-200 text-[10px] font-semibold text-slate-600"><CheckCheck className="w-3 h-3 inline mr-1"/>Read all</button></div></div>
          <div className="divide-y divide-slate-100 max-h-[720px] overflow-y-auto">
            {items.length===0?<div className="py-16 text-center text-xs text-slate-400">No notifications match this view.</div>:items.map((item)=><button key={item.id} onClick={async()=>{if(!item.readAt){const row=await markNotificationRead(item.id);setItems((current)=>current.map((x)=>x.id===row.id?row:x));}}} className={`w-full text-left p-4 hover:bg-slate-50 ${item.readAt?'opacity-65':''}`}>
              <div className="flex items-start gap-3"><span className={`mt-0.5 px-2 py-0.5 rounded-full border text-[9px] uppercase font-bold ${severityClass(item.severity)}`}>{item.severity}</span><div className="min-w-0 flex-1"><div className="text-sm font-semibold text-slate-900">{item.title}</div><div className="text-xs text-slate-600 mt-1">{item.message}</div><div className="mt-2 text-[10px] text-slate-400 flex gap-3 flex-wrap"><span>{new Date(item.createdAt).toLocaleString()}</span>{item.cameraName&&<span>{item.cameraName}</span>}{item.zoneName&&<span>Zone: {item.zoneName}</span>}<span>{item.eventType}</span>{item.readAt?<span className="text-emerald-600">Read</span>:<span className="text-blue-600 font-semibold">Unread</span>}</div></div></div>
            </button>)}
          </div>
        </section>

        <section className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
            <div className="font-semibold text-sm text-slate-900 flex items-center gap-2"><Plus className="w-4 h-4 text-blue-600"/>Create alert rule</div>
            <input value={draft.name||''} onChange={(e)=>setDraft({...draft,name:e.target.value})} maxLength={80} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs" placeholder="Rule name"/>
            <div className="grid grid-cols-2 gap-2"><select value={draft.eventType||'*'} onChange={(e)=>setDraft({...draft,eventType:e.target.value,zoneId:null})} className="px-2 py-2 border border-slate-200 rounded-lg text-xs">{EVENT_TYPES.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select><select value={draft.minimumSeverity||'warning'} onChange={(e)=>setDraft({...draft,minimumSeverity:e.target.value as EventSeverity})} className="px-2 py-2 border border-slate-200 rounded-lg text-xs"><option value="info">Info+</option><option value="warning">Warning+</option><option value="critical">Critical only</option></select></div>
            <select value={draft.cameraId||''} onChange={(e)=>{const cameraId=e.target.value||null;setDraft({...draft,cameraId,zoneId:null});void ensureZones(cameraId);}} className="w-full px-2 py-2 border border-slate-200 rounded-lg text-xs"><option value="">All cameras</option>{cameras.map((c)=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
            {draft.eventType==='MOTION_DETECTED'&&draft.cameraId&&<select value={draft.zoneId||''} onFocus={()=>void ensureZones(draft.cameraId)} onChange={(e)=>setDraft({...draft,zoneId:e.target.value?Number(e.target.value):null})} className="w-full px-2 py-2 border border-slate-200 rounded-lg text-xs"><option value="">Any zone / whole frame</option>{(zonesByCamera[draft.cameraId]||[]).map((z)=><option key={z.id} value={z.id}>{z.name}</option>)}</select>}
            <label className="text-[10px] text-slate-500">Cooldown seconds<input type="number" min={0} max={3600} value={draft.cooldownSeconds??60} onChange={(e)=>setDraft({...draft,cooldownSeconds:Number(e.target.value)})} className="mt-1 w-full px-2 py-2 border border-slate-200 rounded-lg text-xs"/></label>
            <div className="flex gap-4 text-xs text-slate-700"><label><input type="checkbox" checked={draft.desktopEnabled!==false} onChange={(e)=>setDraft({...draft,desktopEnabled:e.target.checked})}/> Desktop</label><label><input type="checkbox" checked={draft.emailEnabled===true} onChange={(e)=>setDraft({...draft,emailEnabled:e.target.checked})}/> Email</label></div>
            <button onClick={()=>void addRule()} className="w-full px-3 py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold">Add rule</button>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-100"><div className="font-semibold text-sm text-slate-900">Rules</div><div className="text-[11px] text-slate-400">Email-enabled rules enqueue delivery after the in-app notification is created.</div></div>
            <div className="divide-y divide-slate-100 max-h-[420px] overflow-y-auto">{rules.map((rule)=><div key={rule.id} className="p-3 space-y-2">
              <div className="flex items-start justify-between gap-2"><div><div className="text-xs font-semibold text-slate-800">{rule.name}</div><div className="text-[10px] text-slate-400">{rule.eventType==='*'?'Any event':rule.eventType} • {rule.minimumSeverity}+ • cooldown {rule.cooldownSeconds}s{rule.cameraId?` • ${cameraMap.get(rule.cameraId)?.name||rule.cameraId}`:''}</div></div><div className="flex gap-1"><button onClick={()=>void saveRule(rule,{enabled:!rule.enabled})} className={`px-2 py-1 rounded border text-[9px] font-semibold ${rule.enabled?'bg-emerald-50 text-emerald-700 border-emerald-200':'bg-slate-50 text-slate-500 border-slate-200'}`}>{rule.enabled?'Enabled':'Disabled'}</button><button onClick={async()=>{if(confirm(`Delete alert rule “${rule.name}”?`)){await deleteNotificationRule(rule.id);setRules((r)=>r.filter((x)=>x.id!==rule.id));}}} className="p-1.5 rounded border border-rose-100 text-rose-500"><Trash2 className="w-3 h-3"/></button></div></div>
              <div className="grid grid-cols-3 gap-1.5"><select value={rule.eventType} onChange={(e)=>void saveRule(rule,{eventType:e.target.value,zoneId:e.target.value==='MOTION_DETECTED'?rule.zoneId:null})} className="px-1.5 py-1.5 rounded border border-slate-200 text-[9px] bg-white">{EVENT_TYPES.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select><select value={rule.minimumSeverity} onChange={(e)=>void saveRule(rule,{minimumSeverity:e.target.value as EventSeverity})} className="px-1.5 py-1.5 rounded border border-slate-200 text-[9px] bg-white"><option value="info">Info+</option><option value="warning">Warning+</option><option value="critical">Critical only</option></select><input type="number" min={0} max={3600} defaultValue={rule.cooldownSeconds} onBlur={(e)=>void saveRule(rule,{cooldownSeconds:Number(e.target.value)})} title="Cooldown seconds" className="px-1.5 py-1.5 rounded border border-slate-200 text-[9px]"/></div>
              <div className="flex items-center gap-4 text-[10px] text-slate-500"><label><input type="checkbox" checked={rule.desktopEnabled} onChange={(e)=>void saveRule(rule,{desktopEnabled:e.target.checked})}/> Desktop</label><label><input type="checkbox" checked={rule.emailEnabled} onChange={(e)=>void saveRule(rule,{emailEnabled:e.target.checked})}/> Email</label></div>
            </div>)}</div>
          </div>
        </section>
      </div>

      <div className="grid xl:grid-cols-[0.9fr_1.1fr] gap-5">
        <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
          <div className="flex items-center justify-between"><div><div className="font-semibold text-sm text-slate-900 flex items-center gap-2"><Mail className="w-4 h-4 text-blue-600"/>Email delivery</div><div className="text-[11px] text-slate-400">SMTP credentials are encrypted locally. Blank password keeps the saved password.</div></div><label className="text-xs"><input type="checkbox" checked={smtp.enabled} onChange={(e)=>setSmtp({...smtp,enabled:e.target.checked})}/> Enabled</label></div>
          <div className="grid md:grid-cols-[1fr_110px_130px] gap-2"><input value={smtp.host} onChange={(e)=>setSmtp({...smtp,host:e.target.value})} className="px-3 py-2 border border-slate-200 rounded-lg text-xs" placeholder="smtp.example.com"/><input type="number" value={smtp.port} onChange={(e)=>setSmtp({...smtp,port:Number(e.target.value)})} className="px-3 py-2 border border-slate-200 rounded-lg text-xs"/><select value={smtp.secureMode} onChange={(e)=>setSmtp({...smtp,secureMode:e.target.value as NotificationEmailSettings['secureMode']})} className="px-2 py-2 border border-slate-200 rounded-lg text-xs"><option value="starttls">STARTTLS</option><option value="tls">Direct TLS</option><option value="none">Plain</option></select></div>
          <div className="grid md:grid-cols-2 gap-2"><input value={smtp.username} onChange={(e)=>setSmtp({...smtp,username:e.target.value})} className="px-3 py-2 border border-slate-200 rounded-lg text-xs" placeholder="SMTP username"/><input type="password" value={smtpPassword} onChange={(e)=>setSmtpPassword(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-lg text-xs" placeholder={smtp.passwordConfigured?'Password saved — leave blank to keep':'SMTP password'}/></div>
          <input value={smtp.fromAddress} onChange={(e)=>setSmtp({...smtp,fromAddress:e.target.value})} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs" placeholder="alerts@example.com"/>
          <textarea value={recipientText} onChange={(e)=>setRecipientText(e.target.value)} rows={2} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs" placeholder="recipient@example.com, another@example.com"/>
          <input value={smtp.baseUrl} onChange={(e)=>setSmtp({...smtp,baseUrl:e.target.value})} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs" placeholder="Optional CCTV link, e.g. https://your-host.ts.net"/>
          <div className="flex gap-2"><button onClick={()=>void saveSmtp()} disabled={busy} className="px-3 py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold"><Save className="w-3.5 h-3.5 inline mr-1"/>Save email settings</button><button onClick={()=>void sendTest()} disabled={busy} className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700"><Send className="w-3.5 h-3.5 inline mr-1"/>Send test</button></div>
        </section>

        <section className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between"><div><div className="font-semibold text-sm text-slate-900">Email delivery history</div><div className="text-[11px] text-slate-400">SMTP failures retry automatically at 1m, 5m, 15m, then 1h; five failed attempts become terminal.</div></div></div>
          <div className="divide-y divide-slate-100 max-h-[360px] overflow-y-auto">{deliveries.length===0?<div className="py-12 text-center text-xs text-slate-400">No queued email deliveries yet.</div>:deliveries.map((d)=><div key={d.id} className="p-3 flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2"><span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${deliveryClass(d.status)}`}>{d.status}</span><span className="text-xs font-semibold text-slate-700">{d.title || `Notification #${d.notificationId}`}</span></div><div className="text-[10px] text-slate-400 mt-1">{d.cameraName ? `${d.cameraName} • ` : ""}Attempts {d.attempts} • created {new Date(d.createdAt).toLocaleString()}{d.sentAt?` • sent ${new Date(d.sentAt).toLocaleString()}`:''}</div>{d.lastError&&<div className="text-[10px] text-rose-600 mt-1 break-words">{d.lastError}</div>}</div>{(d.status==='failed'||d.status==='retrying')&&<button onClick={async()=>{const next=await retryNotificationDelivery(d.id);setDeliveries((rows)=>rows.map((x)=>x.id===next.id?next:x));}} className="px-2 py-1 rounded border border-slate-200 text-[9px] text-slate-600"><RotateCcw className="w-3 h-3 inline mr-1"/>Retry</button>}</div>)}</div>
        </section>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900 flex gap-2"><ShieldAlert className="w-4 h-4 shrink-0 mt-0.5"/><span>Email delivery is isolated from camera/runtime work. P0.16.1 does not include SMS, generic webhooks, or cloud push. Do not expose a plaintext SMTP service outside your trusted network.</span></div>
    </div>
  </div>;
};
