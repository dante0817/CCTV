import { spawn } from 'node:child_process';
import type { RtspProbe, RtspTransport } from '../../types/cctv';

export interface RtspConnectionInput {
  host: string;
  port: number;
  path: string;
  username?: string;
  password?: string;
  transport?: RtspTransport;
}

export function normalizeRtspPath(value: string): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '/';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function hostForUrl(host: string): string {
  const clean = String(host || '').trim().replace(/^\[|\]$/g, '');
  return clean.includes(':') ? `[${clean}]` : clean;
}

export function buildRtspUrl(input: RtspConnectionInput): string {
  const host = hostForUrl(input.host);
  const port = Number(input.port || 554);
  const username = String(input.username || '');
  const password = String(input.password || '');
  const auth = username ? `${encodeURIComponent(username)}${password ? `:${encodeURIComponent(password)}` : ''}@` : '';
  return `rtsp://${auth}${host}:${port}${normalizeRtspPath(input.path)}`;
}

export async function probeRtspSource(ffmpeg: string | null, input: RtspConnectionInput): Promise<RtspProbe> {
  if (!ffmpeg) return { ok: false, ffmpeg_available: false, connected: false, code: 'FFMPEG_NOT_FOUND', message: 'FFmpeg was not found. Install FFmpeg or set FFMPEG_PATH.' };
  if (!input.host?.trim()) return { ok: false, ffmpeg_available: true, connected: false, code: 'RTSP_HOST_REQUIRED', message: 'Camera host/IP address is required.' };

  const url = buildRtspUrl(input);
  const args = ['-hide_banner', '-loglevel', 'info'];
  if ((input.transport || 'tcp') === 'tcp') args.push('-rtsp_transport', 'tcp');
  else args.push('-rtsp_transport', 'udp');
  args.push('-i', url, '-map', '0:v:0', '-frames:v', '1', '-an', '-f', 'null', '-');

  return await new Promise<RtspProbe>((resolve) => {
    const child = spawn(ffmpeg, args, { windowsHide: true });
    let stderr = '';
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (result: RtspProbe) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      finish({ ok: false, ffmpeg_available: true, connected: false, code: 'RTSP_TIMEOUT', message: 'RTSP connection timed out. Verify the camera IP, RTSP port/path, credentials, and that the camera is on the same reachable network.' });
    }, 12000);

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 100_000) stderr = stderr.slice(-100_000);
    });
    child.once('error', (error) => finish({ ok: false, ffmpeg_available: true, connected: false, code: 'FFMPEG_START_FAILED', message: error.message }));
    child.once('close', (code) => {
      const video = stderr.match(/Video:\s*([^,\s]+)[^\n]*?(\d{2,5})x(\d{2,5})/i);
      const fpsMatch = stderr.match(/(?:,|\s)(\d+(?:\.\d+)?)\s*fps/i);
      const compact = stderr.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(-6).join(' ');
      const authFailure = /401 unauthorized|method DESCRIBE failed: 401|authentication/i.test(stderr);
      const refused = /connection refused|no route to host|network is unreachable/i.test(stderr);
      const ok = code === 0 && Boolean(video);
      finish({
        ok,
        ffmpeg_available: true,
        connected: ok,
        codec: video?.[1] || null,
        width: video ? Number(video[2]) : null,
        height: video ? Number(video[3]) : null,
        fps: fpsMatch ? Number(fpsMatch[1]) : null,
        code: ok ? undefined : authFailure ? 'RTSP_AUTH_FAILED' : refused ? 'RTSP_UNREACHABLE' : 'RTSP_PROBE_FAILED',
        message: ok ? `RTSP video opened successfully${video ? ` (${video[1]}, ${video[2]}×${video[3]})` : ''}.` : authFailure ? 'RTSP authentication failed. Verify the camera username/password.' : refused ? 'The RTSP camera is unreachable from this CCTV server.' : 'FFmpeg could not open a usable RTSP video stream.',
        details: ok ? undefined : compact.replace(/rtsp:\/\/[^\s@]+@/gi, 'rtsp://***@'),
      });
    });
  });
}
