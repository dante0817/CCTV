import React from 'react';
import { Camera as CameraIcon, Eye, MapPin, Radio, ShieldCheck } from 'lucide-react';
import type { Camera } from '../../types/cctv';

export const MyCamerasView: React.FC<{ cameras: Camera[]; onOpenLive: () => void }> = ({ cameras, onOpenLive }) => (
  <div className="flex-1 h-full overflow-y-auto bg-[#f4f6fa] p-3 sm:p-6">
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center"><CameraIcon className="w-5 h-5" /></div>
          <div><h1 className="text-xl sm:text-2xl font-bold text-slate-900">My Cameras</h1><p className="text-xs text-slate-500">Only cameras assigned to your account are shown.</p></div>
        </div>
        <button onClick={onOpenLive} className="mobile-touch-target w-full sm:w-auto px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-2"><Eye className="w-4 h-4" />Open Live View</button>
      </div>

      {cameras.length === 0 ? (
        <div className="bg-white border border-dashed border-slate-300 rounded-xl min-h-72 flex flex-col items-center justify-center text-center p-8">
          <ShieldCheck className="w-10 h-10 text-slate-300 mb-3" />
          <div className="font-semibold text-slate-800">No cameras assigned</div>
          <p className="text-xs text-slate-500 mt-1 max-w-md">An administrator must assign at least one camera to this Viewer account in Camera Access.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {cameras.map(camera => (
            <div key={camera.id} className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
              <div className="flex items-start justify-between gap-3">
                <div><div className="font-bold text-slate-900">{camera.name}</div><div className="text-xs text-slate-500 flex items-center gap-1 mt-1"><MapPin className="w-3.5 h-3.5" />{camera.location || 'Location not set'}</div></div>
                <span className={`text-[10px] font-bold px-2 py-1 rounded-full border ${camera.status === 'online' ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : camera.status === 'error' || camera.status === 'offline' ? 'text-rose-700 bg-rose-50 border-rose-200' : 'text-amber-700 bg-amber-50 border-amber-200'}`}>{camera.status.toUpperCase()}</span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-slate-50 border border-slate-100 p-2"><div className="text-slate-400">Resolution</div><div className="font-semibold text-slate-700 mt-0.5">{camera.resolution || '—'}</div></div>
                <div className="rounded-lg bg-slate-50 border border-slate-100 p-2"><div className="text-slate-400">Stream</div><div className="font-semibold text-slate-700 mt-0.5 flex items-center gap-1"><Radio className="w-3 h-3" />{camera.stream_available ? 'Available' : 'Unavailable'}</div></div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  </div>
);
