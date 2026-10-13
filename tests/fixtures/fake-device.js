// The device side of the appium container for tests/e2e_test.sh, run with node as the `connector` and `device` hosts:
// WDA (8100), the WDA MJPEG server (8101), a MJPEG server without frames (8102), usbmuxd (2222) and the adb server
// (5037) of the connector (connections are logged only)
// and the STF screen broadcast (2223, 'on'/'off' control and the MJPEG stream).
// The frames are JPEG files of FRAMES_DIR (none without it), FAKE_OS_NAME / FAKE_OS_VERSION are the os of the WDA
// status (iOS 17.4 by default), the log lines are parsed by the test.
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');

const dir = process.env.FRAMES_DIR ?? '/frames';
const frames = fs.existsSync(dir)
  ? fs.readdirSync(dir).filter(f => f.endsWith('.jpg')).sort().map(f => fs.readFileSync(path.join(dir, f)))
  : [];
let idx = 0;
const next = () => frames[idx++ % frames.length] ?? Buffer.alloc(0);
const log = (...a) => console.log(new Date().toISOString(), ...a);

http.createServer((req, res) => {
  log('[WDA]', req.method, req.url);
  res.writeHead(200, {'Content-Type': 'application/json'});
  const os = {name: process.env.FAKE_OS_NAME ?? 'iOS', version: process.env.FAKE_OS_VERSION ?? '17.4'};
  res.end(JSON.stringify({value: {state: 'success', os, ready: true}, sessionId: null}));
}).listen(8100);

http.createServer((req, res) => {
  log('[MJPEG] client connected');
  res.writeHead(200, {'Content-Type': 'multipart/x-mixed-replace; boundary=frame'});
  const t = setInterval(() => {
    const f = next();
    res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${f.length}\r\n\r\n`);
    res.write(f);
    res.write('\r\n');
  }, 100);
  req.on('close', () => { clearInterval(t); log('[MJPEG] client closed'); });
}).listen(8101);

http.createServer((req, res) => {
  log('[MJPEG] client connected, no frames');
  res.writeHead(200, {'Content-Type': 'multipart/x-mixed-replace; boundary=frame'});
}).listen(8102);

net.createServer(sock => {
  log('[USBMUXD] client connected');
  sock.on('error', () => {});
  sock.end();
}).listen(2222);

net.createServer(sock => {
  log('[ADB] client connected');
  sock.on('error', () => {});
  sock.end();
}).listen(5037);

let streaming = false;
net.createServer(sock => {
  const timer = setTimeout(() => {
    log('[STF] video client connected, streaming=', streaming);
    const t = setInterval(() => { if (streaming) sock.write(next()); }, 100);
    sock.on('close', () => { clearInterval(t); log('[STF] video client closed'); });
  }, 300);
  sock.on('data', d => {
    clearTimeout(timer);
    const cmd = d.toString().trim();
    streaming = cmd === 'on';
    log('[STF] control:', cmd);
    sock.end();
  });
  sock.on('error', () => {});
}).listen(2223);

log('fake servers up, frames:', frames.length);
