import React, { useState } from 'react';
import { LockKeyhole, ShieldCheck, Wifi, AlertTriangle } from 'lucide-react';
import type { AuthStatus, AuthUser } from '../../types/cctv';
import { login, setupAdmin } from '../../api';

interface Props {
  status: AuthStatus;
  onAuthenticated: (user: AuthUser) => void;
}

export const LoginView: React.FC<Props> = ({ status, onAuthenticated }) => {
  const [username, setUsername] = useState(status.setupRequired ? 'admin' : '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (status.setupRequired && password !== confirm) return setError('Passwords do not match.');
    setBusy(true);
    try {
      const result = status.setupRequired ? await setupAdmin(username, password) : await login(username, password);
      onAuthenticated(result.user);
    } catch (err: any) {
      setError(err?.message || 'Unable to sign in.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#07101f] flex items-center justify-center p-6 text-slate-200">
      <div className="w-full max-w-md rounded-2xl border border-slate-700/70 bg-[#0c1527] shadow-2xl overflow-hidden">
        <div className="p-6 border-b border-slate-800 bg-gradient-to-br from-blue-950/60 to-slate-950/30">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-950/50"><ShieldCheck className="w-6 h-6 text-white" /></div>
            <div><h1 className="text-xl font-bold text-white">CCTV Monitor</h1><p className="text-xs text-slate-400">Private authenticated camera access</p></div>
          </div>
        </div>

        <form onSubmit={submit} className="p-6 space-y-5">
          <div className="rounded-xl border border-blue-900/60 bg-blue-950/30 p-3 flex gap-2.5 text-xs text-blue-100">
            <Wifi className="w-4 h-4 shrink-0 mt-0.5 text-blue-400" />
            <div>{status.setupRequired ? 'Create the first administrator on the CCTV server. Remote viewing remains locked until setup is complete.' : 'Sign in before the dashboard or live camera streams can be opened.'}</div>
          </div>

          {status.setupRequired && !status.setupAllowed && (
            <div className="rounded-xl border border-amber-800/60 bg-amber-950/30 p-3 flex gap-2.5 text-xs text-amber-200">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />First-admin setup is restricted to this CCTV PC. Open <strong>{`http://localhost:${window.location.port || '3000'}`}</strong> on the server itself.
            </div>
          )}

          {error && <div className="rounded-xl border border-rose-800/60 bg-rose-950/30 p-3 text-xs text-rose-200">{error}</div>}

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300">Username</label>
            <input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" required minLength={3} className="w-full rounded-lg border border-slate-700 bg-slate-950/70 px-3.5 py-2.5 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete={status.setupRequired ? 'new-password' : 'current-password'} required minLength={status.setupRequired ? 5 : 1} maxLength={status.setupRequired ? 8 : undefined} className="w-full rounded-lg border border-slate-700 bg-slate-950/70 px-3.5 py-2.5 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500" />
            {status.setupRequired && <div className="text-[11px] text-slate-500">Use 5–8 characters.</div>}
          </div>
          {status.setupRequired && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">Confirm password</label>
              <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" required minLength={5} maxLength={8} className="w-full rounded-lg border border-slate-700 bg-slate-950/70 px-3.5 py-2.5 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          )}

          <button type="submit" disabled={busy || (status.setupRequired && !status.setupAllowed)} className="w-full rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-3 text-sm font-bold text-white flex items-center justify-center gap-2 transition-colors">
            <LockKeyhole className="w-4 h-4" />{busy ? 'Please wait…' : status.setupRequired ? 'Create Administrator' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
};
