import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Network, Radio, ShieldCheck, X } from 'lucide-react';
import { getUsbEncoders, registerRtspCamera, testRtspCamera } from '../../api';
import type { Camera, RtspProbe, UsbEncoder } from '../../types/cctv';

interface Props {
  onClose: () => void;
  onAdded: (camera: Camera) => void | Promise<void>;
}

type Profile = 'tenda-cp3-pro' | 'generic';

export const AddNetworkCameraModal: React.FC<Props> = ({ onClose, onAdded }) => {
  const [profile, setProfile] = useState<Profile>('tenda-cp3-pro');
  const [name, setName] = useState('Tenda CP3 Pro');
  const [location, setLocation] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState(554);
  const [streamPath, setStreamPath] = useState('/ch=1&subtype=0');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [transport, setTransport] = useState<'tcp' | 'udp'>('tcp');
  const [videoMode, setVideoMode] = useState<'transcode' | 'copy'>('transcode');
  const [encoder, setEncoder] = useState('auto');
  const [bitrate, setBitrate] = useState(2500);
  const [encoders, setEncoders] = useState<UsbEncoder[]>([]);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [probe, setProbe] = useState<RtspProbe | null>(null);
  const [testedSignature, setTestedSignature] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { void getUsbEncoders().then(setEncoders).catch(() => setEncoders([])); }, []);

  const payload = useMemo(() => ({
    vendor_profile: profile,
    name,
    location,
    host,
    port,
    path: streamPath,
    username,
    password,
    transport,
    video_mode: videoMode,
    encoder,
    bitrate_kbps: bitrate,
    fps: probe?.fps || 20,
    detected_codec: probe?.codec || null,
    detected_width: probe?.width || null,
    detected_height: probe?.height || null,
  }), [profile, name, location, host, port, streamPath, username, password, transport, videoMode, encoder, bitrate, probe?.fps, probe?.codec, probe?.width, probe?.height]);

  const signature = useMemo(() => JSON.stringify({ profile, host, port, streamPath, username, password, transport }), [profile, host, port, streamPath, username, password, transport]);
  const testCurrent = Boolean(probe?.ok && testedSignature === signature);

  const applyProfile = (next: Profile) => {
    setProfile(next);
    setProbe(null);
    setTestedSignature('');
    if (next === 'tenda-cp3-pro') {
      setName((v) => !v || v === 'RTSP Camera' ? 'Tenda CP3 Pro' : v);
      setPort(554);
      setStreamPath('/ch=1&subtype=0');
      setUsername((v) => v || 'admin');
      setTransport('tcp');
      setVideoMode('transcode');
    } else {
      setName((v) => v === 'Tenda CP3 Pro' ? 'RTSP Camera' : v);
      setPort(554);
      setStreamPath('/');
    }
  };

  const runTest = async () => {
    setTesting(true); setError(''); setProbe(null);
    try {
      const result = await testRtspCamera(payload);
      setProbe(result);
      if (result.ok) setTestedSignature(signature);
    } catch (e: any) { setError(e?.message || 'RTSP test failed.'); }
    finally { setTesting(false); }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testCurrent) { setError('Test the current RTSP settings successfully before adding the camera.'); return; }
    setSaving(true); setError('');
    try {
      const camera = await registerRtspCamera({ ...payload, start_immediately: true });
      await onAdded(camera);
      onClose();
    } catch (e: any) { setError(e?.message || 'Could not add the network camera.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form onSubmit={save} className="w-full max-w-3xl max-h-[92vh] overflow-y-auto bg-white rounded-2xl shadow-2xl border border-slate-200">
        <div className="sticky top-0 bg-white z-10 flex items-start justify-between p-5 border-b border-slate-200">
          <div className="flex gap-3"><div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center"><Network className="w-5 h-5" /></div><div><h2 className="text-lg font-bold text-slate-900">Add Network Camera</h2><p className="text-xs text-slate-500">Test RTSP first, then register it in the CCTV backend.</p></div></div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-5">
          <div className="grid sm:grid-cols-2 gap-3">
            <button type="button" onClick={() => applyProfile('tenda-cp3-pro')} className={`text-left p-4 rounded-xl border ${profile === 'tenda-cp3-pro' ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-100' : 'border-slate-200'}`}><div className="font-bold text-sm text-slate-900">Tenda CP3 Pro</div><div className="text-[11px] text-slate-500 mt-1">Preset: RTSP port 554, main stream /ch=1&amp;subtype=0</div></button>
            <button type="button" onClick={() => applyProfile('generic')} className={`text-left p-4 rounded-xl border ${profile === 'generic' ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-100' : 'border-slate-200'}`}><div className="font-bold text-sm text-slate-900">Generic RTSP</div><div className="text-[11px] text-slate-500 mt-1">For other cameras with a known RTSP host, port, and path.</div></button>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <label className="text-xs font-semibold text-slate-700">Camera name<input value={name} onChange={e => setName(e.target.value)} required className="mt-1.5 w-full px-3 py-2.5 rounded-lg border border-slate-200 font-normal" /></label>
            <label className="text-xs font-semibold text-slate-700">Location<input value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. Porch" className="mt-1.5 w-full px-3 py-2.5 rounded-lg border border-slate-200 font-normal" /></label>
            <label className="text-xs font-semibold text-slate-700">Camera IP / hostname<input value={host} onChange={e => { setHost(e.target.value); setProbe(null); }} required placeholder="192.168.1.50" className="mt-1.5 w-full px-3 py-2.5 rounded-lg border border-slate-200 font-mono font-normal" /></label>
            <label className="text-xs font-semibold text-slate-700">RTSP port<input type="number" min={1} max={65535} value={port} onChange={e => { setPort(Number(e.target.value)); setProbe(null); }} required className="mt-1.5 w-full px-3 py-2.5 rounded-lg border border-slate-200 font-mono font-normal" /></label>
            <label className="sm:col-span-2 text-xs font-semibold text-slate-700">RTSP path<input value={streamPath} onChange={e => { setStreamPath(e.target.value); setProbe(null); }} required className="mt-1.5 w-full px-3 py-2.5 rounded-lg border border-slate-200 font-mono font-normal" /></label>
            <label className="text-xs font-semibold text-slate-700">Username<input value={username} onChange={e => { setUsername(e.target.value); setProbe(null); }} autoComplete="off" className="mt-1.5 w-full px-3 py-2.5 rounded-lg border border-slate-200 font-normal" /></label>
            <label className="text-xs font-semibold text-slate-700">Password<input type="password" value={password} onChange={e => { setPassword(e.target.value); setProbe(null); }} autoComplete="new-password" className="mt-1.5 w-full px-3 py-2.5 rounded-lg border border-slate-200 font-normal" /></label>
          </div>

          <div className="grid sm:grid-cols-3 gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200">
            <label className="text-xs font-semibold text-slate-700">Transport<select value={transport} onChange={e => { setTransport(e.target.value as 'tcp'|'udp'); setProbe(null); }} className="mt-1.5 w-full px-3 py-2 rounded-lg border border-slate-200 bg-white font-normal"><option value="tcp">TCP (recommended)</option><option value="udp">UDP</option></select></label>
            <label className="text-xs font-semibold text-slate-700">Video handling<select value={videoMode} onChange={e => setVideoMode(e.target.value as 'transcode'|'copy')} className="mt-1.5 w-full px-3 py-2 rounded-lg border border-slate-200 bg-white font-normal"><option value="transcode">Transcode to H.264</option><option value="copy">Stream copy (advanced)</option></select></label>
            <label className="text-xs font-semibold text-slate-700">H.264 encoder<select value={encoder} onChange={e => setEncoder(e.target.value)} disabled={videoMode === 'copy'} className="mt-1.5 w-full px-3 py-2 rounded-lg border border-slate-200 bg-white font-normal disabled:opacity-50">{(encoders.length ? encoders : [{ name: 'auto', available: true, usable: true, hardware: false }]).filter(e => e.name === 'auto' || e.usable).map(e => <option key={e.name} value={e.name}>{e.name}</option>)}</select></label>
          </div>

          <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-[11px] leading-relaxed text-blue-900 flex gap-2"><ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" /><span>The password is sent only to the local CCTV backend during setup and is encrypted before database storage. Viewer APIs never receive RTSP credentials.</span></div>

          {probe && <div className={`rounded-xl border p-3 text-xs flex gap-2 ${probe.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>{probe.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}<div><div className="font-semibold">{probe.message}</div>{probe.ok && <div className="mt-1 text-[11px]">Codec {probe.codec || 'detected'}{probe.width && probe.height ? ` • ${probe.width}×${probe.height}` : ''}{probe.fps ? ` • ${probe.fps} FPS` : ''}</div>}{probe.details && <div className="mt-1 text-[10px] font-mono break-all">{probe.details}</div>}</div></div>}
          {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 flex gap-2"><AlertTriangle className="w-4 h-4 shrink-0" />{error}</div>}
        </div>

        <div className="sticky bottom-0 bg-white border-t border-slate-200 p-4 flex items-center justify-between gap-3">
          <div className="text-[11px] text-slate-500 flex items-center gap-1.5"><Radio className="w-3.5 h-3.5" />{testCurrent ? 'Connection test passed for these settings.' : 'A successful connection test is required.'}</div>
          <div className="flex gap-2"><button type="button" onClick={() => void runTest()} disabled={testing || !host.trim()} className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 disabled:opacity-50 flex items-center gap-2">{testing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Test Connection</button><button type="submit" disabled={saving || !testCurrent} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold disabled:opacity-40 flex items-center gap-2">{saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Add & Start Camera</button></div>
        </div>
      </form>
    </div>
  );
};
