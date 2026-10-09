import React, { useEffect, useState } from 'react';
import { 
  Video, 
  Plus, 
  Search, 
  List, 
  Grid2X2, 
  Eye, 
  Edit2, 
  MoreVertical, 
  X, 
  Check, 
  ExternalLink, 
  Wrench, 
  Settings, 
  Sliders, 
  ChevronRight, 
  MapPin, 
  ShieldCheck, 
  RotateCw,
  Trash2,
  Tv,
  Usb,
  Cpu,
  Activity,
  Play
} from 'lucide-react';
import { Camera, CameraStatus, MotionRuntime, MotionZone, AiRuntime } from '../../types/cctv';
import { startCamera, stopCamera, updateCamera, startContinuousRecording, stopContinuousRecording, getCameraMotion, updateCameraMotion, createMotionZone, updateMotionZone, deleteMotionZone, getCameraAi, updateCameraAi, pauseCameraAi, resumeCameraAi } from '../../api';
import { AddUsbCameraModal } from './AddUsbCameraModal';
import { AddNetworkCameraModal } from './AddNetworkCameraModal';

interface CamerasViewProps {
  cameras: Camera[];
  setCameras: React.Dispatch<React.SetStateAction<Camera[]>>;
  onOpenLiveViewForCamera: (cameraId: string) => void;
  onOpenDiagnosticsForCamera: (cameraId: string) => void;
  onRegistryChanged?: () => void | Promise<void>;
}

export const CamerasView: React.FC<CamerasViewProps> = ({
  cameras,
  setCameras,
  onOpenLiveViewForCamera,
  onOpenDiagnosticsForCamera,
  onRegistryChanged
}) => {
  const [selectedCameraId, setSelectedCameraId] = useState<string>('camera-1');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [locationFilter, setLocationFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [isAddUsbModalOpen, setIsAddUsbModalOpen] = useState<boolean>(false);
  const [editingCamera, setEditingCamera] = useState<Camera | null>(null);
  const [motionRuntime, setMotionRuntime] = useState<MotionRuntime | null>(null);
  const [motionBusy, setMotionBusy] = useState(false);
  const [zoneBusy, setZoneBusy] = useState<number | 'new' | null>(null);
  const [aiRuntime, setAiRuntime] = useState<AiRuntime | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  const selectedCamera = cameras.find(c => c.id === selectedCameraId) || cameras[0];

  useEffect(() => {
    let cancelled = false;
    if (!selectedCamera?.id || selectedCamera.source_type !== 'usb') { setMotionRuntime(null); setAiRuntime(null); return; }
    void getCameraMotion(selectedCamera.id).then((value) => { if (!cancelled) setMotionRuntime(value); }).catch(() => { if (!cancelled) setMotionRuntime(null); });
    void getCameraAi(selectedCamera.id).then((value) => { if (!cancelled) setAiRuntime(value); }).catch(() => { if (!cancelled) setAiRuntime(null); });
    return () => { cancelled = true; };
  }, [selectedCamera?.id, selectedCamera?.source_type]);

  // Filtering
  const filteredCameras = cameras.filter(cam => {
    const matchesSearch = cam.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          cam.location.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          cam.address.includes(searchQuery);
    const matchesStatus = statusFilter === 'all' || cam.status === statusFilter;
    const matchesLocation = locationFilter === 'all' || cam.location.toLowerCase().includes(locationFilter.toLowerCase());
    return matchesSearch && matchesStatus && matchesLocation;
  });

  const toggleCameraEnabled = async (id: string) => {
    const camera = cameras.find(c => c.id === id);
    if (!camera) return;
    setCameras(prev => prev.map(c => c.id === id ? { ...c, status: camera.enabled ? 'offline' : 'starting' } : c));
    try {
      const updated = camera.enabled ? await stopCamera(id) : await startCamera(id);
      setCameras(prev => prev.map(c => c.id === id ? updated : c));
      await onRegistryChanged?.();
    } catch (error: any) {
      setCameras(prev => prev.map(c => c.id === id ? { ...c, status: 'error', last_error: error?.message || String(error) } : c));
    }
  };


  const toggleRecording = async (id: string) => {
    const camera = cameras.find(c => c.id === id);
    if (!camera || camera.source_type !== 'usb') return;
    try {
      const result = camera.recording ? await stopContinuousRecording(id) : await startContinuousRecording(id);
      setCameras(prev => prev.map(c => c.id === id ? result.camera : c));
      await onRegistryChanged?.();
    } catch (error: any) {
      setCameras(prev => prev.map(c => c.id === id ? { ...c, last_error: error?.message || String(error) } : c));
    }
  };


  const patchMotion = async (patch: Record<string, unknown>) => {
    if (!selectedCamera || selectedCamera.source_type !== 'usb') return;
    setMotionBusy(true);
    try {
      const updated = await updateCameraMotion(selectedCamera.id, patch as any);
      setMotionRuntime(updated);
      await onRegistryChanged?.();
    } catch (error: any) {
      window.alert(error?.message || 'Could not update motion detection settings.');
    } finally { setMotionBusy(false); }
  };


  const patchAi = async (patch: Record<string, unknown>) => {
    if (!selectedCamera || selectedCamera.source_type !== 'usb') return;
    setAiBusy(true);
    try { const updated = await updateCameraAi(selectedCamera.id, patch as any); setAiRuntime(updated); }
    catch (error: any) { window.alert(error?.message || 'Could not update AI detection settings.'); }
    finally { setAiBusy(false); }
  };

  const refreshMotion = async () => {
    if (!selectedCamera || selectedCamera.source_type !== 'usb') return;
    const updated = await getCameraMotion(selectedCamera.id);
    setMotionRuntime(updated);
  };

  const addMotionZone = async () => {
    if (!selectedCamera || selectedCamera.source_type !== 'usb') return;
    setZoneBusy('new');
    try {
      await createMotionZone(selectedCamera.id, { name: `Zone ${(motionRuntime?.zones.length || 0) + 1}`, enabled: true, x: 0, y: 0, width: 50, height: 50, sensitivity: null });
      await refreshMotion();
    } catch (error: any) { window.alert(error?.message || 'Could not create motion zone.'); }
    finally { setZoneBusy(null); }
  };

  const saveMotionZone = async (zone: MotionZone) => {
    if (!selectedCamera || selectedCamera.source_type !== 'usb') return;
    setZoneBusy(zone.id);
    try {
      await updateMotionZone(selectedCamera.id, zone.id, { name: zone.name, enabled: zone.enabled, x: zone.x, y: zone.y, width: zone.width, height: zone.height, sensitivity: zone.sensitivity });
      await refreshMotion();
    } catch (error: any) { window.alert(error?.message || 'Could not save motion zone.'); }
    finally { setZoneBusy(null); }
  };

  const removeMotionZone = async (zone: MotionZone) => {
    if (!selectedCamera || selectedCamera.source_type !== 'usb') return;
    if (!window.confirm(`Delete motion zone "${zone.name}"? Existing events keep the saved zone name.`)) return;
    setZoneBusy(zone.id);
    try { await deleteMotionZone(selectedCamera.id, zone.id); await refreshMotion(); }
    catch (error: any) { window.alert(error?.message || 'Could not delete motion zone.'); }
    finally { setZoneBusy(null); }
  };

  const editZoneLocal = (zoneId: number, patch: Partial<MotionZone>) => {
    if (!motionRuntime) return;
    setMotionRuntime({ ...motionRuntime, zones: motionRuntime.zones.map((zone) => zone.id === zoneId ? { ...zone, ...patch } : zone) });
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCamera) return;
    try {
      const updated = await updateCamera(editingCamera.id, { name: editingCamera.name, location: editingCamera.location });
      setCameras(prev => prev.map(c => c.id === updated.id ? updated : c));
      setEditingCamera(null);
      await onRegistryChanged?.();
    } catch (error: any) {
      window.alert(error?.message || 'Could not save camera metadata.');
    }
  };

  return (
    <div className="flex-1 flex h-full bg-[#f4f6fa] overflow-hidden">
      {/* Left/Center Area: Camera List & Controls */}
      <div className="flex-1 flex flex-col h-full overflow-y-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100">
              <Video className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Cameras</h1>
              <p className="text-xs text-slate-500 font-medium">Manage your cameras, settings, and status</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsAddUsbModalOpen(true)}
              className="flex items-center gap-2 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg shadow-sm border border-slate-700 transition-colors cursor-pointer"
              title="Add local DirectShow USB Webcam"
            >
              <Usb className="w-4 h-4 text-sky-400" />
              <span>Add USB Camera</span>
            </button>

            <button
              onClick={() => setIsAddModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Add Camera</span>
            </button>
          </div>
        </div>

        {/* Search & Filter Bar */}
        <div className="flex items-center gap-3 mb-4">
          {/* Search Box */}
          <div className="flex-1 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search cameras..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-xs"
            />
          </div>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-white border border-slate-200 text-slate-700 text-xs font-medium rounded-lg px-3 py-2 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-xs"
          >
            <option value="all">All Statuses</option>
            <option value="online">Online</option>
            <option value="starting">Starting / Reconnecting</option>
            <option value="offline">Offline</option>
          </select>

          {/* Location Filter */}
          <select
            value={locationFilter}
            onChange={(e) => setLocationFilter(e.target.value)}
            className="bg-white border border-slate-200 text-slate-700 text-xs font-medium rounded-lg px-3 py-2 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-xs"
          >
            <option value="all">All Locations</option>
            <option value="front">Front Entrance</option>
            <option value="garage">Garage</option>
            <option value="rear">Rear Yard</option>
            <option value="indoor">Indoor</option>
            <option value="side">Side Entrance</option>
          </select>

          {/* View Mode Switcher (List vs Grid) */}
          <div className="flex items-center bg-white p-1 rounded-lg border border-slate-200 shadow-xs">
            <button
              onClick={() => setViewMode('list')}
              title="List View"
              className={`p-1.5 rounded-md cursor-pointer transition-colors ${
                viewMode === 'list' 
                  ? 'bg-blue-600 text-white shadow-xs' 
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <List className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('grid')}
              title="Grid View"
              className={`p-1.5 rounded-md cursor-pointer transition-colors ${
                viewMode === 'grid' 
                  ? 'bg-blue-600 text-white shadow-xs' 
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Grid2X2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* List View Table */}
        {viewMode === 'list' ? (
          <div className="bg-white rounded-xl border border-slate-200/80 shadow-xs overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200/80 text-slate-500 font-semibold uppercase text-[11px] tracking-wider">
                <tr>
                  <th className="py-3 px-4 w-10">
                    <input type="checkbox" className="rounded border-slate-300 text-blue-600" />
                  </th>
                  <th className="py-3 px-4">Camera Name</th>
                  <th className="py-3 px-4">Address</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Recording</th>
                  <th className="py-3 px-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredCameras.map((camera) => {
                  const isSelected = selectedCameraId === camera.id;
                  return (
                    <tr
                      key={camera.id}
                      onClick={() => setSelectedCameraId(camera.id)}
                      className={`cursor-pointer transition-colors ${
                        isSelected 
                          ? 'bg-blue-50/70 border-l-4 border-l-blue-600' 
                          : 'hover:bg-slate-50/80'
                      }`}
                    >
                      <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" className="rounded border-slate-300 text-blue-600" />
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          {camera.image ? (
                            <img
                              src={camera.image}
                              alt={camera.name}
                              className="w-14 h-9 rounded object-cover border border-slate-200 shadow-2xs"
                            />
                          ) : (
                            <div className="w-14 h-9 rounded bg-slate-100 border border-slate-200 flex items-center justify-center" title="No stored preview thumbnail">
                              <Video className="w-4 h-4 text-slate-400" />
                            </div>
                          )}
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-slate-900 text-sm leading-tight">{camera.name}</span>
                              {camera.source_type === 'usb' && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-semibold">
                                  <Usb className="w-2.5 h-2.5" />
                                  DirectShow
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                              <MapPin className="w-3 h-3 inline text-slate-400" />
                              {camera.location}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-600">
                        {camera.source_type === 'usb' ? (
                          <div className="flex flex-col">
                            <span className="text-slate-800 font-medium font-sans flex items-center gap-1 text-[11px]">
                              <Usb className="w-3 h-3 text-blue-600 shrink-0" />
                              {camera.usb_source?.device_name || 'USB UVC Camera'}
                            </span>
                            <span className="text-[10px] text-slate-400 font-mono">
                              {camera.usb_source?.encoder ? `${camera.usb_source.encoder} • ${camera.resolution}` : 'DirectShow UVC'}
                            </span>
                          </div>
                        ) : (
                          camera.address
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {camera.status === 'online' && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-medium border border-emerald-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                            Online
                          </span>
                        )}
                        {['starting', 'retrying', 'reconnecting', 'configured', 'degraded'].includes(camera.status) && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 text-xs font-medium border border-amber-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                            {camera.status === 'retrying' || camera.status === 'reconnecting' ? 'Retrying' : camera.status === 'degraded' ? 'Degraded' : camera.status === 'starting' ? 'Starting' : 'Configured'}
                          </span>
                        )}
                        {camera.status === 'offline' && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-50 text-rose-700 text-xs font-medium border border-rose-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                            Offline
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {camera.recording ? (
                          <span className="inline-flex items-center gap-1.5 text-slate-700 font-medium">
                            <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>
                            Recording Armed
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-slate-400">
                            <span className="w-2 h-2 rounded-full bg-slate-300"></span>
                            Not Recording
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => onOpenLiveViewForCamera(camera.id)}
                            className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:text-blue-600 hover:border-blue-200 hover:bg-blue-50/50 flex items-center gap-1 transition-colors cursor-pointer text-xs font-medium"
                          >
                            <Eye className="w-3.5 h-3.5 text-blue-600" />
                            <span>View</span>
                          </button>
                          <button
                            onClick={() => setEditingCamera(camera)}
                            className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:text-slate-900 hover:bg-slate-50 flex items-center gap-1 transition-colors cursor-pointer text-xs font-medium"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                            <span>Edit</span>
                          </button>
                          <button
                            onClick={() => onOpenDiagnosticsForCamera(camera.id)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                            title="Diagnostics"
                          >
                            <MoreVertical className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          /* Grid View */
          <div className="grid grid-cols-2 gap-4">
            {filteredCameras.map((camera) => (
              <div
                key={camera.id}
                onClick={() => setSelectedCameraId(camera.id)}
                className={`bg-white rounded-xl border p-4 shadow-xs cursor-pointer transition-all ${
                  selectedCameraId === camera.id
                    ? 'border-blue-500 ring-2 ring-blue-500/20'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="relative rounded-lg overflow-hidden aspect-video bg-black mb-3">
                  {camera.image ? (
                    <img src={camera.image} alt={camera.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-slate-950 text-slate-500">
                      <Video className="w-8 h-8" />
                    </div>
                  )}
                  <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/60 text-white text-[10px] font-mono">
                    {camera.name}
                  </div>
                  <div className="absolute top-2 right-2">
                    {camera.status === 'online' && (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-500 text-white text-[10px] font-semibold">
                        LIVE
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-slate-900 text-sm">{camera.name}</h3>
                    <p className="text-xs text-slate-400">{camera.location} • {camera.address}</p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenLiveViewForCamera(camera.id);
                    }}
                    className="p-2 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Right Drawer / Camera Settings Inspector matching Screenshot 3 */}
      {selectedCamera && (
        <aside className="w-96 bg-white border-l border-slate-200/90 flex flex-col h-full shadow-lg shrink-0 overflow-y-auto">
          {/* Drawer Header */}
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-slate-900">{selectedCamera.name}</h2>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                  selectedCamera.status === 'online' 
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                    : ['starting', 'retrying', 'reconnecting', 'configured', 'degraded'].includes(selectedCamera.status)
                      ? 'bg-amber-50 text-amber-700 border border-amber-200'
                      : 'bg-rose-50 text-rose-700 border border-rose-200'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    selectedCamera.status === 'online' ? 'bg-emerald-500' : ['starting', 'retrying', 'reconnecting', 'configured', 'degraded'].includes(selectedCamera.status) ? 'bg-amber-500' : 'bg-rose-500'
                  }`}></span>
                  {selectedCamera.status.charAt(0).toUpperCase() + selectedCamera.status.slice(1)}
                </span>
              </div>
              <div className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                <MapPin className="w-3 h-3 text-slate-400" />
                <span>{selectedCamera.location}</span>
              </div>
            </div>
          </div>

          <div className="p-4 space-y-5">
            {/* Live Camera Feed Preview */}
            <div className="relative rounded-xl overflow-hidden aspect-video bg-black border border-slate-200 shadow-xs">
              {selectedCamera.image ? (
                <img
                  src={selectedCamera.image}
                  alt={selectedCamera.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center bg-slate-950 text-slate-500 gap-2">
                  <Video className="w-8 h-8" />
                  <span className="text-[11px]">Live stream is available from Live View</span>
                </div>
              )}
              <div className="absolute bottom-2 left-2 px-2 py-0.5 bg-black/60 backdrop-blur-xs text-[10px] text-white font-mono rounded">
                {selectedCamera.resolution} • {selectedCamera.fps} FPS
              </div>
            </div>

            {/* Quick Specs Grid */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                <div className="text-slate-400 text-[11px]">Address</div>
                <div className="font-mono font-semibold text-slate-800 mt-0.5">{selectedCamera.address}</div>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                <div className="text-slate-400 text-[11px]">Model</div>
                <div className="font-semibold text-slate-800 mt-0.5 truncate">{selectedCamera.model}</div>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                <div className="text-slate-400 text-[11px]">Uptime</div>
                <div className="font-semibold text-slate-800 mt-0.5">{selectedCamera.uptime}</div>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                <div className="text-slate-400 text-[11px]">Last Seen</div>
                <div className="font-semibold text-slate-800 mt-0.5 text-[11px]">{selectedCamera.lastSeen}</div>
              </div>
            </div>

            {/* Camera Settings Section */}
            <div>
              <div className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2 flex items-center justify-between">
                <span>{selectedCamera.source_type === 'usb' ? 'DirectShow Capture Pipeline' : 'Camera Settings'}</span>
                {selectedCamera.source_type === 'usb' && (
                  <span className="text-[10px] font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-100 flex items-center gap-1 font-sans">
                    <Usb className="w-3 h-3" />
                    DirectShow
                  </span>
                )}
              </div>
              <div className="bg-slate-50 rounded-xl border border-slate-200/80 divide-y divide-slate-100 text-xs">
                {/* Protocol / Source */}
                <div className="p-3 flex items-center justify-between">
                  <span className="text-slate-600 font-medium">Capture Engine</span>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-blue-700 tracking-wider">
                      {selectedCamera.source_type === 'usb' ? 'DirectShow / UVC' : (selectedCamera.protocol || 'ONVIF')}
                    </span>
                    <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${selectedCamera.status === 'online' ? 'text-emerald-600' : selectedCamera.status === 'starting' ? 'text-amber-600' : 'text-slate-500'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${selectedCamera.status === 'online' ? 'bg-emerald-500' : selectedCamera.status === 'starting' ? 'bg-amber-500' : 'bg-slate-400'}`}></span>
                      {selectedCamera.status === 'online' ? 'Connected' : selectedCamera.status === 'starting' ? 'Starting' : selectedCamera.status}
                    </span>
                    <ChevronRight className="w-4 h-4 text-slate-400" />
                  </div>
                </div>

                {/* DirectShow / USB specific info */}
                {selectedCamera.source_type === 'usb' && (
                  <>
                    <div className="p-3 flex items-center justify-between">
                      <span className="text-slate-600 font-medium">Capture Device</span>
                      <span className="font-semibold text-slate-800 text-right truncate max-w-[180px]">
                        {selectedCamera.usb_source?.device_name || selectedCamera.model}
                      </span>
                    </div>

                    <div className="p-3 flex items-center justify-between">
                      <span className="text-slate-600 font-medium">Encoder</span>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-slate-800 font-semibold uppercase text-[11px]">
                          {selectedCamera.usb_source?.encoder_active || selectedCamera.usb_source?.encoder || selectedCamera.codec}
                        </span>
                        <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-bold rounded">
                          {selectedCamera.usb_source?.encoder_active && selectedCamera.usb_source.encoder_active !== 'libx264' ? 'HW' : 'CPU'}
                        </span>
                      </div>
                    </div>

                    <div className="p-3 flex items-center justify-between">
                      <span className="text-slate-600 font-medium">Input Format</span>
                      <span className="font-mono text-slate-700 uppercase text-[11px]">
                        {selectedCamera.usb_source?.pixel_format || 'MJPEG'}
                      </span>
                    </div>

                    <div className="p-3 flex items-center justify-between">
                      <span className="text-slate-600 font-medium">FFmpeg Pipeline</span>
                      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                        {selectedCamera.status === 'online' ? 'Active • stream online' : `Inactive • ${selectedCamera.status}`}
                      </span>
                    </div>
                  </>
                )}

                {/* RTSP / network camera info (safe metadata only; credentials stay server-side) */}
                {selectedCamera.source_type === 'rtsp' && selectedCamera.rtsp_source && (
                  <>
                    <div className="p-3 flex items-center justify-between">
                      <span className="text-slate-600 font-medium">RTSP Source</span>
                      <div className="text-[11px] text-right max-w-[220px]">
                        <div className="font-mono font-semibold text-slate-700 truncate">{selectedCamera.rtsp_source.host}:{selectedCamera.rtsp_source.port}{selectedCamera.rtsp_source.path}</div>
                        <div className="text-slate-400">{selectedCamera.rtsp_source.vendor_profile === 'tenda-cp3-pro' ? 'Tenda CP3 Pro preset' : 'Generic RTSP'}</div>
                      </div>
                    </div>
                    <div className="p-3 flex items-center justify-between">
                      <span className="text-slate-600 font-medium">RTSP Transport</span>
                      <span className="font-mono text-[11px] uppercase font-semibold text-slate-700">{selectedCamera.rtsp_source.transport}</span>
                    </div>
                    <div className="p-3 flex items-center justify-between">
                      <span className="text-slate-600 font-medium">Video Handling</span>
                      <div className="text-[11px] text-right">
                        <div className="font-semibold text-slate-700">{selectedCamera.rtsp_source.video_mode === 'copy' ? 'Stream copy' : 'H.264 transcode'}</div>
                        <div className="text-slate-400 font-mono">{selectedCamera.rtsp_source.video_mode === 'copy' ? 'source codec' : (selectedCamera.rtsp_source.encoder_active || selectedCamera.rtsp_source.encoder || 'auto')}</div>
                      </div>
                    </div>
                    <div className="p-3 flex items-center justify-between">
                      <span className="text-slate-600 font-medium">Credentials</span>
                      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">Stored server-side</span>
                    </div>
                  </>
                )}

                {/* PTZ capability */}
                {selectedCamera.source_type !== 'usb' && (
                  <div className="p-3 flex items-center justify-between">
                    <span className="text-slate-600 font-medium">PTZ Capability</span>
                    <div className="text-[11px] text-right">
                      <div className="font-semibold text-slate-700">{selectedCamera.ptz ? 'Camera supports PTZ' : 'Not reported'}</div>
                      <div className="text-slate-400">Control integration planned</div>
                    </div>
                  </div>
                )}

                {/* Main Stream */}
                <div className="p-3 flex items-center justify-between">
                  <span className="text-slate-600 font-medium">Stream Format</span>
                  <div className="flex items-center gap-2 font-mono text-[11px] text-slate-700">
                    <span>{selectedCamera.resolution} {selectedCamera.fps} FPS</span>
                    <ChevronRight className="w-4 h-4 text-slate-400" />
                  </div>
                </div>

                {/* Substream */}
                <div className="p-3 flex items-center justify-between">
                  <span className="text-slate-600 font-medium">Substream</span>
                  <div className="flex items-center gap-2 font-mono text-[11px] text-slate-700">
                    <span>{selectedCamera.substream}</span>
                    <ChevronRight className="w-4 h-4 text-slate-400" />
                  </div>
                </div>
              </div>
            </div>

            {/* Camera Control Section */}
            <div>
              <div className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2">Camera Control</div>
              <div className="bg-slate-50 rounded-xl border border-slate-200/80 divide-y divide-slate-100 text-xs">
                {/* Enable Camera Toggle */}
                <div className="p-3 flex items-center justify-between">
                  <span className="text-slate-700 font-semibold">Enable Camera</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleCameraEnabled(selectedCamera.id)}
                      className={`w-10 h-5 flex items-center rounded-full p-1 cursor-pointer transition-colors ${
                        selectedCamera.enabled ? 'bg-blue-600 justify-end' : 'bg-slate-300 justify-start'
                      }`}
                    >
                      <span className="w-3.5 h-3.5 rounded-full bg-white shadow-xs"></span>
                    </button>
                    <span className="text-slate-600 font-medium text-[11px] w-14">
                      {selectedCamera.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                </div>

                {/* Recording Toggle */}
                <div className="p-3 flex items-center justify-between">
                  <span className="text-slate-700 font-semibold">Recording</span>
                  <div className="flex items-center gap-2">
                    <button
                      disabled={selectedCamera.source_type !== 'usb'}
                      onClick={() => void toggleRecording(selectedCamera.id)}
                      title={selectedCamera.source_type === 'usb' ? 'Toggle continuous recording' : 'P0.16.1 recording is currently qualified for USB cameras only'}
                      className={`w-10 h-5 flex items-center rounded-full p-1 transition-colors ${selectedCamera.source_type !== 'usb' ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'} ${
                        selectedCamera.recording ? 'bg-rose-600 justify-end' : 'bg-slate-300 justify-start'
                      }`}
                    >
                      <span className="w-3.5 h-3.5 rounded-full bg-white shadow-xs"></span>
                    </button>
                    <span className="text-slate-600 font-medium text-[11px]">
                      {selectedCamera.source_type !== 'usb' ? 'USB MVP only' : selectedCamera.recording ? 'Continuous recording armed' : 'Disabled'}
                    </span>
                  </div>
                </div>

                {/* Motion Detection */}
                <div className="p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-slate-700 font-semibold">Motion Detection</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">Low-resolution scene-change analysis from the MediaMTX stream</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        disabled={selectedCamera.source_type !== 'usb' || motionBusy}
                        onClick={() => void patchMotion({ enabled: !(motionRuntime?.enabled ?? false) })}
                        title={selectedCamera.source_type === 'usb' ? 'Enable or disable motion detection' : 'P0.16.1 motion detection is qualified for USB cameras only'}
                        className={`w-10 h-5 flex items-center rounded-full p-1 transition-colors ${selectedCamera.source_type !== 'usb' || motionBusy ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'} ${motionRuntime?.enabled ? 'bg-violet-600 justify-end' : 'bg-slate-300 justify-start'}`}
                      >
                        <span className="w-3.5 h-3.5 rounded-full bg-white shadow-xs"></span>
                      </button>
                      <span className="text-[11px] text-slate-600 min-w-[54px]">{selectedCamera.source_type !== 'usb' ? 'USB only' : motionRuntime?.active ? 'Active' : motionRuntime?.enabled ? 'Armed' : 'Off'}</span>
                    </div>
                  </div>
                  {selectedCamera.source_type === 'usb' && motionRuntime && (
                    <>
                      <div>
                        <div className="flex justify-between text-[10px] text-slate-500 mb-1"><span>Sensitivity</span><span className="font-semibold text-slate-700">{motionRuntime.settings.sensitivity}%</span></div>
                        <input type="range" min={1} max={100} value={motionRuntime.settings.sensitivity} disabled={motionBusy} onChange={(e) => setMotionRuntime({ ...motionRuntime, settings: { ...motionRuntime.settings, sensitivity: Number(e.target.value) } })} onMouseUp={(e) => void patchMotion({ sensitivity: Number((e.target as HTMLInputElement).value) })} onTouchEnd={(e) => void patchMotion({ sensitivity: Number((e.target as HTMLInputElement).value) })} className="w-full accent-violet-600" />
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <label className="text-[10px] text-slate-500">Cooldown (s)<input type="number" min={5} max={300} value={motionRuntime.settings.cooldownSeconds} disabled={motionBusy} onChange={(e) => setMotionRuntime({ ...motionRuntime, settings: { ...motionRuntime.settings, cooldownSeconds: Number(e.target.value) } })} onBlur={(e) => void patchMotion({ cooldownSeconds: Number(e.target.value) })} className="mt-1 w-full px-2 py-1.5 rounded border border-slate-200 bg-white text-xs text-slate-700" /></label>
                        <label className="text-[10px] text-slate-500">Link before (s)<input type="number" min={0} max={120} value={motionRuntime.settings.preSeconds} disabled={motionBusy} onChange={(e) => setMotionRuntime({ ...motionRuntime, settings: { ...motionRuntime.settings, preSeconds: Number(e.target.value) } })} onBlur={(e) => void patchMotion({ preSeconds: Number(e.target.value) })} className="mt-1 w-full px-2 py-1.5 rounded border border-slate-200 bg-white text-xs text-slate-700" /></label>
                        <label className="text-[10px] text-slate-500">Link after (s)<input type="number" min={5} max={300} value={motionRuntime.settings.postSeconds} disabled={motionBusy} onChange={(e) => setMotionRuntime({ ...motionRuntime, settings: { ...motionRuntime.settings, postSeconds: Number(e.target.value) } })} onBlur={(e) => void patchMotion({ postSeconds: Number(e.target.value) })} className="mt-1 w-full px-2 py-1.5 rounded border border-slate-200 bg-white text-xs text-slate-700" /></label>
                      </div>
                      <div className="rounded-lg border border-violet-100 bg-violet-50/50 p-2.5 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div><div className="text-[10px] font-semibold text-violet-800">Motion Zones</div><div className="text-[9px] text-violet-600">No zones = full-frame detection. With zones, only enabled rectangles are analyzed.</div></div>
                          <button disabled={zoneBusy !== null || motionRuntime.zones.length >= 4} onClick={() => void addMotionZone()} className="px-2 py-1 rounded border border-violet-200 bg-white text-[10px] font-semibold text-violet-700 disabled:opacity-40">{zoneBusy === 'new' ? 'Adding…' : '+ Add Zone'}</button>
                        </div>
                        {motionRuntime.zones.length === 0 ? <div className="text-[10px] text-slate-500 rounded bg-white border border-violet-100 p-2">Whole frame is currently analyzed.</div> : motionRuntime.zones.map((zone) => (
                          <div key={zone.id} className="rounded-lg border border-violet-100 bg-white p-2 space-y-2">
                            <div className="flex items-center gap-2">
                              <input value={zone.name} maxLength={50} onChange={(e) => editZoneLocal(zone.id, { name: e.target.value })} className="min-w-0 flex-1 px-2 py-1 rounded border border-slate-200 text-[10px] font-semibold" />
                              <label className="flex items-center gap-1 text-[9px] text-slate-500"><input type="checkbox" checked={zone.enabled} onChange={(e) => editZoneLocal(zone.id, { enabled: e.target.checked })} />Enabled</label>
                            </div>
                            <div className="grid grid-cols-5 gap-1">
                              {([['Left', 'x'], ['Top', 'y'], ['Width', 'width'], ['Height', 'height']] as const).map(([label, key]) => <label key={key} className="text-[9px] text-slate-500">{label}%<input type="number" min={key === 'width' || key === 'height' ? 5 : 0} max={100} value={zone[key]} onChange={(e) => editZoneLocal(zone.id, { [key]: Number(e.target.value) } as Partial<MotionZone>)} className="mt-0.5 w-full px-1 py-1 rounded border border-slate-200 text-[10px]" /></label>)}
                              <label className="text-[9px] text-slate-500">Sens.%<input type="number" min={0} max={100} value={zone.sensitivity ?? 0} onChange={(e) => editZoneLocal(zone.id, { sensitivity: Number(e.target.value) === 0 ? null : Number(e.target.value) })} title="0 = inherit camera sensitivity" className="mt-0.5 w-full px-1 py-1 rounded border border-slate-200 text-[10px]" /></label>
                            </div>
                            <div className="flex items-center justify-between"><span className="text-[9px] text-slate-400">Sensitivity {zone.sensitivity ?? motionRuntime.settings.sensitivity}% {zone.sensitivity == null ? '(inherited)' : ''}</span><div className="flex gap-1"><button disabled={zoneBusy !== null} onClick={() => void saveMotionZone(zone)} className="px-2 py-1 rounded bg-violet-600 text-white text-[9px] font-semibold disabled:opacity-40">{zoneBusy === zone.id ? 'Saving…' : 'Save'}</button><button disabled={zoneBusy !== null} onClick={() => void removeMotionZone(zone)} className="px-2 py-1 rounded border border-rose-200 text-rose-600 text-[9px] font-semibold disabled:opacity-40">Delete</button></div></div>
                          </div>
                        ))}
                      </div>
                      <div className="text-[10px] text-slate-400">Threshold {motionRuntime.threshold.toFixed(3)} • analyzers {motionRuntime.analyzerCount} • active zones {motionRuntime.activeZoneCount} • last motion {motionRuntime.lastDetectedAt ? new Date(motionRuntime.lastDetectedAt).toLocaleTimeString() : 'none'}{motionRuntime.lastError ? ` • ${motionRuntime.lastError}` : ''}</div>
                      {!selectedCamera.recording && motionRuntime.enabled && <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-[10px] text-amber-800">Motion events and snapshots will still be saved, but linked footage requires Continuous Recording to be armed.</div>}
                    </>
                  )}
                </div>
              </div>
            </div>


            {selectedCamera.source_type === 'usb' && aiRuntime && (
              <div className="rounded-xl border border-cyan-200 bg-cyan-50/60 p-3 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2"><Cpu className="w-4 h-4 text-cyan-700"/><div><div className="text-xs font-semibold text-slate-800">AI Person / Vehicle Detection</div><div className="text-[9px] text-slate-500">Local ONNX inference with P0.16.1 tuning, motion gating, review feedback and overload backoff.</div></div></div>
                  <button disabled={aiBusy || !aiRuntime.modelInstalled} onClick={()=>void patchAi({enabled:!aiRuntime.enabled})} className={`w-10 h-5 flex items-center rounded-full p-1 transition-colors ${aiRuntime.enabled?'bg-cyan-600 justify-end':'bg-slate-300 justify-start'} disabled:opacity-40`}><span className="w-3 h-3 bg-white rounded-full shadow"/></button>
                </div>
                {!aiRuntime.modelInstalled && <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-[10px] text-amber-800">AI model is not installed. Run <span className="font-mono">INSTALL-AI-MODEL-P0.16.1.cmd</span> on the CCTV PC.</div>}

                <div className="grid sm:grid-cols-2 gap-2 text-[10px]">
                  <label className="text-slate-500">Performance profile
                    <select value={aiRuntime.settings.performanceProfile} onChange={(e)=>void patchAi({performanceProfile:e.target.value})} className="mt-1 w-full px-2 py-1.5 rounded border border-cyan-200 bg-white text-xs">
                      <option value="low_cpu">Low CPU</option><option value="balanced">Balanced</option><option value="high_accuracy">High Accuracy</option><option value="custom">Custom</option>
                    </select>
                  </label>
                  <label className="text-slate-500">Trigger mode
                    <select value={aiRuntime.settings.triggerMode} onChange={(e)=>void patchAi({triggerMode:e.target.value})} className="mt-1 w-full px-2 py-1.5 rounded border border-cyan-200 bg-white text-xs"><option value="continuous">Continuous sampling</option><option value="motion">Only after motion</option></select>
                  </label>
                  <label className="text-slate-500">Person confidence %<input type="number" min={20} max={95} value={aiRuntime.settings.personConfidencePercent} onChange={(e)=>setAiRuntime({...aiRuntime,settings:{...aiRuntime.settings,personConfidencePercent:Number(e.target.value),performanceProfile:'custom'}})} onBlur={(e)=>void patchAi({personConfidencePercent:Number(e.target.value),performanceProfile:'custom'})} className="mt-1 w-full px-2 py-1.5 rounded border border-cyan-200 bg-white text-xs"/></label>
                  <label className="text-slate-500">Vehicle confidence %<input type="number" min={20} max={95} value={aiRuntime.settings.vehicleConfidencePercent} onChange={(e)=>setAiRuntime({...aiRuntime,settings:{...aiRuntime.settings,vehicleConfidencePercent:Number(e.target.value),performanceProfile:'custom'}})} onBlur={(e)=>void patchAi({vehicleConfidencePercent:Number(e.target.value),performanceProfile:'custom'})} className="mt-1 w-full px-2 py-1.5 rounded border border-cyan-200 bg-white text-xs"/></label>
                  <label className="text-slate-500">Sample every (s)<input type="number" min={2} max={60} value={aiRuntime.settings.sampleIntervalSeconds} onChange={(e)=>setAiRuntime({...aiRuntime,settings:{...aiRuntime.settings,sampleIntervalSeconds:Number(e.target.value),performanceProfile:'custom'}})} onBlur={(e)=>void patchAi({sampleIntervalSeconds:Number(e.target.value),performanceProfile:'custom'})} className="mt-1 w-full px-2 py-1.5 rounded border border-cyan-200 bg-white text-xs"/></label>
                  <label className="text-slate-500">Cooldown (s)<input type="number" min={5} max={600} value={aiRuntime.settings.cooldownSeconds} onChange={(e)=>setAiRuntime({...aiRuntime,settings:{...aiRuntime.settings,cooldownSeconds:Number(e.target.value)}})} onBlur={(e)=>void patchAi({cooldownSeconds:Number(e.target.value)})} className="mt-1 w-full px-2 py-1.5 rounded border border-cyan-200 bg-white text-xs"/></label>
                </div>

                {aiRuntime.settings.triggerMode === 'motion' && <div className="grid sm:grid-cols-2 gap-2 text-[10px] rounded-lg border border-cyan-100 bg-white/70 p-2">
                  <label className="text-slate-500">Motion gate window (s)<input type="number" min={5} max={300} value={aiRuntime.settings.motionGateSeconds} onChange={(e)=>setAiRuntime({...aiRuntime,settings:{...aiRuntime.settings,motionGateSeconds:Number(e.target.value)}})} onBlur={(e)=>void patchAi({motionGateSeconds:Number(e.target.value)})} className="mt-1 w-full px-2 py-1.5 rounded border border-cyan-200 bg-white text-xs"/></label>
                  <label className="text-slate-500">AI zone scope
                    <select value={aiRuntime.settings.motionZoneId ?? ''} onChange={(e)=>void patchAi({motionZoneId:e.target.value?Number(e.target.value):null})} className="mt-1 w-full px-2 py-1.5 rounded border border-cyan-200 bg-white text-xs"><option value="">Any motion / whole frame</option>{motionRuntime?.zones.filter(z=>z.enabled).map(z=><option key={z.id} value={z.id}>{z.name}</option>)}</select>
                  </label>
                  {!motionRuntime?.enabled && <div className="sm:col-span-2 text-amber-700">Motion-gated AI is waiting because Motion Detection is disabled for this camera.</div>}
                </div>}

                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-3 text-[10px]"><label className="flex items-center gap-1 text-slate-600"><input type="checkbox" checked={aiRuntime.settings.detectPerson} onChange={(e)=>void patchAi({detectPerson:e.target.checked})}/>Person</label><label className="flex items-center gap-1 text-slate-600"><input type="checkbox" checked={aiRuntime.settings.detectVehicle} onChange={(e)=>void patchAi({detectVehicle:e.target.checked})}/>Vehicle</label></div>
                  <div className="flex gap-1"><button disabled={aiBusy || !aiRuntime.enabled} onClick={async()=>{setAiBusy(true);try{setAiRuntime(await pauseCameraAi(selectedCamera.id,15));}finally{setAiBusy(false);}}} className="px-2 py-1 rounded border border-cyan-200 bg-white text-[9px] font-semibold text-cyan-700 disabled:opacity-40">Pause 15m</button><button disabled={aiBusy || !aiRuntime.paused} onClick={async()=>{setAiBusy(true);try{setAiRuntime(await resumeCameraAi(selectedCamera.id));}finally{setAiBusy(false);}}} className="px-2 py-1 rounded border border-cyan-200 bg-white text-[9px] font-semibold text-cyan-700 disabled:opacity-40">Resume</button></div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-[9px]">
                  <div className="rounded bg-white border border-cyan-100 p-2"><div className="text-slate-400">Inference</div><div className="font-semibold text-slate-700">{aiRuntime.lastInferenceMs ?? '—'} ms</div><div className="text-slate-400">avg {aiRuntime.averageInferenceMs ?? '—'} ms</div></div>
                  <div className="rounded bg-white border border-cyan-100 p-2"><div className="text-slate-400">Throughput</div><div className="font-semibold text-slate-700">{aiRuntime.samplesPerMinute}/min</div><div className="text-slate-400">skipped {aiRuntime.skippedSamples}</div></div>
                  <div className="rounded bg-white border border-cyan-100 p-2"><div className="text-slate-400">AI process</div><div className="font-semibold text-slate-700">CPU {aiRuntime.lastAiCpuPercent ?? '—'}%</div><div className="text-slate-400">RSS {aiRuntime.processRssMb} MB</div></div>
                  <div className="rounded bg-white border border-cyan-100 p-2"><div className="text-slate-400">System memory</div><div className="font-semibold text-slate-700">{aiRuntime.systemMemoryPercent}%</div><div className="text-slate-400">backoff {aiRuntime.backoffSeconds}s</div></div>
                </div>
                <div className="rounded bg-white/70 border border-cyan-100 p-2 text-[9px] text-slate-600">Reviewed {aiRuntime.feedback.totalReviewed} • false detections {aiRuntime.feedback.falseDetections} • false-positive rate {aiRuntime.feedback.falsePositiveRatePercent == null ? '—' : `${aiRuntime.feedback.falsePositiveRatePercent}%`}</div>
                <div className="text-[9px] text-slate-500">{aiRuntime.paused?'Paused':aiRuntime.active?'Analyzing now':aiRuntime.waitingForMotion?'Armed • waiting for motion':aiRuntime.enabled?'Armed':'Off'} • model {aiRuntime.modelInstalled?'ready':'missing'} • last success {aiRuntime.lastSuccessfulInferenceAt?new Date(aiRuntime.lastSuccessfulInferenceAt).toLocaleTimeString():'none'}{aiRuntime.lastError?` • ${aiRuntime.lastError}`:''}</div>
                {!selectedCamera.recording && aiRuntime.enabled && <div className="text-[9px] text-amber-700">AI events and snapshots will still be saved, but linked footage requires Continuous Recording.</div>}
              </div>
            )}

            {/* Action Buttons */}
            <div className="space-y-2 pt-2">
              <button
                onClick={() => onOpenLiveViewForCamera(selectedCamera.id)}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-2 shadow-xs transition-colors cursor-pointer"
              >
                <ExternalLink className="w-4 h-4" />
                <span>Open Live View</span>
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setEditingCamera(selectedCamera)}
                  className="py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  <span>Edit Camera</span>
                </button>
                <button
                  onClick={() => onOpenDiagnosticsForCamera(selectedCamera.id)}
                  className="py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  <span>Run Diagnostics</span>
                </button>
              </div>
            </div>
          </div>
        </aside>
      )}

      {/* Network RTSP / Tenda camera setup */}
      {isAddModalOpen && (
        <AddNetworkCameraModal
          onClose={() => setIsAddModalOpen(false)}
          onAdded={async (newCam) => {
            setCameras(prev => [...prev.filter(c => c.id !== newCam.id), newCam]);
            setSelectedCameraId(newCam.id);
            await onRegistryChanged?.();
          }}
        />
      )}

      {/* Edit Camera Modal */}
      {editingCamera && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                  <Edit2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base">Edit {editingCamera.name}</h3>
                  <p className="text-xs text-slate-400">Update stream parameters and metadata</p>
                </div>
              </div>
              <button 
                onClick={() => setEditingCamera(null)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="p-5 space-y-4 text-xs">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Camera Name</label>
                <input
                  type="text"
                  value={editingCamera.name}
                  onChange={(e) => setEditingCamera({ ...editingCamera, name: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-800"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Location</label>
                <input
                  type="text"
                  value={editingCamera.location}
                  onChange={(e) => setEditingCamera({ ...editingCamera, location: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-800"
                />
              </div>

              <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-[11px] text-blue-900">Stream/capture parameters are intentionally read-only here. Use the camera-specific setup workflow and Diagnostics so displayed settings always match the backend.</div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingCamera(null)}
                  className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-sm cursor-pointer"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DirectShow USB Camera Modal */}
      <AddUsbCameraModal
        isOpen={isAddUsbModalOpen}
        onClose={() => setIsAddUsbModalOpen(false)}
        onCameraAdded={(newCam) => {
          setCameras(prev => [...prev.filter(c => c.id !== newCam.id), newCam]);
          setSelectedCameraId(newCam.id);
          void onRegistryChanged?.();
        }}
      />
    </div>
  );
};
