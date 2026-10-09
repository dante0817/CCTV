import { useEffect, useMemo, useState } from 'react';

type ConnectionInfo = {
  online: boolean;
  access: 'Local' | 'LAN' | 'Tailscale' | 'Remote';
  secure: boolean;
  effectiveType: string | null;
  downlinkMbps: number | null;
  rttMs: number | null;
  quality: 'Offline' | 'Good' | 'Fair' | 'Limited';
};

type NetworkInformationLike = EventTarget & {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
};

function accessMode(hostname: string): ConnectionInfo['access'] {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return 'Local';
  if (host.endsWith('.ts.net') || host.startsWith('100.') || host.includes('fd7a:115c:a1e0')) return 'Tailscale';
  if (/^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return 'LAN';
  return 'Remote';
}

export function useRemoteConnection(): ConnectionInfo {
  const [online, setOnline] = useState(() => typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const markOnline = () => setOnline(true);
    const markOffline = () => setOnline(false);
    window.addEventListener('online', markOnline);
    window.addEventListener('offline', markOffline);

    const connection = (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
    const onConnectionChange = () => setRevision((v) => v + 1);
    connection?.addEventListener?.('change', onConnectionChange);
    return () => {
      window.removeEventListener('online', markOnline);
      window.removeEventListener('offline', markOffline);
      connection?.removeEventListener?.('change', onConnectionChange);
    };
  }, []);

  return useMemo(() => {
    void revision;
    const connection = (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
    const effectiveType = connection?.effectiveType || null;
    const downlinkMbps = typeof connection?.downlink === 'number' ? connection.downlink : null;
    const rttMs = typeof connection?.rtt === 'number' ? connection.rtt : null;
    let quality: ConnectionInfo['quality'] = 'Good';
    if (!online) quality = 'Offline';
    else if (effectiveType === 'slow-2g' || effectiveType === '2g' || (rttMs !== null && rttMs > 500)) quality = 'Limited';
    else if (effectiveType === '3g' || (rttMs !== null && rttMs > 220) || (downlinkMbps !== null && downlinkMbps < 1.5)) quality = 'Fair';

    return {
      online,
      access: accessMode(window.location.hostname),
      secure: window.isSecureContext,
      effectiveType,
      downlinkMbps,
      rttMs,
      quality,
    };
  }, [online, revision]);
}
