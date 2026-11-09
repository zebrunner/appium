// The grid registration of the patched appium (build/lib/grid-register.js): every registerCycle the node asks the hub
// whether it is registered and registers again otherwise; the hub ends the active session of a node that registers
// again (PROXY_REREGISTRATION), so a slow or unavailable hub must keep the registration. A refused registration is
// logged with the reason of the hub and a hint, the same reason once in 10 minutes
import {test, describe, mock} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import {listen, sleep} from './common.mjs';

const require = createRequire(import.meta.url);
const gridRegister = require(path.join(process.env.APPIUM_HOME, 'build/lib/grid-register.js'));
const registerNode = gridRegister.default;
const {registrationFailureReason, registrationFailureHint} = gridRegister;
const logger = require(path.join(process.env.APPIUM_HOME, 'build/lib/logger.js')).default;

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

const HUB = 'http://hub:4444';
const NODE = 'http://10.255.255.1:7521';
const NODE_URL = `${NODE}/wd/hub`;
const TOKEN = `Node ${NODE} has no or another NODE_REGISTRATION_TOKEN than the hub, so it is not registered.`;
const NOT_REACHABLE =
  `Node ${NODE} is not reachable from the hub (SocketTimeoutException: connect timed out), so it is not registered. ` +
  'Check the address the node registers with: it must be accessible from the hub.';
const NOT_ALLOWED = `Node ${NODE} is not in NODE_ALLOWED_NETWORKS (10.0.0.0/8, 192.168.0.0/16), so it is not registered.`;
const NO_UDID = "Appium node must have 'UDID' capability. Check the node config.";
const NO_SLOT = 'Node should have slot';

const escapeHtml = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// jettyPage(message, {title}): the error page of Jetty (mcloud-grid) for an exception of the proxy constructor
function jettyPage(message, {title = true} = {}) {
  const text = escapeHtml(message);
  return (
    '<html>\n<head>\n<meta http-equiv="Content-Type" content="text/html;charset=ISO-8859-1"/>\n' +
    (title ? `<title>Error 500 ${text}</title>\n` : '') +
    `</head>\n<body><h2>HTTP ERROR 500 ${text}</h2>\n<table>\n<tr><th>URI:</th><td>/grid/register</td></tr>\n` +
    `<tr><th>STATUS:</th><td>500</td></tr>\n<tr><th>MESSAGE:</th><td>${text}</td></tr>\n` +
    '<tr><th>SERVLET:</th><td>org.openqa.grid.web.servlet.RegistrationServlet-1d2adfbe</td></tr>\n' +
    `<tr><th>CAUSED BY:</th><td>${text}</td></tr>\n</table>\n<h3>Caused by:</h3><pre>${text}\n` +
    '\tat com.zebrunner.mcloud.grid.MobileRemoteProxy.&lt;init&gt;(MobileRemoteProxy.java:93)\n</pre>\n' +
    '<hr><a href="https://eclipse.org/jetty">Powered by Jetty:// 9.4.z-SNAPSHOT</a><hr/>\n\n</body>\n</html>\n'
  );
}

// a failed request of axios with the response of the hub
const httpError = (data, status = 500) => ({message: `Request failed with status code ${status}`, response: {status, data}});

describe('the reason of a refused grid registration', () => {
  const reasons = [
    ['java.security.InvalidParameterException', `Error: ${TOKEN}`, TOKEN, /^NODE_REGISTRATION_TOKEN of this container/],
    [
      'java.security.InvalidParameterException',
      `Error: ${NOT_REACHABLE}`,
      NOT_REACHABLE,
      /^The hub connects back to the node url/,
    ],
    [
      'org.openqa.grid.common.exception.GridException',
      `Error: ${NOT_ALLOWED}`,
      NOT_ALLOWED,
      /^Add the network of STF_PROVIDER_HOST/,
    ],
    ['java.lang.RuntimeException', NO_UDID, NO_UDID, /^$/],
    ['java.lang.IllegalStateException', NO_SLOT, NO_SLOT, /^$/],
  ];
  for (const [exception, message, reason, hint] of reasons) {
    test(`the Jetty error page of "${reason.slice(0, 50)}..."`, () => {
      const actual = registrationFailureReason(httpError(jettyPage(`${exception}: ${message}`)), HUB);
      assert.equal(actual, `HTTP 500: ${reason}`);
      assert.match(registrationFailureHint(actual, NODE_URL), hint);
    });
  }

  test('the hint of a node not reachable from the hub names the node url', () => {
    const hint = registrationFailureHint(`HTTP 500: ${NOT_REACHABLE}`, NODE_URL);
    assert.match(hint, new RegExp(`node url ${NODE_URL}: STF_PROVIDER_HOST must be an address of this host`));
    assert.match(hint, /the appium port must be published$/);
  });

  test('an error page without a title: the MESSAGE row', () => {
    const page = jettyPage(`java.security.InvalidParameterException: Error: ${TOKEN}`, {title: false});
    assert.equal(registrationFailureReason(httpError(page), HUB), `HTTP 500: ${TOKEN}`);
  });

  test('the HTML entities are decoded', () => {
    const page =
      '<html><head><title>Error 500 a &quot;b&quot; &amp; &lt;c&gt; &#39;d&#39; &#x27;e&#x27; &copy;</title></head></html>';
    assert.equal(registrationFailureReason(httpError(page), HUB), "HTTP 500: a \"b\" & <c> 'd' 'e' &copy;");
  });

  test('a plain text body', () => {
    const body = 'org.openqa.grid.common.exception.GridException:  Error:\n  the hub is shutting down\n';
    assert.equal(registrationFailureReason(httpError(body, 503), HUB), 'HTTP 503: the hub is shutting down');
  });

  test('a JSON body: its message', () => {
    assert.equal(registrationFailureReason(httpError({message: 'no slots'}), HUB), 'HTTP 500: no slots');
    assert.equal(
      registrationFailureReason(httpError({status: 13, value: {message: 'java.lang.RuntimeException: boom'}}), HUB),
      'HTTP 500: boom',
    );
    assert.equal(registrationFailureReason(httpError({success: false}, 400), HUB), 'HTTP 400: {"success":false}');
  });

  test('an empty body: the status text', () => {
    const err = {message: 'Request failed with status code 502', response: {status: 502, statusText: 'Bad Gateway', data: ''}};
    assert.equal(registrationFailureReason(err, HUB), 'HTTP 502: Bad Gateway');
  });

  test('a long reason is cut', () => {
    const reason = registrationFailureReason(httpError(`Error: ${'x'.repeat(1000)}`), HUB);
    assert.equal(reason, `HTTP 500: ${'x'.repeat(397)}...`);
  });

  test('no answer of the hub: the network error and the hint to check the hub address', () => {
    const refused = {code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 10.0.0.2:4444'};
    const reason = registrationFailureReason(refused, HUB);
    assert.equal(reason, `the hub ${HUB} is not reachable: connect ECONNREFUSED 10.0.0.2:4444`);
    assert.equal(registrationFailureHint(reason, NODE_URL), 'Check SELENIUM_HOST and SELENIUM_PORT and the network to the hub');
    assert.equal(
      registrationFailureReason({code: 'ETIMEDOUT', message: 'socket hang up'}, HUB),
      `the hub ${HUB} is not reachable: ETIMEDOUT socket hang up`,
    );
    // the AggregateError of a host with several addresses has no message
    const aggregate = {
      code: 'ECONNREFUSED',
      message: '',
      errors: [{message: 'connect ECONNREFUSED ::1:4444'}, {message: 'connect ECONNREFUSED 127.0.0.1:4444'}],
    };
    assert.equal(
      registrationFailureReason(aggregate, HUB),
      `the hub ${HUB} is not reachable: connect ECONNREFUSED ::1:4444, connect ECONNREFUSED 127.0.0.1:4444`,
    );
  });
});

describe('the log of a refused grid registration', () => {
  // the messages of the logger by level
  function captureLog(t) {
    const messages = {error: [], warn: [], info: [], debug: []};
    for (const level of Object.keys(messages)) {
      t.mock.method(logger, level, (message) => messages[level].push(message));
    }
    return messages;
  }

  test('the reason and the hint of the hub, the same reason once in 10 minutes', async (t) => {
    const LONG_CYCLE = 4 * 60 * 1000;
    let refusal = NOT_REACHABLE;
    const hub = await listen((req, res) => {
      if (!req.url.startsWith('/grid/register')) {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({success: false, msg: 'Cannot find proxy with ID=http://10.255.255.1:7521 in the registry.'}));
      } else if (refusal) {
        res.writeHead(500, {'content-type': 'text/html;charset=iso-8859-1'});
        res.end(jettyPage(`java.security.InvalidParameterException: Error: ${refusal}`));
      } else {
        res.end('ok');
      }
    });
    const log = captureLog(t);
    const attempts = () => hub.requests.filter((r) => r.url.startsWith('/grid/register')).length;
    const cycle = async () => {
      const before = attempts();
      const logged = log.error.length + log.debug.length + log.info.length;
      mock.timers.tick(LONG_CYCLE);
      await until(() => attempts() > before && log.error.length + log.debug.length + log.info.length > logged);
    };
    const {port, hostname} = new URL(hub.url);
    const uri = `http://${hostname}:${port}`;
    const refused = (reason, hint) => `An attempt to register with the grid ${uri} was unsuccessful: HTTP 500: ${reason} ${hint}`;
    const notReachableHint =
      `The hub connects back to the node url ${NODE_URL}: STF_PROVIDER_HOST must be an address of this host that the hub ` +
      'can reach (in a LAN the LAN address: the public IP often fails without NAT hairpin); the appium port must be published.';

    mock.timers.enable({apis: ['setInterval', 'Date'], now: 0});
    try {
      await registerNode(
        {
          capabilities: [{}],
          configuration: {
            url: NODE_URL,
            host: '10.255.255.1',
            port: 7521,
            hubHost: hostname,
            hubPort: Number(port),
            register: true,
            registerCycle: LONG_CYCLE,
          },
        },
        'node',
        4723,
        '/wd/hub',
      );
      await cycle();
      assert.deepEqual(log.error, [refused(NOT_REACHABLE, notReachableHint)]);

      // 4 and 8 minutes later: the same reason at debug level only
      await cycle();
      await cycle();
      assert.equal(log.error.length, 1, 'the same reason is not logged as an error again within 10 minutes');
      assert.equal(
        log.debug.filter((m) => m.includes(`register with the grid ${uri} was unsuccessful again: HTTP 500: Node`)).length,
        2,
      );
      assert.equal(log.warn.length, 0, 'no warning of the not registered node while the registration fails');

      // 12 minutes later: the same reason again, with the attempts failed meanwhile
      await cycle();
      assert.equal(log.error.length, 2);
      assert.equal(
        log.error[1],
        `${refused(NOT_REACHABLE, notReachableHint)} 2 more attempts failed the same way since the last message.`,
      );

      // another reason: logged at once
      refusal = TOKEN;
      await cycle();
      assert.equal(log.error.length, 3);
      assert.equal(
        log.error[2],
        refused(TOKEN, 'NODE_REGISTRATION_TOKEN of this container must be the one of mcloud-grid (variables.env of mcloud).'),
      );

      refusal = '';
      await cycle();
      assert.deepEqual(log.info, [`Appium is registered with the grid ${uri} after 5 failed attempts`]);
      assert.equal(log.error.length, 3);
    } finally {
      mock.timers.reset();
      await hub.close();
    }
  });

  test('a hub that does not answer: its address and the hint to check it', async (t) => {
    // a free local port without a server
    const closed = await listen(() => {});
    await closed.close();
    const {port, hostname} = new URL(closed.url);
    const log = captureLog(t);

    mock.timers.enable({apis: ['setInterval']});
    try {
      await registerNode(
        {capabilities: [{}], configuration: {hubHost: hostname, hubPort: Number(port), register: true, registerCycle: CYCLE}},
        'node',
        4723,
        '/wd/hub',
      );
      mock.timers.tick(CYCLE);
      await until(() => log.error.length === 1);
      const hub = `http://${hostname}:${port}`;
      assert.equal(
        log.error[0],
        `An attempt to register with the grid ${hub} was unsuccessful: the hub ${hub} is not reachable: ` +
          `connect ECONNREFUSED ${hostname}:${port}. Check SELENIUM_HOST and SELENIUM_PORT and the network to the hub.`,
      );
    } finally {
      mock.timers.reset();
    }
  });
});
