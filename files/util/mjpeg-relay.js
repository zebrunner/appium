#!/usr/bin/env node
// mjpeg-relay.js <mjpegUrl> [screenshotUrl] [recording id]: the JPEG frames of the WDA MJPEG server on stdout, for
// ffmpeg -i pipe:0
//
// WDA sends a frame only when the screen changes (the zebrunner fork repeats the last one every 20 s), from 0.1 fps on
// an idle device to a few fps. On such a stream ffmpeg holds the frames in its buffers and on SIGINT waits for the
// next frame of the device to finish the video: a short session or a static screen gave an empty video, a long one
// was killed. The relay writes every new frame at once and repeats the last one after MJPEG_RELAY_HEARTBEAT_MS, so
// ffmpeg always has frames and the timestamps of the wall clock keep the timeline. Without a frame of the stream after
// MJPEG_RELAY_FIRST_FRAME_MS the first frame is the screenshot of WDA. The relay reconnects to an ended stream and
// exits with ffmpeg on the next write; without any frame to write it is stopped by the end of the recording
// (stopRelay of module/recording.sh, the recording id is the last argument for it and for the log).

'use strict';

const http = require('http');
const { execFile } = require('child_process');

const [mjpegUrl, screenshotUrl, recordingId] = process.argv.slice(2);
const heartbeatMs = Number(process.env.MJPEG_RELAY_HEARTBEAT_MS) || 500;
const firstFrameMs = Number(process.env.MJPEG_RELAY_FIRST_FRAME_MS) || 1000;
const reconnectMs = 1000;

// the format of util/logger.sh, on stderr: stdout is the video
const log = (level, message) => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const time = `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  process.stderr.write(`[${time}] [${level}] [MjpegRelay]${recordingId ? ` [${recordingId}]` : ''} ${message}\n`);
};

if (!mjpegUrl) {
  log('ERROR', 'Usage: mjpeg-relay.js <mjpegUrl> [screenshotUrl] [recording id]');
  process.exit(2);
}

let lastFrame = null;
let lastWriteAt = 0;
let writable = true;
// a new frame came while ffmpeg was behind and is not written yet
let pending = false;

const isJpeg = (buf) => buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8;

function write(frame) {
  lastFrame = frame;
  if (!writable) {
    // ffmpeg is behind: only the latest frame is written on 'drain'
    pending = true;
    return;
  }
  pending = false;
  lastWriteAt = Date.now();
  // a frame is larger than the buffer of stdout, so write() is usually false: the same frame is not written again on
  // 'drain', the heartbeat repeats it
  writable = process.stdout.write(frame);
}

process.stdout.on('drain', () => {
  writable = true;
  if (pending) {
    write(lastFrame);
  }
});

// ffmpeg is gone: nothing to relay anymore
process.stdout.on('error', () => process.exit(0));

setInterval(() => {
  if (lastFrame && writable && Date.now() - lastWriteAt >= heartbeatMs) {
    write(lastFrame);
  }
}, 100);

// a part of the stream: "--<boundary>\r\nContent-Type: image/jpeg\r\nContent-Length: <n>\r\n\r\n<jpeg>\r\n"
const LENGTH_HEADER = /content-length:\s*(\d+)\r\n\r\n/i;
const HEADER_WINDOW = 1024;

function connect() {
  let buf = Buffer.alloc(0);
  let reconnecting = false;
  const req = http.get(mjpegUrl, (res) => {
    log('INFO', `Connected to ${mjpegUrl}: ${res.statusCode}`);
    res.on('data', (chunk) => {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      for (;;) {
        const match = LENGTH_HEADER.exec(buf.toString('latin1', 0, Math.min(buf.length, HEADER_WINDOW)));
        if (!match) {
          if (buf.length > HEADER_WINDOW) {
            // not a part header: keep the tail only to find the next one
            buf = buf.subarray(buf.length - 64);
          }
          break;
        }
        const start = match.index + match[0].length;
        const end = start + Number(match[1]);
        if (buf.length < end) {
          break;
        }
        const frame = Buffer.from(buf.subarray(start, end));
        buf = buf.subarray(end);
        if (isJpeg(frame)) {
          write(frame);
        }
      }
    });
    res.on('end', reconnect);
    res.on('error', reconnect);
  });
  req.on('error', reconnect);

  function reconnect(err) {
    if (reconnecting) {
      return;
    }
    reconnecting = true;
    req.destroy();
    log('WARN', `The stream ended${err && err.message ? ` (${err.message})` : ''}, reconnecting in ${reconnectMs} ms`);
    setTimeout(connect, reconnectMs);
  }
}

function fetchJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (e) {
          reject(new Error(`not a JSON answer: ${e.message}`));
        }
      });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

// toJpeg <image>: WDA screenshots are PNG, ffmpeg of the image converts them
function toJpeg(image) {
  if (isJpeg(image)) {
    return Promise.resolve(image);
  }
  return new Promise((resolve, reject) => {
    const ffmpeg = execFile('ffmpeg', ['-loglevel', 'error', '-i', 'pipe:0', '-frames:v', '1', '-q:v', '5', '-f', 'mjpeg', 'pipe:1'],
      { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: 10000 }, (err, stdout, stderr) => {
        if (err || !isJpeg(stdout)) {
          reject(new Error(`the screenshot is not an image: ${String(stderr).trim() || (err && err.message)}`));
        } else {
          resolve(stdout);
        }
      });
    ffmpeg.stdin.on('error', () => {});
    ffmpeg.stdin.end(image);
  });
}

async function firstFrameFromScreenshot() {
  if (!screenshotUrl || lastFrame) {
    return;
  }
  try {
    const body = await fetchJson(screenshotUrl, 10000);
    const image = await toJpeg(Buffer.from(typeof body?.value === 'string' ? body.value : '', 'base64'));
    if (!lastFrame) {
      log('INFO', `No frame of the stream in ${firstFrameMs} ms, the first frame is the screenshot of ${screenshotUrl}`);
      write(image);
    }
  } catch (e) {
    log('WARN', `The screenshot of ${screenshotUrl} is not the first frame: ${e.message}`);
  }
}

connect();
setTimeout(firstFrameFromScreenshot, firstFrameMs);
