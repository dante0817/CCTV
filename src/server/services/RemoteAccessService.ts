import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function isTailscaleIPv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  return parts.length === 4 && parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}

function findExecutable(name: string): string | null {
  const names = process.platform === 'win32' ? [`${name}.exe`, name] : [name];
  const candidates = [
    ...(process.platform === 'win32' ? [
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Tailscale', 'tailscale.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Tailscale', 'tailscale.exe'),
    ] : []),
  ];
  for (const item of candidates) if (fs.existsSync(item)) return item;
  for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const n of names) {
      const candidate = path.join(dir.replace(/^"|"$/g, ''), n);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

export async function getRemoteAccessStatus() {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = [];
  const tailscaleIps: string[] = [];
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      addresses.push(entry.address);
      if (isTailscaleIPv4(entry.address)) tailscaleIps.push(entry.address);
    }
  }

  const binary = findExecutable('tailscale');
  let dnsName: string | null = null;
  let backendState: string | null = null;
  let error: string | null = null;
  let serveConfigured = false;
  let serveUrl: string | null = null;
  let serveDetail: string | null = null;
  if (binary) {
    try {
      const { stdout } = await execFileAsync(binary, ['status', '--json'], { timeout: 2500, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
      const parsed: any = JSON.parse(stdout);
      dnsName = parsed?.Self?.DNSName ? String(parsed.Self.DNSName).replace(/\.$/, '') : null;
      backendState = parsed?.BackendState || null;
      for (const ip of parsed?.TailscaleIPs || parsed?.Self?.TailscaleIPs || []) if (!tailscaleIps.includes(ip)) tailscaleIps.push(ip);
    } catch (e: any) {
      error = e?.message || String(e);
    }
    try {
      const { stdout } = await execFileAsync(binary, ['serve', 'status', '--json'], { timeout: 2500, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
      const parsed: any = JSON.parse(stdout || '{}');
      const text = JSON.stringify(parsed);
      serveConfigured = Boolean(parsed && Object.keys(parsed).length && !/\{\}/.test(text));
      if (dnsName && serveConfigured) serveUrl = `https://${dnsName}`;
      serveDetail = serveConfigured ? 'Serve configuration is active.' : 'Serve is not configured.';
    } catch {
      try {
        const { stdout } = await execFileAsync(binary, ['serve', 'status'], { timeout: 2500, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
        serveDetail = stdout.trim() || null;
        serveConfigured = /https:\/\//i.test(stdout) || /proxy/i.test(stdout);
        const match = stdout.match(/https:\/\/[^\s]+/i);
        serveUrl = match?.[0] || (dnsName && serveConfigured ? `https://${dnsName}` : null);
      } catch {}
    }
  }

  return {
    installed: Boolean(binary),
    binary,
    connected: tailscaleIps.length > 0 && (!backendState || backendState === 'Running'),
    backendState,
    dnsName,
    tailscaleIps,
    lanAddresses: addresses.filter((a) => !isTailscaleIPv4(a)),
    recommendedHost: dnsName || tailscaleIps[0] || addresses[0] || os.hostname(),
    serveConfigured,
    serveUrl,
    serveDetail,
    error,
  };
}
