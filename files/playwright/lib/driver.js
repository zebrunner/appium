'use strict';

// The 'Playwright' automation of the Android devices of MCloud: an Appium session that reserves the device through
// mcloud-grid (the queue, STF, the recording of the video as any session) and serves the Playwright server of the
// device on the WebSocket /mcloud/playwright/<session id> of Appium, which mcloud-grid passes on to the clients.

const path = require('node:path');
const {PlaywrightBridge} = require('./bridge');
const {PlaywrightVersions} = require('./versions');

/**
 * The driver is linked into APPIUM_HOME (appium driver install --source=local): the modules of Appium (the patched
 * base driver of the image) are resolved from there, not from the dir of the driver.
 */
function appiumRequire(id) {
  const paths = [process.env.APPIUM_HOME, __dirname].filter(Boolean);
  return require(require.resolve(id, {paths}));
}

const {BaseDriver, errors} = appiumRequire('appium/driver');

const NODE_PATH = '/mcloud/playwright/';

/**
 * @returns {{host: string, port: number}} the adb server of the device: ADB_SERVER_SOCKET (tcp:connector:5037)
 */
function adbServer(env = process.env) {
  const match = /^tcp:([^:]+):(\d+)$/.exec(env.ADB_SERVER_SOCKET ?? '');
  return match ? {host: match[1], port: Number(match[2])} : {host: '127.0.0.1', port: 5037};
}

const desiredCapConstraints = {
  platformName: {
    presence: true,
    isString: true,
    inclusionCaseInsensitive: ['Android'],
  },
  udid: {
    isString: true,
  },
};

class PlaywrightDriver extends BaseDriver {
  constructor(opts = {}, shouldValidateCaps = true) {
    super(opts, shouldValidateCaps);
    this.desiredCapConstraints = desiredCapConstraints;
    this.locatorStrategies = [];
    /** @type {PlaywrightBridge|null} */
    this.bridge = null;
    this.playwrightPath = null;
  }

  async createSession(w3cCapabilities1, w3cCapabilities2, w3cCapabilities, driverData) {
    const [sessionId, caps] = await super.createSession(w3cCapabilities1, w3cCapabilities2, w3cCapabilities, driverData);
    try {
      const serial = caps.udid || process.env.DEVICE_UDID;
      if (!serial) {
        throw new errors.SessionNotCreatedError('The device has no udid: appium:udid or DEVICE_UDID is required');
      }
      if (!this.server?.addWebSocketHandler) {
        throw new errors.SessionNotCreatedError('Appium serves no WebSockets to the drivers');
      }
      const adb = adbServer();
      const cacheDir = process.env.PLAYWRIGHT_CACHE_DIR ||
        (process.env.APPIUM_APPS_DIR ? path.join(process.env.APPIUM_APPS_DIR, 'playwright') : undefined);
      this.bridge = new PlaywrightBridge({
        serial,
        adbHost: adb.host,
        adbPort: adb.port,
        versions: new PlaywrightVersions({cacheDir, log: this.log}),
        log: this.log,
        // the client sends no WebDriver commands while it uses Playwright
        onChange: () => this.startNewCommandTimeout().catch(() => {}),
      });
      this.playwrightPath = `${NODE_PATH}${sessionId}`;
      await this.server.addWebSocketHandler(this.playwrightPath, this.bridge.wsServer);
      this.log.info(`[MCLOUD] The Playwright server of the device ${serial} is served on ${this.playwrightPath} ` +
        `(the adb server ${adb.host}:${adb.port})`);
    } catch (err) {
      await this.cleanUp();
      await super.deleteSession(sessionId).catch(() => {});
      throw err;
    }
    return [sessionId, {...caps, 'mcloud:playwrightPath': this.playwrightPath}];
  }

  async deleteSession(sessionId) {
    await this.cleanUp();
    await super.deleteSession(sessionId);
  }

  async cleanUp() {
    if (this.playwrightPath && this.server?.removeWebSocketHandler) {
      await this.server.removeWebSocketHandler(this.playwrightPath).catch(() => {});
    }
    if (this.bridge) {
      await this.bridge.close();
    }
    this.bridge = null;
    this.playwrightPath = null;
  }

  async startNewCommandTimeout() {
    if (this.bridge?.connected) {
      await this.clearNewCommandTimeout();
      return;
    }
    await super.startNewCommandTimeout();
  }
}

module.exports = {PlaywrightDriver, adbServer, NODE_PATH};
