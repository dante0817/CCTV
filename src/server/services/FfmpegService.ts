import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { findFfmpegPath } from '../dshowEnumerator';

const execFileAsync = promisify(execFile);

export interface EncoderCapability {
  name: string;
  available: boolean;
  usable: boolean;
  hardware: boolean;
  reason?: string;
}

const encoderOrder = ['h264_nvenc', 'h264_qsv', 'h264_amf', 'libx264'];

const encoderRuntimeCache = new Map<string, { usable: boolean; reason?: string }>();

async function testEncoderRuntime(ffmpeg: string, encoder: string): Promise<{ usable: boolean; reason?: string }> {
  const cached = encoderRuntimeCache.get(encoder);
  if (cached) return cached;

  const args = [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=black:s=640x360:r=30',
    '-frames:v', '8',
    ...h264OutputArgs(encoder, 30, 1000),
    '-f', 'null', '-',
  ];

  const result = await new Promise<{ usable: boolean; reason?: string }>((resolve) => {
    const child = spawn(ffmpeg, args, { windowsHide: true });
    let stderr = '';
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 6000);
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 12000) stderr = stderr.slice(-12000);
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      resolve({ usable: false, reason: error.message });
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve({ usable: true });
      const lines = stderr.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      resolve({ usable: false, reason: lines.slice(-3).join(' ') || `FFmpeg encoder test exited with code ${code}.` });
    });
  });

  encoderRuntimeCache.set(encoder, result);
  return result;
}

export async function getEncoderCapabilities(): Promise<EncoderCapability[]> {
  const ffmpeg = await findFfmpegPath();
  const base = encoderOrder.map((name) => ({ name, available: false, usable: false, hardware: name !== 'libx264' }));
  if (!ffmpeg) return [{ name: 'auto', available: false, usable: false, hardware: false, reason: 'FFmpeg not found.' }, ...base];

  try {
    const { stdout = '', stderr = '' } = await execFileAsync(ffmpeg, ['-hide_banner', '-encoders'], {
      timeout: 5000,
      windowsHide: true,
      maxBuffer: 5 * 1024 * 1024,
    });
    const text = `${stdout}\n${stderr}`;
    const detected: EncoderCapability[] = [];

    // Test sequentially. Hardware encoders being listed by FFmpeg only means the
    // build contains them; it does not prove the installed GPU/driver can create
    // an encoder session. A short synthetic encode gives us the truthful answer.
    for (const item of base) {
      const available = new RegExp(`\\b${item.name}\\b`).test(text);
      if (!available) {
        detected.push({ ...item, available: false, usable: false, reason: 'Encoder is not present in this FFmpeg build.' });
        continue;
      }
      const runtime = await testEncoderRuntime(ffmpeg, item.name);
      detected.push({ ...item, available: true, usable: runtime.usable, reason: runtime.reason });
    }

    const selected = encoderOrder.find((name) => detected.some((e) => e.name === name && e.usable));
    return [{
      name: 'auto',
      available: detected.some((e) => e.available),
      usable: Boolean(selected),
      hardware: false,
      reason: selected ? `Auto will use ${selected}.` : 'No usable H.264 encoder was found.',
    }, ...detected];
  } catch (error: any) {
    return [{ name: 'auto', available: false, usable: false, hardware: false, reason: error?.message || 'Unable to inspect FFmpeg encoders.' }, ...base];
  }
}

export async function chooseEncoder(requested = 'auto'): Promise<string> {
  const caps = await getEncoderCapabilities();
  if (requested !== 'auto') {
    const hit = caps.find((c) => c.name === requested);
    if (!hit?.available) throw Object.assign(new Error(`Requested FFmpeg encoder '${requested}' is not present in this FFmpeg build.`), { code: 'ENCODER_NOT_AVAILABLE', stage: 'stream' });
    if (!hit.usable) throw Object.assign(new Error(`Requested FFmpeg encoder '${requested}' is installed but cannot start on this PC. ${hit.reason || ''}`.trim()), { code: 'ENCODER_NOT_USABLE', stage: 'stream', details: hit.reason });
    return requested;
  }
  const selected = encoderOrder.find((name) => caps.some((c) => c.name === name && c.usable));
  if (!selected) throw Object.assign(new Error('No usable H.264 FFmpeg encoder is available. Install/repair the GPU driver or ensure libx264 is present.'), { code: 'NO_USABLE_H264_ENCODER', stage: 'stream' });
  return selected;
}

export function directShowInputArgs(source: {
  device_id: string;
  width: number;
  height: number;
  fps: number;
  pixel_format?: string | null;
}): string[] {
  const args = ['-hide_banner', '-loglevel', 'info', '-f', 'dshow'];
  if (source.width && source.height) args.push('-video_size', `${source.width}x${source.height}`);
  if (source.fps) args.push('-framerate', String(source.fps));
  if (source.pixel_format) {
    if (source.pixel_format.toLowerCase() === 'mjpeg') args.push('-vcodec', 'mjpeg');
    else args.push('-pixel_format', source.pixel_format);
  }
  const input = source.device_id.startsWith('video=') ? source.device_id : `video=${source.device_id}`;
  args.push('-i', input);
  return args;
}

export function h264OutputArgs(encoder: string, fps: number, bitrateKbps: number): string[] {
  const args = ['-an', '-c:v', encoder, '-b:v', `${bitrateKbps}k`, '-maxrate', `${bitrateKbps}k`, '-bufsize', `${bitrateKbps * 2}k`, '-pix_fmt', 'yuv420p', '-r', String(fps), '-fps_mode', 'cfr', '-g', String(Math.max(15, Math.round(fps * 2))), '-bf', '0'];
  if (encoder === 'libx264') args.push('-preset', 'veryfast', '-tune', 'zerolatency');
  if (encoder === 'h264_nvenc') args.push('-preset', 'p4', '-tune', 'll');
  return args;
}

export async function probeUsbCapture(source: {
  device_id: string;
  width: number;
  height: number;
  fps: number;
  pixel_format?: string | null;
  durationSeconds?: number;
}) {
  if (process.platform !== 'win32') {
    return { ok: false, ffmpeg_available: Boolean(await findFfmpegPath()), device_opened: false, code: 'DIRECTSHOW_UNAVAILABLE', message: 'DirectShow probing is available only on Windows hosts.' };
  }
  const ffmpeg = await findFfmpegPath();
  if (!ffmpeg) return { ok: false, ffmpeg_available: false, device_opened: false, code: 'FFMPEG_NOT_FOUND', message: 'FFmpeg was not found. Install FFmpeg or set FFMPEG_PATH.' };
  const seconds = Math.max(1, Math.min(5, source.durationSeconds || 2));
  const args = [...directShowInputArgs(source), '-t', String(seconds), '-an', '-f', 'null', '-'];
  const started = Date.now();

  return await new Promise<any>((resolve) => {
    const child = spawn(ffmpeg, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); if (stderr.length > 500_000) stderr = stderr.slice(-500_000); });
    const timer = setTimeout(() => child.kill(), (seconds + 5) * 1000);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, ffmpeg_available: true, device_opened: false, code: 'FFMPEG_START_FAILED', message: error.message, duration_ms: Date.now() - started });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const matches = [...stderr.matchAll(/frame=\s*(\d+)/g)];
      const frames = matches.length ? Number(matches[matches.length - 1][1]) : null;
      const ok = code === 0 && (frames === null || frames > 0);
      const compactDetails = stderr.split(/\r?\n/).filter(Boolean).slice(-6).join(' ');
      const busyOrGraphError = /already in use|could not run graph|error opening input|i\/o error/i.test(stderr);
      const failureCode = busyOrGraphError ? 'DEVICE_BUSY_OR_GRAPH_ERROR' : 'CAPTURE_FAILED';
      const failureMessage = busyOrGraphError
        ? 'Windows could not open the webcam capture graph. The camera may be in use by another application (Camera, Teams, Zoom, OBS, another FFmpeg process, or Diagnostics → Browser Media Test). Stop other camera users, wait a moment, then retry.'
        : (compactDetails || `FFmpeg exited with code ${code}.`);
      resolve({
        ok,
        ffmpeg_available: true,
        device_opened: ok,
        frames_received: frames,
        duration_ms: Date.now() - started,
        width: source.width,
        height: source.height,
        fps_requested: source.fps,
        code: ok ? undefined : failureCode,
        message: ok
          ? `Camera opened successfully and produced video at ${source.width}x${source.height} @ ${source.fps} FPS.`
          : failureMessage,
        details: ok ? undefined : compactDetails,
      });
    });
  });
}
