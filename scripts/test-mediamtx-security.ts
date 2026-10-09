import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { MediaMtxService } from '../src/server/services/MediaMtxService';

let config: any = {
  authMethod: 'internal',
  authHTTPAddress: '',
  authHTTPExclude: [],
  api: true,
  apiAddress: ':9997',
};
let patchCount = 0;

const mock = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/v3/config/global/get') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(config));
    return;
  }
  if (req.method === 'PATCH' && req.url === '/v3/config/global/patch') {
    let body = '';
    for await (const chunk of req) body += chunk;
    config = { ...config, ...JSON.parse(body || '{}') };
    patchCount += 1;
    res.statusCode = 200;
    res.end('{}');
    return;
  }
  if (req.method === 'GET' && req.url === '/v3/info') {
    res.setHeader('Content-Type', 'application/json');
    res.end('{}');
    return;
  }
  res.statusCode = 404;
  res.end();
});

async function main() {
  await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', resolve));
  try {
  const address = mock.address() as AddressInfo;
  process.env.MEDIAMTX_API_URL = `http://127.0.0.1:${address.port}`;
  process.env.PORT = '3107';
  const service = new MediaMtxService(process.cwd());
  await service.ensureSecurityConfiguration();

  assert.equal(patchCount, 1, 'insecure MediaMTX config should be patched exactly once');
  assert.equal(config.authMethod, 'http');
  assert.equal(config.authHTTPAddress, 'http://127.0.0.1:3107/internal/mediamtx/auth');
  assert.equal(config.apiAddress, '127.0.0.1:9997');
  assert.ok(config.authHTTPExclude.some((entry: any) => entry.action === 'api'));

  await service.ensureSecurityConfiguration();
  assert.equal(patchCount, 1, 'verified secure config should not be patched again');
  console.log('MediaMTX security configuration regression check passed.');
  } finally {
    await new Promise<void>((resolve) => mock.close(() => resolve()));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
