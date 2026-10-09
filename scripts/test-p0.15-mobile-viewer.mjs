import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const must = (ok, msg) => { if (!ok) throw new Error(msg); };

const pkg = JSON.parse(read('package.json'));
const app = read('src/App.tsx');
const live = read('src/components/live/LiveView.tsx');
const mobile = read('src/components/mobile/MobileNavigation.tsx');
const header = read('src/components/layout/Header.tsx');
const sidebar = read('src/components/layout/Sidebar.tsx');
const css = read('src/index.css');
const html = read('index.html');
const player = read('src/components/live/CameraPlayer.tsx');
const baseline = read('BASELINE-P0.15.sha256');

must(/^0\.2\.0-p0\.(?:1[5-9]|[2-9]\d)(?:\.\d+)?-pw8$/.test(pkg.version), 'Current package must retain P0.15 mobile-viewer foundation.');
must(app.includes('<MobileNavigation'), 'App must render mobile navigation.');
must(sidebar.includes('hidden lg:flex'), 'Desktop sidebar must be hidden on compact layouts.');
must(mobile.includes("role === 'Viewer'"), 'Mobile nav must provide Viewer-specific controls.');
must(mobile.includes("go('live', 'Live'"), 'Viewer mobile nav must expose Live View.');
must(live.includes("useMediaQuery('(max-width: 767px)')"), 'Live View must detect phone viewport.');
must(live.includes('onTouchStart') && live.includes('onTouchEnd'), 'Phone Live View must support camera swipe switching.');
must(live.includes('requestCameraFullscreen'), 'Phone Live View must support camera fullscreen.');
must(live.includes('<RemoteConnectionBadge'), 'Live View must expose remote/network context.');
must(header.includes('lg:hidden'), 'Header must include compact mobile presentation.');
must((app + mobile + css).includes('env(safe-area-inset-bottom)'), 'Mobile UI must account for safe-area inset.');
must(css.includes('.mobile-touch-target'), 'Touch targets must be standardized.');
must(html.includes('viewport-fit=cover'), 'Viewport must support edge-to-edge safe areas.');
must(player.includes('WebRTC') && player.includes('HLS'), 'Protected playback component must remain WebRTC/HLS capable.');
must(baseline.includes('CameraPlayer.tsx'), 'Protected media baseline must include CameraPlayer.');

console.log('PASS P0.15 responsive mobile navigation, focus live view, touch controls, and remote-context foundation');
