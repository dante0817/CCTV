import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export class CredentialService {
  private key: Buffer;

  constructor(rootDir: string) {
    this.key = this.loadOrCreateKey(rootDir);
  }

  encrypt(plaintext: string): string {
    if (!plaintext) return '';
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
  }

  internalSecret(purpose: string): string {
    return crypto.createHmac('sha256', this.key).update(`cctv-internal:${purpose}`).digest('base64url');
  }

  decrypt(encoded: string): string {
    if (!encoded) return '';
    const [version, ivB64, tagB64, dataB64] = encoded.split('.');
    if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) throw new Error('Unsupported encrypted credential format.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB64, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]).toString('utf8');
  }

  private loadOrCreateKey(rootDir: string): Buffer {
    const configured = process.env.CCTV_CREDENTIAL_KEY?.trim();
    if (configured) return crypto.createHash('sha256').update(configured).digest();

    const dataDir = path.join(rootDir, 'data');
    const keyPath = path.join(dataDir, '.credential-key');
    fs.mkdirSync(dataDir, { recursive: true });
    if (fs.existsSync(keyPath)) {
      const text = fs.readFileSync(keyPath, 'utf8').trim();
      const decoded = Buffer.from(text, 'base64url');
      if (decoded.length === 32) return decoded;
      throw new Error(`Invalid credential key file: ${keyPath}`);
    }

    const key = crypto.randomBytes(32);
    fs.writeFileSync(keyPath, key.toString('base64url'), { encoding: 'utf8', mode: 0o600 });
    return key;
  }
}
