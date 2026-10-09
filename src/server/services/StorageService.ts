import fs from 'fs/promises';
import path from 'path';

export interface StorageStatusSnapshot {
  ok: boolean;
  state: 'healthy' | 'unhealthy' | 'unknown';
  path: string;
  volumeRoot: string;
  writable: boolean;
  totalBytes: number | null;
  freeBytes: number | null;
  usedBytes: number | null;
  databaseBytes: number | null;
  recordingsBytes: number;
  recordingImplemented: true;
  retentionImplemented: true;
  error: string | null;
}

export class StorageService {
  readonly recordingPath: string;
  private recordingSizeCache = { at: 0, bytes: 0 };

  constructor(private dbPath: string, private rootDir: string) {
    const dataDir = process.env.CCTV_DATA_DIR
      ? path.resolve(process.env.CCTV_DATA_DIR)
      : path.dirname(dbPath);
    this.recordingPath = process.env.CCTV_RECORDINGS_DIR
      ? path.resolve(process.env.CCTV_RECORDINGS_DIR)
      : path.join(dataDir || path.join(rootDir, 'data'), 'recordings');
  }

  async status(): Promise<StorageStatusSnapshot> {
    const volumeRoot = path.parse(path.resolve(this.recordingPath)).root || path.resolve(this.recordingPath);
    try {
      await fs.mkdir(this.recordingPath, { recursive: true });
      const [stats, databaseBytes, writable, recordingsBytes] = await Promise.all([
        fs.statfs(this.recordingPath),
        this.fileSize(this.dbPath),
        this.writeProbe(),
        this.cachedDirectorySize(),
      ]);
      const totalBytes = Number(stats.blocks) * Number(stats.bsize);
      const freeBytes = Number(stats.bavail) * Number(stats.bsize);
      const usedBytes = Math.max(0, totalBytes - freeBytes);
      return {
        ok: writable,
        state: writable ? 'healthy' : 'unhealthy',
        path: this.recordingPath,
        volumeRoot,
        writable,
        totalBytes,
        freeBytes,
        usedBytes,
        databaseBytes,
        recordingsBytes,
        recordingImplemented: true,
        retentionImplemented: true,
        error: writable ? null : 'Recording/data directory is not writable.',
      };
    } catch (error: any) {
      return {
        ok: false,
        state: 'unknown',
        path: this.recordingPath,
        volumeRoot,
        writable: false,
        totalBytes: null,
        freeBytes: null,
        usedBytes: null,
        databaseBytes: await this.fileSize(this.dbPath),
        recordingsBytes: await this.cachedDirectorySize().catch(() => 0),
        recordingImplemented: true,
        retentionImplemented: true,
        error: error?.message || String(error),
      };
    }
  }

  invalidateRecordingSizeCache(): void { this.recordingSizeCache = { at: 0, bytes: 0 }; }

  private async fileSize(filePath: string): Promise<number | null> {
    try { return Number((await fs.stat(filePath)).size); } catch { return null; }
  }

  private async cachedDirectorySize(): Promise<number> {
    if (Date.now() - this.recordingSizeCache.at < 30_000) return this.recordingSizeCache.bytes;
    const bytes = await this.directorySize(this.recordingPath);
    this.recordingSizeCache = { at: Date.now(), bytes };
    return bytes;
  }

  private async directorySize(dir: string): Promise<number> {
    let total = 0;
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return 0; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) total += await this.directorySize(full);
      else if (entry.isFile()) {
        try { total += Number((await fs.stat(full)).size); } catch {}
      }
    }
    return total;
  }

  private async writeProbe(): Promise<boolean> {
    const probe = path.join(this.recordingPath, `.cctv-write-probe-${process.pid}-${Date.now()}`);
    try {
      await fs.writeFile(probe, 'ok', { encoding: 'utf8', flag: 'wx' });
      await fs.unlink(probe);
      return true;
    } catch {
      try { await fs.unlink(probe); } catch {}
      return false;
    }
  }
}
