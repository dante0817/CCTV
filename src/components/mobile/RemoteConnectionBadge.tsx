import React from 'react';
import { LockKeyhole, Router, Signal, SignalLow, Wifi, WifiOff } from 'lucide-react';
import { useRemoteConnection } from '../../hooks/useRemoteConnection';

export const RemoteConnectionBadge: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const info = useRemoteConnection();
  const qualityClass = info.quality === 'Good' ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
    : info.quality === 'Fair' ? 'text-amber-700 bg-amber-50 border-amber-200'
      : 'text-rose-700 bg-rose-50 border-rose-200';
  const QualityIcon = !info.online ? WifiOff : info.quality === 'Good' ? Signal : SignalLow;

  if (compact) {
    return <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-[10px] font-bold ${qualityClass}`} title={`${info.access} • ${info.quality}${info.rttMs !== null ? ` • ${info.rttMs}ms` : ''}`}>
      <QualityIcon className="w-3 h-3" />{info.access}
    </div>;
  }

  return <div className="flex flex-wrap items-center gap-2 text-[11px]">
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border font-semibold ${qualityClass}`}><QualityIcon className="w-3.5 h-3.5" />{info.quality}</span>
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 font-semibold"><Router className="w-3.5 h-3.5" />{info.access}</span>
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border font-semibold ${info.secure ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}><LockKeyhole className="w-3.5 h-3.5" />{info.secure ? 'Secure context' : 'HTTP local/LAN'}</span>
    {(info.effectiveType || info.rttMs !== null) && <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-500"><Wifi className="w-3.5 h-3.5" />{info.effectiveType?.toUpperCase() || 'Network'}{info.rttMs !== null ? ` • ${info.rttMs} ms` : ''}</span>}
  </div>;
};
