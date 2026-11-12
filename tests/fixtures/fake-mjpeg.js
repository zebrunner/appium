// The fixture of tests/mjpeg_relay_test.sh, run with node:
//   fake-mjpeg.js server <mode> [screenshot file]: a fake WDA on a free port (printed as "port <n>"): the MJPEG
//     stream (any url) and GET /screenshot; the frames are fake JPEG data "<SOI><label><padding><EOI>" of 64 KB, larger
//     than the buffer of a pipe as the frames of a device
//     modes: static - one frame A and nothing more (a static screen of WDA)
//            changing - the frames B01..B10 every 100 ms, then nothing
//            drop - the first connection sends C1 and ends after 300 ms, the next ones send C2
//            none - no frames; /screenshot is the screenshot file (base64), a fake JPEG S1 without it
//            broken - no frames, /screenshot is not an image
//   fake-mjpeg.js read <ms>: reads the relay output from stdin for the given time, then prints
//     {"frames": <count>, "labels": "<labels of the frames, the repeated ones once>", "jpeg": <all frames are JPEG>}
//     and exits, which closes the pipe of the relay
const http = require('http');
const fs = require('fs');

const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);
const frame = (label) => Buffer.concat([SOI, Buffer.from(label), Buffer.alloc(64 * 1024), EOI]);
const part = (f) => Buffer.concat([Buffer.from(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${f.length}\r\n\r\n`), f,
  Buffer.from('\r\n')]);

const [role, arg, screenshotFile] = process.argv.slice(2);

if (role === 'server') {
  let connections = 0;
  const server = http.createServer((req, res) => {
    if (req.url === '/screenshot') {
      res.writeHead(200, {'Content-Type': 'application/json'});
      const value = arg === 'broken' ? {state: 'success'}
        : (screenshotFile ? fs.readFileSync(screenshotFile) : frame('S1')).toString('base64');
      res.end(JSON.stringify({value}));
      return;
    }
    connections++;
    res.writeHead(200, {'Content-Type': 'multipart/x-mixed-replace; boundary=frame'});
    const timers = [];
    req.on('close', () => timers.forEach(clearTimeout));
    if (arg === 'static') {
      res.write(part(frame('A')));
    } else if (arg === 'changing') {
      for (let i = 1; i <= 10; i++) {
        timers.push(setTimeout(() => res.write(part(frame(`B${String(i).padStart(2, '0')}`))), i * 100));
      }
    } else if (arg === 'drop') {
      if (connections === 1) {
        res.write(part(frame('C1')));
        timers.push(setTimeout(() => res.destroy(), 300));
      } else {
        res.write(part(frame('C2')));
      }
    }
  });
  server.listen(0, '127.0.0.1', () => console.log(`port ${server.address().port}`));
} else if (role === 'read') {
  // counted on the fly, not kept: a relay writing as fast as the reader reads must fail the test, not fill the memory
  const labels = [];
  let frames = 0;
  let bytes = 0;
  let tail = Buffer.alloc(0);
  process.stdin.on('data', (chunk) => {
    bytes += chunk.length;
    const data = tail.length ? Buffer.concat([tail, chunk]) : chunk;
    // the last byte may start the marker of the next chunk, a marker without its label is counted with the next chunk
    let keepFrom = data.length - 1;
    for (let i = data.indexOf(SOI); i !== -1; i = data.indexOf(SOI, i + 2)) {
      if (i + 5 > data.length) {
        keepFrom = i;
        break;
      }
      frames++;
      const label = data.toString('latin1', i + 2, i + 5).replace(/[^A-Z0-9]/g, '');
      if (labels[labels.length - 1] !== label) {
        labels.push(label);
      }
    }
    tail = data.subarray(keepFrom);
  });
  setTimeout(() => {
    console.log(JSON.stringify({frames, labels: labels.join(' '), jpeg: frames > 0 || bytes === 0}));
    process.exit(0);
  }, Number(arg));
}
