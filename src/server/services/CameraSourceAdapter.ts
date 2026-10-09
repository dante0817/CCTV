import type { Camera } from '../../types/cctv';
import { CameraRepository } from '../repositories/CameraRepository';
import { CredentialService } from './CredentialService';
import { chooseEncoder, directShowInputArgs, h264OutputArgs } from './FfmpegService';
import { buildRtspUrl } from './RtspService';

export interface PreparedCameraSource {
  ffmpegArgs: string[];
  encoder: string;
  sourceDescription: string;
  cameraPatch: Partial<Camera>;
}

export interface CameraSourceAdapter {
  readonly sourceType: NonNullable<Camera['source_type']>;
  prepare(camera: Camera): Promise<PreparedCameraSource>;
}

class UsbCameraSourceAdapter implements CameraSourceAdapter {
  readonly sourceType = 'usb' as const;

  async prepare(camera: Camera): Promise<PreparedCameraSource> {
    if (process.platform !== 'win32') throw Object.assign(new Error('USB DirectShow streaming is available only on Windows.'), { code: 'DIRECTSHOW_UNAVAILABLE', stage: 'capture' });
    if (!camera.usb_source) throw Object.assign(new Error('USB camera capture configuration is missing.'), { code: 'USB_CONFIG_MISSING', stage: 'capture' });

    const encoder = await chooseEncoder(camera.usb_source.encoder || 'auto');
    return {
      encoder,
      sourceDescription: camera.usb_source.device_name,
      ffmpegArgs: [
        ...directShowInputArgs(camera.usb_source),
        ...h264OutputArgs(encoder, camera.usb_source.fps, camera.usb_source.bitrate_kbps),
      ],
      cameraPatch: {
        usb_source: { ...camera.usb_source, encoder_active: encoder },
      },
    };
  }
}

class RtspCameraSourceAdapter implements CameraSourceAdapter {
  readonly sourceType = 'rtsp' as const;

  constructor(private repo: CameraRepository, private credentials: CredentialService) {}

  async prepare(camera: Camera): Promise<PreparedCameraSource> {
    const config = this.repo.getRtspConfig(camera.id);
    if (!config) throw Object.assign(new Error('RTSP camera connection configuration is missing.'), { code: 'RTSP_CONFIG_MISSING', stage: 'capture' });

    const password = this.credentials.decrypt(config.password_encrypted);
    const inputUrl = buildRtspUrl({
      host: config.host,
      port: config.port,
      path: config.stream_path,
      username: config.username,
      password,
      transport: config.transport,
    });

    const ffmpegArgs = ['-hide_banner', '-loglevel', 'info', '-rtsp_transport', config.transport, '-i', inputUrl, '-map', '0:v:0'];
    let encoder: string;
    if (config.video_mode === 'copy') {
      encoder = 'stream-copy';
      ffmpegArgs.push('-an', '-c:v', 'copy');
    } else {
      encoder = await chooseEncoder(config.encoder || 'auto');
      ffmpegArgs.push(...h264OutputArgs(encoder, Math.max(1, camera.fps || 20), config.bitrate_kbps));
    }

    return {
      encoder,
      sourceDescription: `${config.vendor_profile === 'tenda-cp3-pro' ? 'Tenda CP3 Pro' : 'RTSP'} ${config.host}:${config.port}${config.stream_path}`,
      ffmpegArgs,
      cameraPatch: {
        rtsp_source: camera.rtsp_source ? {
          ...camera.rtsp_source,
          encoder_active: encoder,
          credential_configured: Boolean(config.username || config.password_encrypted),
        } : camera.rtsp_source,
      },
    };
  }
}

export class CameraSourceAdapterRegistry {
  private adapters = new Map<string, CameraSourceAdapter>();

  constructor(repo: CameraRepository, credentials: CredentialService) {
    for (const adapter of [new UsbCameraSourceAdapter(), new RtspCameraSourceAdapter(repo, credentials)]) {
      this.adapters.set(adapter.sourceType, adapter);
    }
  }

  supportedTypes(): string[] { return [...this.adapters.keys()]; }

  async prepare(camera: Camera): Promise<PreparedCameraSource> {
    const sourceType = camera.source_type || '';
    const adapter = this.adapters.get(sourceType);
    if (!adapter) throw Object.assign(new Error(`Camera source '${sourceType || 'unknown'}' is not implemented.`), { code: 'CAMERA_SOURCE_UNSUPPORTED', stage: 'capture' });
    return adapter.prepare(camera);
  }
}
