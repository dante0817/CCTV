import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';

const execFileAsync = promisify(execFile);

export interface UsbDevice {
  name: string;
  device_id: string;
  alternative_name: string | null;
  is_video: boolean;
}

export interface UsbFormat {
  pixel_format: string;
  codec: string;
  width: number;
  height: number;
  min_fps: number;
  max_fps: number;
}

export const VIDEO_DEVICE_RE = /"(.+?)"\s+\(video\)\s*$/;
export const ALT_NAME_RE = /Alternative name\s+"(.+?)"/;
export const DSHOW_FORMAT_RE = /(?:pixel_format|vcodec)=([^\s]+)\s+min s=(\d+)x(\d+)\s+fps=([\d.]+)\s+max s=(\d+)x(\d+)\s+fps=([\d.]+)/i;

async function executableWorks(exe: string): Promise<boolean> {
  try {
    await execFileAsync(exe, ['-version'], { timeout: 3000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

export async function findFfmpegPath(): Promise<string | null> {
  const candidates = [
    process.env.FFMPEG_PATH,
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
    '/usr/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    'ffmpeg',
  ].filter((v): v is string => Boolean(v));

  for (const candidate of candidates) {
    if (candidate.includes('\\') || candidate.includes('/')) {
      if (!fs.existsSync(candidate)) continue;
    }
    if (await executableWorks(candidate)) return candidate;
  }
  return null;
}

export function parseDshowDevices(text: string): UsbDevice[] {
  const devices: UsbDevice[] = [];
  let current: UsbDevice | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const match = line.match(VIDEO_DEVICE_RE);
    if (match?.[1]) {
      current = { name: match[1], device_id: match[1], alternative_name: null, is_video: true };
      devices.push(current);
      continue;
    }
    if (current) {
      const alt = line.match(ALT_NAME_RE);
      if (alt?.[1]) {
        current.alternative_name = alt[1];
        current.device_id = alt[1];
        current = null;
      }
    }
  }
  const seen = new Set<string>();
  return devices.filter((d) => !seen.has(d.device_id) && Boolean(seen.add(d.device_id)));
}

export function parseDshowFormats(text: string): UsbFormat[] {
  const formats: UsbFormat[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.trim().match(DSHOW_FORMAT_RE);
    if (!m) continue;
    const [, format, minW, minH, minFpsStr, maxW, maxH, maxFpsStr] = m;
    const widths = [Number(minW), Number(maxW)];
    const heights = [Number(minH), Number(maxH)];
    const width = widths[1] || widths[0];
    const height = heights[1] || heights[0];
    const min_fps = Number(minFpsStr) || 1;
    const max_fps = Number(maxFpsStr) || min_fps;
    const pixel_format = format.toLowerCase();
    const key = `${width}x${height}-${pixel_format}-${max_fps}`;
    if (seen.has(key)) continue;
    seen.add(key);
    formats.push({ pixel_format, codec: pixel_format, width, height, min_fps, max_fps });
  }
  return formats.sort((a, b) => (b.width * b.height - a.width * a.height) || (b.max_fps - a.max_fps));
}

function assertDirectShowHost() {
  if (process.platform !== 'win32') {
    const err = new Error('DirectShow USB discovery is available only on Windows hosts.');
    (err as any).code = 'DIRECTSHOW_UNAVAILABLE';
    throw err;
  }
}

export async function enumerateDevices(timeoutMs = 10000): Promise<UsbDevice[]> {
  assertDirectShowHost();
  const ffmpeg = await findFfmpegPath();
  if (!ffmpeg) {
    const err = new Error('FFmpeg was not found. Install FFmpeg or set FFMPEG_PATH.');
    (err as any).code = 'FFMPEG_NOT_FOUND';
    throw err;
  }
  try {
    const { stderr = '', stdout = '' } = await execFileAsync(
      ffmpeg,
      ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
    );
    return parseDshowDevices(`${stderr}\n${stdout}`);
  } catch (error: any) {
    const parsed = parseDshowDevices(`${error?.stderr || ''}\n${error?.stdout || ''}`);
    if (parsed.length > 0) return parsed;
    const err = new Error('DirectShow device enumeration failed.');
    (err as any).code = 'DSHOW_ENUMERATION_FAILED';
    (err as any).details = String(error?.stderr || error?.message || error);
    throw err;
  }
}

export async function enumerateFormats(deviceId: string, timeoutMs = 10000): Promise<UsbFormat[]> {
  assertDirectShowHost();
  const ffmpeg = await findFfmpegPath();
  if (!ffmpeg) {
    const err = new Error('FFmpeg was not found. Install FFmpeg or set FFMPEG_PATH.');
    (err as any).code = 'FFMPEG_NOT_FOUND';
    throw err;
  }
  const input = deviceId.startsWith('video=') ? deviceId : `video=${deviceId}`;
  try {
    const { stderr = '', stdout = '' } = await execFileAsync(
      ffmpeg,
      ['-hide_banner', '-f', 'dshow', '-list_options', 'true', '-i', input],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
    );
    return parseDshowFormats(`${stderr}\n${stdout}`);
  } catch (error: any) {
    const parsed = parseDshowFormats(`${error?.stderr || ''}\n${error?.stdout || ''}`);
    if (parsed.length > 0) return parsed;
    const err = new Error('Unable to read capture modes for the selected DirectShow device.');
    (err as any).code = 'DSHOW_FORMATS_FAILED';
    (err as any).details = String(error?.stderr || error?.message || error);
    throw err;
  }
}
