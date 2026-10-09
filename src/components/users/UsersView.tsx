import React, { useCallback, useEffect, useState } from 'react';
import { Bot, Check, KeyRound, LogOut, Plus, RefreshCw, Shield, UserRound, X } from 'lucide-react';
import { createUser, getUsers, revokeAllUserSessions, updateUser } from '../../api';
import type { AuthUser, UserRole } from '../../types/cctv';

const roles: UserRole[] = ['Admin', 'Viewer'];

export const UsersView: React.FC<{ currentUser: AuthUser; onOpenCameraAccess?: () => void }> = ({ currentUser, onOpenCameraAccess }) => {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('Viewer');
  const [aiEnabled, setAiEnabled] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const load = useCallback(async () => { setLoading(true); setError(''); try { setUsers(await getUsers()); } catch (e: any) { setError(e?.message || 'Unable to load users.'); } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); }, [load]);
  const showToast = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 2500); };

  const add = async (e: React.FormEvent) => {
    e.preventDefault(); setError('');
    try {
      await createUser({ username, password, role, cameraAccess: role === 'Admin' ? 'all' : [], recordingAccess: role === 'Admin' ? 'all' : [], aiEnabled: role === 'Admin' ? true : aiEnabled });
      setUsername(''); setPassword(''); setRole('Viewer'); setAiEnabled(false); setAdding(false); showToast('User created.'); await load();
    } catch (e: any) { setError(e?.message || 'Unable to create user.'); }
  };

  const patch = async (id: string, payload: any) => {
    setError('');
    try { await updateUser(id, payload); showToast('User updated.'); await load(); }
    catch (e: any) { setError(e?.message || 'Unable to update user.'); }
  };

  return <div className="flex-1 h-full overflow-y-auto bg-[#f4f6fa] p-6">
    {toast && <div className="fixed bottom-8 right-8 z-50 rounded-xl bg-slate-900 text-white px-4 py-3 text-xs shadow-xl flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" />{toast}</div>}
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center"><Shield className="w-5 h-5" /></div><div><h1 className="text-2xl font-bold text-slate-900">Users</h1><p className="text-xs text-slate-500">Create accounts, choose Admin or Viewer, and disable access without deleting history.</p></div></div>
        <div className="flex gap-2"><button onClick={() => void load()} className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 flex items-center gap-2"><RefreshCw className="w-3.5 h-3.5" />Refresh</button>{onOpenCameraAccess && <button onClick={onOpenCameraAccess} className="px-3 py-2 rounded-lg border border-indigo-200 bg-indigo-50 text-xs font-semibold text-indigo-700">Camera Access</button>}<button onClick={() => setAdding(true)} className="px-3 py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold flex items-center gap-2"><Plus className="w-3.5 h-3.5" />Add User</button></div>
      </div>
      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-700 p-3 text-xs">{error}</div>}
      {adding && <form onSubmit={add} className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4"><div className="flex justify-between"><div><h2 className="font-bold text-slate-900">Create account</h2><p className="text-xs text-slate-500">New Viewer accounts start with no camera access. Assign cameras separately after creation.</p></div><button type="button" onClick={() => setAdding(false)}><X className="w-4 h-4 text-slate-500" /></button></div><div className="grid grid-cols-1 md:grid-cols-3 gap-4"><label className="text-xs font-semibold text-slate-700">Username<input value={username} onChange={e=>setUsername(e.target.value)} required minLength={3} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 font-normal" /></label><label className="text-xs font-semibold text-slate-700">Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={5} maxLength={8} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 font-normal" /></label><label className="text-xs font-semibold text-slate-700">Role<select value={role} onChange={e=>{const next=e.target.value as UserRole;setRole(next);if(next==='Admin')setAiEnabled(true);}} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 font-normal">{roles.map(r=><option key={r}>{r}</option>)}</select></label><label className="text-xs font-semibold text-slate-700 flex items-end"><span className="w-full border border-slate-200 rounded-lg px-3 py-2 flex items-center gap-2 font-normal"><input type="checkbox" checked={aiEnabled} onChange={e=>setAiEnabled(e.target.checked)} />AI access</span></label></div><div className="flex justify-end"><button className="px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold">Create User</button></div></form>}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs"><table className="w-full text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="text-left px-4 py-3">User</th><th className="text-left px-4 py-3">Role</th><th className="text-left px-4 py-3">Camera Access</th><th className="text-left px-4 py-3">Status</th><th className="text-left px-4 py-3">AI</th><th className="text-left px-4 py-3">Last Login</th><th className="text-right px-4 py-3">Actions</th></tr></thead><tbody className="divide-y divide-slate-100">{loading?<tr><td colSpan={7} className="p-8 text-center text-slate-400">Loading users…</td></tr>:users.map(user=><tr key={user.id} className="text-slate-700"><td className="px-4 py-3"><div className="flex items-center gap-2"><div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center"><UserRound className="w-4 h-4 text-slate-500" /></div><div><div className="font-bold text-slate-900">{user.username}{user.id===currentUser.id&&<span className="ml-2 text-[10px] text-blue-600">YOU</span>}</div><div className="text-[10px] text-slate-400">{user.id}</div></div></div></td><td className="px-4 py-3"><select value={user.role} disabled={user.id===currentUser.id} onChange={e=>void patch(user.id,{role:e.target.value})} className="border border-slate-200 rounded-md px-2 py-1.5 disabled:bg-slate-100">{roles.map(r=><option key={r}>{r}</option>)}</select></td><td className="px-4 py-3">{user.role==='Admin'?<span className="font-semibold text-emerald-600">All cameras</span>:Array.isArray(user.cameraAccess)&&user.cameraAccess.length?<span>{user.cameraAccess.length} live • {Array.isArray(user.recordingAccess)?user.recordingAccess.length:0} recording</span>:<span className="text-amber-600">No cameras assigned</span>}</td><td className="px-4 py-3"><button disabled={user.id===currentUser.id} onClick={()=>void patch(user.id,{status:user.status==='Active'?'Inactive':'Active'})} className={`px-2 py-1 rounded-full border font-semibold disabled:opacity-50 ${user.status==='Active'?'text-emerald-700 bg-emerald-50 border-emerald-200':'text-slate-500 bg-slate-50 border-slate-200'}`}>{user.status==='Active'?'Active':'Disabled'}</button></td><td className="px-4 py-3"><button disabled={user.id===currentUser.id} title={user.id===currentUser.id?'Use another administrator to change this grant':'Toggle AI access'} onClick={()=>void patch(user.id,{aiEnabled:!user.aiEnabled})} className={`px-2 py-1 rounded-full border font-semibold disabled:opacity-50 ${user.aiEnabled?'text-indigo-700 bg-indigo-50 border-indigo-200':'text-slate-500 bg-slate-50 border-slate-200'}`}><Bot className="w-3 h-3 inline mr-1"/>{user.aiEnabled?'Enabled':'Disabled'}</button></td><td className="px-4 py-3 text-slate-500">{user.last_login?new Date(user.last_login).toLocaleString():'Never'}</td><td className="px-4 py-3"><div className="flex justify-end gap-1">{user.role==='Viewer'&&onOpenCameraAccess&&<button title="Manage camera access" onClick={onOpenCameraAccess} className="px-2.5 py-1.5 rounded-md hover:bg-indigo-50 text-indigo-600 font-semibold">Access</button>}<button disabled={user.id===currentUser.id} title={user.id===currentUser.id?'Change your password in My Account':'Reset password'} onClick={()=>{const p=window.prompt(`New password for ${user.username} (5–8 characters):`);if(p)void patch(user.id,{password:p});}} className="p-2 rounded-md hover:bg-blue-50 text-blue-600 disabled:opacity-30"><KeyRound className="w-4 h-4" /></button>{user.id!==currentUser.id&&<button title="Sign out all sessions" onClick={async()=>{setError('');try{const r=await revokeAllUserSessions(user.id);showToast(`${r.revoked} session${r.revoked===1?'':'s'} revoked.`);}catch(e:any){setError(e?.message||'Unable to revoke sessions.');}}} className="p-2 rounded-md hover:bg-rose-50 text-rose-600"><LogOut className="w-4 h-4" /></button>}</div></td></tr>)}</tbody></table></div>
      <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-500"><strong className="text-slate-700">Account lifecycle:</strong> disable accounts rather than deleting them during normal operation so the audit history remains attributable. The backend retains a guarded delete endpoint for maintenance/recovery only.</div>
    </div>
  </div>;
};
