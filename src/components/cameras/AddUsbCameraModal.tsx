import React, { useEffect, useMemo, useState } from 'react';
import {
  Usb,
  RotateCw,
  CheckCircle2,
  AlertTriangle,
  Cpu,
  Video,
  Play,
  Check,
  Search,
  Copy,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  X,
  Layers,
  HardDrive,
  Camera as CameraIcon,
  Save,
  Server,
  Radio,
  Info,
} from 'lucide-react';
import type { Camera, UsbEncoder, UsbFormat, UsbProbe } from '../../types/cctv';
import {
  ApiError,
  getUsbDevices,
  getUsbEncoders,
  getUsbFormats,
  probeUsbDevice,
  registerUsbCamera,
  type MappedUsbDevice,
} from '../../api';

export interface AddUsbCameraModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCameraAdded?: (camera: Camera) => void;
}

type StartState = 'idle' | 'starting' | 'online' | 'failed';
type SaveMode = 'config' | 'start' | null;

const encoderOrder = ['h264_nvenc', 'h264_qsv', 'h264_amf', 'libx264'];

function formatFps(value: number | undefined): string {
  const fps = Number(value || 0);
  if (!Number.isFinite(fps)) return '0';
  if (Math.abs(fps - Math.round(fps)) < 0.01) return String(Math.round(fps));
  return fps.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function preferredFormatIndex(formats: UsbFormat[]): number {
  if (!formats.length) return -1;
  const fps = (f: UsbFormat) => Number(f.max_fps || 0);
  const find = (test: (f: UsbFormat) => boolean) => formats.findIndex(test);
  const priorities = [
    find((f) => f.width === 1920 && f.height === 1080 && fps(f) >= 29 && fps(f) <= 31),
    find((f) => f.width === 1920 && f.height === 1080 && fps(f) >= 23 && fps(f) <= 31),
    find((f) => f.width === 1280 && f.height === 720 && fps(f) >= 29 && fps(f) <= 31),
    find((f) => f.width === 1280 && f.height === 720 && fps(f) >= 23 && fps(f) <= 31),
  ];
  for (const index of priorities) if (index >= 0) return index;

  // Prefer the highest <=1080p mode at <=30 FPS before falling back to the first reported mode.
  const candidates = formats
    .map((f, index) => ({ f, index }))
    .filter(({ f }) => f.width <= 1920 && f.height <= 1080 && fps(f) > 0 && fps(f) <= 31)
    .sort((a, b) => (b.f.width * b.f.height) - (a.f.width * a.f.height) || fps(b.f) - fps(a.f));
  return candidates[0]?.index ?? 0;
}

function recommendedBitrate(width: number, height: number, fps: number): number {
  const pixels = width * height;
  const highFps = fps > 45;
  if (pixels <= 1280 * 720) return highFps ? 4000 : 2500;
  if (pixels <= 1920 * 1080) return highFps ? 6000 : 4500;
  if (pixels <= 2560 * 1440) return highFps ? 9000 : 7000;
  return highFps ? 12000 : 10000;
}

function encoderFriendlyName(name: string): string {
  if (name === 'h264_nvenc') return 'NVIDIA NVENC';
  if (name === 'h264_qsv') return 'Intel Quick Sync';
  if (name === 'h264_amf') return 'AMD AMF';
  if (name === 'libx264') return 'libx264 (CPU)';
  return name;
}

function ValidationRow({ label, state, detail }: { label: string; state: 'ok' | 'pending' | 'warn' | 'fail' | 'idle'; detail: string }) {
  const stateClass = state === 'ok'
    ? 'text-emerald-300'
    : state === 'fail'
      ? 'text-rose-300'
      : state === 'warn'
        ? 'text-amber-300'
        : state === 'pending'
          ? 'text-blue-300'
          : 'text-slate-400';
  const dotClass = state === 'ok'
    ? 'bg-emerald-400'
    : state === 'fail'
      ? 'bg-rose-400'
      : state === 'warn'
        ? 'bg-amber-400'
        : state === 'pending'
          ? 'bg-blue-400 animate-pulse'
          : 'bg-slate-600';
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 text-[11px]">
      <span className="text-slate-300 font-medium">{label}</span>
      <span className={`flex items-center gap-2 text-right ${stateClass}`}>
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`} />
        {detail}
      </span>
    </div>
  );
}

export const AddUsbCameraModal: React.FC<AddUsbCameraModalProps> = ({ isOpen, onClose, onCameraAdded }) => {
  const [devices, setDevices] = useState<MappedUsbDevice[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<MappedUsbDevice | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedPnpId, setExpandedPnpId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [formats, setFormats] = useState<UsbFormat[]>([]);
  const [encoders, setEncoders] = useState<UsbEncoder[]>([]);
  const [selectedFormatIndex, setSelectedFormatIndex] = useState(-1);
  const [isFormatsLoading, setIsFormatsLoading] = useState(false);

  const [cameraName, setCameraName] = useState('USB Webcam');
  const [location, setLocation] = useState('DirectShow Server Zone');
  const [selectedWidth, setSelectedWidth] = useState(1920);
  const [selectedHeight, setSelectedHeight] = useState(1080);
  const [selectedFps, setSelectedFps] = useState(30);
  const [selectedPixelFormat, setSelectedPixelFormat] = useState('mjpeg');
  const [selectedEncoder, setSelectedEncoder] = useState('auto');
  const [bitrateSelection, setBitrateSelection] = useState('auto');

  const [isProbing, setIsProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<UsbProbe | null>(null);
  const [probeFingerprint, setProbeFingerprint] = useState<string | null>(null);
  const [showProbeDetails, setShowProbeDetails] = useState(false);
  const [saveMode, setSaveMode] = useState<SaveMode>(null);
  const [startState, setStartState] = useState<StartState>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const recommendedKbps = useMemo(
    () => recommendedBitrate(selectedWidth, selectedHeight, selectedFps),
    [selectedWidth, selectedHeight, selectedFps],
  );
  const effectiveBitrate = bitrateSelection === 'auto' ? recommendedKbps : Number(bitrateSelection);

  const captureFingerprint = useMemo(() => JSON.stringify([
    selectedDevice?.device_id || '',
    selectedWidth,
    selectedHeight,
    Number(selectedFps.toFixed(4)),
    (selectedPixelFormat || '').toLowerCase(),
  ]), [selectedDevice?.device_id, selectedWidth, selectedHeight, selectedFps, selectedPixelFormat]);

  const isProbeCurrent = Boolean(probeResult?.ok && probeFingerprint === captureFingerprint);
  const isProbeStale = Boolean(probeResult && probeFingerprint !== captureFingerprint);
  const isBusy = isProbing || saveMode !== null;

  const autoEncoder = useMemo(() => {
    for (const name of encoderOrder) {
      if (encoders.some((e) => e.name === name && e.usable)) return name;
    }
    return null;
  }, [encoders]);

  const filteredDevices = useMemo(() => {
    if (!searchQuery.trim()) return devices;
    const q = searchQuery.toLowerCase();
    return devices.filter((d) =>
      d.name.toLowerCase().includes(q) ||
      d.vendor.toLowerCase().includes(q) ||
      d.device_id.toLowerCase().includes(q) ||
      Boolean(d.alternative_name?.toLowerCase().includes(q)),
    );
  }, [devices, searchQuery]);

  const resetValidation = () => {
    setProbeResult(null);
    setProbeFingerprint(null);
    setShowProbeDetails(false);
    setStartState('idle');
    setErrorMessage('');
    setSuccessMessage('');
  };

  const applyFormat = (format: UsbFormat, index: number) => {
    setSelectedFormatIndex(index);
    setSelectedWidth(format.width);
    setSelectedHeight(format.height);
    // Keep the exact DirectShow rate internally (for example 60.0002) while formatting it cleanly in the UI.
    setSelectedFps(Number(format.max_fps || 30));
    setSelectedPixelFormat(format.pixel_format || format.codec || 'mjpeg');
    setBitrateSelection('auto');
    setStartState('idle');
  };


  async function fetchFormatsForDevice(deviceId: string) {
    setIsFormatsLoading(true);
    try {
      const list = await getUsbFormats(deviceId);
      setFormats(list);
      if (!list.length) {
        setSelectedFormatIndex(-1);
        setErrorMessage('The selected camera did not report any DirectShow capture modes.');
        return;
      }
      const index = preferredFormatIndex(list);
      applyFormat(list[index], index);
    } catch (err: any) {
      setFormats([]);
      setSelectedFormatIndex(-1);
      setErrorMessage(err instanceof Error ? err.message : 'Failed to read camera capture modes.');
    } finally {
      setIsFormatsLoading(false);
    }
  }

  const selectDevice = (device: MappedUsbDevice) => {
    setSelectedDevice(device);
    setCameraName(device.name);
    resetValidation();
    void fetchFormatsForDevice(device.device_id);
  };

  async function discoverUsb() {
    setIsScanning(true);
    resetValidation();
    try {
      const [deviceList, encoderList] = await Promise.all([getUsbDevices(), getUsbEncoders()]);
      setDevices(deviceList);
      setEncoders(encoderList);
      if (!deviceList.length) {
        setSelectedDevice(null);
        setFormats([]);
        setErrorMessage('No DirectShow video devices were found on the CCTV server.');
        return;
      }
      const existing = selectedDevice && deviceList.find((d) => d.device_id === selectedDevice.device_id);
      selectDevice(existing || deviceList[0]);
    } catch (err: any) {
      setDevices([]);
      setSelectedDevice(null);
      setFormats([]);
      setErrorMessage(err instanceof Error ? err.message : 'Failed to scan DirectShow devices.');
    } finally {
      setIsScanning(false);
    }
  }

  useEffect(() => {
    if (isOpen) void discoverUsb();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleSelectFormat = (index: number) => {
    const format = formats[index];
    if (!format) return;
    applyFormat(format, index);
    setErrorMessage('');
    setSuccessMessage('');
  };

  const handleProbeDevice = async () => {
    if (!selectedDevice) return;
    setIsProbing(true);
    setErrorMessage('');
    setSuccessMessage('');
    setShowProbeDetails(false);
    const fingerprint = captureFingerprint;
    try {
      const result = await probeUsbDevice({
        device_id: selectedDevice.device_id,
        width: selectedWidth,
        height: selectedHeight,
        fps: selectedFps,
        pixel_format: selectedPixelFormat || null,
      });
      setProbeResult(result);
      setProbeFingerprint(fingerprint);
      if (!result.ok) setErrorMessage(result.message);
    } catch (err: any) {
      const message = err instanceof Error ? err.message : 'USB camera probe failed.';
      setProbeResult({
        ok: false,
        message,
        ffmpeg_available: !message.toLowerCase().includes('ffmpeg'),
        code: err instanceof ApiError ? err.code : undefined,
        details: err instanceof ApiError ? err.details : undefined,
        stage: 'capture',
      });
      setProbeFingerprint(fingerprint);
      setErrorMessage(message);
    } finally {
      setIsProbing(false);
    }
  };

  const buildPayload = (startImmediately: boolean) => ({
    name: cameraName.trim() || selectedDevice?.name || 'USB Webcam',
    device_id: selectedDevice?.device_id,
    device_name: selectedDevice?.name || 'USB DirectShow Camera',
    location: location.trim() || 'DirectShow Server Zone',
    width: selectedWidth,
    height: selectedHeight,
    fps: selectedFps,
    pixel_format: selectedPixelFormat || null,
    encoder: selectedEncoder,
    bitrate_kbps: effectiveBitrate,
    recording_enabled: false,
    start_immediately: startImmediately,
  });

  const handleSave = async (mode: Exclude<SaveMode, null>) => {
    if (!selectedDevice) {
      setErrorMessage('Please select a DirectShow USB device first.');
      return;
    }
    if (mode === 'start' && !isProbeCurrent) {
      setErrorMessage('Probe the currently selected camera mode successfully before Save & Start.');
      return;
    }

    setSaveMode(mode);
    setErrorMessage('');
    setSuccessMessage('');
    if (mode === 'start') setStartState('starting');

    try {
      const camera = await registerUsbCamera(buildPayload(mode === 'start'));
      onCameraAdded?.(camera);
      if (mode === 'config') {
        setSuccessMessage(`Configuration saved for "${camera.name}". The camera is not running yet.`);
        window.setTimeout(() => onClose(), 850);
      } else if (camera.status === 'online') {
        setStartState('online');
        setSuccessMessage(`"${camera.name}" passed capture validation and is online through MediaMTX/WebRTC.`);
        window.setTimeout(() => onClose(), 1300);
      } else {
        setStartState('failed');
        setErrorMessage(camera.last_error || `Camera was saved but reported status ${camera.status}.`);
      }
    } catch (err: any) {
      const message = err instanceof Error ? err.message : 'Failed to save USB camera.';
      if (mode === 'start') setStartState('failed');
      setErrorMessage(message);
      if (mode === 'start' && err instanceof ApiError && err.stage === 'capture') {
        setProbeResult({
          ok: false,
          message,
          ffmpeg_available: !message.toLowerCase().includes('ffmpeg'),
          code: err.code,
          details: err.details,
          stage: 'capture',
        });
        setProbeFingerprint(captureFingerprint);
      }
    } finally {
      setSaveMode(null);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const probeState: 'ok' | 'pending' | 'warn' | 'fail' | 'idle' = isProbing
    ? 'pending'
    : isProbeStale
      ? 'warn'
      : probeResult?.ok
        ? 'ok'
        : probeResult
          ? 'fail'
          : 'idle';
  const probeDetail = isProbing
    ? 'Testing selected DirectShow mode…'
    : isProbeStale
      ? 'Settings changed — retest required'
      : probeResult?.ok
        ? `Passed • ${probeResult.frames_received ?? 'frames received'}`
        : probeResult
          ? 'Failed • see details below'
          : 'Not tested';

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-6xl max-h-[94vh] flex flex-col bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden text-slate-200" role="dialog" aria-modal="true" aria-labelledby="usb-modal-title">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/90 backdrop-blur-xs">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-sky-400 flex items-center justify-center text-white shadow-lg shadow-blue-500/20 ring-1 ring-white/20">
              <Usb className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 id="usb-modal-title" className="text-lg font-bold text-white tracking-tight">Add DirectShow USB Camera</h2>
                <span className="px-2 py-0.5 text-[10px] font-mono font-semibold rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">SERVER USB</span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">Configure the webcam attached to the CCTV server, validate capture, then optionally start its MediaMTX/WebRTC stream.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={discoverUsb} disabled={isScanning || isBusy} className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700/80 border border-slate-700 text-xs font-semibold text-slate-200 hover:text-white transition-all cursor-pointer shadow-xs disabled:opacity-50">
              <RotateCw className={`w-3.5 h-3.5 text-sky-400 ${isScanning ? 'animate-spin' : ''}`} />
              <span>{isScanning ? 'Scanning…' : 'Rescan Devices'}</span>
            </button>
            <button onClick={onClose} disabled={isBusy} className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-40" aria-label="Close modal"><X className="w-5 h-5" /></button>
          </div>
        </div>

        {errorMessage && (
          <div className="mx-6 mt-4 p-3 rounded-xl bg-rose-950/40 border border-rose-500/40 text-rose-200 text-xs flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span className="flex-1 leading-relaxed">{errorMessage}</span>
          </div>
        )}
        {successMessage && (
          <div className="mx-6 mt-4 p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-200 text-xs flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="flex-1">{successMessage}</span>
          </div>
        )}

        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 overflow-hidden min-h-0">
          <div className="lg:col-span-5 border-r border-slate-800/80 flex flex-col min-h-0 bg-slate-950/30">
            <div className="p-4 border-b border-slate-800/60 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5"><Video className="w-3.5 h-3.5 text-blue-400" />Detected Devices ({filteredDevices.length})</span>
                <span className="text-[11px] text-slate-400 font-mono">DirectShow PnP</span>
              </div>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                <input type="text" placeholder="Filter by device name, vendor, VID/PID…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-8 pr-3 py-1.5 bg-slate-900 border border-slate-700/80 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500" />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {isScanning ? (
                <div className="py-12 flex flex-col items-center justify-center text-center text-slate-400 space-y-3"><RotateCw className="w-8 h-8 text-blue-400 animate-spin" /><p className="text-xs font-medium">Enumerating DirectShow video devices…</p></div>
              ) : filteredDevices.length === 0 ? (
                <div className="py-12 flex flex-col items-center justify-center text-center text-slate-500 p-4"><Usb className="w-8 h-8 text-slate-600 mb-2" /><p className="text-xs font-semibold text-slate-400">No matching devices found</p><p className="text-[11px] text-slate-500 mt-1">Plug in a USB webcam or click Rescan Devices.</p></div>
              ) : filteredDevices.map((device) => {
                const isSelected = selectedDevice?.device_id === device.device_id;
                const isExpanded = expandedPnpId === device.device_id;
                return (
                  <div key={device.device_id} onClick={() => selectDevice(device)} className={`group relative p-3 rounded-xl border transition-all cursor-pointer ${isSelected ? 'bg-blue-950/50 border-blue-500/70 shadow-[0_4px_16px_rgba(37,99,235,0.25)] ring-1 ring-blue-500/40' : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 hover:bg-slate-800/40'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border ${isSelected ? 'bg-blue-600/30 border-blue-400/50 text-blue-300' : 'bg-slate-800 border-slate-700 text-slate-400 group-hover:text-slate-200'}`}><CameraIcon className="w-4 h-4" /></div>
                        <div><div className={`text-xs font-bold leading-tight ${isSelected ? 'text-white' : 'text-slate-200'}`}>{device.name}</div><div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-slate-400"><span className="font-semibold text-blue-400">{device.vendor}</span>{device.vid && <span>• VID: {device.vid}</span>}{device.pid && <span>• PID: {device.pid}</span>}</div></div>
                      </div>
                      {isSelected && <div className="w-5 h-5 rounded-full bg-blue-500 text-white flex items-center justify-center shrink-0 shadow-xs"><Check className="w-3 h-3 stroke-3" /></div>}
                    </div>
                    <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
                      {device.is_persistent ? <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-[10px] text-emerald-300 font-mono"><ShieldCheck className="w-3 h-3 text-emerald-400" />Hardware PnP Moniker</span> : <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] text-slate-300 font-mono">DirectShow Friendly</span>}
                      {device.alternative_name && <button type="button" onClick={(e) => { e.stopPropagation(); setExpandedPnpId(isExpanded ? null : device.device_id); }} className="inline-flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 ml-auto cursor-pointer"><span>{isExpanded ? 'Hide ID' : 'Inspect PnP'}</span>{isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}</button>}
                    </div>
                    {isExpanded && device.alternative_name && (
                      <div className="mt-2 p-2 rounded-lg bg-slate-950/80 border border-slate-800 text-[10px] font-mono text-slate-400 space-y-1.5" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between text-slate-500 text-[9px] uppercase tracking-wider"><span>DirectShow Raw Moniker</span><button type="button" onClick={() => copyToClipboard(device.alternative_name!, device.device_id)} className="text-blue-400 hover:text-white flex items-center gap-1"><Copy className="w-2.5 h-2.5" /><span>{copiedId === device.device_id ? 'Copied' : 'Copy'}</span></button></div>
                        <div className="break-all select-all text-slate-300 leading-relaxed font-mono">{device.alternative_name}</div>
                        {device.guid && <div className="text-[10px] text-slate-400">Class GUID: <span className="text-slate-300">{device.guid}</span></div>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="lg:col-span-7 flex flex-col min-h-0 bg-slate-900/60 overflow-y-auto">
            {selectedDevice ? (
              <form onSubmit={(e) => e.preventDefault()} className="p-6 space-y-5">
                <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/60">
                  <span className="text-[10px] font-mono uppercase text-blue-400 font-semibold tracking-wider">Selected Server Hardware</span>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2 mt-0.5"><span>{selectedDevice.name}</span><span className="text-xs font-normal text-slate-400">({selectedDevice.vendor})</span></h3>
                  <p className="text-[10px] text-slate-400 mt-1">This workflow tests the webcam attached to the CCTV server. Browser/client cameras are tested separately under Diagnostics.</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div><label className="block text-xs font-semibold text-slate-300 mb-1.5">Camera Display Name</label><input type="text" required value={cameraName} onChange={(e) => setCameraName(e.target.value)} className="w-full px-3 py-2 bg-slate-950/70 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" /></div>
                  <div><label className="block text-xs font-semibold text-slate-300 mb-1.5">Location / Zone</label><input type="text" value={location} onChange={(e) => setLocation(e.target.value)} className="w-full px-3 py-2 bg-slate-950/70 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" /></div>
                </div>

                <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5"><Layers className="w-3.5 h-3.5 text-blue-400" />Camera Capture</span>
                    <span className="text-[10px] font-mono text-sky-400 uppercase">{selectedPixelFormat || 'unknown'} input</span>
                  </div>
                  <p className="text-[10px] text-slate-500">Preferred default: 1080p30 when the camera reports it. Capture probing tests only DirectShow → FFmpeg frame acquisition.</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {formats.slice(0, 9).map((fmt, idx) => {
                      const selected = selectedFormatIndex === idx;
                      return <button key={`${fmt.width}-${fmt.height}-${fmt.max_fps}-${idx}`} type="button" onClick={() => handleSelectFormat(idx)} className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${selected ? 'bg-blue-950/60 border-blue-500 text-white shadow-xs' : 'bg-slate-950/40 border-slate-800 hover:border-slate-700 text-slate-300 hover:bg-slate-800/40'}`}><div className="text-xs font-bold font-mono">{fmt.width} × {fmt.height}</div><div className="flex items-center justify-between mt-1 text-[10px] text-slate-400"><span className="uppercase text-sky-400 font-semibold">{fmt.pixel_format || fmt.codec}</span><span>{formatFps(fmt.max_fps || 30)} FPS</span></div></button>;
                    })}
                  </div>
                  {isFormatsLoading && <div className="text-[11px] text-slate-400 flex items-center gap-1"><RotateCw className="w-3 h-3 animate-spin text-blue-400" />Querying DirectShow modes…</div>}
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    <div><span className="block text-[10px] text-slate-400 mb-1">Width (px)</span><input type="number" min={320} max={3840} step={16} value={selectedWidth} onChange={(e) => { setSelectedWidth(Number(e.target.value)); setSelectedFormatIndex(-1); setBitrateSelection('auto'); }} className="w-full px-2.5 py-1.5 bg-slate-950/70 border border-slate-700/80 rounded-lg text-xs font-mono text-white focus:outline-none focus:border-blue-500" /></div>
                    <div><span className="block text-[10px] text-slate-400 mb-1">Height (px)</span><input type="number" min={240} max={2160} step={16} value={selectedHeight} onChange={(e) => { setSelectedHeight(Number(e.target.value)); setSelectedFormatIndex(-1); setBitrateSelection('auto'); }} className="w-full px-2.5 py-1.5 bg-slate-950/70 border border-slate-700/80 rounded-lg text-xs font-mono text-white focus:outline-none focus:border-blue-500" /></div>
                    <div><span className="block text-[10px] text-slate-400 mb-1">FPS Target</span><input type="number" min={1} max={120} step="0.001" value={selectedFps} onChange={(e) => { setSelectedFps(Number(e.target.value)); setSelectedFormatIndex(-1); setBitrateSelection('auto'); }} className="w-full px-2.5 py-1.5 bg-slate-950/70 border border-slate-700/80 rounded-lg text-xs font-mono text-white focus:outline-none focus:border-blue-500" /></div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-[10px]">
                    <div className="p-2 rounded-lg bg-slate-900 border border-slate-800"><span className="text-slate-500">Input format</span><div className="font-mono font-semibold text-slate-200 uppercase mt-0.5">{selectedPixelFormat || 'unknown'}</div></div>
                    <div className="p-2 rounded-lg bg-slate-900 border border-slate-800"><span className="text-slate-500">Resolution</span><div className="font-mono font-semibold text-slate-200 mt-0.5">{selectedWidth} × {selectedHeight}</div></div>
                    <div className="p-2 rounded-lg bg-slate-900 border border-slate-800"><span className="text-slate-500">Frame rate</span><div className="font-mono font-semibold text-slate-200 mt-0.5">{formatFps(selectedFps)} FPS</div></div>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between"><span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5"><Cpu className="w-3.5 h-3.5 text-blue-400" />Stream Output</span><span className="text-[10px] font-mono text-slate-400">H.264 → MediaMTX → WebRTC</span></div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div><label className="block text-[10px] text-slate-400 mb-1">Codec</label><div className="px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white">H.264</div></div>
                    <div><label className="block text-[10px] text-slate-400 mb-1">Encoder Engine</label><select value={selectedEncoder} onChange={(e) => setSelectedEncoder(e.target.value)} className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-blue-500"><option value="auto" disabled={!encoders.some((e) => e.name === 'auto' && e.usable)}>Auto — {autoEncoder ? encoderFriendlyName(autoEncoder) : 'No usable encoder'}</option>{encoders.filter((e) => e.name !== 'auto' && e.available).map((enc) => <option key={enc.name} value={enc.name} disabled={!enc.usable}>{encoderFriendlyName(enc.name)}{enc.usable ? (enc.hardware ? ' — Hardware' : ' — Software') : ' — Not usable on this PC'}</option>)}</select>{encoders.some((e) => e.available && !e.usable && e.hardware) && <div className="text-[9px] leading-relaxed text-amber-300/80 mt-1">Hardware encoders are runtime-tested. Drivers/GPUs that expose an FFmpeg encoder but cannot create a session are skipped automatically.</div>}</div>
                    <div><div className="flex items-center justify-between mb-1"><label className="text-[10px] text-slate-400">Target Bitrate</label><span className="text-[11px] font-mono font-bold text-sky-400">{(effectiveBitrate / 1000).toFixed(1)} Mbps</span></div><select value={bitrateSelection} onChange={(e) => setBitrateSelection(e.target.value)} className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-blue-500"><option value="auto">Auto — {(recommendedKbps / 1000).toFixed(1)} Mbps recommended</option><option value="2500">2.5 Mbps — Low bandwidth</option><option value="4000">4.0 Mbps — Balanced</option><option value="5000">5.0 Mbps — High quality</option><option value="6000">6.0 Mbps — High quality</option><option value="8000">8.0 Mbps — Very high quality</option><option value="10000">10.0 Mbps — Very high quality</option></select></div>
                  </div>
                  <div className="pt-2 flex items-center justify-between border-t border-slate-800/80 opacity-70"><div className="flex items-center gap-2"><HardDrive className="w-3.5 h-3.5 text-slate-400" /><div><span className="text-xs text-slate-300">Recording</span><span className="text-[10px] text-slate-500 ml-2">Configure after camera is added</span></div></div><div className="w-9 h-5 bg-slate-700 rounded-full relative"><div className="absolute top-[2px] left-[2px] bg-slate-300 rounded-full h-4 w-4" /></div></div>
                </div>

                <div className="p-4 rounded-xl bg-slate-950/55 border border-slate-800">
                  <div className="flex items-center justify-between mb-2"><span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5"><Server className="w-3.5 h-3.5 text-blue-400" />Camera Validation</span><span className="text-[10px] text-slate-500">Truthful stage-by-stage status</span></div>
                  <ValidationRow label="Hardware detected" state="ok" detail={selectedDevice.name} />
                  <ValidationRow label="Capture mode" state={probeState} detail={probeDetail} />
                  <ValidationRow label="FFmpeg worker" state={startState === 'online' ? 'ok' : startState === 'starting' ? 'pending' : startState === 'failed' ? 'fail' : 'idle'} detail={startState === 'online' ? 'Running' : startState === 'starting' ? 'Starting…' : startState === 'failed' ? 'Start failed' : 'Not started'} />
                  <ValidationRow label="MediaMTX stream" state={startState === 'online' ? 'ok' : startState === 'starting' ? 'pending' : startState === 'failed' ? 'warn' : 'idle'} detail={startState === 'online' ? 'Published / path ready' : startState === 'starting' ? 'Waiting for path…' : startState === 'failed' ? 'Not verified' : 'Not started'} />
                  <ValidationRow label="WebRTC" state={startState === 'online' ? 'ok' : startState === 'starting' ? 'pending' : startState === 'failed' ? 'warn' : 'idle'} detail={startState === 'online' ? 'Listener reachable + path ready' : startState === 'starting' ? 'Waiting for gateway…' : startState === 'failed' ? 'Not verified' : 'Not started'} />
                </div>

                {probeResult && !isProbeStale && (
                  <div className={`p-3 rounded-xl border text-xs flex items-start gap-2.5 ${probeResult.ok ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200' : 'bg-rose-950/40 border-rose-500/40 text-rose-200'}`}>
                    {probeResult.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />}
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold">{probeResult.ok ? 'Camera capture test passed' : (probeResult.code === 'DEVICE_BUSY_OR_GRAPH_ERROR' ? 'Camera is busy or the capture graph could not start' : 'Camera capture test failed')}</div>
                      <div className="text-[11px] text-slate-300 mt-0.5 leading-relaxed">{probeResult.message}</div>
                      {probeResult.ok && <div className="text-[10px] text-slate-400 mt-1 font-mono">{selectedWidth}×{selectedHeight} @ {formatFps(selectedFps)} FPS • {probeResult.frames_received ?? 'frame count unavailable'} frames • {probeResult.duration_ms ? `${(probeResult.duration_ms / 1000).toFixed(1)} s` : 'duration unavailable'}</div>}
                      {probeResult.details && <div className="mt-2"><button type="button" onClick={() => setShowProbeDetails((v) => !v)} className="text-[10px] text-blue-300 hover:text-blue-200 flex items-center gap-1"><Info className="w-3 h-3" />{showProbeDetails ? 'Hide technical details' : 'Show technical details'}</button>{showProbeDetails && <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-black/30 border border-white/10 p-2 text-[9px] leading-relaxed text-slate-300 max-h-32 overflow-auto">{probeResult.details}</pre>}</div>}
                    </div>
                  </div>
                )}

                <div className="pt-2 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800">
                  <button type="button" onClick={handleProbeDevice} disabled={isBusy} className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700/80 border border-slate-700 text-xs font-semibold text-slate-200 transition-colors cursor-pointer disabled:opacity-50"><Play className={`w-3.5 h-3.5 text-blue-400 ${isProbing ? 'animate-pulse' : ''}`} /><span>{isProbing ? 'Testing Camera…' : 'Probe Camera'}</span></button>
                  <div className="flex flex-wrap items-center gap-2.5">
                    <button type="button" onClick={onClose} disabled={isBusy} className="px-4 py-2 rounded-xl border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50">Cancel</button>
                    <button type="button" onClick={() => void handleSave('config')} disabled={isBusy} className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-xs font-semibold text-white transition-colors cursor-pointer disabled:opacity-50"><Save className="w-3.5 h-3.5 text-sky-300" />{saveMode === 'config' ? 'Saving…' : 'Save Configuration'}</button>
                    <button type="button" onClick={() => void handleSave('start')} disabled={isBusy || !isProbeCurrent} title={!isProbeCurrent ? 'Probe the current capture mode successfully first.' : 'Save this configuration and start the server-side stream.'} className="flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold shadow-lg shadow-blue-500/25 border-t border-white/30 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"><Radio className="w-4 h-4" /><span>{saveMode === 'start' ? 'Starting…' : 'Save & Start'}</span></button>
                  </div>
                </div>
              </form>
            ) : (
              <div className="py-24 flex flex-col items-center justify-center text-center text-slate-500 p-6"><Video className="w-10 h-10 text-slate-600 mb-3" /><p className="text-sm font-semibold text-slate-300">Select a device from the left panel</p><p className="text-xs text-slate-500 mt-1 max-w-sm">Choose a DirectShow USB camera to inspect its capture modes and configure the server-side stream.</p></div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
