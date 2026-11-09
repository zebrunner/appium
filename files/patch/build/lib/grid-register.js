"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registrationFailureReason = registrationFailureReason;
exports.registrationFailureHint = registrationFailureHint;
const axios_1 = __importDefault(require("axios"));
const support_1 = require("@appium/support");
const logger_1 = __importDefault(require("./logger"));
const lodash_1 = __importDefault(require("lodash"));
const hubUri = (config) => {
    const protocol = config.hubProtocol || 'http';
    return `${protocol}://${config.hubHost}:${config.hubPort}`;
};
/**
 * Registers a new node with a selenium grid
 * @param {string|object} data - Path or object representing selenium grid node config file. If a `string`, all subsequent arguments are required!
 * @param {string} [addr] - Bind to this address
 * @param {number} [port] - Bind to this port
 * @param {string} [basePath] - Base path for the grid
 */
async function registerNode(data, addr, port, basePath) {
    let configFilePath;
    if (lodash_1.default.isString(data)) {
        configFilePath = data;
        try {
            data = await support_1.fs.readFile(data, 'utf-8');
        }
        catch (err) {
            logger_1.default.error(`Unable to load node configuration file ${configFilePath} to register with grid: ${err.message}`);
            return;
        }
        try {
            data = JSON.parse(data);
        }
        catch (err) {
            throw logger_1.default.errorWithException(`Syntax error in node configuration file ${configFilePath}: ${err.message}`);
        }
    }
    postRequest(data, addr, port, basePath);
}
// Fork (Zebrunner): the hub (mcloud-grid) refuses a node by an HTTP 500 error page of Jetty with the reason in its
// title; the reason and a hint what to check are logged instead of "Request failed with status code 500"
const REASON_MAX_LENGTH = 400;
// the registration is retried every registerCycle: the same reason is logged as an error once in this time
const REPEATED_FAILURE_LOG_INTERVAL_MS = 10 * 60 * 1000;
const HTML_ENTITIES = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", nbsp: ' ' };
/**
 * @param {string} text
 * @returns {string}
 */
function decodeHtmlEntities(text) {
    return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (entity, name) => {
        if (name[0] !== '#') {
            return HTML_ENTITIES[name.toLowerCase()] ?? entity;
        }
        const code = /^#x/i.test(name) ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    });
}
/**
 * @param {any} data - the response body parsed by axios
 * @returns {string}
 */
function responseBodyText(data) {
    if (Buffer.isBuffer(data)) {
        return data.toString();
    }
    if (data && typeof data === 'object') {
        const message = data.message ?? data.value?.message ?? data.msg;
        return lodash_1.default.isString(message) ? message : JSON.stringify(data);
    }
    return lodash_1.default.isNil(data) ? '' : String(data);
}
/**
 * @param {string} html - an error page, e.g. the one of Jetty: <title>Error 500 {message}</title>
 * @returns {string}
 */
function htmlErrorText(html) {
    const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) ??
        /<th>\s*MESSAGE:\s*<\/th>\s*<td>([\s\S]*?)<\/td>/i.exec(html);
    const text = match ? match[1] : html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
    return text.replace(/<[^>]*>/g, ' ');
}
/**
 * The reason of a failed registration request
 * @param {any} err - the error of axios
 * @param {string} uri - the hub
 * @returns {string} e.g. "HTTP 500: Node http://... is not reachable from the hub (...), so it is not registered. ..."
 */
function registrationFailureReason(err, uri) {
    const response = err?.response;
    if (!response) {
        // a refused connection to a host with several addresses is an AggregateError without a message
        const message = err?.message || lodash_1.default.map(err?.errors, 'message').join(', ') || String(err);
        if (!err?.code) {
            return message;
        }
        return `the hub ${uri} is not reachable: ${message.includes(err.code) ? message : `${err.code} ${message}`}`;
    }
    let text = responseBodyText(response.data);
    if (/<(html|head|title|body)[\s>]/i.test(text)) {
        text = htmlErrorText(text);
    }
    text = decodeHtmlEntities(text)
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^(HTTP )?Error \d{3}:? /i, '');
    let previous;
    do {
        previous = text;
        text = text.replace(/^[\w.$]+Exception: /, '').replace(/^Error: /, '');
    } while (text !== previous);
    if (text.length > REASON_MAX_LENGTH) {
        text = `${text.slice(0, REASON_MAX_LENGTH - 3)}...`;
    }
    return `HTTP ${response.status}: ${text || response.statusText || 'no reason given'}`;
}
/**
 * What to check for a reason of registrationFailureReason
 * @param {string} reason
 * @param {string} nodeUrl - the url the node registers with
 * @returns {string} the hint or an empty string
 */
function registrationFailureHint(reason, nodeUrl) {
    if (reason.startsWith('the hub ')) {
        return 'Check SELENIUM_HOST and SELENIUM_PORT and the network to the hub';
    }
    if (reason.includes('is not reachable from the hub')) {
        return (`The hub connects back to the node url ${nodeUrl}: STF_PROVIDER_HOST must be an address of this host ` +
            `that the hub can reach (in a LAN the LAN address: the public IP often fails without NAT hairpin); ` +
            `the appium port must be published`);
    }
    if (reason.includes('NODE_REGISTRATION_TOKEN')) {
        return 'NODE_REGISTRATION_TOKEN of this container must be the one of mcloud-grid (variables.env of mcloud)';
    }
    if (reason.includes('NODE_ALLOWED_NETWORKS')) {
        return 'Add the network of STF_PROVIDER_HOST to NODE_ALLOWED_NETWORKS of mcloud-grid';
    }
    return '';
}
/**
 * @param {string} text
 * @returns {string} the text ending with a period
 */
const sentence = (text) => (/[.!?]$/.test(text) ? text : `${text}.`);
/**
 * @typedef RegistrationFailures
 * @property {number} attempts - the failed attempts since the last registration
 * @property {number} suppressed - the failed attempts logged at debug level since the last error
 * @property {string} [reason] - the reason of the last logged error
 * @property {number} loggedAt - the time of the last logged error
 */
/**
 * @returns {RegistrationFailures}
 */
const noRegistrationFailures = () => ({ attempts: 0, suppressed: 0, reason: undefined, loggedAt: 0 });
/**
 * @param {RegistrationFailures} failures
 * @param {string} uri
 * @param {string} reason
 * @param {string} hint
 */
function logRegistrationFailure(failures, uri, reason, hint) {
    const now = Date.now();
    failures.attempts++;
    const repeated = reason === failures.reason;
    if (repeated && now - failures.loggedAt < REPEATED_FAILURE_LOG_INTERVAL_MS) {
        failures.suppressed++;
        logger_1.default.debug(`An attempt to register with the grid ${uri} was unsuccessful again: ${reason}`);
        return;
    }
    const suppressed = failures.suppressed;
    const meanwhile = repeated && suppressed > 0
        ? ` ${suppressed} more attempt${suppressed === 1 ? '' : 's'} failed the same way since the last message.`
        : '';
    logger_1.default.error(`An attempt to register with the grid ${uri} was unsuccessful: ${sentence(reason)}` +
        (hint ? ` ${sentence(hint)}` : '') +
        meanwhile);
    Object.assign(failures, { suppressed: 0, reason, loggedAt: now });
}
/**
 * @param {any} postOptions
 * @param {any} configHolder
 * @param {RegistrationFailures} failures
 */
async function registerToGrid(postOptions, configHolder, failures) {
    const uri = hubUri(configHolder.configuration);
    try {
        const response = await (0, axios_1.default)(postOptions);
        if (response.status !== 200) {
            throw Object.assign(new Error(`Request failed with code ${response.status}`), { response });
        }
        if (failures.attempts > 0) {
            const attempts = failures.attempts;
            logger_1.default.info(`Appium is registered with the grid ${uri} after ${attempts} failed attempt${attempts === 1 ? '' : 's'}`);
        }
        else {
            logger_1.default.debug(`Appium successfully registered with the the grid on ` + uri);
        }
        Object.assign(failures, noRegistrationFailures());
    }
    catch (err) {
        const reason = registrationFailureReason(err, uri);
        logRegistrationFailure(failures, uri, reason, registrationFailureHint(reason, configHolder.configuration.url));
    }
}
function postRequest(configHolder, addr, port, basePath) {
    // Move Selenium 3 configuration properties to configuration object
    if (!lodash_1.default.has(configHolder, 'configuration')) {
        let configuration = {};
        for (const property in /** @type {import('@appium/types').StringRecord} */ (configHolder)) {
            if (lodash_1.default.has(configHolder, property) && property !== 'capabilities') {
                configuration[property] = configHolder[property];
                delete configHolder[property];
            }
        }
        /** @type {import('@appium/types').StringRecord} */ (configHolder).configuration = configuration;
    }
    // if the node config does not have the appium/webdriver url, host, and port,
    // automatically add it based on how appium was initialized
    // otherwise, we will take whatever the user setup
    // because we will always set localhost/127.0.0.1. this won't work if your
    // node and grid aren't in the same place
    if (!configHolder.configuration.url ||
        !configHolder.configuration.host ||
        !configHolder.configuration.port) {
        configHolder.configuration.url = `http://${addr}:${port}${basePath}`;
        configHolder.configuration.host = addr;
        configHolder.configuration.port = port;
    }
    // if the node config does not have id automatically add it
    if (!configHolder.configuration.id) {
        configHolder.configuration.id = `http://${configHolder.configuration.host}:${configHolder.configuration.port}`;
    }
    // the post options
    const regRequest = {
        url: `${hubUri(configHolder.configuration)}/grid/register`,
        method: 'POST',
        data: configHolder,
    };
    if (configHolder.configuration.register !== true) {
        logger_1.default.debug(`No registration sent (${configHolder.configuration.register} = false)`);
        return;
    }
    const registerCycleInterval = configHolder.configuration.registerCycle;
    if (isNaN(registerCycleInterval) || registerCycleInterval <= 0) {
        logger_1.default.warn(`'registerCycle' is not a valid positive number. ` +
            `No registration request will be sent to the grid.`);
        return;
    }
    // initiate a new Thread
    let first = true;
    const failures = noRegistrationFailures();
    logger_1.default.debug(`Starting auto register thread for the grid. ` +
        `Will try to register every ${registerCycleInterval} ms.`);
    setInterval(async function registerRetry() {
        if (first) {
            first = false;
            await registerToGrid(regRequest, configHolder, failures);
        }
        else if (!(await isAlreadyRegistered(configHolder, failures))) {
            // make the http POST to the grid for registration
            await registerToGrid(regRequest, configHolder, failures);
        }
    }, registerCycleInterval);
}
/**
 * @param {any} configHolder
 * @param {RegistrationFailures} failures
 */
async function isAlreadyRegistered(configHolder, failures) {
    //check if node is already registered
    const id = configHolder.configuration.id;
    try {
        const { data, status } = await (0, axios_1.default)({
            url: `${hubUri(configHolder.configuration)}/grid/api/proxy?id=${id}`,
            timeout: 10000,
        });
        if (status !== 200) {
            throw new Error(`Request failed with code ${status}`);
        }
        if (!data.success) {
            // a refused registration is logged by registerToGrid, once in a while for the same reason
            const log = failures.attempts > 0 ? logger_1.default.debug.bind(logger_1.default) : logger_1.default.warn.bind(logger_1.default);
            log(`[MCLOUD] Node is not registered on the hub, registering again: ${data.msg}`);
        }
        return data.success;
    }
    catch (err) {
        // Fork (Zebrunner): the hub ends the active session of a node that registers again (PROXY_REREGISTRATION), so a
        // slow or unavailable hub keeps the registration; only the explicit answer "not registered" registers the node again
        logger_1.default.warn(`[MCLOUD] Hub down or not responding, registration is kept: ${err.message}`);
        return true;
    }
}
exports.default = registerNode;
//# sourceMappingURL=grid-register.js.map