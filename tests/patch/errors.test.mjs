// The error handler of the patched protocol: device context in error messages and STF device updates
import {test, describe, before, after, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {BASE_DRIVER_DIR, baseDriver, listen, request, startDriverServer, withEnv} from './common.mjs';

const {BaseDriver} = baseDriver;

// a driver whose GET /status fails with the given error message
class FailingDriver extends BaseDriver {
  async getStatus() {
    throw new Error(this.errorMessage);
  }
}

describe('error handler', () => {
  let stf;
  let server;
  const driver = new FailingDriver({});

  before(async () => {
    stf = await listen((req, res) => {
      res.writeHead(200, {'content-type': 'application/json'});
      res.end('{"success": true}');
    });
    server = await startDriverServer(driver);
  });
  after(async () => {
    await server.close();
    await stf.close();
  });
  beforeEach(() => {
    stf.requests.length = 0;
  });

  const env = (extra = {}) => ({
    STF_API_URL: `${stf.url}/api/v1`,
    STF_AUTH_TOKEN: 'stf-auth-token',
    STF_TOKEN: undefined,
    DEVICE_UDID: 'udid-1',
    DEVICE_NAME: 'Pixel 7',
    ...extra,
  });

  // fails GET /status with the message, returns the error response
  async function failWith(message, extraEnv = {}) {
    driver.errorMessage = message;
    return withEnv(env(extraEnv), () => request(`${server.url}/status`));
  }

  test('the device context is appended to error messages', async () => {
    const res = await failWith('boom');
    assert.equal(res.status, 500);
    assert.match(res.json.value.message, /^boom\[\[\[--udid udid-1 --name Pixel 7 --sessionId .*\]\]\]$/);
  });

  test('"element could not be located" is kept as is', async () => {
    const message = 'An element could not be located on the page using the given search parameters.';
    const res = await failWith(message);
    assert.equal(res.json.value.message, message);
  });

  test('an unrelated error does not call STF', async () => {
    await failWith('boom');
    assert.deepEqual(stf.requests, []);
  });

  const unhealthy = [
    'Device setup is not yet complete',
    'ENOSPC: no space left on device, mkdir \'/tmp/x\'',
    'adb: failed to install /tmp/app.apk',
    "Cannot execute the 'am' shell command",
  ];
  for (const message of unhealthy) {
    test(`"${message}" marks the device Unhealthy in STF`, async () => {
      await failWith(message);
      assert.equal(stf.requests.length, 1, 'one STF call');
      const [req] = stf.requests;
      assert.equal(req.method, 'PUT');
      assert.equal(req.url, '/api/v1/devices/udid-1');
      assert.deepEqual(JSON.parse(req.body), {device: {status: 'Unhealthy', note: message}});
    });
  }

  const noteOnly = [
    'Could not proxy command to the remote server. Original error: socket hang up',
    'The session identified by 1234 is not known',
  ];
  for (const message of noteOnly) {
    test(`"${message}" adds a note in STF without a status change`, async () => {
      await failWith(message);
      assert.equal(stf.requests.length, 1, 'one STF call');
      assert.deepEqual(JSON.parse(stf.requests[0].body), {device: {note: message}});
    });
  }

  test('STF calls are authorized with STF_AUTH_TOKEN (the env var of the image)', async () => {
    await failWith('Device setup is not yet complete');
    assert.equal(stf.requests[0]?.headers.authorization, 'Bearer stf-auth-token');
  });

  for (const missing of ['STF_AUTH_TOKEN', 'DEVICE_UDID', 'STF_API_URL']) {
    for (const value of ['', undefined]) {
      test(`no STF call without ${missing} (${value === undefined ? 'unset' : 'empty'})`, async () => {
        const res = await failWith('Device setup is not yet complete', {[missing]: value});
        assert.deepEqual(stf.requests, []);
        assert.equal(res.status, 500, 'the error response is sent');
      });
    }
  }

  test('"Cannot find any free port in range" exits Appium with 1', () => {
    // in a child node: the handler calls process.exit
    const code = `
      const http = require('http');
      const b = require(${JSON.stringify(BASE_DRIVER_DIR)});
      class D extends b.BaseDriver { async getStatus() { throw new Error('Cannot find any free port in range 8200..8299'); } }
      b.server({routeConfiguringFunction: b.routeConfiguringFunction(new D({})), port: 0, hostname: '127.0.0.1'})
        .then((server) => http.get({host: '127.0.0.1', port: server.address().port, path: '/status'}, () => process.exit(100))
          .on('error', () => process.exit(101)));`;
    const {status} = spawnSync(process.execPath, ['-e', code], {env: {...process.env, STF_API_URL: ''}, stdio: 'ignore', timeout: 60000});
    assert.equal(status, 1);
  });

  test('the error response is sent when STF fails', async () => {
    const res = await failWith('Device setup is not yet complete', {STF_API_URL: 'http://127.0.0.1:9/api/v1'});
    assert.equal(res.status, 500);
    assert.match(res.json.value.message, /^Device setup is not yet complete/);
  });
});
