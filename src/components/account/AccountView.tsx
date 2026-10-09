import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, KeyRound, Laptop, RefreshCw, ShieldCheck, Smartphone, UserRound, XCircle } from 'lucide-react';
import type { AuthUser, Camera, SessionInfo } from '../../types/cctv';
import { changeMyPassword, getMySessions, revokeMySession, revokeOtherSessions } from '../../api';

function sessionClient(session: SessionInfo): string {
  const ua = (session.userAgent || '').toLowerCase();
  const browser = ua.includes('edg/') ? 'Edge' : ua.includes('chrome/') ? 'Chrome' : ua.includes('firefox/') ? 'Firefox' : ua.includes('safari/') ? 'Safari' : 'Browser';
  const device = ua.includes('android') ? 'Android' : /iphone|ipad/.test(ua) ? 'iOS/iPadOS' : ua.includes('windows') ? 'Windows' : ua.includes('mac os') ? 'macOS' : 'Device';
  return `${browser} • ${device}`;
}

export const AccountView: React.FC<{ user: AuthUser; cameras: Camera[]; onUserUpdated: (user: AuthUser) => void }> = ({ user, cameras, onUserUpdated }) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionBusy, setSessionBusy] = useState('');
  const liveCount = useMemo(() => user.cameraAccess === 'all' ? cameras.length : user.cameraAccess.length, [user.cameraAccess, cameras.length]);
  const recordingCount = useMemo(() => user.recordingAccess === 'all' ? cameras.length : user.recordingAccess.length, [user.recordingAccess, cameras.length]);

  const loadSessions = useCallback(async () => {
    try { setSessions(await getMySessions()); }
    catch (e: any) { setError(e?.message || 'Unable to load active sessions.'); }
  }, []);
  useEffect(() => { void loadSessions(); }, [loadSessions]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setMessage('');
    if (newPassword !== confirmPassword) { setError('New passwords do not match.'); return; }
    setSaving(true);
    try {
      const result = await changeMyPassword(currentPassword, newPassword);
      onUserUpdated(result.user); setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); setMessage('Password changed. Other sessions were revoked and this browser received a new session.');
      await loadSessions();
    } catch (err: any) { setError(err?.message || 'Unable to change password.'); }
    finally { setSaving(false); }
  };

  const revoke = async (session: SessionInfo) => {
    if (session.current) return;
    setSessionBusy(session.id); setError('');
    try { await revokeMySession(session.id); setMessage('Session revoked.'); await loadSessions(); }
    catch (e: any) { setError(e?.message || 'Unable to revoke session.'); }
    finally { setSessionBusy(''); }
  };

  const revokeOthers = async () => {
    setSessionBusy('all'); setError('');
    try { const result = await revokeOtherSessions(); setMessage(`${result.revoked} other session${result.revoked===1?'':'s'} revoked.`); await loadSessions(); }
    catch (e: any) { setError(e?.message || 'Unable to revoke other sessions.'); }
    finally { setSessionBusy(''); }
  };

  return <div className="flex-1 h-full overflow-y-auto bg-[#f4f6fa] p-3 sm:p-6"><div className="max-w-5xl mx-auto space-y-5">
    <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center"><UserRound className="w-5 h-5" /></div><div><h1 className="text-xl sm:text-2xl font-bold text-slate-900">My Account</h1><p className="text-xs text-slate-500">Account identity, assigned access, password security, and active sessions.</p></div></div>
    {error && <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 p-3 text-xs">{error}</div>}
    {message && <div className="rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 p-3 text-xs flex items-center gap-2"><Check className="w-4 h-4" />{message}</div>}
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="md:col-span-2 bg-white border border-slate-200 rounded-xl p-5 shadow-xs"><div className="flex items-center gap-3"><div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center"><ShieldCheck className="w-6 h-6 text-blue-600" /></div><div><div className="text-lg font-bold text-slate-900">{user.username}</div><div className="text-xs text-slate-500">{user.role} • {user.status} • AI {user.aiEnabled ? 'Enabled' : 'Disabled'}</div></div></div><div className="mt-5 grid grid-cols-2 gap-3"><div className="rounded-lg bg-slate-50 border border-slate-100 p-3"><div className="text-[11px] uppercase tracking-wide text-slate-400">Live cameras</div><div className="text-2xl font-bold text-slate-800 mt-1">{liveCount}</div></div><div className="rounded-lg bg-slate-50 border border-slate-100 p-3"><div className="text-[11px] uppercase tracking-wide text-slate-400">Recording access</div><div className="text-2xl font-bold text-slate-800 mt-1">{recordingCount}</div></div></div></div>
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs"><div className="text-xs font-semibold text-slate-700">Last sign-in</div><div className="text-sm text-slate-900 mt-2">{user.last_login ? new Date(user.last_login).toLocaleString() : 'Current/first session'}</div><div className="text-xs font-semibold text-slate-700 mt-4">Password last changed</div><div className="text-sm text-slate-900 mt-2">{user.password_changed_at ? new Date(user.password_changed_at).toLocaleString() : 'Before P0.12 tracking'}</div></div>
    </div>
    <form onSubmit={submit} className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4"><div className="flex items-center gap-2"><KeyRound className="w-4 h-4 text-blue-600" /><div><h2 className="font-bold text-slate-900">Change password</h2><p className="text-[11px] text-slate-500">New passwords must contain 5–8 characters. Changing it revokes every existing session and issues this browser a new one.</p></div></div><div className="grid grid-cols-1 md:grid-cols-3 gap-3"><label className="text-xs font-semibold text-slate-700">Current password<input type="password" required value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 font-normal" /></label><label className="text-xs font-semibold text-slate-700">New password<input type="password" minLength={5} maxLength={8} required value={newPassword} onChange={e=>setNewPassword(e.target.value)} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 font-normal" /></label><label className="text-xs font-semibold text-slate-700">Confirm new password<input type="password" minLength={5} maxLength={8} required value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 font-normal" /></label></div><div className="flex justify-end"><button disabled={saving} className="px-4 py-2 rounded-lg bg-blue-600 disabled:opacity-60 text-white text-xs font-semibold">{saving ? 'Saving…' : 'Change Password'}</button></div></form>
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs"><div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3"><div><h2 className="font-bold text-slate-900">Active Sessions</h2><p className="text-[11px] text-slate-500">Sessions persist across CCTV Monitor restarts until they expire or are revoked.</p></div><div className="flex flex-wrap gap-2 w-full sm:w-auto"><button onClick={()=>void loadSessions()} className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-semibold flex items-center gap-2"><RefreshCw className="w-3.5 h-3.5" />Refresh</button><button disabled={sessionBusy==='all'||sessions.filter(s=>!s.current).length===0} onClick={()=>void revokeOthers()} className="px-3 py-2 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-xs font-semibold disabled:opacity-50">Sign out other sessions</button></div></div><div className="divide-y divide-slate-100">{sessions.length===0?<div className="p-6 text-center text-xs text-slate-400">No active sessions reported.</div>:sessions.map(session=><div key={session.id} className={`p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${session.current?'bg-blue-50/30':''}`}><div className="flex items-center gap-3 min-w-0"><div className="w-9 h-9 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center">{/android|iphone|ipad/i.test(session.userAgent||'')?<Smartphone className="w-4 h-4"/>:<Laptop className="w-4 h-4"/>}</div><div className="min-w-0"><div className="text-xs font-bold text-slate-900">{sessionClient(session)}{session.current&&<span className="ml-2 text-[10px] text-blue-600">CURRENT</span>}</div><div className="text-[10px] text-slate-500 truncate">{session.remoteAddress||'Unknown address'} • last seen {new Date(session.lastSeenAt).toLocaleString()}</div><div className="text-[10px] text-slate-400 truncate">{session.id}</div></div></div>{!session.current&&<button disabled={sessionBusy===session.id} onClick={()=>void revoke(session)} className="shrink-0 px-2.5 py-1.5 rounded-lg border border-rose-200 text-rose-700 bg-rose-50 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"><XCircle className="w-3.5 h-3.5" />Revoke</button>}</div>)}</div></div>
  </div></div>;
};
