import React, { useEffect, useMemo, useState } from 'react';
import {
  Settings as GearIcon,
  Globe,
  Video,
  Shield,
  Info,
  Network,
  Lock,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Server,
  Wifi,
  Radio,
} from 'lucide-react';

type SettingsTab = 'general' | 'network' | 'media' | 'security' | 'about';

function StatusPill({ ok, yes = 'Ready', no = 'Unavailable' }: { ok: boolean; yes?: string; no?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${ok ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-800 border border-amber-200'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-amber-500'}`} />
      {ok ? yes : no}
    </span>
  );
}

export const SettingsView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/v1/system/status', { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`System status HTTP ${res.status}`);
      setStatus(await res.json());
    } catch (e: any) {
      setError(e?.message || 'System status is unavailable.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const remote = status?.remoteAccess;
  const media = status?.mediamtx;
  const remoteUrl = useMemo(() => {
    const host = remote?.dnsName || remote?.tailscaleIps?.[0];
    return host ? `http://${host}:${status?.backend?.port || 3000}` : null;
  }, [remote, status]);

  const tabs: Array<{ id: SettingsTab; label: string; icon: React.ReactNode }> = [
    { id: 'general', label: 'General', icon: <GearIcon className="w-4 h-4" /> },
    { id: 'network', label: 'Network', icon: <Globe className="w-4 h-4" /> },
    { id: 'media', label: 'Media', icon: <Video className="w-4 h-4" /> },
    { id: 'security', label: 'Security', icon: <Shield className="w-4 h-4" /> },
    { id: 'about', label: 'About', icon: <Info className="w-4 h-4" /> },
  ];

  const row = (label: string, value: React.ReactNode) => (
    <div className="flex items-start justify-between gap-6 py-2.5 border-b border-slate-100 last:border-0">
      <span className="text-xs font-semibold text-slate-600">{label}</span>
      <span className="text-xs text-slate-900 text-right break-all">{value}</span>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col h-full bg-[#f4f6fa] overflow-y-auto">
      <div className="p-6 space-y-6 flex-1">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100"><GearIcon className="w-5 h-5" /></div>
            <div><h1 className="text-2xl font-bold text-slate-900">Settings</h1><p className="text-xs text-slate-500">Runtime configuration and remote-access readiness</p></div>
          </div>
          <button onClick={() => void load()} disabled={loading} className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-700 disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh status
          </button>
        </div>

        {error && <div className="p-3.5 rounded-xl border border-rose-200 bg-rose-50 text-xs text-rose-800">{error}</div>}

        <div className="flex items-center gap-7 border-b border-slate-200 text-xs font-semibold text-slate-600">
          {tabs.map((tab) => <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-2 pb-3 relative ${activeTab === tab.id ? 'text-blue-600' : 'hover:text-slate-900'}`}>{tab.icon}{tab.label}{activeTab === tab.id && <span className="absolute bottom-0 inset-x-0 h-0.5 bg-blue-600 rounded-full" />}</button>)}
        </div>

        {activeTab === 'general' && (
          <div className="grid lg:grid-cols-2 gap-5">
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-center gap-3 mb-4"><Server className="w-4 h-4 text-blue-600" /><div><h2 className="text-sm font-bold text-slate-900">CCTV Server</h2><p className="text-[11px] text-slate-400">Live values from the running backend</p></div></div>
              {row('Application', <StatusPill ok={Boolean(status?.backend?.ok)} />)}
              {row('Port', <span className="font-mono">{status?.backend?.port ?? '—'}</span>)}
              {row('Browser URL', <span className="font-mono">{status?.backend?.browserUrl ?? '—'}</span>)}
              {row('Database', <StatusPill ok={Boolean(status?.database?.ok)} />)}
              {row('FFmpeg', <StatusPill ok={Boolean(status?.ffmpeg?.ok)} />)}
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-center gap-3 mb-4"><Wifi className="w-4 h-4 text-blue-600" /><div><h2 className="text-sm font-bold text-slate-900">Private Remote Viewing</h2><p className="text-[11px] text-slate-400">Tailscale is the supported v1 remote-access path</p></div></div>
              {row('Tailscale installed', <StatusPill ok={Boolean(remote?.installed)} yes="Installed" no="Not detected" />)}
              {row('Tailscale connection', <StatusPill ok={Boolean(remote?.connected)} yes="Connected" no="Not connected" />)}
              {row('MagicDNS name', <span className="font-mono">{remote?.dnsName || '—'}</span>)}
              {row('Tailscale IP', <span className="font-mono">{remote?.tailscaleIps?.join(', ') || '—'}</span>)}
              {row('Remote URL', <span className="font-mono">{remoteUrl || 'Connect Tailscale first'}</span>)}
            </div>
          </div>
        )}

        {activeTab === 'network' && (
          <div className="grid lg:grid-cols-2 gap-5">
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-center gap-3 mb-4"><Network className="w-4 h-4 text-blue-600" /><div><h2 className="text-sm font-bold text-slate-900">Reachable Addresses</h2><p className="text-[11px] text-slate-400">Do not use 0.0.0.0 as a browser address</p></div></div>
              {row('LAN addresses', <span className="font-mono">{remote?.lanAddresses?.join(', ') || '—'}</span>)}
              {row('Tailscale addresses', <span className="font-mono">{remote?.tailscaleIps?.join(', ') || '—'}</span>)}
              {row('Recommended host', <span className="font-mono">{remote?.recommendedHost || '—'}</span>)}
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
              <h2 className="text-sm font-bold text-slate-900">Remote-access policy</h2>
              <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-900 leading-relaxed">
                Use Tailscale on the CCTV PC and authorized viewer devices. Router port forwarding, Tailscale Funnel, and public exposure are intentionally not enabled by this build.
              </div>
              <div className="p-3.5 rounded-lg bg-blue-50 border border-blue-200 text-[11px] text-blue-900 leading-relaxed">
                First-admin setup must be completed from <span className="font-mono font-semibold">http://localhost:{status?.backend?.port || 3000}</span> on the CCTV PC before remote users can sign in.
              </div>
            </div>
          </div>
        )}

        {activeTab === 'media' && (
          <div className="grid lg:grid-cols-2 gap-5">
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-center gap-3 mb-4"><Radio className="w-4 h-4 text-blue-600" /><div><h2 className="text-sm font-bold text-slate-900">MediaMTX</h2><p className="text-[11px] text-slate-400">WebRTC first, HLS fallback</p></div></div>
              {row('Media server', <StatusPill ok={Boolean(media?.ok)} />)}
              {row('WebRTC / WHEP', <StatusPill ok={Boolean(media?.webrtcReachable)} />)}
              {row('WebRTC port', <span className="font-mono">{media?.webrtcPort ?? 8889}</span>)}
              {row('ICE UDP port', <span className="font-mono">{media?.iceUdpPort ?? 8189}</span>)}
              {row('HLS fallback port', <span className="font-mono">{media?.hlsPort ?? 8888}</span>)}
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
              <h2 className="text-sm font-bold text-slate-900">Playback behavior</h2>
              <div className="flex gap-3 items-start p-3.5 rounded-lg bg-slate-50 border border-slate-200"><CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" /><p className="text-[11px] text-slate-600">Camera tiles request an authenticated short-lived media token and try low-latency WebRTC first.</p></div>
              <div className="flex gap-3 items-start p-3.5 rounded-lg bg-slate-50 border border-slate-200"><CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" /><p className="text-[11px] text-slate-600">If WebRTC cannot establish, playback automatically falls back to authenticated HLS through the CCTV server.</p></div>
            </div>
          </div>
        )}

        {activeTab === 'security' && (
          <div className="grid lg:grid-cols-2 gap-5">
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-center gap-3 mb-4"><Lock className="w-4 h-4 text-blue-600" /><div><h2 className="text-sm font-bold text-slate-900">Implemented protections</h2><p className="text-[11px] text-slate-400">Active in this release</p></div></div>
              {row('Application sessions', 'Persistent • HttpOnly • SameSite=Strict • revocable')}
              {row('Password hashing', 'scrypt + per-user salt • 5–8 characters for new/changed passwords')}
              {row('Media reads', media?.auth || 'Short-lived token + live ACL + security-version revalidation')}
              {row('MediaMTX API', 'Loopback only')}
              {row('Per-user AI access', 'Explicit grant; new Viewers default off')}
              {row('Public Internet exposure', 'Disabled / unsupported')}
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
              <h2 className="text-sm font-bold text-slate-900">Deployment note</h2>
              <div className="flex gap-3 items-start p-3.5 rounded-lg bg-amber-50 border border-amber-200"><AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" /><p className="text-[11px] text-amber-900">This v1 remote mode uses HTTP inside the encrypted Tailscale network. HTTPS/Tailscale Serve is intentionally deferred until the UI, WHEP, and HLS are moved to one secure origin.</p></div>
              <div className="text-[11px] text-slate-500">Use Tailscale Grants/permissions to restrict which tailnet users or devices can reach the CCTV PC. The CCTV application still requires its own login and camera permissions.</div>
            </div>
          </div>
        )}

        {activeTab === 'about' && (
          <div className="bg-white rounded-xl border border-slate-200 p-5 max-w-3xl">
            <h2 className="text-sm font-bold text-slate-900 mb-3">CCTV Monitor {status?.version ? `v${status.version}` : ""} — Private Remote Viewing</h2>
            {row('Application', 'Node.js + Express + React + TypeScript')}
            {row('USB pipeline', 'DirectShow → FFmpeg → MediaMTX')}
            {row('Network pipeline', 'RTSP → FFmpeg → MediaMTX')}
            {row('RTSP cameras', status?.features?.rtsp === 'available' ? 'Available' : 'Unavailable')}
            {row('Recording', status?.features?.recording === 'available' ? 'Available — USB continuous MVP' : 'Planned')}
            {row('Primary live protocol', 'WebRTC / WHEP')}
            {row('Fallback protocol', 'HLS')}
            {row('Private remote network', 'Tailscale')}
          </div>
        )}
      </div>
    </div>
  );
};
