// The shared application storage of the patched configureApp: remote apps are kept in APPIUM_APPS_DIR
// (a volume shared by the devices of a host) and guarded by <app>.lock files during the download
import {test, describe, before, after, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {helpers, listen, tmpDir, withEnv} from './common.mjs';

const {configureApp} = helpers;
const OPTS = {supportedExtensions: ['.apk']};

describe('shared application storage', () => {
  let remote;
  let app = Buffer.alloc(2048, 1);
  // breaks(index): whether the index-th (1-based) request of the test app breaks (headers sent, then the connection is destroyed)
  let breaks = () => false;
  // onRequest(index): called for every request of the test app before the response
  let onRequest = () => {};
  // the delay of every response, ms
  let delay = 0;
  const counts = {};

  before(async () => {
    remote = await listen((req, res) => {
      res.writeHead(200, {'content-type': 'application/octet-stream', 'content-length': app.length});
      const index = (counts[req.url] = (counts[req.url] ?? 0) + 1);
      onRequest(index);
      setTimeout(() => {
        if (breaks(index)) {
          res.write(app.subarray(0, 10));
          res.destroy();
          return;
        }
        res.end(app);
      }, delay);
    });
  });
  after(() => remote.close());

  let appsDir;
  let n = 0;
  let url;
  let localFile;
  beforeEach(() => {
    app = Buffer.alloc(2048, 1);
    breaks = () => false;
    onRequest = () => {};
    delay = 0;
    appsDir = tmpDir('apps');
    // a new path every test: configureApp also keeps an in-memory cache by url
    n++;
    url = `${remote.url}/builds/${n}/app.apk?token=secret`;
    localFile = path.join(appsDir, 'builds', `${n}`, 'app.apk');
  });
  const env = (extra = {}) => ({
    APPIUM_APPS_DIR: appsDir,
    APPIUM_APP_WAITING_TIMEOUT: '5',
    APPIUM_MAX_LOCK_FILE_LIFETIME: '30',
    APPIUM_APP_FETCH_RETRIES: undefined,
    APPIUM_APP_SIZE_DISABLE: undefined,
    ...extra,
  });

  test('a downloaded app is stored by its url path without the query', async () => {
    await withEnv(env(), async () => {
      await configureApp(url, OPTS);
      assert.deepEqual(fs.readFileSync(localFile), app);
      assert.equal(fs.existsSync(`${localFile}.lock`), false, 'no .lock left');
    });
  });

  test('the stored app is used when the remote size is the same', async () => {
    await withEnv(env(), async () => {
      await configureApp(url, OPTS);
      assert.equal(await configureApp(url, OPTS), localFile);
    });
  });

  test('the stored app is replaced when the remote size differs', async () => {
    await withEnv(env(), async () => {
      await configureApp(url, OPTS);
      app = Buffer.alloc(4096, 2);
      await configureApp(url, OPTS);
      assert.deepEqual(fs.readFileSync(localFile), app);
    });
  });

  test('APPIUM_APP_SIZE_DISABLE=true uses the stored app without the size check', async () => {
    fs.mkdirSync(path.dirname(localFile), {recursive: true});
    fs.writeFileSync(localFile, 'old');
    await withEnv(env({APPIUM_APP_SIZE_DISABLE: 'true'}), async () => {
      assert.equal(await configureApp(url, OPTS), localFile);
      assert.equal(fs.readFileSync(localFile, 'utf8'), 'old');
    });
  });

  test('a parallel download (.lock) is awaited and its app is used', async () => {
    fs.mkdirSync(path.dirname(localFile), {recursive: true});
    fs.writeFileSync(`${localFile}.lock`, 'device UUID: other');
    setTimeout(() => {
      fs.writeFileSync(localFile, app);
      fs.unlinkSync(`${localFile}.lock`);
    }, 1500);
    await withEnv(env(), async () => {
      assert.equal(await configureApp(url, OPTS), localFile);
    });
    assert.equal(remote.requests.filter((r) => r.url.startsWith(`/builds/${n}/`)).length, 1, 'only the initial request');
  });

  test('two parallel sessions of the same app download it once', async () => {
    // a slow server: the second session starts while the first one downloads
    delay = 500;
    await withEnv(env(), async () => {
      const results = await Promise.all([configureApp(url, OPTS), configureApp(url, OPTS)]);
      assert.equal(results.filter((result) => result === localFile).length, 1, `one session uses the stored app: ${results}`);
      assert.deepEqual(fs.readFileSync(localFile), app);
    });
    assert.equal(fs.existsSync(`${localFile}.lock`), false, 'no .lock left');
  });

  test('a .lock that is not removed in APPIUM_APP_WAITING_TIMEOUT fails the session', async () => {
    fs.mkdirSync(path.dirname(localFile), {recursive: true});
    fs.writeFileSync(`${localFile}.lock`, 'device UUID: other');
    await withEnv(env({APPIUM_APP_WAITING_TIMEOUT: '2'}), async () => {
      await assert.rejects(configureApp(url, OPTS), /has not disappeared/);
    });
  });

  test('a .lock older than APPIUM_MAX_LOCK_FILE_LIFETIME is removed', async () => {
    fs.mkdirSync(path.dirname(localFile), {recursive: true});
    fs.writeFileSync(`${localFile}.lock`, 'device UUID: crashed');
    await withEnv(env({APPIUM_MAX_LOCK_FILE_LIFETIME: '1'}), async () => {
      await assert.rejects(configureApp(url, OPTS), /lifetime limit/);
    });
    assert.equal(fs.existsSync(`${localFile}.lock`), false);
  });

  test('the .lock carries the device and the session of the download', async () => {
    let lockContent;
    // the second request is the download, the .lock is written before it
    onRequest = (index) => {
      if (index === 2) {
        lockContent = fs.readFileSync(`${localFile}.lock`, 'utf8');
      }
    };
    await withEnv(env({DEVICE_UDID: 'udid-1'}), async () => {
      await configureApp(url, OPTS);
    });
    assert.match(lockContent ?? '', /^device UUID: udid-1, session ID: /);
  });

  test('APPIUM_APP_FETCH_RETRIES=2 retries a broken download', async () => {
    await withEnv(env({APPIUM_APP_FETCH_RETRIES: '2'}), async () => {
      // the initial request of Appium is fine, the first two download attempts break
      breaks = (index) => index === 2 || index === 3;
      await configureApp(url, OPTS);
      assert.deepEqual(fs.readFileSync(localFile), app);
    });
  });

  test('APPIUM_APP_FETCH_RETRIES=0 disables the retries', async () => {
    let attempts = 0;
    await withEnv(env({APPIUM_APP_FETCH_RETRIES: '0'}), async () => {
      breaks = (index) => index > 1;
      await assert.rejects(configureApp(url, OPTS));
      attempts = counts[new URL(url).pathname + new URL(url).search];
    });
    // the initial request of Appium and one download attempt
    assert.equal(attempts, 2);
  });

  for (const value of [undefined, 'abc', '-1']) {
    test(`APPIUM_APP_FETCH_RETRIES=${value ?? '(unset)'} retries a broken download 3 times`, async () => {
      let attempts = 0;
      await withEnv(env({APPIUM_APP_FETCH_RETRIES: value}), async () => {
        breaks = (index) => index > 1;
        await assert.rejects(configureApp(url, OPTS));
        attempts = counts[new URL(url).pathname + new URL(url).search];
      });
      // the initial request of Appium, the first download attempt and 3 retries
      assert.equal(attempts, 5);
    });
  }

  test('a failed download leaves neither the app nor the .lock', async () => {
    await withEnv(env({APPIUM_APP_FETCH_RETRIES: '1'}), async () => {
      breaks = (index) => index > 1;
      await assert.rejects(configureApp(url, OPTS));
    });
    assert.equal(fs.existsSync(localFile), false);
    assert.equal(fs.existsSync(`${localFile}.lock`), false);
  });

  test('without APPIUM_APPS_DIR nothing is stored', async () => {
    await withEnv(env({APPIUM_APPS_DIR: ''}), async () => {
      const result = await configureApp(url, OPTS);
      assert.ok(fs.existsSync(result));
      assert.deepEqual(fs.readdirSync(appsDir), []);
    });
  });
});
