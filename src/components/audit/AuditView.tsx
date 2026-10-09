import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FileClock, RefreshCw, Search, ShieldAlert } from 'lucide-react';
import { getAuditLog } from '../../api';
import type { AuditEntry } from '../../types/cctv';

type AuditGroup = 'all' | 'auth.' | 'session.' | 'user.' | 'camera' | 'account.';

const groupLabel: Record<AuditGroup, string> = {
  all: 'All activity',
  'auth.': 'Authentication',
  'session.': 'Sessions',
  'user.': 'Users & access',
  camera: 'Cameras',
  'account.': 'My account',
};

export const AuditView: React.FC = () => {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<AuditGroup>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const actionPrefix = group === 'all' || group === 'camera' ? undefined : group;
      const resourceType = group === 'camera' ? 'camera' : undefined;
      setEntries(await getAuditLog({ limit: 500, actionPrefix, resourceType, query: query.trim() || undefined }));
    } catch (e: any) { setError(e?.message || 'Unable to load audit history.'); }
    finally { setLoading(false); }
  }, [group, query]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 180); return () => window.clearTimeout(timer); }, [load]);
  const failed = useMemo(() => entries.filter(e => /failed|rate_limited/i.test(e.action)).length, [entries]);

  return <div className="flex-1 h-full overflow-y-auto bg-[#f4f6fa] p-6"><div className="max-w-7xl mx-auto space-y-5">
    <div className="flex items-center justify-between gap-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-100 flex items-center justify-center"><FileClock className="w-5 h-5" /></div><div><h1 className="text-2xl font-bold text-slate-900">Audit & Logs</h1><p className="text-xs text-slate-500">Security-relevant account, access, session, camera, and sign-in actions. Operational events remain separate.</p></div></div><button onClick={()=>void load()} disabled={loading} className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-xs font-semibold flex items-center gap-2 disabled:opacity-50"><RefreshCw className={`w-3.5 h-3.5 ${loading?'animate-spin':''}`} />Refresh</button></div>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3"><div className="bg-white border border-slate-200 rounded-xl p-4"><div className="text-[10px] uppercase tracking-wide text-slate-400 font-bold">Loaded records</div><div className="text-2xl font-bold text-slate-900 mt-1">{entries.length}</div></div><div className="bg-white border border-slate-200 rounded-xl p-4"><div className="text-[10px] uppercase tracking-wide text-slate-400 font-bold">Failed / rate-limited</div><div className={`text-2xl font-bold mt-1 ${failed?'text-amber-700':'text-slate-900'}`}>{failed}</div></div><div className="bg-white border border-slate-200 rounded-xl p-4"><div className="text-[10px] uppercase tracking-wide text-slate-400 font-bold">Retention</div><div className="text-sm font-bold text-slate-900 mt-2">Latest 5,000 records</div></div></div>
    <div className="flex gap-3 flex-wrap"><div className="relative flex-1 min-w-[280px]"><Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" /><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search user, action, resource, IP, or session…" className="w-full bg-white border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-xs" /></div><select value={group} onChange={e=>setGroup(e.target.value as AuditGroup)} className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-semibold text-slate-700">{(Object.keys(groupLabel) as AuditGroup[]).map(key=><option key={key} value={key}>{groupLabel[key]}</option>)}</select></div>
    {error && <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 p-3 text-xs">{error}</div>}
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900 flex items-start gap-2"><ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" /><span>Audit details are sanitized before persistence. Passwords, tokens, cookies, authorization headers, API keys, and credential-like fields are automatically redacted.</span></div>
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs"><table className="w-full text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="text-left px-4 py-3">Time</th><th className="text-left px-4 py-3">User</th><th className="text-left px-4 py-3">Action</th><th className="text-left px-4 py-3">Resource</th><th className="text-left px-4 py-3">Context</th></tr></thead><tbody className="divide-y divide-slate-100">{loading ? <tr><td colSpan={5} className="p-8 text-center text-slate-400">Loading audit history…</td></tr> : entries.length===0 ? <tr><td colSpan={5} className="p-8 text-center text-slate-400">No matching audit entries.</td></tr> : entries.map(e=><tr key={e.id}><td className="px-4 py-3 whitespace-nowrap text-slate-500">{new Date(e.created_at).toLocaleString()}</td><td className="px-4 py-3"><div className="font-semibold text-slate-800">{e.username || 'System/unknown'}</div><div className="text-[10px] text-slate-400">{e.user_id || '—'}</div></td><td className="px-4 py-3"><span className={`px-2 py-1 rounded-md font-mono ${/failed|rate_limited/i.test(e.action)?'bg-amber-50 text-amber-800':'bg-indigo-50 text-indigo-700'}`}>{e.action}</span></td><td className="px-4 py-3 text-slate-600">{e.resource_type}{e.resource_id ? ` • ${e.resource_id}` : ''}</td><td className="px-4 py-3 text-slate-500 max-w-lg"><div className="truncate" title={e.details ? JSON.stringify(e.details) : ''}>{e.details ? JSON.stringify(e.details) : '—'}</div></td></tr>)}</tbody></table></div>
  </div></div>;
};
