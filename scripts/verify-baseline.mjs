import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const manifest = path.join(root, 'BASELINE-P0.16.1.sha256');
const lines = fs.readFileSync(manifest, 'utf8').split(/\r?\n/).map((v) => v.trim()).filter(Boolean);
let failed = 0;
for (const line of lines) {
  const match = line.match(/^([0-9a-fA-F]{64})\s+(.+)$/);
  if (!match) continue;
  const expected = match[1].toLowerCase();
  const relative = match[2].trim().replace(/^\*?/, '');
  const filename = path.join(root, relative);
  const actual = crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
  const ok = actual === expected;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${relative}`);
  if (!ok) failed += 1;
}
if (failed) process.exit(1);
console.log('P0.16.1 protected media baseline verified.');
