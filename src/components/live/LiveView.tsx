import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera as CameraIcon, Check, ChevronLeft, ChevronRight, Grid2X2, Grid3X3,
  Layers, LayoutGrid, Maximize, Minimize, MoreVertical, Radio, RotateCw,
  Tv, Usb, Volume2, VolumeX
} from 'lucide-react';
import type { Camera, CameraStatus } from '../../types/cctv';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { RemoteConnectionBadge } from '../mobile/RemoteConnectionBadge';
import { CameraPlayer } from './CameraPlayer';

interface LiveViewProps {
  cameras: Camera[];
  onOpenRecordingsForCamera?: (cameraId: string) => void;
  onOpenDiagnosticsForCamera?: (cameraId: string) => void;
  canOpenRecordingsForCamera?: (cameraId: string) => boolean;
  kioskMode?: boolean;
  onToggleKiosk?: () => void;
  emptyMessage?: string;
}

type LayoutMode = '2x2' | '3x3' | '1+3' | '1x1';

const statusUi: Record<CameraStatus, { label: string; cls: string; dot: string }> = {
  configured: { label: 'CONFIGURED', cls: 'bg-slate-900/80 border-slate-500/40 text-slate-300', dot: 'bg-slate-400' },
  starting: { label: 'CONNECTING', cls: 'bg-amber-950/80 border-amber-500/40 text-amber-300', dot: 'bg-amber-400' },
  online: { label: 'LIVE', cls: 'bg-emerald-950/80 border-emerald-500/40 text-emerald-400', dot: 'bg-emerald-400' },
  degraded: { label: 'DEGRADED', cls: 'bg-amber-950/80 border-amber-500/40 text-amber-300', dot: 'bg-amber-400' },
  reconnecting: { label: 'RECONNECTING', cls: 'bg-amber-950/80 border-amber-500/40 text-amber-300', dot: 'bg-amber-400' },
  retrying: { label: 'RETRYING', cls: 'bg-amber-950/80 border-amber-500/40 text-amber-300', dot: 'bg-amber-400' },
  offline: { label: 'OFFLINE', cls: 'bg-rose-950/80 border-rose-500/40 text-rose-300', dot: 'bg-rose-500' },
  error: { label: 'ERROR', cls: 'bg-rose-950/80 border-rose-500/40 text-rose-300', dot: 'bg-rose-500' },
  disabled: { label: 'DISABLED', cls: 'bg-slate-900/80 border-slate-500/40 text-slate-400', dot: 'bg-slate-500' },
};

export const LiveView: React.FC<LiveViewProps> = ({
  cameras, onOpenRecordingsForCamera, onOpenDiagnosticsForCamera, canOpenRecordingsForCamera,
  kioskMode = false, onToggleKiosk, emptyMessage,
}) => {
  const isPhone = useMediaQuery('(max-width: 767px)');
  const isTablet = useMediaQuery('(min-width: 768px) and (max-width: 1023px)');
  const [layout, setLayout] = useState<LayoutMode>('2x2');
  const [selectedCameraCount, setSelectedCameraCount] = useState(4);
  const [audioStates, setAudioStates] = useState<Record<string, boolean>>({});
  const [fullFocusCameraId, setFullFocusCameraId] = useState<string | null>(null);
  const [mobileFocusCameraId, setMobileFocusCameraId] = useState<string | null>(null);
  const [openMenuCameraId, setOpenMenuCameraId] = useState<string | null>(null);
  const [liveTimestamp, setLiveTimestamp] = useState('');
  const [snapshotToast, setSnapshotToast] = useState<string | null>(null);
  const swipeStartX = useRef<number | null>(null);

  useEffect(() => {
    const tick = () => setLiveTimestamp(new Date().toLocaleString());
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!cameras.length) { setMobileFocusCameraId(null); return; }
    if (!mobileFocusCameraId || !cameras.some((camera) => camera.id === mobileFocusCameraId)) setMobileFocusCameraId(cameras[0].id);
  }, [cameras, mobileFocusCameraId]);

  const mobileIndex = Math.max(0, cameras.findIndex((camera) => camera.id === mobileFocusCameraId));
  const selectMobileIndex = (index: number) => {
    if (!cameras.length) return;
    const normalized = (index + cameras.length) % cameras.length;
    setMobileFocusCameraId(cameras[normalized].id);
    setOpenMenuCameraId(null);
  };

  const toggleAudio = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setAudioStates((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const snapshot = (camera: Camera, e?: React.SyntheticEvent) => {
    e?.stopPropagation();
    const video = document.getElementById(`camera-video-${camera.id}`) as HTMLVideoElement | null;
    if (!video || video.readyState < 2 || !video.videoWidth) {
      setSnapshotToast(`Snapshot unavailable: ${camera.name} is not playing.`);
      window.setTimeout(() => setSnapshotToast(null), 3000);
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/jpeg', 0.92);
    link.download = `snapshot_${camera.name.replace(/\W+/g, '_')}_${Date.now()}.jpg`;
    link.click();
    setSnapshotToast(`Snapshot captured: ${camera.name}`);
    window.setTimeout(() => setSnapshotToast(null), 3000);
  };

  const toggleFullFocus = (id: string) => {
    if (fullFocusCameraId === id) setFullFocusCameraId(null);
    else { setFullFocusCameraId(id); setLayout('1x1'); }
  };

  const requestCameraFullscreen = async (camera: Camera) => {
    const tile = document.getElementById(`camera-tile-${camera.id}`) as HTMLElement | null;
    const video = document.getElementById(`camera-video-${camera.id}`) as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (tile?.requestFullscreen) await tile.requestFullscreen();
      else if (video?.webkitEnterFullscreen) video.webkitEnterFullscreen();
    } catch { /* browser-specific fullscreen restrictions */ }
  };

  const desktopDisplayed = fullFocusCameraId ? cameras.filter((camera) => camera.id === fullFocusCameraId) : cameras.slice(0, selectedCameraCount);
  const displayedCameras = isPhone ? cameras.filter((camera) => camera.id === mobileFocusCameraId) : desktopDisplayed;

  const gridClass = useMemo(() => {
    if (isPhone) return 'grid-cols-1';
    if (isTablet && !fullFocusCameraId) return 'grid-cols-2';
    if (layout === '1x1' || fullFocusCameraId) return 'grid-cols-1';
    if (layout === '1+3') return 'grid-cols-3 grid-rows-2';
    if (layout === '3x3') return 'grid-cols-3';
    return 'grid-cols-2';
  }, [isPhone, isTablet, fullFocusCameraId, layout]);

  const onlineCount = cameras.filter((camera) => camera.status === 'online').length;

  return (
    <div className="flex-1 flex flex-col h-full bg-[#f4f6fa] overflow-y-auto overscroll-contain">
      {snapshotToast && <div className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] lg:bottom-8 left-3 right-3 sm:left-auto sm:right-8 sm:w-auto z-[90] bg-slate-900 text-white px-4 py-3 rounded-xl shadow-xl border border-slate-700 text-xs flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400 shrink-0" />{snapshotToast}</div>}

      <div className="p-3 sm:p-4 lg:p-6 flex-1 flex flex-col min-h-0">
        <div className="flex items-start sm:items-center justify-between gap-3 mb-3 sm:mb-5">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="hidden sm:flex w-10 h-10 rounded-lg bg-blue-50 text-blue-600 items-center justify-center border border-blue-100"><Tv className="w-5 h-5" /></div>
            <div className="min-w-0"><h1 className="text-lg sm:text-2xl font-bold text-slate-900 tracking-tight">Live View</h1><p className="text-[11px] sm:text-xs text-slate-500 font-medium truncate">Secure real-time camera playback</p></div>
          </div>
          <div className="sm:hidden"><RemoteConnectionBadge compact /></div>

          <div className="hidden md:flex items-center gap-2 lg:gap-3">
            {!isTablet && <div className="flex items-center bg-white p-1 rounded-lg border border-slate-200 shadow-xs">
              <button onClick={() => { setLayout('2x2'); setFullFocusCameraId(null); }} className={`p-2 rounded-md ${layout === '2x2' && !fullFocusCameraId ? 'bg-blue-600 text-white' : 'text-slate-500'}`} title="2 × 2"><Grid2X2 className="w-4 h-4" /></button>
              <button onClick={() => { setLayout('3x3'); setFullFocusCameraId(null); }} className={`p-2 rounded-md ${layout === '3x3' && !fullFocusCameraId ? 'bg-blue-600 text-white' : 'text-slate-500'}`} title="3 × 3"><Grid3X3 className="w-4 h-4" /></button>
              <button onClick={() => { setLayout('1+3'); setFullFocusCameraId(null); }} className={`p-2 rounded-md ${layout === '1+3' && !fullFocusCameraId ? 'bg-blue-600 text-white' : 'text-slate-500'}`} title="1 + 3"><Layers className="w-4 h-4" /></button>
              <button disabled={!cameras[0]} onClick={() => { setLayout('1x1'); if (cameras[0]) setFullFocusCameraId(cameras[0].id); }} className={`p-2 rounded-md ${layout === '1x1' ? 'bg-blue-600 text-white' : 'text-slate-500'} disabled:opacity-30`} title="Focus"><LayoutGrid className="w-4 h-4" /></button>
            </div>}
            <select value={Math.min(selectedCameraCount, Math.max(cameras.length, 1))} onChange={(e) => { setSelectedCameraCount(Number(e.target.value)); setFullFocusCameraId(null); }} className="bg-white border border-slate-200 text-slate-700 text-xs font-medium rounded-lg px-3 py-2.5">
              <option value={1}>1 Camera</option>{cameras.length >= 2 && <option value={2}>2 Cameras</option>}{cameras.length >= 4 && <option value={4}>4 Cameras</option>}<option value={Math.max(cameras.length, 1)}>{cameras.length} Cameras (All)</option>
            </select>
            {onToggleKiosk && <button onClick={onToggleKiosk} title={kioskMode ? 'Exit kiosk mode' : 'Kiosk mode'} className="px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-600 text-xs font-semibold flex items-center gap-2">{kioskMode ? <Minimize className="w-4 h-4" /> : <Tv className="w-4 h-4" />}{kioskMode ? 'Exit Kiosk' : 'Kiosk'}</button>}
            <button onClick={() => !document.fullscreenElement ? document.documentElement.requestFullscreen().catch(() => {}) : document.exitFullscreen().catch(() => {})} className="w-10 h-10 rounded-lg bg-white border border-slate-200 text-slate-600 flex items-center justify-center" title="Fullscreen"><Maximize className="w-4 h-4" /></button>
          </div>
        </div>

        <div className="hidden sm:flex mb-4"><RemoteConnectionBadge /></div>

        {isPhone && cameras.length > 1 && <div className="mb-3 -mx-3 px-3 overflow-x-auto scrollbar-none">
          <div className="flex gap-2 min-w-max">
            {cameras.map((camera, index) => {
              const active = camera.id === mobileFocusCameraId;
              return <button key={camera.id} onClick={() => setMobileFocusCameraId(camera.id)} className={`mobile-touch-target flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold ${active ? 'bg-blue-600 text-white border-blue-600 shadow-sm' : 'bg-white text-slate-600 border-slate-200'}`}>
                <span className={`w-2 h-2 rounded-full ${camera.status === 'online' ? 'bg-emerald-400' : camera.status === 'offline' || camera.status === 'error' ? 'bg-rose-400' : 'bg-amber-400'}`} />
                <span className="max-w-32 truncate">{camera.name}</span><span className="text-[10px] opacity-70">{index + 1}/{cameras.length}</span>
              </button>;
            })}
          </div>
        </div>}

        {displayedCameras.length === 0 ? (
          <div className="flex-1 min-h-[360px] rounded-xl border border-dashed border-slate-300 bg-white flex flex-col items-center justify-center text-slate-500 px-6 text-center"><Tv className="w-10 h-10 mb-3 text-slate-300" /><div className="font-semibold text-slate-700">No cameras available</div><div className="text-xs mt-1">{emptyMessage || 'No camera is available to this account yet.'}</div></div>
        ) : (
          <div className={`flex-1 grid gap-3 sm:gap-4 ${gridClass}`}>
            {displayedCameras.map((camera, idx) => {
              const isMuted = !audioStates[camera.id];
              const badge = statusUi[camera.status];
              const absoluteIndex = cameras.findIndex((row) => row.id === camera.id);
              return <div
                id={`camera-tile-${camera.id}`}
                key={camera.id}
                className={`relative bg-slate-950 rounded-xl overflow-hidden border border-slate-800 shadow-md flex flex-col group ${layout === '1+3' && idx === 0 && !isTablet && !isPhone ? 'col-span-2 row-span-2' : ''} ${isPhone ? 'min-h-[58vh] max-h-[72vh]' : ''}`}
                onTouchStart={(e) => { if (isPhone) swipeStartX.current = e.changedTouches[0]?.clientX ?? null; }}
                onTouchEnd={(e) => {
                  if (!isPhone || swipeStartX.current === null || cameras.length < 2) return;
                  const delta = (e.changedTouches[0]?.clientX ?? swipeStartX.current) - swipeStartX.current;
                  swipeStartX.current = null;
                  if (Math.abs(delta) < 55) return;
                  selectMobileIndex(mobileIndex + (delta < 0 ? 1 : -1));
                }}
              >
                <div className="absolute top-0 inset-x-0 z-20 bg-gradient-to-b from-black/85 via-black/45 to-transparent p-2.5 sm:p-3 flex items-start justify-between text-white gap-2">
                  <div className="flex items-center gap-2 min-w-0"><Tv className="w-4 h-4 text-slate-300 shrink-0" /><div className="min-w-0"><div className="text-sm font-semibold truncate">{camera.name}</div><div className="text-[10px] sm:text-[11px] text-slate-300 truncate">{camera.location || 'Location not set'}</div></div></div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <div className="hidden sm:flex">{camera.source_type === 'usb' && <div className="items-center gap-1 px-2 py-0.5 rounded-full bg-blue-950/80 border border-blue-500/40 text-blue-300 text-[10px] font-semibold flex"><Usb className="w-2.5 h-2.5" />DIRECTSHOW</div>}</div>
                    <div className={`flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-full border text-[10px] sm:text-[11px] font-semibold ${badge.cls}`}><span className={`w-2 h-2 rounded-full ${badge.dot} ${['online', 'starting', 'retrying', 'reconnecting'].includes(camera.status) ? 'animate-pulse' : ''}`} />{badge.label}</div>
                    <div className="relative"><button onClick={() => setOpenMenuCameraId(openMenuCameraId === camera.id ? null : camera.id)} className="mobile-touch-target w-9 h-9 rounded-lg hover:bg-white/10 flex items-center justify-center"><MoreVertical className="w-4 h-4" /></button>{openMenuCameraId === camera.id && <div className="absolute right-0 mt-1 w-52 bg-slate-900 border border-slate-700 rounded-xl shadow-xl p-1.5 z-40 text-xs"><button onClick={(e) => { snapshot(camera, e); setOpenMenuCameraId(null); }} className="mobile-touch-target w-full text-left px-3 py-2 rounded-lg hover:bg-slate-800 flex items-center gap-2"><CameraIcon className="w-4 h-4 text-blue-400" />Capture Snapshot</button>{onOpenRecordingsForCamera && (!canOpenRecordingsForCamera || canOpenRecordingsForCamera(camera.id)) && <button onClick={() => { onOpenRecordingsForCamera(camera.id); setOpenMenuCameraId(null); }} className="mobile-touch-target w-full text-left px-3 py-2 rounded-lg hover:bg-slate-800">View Recorded Clips</button>}{onOpenDiagnosticsForCamera && <button onClick={() => { onOpenDiagnosticsForCamera(camera.id); setOpenMenuCameraId(null); }} className="mobile-touch-target w-full text-left px-3 py-2 rounded-lg hover:bg-slate-800 flex items-center gap-2"><RotateCw className="w-4 h-4" />Camera Diagnostics</button>}</div>}</div>
                  </div>
                </div>

                <div className="flex-1 relative overflow-hidden bg-black min-h-[250px] touch-pan-y" onDoubleClick={() => !isPhone && toggleFullFocus(camera.id)}>
                  <CameraPlayer camera={camera} muted={isMuted} />
                  <div className="absolute top-12 left-2.5 sm:left-3 z-10 text-[10px] sm:text-[11px] font-mono text-white/90 bg-black/45 px-2 py-1 rounded"><span className="text-emerald-400 font-bold mr-2">CAM {absoluteIndex + 1}</span><span className="hidden sm:inline">{liveTimestamp}</span></div>
                  {isPhone && cameras.length > 1 && <>
                    <button onClick={() => selectMobileIndex(mobileIndex - 1)} aria-label="Previous camera" className="absolute left-2 top-1/2 -translate-y-1/2 z-20 w-11 h-11 rounded-full bg-black/45 border border-white/15 text-white flex items-center justify-center backdrop-blur-sm"><ChevronLeft className="w-6 h-6" /></button>
                    <button onClick={() => selectMobileIndex(mobileIndex + 1)} aria-label="Next camera" className="absolute right-2 top-1/2 -translate-y-1/2 z-20 w-11 h-11 rounded-full bg-black/45 border border-white/15 text-white flex items-center justify-center backdrop-blur-sm"><ChevronRight className="w-6 h-6" /></button>
                  </>}
                </div>

                <div className="absolute bottom-0 inset-x-0 z-20 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-2.5 sm:px-3 py-2.5 flex items-end justify-between text-white text-xs gap-2">
                  <div className="min-w-0 font-mono text-[10px] sm:text-[11px] text-slate-300"><div className="sm:hidden truncate">{camera.resolution} • {camera.fps} FPS • {camera.codec}</div><div className="hidden sm:flex items-center gap-3"><span>{camera.resolution}</span><span>{camera.fps} FPS</span><span>{camera.bitrate}</span><span className="text-slate-400">{camera.codec}</span></div></div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={(e) => toggleAudio(camera.id, e)} className="mobile-touch-target w-10 h-10 rounded-lg hover:bg-white/20 flex items-center justify-center" aria-label={isMuted ? 'Unmute' : 'Mute'}>{isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4 text-blue-400" />}</button>
                    <button onClick={(e) => snapshot(camera, e)} className="mobile-touch-target w-10 h-10 rounded-lg hover:bg-white/20 flex items-center justify-center" aria-label="Capture snapshot"><CameraIcon className="w-4 h-4" /></button>
                    <button onClick={() => isPhone ? void requestCameraFullscreen(camera) : toggleFullFocus(camera.id)} className="mobile-touch-target w-10 h-10 rounded-lg hover:bg-white/20 flex items-center justify-center" aria-label="Fullscreen">{fullFocusCameraId === camera.id && !isPhone ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}</button>
                  </div>
                </div>
              </div>;
            })}
          </div>
        )}

        {isPhone && cameras.length > 0 && <div className="mt-3 flex items-center justify-center gap-1.5" aria-label="Camera position">{cameras.map((camera) => <button key={camera.id} aria-label={`Open ${camera.name}`} onClick={() => setMobileFocusCameraId(camera.id)} className={`h-1.5 rounded-full transition-all ${camera.id === mobileFocusCameraId ? 'w-6 bg-blue-600' : 'w-1.5 bg-slate-300'}`} />)}</div>}

        <div className="mt-3 sm:mt-5 bg-white rounded-xl border border-slate-200/90 p-3 sm:p-3.5 shadow-xs text-xs text-slate-600">
          <div className="grid grid-cols-2 sm:flex sm:items-center gap-3 sm:gap-8">
            <div className="flex items-center gap-2 sm:gap-3"><div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0"><Radio className="w-4 h-4" /></div><div><div className="font-semibold text-slate-900">Playback</div><div className="text-emerald-600 text-[10px] sm:text-xs">WebRTC • HLS fallback</div></div></div>
            <div><div className="font-semibold text-slate-900">Streams</div><div>{onlineCount} online / {cameras.length} configured</div></div>
            <div className="hidden md:block"><div className="font-semibold text-slate-900">Access</div><div>Signed-in • short-lived media token</div></div>
            <div className="sm:hidden col-span-2"><RemoteConnectionBadge /></div>
          </div>
        </div>
      </div>
    </div>
  );
};
