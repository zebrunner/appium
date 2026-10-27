// The shared application storage of the patched configureApp: remote apps are kept in APPIUM_APPS_DIR
// (a volume shared by the devices of a host) and guarded by <app>.lock files during the download
import {test, describe, before, after, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {BASE_DRIVER_DIR, helpers, listen, tmpDir, withEnv} from './common.mjs';

const {configureApp} = helpers;
const {getLocalFileForAppUrl, evictSharedApps} = createRequire(import.meta.url)(path.join(BASE_DRIVER_DIR, 'build/lib/basedriver/mcloud-utils.js'));
const OPTS = {supportedExtensions: ['.apk']};

// session(url, env): configureApp in another node process, like a session of another device container of the host;
// resolves {result} or {error}
function session(url, env) {
  const code = `
    const {configureApp} = require(${JSON.stringify(path.join(BASE_DRIVER_DIR, 'build/lib/basedriver/helpers.js'))});
    configureApp(${JSON.stringify(url)}, {supportedExtensions: ['.apk']})
      .then((result) => console.log(JSON.stringify({result})), (e) => console.log(JSON.stringify({error: e.message})));`;
  const child = spawn(process.execPath, ['-e', code], {env: {...process.env, ...env}, stdio: ['ignore', 'pipe', 'ignore']});
  let out = '';
  child.stdout.on('data', (chunk) => (out += chunk));
  return new Promise((resolve) => child.on('close', () => {
    try {
      resolve(JSON.parse(out.trim().split('\n').pop()));
    } catch {
      resolve({error: `no result: ${out.slice(-200)}`});
    }
  }));
}

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
    localFile = path.join(appsDir, new URL(remote.url).host, 'builds', `${n}`, 'app.apk');
  });
  const env = (extra = {}) => ({
    APPIUM_APPS_DIR: appsDir,
    APPIUM_APP_WAITING_TIMEOUT: '5',
    APPIUM_MAX_LOCK_FILE_LIFETIME: '30',
    APPIUM_APP_FETCH_RETRIES: undefined,
    APPIUM_APP_SIZE_DISABLE: undefined,
    ...extra,
  });

  test('the file of an app url: <host>/<path>, inside the storage only', async () => {
    await withEnv(env(), async () => {
      assert.equal(await getLocalFileForAppUrl('https://Builds.example.com:8443/a/b.apk?sig=1'),
        path.join(appsDir, 'builds.example.com:8443', 'a', 'b.apk'));
      // the dot segments of a url are resolved by URL, also the encoded ones: the file stays in the storage
      assert.equal(await getLocalFileForAppUrl('http://evil/../../usr/lib/node_modules/appium/x.js'),
        path.join(appsDir, 'evil', 'usr', 'lib', 'node_modules', 'appium', 'x.js'));
      assert.equal(await getLocalFileForAppUrl('http://evil/%2e%2e/%2E%2E/x.apk'), path.join(appsDir, 'evil', 'x.apk'));
      assert.equal(await getLocalFileForAppUrl('http://evil/a%2F..%2F..%2Fx.apk'),
        path.join(appsDir, 'evil', 'a%2F..%2F..%2Fx.apk'));
      // the same path of two servers is two files
      assert.notEqual(await getLocalFileForAppUrl('http://a.example/x.apk'), await getLocalFileForAppUrl('http://b.example/x.apk'));
      for (const url of ['file:///etc/passwd', 'ftp://host/a.apk', 'http://host', 'http://host/', 'not a url']) {
        assert.equal(await getLocalFileForAppUrl(url), null, url);
      }
    });
  });

  test('an app url that tries to leave the storage is stored in it', async () => {
    await withEnv(env(), async () => {
      const escape = `escape-${n}.apk`;
      await configureApp(`${remote.url}/../../../../tmp/${escape}`, OPTS);
      assert.deepEqual(fs.readFileSync(path.join(appsDir, new URL(remote.url).host, 'tmp', escape)), app);
      assert.equal(fs.existsSync(path.join('/tmp', escape)), false, 'nothing outside the storage');
    });
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

  test('the stored app survives the exit of the Appium process that used it', async () => {
    fs.mkdirSync(path.dirname(localFile), {recursive: true});
    fs.writeFileSync(localFile, app);
    const appsEnv = Object.fromEntries(Object.entries(env()).filter(([, value]) => value !== undefined));
    const {result, error} = await session(url, appsEnv);
    assert.equal(error, undefined);
    assert.equal(result, localFile);
    // the cleanup of the cached apps on the exit of the process keeps the files of the shared storage
    assert.deepEqual(fs.readFileSync(localFile), app);
  });

  test('two Appium processes (devices of a host) starting together download the app once', async () => {
    const appsEnv = Object.fromEntries(Object.entries(env()).filter(([, value]) => value !== undefined));
    for (let run = 1; run <= 3; run++) {
      // the first requests of both sessions are answered together, so both look for the stored app at the same time
      const held = [];
      let holding = true;
      const release = () => {
        holding = false;
        held.splice(0).forEach((send) => send());
      };
      // a safety net when a session does not request at all
      const timer = setTimeout(release, 10000);
      const server = await listen((req, res) => {
        const send = () => {
          res.writeHead(200, {'content-type': 'application/octet-stream', 'content-length': app.length});
          res.end(app);
        };
        if (holding) {
          held.push(send);
          if (held.length === 2) {
            clearTimeout(timer);
            release();
          }
        } else {
          send();
        }
      });
      const dir = tmpDir('apps');
      const stored = path.join(dir, new URL(server.url).host, 'race', 'app.apk');
      try {
        const results = await Promise.all([1, 2].map(() => session(`${server.url}/race/app.apk`, {...appsEnv, APPIUM_APPS_DIR: dir})));
        const outcome = `run ${run}: ${JSON.stringify(results)}`;
        assert.deepEqual(results.filter((r) => r.error), [], outcome);
        assert.equal(results.filter((r) => r.result === stored).length, 1, `one session uses the stored app, ${outcome}`);
        assert.deepEqual(fs.readFileSync(stored), app, outcome);
        assert.deepEqual(fs.readdirSync(path.dirname(stored)), ['app.apk'], `no .lock or temporary file left, ${outcome}`);
      } finally {
        clearTimeout(timer);
        await server.close();
      }
    }
  });

  // tests/patch_test.sh mounts a 1 MB tmpfs there
  const SMALL_STORAGE = '/tmp/small-storage';
  test('a full storage fails the session with "no space left on device" (the device gets Unhealthy)', async (t) => {
    if (!fs.existsSync(SMALL_STORAGE)) {
      t.skip(`no ${SMALL_STORAGE} tmpfs`);
      return;
    }
    app = Buffer.alloc(3 * 1024 * 1024, 4);
    const storage = fs.mkdtempSync(path.join(SMALL_STORAGE, 'apps-'));
    await withEnv(env({APPIUM_APPS_DIR: storage}), async () => {
      await assert.rejects(configureApp(url, OPTS), (err) => {
        assert.ok(err instanceof Error, 'an Error');
        assert.match(err.message, /Cannot store the application in .*: .*no space left on device/i);
        return true;
      });
    });
    assert.deepEqual(fs.readdirSync(path.join(storage, new URL(url).host, 'builds', `${n}`)), [], 'no .lock or partial app left');
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

  // stored(name, ageMs, size): a file of the storage used ageMs ago; a size makes it sparse (no blocks of the disk)
  const stored = (name, ageMs, size = 0) => {
    const file = path.join(appsDir, 'host', name);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, size ? '' : 'app');
    if (size) {
      fs.truncateSync(file, size);
    }
    const time = new Date(Date.now() - ageMs);
    fs.utimesSync(file, time, time);
    return file;
  };
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  test('the stored app taken by a session is marked as used', async () => {
    await withEnv(env(), async () => {
      await configureApp(url, OPTS);
      const old = new Date(Date.now() - 10 * DAY);
      fs.utimesSync(localFile, old, old);
      assert.equal(await configureApp(url, OPTS), localFile);
      assert.ok(Date.now() - fs.statSync(localFile).mtimeMs < HOUR, 'used now');
    });
  });

  test('a download removes the apps not used for APPIUM_APPS_MAX_AGE days and the interrupted downloads', async () => {
    const old = stored('old.apk', 8 * DAY);
    const recent = stored('recent.apk', 2 * DAY);
    const downloading = stored('downloading.apk', 8 * DAY);
    fs.writeFileSync(`${downloading}.lock`, 'device');
    const interrupted = stored('interrupted.apk.1234.tmp', 2 * HOUR);
    const running = stored('running.apk.5678.tmp', 60 * 1000);
    await withEnv(env({APPIUM_APPS_MIN_FREE: '0'}), async () => {
      await configureApp(url, OPTS);
    });
    assert.deepEqual(fs.readFileSync(localFile), app, 'the new app is stored');
    assert.equal(fs.existsSync(old), false, 'not used for 8 days');
    assert.equal(fs.existsSync(interrupted), false, 'an interrupted download');
    for (const kept of [recent, downloading, `${downloading}.lock`, running]) {
      assert.ok(fs.existsSync(kept), kept);
    }
  });

  test('APPIUM_APPS_MAX_AGE=0 keeps the old apps', async () => {
    const old = stored('old.apk', 300 * DAY);
    await withEnv(env({APPIUM_APPS_MAX_AGE: '0', APPIUM_APPS_MIN_FREE: '0'}), async () => {
      await configureApp(url, OPTS);
    });
    assert.ok(fs.existsSync(old));
  });

  test('the least recently used apps are removed while the free space is below APPIUM_APPS_MIN_FREE', async () => {
    const GB = 1024 * 1024 * 1024;
    const oldest = stored('oldest.apk', 3 * HOUR, GB);
    const older = stored('older.apk', 2 * HOUR, GB);
    const old = stored('old.apk', 90 * 60 * 1000, GB);
    const recent = stored('recent.apk', 10 * 60 * 1000, GB);
    // the free space is 1.5 GB less than the limit: the two least recently used apps (1 GB each, as the eviction
    // counts them) make it
    const {bavail, blocks, bsize} = fs.statfsSync(appsDir);
    const minFree = (bavail * bsize + 1.5 * GB) / (blocks * bsize) * 100;
    await withEnv(env({APPIUM_APPS_MAX_AGE: '0', APPIUM_APPS_MIN_FREE: String(minFree)}), async () => {
      await evictSharedApps(appsDir);
    });
    assert.equal(fs.existsSync(oldest), false);
    assert.equal(fs.existsSync(older), false);
    assert.ok(fs.existsSync(old), 'enough space');
    assert.ok(fs.existsSync(recent));
  });

  test('the apps used in the last hour are kept even without free space', async () => {
    const recent = stored('recent.apk', 30 * 60 * 1000);
    const unused = stored('unused.apk', 2 * HOUR);
    await withEnv(env({APPIUM_APPS_MAX_AGE: '0', APPIUM_APPS_MIN_FREE: '100'}), async () => {
      await evictSharedApps(appsDir);
    });
    assert.ok(fs.existsSync(recent));
    assert.equal(fs.existsSync(unused), false);
  });

  test('a failed eviction does not fail the session', async () => {
    await withEnv(env({APPIUM_APPS_MIN_FREE: 'not a number', APPIUM_APPS_MAX_AGE: '-1'}), async () => {
      await evictSharedApps(path.join(appsDir, 'missing'));
      assert.deepEqual(fs.readFileSync(await configureApp(url, OPTS)), app);
    });
  });

  test('without APPIUM_APPS_DIR nothing is stored', async () => {
    await withEnv(env({APPIUM_APPS_DIR: ''}), async () => {
      const result = await configureApp(url, OPTS);
      assert.ok(fs.existsSync(result));
      assert.deepEqual(fs.readdirSync(appsDir), []);
    });
  });
});
