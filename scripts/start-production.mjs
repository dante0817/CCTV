import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const entry = path.join(root, 'dist-server', 'server.js');
if (!fs.existsSync(entry)) {
  console.error(`Production server is not built: ${entry}`);
  console.error('Run npm run build first.');
  process.exit(2);
}
const env = { ...process.env, NODE_ENV: 'production', CCTV_ROOT_DIR: root };
const child = spawn(process.execPath, [entry], { cwd: root, env, stdio: 'inherit', windowsHide: false });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { try { child.kill(signal); } catch {} });
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
