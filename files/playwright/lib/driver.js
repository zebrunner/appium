'use strict';

// The 'Playwright' automation of the Android devices of MCloud: an Appium session that reserves the device through
// mcloud-grid (the queue, STF, the recording of the video as any session) and serves the Playwright server of the
// device on the WebSocket /mcloud/playwright/<session id> of Appium, which mcloud-grid passes on to the clients.

const path = require('node:path');
const {execFile} = require('node:child_process');
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

const ADB_SHELL_TIMEOUT_MS = 15000;

/**
 * adbShell(serial, command): the output of `adb shell` on the device, through the adb server of ADB_SERVER_SOCKET
 */
function adbShell(serial, command) {
  return new Promise((resolve, reject) => {
    execFile('adb', ['-s', serial, 'shell', command], {timeout: ADB_SHELL_TIMEOUT_MS}, (err, stdout) => {
      if (err) {
        reject(err);
      } else {
        resolve(String(stdout).trim());
      }
    });
  });
}

// the lock screen is shown: AOSP (isKeyguardShowing) and Samsung (mDreamingLockscreen) of `dumpsys window`
const KEYGUARD_SHOWN = 'dumpsys window | grep -cE "isKeyguardShowing=true|mDreamingLockscreen=true"; true';

const desiredCapConstraints = {
  platformName: {
    presence: true,
    isString: true,
    inclusionCaseInsensitive: ['Android'],
  },
  udid: {
    isString: true,
  },
  skipUnlock: {
    isBoolean: true,
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
    this.adbShell = adbShell;
    /** @type {{serial: string, stayOn: string}|null} the setting of the device to give back at the end */
    this.screen = null;
  }

  /**
   * Chrome draws no frames for a screen that is off or locked (the clicks and the screenshots wait for them), so the
   * session wakes the device, dismisses its lock screen (a secure one, PIN or pattern, stays) and keeps the screen on
   * while plugged in (stay_on_while_plugged_in) till its end, as the UiAutomator2 sessions unlock the device
   */
  async wakeDevice(serial) {
    try {
      const stayOn = await this.adbShell(serial, 'settings get global stay_on_while_plugged_in');
      this.screen = {serial, stayOn: /^\d+$/.test(stayOn) ? stayOn : '0'};
      await this.adbShell(serial, 'svc power stayon true; input keyevent KEYCODE_WAKEUP; wm dismiss-keyguard');
      await new Promise((resolve) => setTimeout(resolve, this.unlockWaitMs ?? 1000));
      if (Number(await this.adbShell(serial, KEYGUARD_SHOWN)) > 0) {
        this.log.warn(`[MCLOUD] The lock screen of the device ${serial} is still shown: remove its secure lock ` +
          '(PIN, pattern, password), Chrome draws nothing under it');
      }
    } catch (err) {
      this.log.warn(`[MCLOUD] The device ${serial} is not woken up: ${err.message}`);
    }
  }

  async restoreScreen() {
    const screen = this.screen;
    this.screen = null;
    if (!screen) {
      return;
    }
    await this.adbShell(screen.serial, `settings put global stay_on_while_plugged_in ${screen.stayOn}`).catch((err) => {
      this.log.warn(`[MCLOUD] stay_on_while_plugged_in of the device ${screen.serial} is not restored: ${err.message}`);
    });
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
      if (!caps.skipUnlock) {
        await this.wakeDevice(serial);
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
    await this.restoreScreen();
  }

  async startNewCommandTimeout() {
    if (this.bridge?.connected) {
      await this.clearNewCommandTimeout();
      return;
    }
    await super.startNewCommandTimeout();
  }
}

module.exports = {PlaywrightDriver, adbServer, adbShell, NODE_PATH};
