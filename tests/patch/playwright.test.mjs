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
const {PlaywrightVersions, clientVersion, installEnv} = require(path.join(DRIVER_DIR, 'lib/versions.js'));
const {PlaywrightBridge, sendableCode, closeReason, shellUse} = require(path.join(DRIVER_DIR, 'lib/bridge.js'));
const {PlaywrightDriver, adbServer, playwrightCacheDir} = require(path.join(DRIVER_DIR, 'lib/driver.js'));
const semver = require(require.resolve('semver', {paths: [DRIVER_DIR]}));
const BUNDLED = require(require.resolve('playwright-core/package.json', {paths: [DRIVER_DIR]})).version;
const [MAJOR, MINOR] = BUNDLED.split('.').map(Number);
const OTHER = `${MAJOR}.${MINOR - 1}.3`;
// the versions the tests allow (PLAYWRIGHT_VERSIONS)
const ALLOWED = '>=1.0.0';

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
        fs.writeFileSync(path.join(module, 'package.json'), JSON.stringify({name: 'playwright-core', version: OTHER}));
      }
    };
    const versions = new PlaywrightVersions({cacheDir, allowed: ALLOWED, run, log: quiet, apks: new Set()});
    const [first, second] = await Promise.all([versions.load(OTHER), versions.load(OTHER)]);
    assert.equal(first.version, OTHER);
    assert.equal(first.playwright.version, OTHER);
    assert.equal(second.playwright, first.playwright);
    assert.equal(commands.length, 2, 'one installation for both clients');
    assert.equal(commands[0][0], 'npm');
    assert.ok(commands[0].includes(`playwright-core@${OTHER}`));
    assert.ok(commands[0].includes('--ignore-scripts'), 'no install scripts');
    assert.deepEqual(commands[1].slice(-2), ['install', 'android']);
    assert.ok(fs.existsSync(path.join(cacheDir, OTHER, '.complete')));
    assert.deepEqual(fs.readdirSync(cacheDir), [OTHER], 'no temporary dir is left');

    // the next session of the container: the version and its APKs are there
    const next = new PlaywrightVersions({cacheDir, allowed: ALLOWED, run: () => assert.fail('installed already'), log: quiet,
      apks: versions.apks});
    assert.equal((await next.load(OTHER)).playwright.version, OTHER);
  });

  test('a container that finds a version in the cache installs its APKs once', async () => {
    const cacheDir = tmpDir('pw-cache');
    const module = path.join(cacheDir, OTHER, 'node_modules', 'playwright-core');
    fs.mkdirSync(module, {recursive: true});
    fs.writeFileSync(path.join(module, 'index.js'), `module.exports = {version: '${OTHER}'};`);
    fs.writeFileSync(path.join(cacheDir, OTHER, '.complete'), 'another device of the host');
    const commands = [];
    const apks = new Set();
    const run = async (cmd, args) => commands.push(args);
    const versions = new PlaywrightVersions({cacheDir, allowed: ALLOWED, run, log: quiet, apks});
    assert.equal((await versions.load(OTHER)).playwright.version, OTHER);
    assert.deepEqual(commands, [[path.join(module, 'cli.js'), 'install', 'android']], 'only the APKs, no npm');
    // the next session of the container
    await new PlaywrightVersions({cacheDir, allowed: ALLOWED, run, log: quiet, apks}).load(OTHER);
    assert.equal(commands.length, 1);

    // a failure of the APKs names the version of the farm, the next session tries again
    const failing = new PlaywrightVersions({cacheDir, allowed: ALLOWED, log: quiet, apks: new Set(), run: async () => {
      throw new Error('download failed: ECONNRESET');
    }});
    await assert.rejects(failing.load(OTHER), (err) => {
      assert.ok(err.message.includes(`Playwright ${OTHER} could not be installed`), err.message);
      assert.ok(err.message.includes('ECONNRESET'), err.message);
      assert.ok(err.message.includes(`use Playwright ${MAJOR}.${MINOR}`), err.message);
      return true;
    });
    assert.equal(failing.apks.size, 0);
    assert.ok(fs.existsSync(path.join(cacheDir, OTHER, '.complete')), 'the cache is kept');
  });

  test('a failed installation names the version of the farm and leaves nothing', async () => {
    const cacheDir = tmpDir('pw-cache');
    const versions = new PlaywrightVersions({cacheDir, allowed: ALLOWED, log: quiet, run: async () => {
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
    await assert.rejects(new PlaywrightVersions({cacheDir: tmpDir('pw-cache'), allowed: ALLOWED, log: quiet}).load('1.2.3; rm -rf /'),
      /is not a Playwright version/);
  });

  test('only the exact versions of PLAYWRIGHT_VERSIONS are installed', async () => {
    const run = () => assert.fail('nothing is installed');
    const versions = (allowed) => new PlaywrightVersions({cacheDir: tmpDir('pw-cache'), allowed, run, log: quiet});
    const notAllowed = /is not allowed on the device host \(PLAYWRIGHT_VERSIONS/;
    for (const allowed of [undefined, '', '   ', 'not a range']) {
      await assert.rejects(versions(allowed).load(OTHER), notAllowed, `PLAYWRIGHT_VERSIONS='${allowed}'`);
    }
    await assert.rejects(versions(`<${OTHER}`).load(OTHER), notAllowed, 'out of the range');
    // a pre-release only when the range names it
    await assert.rejects(versions(ALLOWED).load(`${MAJOR}.${MINOR + 1}.0-alpha-2026-11-27`), notAllowed);
    await assert.rejects(versions('1.5x').load('1.50.0'), notAllowed, 'not a range: nothing');
    await assert.rejects(versions(ALLOWED).load('1.50'), /is not a Playwright version/);
  });

  test('the PLAYWRIGHT_VERSIONS of the image: the versions up to the bundled one', (t) => {
    const allowed = process.env.PLAYWRIGHT_VERSIONS;
    if (!allowed) {
      t.skip('no PLAYWRIGHT_VERSIONS: not run in the image');
      return;
    }
    assert.ok(semver.satisfies(`${MAJOR}.${MINOR}.0`, allowed), `${allowed} has the bundled ${MAJOR}.${MINOR}`);
    assert.ok(semver.satisfies(OTHER, allowed), `${allowed} has ${OTHER}`);
    assert.ok(!semver.satisfies(`${MAJOR}.${MINOR + 1}.0`, allowed), `${allowed} has no version newer than the bundled one`);
  });

  test('npm and the install of the APKs get no secrets of the container', async () => {
    const env = installEnv({PATH: '/bin', HOME: '/home/androidusr', https_proxy: 'http://proxy:3128', npm_config_registry: 'r',
      PLAYWRIGHT_BROWSERS_PATH: '/opt/playwright/browsers', NODE_REGISTRATION_TOKEN: 'mcn1.node.secret',
      STF_AUTH_TOKEN: 'token', AWS_SECRET_ACCESS_KEY: 'key'});
    assert.deepEqual(Object.keys(env).sort(),
      ['HOME', 'PATH', 'PLAYWRIGHT_BROWSERS_PATH', 'https_proxy', 'npm_config_registry']);
    const envs = [];
    const run = async (cmd, args, runEnv) => {
      envs.push(runEnv);
      if (args[0] === 'install' && args[1] === '--prefix') {
        const module = path.join(args[2], 'node_modules', 'playwright-core');
        fs.mkdirSync(module, {recursive: true});
        fs.writeFileSync(path.join(module, 'index.js'), 'module.exports = {};');
        fs.writeFileSync(path.join(module, 'package.json'), JSON.stringify({name: 'playwright-core', version: OTHER}));
      }
    };
    await withEnv({NODE_REGISTRATION_TOKEN: 'mcn1.node.secret'}, async () => {
      await new PlaywrightVersions({cacheDir: tmpDir('pw-cache'), allowed: ALLOWED, run, log: quiet, apks: new Set()}).load(OTHER);
    });
    assert.equal(envs.length, 2);
    for (const runEnv of envs) {
      assert.equal(runEnv.NODE_REGISTRATION_TOKEN, undefined);
    }
  });

  test('a package that is not the version asked for is not loaded', async () => {
    const cacheDir = tmpDir('pw-cache');
    const run = async (cmd, args) => {
      const module = path.join(args[2], 'node_modules', 'playwright-core');
      fs.mkdirSync(module, {recursive: true});
      fs.writeFileSync(path.join(module, 'package.json'), JSON.stringify({name: 'playwright-core', version: '9.9.9'}));
    };
    await assert.rejects(new PlaywrightVersions({cacheDir, allowed: ALLOWED, run, log: quiet}).load(OTHER),
      /npm installed playwright-core@9\.9\.9/);
    assert.deepEqual(fs.readdirSync(cacheDir), []);
  });

  test('the cache of the versions is not in the storage shared by the containers of the host', () => {
    const warnings = [];
    const log = {warn: (message) => warnings.push(message)};
    assert.equal(playwrightCacheDir(log, {PLAYWRIGHT_CACHE_DIR: '/opt/playwright/cache', APPIUM_APPS_DIR: '/opt/appium-storage'}),
      '/opt/playwright/cache');
    assert.equal(playwrightCacheDir(log, {PLAYWRIGHT_CACHE_DIR: '', APPIUM_APPS_DIR: '/opt/appium-storage'}), undefined);
    assert.deepEqual(warnings, []);
    for (const shared of ['/opt/appium-storage/playwright', '/opt/appium-storage', '/opt/appium-storage/./x/../pw']) {
      assert.equal(playwrightCacheDir(log, {PLAYWRIGHT_CACHE_DIR: shared, APPIUM_APPS_DIR: '/opt/appium-storage/'}), undefined, shared);
    }
    assert.equal(warnings.length, 3);
    assert.match(warnings[0], /is in the shared storage of the apps/);
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

  test('the calls of a client that use the adb shell of the device', () => {
    const call = (method, params = {}) => JSON.stringify({id: 7, guid: 'android-device@1', method, params});
    assert.deepEqual(shellUse(call('shell', {command: 'id'})), {id: 7, use: 'shell()'});
    assert.deepEqual(shellUse(Buffer.from(call('open', {command: 'shell:id'}))), {id: 7, use: 'open()'}, 'a binary message');
    assert.equal(shellUse('{"id":7,"method":"\\u0073hell","params":{}}')?.use, 'shell()', 'an escaped method name');
    assert.match(shellUse(call('launchBrowser', {pkg: 'com.android.chrome; reboot'})).use, /^launchBrowser\(\)/);
    assert.match(shellUse(call('installApk', {file: '', args: ['-r', '1; reboot']})).use, /^installApk\(\)/);
    for (const harmless of [call('launchBrowser', {pkg: 'com.android.chrome'}), call('launchBrowser'),
      call('installApk', {file: '', args: ['-r', '-t', '--user', '0']}), call('tap', {selector: {}}),
      call('push', {file: '', path: '/data/local/tmp/x'}), 'not json', '{"id":1}', '[]', 'null']) {
      assert.equal(shellUse(harmless), null, harmless);
    }
  });

  test('without the adb shell (ADB_SHELL) the client gets an error for shell() and open(), its other calls go on', async () => {
    const fake = await fakeServer();
    const warnings = [];
    const served = await bridged(async () => fake, {log: {...quiet, warn: (message) => warnings.push(message)}});
    try {
      const ws = await client(served.url);
      ws.send(JSON.stringify({id: 1, guid: 'android-device@1', method: 'shell', params: {command: 'id'}}));
      ws.send(Buffer.from(JSON.stringify({id: 2, guid: 'android-device@1', method: 'open', params: {command: 'shell:id'}})),
        {binary: true});
      ws.send(JSON.stringify({id: 3, guid: 'android-device@1', method: 'tap', params: {}}));
      await waitFor(() => ws.messages.length === 3);
      const answers = ws.messages.map((message) => (message.startsWith('echo:') ? message : JSON.parse(message)));
      assert.deepEqual(answers.filter((answer) => typeof answer === 'object').map((answer) => answer.id).sort(), [1, 2]);
      assert.match(answers.find((answer) => answer.id === 1).error.error.message, /adb shell is not enabled/);
      assert.ok(answers.includes(`echo:${JSON.stringify({id: 3, guid: 'android-device@1', method: 'tap', params: {}})}`));
      assert.equal(warnings.length, 2);
    } finally {
      await served.close();
    }
  });

  test('with the adb shell (ADB_SHELL=true) the calls of the client go to the server as they are', async () => {
    const fake = await fakeServer();
    const served = await bridged(async () => fake, {allowShell: true});
    try {
      const ws = await client(served.url);
      const shell = JSON.stringify({id: 1, guid: 'android-device@1', method: 'shell', params: {command: 'id'}});
      ws.send(shell);
      await waitFor(() => ws.messages.length === 1);
      assert.equal(ws.messages[0], `echo:${shell}`);
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

  test('the adb shell of the session is the adb_shell feature of Appium (ADB_SHELL, RELAXED_SECURITY)', async () => {
    for (const [opts, expected] of [[{}, false], [{allowInsecure: ['*:adb_shell']}, true],
      [{allowInsecure: ['playwright:adb_shell']}, true], [{relaxedSecurityEnabled: true}, true],
      [{relaxedSecurityEnabled: true, denyInsecure: ['*:adb_shell']}, false]]) {
      const driver = newDriver();
      Object.assign(driver, opts);
      driver.server = appiumServer(new Map());
      const [sessionId] = await driver.createSession(null, null, CAPS());
      try {
        assert.equal(driver.bridge.allowShell, expected, JSON.stringify(opts));
      } finally {
        await driver.deleteSession(sessionId);
      }
    }
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
