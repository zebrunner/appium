// The grid registration of the patched appium (build/lib/grid-register.js): every registerCycle the node asks the hub
// whether it is registered and registers again otherwise; the hub ends the active session of a node that registers
// again (PROXY_REREGISTRATION), so a slow or unavailable hub must keep the registration
import {test, describe, mock} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import {listen, sleep} from './common.mjs';

const require = createRequire(import.meta.url);
const registerNode = require(path.join(process.env.APPIUM_HOME, 'build/lib/grid-register.js')).default;

const CYCLE = 5000;

// until(condition): waits for the condition up to 5 s
async function until(condition) {
  for (let i = 0; i < 100 && !condition(); i++) {
    await sleep(50);
  }
  assert.ok(condition(), 'timed out');
}

describe('grid registration', () => {
  test('only the answer "not registered" of the hub registers the node again', async () => {
    // the answer of the hub to "is the node registered": an error, a slow answer, "no" or "yes"
    let answer = 'yes';
    const hub = await listen((req, res) => {
      if (req.url.startsWith('/grid/register')) {
        res.end('ok');
      } else if (answer === 'down') {
        req.socket.destroy();
      } else if (answer === 'error') {
        res.writeHead(500).end();
      } else {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({success: answer === 'yes', msg: 'Cannot find proxy with ID=http://node:4723 in the registry.'}));
      }
    });
    const registrations = () => hub.requests.filter((r) => r.url.startsWith('/grid/register')).length;
    const checks = () => hub.requests.filter((r) => r.url.startsWith('/grid/api/proxy')).length;
    // the next registration cycle: the check of the registration and the registration it decides
    const cycle = async () => {
      const before = checks();
      mock.timers.tick(CYCLE);
      await until(() => checks() > before);
      await sleep(500);
    };

    mock.timers.enable({apis: ['setInterval']});
    try {
      const {port, hostname} = new URL(hub.url);
      await registerNode(
        {capabilities: [{}], configuration: {hubHost: hostname, hubPort: Number(port), register: true, registerCycle: CYCLE}},
        'node',
        4723,
        '/wd/hub',
      );
      mock.timers.tick(CYCLE);
      await until(() => registrations() === 1);

      for (answer of ['down', 'error', 'yes']) {
        await cycle();
        assert.equal(registrations(), 1, `the hub answers "${answer}": the node keeps its registration`);
      }
      answer = 'no';
      await cycle();
      assert.equal(registrations(), 2, 'the hub does not know the node: it registers again');
    } finally {
      mock.timers.reset();
      await hub.close();
    }
  });
});
