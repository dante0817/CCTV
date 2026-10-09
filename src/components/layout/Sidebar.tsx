import React from 'react';
import { Activity, BarChart2, Bell, BellRing, Camera, Database, FileClock, PlaySquare, Settings, ShieldCheck, Tv, UserRound, Users, Video } from 'lucide-react';
import type { ActiveTab, UserRole } from '../../types/cctv';

interface SidebarProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  unreadEventsCount?: number;
  unreadNotificationsCount?: number;
  role: UserRole;
  showRecordings?: boolean;
}

type NavItem = { id: ActiveTab; label: string; icon: React.ComponentType<{ className?: string }>; badge?: 'events' | 'notifications' };
type NavGroup = { label: string; items: NavItem[] };

const item = (id: ActiveTab, label: string, icon: NavItem['icon'], badge?: NavItem['badge']): NavItem => ({ id, label, icon, badge });

function groupsForRole(role: UserRole, showRecordings: boolean): NavGroup[] {
  if (role === 'Viewer') return [
    { label: 'MONITORING', items: [item('live', 'Live View', Tv), item('my-cameras', 'My Cameras', Camera), ...(showRecordings ? [item('recordings', 'Recordings', PlaySquare)] : [])] },
    { label: 'ACCOUNT', items: [item('account', 'My Account', UserRound)] },
  ];
  return [
    { label: 'OVERVIEW', items: [item('dashboard', 'Dashboard', BarChart2), item('live', 'Live View', Tv)] },
    { label: 'CAMERAS', items: [item('cameras', 'Cameras', Video), item('recordings', 'Recordings', PlaySquare), item('events', 'Events', Bell, 'events'), item('notifications', 'Notifications', BellRing, 'notifications')] },
    { label: 'ACCESS', items: [item('users', 'Users', Users), item('camera-access', 'Camera Access', ShieldCheck), item('sessions', 'Sessions', UserRound)] },
    { label: 'SYSTEM', items: [item('storage', 'Storage', Database), item('diagnostics', 'System Status', Activity), item('audit', 'Audit & Logs', FileClock), item('settings', 'Settings', Settings)] },
  ];
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab, unreadEventsCount = 0, unreadNotificationsCount = 0, role, showRecordings = true }) => {
  const groups = groupsForRole(role, showRecordings);
  return <aside className="hidden lg:flex relative w-60 bg-[#0c1527] text-slate-300 flex flex-col shrink-0 h-screen select-none border-r border-slate-800/80 overflow-hidden">
    <div className="flex items-center gap-3 px-5 py-5 border-b border-slate-800/60"><div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-700 to-sky-400 flex items-center justify-center shadow-lg"><ShieldCheck className="w-5 h-5 text-white" /></div><div><div className="text-[17px] font-bold text-white leading-tight">CCTV Monitor</div><div className="text-xs text-slate-400">{role} workspace</div></div></div>
    <nav className="flex-1 overflow-y-auto p-3 space-y-4" aria-label="Primary navigation">
      {groups.map(group=><div key={group.label}><div className="px-2 mb-1.5 text-[10px] font-bold tracking-[0.18em] text-slate-500">{group.label}</div><div className="space-y-1">{group.items.map(nav=>{const Icon=nav.icon;const active=activeTab===nav.id;return <button key={nav.id} onClick={()=>setActiveTab(nav.id)} className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border transition-colors ${active?'bg-blue-600/20 border-blue-500/50 text-blue-100':'bg-slate-900/20 border-transparent text-slate-300 hover:bg-slate-800/70 hover:border-slate-700'}`}><span className="flex items-center gap-3"><Icon className={`w-4 h-4 ${active?'text-sky-300':'text-slate-500'}`} /><span className="text-xs font-semibold">{nav.label}</span></span>{nav.badge==='events'&&unreadEventsCount>0?<span className="min-w-5 h-5 px-1 flex items-center justify-center rounded-full bg-rose-500 text-white text-[10px] font-bold">{unreadEventsCount}</span>:nav.badge==='notifications'&&unreadNotificationsCount>0?<span className="min-w-5 h-5 px-1 flex items-center justify-center rounded-full bg-amber-500 text-white text-[10px] font-bold">{unreadNotificationsCount}</span>:active?<span className="w-1.5 h-1.5 rounded-full bg-sky-400"/>:null}</button>})}</div></div>)}
    </nav>
    <div className="p-4 border-t border-slate-800/60"><div className="rounded-xl border border-emerald-800/50 bg-emerald-950/20 p-2.5 flex items-center gap-2 text-[11px] text-emerald-300"><span className="w-2 h-2 rounded-full bg-emerald-400"/>Authenticated • {role}</div><div className="mt-2 px-1 text-[10px] text-slate-500">CCTV Monitor P0.16.1 • Mobile Viewer</div></div>
  </aside>;
};
