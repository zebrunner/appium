// The recording markers of the patched BaseDriver: ${LOG_DIR}/.recording-artifact-<id> drive the video
// recording of files/entrypoint.sh (created on new session, deleted on session end)
import {test, describe} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {baseDriver, sleep, tmpDir, withEnv, W3C_CAPS} from './common.mjs';

const {BaseDriver} = baseDriver;
const markers = (dir) => fs.readdirSync(dir).filter((f) => f.startsWith('.recording-artifact-'));

describe('recording markers', () => {
  test('a new session creates the marker named by its session id', async () => {
    const logDir = tmpDir('log');
    await withEnv({LOG_DIR: logDir, ROUTER_UUID: undefined}, async () => {
      const driver = new BaseDriver({});
      const [sessionId] = await driver.createSession(null, null, W3C_CAPS());
      assert.deepEqual(markers(logDir), [`.recording-artifact-${sessionId}`]);
      await driver.deleteSession(sessionId);
    });
  });

  // with ROUTER_UUID all sessions share one marker name: a late removal deletes the marker of the next session
  test('the session end removes the marker before the response', async () => {
    const logDir = tmpDir('log');
    await withEnv({LOG_DIR: logDir, ROUTER_UUID: undefined}, async () => {
      const driver = new BaseDriver({});
      const [sessionId] = await driver.createSession(null, null, W3C_CAPS());
      await driver.deleteSession(sessionId);
      assert.deepEqual(markers(logDir), []);
    });
  });

  test('the session id is exported as process.env.sessionId (used in error messages and .lock files)', async () => {
    const logDir = tmpDir('log');
    await withEnv({LOG_DIR: logDir, ROUTER_UUID: undefined}, async () => {
      const driver = new BaseDriver({});
      const [sessionId] = await driver.createSession(null, null, W3C_CAPS());
      assert.equal(process.env.sessionId, sessionId);
      await driver.deleteSession(sessionId);
    });
  });

  test('ROUTER_UUID names the marker instead of the session id', async () => {
    const logDir = tmpDir('log');
    await withEnv({LOG_DIR: logDir, ROUTER_UUID: 'router-1'}, async () => {
      const driver = new BaseDriver({});
      const [sessionId] = await driver.createSession(null, null, W3C_CAPS());
      assert.deepEqual(markers(logDir), ['.recording-artifact-router-1']);
      await driver.deleteSession(sessionId);
      // the timing of the removal is checked by 'the session end removes the marker before the response'
      await sleep(200);
      assert.deepEqual(markers(logDir), []);
    });
  });

  test('a blank ROUTER_UUID falls back to the session id', async () => {
    const logDir = tmpDir('log');
    await withEnv({LOG_DIR: logDir, ROUTER_UUID: '  '}, async () => {
      const driver = new BaseDriver({});
      const [sessionId] = await driver.createSession(null, null, W3C_CAPS());
      assert.deepEqual(markers(logDir), [`.recording-artifact-${sessionId}`]);
      await driver.deleteSession(sessionId);
    });
  });

  for (const value of [true, 'true']) {
    test(`appium:mcloudExternalRecording=${JSON.stringify(value)} skips the markers`, async () => {
      const logDir = tmpDir('log');
      const external = path.join(logDir, '.recording-artifact-external');
      fs.writeFileSync(external, '');
      await withEnv({LOG_DIR: logDir, ROUTER_UUID: undefined}, async () => {
        const driver = new BaseDriver({});
        const [sessionId] = await driver.createSession(null, null, W3C_CAPS({'appium:mcloudExternalRecording': value}));
        assert.deepEqual(markers(logDir), ['.recording-artifact-external']);
        await driver.deleteSession(sessionId);
        assert.deepEqual(markers(logDir), ['.recording-artifact-external'], 'the external marker is kept');
      });
    });
  }

  test('appium:mcloudExternalRecording=false keeps the markers', async () => {
    const logDir = tmpDir('log');
    await withEnv({LOG_DIR: logDir, ROUTER_UUID: undefined}, async () => {
      const driver = new BaseDriver({});
      const [sessionId] = await driver.createSession(null, null, W3C_CAPS({'appium:mcloudExternalRecording': false}));
      assert.deepEqual(markers(logDir), [`.recording-artifact-${sessionId}`]);
      await driver.deleteSession(sessionId);
    });
  });

  test('a missing LOG_DIR does not break the session', async () => {
    await withEnv({LOG_DIR: '/nonexistent/log', ROUTER_UUID: undefined}, async () => {
      const driver = new BaseDriver({});
      const [sessionId] = await driver.createSession(null, null, W3C_CAPS());
      assert.ok(sessionId);
      await driver.deleteSession(sessionId);
    });
  });
});
