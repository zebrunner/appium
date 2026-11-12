'use strict';

// The WebSocket of a Playwright session on the Appium of the device: every connection of a client gets its own
// Playwright server of the device (_android.launchServer) of the version of the client, the messages are passed on
// as they are. The server and the connection end together.

const {WebSocket, WebSocketServer} = require('ws');
const {clientVersion} = require('./versions');

// the messages of Playwright are big (screenshots, traces), the limit is a safety net
const MAX_PAYLOAD = 1024 * 1024 * 1024;
// the headers of the client the Playwright server checks (its version) or uses (its options)
const FORWARDED_HEADERS = /^(user-agent|x-playwright-.*)$/i;

/** @returns {number} a close code that may be sent in a close frame */
function sendableCode(code) {
  if (code === 1005 || code === undefined) {
    return 1000;
  }
  return code >= 1000 && code <= 4999 && ![1004, 1006, 1015].includes(code) ? code : 1011;
}

/** @returns {string} the reason of a close frame: at most 123 bytes */
function closeReason(reason) {
  const text = String(reason ?? '');
  return Buffer.byteLength(text) <= 123 ? text : `${Buffer.from(text).subarray(0, 120).toString().replace(/\uFFFD+$/, '')}...`;
}

class PlaywrightBridge {
  /**
   * @param {object} opts
   * @param {string} opts.serial the serial of the device on the adb server
   * @param {string} opts.adbHost
   * @param {number} opts.adbPort
   * @param {import('./versions').PlaywrightVersions} opts.versions
   * @param {{info: Function, warn: Function, debug: Function}} opts.log
   * @param {() => void} [opts.onChange] called when a connection opens or closes
   * @param {(playwright: object, opts: object) => Promise<object>} [opts.launch] launches the server (tests)
   */
  constructor({serial, adbHost, adbPort, versions, log, onChange = () => {}, launch}) {
    this.serial = serial;
    this.adbHost = adbHost;
    this.adbPort = adbPort;
    this.versions = versions;
    this.log = log;
    this.onChange = onChange;
    this.launch = launch ?? ((playwright, opts) => playwright._android.launchServer(opts));
    /** @type {Set<WebSocket>} */
    this.clients = new Set();
    this.closed = false;
    this.wsServer = new WebSocketServer({noServer: true, perMessageDeflate: false, maxPayload: MAX_PAYLOAD});
    this.wsServer.on('connection', (client, req) => {
      this.connect(client, req).catch((err) => this.log.warn(`[MCLOUD] Playwright connection failed: ${err.message}`));
    });
  }

  /** @returns {boolean} a client is connected */
  get connected() {
    return this.clients.size > 0;
  }

  async connect(client, req) {
    // the Playwright server of a device serves one client: a second one would take the device of the first one
    if (this.closed || this.connected) {
      client.close(1013, this.closed ? 'The session is closed' : 'The session has a Playwright connection already');
      return;
    }
    this.clients.add(client);
    this.onChange();
    const pending = [];
    let server = null;
    let upstream = null;
    const close = (code, reason) => {
      if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
        client.close(sendableCode(code), closeReason(reason));
      }
      if (upstream && (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING)) {
        upstream.close(sendableCode(code), closeReason(reason));
      }
    };
    client.on('message', (data, isBinary) => {
      if (upstream?.readyState === WebSocket.OPEN) {
        upstream.send(data, {binary: isBinary});
      } else {
        pending.push([data, isBinary]);
      }
    });
    client.on('error', (err) => this.log.warn(`[MCLOUD] Playwright client error: ${err.message}`));
    const clientClosed = new Promise((resolve) => client.once('close', (code, reason) => {
      this.log.info(`[MCLOUD] Playwright client is disconnected: ${code} ${reason}`);
      this.clients.delete(client);
      close(code, reason.toString());
      resolve();
    }));

    try {
      const {version, playwright} = await this.versions.load(clientVersion(req.headers['user-agent']));
      if (client.readyState !== WebSocket.OPEN) {
        return;
      }
      this.log.info(`[MCLOUD] Starting the Playwright ${version} server of the device ${this.serial}`);
      server = await this.launch(playwright, {
        adbHost: this.adbHost,
        adbPort: this.adbPort,
        deviceSerialNumber: this.serial,
        host: '127.0.0.1',
        port: 0,
      });
      if (client.readyState !== WebSocket.OPEN) {
        return;
      }
      const headers = Object.fromEntries(Object.entries(req.headers).filter(([name]) => FORWARDED_HEADERS.test(name)));
      upstream = new WebSocket(server.wsEndpoint(), {headers, perMessageDeflate: false, maxPayload: MAX_PAYLOAD});
      upstream.on('open', () => {
        this.log.info(`[MCLOUD] Playwright client is connected to the device ${this.serial}`);
        for (const [data, isBinary] of pending.splice(0)) {
          upstream.send(data, {binary: isBinary});
        }
      });
      upstream.on('message', (data, isBinary) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(data, {binary: isBinary});
        }
      });
      upstream.on('error', (err) => this.log.warn(`[MCLOUD] Playwright server error: ${err.message}`));
      upstream.on('close', (code, reason) => close(code, reason.toString()));
    } catch (err) {
      this.log.warn(`[MCLOUD] The Playwright server of the device ${this.serial} did not start: ${err.message}`);
      close(1011, err.message);
    } finally {
      await clientClosed;
      if (server) {
        await Promise.resolve(server.close()).catch((err) => this.log.debug(`[MCLOUD] Playwright server close: ${err.message}`));
      }
      this.onChange();
    }
  }

  /** Closes the connections: the session is deleted. */
  async close() {
    this.closed = true;
    const closing = [...this.clients].map((client) => new Promise((resolve) => {
      client.once('close', resolve);
      client.close(1001, 'The Appium session is deleted');
      setTimeout(() => {
        client.terminate();
        resolve();
      }, 5000).unref();
    }));
    await Promise.all(closing);
    this.wsServer.close();
  }
}

module.exports = {PlaywrightBridge, sendableCode, closeReason};
