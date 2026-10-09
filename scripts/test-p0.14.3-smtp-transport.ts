import net from 'node:net';
import assert from 'node:assert/strict';
import { SmtpClientService } from '../src/server/services/SmtpClientService';

let received = '';
let authSeen = false;
const server = net.createServer((socket) => {
  socket.setEncoding('utf8');
  socket.write('220 cctv-test ESMTP\r\n');
  let buffer = '';
  let dataMode = false;
  socket.on('data', (chunk) => {
    buffer += chunk;
    if (dataMode) {
      const end = buffer.indexOf('\r\n.\r\n');
      if (end >= 0) {
        received += buffer.slice(0, end);
        buffer = buffer.slice(end + 5);
        dataMode = false;
        socket.write('250 queued\r\n');
      }
      return;
    }
    let index;
    while ((index = buffer.indexOf('\r\n')) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      if (line.startsWith('EHLO ')) socket.write('250-cctv-test\r\n250 AUTH PLAIN LOGIN\r\n');
      else if (line.startsWith('AUTH PLAIN ')) { authSeen = true; socket.write('235 authenticated\r\n'); }
      else if (line.startsWith('MAIL FROM:')) socket.write('250 ok\r\n');
      else if (line.startsWith('RCPT TO:')) socket.write('250 ok\r\n');
      else if (line === 'DATA') { dataMode = true; socket.write('354 send data\r\n'); break; }
      else if (line === 'QUIT') { socket.write('221 bye\r\n'); socket.end(); }
      else socket.write('250 ok\r\n');
    }
  });
});

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert(address && typeof address === 'object');
try {
  const client = new SmtpClientService();
  await client.send({
    host: '127.0.0.1', port: address.port, secureMode: 'none', username: 'test-user', password: 'test-password',
    from: 'alerts@example.test', to: ['admin@example.test'], subject: 'CCTV SMTP transport test', text: 'Camera offline test message.',
  });
  assert.equal(authSeen, true);
  assert.match(received, /Subject: CCTV SMTP transport test/);
  assert.match(received, /Camera offline test message\./);
  console.log('PASS P0.14.3 native SMTP transport against local fake server');
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
