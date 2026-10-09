import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import type { Camera, StreamRuntimeConfig } from '../../types/cctv';
import { getStreamRuntimeConfig, getStreamToken } from '../../api';

interface CameraPlayerProps {
  camera: Camera;
  muted?: boolean;
}

let streamConfigPromise: Promise<StreamRuntimeConfig> | null = null;
function runtimeConfig(): Promise<StreamRuntimeConfig> {
  if (!streamConfigPromise) streamConfigPromise = getStreamRuntimeConfig().catch((error) => { streamConfigPromise = null; throw error; });
  return streamConfigPromise;
}

function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', done);
        resolve();
      }
    };
    pc.addEventListener('icegatheringstatechange', done);
    setTimeout(() => { pc.removeEventListener('icegatheringstatechange', done); resolve(); }, 3000);
  });
}

export const CameraPlayer: React.FC<CameraPlayerProps> = ({ camera, muted = true }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playerError, setPlayerError] = useState('');
  const [connected, setConnected] = useState(false);
  const [mode, setMode] = useState<'webrtc' | 'hls' | null>(null);

  useEffect(() => { if (videoRef.current) videoRef.current.muted = muted; }, [muted]);

  useEffect(() => {
    const video = videoRef.current;
    const streamAvailable = camera.stream_available ?? Boolean(camera.stream?.path);
    if (!video || !streamAvailable || camera.status !== 'online') {
      setConnected(false); setMode(null); return;
    }

    let cancelled = false;
    let pc: RTCPeerConnection | null = null;
    let sessionUrl: string | null = null;
    let sessionToken: string | null = null;
    let hls: Hls | null = null;
    let connectTimer: number | null = null;
    let fallbackStarted = false;

    const clearTimer = () => { if (connectTimer !== null) { window.clearTimeout(connectTimer); connectTimer = null; } };
    const closePeer = () => {
      clearTimer();
      if (sessionUrl && sessionToken) fetch(sessionUrl, { method: 'DELETE', headers: { Authorization: `Bearer ${sessionToken}` } }).catch(() => {});
      sessionUrl = null; sessionToken = null;
      try { pc?.close(); } catch {}
      pc = null;
      if (video.srcObject) video.srcObject = null;
    };

    const startHls = async (reason?: string) => {
      if (cancelled || fallbackStarted) return;
      fallbackStarted = true;
      closePeer();
      setConnected(false);
      setMode('hls');
      setPlayerError(reason ? `${reason} Using HLS fallback…` : 'Using HLS fallback…');
      try {
        const cfg = await runtimeConfig();
        if (cancelled) return;
        const url = `${cfg.hlsProxyBase}/${encodeURIComponent(camera.id)}/index.m3u8`;
        if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = url;
          video.onloadeddata = () => { if (!cancelled) { setConnected(true); setPlayerError(''); void video.play().catch(() => {}); } };
          video.onerror = () => { if (!cancelled) setPlayerError('WebRTC failed and native HLS playback could not start.'); };
          return;
        }
        if (!Hls.isSupported()) throw new Error('This browser does not support HLS fallback.');
        hls = new Hls({ lowLatencyMode: true, backBufferLength: 10, liveSyncDurationCount: 3, liveMaxLatencyDurationCount: 8 });
        hls.on(Hls.Events.MEDIA_ATTACHED, () => hls?.loadSource(url));
        hls.on(Hls.Events.MANIFEST_PARSED, () => { if (!cancelled) { setConnected(true); setPlayerError(''); void video.play().catch(() => {}); } });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal || cancelled) return;
          setConnected(false);
          setPlayerError(`HLS fallback failed: ${data.details || data.type}.`);
        });
        hls.attachMedia(video);
      } catch (error: any) {
        if (!cancelled) setPlayerError(error?.message || 'HLS fallback could not start.');
      }
    };

    const startWebRtc = async (attempt: number) => {
      if (cancelled || fallbackStarted) return;
      closePeer();
      setPlayerError(''); setConnected(false); setMode('webrtc');
      try {
        const cfg = await runtimeConfig();
        if (cancelled) return;
        const browserIsHttps = window.location.protocol === 'https:';
        const insecureWebRtcSignaling = /^http:\/\//i.test(cfg.webrtcBase);
        if (cfg.preferredProtocol === 'hls' || (browserIsHttps && insecureWebRtcSignaling)) {
          await startHls('Secure remote access detected.');
          return;
        }
        const issued = await getStreamToken(camera.id);
        if (cancelled) return;
        const whepUrl = `${cfg.webrtcBase}/${encodeURIComponent(issued.path)}/whep`;
        sessionToken = issued.token;
        pc = new RTCPeerConnection({ iceServers: [] });
        pc.addTransceiver('video', { direction: 'recvonly' });
        pc.addTransceiver('audio', { direction: 'recvonly' });
        pc.ontrack = (event) => {
          if (cancelled || !videoRef.current) return;
          const stream = event.streams[0] || new MediaStream([event.track]);
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => {});
          setConnected(true); setPlayerError(''); clearTimer();
        };
        pc.onconnectionstatechange = () => {
          if (!pc || cancelled || fallbackStarted) return;
          if (pc.connectionState === 'connected') { setConnected(true); setPlayerError(''); clearTimer(); }
          if (['failed', 'disconnected'].includes(pc.connectionState)) {
            if (attempt === 0) window.setTimeout(() => void startWebRtc(1), 800);
            else void startHls(`WebRTC ${pc.connectionState}.`);
          }
        };
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await waitForIceGathering(pc);
        if (cancelled || !pc.localDescription?.sdp) return;
        const response = await fetch(whepUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/sdp', Authorization: `Bearer ${issued.token}` },
          body: pc.localDescription.sdp,
        });
        if (!response.ok) throw new Error(`WHEP handshake failed (HTTP ${response.status}).`);
        const location = response.headers.get('Location');
        if (location) sessionUrl = new URL(location, whepUrl).toString();
        const answerSdp = await response.text();
        await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
        connectTimer = window.setTimeout(() => {
          if (cancelled || connected || fallbackStarted) return;
          if (attempt === 0) void startWebRtc(1);
          else void startHls('WebRTC timed out.');
        }, 8000);
      } catch (error: any) {
        if (cancelled || fallbackStarted) return;
        if (attempt === 0) window.setTimeout(() => void startWebRtc(1), 800);
        else void startHls(error?.message || 'WebRTC failed.');
      }
    };

    void startWebRtc(0);
    return () => {
      cancelled = true;
      clearTimer();
      closePeer();
      try { hls?.destroy(); } catch {}
      hls = null;
      video.onloadeddata = null;
      video.onerror = null;
      video.removeAttribute('src');
      try { video.load(); } catch {}
      setConnected(false);
    };
  }, [camera.id, camera.stream?.path, camera.stream_available, camera.status]);

  const streamAvailable = camera.stream_available ?? Boolean(camera.stream?.path);
  if (camera.status !== 'online' || !streamAvailable) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950 text-slate-300 text-xs p-6 text-center">
        {camera.thumbnail || camera.image ? <img src={camera.thumbnail || camera.image} alt="" className="absolute inset-0 w-full h-full object-cover opacity-25" /> : null}
        <div className="relative z-10 font-semibold">{camera.status.toUpperCase()}</div>
        {camera.last_error && <div className="relative z-10 mt-2 max-w-xl text-[11px] text-rose-300">{camera.last_error}</div>}
      </div>
    );
  }

  return (
    <>
      <video id={`camera-video-${camera.id}`} ref={videoRef} autoPlay playsInline muted={muted} className="absolute inset-0 w-full h-full object-cover bg-black" />
      <div className="absolute right-3 top-12 z-10 rounded-md bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-slate-200">{mode === 'hls' ? 'HLS FALLBACK' : 'WEBRTC'}</div>
      {!connected && !playerError && <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-300 bg-black">Connecting secure WebRTC…</div>}
      {playerError && !connected && <div className="absolute inset-0 flex items-center justify-center text-xs text-amber-200 bg-black/90 p-6 text-center">{playerError}</div>}
    </>
  );
};
