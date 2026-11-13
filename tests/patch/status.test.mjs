// The device status commands of the patch: GET /status-wda and GET /status-adb (also used by the mcloud agent)
import {test, describe, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {BASE_DRIVER_DIR, baseDriver, listen, request, startDriverServer, tmpDir, withEnv} from './common.mjs';

const {BaseDriver} = baseDriver;

// a fake adb on PATH with the devices of FAKE_ADB_DEVICES: "<udid>[=<state>]" (device by default, noperm: a device
// without the permissions of the user), `adb devices` and `adb -s <udid> get-state` as adb answers them
const adbDir = tmpDir('adb');
fs.writeFileSync(
  path.join(adbDir, 'adb'),
  `#!/bin/bash
if [[ "$1" == devices ]]; then
  echo "List of devices attached"
  for d in \${FAKE_ADB_DEVICES}; do
    state="\${d#*=}"; [[ "$d" == *=* ]] || state=device
    [[ "$state" == noperm ]] && state="no permissions (missing udev rules? user is in the plugdev group); see [http://developer.android.com/tools/device.html]"
    printf "%s\\t%s\\n" "\${d%%=*}" "$state"
  done
elif [[ "$1 $3" == "-s get-state" ]]; then
  for d in \${FAKE_ADB_DEVICES}; do
    state="\${d#*=}"; [[ "$d" == *=* ]] || state=device
    if [[ "\${d%%=*}" == "$2" ]]; then
      [[ "$state" == noperm ]] && { echo "error: insufficient permissions for device" >&2; exit 1; }
      echo "$state"
      exit 0
    fi
  done
  echo "error: device '$2' not found" >&2
  exit 1
fi
`,
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

  test('getStatusADB fails for another device whose udid contains DEVICE_UDID', async () => {
    await withEnv(adbEnv('udid-10 192.168.0.5:5555', {DEVICE_UDID: 'udid-1'}), async () => {
      await assert.rejects(new BaseDriver({}).getStatusADB(), /NOT ready/);
    });
    await withEnv(adbEnv('192.168.0.5:55551', {DEVICE_UDID: '192.168.0.5:5555'}), async () => {
      await assert.rejects(new BaseDriver({}).getStatusADB(), /NOT ready/);
    });
  });

  test('getStatusADB fails for the device without the permissions of adb ("no permissions ... device.html")', async () => {
    await withEnv(adbEnv('udid-1=noperm', {DEVICE_UDID: 'udid-1'}), async () => {
      await assert.rejects(new BaseDriver({}).getStatusADB(), /NOT ready/);
    });
  });

  test('getStatusADB fails for an offline device with its state', async () => {
    await withEnv(adbEnv('udid-1=offline', {DEVICE_UDID: 'udid-1'}), async () => {
      await assert.rejects(new BaseDriver({}).getStatusADB(), /NOT ready for execution. Its adb state is 'offline'/);
    });
  });

  test('getStatusADB fails without DEVICE_UDID', async () => {
    await withEnv(adbEnv('udid-1', {DEVICE_UDID: undefined}), async () => {
      await assert.rejects(new BaseDriver({}).getStatusADB(), /DEVICE_UDID environment variable was not found/);
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
