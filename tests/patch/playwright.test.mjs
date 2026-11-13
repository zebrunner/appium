// The Playwright driver of the image (files/playwright, README.md#playwright), run with `node --test` inside the image
// (tests/patch_test.sh): the versions of Playwright, the WebSocket bridge to the Playwright server of the device and the
// Appium session of the driver; the Playwright server is a fake one, there is no device
import {test, describe} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {tmpDir, withEnv} from './common.mjs';

const require = createRequire(import.meta.url);
const DRIVER_DIR = process.env.PLAYWRIGHT_DRIVER_DIR ?? path.join(process.env.PLAYWRIGHT_DIR ?? '/opt/playwright', 'driver');
const {WebSocket, WebSocketServer} = require(require.resolve('ws', {paths: [DRIVER_DIR]}));
const {PlaywrightVersions, clientVersion} = require(path.join(DRIVER_DIR, 'lib/versions.js'));
const {PlaywrightBridge, sendableCode, closeReason} = require(path.join(DRIVER_DIR, 'lib/bridge.js'));
const {PlaywrightDriver, adbServer} = require(path.join(DRIVER_DIR, 'lib/driver.js'));
const BUNDLED = require(require.resolve('playwright-core/package.json', {paths: [DRIVER_DIR]})).version;
const [MAJOR, MINOR] = BUNDLED.split('.').map(Number);
const OTHER = `${MAJOR}.${MINOR - 1}.3`;

const quiet = {info() {}, warn() {}, debug() {}};
const once = (emitter, event) => new Promise((resolve) => emitter.once(event, (...args) => resolve(args)));

// a fake Playwright server of the device: answers every message with 'echo:' and the message, keeps the headers
async function fakeServer() {
  const wss = new WebSocketServer({port: 0, host: '127.0.0.1'});
  await once(wss, 'listening');
  const server = {headers: [], closed: 0, sockets: []};
  wss.on('connection', (ws, req) => {
    server.headers.push(req.headers);
    server.sockets.push(ws);
    ws.on('message', (data, isBinary) => ws.send(isBinary ? data : `echo:${data}`, {binary: isBinary}));
  });
  server.wsEndpoint = () => `ws://127.0.0.1:${wss.address().port}/guid`;
  server.close = async () => {
    server.closed++;
    wss.clients.forEach((ws) => ws.terminate());
    wss.close();
  };
  return server;
}

// bridge(launch): the bridge of a device behind an http server that passes the WebSocket upgrades to it, as Appium does
async function bridged(launch, opts = {}) {
  const bridge = new PlaywrightBridge({
    serial: 'emulator-5554', adbHost: 'connector', adbPort: 5037, log: quiet,
    versions: new PlaywrightVersions({log: quiet}), launch, ...opts,
  });
  const server = http.createServer();
  server.on('upgrade', (req, socket, head) => {
    bridge.wsServer.handleUpgrade(req, socket, head, (ws) => bridge.wsServer.emit('connection', ws, req));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    bridge,
    url: `ws://127.0.0.1:${server.address().port}/mcloud/playwright/s1`,
    close: async () => {
      await bridge.close();
      server.closeAllConnections();
      server.close();
    },
  };
}

// client(url): a Playwright-like client: its version in User-Agent, the messages it gets in ws.messages
async function client(url) {
  const ws = new WebSocket(url, {
    headers: {'user-agent': `Playwright/${BUNDLED} (x64; linux) node/24`, 'x-playwright-launch-options': '{}', 'cookie': 'secret'},
  });
  ws.messages = [];
  ws.on('message', (data, isBinary) => ws.messages.push(isBinary ? data : data.toString()));
  ws.closed = once(ws, 'close');
  await Promise.race([once(ws, 'open'), ws.closed]);
  return ws;
}

async function waitFor(condition, ms = 5000) {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error('condition not met');
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('playwright versions', () => {
  test('the version of a Playwright client', () => {
    assert.equal(clientVersion('Playwright/1.65.0 (arm64; macOS 15.0) node/24.0'), '1.65.0');
    assert.equal(clientVersion('Playwright/1.66.0-alpha-2026-11-12 (x64; linux) node/22'), '1.66.0-alpha-2026-11-12');
    assert.equal(clientVersion('curl/8.0'), null);
    assert.equal(clientVersion(undefined), null);
  });

  test('the bundled version serves its major.minor and the clients without a version', async () => {
    const versions = new PlaywrightVersions({run: () => assert.fail('nothing is installed')});
    for (const wanted of [null, BUNDLED, `${MAJOR}.${MINOR}.99`]) {
      const {version, playwright} = await versions.load(wanted);
      assert.equal(version, BUNDLED);
      assert.equal(typeof playwright._android.launchServer, 'function');
    }
  });

  test('another version is installed once into the cache, with the APKs of its device driver', async () => {
    const cacheDir = tmpDir('pw-cache');
    const commands = [];
    const run = async (cmd, args) => {
      commands.push([path.basename(cmd), ...args]);
      if (args[0] === 'install' && args[1] === '--prefix') {
        const module = path.join(args[2], 'node_modules', 'playwright-core');
        fs.mkdirSync(module, {recursive: true});
        fs.writeFileSync(path.join(module, 'index.js'), `module.exports = {version: '${OTHER}'};`);
      }
    };
    const versions = new PlaywrightVersions({cacheDir, run, log: quiet});
    const [first, second] = await Promise.all([versions.load(OTHER), versions.load(OTHER)]);
    assert.equal(first.version, OTHER);
    assert.equal(first.playwright.version, OTHER);
    assert.equal(second.playwright, first.playwright);
    assert.equal(commands.length, 2, 'one installation for both clients');
    assert.equal(commands[0][0], 'npm');
    assert.ok(commands[0].includes(`playwright-core@${OTHER}`));
    assert.deepEqual(commands[1].slice(-2), ['install', 'android']);
    assert.ok(fs.existsSync(path.join(cacheDir, OTHER, '.complete')));
    assert.deepEqual(fs.readdirSync(cacheDir), [OTHER], 'no temporary dir is left');

    // a new container of the host finds it in the cache, its APKs are installed into the container once
    const laterCommands = [];
    const later = new PlaywrightVersions({cacheDir, log: quiet, run: async (cmd, args) => {
      laterCommands.push([path.basename(cmd), ...args]);
    }});
    assert.equal((await later.load(OTHER)).playwright.version, OTHER);
    assert.equal((await later.load(OTHER)).playwright.version, OTHER);
    assert.equal(laterCommands.length, 1, 'no npm install, the APKs once');
    assert.deepEqual(laterCommands[0].slice(-3), [path.join(cacheDir, OTHER, 'node_modules', 'playwright-core', 'cli.js'),
      'install', 'android']);
  });

  test('a version in the cache without its APKs in the container: a failed APK install names the version of the farm',
    async () => {
      const cacheDir = tmpDir('pw-cache');
      fs.mkdirSync(path.join(cacheDir, OTHER, 'node_modules', 'playwright-core'), {recursive: true});
      fs.writeFileSync(path.join(cacheDir, OTHER, '.complete'), 'done');
      const versions = new PlaywrightVersions({cacheDir, log: quiet, run: async () => {
        throw new Error('cli.js install failed: ENOTFOUND');
      }});
      await assert.rejects(versions.load(OTHER), (err) => {
        assert.ok(err.message.includes(`Playwright ${OTHER} could not be installed`), err.message);
        return true;
      });
      assert.ok(fs.existsSync(path.join(cacheDir, OTHER, '.complete')), 'the cached version stays');
    });

  test('a failed installation names the version of the farm and leaves nothing', async () => {
    const cacheDir = tmpDir('pw-cache');
    const versions = new PlaywrightVersions({cacheDir, log: quiet, run: async () => {
      throw new Error('npm install failed: ETIMEDOUT');
    }});
    await assert.rejects(versions.load(OTHER), (err) => {
      assert.ok(err.message.includes(`Playwright ${OTHER} could not be installed`), err.message);
      assert.ok(err.message.includes('ETIMEDOUT'), err.message);
      assert.ok(err.message.includes(`use Playwright ${MAJOR}.${MINOR}`), err.message);
      return true;
    });
    assert.deepEqual(fs.readdirSync(cacheDir), []);
  });

  test('without a cache only the bundled version is served, a version is a version', async () => {
    await assert.rejects(new PlaywrightVersions({log: quiet}).load(OTHER), /is not available on the device host/);
    await assert.rejects(new PlaywrightVersions({cacheDir: tmpDir('pw-cache'), log: quiet}).load('1.2.3; rm -rf /'),
      /is not a Playwright version/);
  });
});

describe('playwright bridge', () => {
  test('the close frames of the bridge are valid ones', () => {
    assert.equal(sendableCode(1005), 1000);
    assert.equal(sendableCode(1006), 1011);
    assert.equal(sendableCode(4001), 4001);
    assert.ok(Buffer.byteLength(closeReason('x'.repeat(500))) <= 123);
  });

  test('a client gets the Playwright server of the device, one client at a time', async () => {
    const fake = await fakeServer();
    const launches = [];
    let changes = 0;
    const served = await bridged(async (playwright, opts) => {
      launches.push(opts);
      return fake;
    }, {onChange: () => changes++});
    try {
      const ws = await client(served.url);
      assert.equal(served.bridge.connected, true);
      ws.send('{"id":1}');
      ws.send(Buffer.alloc(3 * 1024 * 1024, 7), {binary: true});
      await waitFor(() => ws.messages.length === 2);
      assert.equal(ws.messages[0], 'echo:{"id":1}');
      assert.equal(ws.messages[1].length, 3 * 1024 * 1024);
      assert.deepEqual(launches, [{adbHost: 'connector', adbPort: 5037, deviceSerialNumber: 'emulator-5554', host: '127.0.0.1', port: 0}]);
      assert.match(fake.headers[0]['user-agent'], /^Playwright\//);
      assert.equal(fake.headers[0]['x-playwright-launch-options'], '{}');
      assert.equal(fake.headers[0].cookie, undefined, 'only the headers of Playwright go to its server');

      // a second client would take the device of the first one
      const second = await client(served.url);
      assert.equal((await second.closed)[0], 1013);

      ws.close();
      await ws.closed;
      await waitFor(() => fake.closed === 1 && !served.bridge.connected && changes === 2);
    } finally {
      await served.close();
    }
  });

  test('the end of the Playwright server closes the client with its status', async () => {
    const fake = await fakeServer();
    const served = await bridged(async () => fake);
    try {
      const ws = await client(served.url);
      ws.send('ping');
      await waitFor(() => ws.messages.length === 1);
      fake.sockets[0].close(4000, 'device closed');
      const [code, reason] = await ws.closed;
      assert.equal(code, 4000);
      assert.equal(reason.toString(), 'device closed');
    } finally {
      await served.close();
    }
  });

  test('a server that does not start closes the client with the reason', async () => {
    const served = await bridged(async () => {
      throw new Error("No device with serial number 'emulator-5554' was found");
    });
    try {
      const ws = await client(served.url);
      const [code, reason] = await ws.closed;
      assert.equal(code, 1011);
      assert.match(reason.toString(), /No device with serial number/);
      await waitFor(() => !served.bridge.connected);
    } finally {
      await served.close();
    }
  });

  test('the end of the session closes its clients and their servers', async () => {
    const fake = await fakeServer();
    const served = await bridged(async () => fake);
    try {
      const ws = await client(served.url);
      ws.send('ping');
      await waitFor(() => ws.messages.length === 1);
      await served.bridge.close();
      assert.equal((await ws.closed)[0], 1001);
      await waitFor(() => fake.closed === 1);
    } finally {
      await served.close();
    }
  });
});

describe('playwright driver', () => {
  const CAPS = (caps = {}) => ({
    alwaysMatch: {'platformName': 'Android', 'appium:automationName': 'Playwright', 'appium:udid': 'emulator-5554', ...caps},
    firstMatch: [{}],
  });
  const appiumServer = (handlers) => ({
    addWebSocketHandler: async (pathname, wss) => handlers.set(pathname, wss),
    removeWebSocketHandler: async (pathname) => handlers.delete(pathname),
  });
  // newDriver(answers): a driver of a fake device, its adb shell commands in driver.shell; answers: the output of a
  // command by its start, an Error rejects it
  const newDriver = (answers = {}) => {
    const driver = new PlaywrightDriver({});
    const warnings = [];
    const log = Object.create(driver.log, {warn: {value: (message) => warnings.push(message)}, warnings: {value: warnings}});
    Object.defineProperty(driver, 'log', {value: log});
    driver.unlockWaitMs = 0;
    driver.shell = [];
    driver.adbShell = async (serial, command) => {
      driver.shell.push(`${serial}: ${command}`);
      const answer = Object.entries(answers).find(([start]) => command.startsWith(start))?.[1];
      if (answer instanceof Error) {
        throw answer;
      }
      return answer ?? (command.startsWith('settings get') ? '0' : '');
    };
    return driver;
  };

  test('the adb server of the device: ADB_SERVER_SOCKET of the image', () => {
    assert.deepEqual(adbServer({ADB_SERVER_SOCKET: 'tcp:connector:5037'}), {host: 'connector', port: 5037});
    assert.deepEqual(adbServer({}), {host: '127.0.0.1', port: 5037});
  });

  test('a session serves the WebSocket of its device and is recorded as any other one', async () => {
    const logDir = tmpDir('log');
    await withEnv({LOG_DIR: logDir, ROUTER_UUID: undefined}, async () => {
      const handlers = new Map();
      const driver = newDriver();
      driver.server = appiumServer(handlers);
      const [sessionId, caps] = await driver.createSession(null, null, CAPS());
      assert.equal(caps['mcloud:playwrightPath'], `/mcloud/playwright/${sessionId}`);
      assert.deepEqual([...handlers.keys()], [`/mcloud/playwright/${sessionId}`]);
      assert.equal(driver.bridge.serial, 'emulator-5554');
      assert.ok(fs.existsSync(path.join(logDir, `.recording-artifact-${sessionId}`)));

      await driver.deleteSession(sessionId);
      assert.equal(handlers.size, 0);
      assert.equal(driver.bridge, null);
      assert.ok(!fs.existsSync(path.join(logDir, `.recording-artifact-${sessionId}`)));
    });
  });

  test('no command timeout while a client uses the device', async () => {
    const driver = newDriver();
    driver.server = appiumServer(new Map());
    const [sessionId] = await driver.createSession(null, null, CAPS({'appium:newCommandTimeout': 60}));
    try {
      await driver.startNewCommandTimeout();
      assert.ok(driver.noCommandTimer, 'no client: the command timeout runs');
      driver.bridge.clients.add({});
      await driver.startNewCommandTimeout();
      assert.equal(driver.noCommandTimer, null, 'a client uses the device: no command timeout');
      driver.bridge.clients.clear();
    } finally {
      await driver.deleteSession(sessionId);
      await driver.clearNewCommandTimeout();
    }
  });

  test('only the Android devices', async () => {
    const driver = newDriver();
    driver.server = appiumServer(new Map());
    await assert.rejects(driver.createSession(null, null, CAPS({platformName: 'iOS'})), /platformName/);
  });

  test('the session wakes and unlocks the device, keeps its screen on and gives the setting back', async () => {
    const driver = newDriver({'settings get global stay_on_while_plugged_in': '2'});
    driver.server = appiumServer(new Map());
    const [sessionId] = await driver.createSession(null, null, CAPS());
    assert.deepEqual(driver.shell.slice(0, 2), [
      'emulator-5554: settings get global stay_on_while_plugged_in',
      'emulator-5554: svc power stayon true; input keyevent KEYCODE_WAKEUP; wm dismiss-keyguard',
    ]);
    assert.equal(driver.shell.length, 3);
    assert.match(driver.shell[2], /^emulator-5554: dumpsys window/);
    assert.deepEqual(driver.log.warnings, []);
    driver.shell.length = 0;
    await driver.deleteSession(sessionId);
    assert.deepEqual(driver.shell, ['emulator-5554: settings put global stay_on_while_plugged_in 2']);
    assert.equal(driver.screen, null);
  });

  test('a secure lock screen is named in the log, the session goes on', async () => {
    const driver = newDriver({'dumpsys window': '1'});
    driver.server = appiumServer(new Map());
    const [sessionId] = await driver.createSession(null, null, CAPS());
    assert.equal(driver.log.warnings.length, 1);
    assert.match(driver.log.warnings[0], /lock screen of the device emulator-5554 is still shown/);
    await driver.deleteSession(sessionId);
  });

  test('a device adb does not reach is not woken up, the session goes on', async () => {
    const driver = newDriver({'settings get': new Error('device offline')});
    driver.server = appiumServer(new Map());
    const [sessionId, caps] = await driver.createSession(null, null, CAPS());
    assert.ok(caps['mcloud:playwrightPath']);
    assert.match(driver.log.warnings[0], /not woken up: device offline/);
    assert.equal(driver.screen, null);
    await driver.deleteSession(sessionId);
    assert.equal(driver.shell.length, 1, 'nothing to give back');
  });

  test('appium:skipUnlock leaves the screen of the device as it is', async () => {
    const driver = newDriver();
    driver.server = appiumServer(new Map());
    const [sessionId] = await driver.createSession(null, null, CAPS({'appium:skipUnlock': true}));
    await driver.deleteSession(sessionId);
    assert.deepEqual(driver.shell, []);
  });
});
