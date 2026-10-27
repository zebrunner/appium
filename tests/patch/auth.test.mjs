// The node token of mcloud-grid (NODE_REGISTRATION_TOKEN): with it, Appium answers only the requests with the token in
// X-MCloud-Node-Token and the ones of its own container
import {test, describe, before, after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {BASE_DRIVER_DIR, baseDriver, withEnv} from './common.mjs';

const {isNodeRequestAuthorized, NODE_TOKEN_HEADER} = createRequire(import.meta.url)(
  path.join(BASE_DRIVER_DIR, 'build/lib/express/mcloud-auth.js')
);
const {WebSocketServer} = createRequire(path.join(BASE_DRIVER_DIR, 'package.json'))('ws');
const fakeRequest = (remoteAddress, headers = {}) => ({socket: {remoteAddress}, headers});

// an address of the container other than the loopback one: the requests from it are not the container itself
const externalAddress = Object.values(os.networkInterfaces())
  .flat()
  .find((address) => address && address.family === 'IPv4' && !address.internal)?.address;

// send(url, headers): the status code of GET url, 'refused' when the server drops the connection
function send(url, headers = {}) {
  return new Promise((resolve) => {
    const req = http.get(url, {agent: false, headers}, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('upgrade', (res, socket) => {
      socket.destroy();
      resolve(res.statusCode);
    });
    req.on('error', () => resolve('refused'));
  });
}

describe('node token of mcloud-grid', () => {
  test('without NODE_REGISTRATION_TOKEN any request is answered', () =>
    withEnv({NODE_REGISTRATION_TOKEN: undefined}, () => {
      assert.equal(isNodeRequestAuthorized(fakeRequest('10.0.0.9')), true);
    }));

  test('with NODE_REGISTRATION_TOKEN the token of the header is checked', () =>
    withEnv({NODE_REGISTRATION_TOKEN: 's3cret'}, () => {
      assert.equal(NODE_TOKEN_HEADER, 'x-mcloud-node-token');
      assert.equal(isNodeRequestAuthorized(fakeRequest('10.0.0.9')), false);
      assert.equal(isNodeRequestAuthorized(fakeRequest('10.0.0.9', {[NODE_TOKEN_HEADER]: 'wrong'})), false);
      assert.equal(isNodeRequestAuthorized(fakeRequest('10.0.0.9', {[NODE_TOKEN_HEADER]: 's3cret2'})), false);
      assert.equal(isNodeRequestAuthorized(fakeRequest('10.0.0.9', {[NODE_TOKEN_HEADER]: ['s3cret', 's3cret']})), false);
      assert.equal(isNodeRequestAuthorized(fakeRequest('10.0.0.9', {[NODE_TOKEN_HEADER]: 's3cret'})), true);
      assert.equal(isNodeRequestAuthorized(fakeRequest(undefined)), false);
    }));

  test('the container itself (the healthcheck) needs no token', () =>
    withEnv({NODE_REGISTRATION_TOKEN: 's3cret'}, () => {
      for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
        assert.equal(isNodeRequestAuthorized(fakeRequest(address)), true, address);
      }
    }));

  describe('the server', {skip: externalAddress ? false : 'the container has no address but the loopback one'}, () => {
    let server;
    let port;
    before(async () => {
      server = await baseDriver.server({
        routeConfiguringFunction: baseDriver.routeConfiguringFunction(new baseDriver.BaseDriver({})),
        port: 0,
        hostname: '0.0.0.0',
      });
      port = server.address().port;
      // a WebSocket of a session, e.g. the logcat broadcast
      await server.addWebSocketHandler('/ws/test', new WebSocketServer({noServer: true}));
    });
    after(() => server.close());

    test('answers the requests with the token and the ones of the container', () =>
      withEnv({NODE_REGISTRATION_TOKEN: 's3cret'}, async () => {
        assert.equal(await send(`http://${externalAddress}:${port}/status`), 401);
        assert.equal(await send(`http://${externalAddress}:${port}/status`, {'X-MCloud-Node-Token': 'wrong'}), 401);
        assert.equal(await send(`http://${externalAddress}:${port}/status`, {'X-MCloud-Node-Token': 's3cret'}), 200);
        assert.equal(await send(`http://127.0.0.1:${port}/status`), 200);
      }));

    test('opens a WebSocket with the token only', () =>
      withEnv({NODE_REGISTRATION_TOKEN: 's3cret'}, async () => {
        const upgrade = {Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ=='};
        assert.notEqual(await send(`http://${externalAddress}:${port}/ws/test`, upgrade), 101);
        assert.equal(await send(`http://${externalAddress}:${port}/ws/test`, {...upgrade, 'X-MCloud-Node-Token': 's3cret'}), 101);
      }));

    test('answers anyone without NODE_REGISTRATION_TOKEN', () =>
      withEnv({NODE_REGISTRATION_TOKEN: undefined}, async () => {
        assert.equal(await send(`http://${externalAddress}:${port}/status`), 200);
      }));
  });
});
