import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Laptop, RefreshCw, Search, ShieldCheck, Smartphone, XCircle } from 'lucide-react';
import { getAllSessions, revokeAdminSession } from '../../api';
import type { AuthUser, SessionInfo } from '../../types/cctv';

function clientLabel(userAgent: string | null): string {
  const ua = (userAgent || '').toLowerCase();
  if (!ua) return 'Unknown client';
  const browser = ua.includes('edg/') ? 'Edge' : ua.includes('chrome/') ? 'Chrome' : ua.includes('firefox/') ? 'Firefox' : ua.includes('safari/') ? 'Safari' : 'Browser';
  const device = ua.includes('android') ? 'Android' : /iphone|ipad/.test(ua) ? 'iOS/iPadOS' : ua.includes('windows') ? 'Windows' : ua.includes('mac os') ? 'macOS' : 'Device';
  return `${browser} • ${device}`;
}

function ClientIcon({ userAgent }: { userAgent: string | null }) {
  const mobile = /android|iphone|ipad/i.test(userAgent || '');
  return mobile ? <Smartphone className="w-4 h-4" /> : <Laptop className="w-4 h-4" />;
}

export const SessionsView: React.FC<{ currentUser: AuthUser }> = ({ currentUser }) => {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setSessions(await getAllSessions()); }
    catch (e: any) { setError(e?.message || 'Unable to load active sessions.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((session) => [session.username, session.remoteAddress, session.userAgent, session.id].some((v) => String(v || '').toLowerCase().includes(q)));
  }, [sessions, query]);

  const revoke = async (session: SessionInfo) => {
    if (session.current) return;
    setBusyId(session.id); setError('');
    try { await revokeAdminSession(session.id); await load(); }
    catch (e: any) { setError(e?.message || 'Unable to revoke session.'); }
    finally { setBusyId(''); }
  };

  return <div className="flex-1 h-full overflow-y-auto bg-[#f4f6fa] p-6"><div className="max-w-7xl mx-auto space-y-5">
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-100 flex items-center justify-center"><ShieldCheck className="w-5 h-5" /></div><div><h1 className="text-2xl font-bold text-slate-900">Active Sessions</h1><p className="text-xs text-slate-500">Persistent authenticated browser sessions. Tokens are stored only as one-way hashes.</p></div></div>
      <button onClick={()=>void load()} disabled={loading} className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-700 flex items-center gap-2 disabled:opacity-50"><RefreshCw className={`w-3.5 h-3.5 ${loading?'animate-spin':''}`} />Refresh</button>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <div className="bg-white rounded-xl border border-slate-200 p-4"><div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Active sessions</div><div className="text-2xl font-bold text-slate-900 mt-1">{sessions.length}</div></div>
      <div className="bg-white rounded-xl border border-slate-200 p-4"><div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Users represented</div><div className="text-2xl font-bold text-slate-900 mt-1">{new Set(sessions.map(s=>s.userId)).size}</div></div>
      <div className="bg-white rounded-xl border border-slate-200 p-4"><div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Current admin</div><div className="text-sm font-bold text-slate-900 mt-2">{currentUser.username}</div></div>
    </div>
    <div className="relative"><Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" /><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search username, IP, browser, or session ID…" className="w-full bg-white border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-xs" /></div>
    {error && <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 p-3 text-xs">{error}</div>}
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs"><table className="w-full text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="text-left px-4 py-3">User / Client</th><th className="text-left px-4 py-3">Address</th><th className="text-left px-4 py-3">Created</th><th className="text-left px-4 py-3">Last Seen</th><th className="text-left px-4 py-3">Expires</th><th className="text-right px-4 py-3">Action</th></tr></thead><tbody className="divide-y divide-slate-100">
      {loading ? <tr><td colSpan={6} className="p-8 text-center text-slate-400">Loading active sessions…</td></tr> : filtered.length===0 ? <tr><td colSpan={6} className="p-8 text-center text-slate-400">No matching active sessions.</td></tr> : filtered.map(session=><tr key={session.id} className={session.current?'bg-blue-50/40':''}><td className="px-4 py-3"><div className="flex gap-2 items-center"><div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center"><ClientIcon userAgent={session.userAgent} /></div><div><div className="font-bold text-slate-900">{session.username || session.userId}{session.current&&<span className="ml-2 text-[10px] text-blue-600">CURRENT</span>}</div><div className="text-[10px] text-slate-400">{clientLabel(session.userAgent)} • {session.id}</div></div></div></td><td className="px-4 py-3 font-mono text-slate-600">{session.remoteAddress || 'Unknown'}</td><td className="px-4 py-3 text-slate-500 whitespace-nowrap">{new Date(session.createdAt).toLocaleString()}</td><td className="px-4 py-3 text-slate-500 whitespace-nowrap">{new Date(session.lastSeenAt).toLocaleString()}</td><td className="px-4 py-3 text-slate-500 whitespace-nowrap">{new Date(session.expiresAt).toLocaleString()}</td><td className="px-4 py-3 text-right">{session.current?<span className="text-[11px] text-blue-600 font-semibold">Use Sign out</span>:<button disabled={busyId===session.id} onClick={()=>void revoke(session)} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 font-semibold disabled:opacity-50"><XCircle className="w-3.5 h-3.5" />Revoke</button>}</td></tr>)}
    </tbody></table></div>
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-xs text-blue-900"><strong>Security behavior:</strong> revoking a session prevents its next API request immediately. Role, password, camera-access, and AI-access changes also advance the user's security version so newly presented media tokens from the previous security state are rejected.</div>
  </div></div>;
};
