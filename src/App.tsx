import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { LiveView } from './components/live/LiveView';
import { DashboardView } from './components/dashboard/DashboardView';
import { CamerasView } from './components/cameras/CamerasView';
import { MyCamerasView } from './components/cameras/MyCamerasView';
import { RecordingsView } from './components/recordings/RecordingsView';
import { EventsView } from './components/events/EventsView';
import { UsersView } from './components/users/UsersView';
import { CameraAccessView } from './components/users/CameraAccessView';
import { AccountView } from './components/account/AccountView';
import { AuditView } from './components/audit/AuditView';
import { SessionsView } from './components/sessions/SessionsView';
import { StorageView } from './components/storage/StorageView';
import { DiagnosticsView } from './components/diagnostics/DiagnosticsView';
import { SettingsView } from './components/settings/SettingsView';
import { NotificationsView } from './components/notifications/NotificationsView';
import { LoginView } from './components/auth/LoginView';
import { GeminiChatbotPanel } from './components/ai/GeminiChatbotPanel';
import { LiveVoiceIntercomModal } from './components/ai/LiveVoiceIntercomModal';
import { MobileNavigation } from './components/mobile/MobileNavigation';
import type { ActiveTab, AlertNotification, AuthStatus, AuthUser, Camera, CCTVEvent } from './types/cctv';
import { INITIAL_CAMERAS, INITIAL_EVENTS } from './data/mockData';
import { getAuthStatus, getCameras, getMe, getNotifications, getOperationalEvents, logout } from './api';
import { hasPermission, type Permission } from './security/permissions';

const demoMode = import.meta.env.VITE_CCTV_DEMO_MODE === 'true';

const DEMO_USER: AuthUser = {
  id: 'demo-admin', username: 'demo', role: 'Admin', status: 'Active', cameraAccess: 'all', recordingAccess: 'all',
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(), last_login: null, security_version: 1, password_changed_at: null, aiEnabled: true,
};

function defaultTab(user: AuthUser): ActiveTab { return user.role === 'Admin' ? 'dashboard' : 'live'; }

function userCan(user: AuthUser, permission: Permission): boolean {
  return hasPermission(user.role, permission) && (permission !== 'ai:use' || user.aiEnabled);
}

function permissionForTab(tab: ActiveTab): Permission | null {
  const map: Partial<Record<ActiveTab, Permission>> = {
    live: 'camera:view', 'my-cameras': 'camera:view', account: 'account:view', dashboard: 'system:view', cameras: 'camera:update',
    recordings: 'recording:view', events: 'event:view', notifications: 'notification:view', users: 'user:view', 'camera-access': 'camera_access:manage', storage: 'system:view',
    diagnostics: 'system:view', audit: 'audit:view', sessions: 'session:manage', settings: 'system:configure',
  };
  return map[tab] || null;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>(demoMode ? 'dashboard' : 'live');
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(demoMode ? { setupRequired: false, setupAllowed: true } : null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(demoMode ? DEMO_USER : null);
  const [authLoading, setAuthLoading] = useState(!demoMode);
  const [cameras, setCameras] = useState<Camera[]>(demoMode ? INITIAL_CAMERAS : []);
  const [events, setEvents] = useState<CCTVEvent[]>(demoMode ? INITIAL_EVENTS : []);
  const [notifications, setNotifications] = useState<AlertNotification[]>([]);
  const [notificationUnreadCount, setNotificationUnreadCount] = useState(0);
  const lastDesktopNotificationId = useRef<number | null>(null);
  const [targetRecordingCameraId, setTargetRecordingCameraId] = useState<string>('');
  const [targetDiagnosticsCameraId, setTargetDiagnosticsCameraId] = useState<string>('');
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isVoiceIntercomOpen, setIsVoiceIntercomOpen] = useState(false);
  const [kioskMode, setKioskMode] = useState(false);

  useEffect(() => {
    if (demoMode) return;
    let cancelled = false;
    const boot = async () => {
      setAuthLoading(true);
      try {
        const status = await getAuthStatus();
        if (cancelled) return;
        setAuthStatus(status);
        if (!status.setupRequired) {
          try {
            const result = await getMe();
            if (!cancelled) { setCurrentUser(result.user); setActiveTab(defaultTab(result.user)); }
          } catch { if (!cancelled) setCurrentUser(null); }
        }
      } catch (error) { console.error('Unable to initialize authentication:', error); }
      finally { if (!cancelled) setAuthLoading(false); }
    };
    void boot();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (demoMode || !currentUser) return;
    const refreshIdentity = async () => {
      try {
        const result = await getMe();
        setCurrentUser(result.user);
      } catch (error: any) {
        if (error?.status === 401) setCurrentUser(null);
      }
    };
    const timer = window.setInterval(() => void refreshIdentity(), 15000);
    return () => window.clearInterval(timer);
  }, [currentUser?.id]);

  const refreshCameras = useCallback(async () => {
    if (demoMode || !currentUser) return;
    try {
      const serverCameras = await getCameras();
      setCameras(serverCameras);
      if (!targetRecordingCameraId && serverCameras[0]) setTargetRecordingCameraId(serverCameras[0].id);
      if (!targetDiagnosticsCameraId && serverCameras[0]) setTargetDiagnosticsCameraId(serverCameras[0].id);
    } catch (error: any) {
      if (error?.status === 401) setCurrentUser(null);
      else console.error('Failed to load camera registry:', error);
    }
  }, [currentUser, targetRecordingCameraId, targetDiagnosticsCameraId]);

  useEffect(() => {
    if (!currentUser) return;
    void refreshCameras();
    if (demoMode) return;
    const timer = window.setInterval(() => void refreshCameras(), 3000);
    return () => window.clearInterval(timer);
  }, [currentUser, refreshCameras]);


  const refreshEvents = useCallback(async () => {
    if (demoMode || !currentUser || !userCan(currentUser, 'event:view')) return;
    try { setEvents(await getOperationalEvents({ limit: 200 })); }
    catch (error: any) {
      if (error?.status === 401) setCurrentUser(null);
      else console.error('Failed to load operational events:', error);
    }
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser || demoMode || !userCan(currentUser, 'event:view')) return;
    void refreshEvents();
    const timer = window.setInterval(() => void refreshEvents(), 5000);
    return () => window.clearInterval(timer);
  }, [currentUser, refreshEvents]);

  const refreshNotifications = useCallback(async () => {
    if (demoMode || !currentUser || !userCan(currentUser, 'notification:view')) return;
    try {
      const result = await getNotifications({ limit: 100 });
      setNotifications(result.notifications);
      setNotificationUnreadCount(result.unreadCount);
      const newestId = result.notifications.reduce((max, item) => Math.max(max, item.id), 0);
      if (lastDesktopNotificationId.current === null) {
        lastDesktopNotificationId.current = newestId;
      } else {
        const newRows = result.notifications.filter((item) => !item.readAt && item.desktopEnabled && item.id > (lastDesktopNotificationId.current || 0));
        if ('Notification' in window && Notification.permission === 'granted') {
          for (const item of [...newRows].reverse()) new Notification(item.title, { body: item.message, tag: `cctv-${item.id}` });
        }
        lastDesktopNotificationId.current = Math.max(lastDesktopNotificationId.current || 0, newestId);
      }
    } catch (error: any) {
      if (error?.status === 401) setCurrentUser(null);
      else console.error('Failed to load notifications:', error);
    }
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser || demoMode || !userCan(currentUser, 'notification:view')) return;
    lastDesktopNotificationId.current = null;
    void refreshNotifications();
    const timer = window.setInterval(() => void refreshNotifications(), 4000);
    return () => window.clearInterval(timer);
  }, [currentUser, refreshNotifications]);

  useEffect(() => {
    if (!currentUser) return;
    const required = permissionForTab(activeTab);
    if (required && !userCan(currentUser, required)) setActiveTab(defaultTab(currentUser));
  }, [activeTab, currentUser]);

  const handleAuthenticated = (user: AuthUser) => {
    setCurrentUser(user); setAuthStatus({ setupRequired: false, setupAllowed: true }); setActiveTab(defaultTab(user)); setKioskMode(false);
  };
  const handleLogout = async () => {
    try { if (!demoMode) await logout(); } catch {}
    setCurrentUser(null); setCameras([]); setEvents([]); setNotifications([]); setNotificationUnreadCount(0); setIsChatOpen(false); setIsVoiceIntercomOpen(false); setKioskMode(false);
  };

  const recordingCameras = useMemo(() => {
    if (!currentUser) return [];
    if (currentUser.role === 'Admin' || currentUser.recordingAccess === 'all') return cameras;
    const allowed = new Set(currentUser.recordingAccess);
    return cameras.filter(c => allowed.has(c.id));
  }, [currentUser, cameras]);

  useEffect(() => {
    if (currentUser?.role === 'Viewer' && activeTab === 'recordings' && recordingCameras.length === 0) setActiveTab('live');
    if (currentUser?.role !== 'Viewer' && kioskMode) setKioskMode(false);
  }, [activeTab, currentUser, recordingCameras.length, kioskMode]);

  if (authLoading || !authStatus) return <div className="min-h-screen bg-[#07101f] flex items-center justify-center text-slate-400 text-sm">Starting CCTV Monitor…</div>;
  if (!currentUser) return <LoginView status={authStatus} onAuthenticated={handleAuthenticated} />;

  const can = (permission: Permission) => userCan(currentUser, permission);
  const canViewRecordingCamera = (id: string) => currentUser.role === 'Admin' || currentUser.recordingAccess === 'all' || currentUser.recordingAccess.includes(id);
  const showRecordings = can('recording:view') && (currentUser.role === 'Admin' || recordingCameras.length > 0);
  const liveEmptyMessage = currentUser.role === 'Viewer' ? 'No cameras are assigned to this Viewer account. Ask an administrator to assign cameras in Camera Access.' : 'Open Cameras → Add Camera to register a source.';

  return <div className="flex h-full w-full overflow-hidden bg-slate-900 font-sans select-none relative">
    {!kioskMode && <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} unreadEventsCount={can('event:view') ? events.filter(e=>e.severity==='critical' && !e.acknowledgedAt).length : 0} unreadNotificationsCount={can('notification:view') ? notificationUnreadCount : 0} role={currentUser.role} showRecordings={showRecordings} />}
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#0c1527]">
      {!kioskMode && <Header notifications={can('notification:view') ? notifications : []} canViewNotifications={can('notification:view')} canUseAi={can('ai:use')} onViewNotifications={()=>setActiveTab('notifications')} onOpenChat={()=>setIsChatOpen(true)} onOpenVoice={()=>setIsVoiceIntercomOpen(true)} currentUser={currentUser} onLogout={handleLogout} />}
      <main className="flex-1 flex flex-col overflow-hidden relative pb-[calc(66px+env(safe-area-inset-bottom))] lg:pb-0">
        {activeTab === 'live' && <LiveView cameras={cameras} emptyMessage={liveEmptyMessage} kioskMode={kioskMode} onToggleKiosk={currentUser.role==='Viewer'?()=>setKioskMode(v=>!v):undefined} canOpenRecordingsForCamera={canViewRecordingCamera} onOpenRecordingsForCamera={showRecordings?(id)=>{if(canViewRecordingCamera(id)){setTargetRecordingCameraId(id);setActiveTab('recordings');}}:undefined} onOpenDiagnosticsForCamera={can('system:view')?(id)=>{setTargetDiagnosticsCameraId(id);setActiveTab('diagnostics');}:undefined} />}
        {activeTab === 'my-cameras' && can('camera:view') && <MyCamerasView cameras={cameras} onOpenLive={()=>setActiveTab('live')} />}
        {activeTab === 'account' && can('account:view') && <AccountView user={currentUser} cameras={cameras} onUserUpdated={setCurrentUser} />}
        {activeTab === 'dashboard' && can('system:view') && <DashboardView cameras={cameras} events={events} onNavigateToLive={()=>setActiveTab('live')} onNavigateToEvents={()=>setActiveTab('events')} onNavigateToRecordings={(id)=>{if(id)setTargetRecordingCameraId(id);setActiveTab('recordings');}} onNavigateToStorage={()=>setActiveTab('storage')} onNavigateToDiagnostics={()=>setActiveTab('diagnostics')} />}
        {activeTab === 'cameras' && can('camera:update') && <CamerasView cameras={cameras} setCameras={setCameras} onOpenLiveViewForCamera={()=>setActiveTab('live')} onOpenDiagnosticsForCamera={(id)=>{setTargetDiagnosticsCameraId(id);setActiveTab('diagnostics');}} onRegistryChanged={refreshCameras} />}
        {activeTab === 'recordings' && showRecordings && <RecordingsView cameras={recordingCameras} initialCameraId={canViewRecordingCamera(targetRecordingCameraId)?targetRecordingCameraId:(recordingCameras[0]?.id||'')} onNavigateToLive={()=>setActiveTab('live')} canDownload={can('recording:download')} canManage={can('recording:manage')} />}
        {activeTab === 'events' && can('event:view') && <EventsView events={events} setEvents={setEvents} onRefresh={refreshEvents} onViewCameraRecordings={(camName)=>{const found=cameras.find(c=>c.name.toLowerCase()===camName.toLowerCase()||c.location.toLowerCase()===camName.toLowerCase());if(found)setTargetRecordingCameraId(found.id);setActiveTab('recordings');}} />}
        {activeTab === 'notifications' && can('notification:view') && <NotificationsView cameras={cameras} />}
        {activeTab === 'users' && can('user:view') && <UsersView currentUser={currentUser} onOpenCameraAccess={()=>setActiveTab('camera-access')} />}
        {activeTab === 'camera-access' && can('camera_access:manage') && <CameraAccessView cameras={cameras} />}
        {activeTab === 'storage' && can('system:view') && <StorageView cameras={cameras} />}
        {activeTab === 'diagnostics' && can('system:view') && <DiagnosticsView cameras={cameras} selectedCameraId={targetDiagnosticsCameraId} />}
        {activeTab === 'audit' && can('audit:view') && <AuditView />}
        {activeTab === 'sessions' && can('session:manage') && <SessionsView currentUser={currentUser} />}
        {activeTab === 'settings' && can('system:configure') && <SettingsView />}
      </main>
    </div>
    {!kioskMode && <MobileNavigation activeTab={activeTab} setActiveTab={setActiveTab} role={currentUser.role} showRecordings={showRecordings} unreadNotificationsCount={can('notification:view') ? notificationUnreadCount : 0} unreadEventsCount={can('event:view') ? events.filter(e=>e.severity==='critical' && !e.acknowledgedAt).length : 0} />}
    {!kioskMode && can('ai:use') && <GeminiChatbotPanel isOpen={isChatOpen} onClose={()=>setIsChatOpen(false)} onOpenVoiceIntercom={()=>setIsVoiceIntercomOpen(true)} />}
    {!kioskMode && can('ai:use') && <LiveVoiceIntercomModal isOpen={isVoiceIntercomOpen} onClose={()=>setIsVoiceIntercomOpen(false)} />}
  </div>;
}
