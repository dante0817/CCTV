import net from 'node:net';
import tls from 'node:tls';
import os from 'node:os';
import type { SmtpSecureMode } from '../repositories/NotificationDeliveryRepository';

export interface SmtpSendOptions {
  host: string;
  port: number;
  secureMode: SmtpSecureMode;
  username?: string;
  password?: string;
  from: string;
  to: string[];
  subject: string;
  text: string;
  timeoutMs?: number;
}

interface SmtpResponse { code: number; lines: string[]; text: string; }

type AnySocket = net.Socket | tls.TLSSocket;

class ResponseReader {
  private buffer = '';
  private lines: string[] = [];
  private waiters: Array<{ resolve: (r: SmtpResponse) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }> = [];
  private responses: SmtpResponse[] = [];
  private onDataBound = (chunk: Buffer | string) => this.onData(chunk);
  private onErrorBound = (error: Error) => this.rejectAll(error);
  private onCloseBound = () => this.rejectAll(new Error('SMTP connection closed unexpectedly.'));

  constructor(private socket: AnySocket) {
    socket.on('data', this.onDataBound);
    socket.on('error', this.onErrorBound);
    socket.on('close', this.onCloseBound);
  }

  detach(): void {
    this.socket.off('data', this.onDataBound);
    this.socket.off('error', this.onErrorBound);
    this.socket.off('close', this.onCloseBound);
    this.rejectAll(new Error('SMTP transport upgraded.'));
  }

  next(timeoutMs = 15000): Promise<SmtpResponse> {
    const ready = this.responses.shift();
    if (ready) return Promise.resolve(ready);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex((item) => item.timer === timer);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error('SMTP response timed out.'));
      }, timeoutMs);
      this.waiters.push({ resolve, reject, timer });
    });
  }

  private onData(chunk: Buffer | string): void {
    this.buffer += chunk.toString();
    let index = this.buffer.indexOf('\r\n');
    while (index >= 0) {
      const line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 2);
      this.lines.push(line);
      const match = line.match(/^(\d{3})([ -])/);
      if (match && match[2] === ' ') {
        const response: SmtpResponse = { code: Number(match[1]), lines: [...this.lines], text: this.lines.join('\n') };
        this.lines = [];
        const waiter = this.waiters.shift();
        if (waiter) { clearTimeout(waiter.timer); waiter.resolve(response); }
        else this.responses.push(response);
      }
      index = this.buffer.indexOf('\r\n');
    }
  }

  private rejectAll(error: Error): void {
    while (this.waiters.length) {
      const waiter = this.waiters.shift()!;
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }
}

function waitConnect(socket: AnySocket, secure: boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const event = secure ? 'secureConnect' : 'connect';
    const timer = setTimeout(() => { cleanup(); reject(new Error('SMTP connection timed out.')); }, timeoutMs);
    const onOk = () => { cleanup(); resolve(); };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const cleanup = () => { clearTimeout(timer); socket.off(event, onOk); socket.off('error', onError); };
    socket.once(event, onOk);
    socket.once('error', onError);
  });
}

function expect(response: SmtpResponse, codes: number[], stage: string): void {
  if (!codes.includes(response.code)) throw new Error(`${stage}: SMTP ${response.code} ${response.text}`);
}

function encodeHeader(value: string): string {
  return /^[\x20-\x7E]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function normalizeAddress(value: string): string {
  const text = value.trim();
  const match = text.match(/<([^<>]+)>/);
  return (match ? match[1] : text).trim();
}

function dotStuff(text: string): string {
  return text.replace(/\r?\n/g, '\r\n').split('\r\n').map((line) => line.startsWith('.') ? `.${line}` : line).join('\r\n');
}

export class SmtpClientService {
  async send(options: SmtpSendOptions): Promise<void> {
    const host = options.host.trim();
    const port = Math.max(1, Math.min(65535, Math.trunc(options.port)));
    const timeout = Math.max(3000, Math.min(60000, options.timeoutMs ?? 15000));
    if (!host) throw new Error('SMTP host is required.');
    if (!options.from.trim()) throw new Error('SMTP From address is required.');
    if (!options.to.length) throw new Error('At least one SMTP recipient is required.');

    let socket: AnySocket;
    let reader: ResponseReader;
    if (options.secureMode === 'tls') {
      socket = tls.connect({ host, port, servername: host, rejectUnauthorized: true });
      reader = new ResponseReader(socket);
      await waitConnect(socket, true, timeout);
    } else {
      socket = net.createConnection({ host, port });
      reader = new ResponseReader(socket);
      await waitConnect(socket, false, timeout);
    }
    socket.setTimeout(timeout, () => socket.destroy(new Error('SMTP socket timed out.')));

    const command = async (line: string, accepted: number[], stage: string) => {
      socket.write(`${line}\r\n`);
      const response = await reader.next(timeout);
      expect(response, accepted, stage);
      return response;
    };

    try {
      expect(await reader.next(timeout), [220], 'SMTP greeting');
      const ehloName = os.hostname().replace(/[^A-Za-z0-9.-]/g, '-') || 'cctv-monitor';
      await command(`EHLO ${ehloName}`, [250], 'EHLO');

      if (options.secureMode === 'starttls') {
        await command('STARTTLS', [220], 'STARTTLS');
        reader.detach();
        const tlsSocket = tls.connect({ socket: socket as net.Socket, servername: host, rejectUnauthorized: true });
        socket = tlsSocket;
        reader = new ResponseReader(socket);
        await waitConnect(socket, true, timeout);
        socket.setTimeout(timeout, () => socket.destroy(new Error('SMTP TLS socket timed out.')));
        await command(`EHLO ${ehloName}`, [250], 'EHLO after STARTTLS');
      }

      const username = options.username?.trim() || '';
      const password = options.password || '';
      if (username) {
        socket.write(`AUTH PLAIN ${Buffer.from(`\u0000${username}\u0000${password}`, 'utf8').toString('base64')}\r\n`);
        let authResponse = await reader.next(timeout);
        if (authResponse.code !== 235) {
          socket.write('AUTH LOGIN\r\n');
          authResponse = await reader.next(timeout);
          expect(authResponse, [334], 'AUTH LOGIN');
          socket.write(`${Buffer.from(username, 'utf8').toString('base64')}\r\n`);
          expect(await reader.next(timeout), [334], 'SMTP username');
          socket.write(`${Buffer.from(password, 'utf8').toString('base64')}\r\n`);
          expect(await reader.next(timeout), [235], 'SMTP password');
        }
      }

      const envelopeFrom = normalizeAddress(options.from);
      await command(`MAIL FROM:<${envelopeFrom}>`, [250], 'MAIL FROM');
      for (const recipient of options.to) {
        await command(`RCPT TO:<${normalizeAddress(recipient)}>`, [250, 251], 'RCPT TO');
      }
      await command('DATA', [354], 'DATA');

      const message = [
        `Date: ${new Date().toUTCString()}`,
        `From: ${options.from}`,
        `To: ${options.to.join(', ')}`,
        `Subject: ${encodeHeader(options.subject)}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
        'X-Mailer: CCTV Monitor',
        '',
        dotStuff(options.text),
      ].join('\r\n');
      socket.write(`${message}\r\n.\r\n`);
      expect(await reader.next(timeout), [250], 'Message delivery');
      try { await command('QUIT', [221], 'QUIT'); } catch {}
    } finally {
      reader.detach();
      if (!socket.destroyed) socket.end();
    }
  }
}
