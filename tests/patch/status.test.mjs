// The device status commands of the patch: GET /status-wda and GET /status-adb (also used by the mcloud agent)
import {test, describe, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {BASE_DRIVER_DIR, baseDriver, listen, request, startDriverServer, tmpDir, withEnv} from './common.mjs';

const {BaseDriver} = baseDriver;

// a fake adb on PATH printing FAKE_ADB_DEVICES as `adb devices` does
const adbDir = tmpDir('adb');
fs.writeFileSync(
  path.join(adbDir, 'adb'),
  '#!/bin/bash\necho "List of devices attached"\nfor d in ${FAKE_ADB_DEVICES}; do printf "%s\\tdevice\\n" "$d"; done\n',
  {mode: 0o755}
);
const adbEnv = (devices, extra = {}) => ({PATH: `${adbDir}:${process.env.PATH}`, FAKE_ADB_DEVICES: devices, ...extra});

// runs `new BaseDriver().<command>(exitCode)` in a child node, returns its exit status
function exitStatusOf(command, exitCode, env) {
  const code = `
    const {BaseDriver} = require(${JSON.stringify(BASE_DRIVER_DIR)});
    new BaseDriver({}).${command}(${exitCode}).then(() => process.exit(100), () => process.exit(101));`;
  return spawnSync(process.execPath, ['-e', code], {env: {...process.env, ...env}, stdio: 'ignore', timeout: 30000}).status;
}

// requests GET <path> with {"exitCode": <code>} from the base-driver server in a child node, returns its exit status
function httpExitStatusOf(path, exitCode, env) {
  const code = `
    const http = require('http');
    const b = require(${JSON.stringify(BASE_DRIVER_DIR)});
    b.server({routeConfiguringFunction: b.routeConfiguringFunction(new b.BaseDriver({})), port: 0, hostname: '127.0.0.1'})
      .then((server) => {
        const body = JSON.stringify({exitCode: ${exitCode}});
        const req = http.request({host: '127.0.0.1', port: server.address().port, path: ${JSON.stringify(path)}, method: 'GET',
          headers: {'content-type': 'application/json', 'content-length': Buffer.byteLength(body)}},
          (res) => process.exit(100));
        req.on('error', () => process.exit(101));
        req.end(body);
      });`;
  return spawnSync(process.execPath, ['-e', code], {env: {...process.env, ...env}, stdio: 'ignore', timeout: 60000}).status;
}

describe('WDA status', () => {
  let wda;
  before(async () => {
    wda = await listen((req, res) => {
      res.writeHead(200, {'content-type': 'application/json'});
      res.end(JSON.stringify({value: {state: 'success', os: {name: 'iOS', version: '17.4'}}}));
    });
  });
  after(() => wda.close());

  const wdaEnv = () => ({WDA_HOST: '127.0.0.1', WDA_PORT: new URL(wda.url).port});

  test('getStatusWDA returns the WDA status', async () => {
    await withEnv(wdaEnv(), async () => {
      const status = await new BaseDriver({}).getStatusWDA();
      assert.equal(status.status, 'success');
      assert.equal(status.details.value.os.version, '17.4');
    });
  });

  test('getStatusWDA fails when WDA is down', async () => {
    await withEnv({WDA_HOST: '127.0.0.1', WDA_PORT: '9'}, async () => {
      await assert.rejects(new BaseDriver({}).getStatusWDA(), /WDA status/);
    });
  });

  test('getStatusWDA waits for a WDA that answers in more than 500 ms', async () => {
    const slow = await listen((req, res) => {
      setTimeout(() => {
        res.writeHead(200, {'content-type': 'application/json'});
        res.end(JSON.stringify({value: {state: 'success'}}));
      }, 1500);
    });
    try {
      await withEnv({WDA_HOST: '127.0.0.1', WDA_PORT: new URL(slow.url).port}, async () => {
        assert.equal((await new BaseDriver({}).getStatusWDA()).status, 'success');
      });
    } finally {
      slow.close();
    }
  });

  test('getStatusWDA asks a WDA that failed once again', async () => {
    let requests = 0;
    const flaky = await listen((req, res) => {
      if (++requests === 1) {
        res.destroy();
        return;
      }
      res.writeHead(200, {'content-type': 'application/json'});
      res.end(JSON.stringify({value: {state: 'success'}}));
    });
    try {
      await withEnv({WDA_HOST: '127.0.0.1', WDA_PORT: new URL(flaky.url).port}, async () => {
        assert.equal((await new BaseDriver({}).getStatusWDA()).status, 'success');
      });
      assert.equal(requests, 2);
    } finally {
      flaky.close();
    }
  });

  test('getStatusWDA(exitCode) exits Appium with the code when WDA is down', () => {
    assert.equal(exitStatusOf('getStatusWDA', 7, {WDA_HOST: '127.0.0.1', WDA_PORT: '9'}), 7);
  });

  test('GET /status-wda without a request body responds with the status', async () => {
    await withEnv(wdaEnv(), async () => {
      const server = await startDriverServer(new BaseDriver({}));
      try {
        const res = await request(`${server.url}/status-wda`);
        assert.equal(res.json?.value?.message, undefined, 'no error');
        assert.equal(res.status, 200);
        assert.equal(res.json.value.status, 'success');
      } finally {
        await server.close();
      }
    });
  });

  test('GET /status-wda with {"exitCode": 101} (as mcloud-grid sends) responds with the status', async () => {
    await withEnv(wdaEnv(), async () => {
      const server = await startDriverServer(new BaseDriver({}));
      try {
        const res = await request(`${server.url}/status-wda`, {body: {exitCode: 101}});
        assert.equal(res.status, 200);
        assert.equal(res.json.value.status, 'success');
      } finally {
        await server.close();
      }
    });
  });

  test('GET /status-wda with an exitCode exits Appium with the code when WDA is down', () => {
    assert.equal(httpExitStatusOf('/status-wda', 7, {WDA_HOST: '127.0.0.1', WDA_PORT: '9'}), 7);
  });
});

describe('ADB status', () => {
  test('getStatusADB succeeds when adb lists DEVICE_UDID', async () => {
    await withEnv(adbEnv('emulator-5554 udid-1', {DEVICE_UDID: 'udid-1'}), async () => {
      const status = await new BaseDriver({}).getStatusADB();
      assert.equal(status.status, 'success');
    });
  });

  test('getStatusADB fails when adb does not list DEVICE_UDID', async () => {
    await withEnv(adbEnv('emulator-5554', {DEVICE_UDID: 'udid-1'}), async () => {
      await assert.rejects(new BaseDriver({}).getStatusADB(), /NOT ready/);
    });
  });

  test('getStatusADB falls back to ANDROID_DEVICES without DEVICE_UDID', async () => {
    await withEnv(adbEnv('emulator-1', {DEVICE_UDID: undefined, ANDROID_DEVICES: 'emulator-1'}), async () => {
      const status = await new BaseDriver({}).getStatusADB();
      assert.equal(status.status, 'success');
    });
  });

  test('getStatusADB fails without DEVICE_UDID and ANDROID_DEVICES', async () => {
    await withEnv(adbEnv('udid-1', {DEVICE_UDID: undefined, ANDROID_DEVICES: undefined}), async () => {
      await assert.rejects(new BaseDriver({}).getStatusADB(), /Neither DEVICE_UDID nor ANDROID_DEVICES/);
    });
  });

  test('getStatusADB(exitCode) exits Appium with the code when the device is missing', () => {
    assert.equal(exitStatusOf('getStatusADB', 5, adbEnv('emulator-5554', {DEVICE_UDID: 'udid-1'})), 5);
  });

  test('GET /status-adb with {"exitCode": 101} (as mcloud-grid sends) responds with the status', async () => {
    await withEnv(adbEnv('udid-1', {DEVICE_UDID: 'udid-1'}), async () => {
      const server = await startDriverServer(new BaseDriver({}));
      try {
        const res = await request(`${server.url}/status-adb`, {body: {exitCode: 101}});
        assert.equal(res.status, 200);
        assert.equal(res.json.value.status, 'success');
      } finally {
        await server.close();
      }
    });
  });

  test('GET /status-adb with an exitCode exits Appium with the code when the device is missing', () => {
    assert.equal(httpExitStatusOf('/status-adb', 5, adbEnv('emulator-5554', {DEVICE_UDID: 'udid-1'})), 5);
  });

  test('GET /status-adb without a request body responds with the status', async () => {
    await withEnv(adbEnv('udid-1', {DEVICE_UDID: 'udid-1'}), async () => {
      const server = await startDriverServer(new BaseDriver({}));
      try {
        const res = await request(`${server.url}/status-adb`);
        assert.equal(res.json?.value?.message, undefined, 'no error');
        assert.equal(res.status, 200);
        assert.equal(res.json.value.status, 'success');
      } finally {
        await server.close();
      }
    });
  });
});
