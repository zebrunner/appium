// Shared helpers of the patch tests, run with `node --test` inside the image (tests/patch_test.sh)
import {createRequire} from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

export const BASE_DRIVER_DIR =
  process.env.BASE_DRIVER_DIR ?? '/usr/lib/node_modules/appium/node_modules/@appium/base-driver';
export const baseDriver = require(BASE_DRIVER_DIR);
export const helpers = require(path.join(BASE_DRIVER_DIR, 'build/lib/basedriver/helpers.js'));

export const tmpDir = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// withEnv(vars, fn): runs fn with the env vars set (undefined deletes), restores them afterwards
export async function withEnv(vars, fn) {
  const saved = {};
  for (const [key, value] of Object.entries(vars)) {
    saved[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

// listen(handler): an http server on a free local port, {url, requests, close}
export async function listen(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const request = {method: req.method, url: req.url, headers: req.headers, body};
      requests.push(request);
      handler(req, res, request);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

// request(url, {method, body}): {status, json}, without keep-alive so servers close promptly
export function request(url, {method = 'GET', body} = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const headers = payload === undefined ? {} : {'content-type': 'application/json', 'content-length': Buffer.byteLength(payload)};
    const req = http.request(url, {method, agent: false, headers}, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let json;
        try {
          json = JSON.parse(data);
        } catch {
          json = undefined;
        }
        resolve({status: res.statusCode, json, text: data});
      });
    });
    req.on('error', reject);
    if (payload !== undefined) {
      req.write(payload);
    }
    req.end();
  });
}

// startDriverServer(driver): the base-driver HTTP server (the same routes as Appium) for the driver
export async function startDriverServer(driver) {
  const server = await baseDriver.server({
    routeConfiguringFunction: baseDriver.routeConfiguringFunction(driver),
    port: 0,
    hostname: '127.0.0.1',
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => server.close(),
  };
}

export const W3C_CAPS = (caps = {}) => ({alwaysMatch: {platformName: 'Fake', ...caps}, firstMatch: [{}]});
