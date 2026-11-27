// The shared application storage of the patched configureApp: remote apps are kept in APPIUM_APPS_DIR
// (a volume shared by the devices of a host) and guarded by <app>.lock files during the download
import {test, describe, before, after, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {BASE_DRIVER_DIR, helpers, listen, tmpDir, withEnv} from './common.mjs';

const {configureApp} = helpers;
const {getSharedApp, evictSharedApps, writeStoredAppMeta} =
  createRequire(import.meta.url)(path.join(BASE_DRIVER_DIR, 'build/lib/basedriver/mcloud-utils.js'));
const OPTS = {supportedExtensions: ['.apk']};
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
// the file of the app of a url in the storage: <host>/<sha256 of the full url>/<last segment of its path>
const storedPath = (appsDir, url) => {
  const parsed = new URL(url);
  return path.join(appsDir, parsed.host, sha256(`url\n${parsed.href}`), parsed.pathname.split('/').pop());
};

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
  // respond(req): {status, headers, body} of a request instead of the test app, or undefined
  let respond = () => undefined;
  const counts = {};

  before(async () => {
    remote = await listen((req, res) => {
      const index = (counts[req.url] = (counts[req.url] ?? 0) + 1);
      const custom = respond(req);
      const body = custom?.body ?? app;
      res.writeHead(custom?.status ?? 200,
        {'content-type': 'application/octet-stream', 'content-length': body.length, ...custom?.headers});
      onRequest(index);
      setTimeout(() => {
        if (breaks(index)) {
          res.write(body.subarray(0, 10));
          res.destroy();
          return;
        }
        res.end(body);
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
    respond = () => undefined;
    delay = 0;
    appsDir = tmpDir('apps');
    // a new path every test: configureApp also keeps an in-memory cache by url
    n++;
    url = `${remote.url}/builds/${n}/app.apk?token=secret`;
    localFile = storedPath(appsDir, url);
  });
  const env = (extra = {}) => ({
    APPIUM_APPS_DIR: appsDir,
    APPIUM_APP_WAITING_TIMEOUT: '5',
    APPIUM_MAX_LOCK_FILE_LIFETIME: '30',
    APPIUM_APP_FETCH_RETRIES: undefined,
    APPIUM_APP_SIZE_DISABLE: undefined,
    ...extra,
  });
  const downloads = (prefix) => remote.requests.filter((r) => r.url.startsWith(prefix)).length;
  // store(file, body, headers): an app of the storage with its metadata, as a download with the response headers
  const store = async (file, body, headers = {'content-length': String(body.length)}) => {
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(`${file}.1.tmp`, body);
    await writeStoredAppMeta(file, `${file}.1.tmp`, 'url', headers);
    fs.renameSync(`${file}.1.tmp`, file);
  };

  test('the file of an app url: <host>/<sha256 of the full url>/<name>, inside the storage only', async () => {
    await withEnv(env(), async () => {
      const appUrl = 'https://Builds.example.com:8443/a/b.apk?sig=1';
      assert.deepEqual(await getSharedApp(appUrl),
        {file: path.join(appsDir, 'builds.example.com:8443', sha256('url\nhttps://builds.example.com:8443/a/b.apk?sig=1'), 'b.apk'), key: 'url'});
      // the query is a part of the key: the urls of two builds are two files
      assert.notEqual((await getSharedApp('http://host/download/app.apk?id=1')).file,
        (await getSharedApp('http://host/download/app.apk?id=2')).file);
      // the same path of two servers is two files
      assert.notEqual((await getSharedApp('http://a.example/x.apk')).file, (await getSharedApp('http://b.example/x.apk')).file);
      // the dot segments of a url are resolved by URL, also the encoded ones: the file stays in the storage
      for (const escape of ['http://evil/../../usr/lib/node_modules/appium/x.js', 'http://evil/%2e%2e/%2E%2E/x.apk',
        'http://evil/a%2F..%2F..%2Fx.apk']) {
        const {file} = await getSharedApp(escape);
        assert.equal(path.relative(path.join(appsDir, 'evil'), path.dirname(file)).length, 64, escape);
      }
      for (const bad of ['file:///etc/passwd', 'ftp://host/a.apk', 'http://host', 'http://host/', 'not a url',
        'http://host/a.lock', 'http://host/a.meta.json', 'http://host/a.1.tmp', `http://host/${'a'.repeat(201)}`]) {
        assert.equal(await getSharedApp(bad), null, bad);
      }
    });
  });

  test('a signed url with a strong ETag is keyed by its object: the url without the signature parameters', async () => {
    await withEnv(env(), async () => {
      const etag = {etag: '"abc"'};
      const s3 = (signature) => `https://bucket.s3.amazonaws.com/app.apk?versionId=7&X-Amz-Algorithm=AWS4-HMAC-SHA256` +
        `&X-Amz-Credential=key&X-Amz-Date=20260101T000000Z&X-Amz-Expires=600&X-Amz-SignedHeaders=host&X-Amz-Signature=${signature}`;
      const first = await getSharedApp(s3('1'), etag);
      assert.equal(first.key, 'signed');
      assert.deepEqual(await getSharedApp(s3('2'), etag), first, 'another signature of the object');
      assert.notEqual((await getSharedApp(s3('1').replace('versionId=7', 'versionId=8'), etag)).file, first.file,
        'another version of the object');
      const sas = (sig) => `https://distribution.azureedge.net/1234/app.apk?sv=2019-02-02&sr=c&sig=${sig}&se=2026-01-01&sp=r`;
      assert.equal((await getSharedApp(sas('a'), etag)).file, (await getSharedApp(sas('b'), etag)).file, 'Azure SAS (App Center)');
      // without a strong ETag the stored app of another signature could not be checked: the full url is the key
      for (const headers of [{}, {etag: 'W/"abc"'}]) {
        const unchecked = await getSharedApp(s3('1'), headers);
        assert.equal(unchecked.key, 'url', JSON.stringify(headers));
        assert.notEqual(unchecked.file, (await getSharedApp(s3('2'), headers)).file);
      }
      // a query that is not a signature keeps the full url as the key
      assert.equal((await getSharedApp('http://host/app.apk?sig=1', etag)).key, 'url');
    });
  });

  test('an app url that tries to leave the storage is stored in it', async () => {
    await withEnv(env(), async () => {
      const escape = `escape-${n}.apk`;
      const escapeUrl = `${remote.url}/../../../../tmp/${escape}`;
      await configureApp(escapeUrl, OPTS);
      assert.deepEqual(fs.readFileSync(storedPath(appsDir, escapeUrl)), app);
      assert.equal(fs.existsSync(path.join('/tmp', escape)), false, 'nothing outside the storage');
    });
  });

  test('a downloaded app is stored by its full url with its metadata', async () => {
    respond = () => ({headers: {etag: '"v1"', 'last-modified': 'Wed, 01 Jan 2026 00:00:00 GMT'}});
    await withEnv(env(), async () => {
      await configureApp(url, OPTS);
      assert.deepEqual(fs.readFileSync(localFile), app);
      assert.deepEqual(JSON.parse(fs.readFileSync(`${localFile}.meta.json`, 'utf8')), {
        key: 'url', etag: '"v1"', lastModified: 'Wed, 01 Jan 2026 00:00:00 GMT', contentLength: app.length,
        sha256: crypto.createHash('sha256').update(app).digest('hex'),
      });
      assert.equal(fs.existsSync(`${localFile}.lock`), false, 'no .lock left');
      assert.equal(JSON.stringify(fs.readdirSync(path.dirname(localFile))).includes('secret'), false, 'the url is not stored');
    });
  });

  test('the stored app is used when the response has its Content-Length', async () => {
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

  test('the ETag decides: the same one uses the stored app, another one replaces it', async () => {
    let etag = '"v1"';
    respond = () => ({headers: {etag}});
    await withEnv(env(), async () => {
      await configureApp(url, OPTS);
      assert.equal(await configureApp(url, OPTS), localFile, 'the same ETag');
      // a new build of the same size at the same url
      etag = '"v2"';
      app = Buffer.alloc(2048, 7);
      assert.notEqual(await configureApp(url, OPTS), localFile, 'another ETag: downloaded');
      assert.deepEqual(fs.readFileSync(localFile), app);
    });
  });

  test('urls that differ only by the query never share an app, even of the same size', async () => {
    const base = `${remote.url}/download/${n}/app.apk`;
    respond = (req) => ({body: Buffer.alloc(2048, req.url.endsWith('id=1') ? 1 : 9)});
    await withEnv(env(), async () => {
      const first = await configureApp(`${base}?id=1`, OPTS);
      const second = await configureApp(`${base}?id=2`, OPTS);
      assert.deepEqual(fs.readFileSync(first), Buffer.alloc(2048, 1));
      assert.deepEqual(fs.readFileSync(second), Buffer.alloc(2048, 9), 'the app of its own url');
      assert.deepEqual(fs.readFileSync(storedPath(appsDir, `${base}?id=1`)), Buffer.alloc(2048, 1));
      assert.deepEqual(fs.readFileSync(storedPath(appsDir, `${base}?id=2`)), Buffer.alloc(2048, 9));
    });
    assert.equal(downloads(`/download/${n}/`), 4, 'both apps are downloaded');
  });

  test('a stored app whose bytes changed is not used, it is downloaded again', async () => {
    await withEnv(env(), async () => {
      await configureApp(url, OPTS);
      // the same size, other bytes
      fs.writeFileSync(localFile, Buffer.alloc(2048, 6));
      assert.notEqual(await configureApp(url, OPTS), localFile);
      assert.deepEqual(fs.readFileSync(localFile), app, 'the stored app is downloaded again');
    });
  });

  test('a stored app without metadata (of an older image) is not used', async () => {
    fs.mkdirSync(path.dirname(localFile), {recursive: true});
    fs.writeFileSync(localFile, Buffer.alloc(2048, 5));
    await withEnv(env({APPIUM_APP_SIZE_DISABLE: 'true'}), async () => {
      assert.notEqual(await configureApp(url, OPTS), localFile);
    });
    assert.deepEqual(fs.readFileSync(localFile), app);
  });

  test('APPIUM_APP_SIZE_DISABLE=true uses the stored app of the same url without comparing the response', async () => {
    await withEnv(env(), async () => {
      await configureApp(url, OPTS);
    });
    const stored = app;
    app = Buffer.alloc(4096, 3);
    await withEnv(env({APPIUM_APP_SIZE_DISABLE: 'true'}), async () => {
      assert.equal(await configureApp(url, OPTS), localFile);
    });
    assert.deepEqual(fs.readFileSync(localFile), stored);
  });

  test('a signed url: the app of its object is used for another signature with the same ETag', async () => {
    const object = `/bucket/${n}/app.apk`;
    const signed = (signature) => `${remote.url}${object}?X-Amz-Credential=key&X-Amz-Signature=${signature}`;
    // the server accepts the signatures "good-*" only
    let etag = '"object-v1"';
    respond = (req) => (new URL(req.url, remote.url).searchParams.get('X-Amz-Signature').startsWith('good')
      ? {headers: {etag}} : {status: 403, body: Buffer.from('denied')});
    await withEnv(env(), async () => {
      await configureApp(signed('good-1'), OPTS);
      const {file} = await getSharedApp(signed('good-1'), {etag});
      assert.deepEqual(fs.readFileSync(file), app);
      assert.equal(await configureApp(signed('good-2'), OPTS), file, 'another signature, the same object');
      await assert.rejects(configureApp(signed('bad'), OPTS), /403/, 'a refused signature gets no app');
      // a new version of the object
      etag = '"object-v2"';
      app = Buffer.alloc(2048, 8);
      assert.notEqual(await configureApp(signed('good-3'), OPTS), file);
      assert.deepEqual(fs.readFileSync(file), app);
    });
  });

  test('a signed url: APPIUM_APP_SIZE_DISABLE=true does not skip the ETag', async () => {
    const signed = (signature) => `${remote.url}/bucket/${n}/app.apk?X-Amz-Credential=key&X-Amz-Signature=${signature}`;
    let etag = '"one"';
    respond = () => ({headers: {etag}});
    await withEnv(env({APPIUM_APP_SIZE_DISABLE: 'true'}), async () => {
      await configureApp(signed('1'), OPTS);
      etag = '"two"';
      const {file} = await getSharedApp(signed('1'), {etag});
      assert.notEqual(await configureApp(signed('2'), OPTS), file);
    });
  });

  test('a parallel download (.lock) is awaited and its app is used', async () => {
    fs.mkdirSync(path.dirname(localFile), {recursive: true});
    fs.writeFileSync(`${localFile}.lock`, 'device UUID: other');
    setTimeout(async () => {
      await store(localFile, app);
      fs.unlinkSync(`${localFile}.lock`);
    }, 1500);
    await withEnv(env(), async () => {
      assert.equal(await configureApp(url, OPTS), localFile);
    });
    assert.equal(downloads(`/builds/${n}/`), 1, 'only the initial request');
  });

  test('the app of a parallel download that is not the one of the response is not used', async () => {
    fs.mkdirSync(path.dirname(localFile), {recursive: true});
    fs.writeFileSync(`${localFile}.lock`, 'device UUID: other');
    const other = Buffer.alloc(4096, 4);
    setTimeout(async () => {
      await store(localFile, other);
      fs.unlinkSync(`${localFile}.lock`);
    }, 1500);
    await withEnv(env(), async () => {
      const result = await configureApp(url, OPTS);
      assert.notEqual(result, localFile);
      assert.deepEqual(fs.readFileSync(result), app, 'the session downloads its own app');
    });
    assert.deepEqual(fs.readFileSync(localFile), other, 'the stored app of the other download is left');
  });

  test('a parallel download that stores nothing: the session downloads the app for itself', async () => {
    fs.mkdirSync(path.dirname(localFile), {recursive: true});
    fs.writeFileSync(`${localFile}.lock`, 'device UUID: other');
    setTimeout(() => fs.unlinkSync(`${localFile}.lock`), 1000);
    await withEnv(env(), async () => {
      assert.deepEqual(fs.readFileSync(await configureApp(url, OPTS)), app);
    });
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
    await store(localFile, app);
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
      const stored = storedPath(dir, `${server.url}/race/app.apk`);
      try {
        const results = await Promise.all([1, 2].map(() => session(`${server.url}/race/app.apk`, {...appsEnv, APPIUM_APPS_DIR: dir})));
        const outcome = `run ${run}: ${JSON.stringify(results)}`;
        assert.deepEqual(results.filter((r) => r.error), [], outcome);
        assert.equal(results.filter((r) => r.result === stored).length, 1, `one session uses the stored app, ${outcome}`);
        assert.deepEqual(fs.readFileSync(stored), app, outcome);
        assert.deepEqual(fs.readdirSync(path.dirname(stored)).sort(), ['app.apk', 'app.apk.meta.json'],
          `no .lock or temporary file left, ${outcome}`);
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
    assert.deepEqual(fs.readdirSync(path.dirname(storedPath(storage, url))), [], 'no .lock, metadata or partial app left');
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

  test('a download longer than APPIUM_MAX_LOCK_FILE_LIFETIME keeps its .lock fresh: a waiting session uses its app', async () => {
    // the headers at once, the body after 8 s (the other session starts meanwhile); the lifetime of a .lock is 1 s
    const slow = await listen((req, res) => {
      res.writeHead(200, {'content-type': 'application/octet-stream', 'content-length': app.length});
      res.flushHeaders();
      setTimeout(() => res.end(app), 8000);
    });
    const slowUrl = `${slow.url}/slow/app.apk`;
    const stored = storedPath(appsDir, slowUrl);
    const appsEnv = Object.fromEntries(Object.entries(env({APPIUM_APP_WAITING_TIMEOUT: '30', APPIUM_MAX_LOCK_FILE_LIFETIME: '1'}))
      .filter(([, value]) => value !== undefined));
    try {
      await withEnv(appsEnv, async () => {
        const downloading = configureApp(slowUrl, OPTS);
        for (let i = 0; i < 100 && !fs.existsSync(`${stored}.lock`); i++) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        assert.ok(fs.existsSync(`${stored}.lock`), 'the download has its .lock');
        // another device of the host wants the same app while it is downloaded
        const [downloaded, other] = await Promise.all([downloading, session(slowUrl, appsEnv)]);
        assert.equal(other.error, undefined, 'the waiting session does not take the .lock for the one of a dead download');
        assert.equal(other.result, stored);
        assert.ok(fs.existsSync(downloaded));
      });
      assert.deepEqual(fs.readFileSync(stored), app);
      assert.equal(fs.existsSync(`${stored}.lock`), false, 'no .lock left');
      // the initial requests of both sessions and one download: the other session waited for it and checked the stored
      // app with the headers of its initial request
      assert.equal(slow.requests.length, 3, 'the app is downloaded once');
    } finally {
      await slow.close();
    }
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

  // age(file, ms): the file was used ms ago
  const age = (file, ms) => {
    const time = new Date(Date.now() - ms);
    fs.utimesSync(file, time, time);
  };

  test('an app goes with its metadata, a folder (the .app of a simulator) is one app, the metadata of no app goes', async () => {
    const file = path.join(appsDir, 'host', 'a'.repeat(64), 'old.apk');
    await store(file, Buffer.from('old'));
    age(file, 8 * DAY);
    const folder = path.join(appsDir, 'host', 'b'.repeat(64), 'Sim.app');
    fs.mkdirSync(path.join(folder, 'Frameworks'), {recursive: true});
    fs.writeFileSync(path.join(folder, 'Info.plist'), 'plist');
    fs.writeFileSync(`${folder}.meta.json`, '{}');
    // the files of an unzipped app keep the times of the archive
    age(path.join(folder, 'Info.plist'), 300 * DAY);
    age(folder, 2 * DAY);
    const orphan = path.join(appsDir, 'host', 'c'.repeat(64), 'gone.apk.meta.json');
    fs.mkdirSync(path.dirname(orphan), {recursive: true});
    fs.writeFileSync(orphan, '{}');
    age(orphan, 2 * HOUR);
    await withEnv(env({APPIUM_APPS_MIN_FREE: '0'}), async () => {
      await evictSharedApps(appsDir);
    });
    assert.equal(fs.existsSync(file), false, 'not used for 8 days');
    assert.equal(fs.existsSync(`${file}.meta.json`), false, 'its metadata');
    assert.ok(fs.existsSync(path.join(folder, 'Info.plist')), 'the folder app was used 2 days ago: its files stay');
    assert.ok(fs.existsSync(`${folder}.meta.json`));
    assert.equal(fs.existsSync(orphan), false, 'the metadata of no app');
  });

  test('a folder app not used for APPIUM_APPS_MAX_AGE days is removed as a whole', async () => {
    const folder = path.join(appsDir, 'host', 'd'.repeat(64), 'Sim.app');
    fs.mkdirSync(folder, {recursive: true});
    fs.writeFileSync(path.join(folder, 'Info.plist'), 'plist');
    fs.writeFileSync(`${folder}.meta.json`, '{}');
    age(folder, 8 * DAY);
    await withEnv(env({APPIUM_APPS_MIN_FREE: '0'}), async () => {
      await evictSharedApps(appsDir);
    });
    assert.equal(fs.existsSync(folder), false);
    assert.equal(fs.existsSync(`${folder}.meta.json`), false);
  });

  test('the Playwright versions of PLAYWRIGHT_CACHE_DIR in the storage are not apps', async () => {
    const version = path.join(appsDir, 'playwright', '1.50.0', 'node_modules', 'playwright-core', 'index.js');
    fs.mkdirSync(path.dirname(version), {recursive: true});
    fs.writeFileSync(version, 'module.exports = {};');
    age(version, 30 * DAY);
    const old = stored('old.apk', 8 * DAY);
    await withEnv(env({APPIUM_APPS_MIN_FREE: '0', PLAYWRIGHT_CACHE_DIR: path.join(appsDir, 'playwright')}), async () => {
      await evictSharedApps(appsDir);
    });
    assert.ok(fs.existsSync(version));
    assert.equal(fs.existsSync(old), false);
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

// The check of a stored app uses the headers of the request of Appium: no request of its own
describe('the check of a stored app', () => {
  const app = Buffer.alloc(2048, 3);

  test('the stored app is checked with the headers of the request of the session, without a request of its own', async () => {
    const remote = await listen((req, res) => {
      res.writeHead(200, {'content-type': 'application/octet-stream', 'content-length': app.length, etag: '"e"'});
      res.end(app);
    });
    const appsDir = tmpDir('apps');
    try {
      await withEnv({APPIUM_APPS_DIR: appsDir, APPIUM_APP_SIZE_DISABLE: undefined}, async () => {
        await configureApp(`${remote.url}/checked/app.apk`, OPTS);
        assert.equal(remote.requests.length, 2, 'the request of Appium and the download');
        remote.requests.length = 0;
        await configureApp(`${remote.url}/checked/app.apk`, OPTS);
        assert.equal(remote.requests.length, 1, 'the request of Appium only');
      });
    } finally {
      await remote.close();
    }
  });

  test('a server without ETag, Last-Modified and Content-Length: the stored app is downloaded again', async () => {
    let body = app;
    // no content-length: a chunked response
    const remote = await listen((req, res) => {
      res.writeHead(200, {'content-type': 'application/octet-stream'});
      res.end(body);
    });
    const appsDir = tmpDir('apps');
    const url = `${remote.url}/chunked/app.apk`;
    const stored = storedPath(appsDir, url);
    try {
      await withEnv({APPIUM_APPS_DIR: appsDir, APPIUM_APP_SIZE_DISABLE: undefined}, async () => {
        await configureApp(url, OPTS);
        assert.deepEqual(fs.readFileSync(stored), app, 'the first session stores the app');
        // the next session cannot compare the app: it is downloaded again, as a new build may be at the url
        body = Buffer.alloc(4096, 4);
        await configureApp(url, OPTS);
        assert.deepEqual(fs.readFileSync(stored), body, 'the next session stores the app again');
      });
    } finally {
      await remote.close();
    }
  });
});
