import React, { useEffect, useState } from 'react';
import { Bell, Bot, Calendar, Clock, LogOut, Radio, ShieldCheck, UserRound, X } from 'lucide-react';
import type { AlertNotification, AuthUser } from '../../types/cctv';

interface HeaderProps {
  notifications?: AlertNotification[];
  onViewNotifications: () => void;
  canViewNotifications?: boolean;
  canUseAi?: boolean;
  onOpenChat: () => void;
  onOpenVoice: () => void;
  currentUser: AuthUser;
  onLogout: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  notifications = [], onViewNotifications, canViewNotifications = true, canUseAi = true,
  onOpenChat, onOpenVoice, currentUser, onLogout,
}) => {
  const [currentTime, setCurrentTime] = useState('');
  const [currentDate, setCurrentDate] = useState('');
  const [showNotifications, setShowNotifications] = useState(false);
  const unreadNotifications = notifications.filter((item) => !item.readAt);

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      setCurrentDate(now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }));
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <header className="h-14 md:h-16 bg-[#0c1527] border-b border-slate-800/80 px-3 sm:px-4 md:px-6 flex items-center justify-between text-slate-300 relative z-30 shrink-0">
      <div className="min-w-0 flex items-center gap-2 md:gap-3">
        <div className="lg:hidden flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-700 to-sky-400 flex items-center justify-center shadow-lg shrink-0"><ShieldCheck className="w-4 h-4 text-white" /></div>
          <div className="min-w-0"><div className="text-sm font-bold text-white leading-tight truncate">CCTV Monitor</div><div className="text-[10px] text-slate-500 truncate">{currentUser.role} • P0.16.1</div></div>
        </div>
        <span className="hidden lg:inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-slate-800/80 text-xs font-mono text-slate-300 border border-slate-700/50">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> NODE: cctv-edge-01
        </span>
        {canUseAi && <div className="hidden lg:flex items-center gap-2.5 pl-3 border-l border-slate-800">
          <button onClick={onOpenVoice} className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-xs font-semibold border-t border-white/30" title="Voice intercom"><Radio className="w-3.5 h-3.5" />Voice Intercom</button>
          <button onClick={onOpenChat} className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-cyan-600 text-white text-xs font-semibold border-t border-white/30" title="AI assistant"><Bot className="w-3.5 h-3.5" />AI Assistant</button>
        </div>}
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2 md:gap-5">
        <div className="hidden xl:flex items-center gap-2 text-xs font-medium text-slate-300"><Calendar className="w-4 h-4 text-slate-400" /><span>{currentDate}</span></div>
        <div className="hidden md:flex items-center gap-2 text-xs font-mono font-medium text-slate-300 tabular-nums"><Clock className="w-4 h-4 text-slate-400" /><span>{currentTime}</span></div>
        <div className="hidden xl:flex items-center gap-2.5 pl-2 border-l border-slate-800">
          <span className="relative flex items-center justify-center"><span className="w-2.5 h-2.5 rounded-full bg-emerald-400" /><span className="absolute w-2.5 h-2.5 rounded-full bg-emerald-400/40 animate-ping" /></span>
          <div className="leading-tight"><div className="text-xs font-semibold text-slate-200">System Online</div><div className="text-[11px] text-slate-400">Authenticated session</div></div>
        </div>

        {canUseAi && <div className="lg:hidden flex items-center gap-1">
          <button onClick={onOpenVoice} className="mobile-touch-target w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/30 text-blue-300 flex items-center justify-center" aria-label="Voice intercom"><Radio className="w-4 h-4" /></button>
          <button onClick={onOpenChat} className="mobile-touch-target w-10 h-10 rounded-xl bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 flex items-center justify-center" aria-label="AI assistant"><Bot className="w-4 h-4" /></button>
        </div>}

        {canViewNotifications && <div className="relative">
          <button onClick={() => setShowNotifications((v) => !v)} className="mobile-touch-target relative w-10 h-10 rounded-xl bg-slate-800/80 border border-slate-700/60 text-slate-300 flex items-center justify-center" aria-label="View notifications">
            <Bell className="w-4 h-4" />
            {unreadNotifications.length > 0 && <span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-amber-500 text-[9px] leading-4 text-white font-bold">{Math.min(unreadNotifications.length, 99)}</span>}
          </button>
          {showNotifications && <div className="fixed sm:absolute left-3 right-3 sm:left-auto sm:right-0 top-16 sm:top-auto sm:mt-2 sm:w-80 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-3 z-50 text-slate-200">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800 mb-2"><span className="text-xs font-semibold text-white uppercase tracking-wider">Recent Alerts</span><button onClick={() => setShowNotifications(false)} className="mobile-touch-target w-9 h-9 flex items-center justify-center text-slate-400"><X className="w-4 h-4" /></button></div>
            <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
              {notifications.slice(0, 5).map((evt) => <div key={evt.id} className="text-xs p-2.5 rounded-lg bg-slate-800/70 border border-slate-700/50 flex gap-2.5 items-start">
                <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${evt.severity === 'critical' ? 'bg-rose-500' : evt.severity === 'warning' ? 'bg-amber-400' : 'bg-blue-400'}`} />
                <div className="flex-1 min-w-0"><div className="font-medium text-slate-200 truncate">{evt.title || evt.eventType}</div><div className="text-[11px] text-slate-400 leading-tight mt-0.5 line-clamp-2">{evt.message}</div><div className="text-[10px] text-slate-500 font-mono mt-1">{new Date(evt.createdAt).toLocaleTimeString()} • {evt.cameraName || 'System'}</div></div>
              </div>)}
              {notifications.length === 0 && <div className="py-8 text-center text-xs text-slate-500">No notifications yet.</div>}
            </div>
            <div className="pt-2 border-t border-slate-800 mt-2 text-center"><button onClick={() => { setShowNotifications(false); onViewNotifications(); }} className="mobile-touch-target px-4 text-xs font-medium text-blue-400">View all notifications →</button></div>
          </div>}
        </div>}

        <div className="hidden sm:flex items-center gap-2 pl-2 md:pl-4 md:border-l border-slate-800"><div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center"><UserRound className="w-4 h-4 text-blue-300" /></div><div className="hidden md:block leading-tight min-w-[72px]"><div className="text-xs font-semibold text-slate-200 truncate max-w-28">{currentUser.username}</div><div className="text-[10px] text-slate-500">{currentUser.role}</div></div></div>
        <button onClick={onLogout} title="Sign out" className="mobile-touch-target w-10 h-10 rounded-xl text-slate-400 hover:text-rose-300 hover:bg-rose-950/30 flex items-center justify-center"><LogOut className="w-4 h-4" /></button>
      </div>
    </header>
  );
};
