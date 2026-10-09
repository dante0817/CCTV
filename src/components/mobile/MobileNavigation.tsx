import React, { useMemo, useState } from 'react';
import {
  Activity, BarChart2, BellRing, Camera, ChevronUp, Database, FileClock,
  Menu, PlaySquare, Settings, ShieldCheck, Tv, UserRound, Users, Video, X
} from 'lucide-react';
import type { ActiveTab, UserRole } from '../../types/cctv';

type Item = { id: ActiveTab; label: string; icon: React.ComponentType<{ className?: string }>; badge?: number };

interface Props {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  role: UserRole;
  showRecordings: boolean;
  unreadNotificationsCount: number;
  unreadEventsCount: number;
}

const go = (id: ActiveTab, label: string, icon: Item['icon'], badge?: number): Item => ({ id, label, icon, badge });

export const MobileNavigation: React.FC<Props> = ({
  activeTab, setActiveTab, role, showRecordings, unreadNotificationsCount, unreadEventsCount,
}) => {
  const [moreOpen, setMoreOpen] = useState(false);

  const { primary, more } = useMemo(() => {
    if (role === 'Viewer') {
      const p: Item[] = [
        go('live', 'Live', Tv),
        go('my-cameras', 'Cameras', Camera),
        ...(showRecordings ? [go('recordings', 'Clips', PlaySquare)] : []),
        go('account', 'Account', UserRound),
      ];
      return { primary: p.slice(0, 4), more: p.slice(4) };
    }
    return {
      primary: [
        go('dashboard', 'Home', BarChart2),
        go('live', 'Live', Tv),
        go('notifications', 'Alerts', BellRing, unreadNotificationsCount),
      ],
      more: [
        go('cameras', 'Cameras', Video),
        go('recordings', 'Recordings', PlaySquare),
        go('events', 'Events', BellRing, unreadEventsCount),
        go('users', 'Users', Users),
        go('camera-access', 'Camera Access', ShieldCheck),
        go('sessions', 'Sessions', UserRound),
        go('storage', 'Storage', Database),
        go('diagnostics', 'System Status', Activity),
        go('audit', 'Audit & Logs', FileClock),
        go('settings', 'Settings', Settings),
      ],
    };
  }, [role, showRecordings, unreadNotificationsCount, unreadEventsCount]);

  const navigate = (id: ActiveTab) => { setActiveTab(id); setMoreOpen(false); };

  return (
    <>
      {moreOpen && (
        <div className="lg:hidden fixed inset-0 z-[80] bg-slate-950/65 backdrop-blur-sm" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-x-3 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] rounded-2xl bg-[#0c1527] border border-slate-700 shadow-2xl p-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-2 pb-2 border-b border-slate-800">
              <div><div className="text-sm font-bold text-white">More</div><div className="text-[11px] text-slate-500">CCTV controls</div></div>
              <button onClick={() => setMoreOpen(false)} className="mobile-touch-target rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 flex items-center justify-center"><X className="w-5 h-5" /></button>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 pt-3 max-h-[55vh] overflow-y-auto">
              {more.map(({ id, label, icon: Icon, badge }) => {
                const active = activeTab === id;
                return <button key={id} onClick={() => navigate(id)} className={`relative min-h-[72px] rounded-xl border flex flex-col items-center justify-center gap-1.5 px-2 text-center ${active ? 'bg-blue-600/20 border-blue-500/60 text-blue-100' : 'bg-slate-900/40 border-slate-800 text-slate-300'}`}>
                  <Icon className={`w-5 h-5 ${active ? 'text-sky-300' : 'text-slate-500'}`} />
                  <span className="text-[10px] font-semibold leading-tight">{label}</span>
                  {!!badge && <span className="absolute top-2 right-2 min-w-4 h-4 px-1 rounded-full bg-rose-500 text-[9px] text-white font-bold flex items-center justify-center">{badge}</span>}
                </button>;
              })}
            </div>
          </div>
        </div>
      )}

      <nav className="lg:hidden fixed inset-x-0 bottom-0 z-[75] border-t border-slate-800/90 bg-[#0c1527]/95 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]" aria-label="Mobile navigation">
        <div className="h-[66px] flex items-stretch justify-around px-1">
          {primary.map(({ id, label, icon: Icon, badge }) => {
            const active = activeTab === id;
            return <button key={id} onClick={() => navigate(id)} className={`relative flex-1 min-w-0 flex flex-col items-center justify-center gap-1 ${active ? 'text-sky-300' : 'text-slate-500'}`}>
              <span className={`w-10 h-8 rounded-xl flex items-center justify-center ${active ? 'bg-blue-600/20' : ''}`}><Icon className="w-5 h-5" /></span>
              <span className="text-[10px] font-semibold truncate max-w-[64px]">{label}</span>
              {!!badge && <span className="absolute top-1.5 left-[55%] min-w-4 h-4 px-1 rounded-full bg-rose-500 text-[9px] text-white font-bold flex items-center justify-center">{badge}</span>}
            </button>;
          })}
          {more.length > 0 && <button onClick={() => setMoreOpen((v) => !v)} className={`flex-1 min-w-0 flex flex-col items-center justify-center gap-1 ${moreOpen ? 'text-sky-300' : 'text-slate-500'}`}>
            <span className={`w-10 h-8 rounded-xl flex items-center justify-center ${moreOpen ? 'bg-blue-600/20' : ''}`}>{moreOpen ? <ChevronUp className="w-5 h-5" /> : <Menu className="w-5 h-5" />}</span>
            <span className="text-[10px] font-semibold">More</span>
          </button>}
        </div>
      </nav>
    </>
  );
};
