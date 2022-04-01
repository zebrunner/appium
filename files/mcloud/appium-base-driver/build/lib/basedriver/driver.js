"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault");

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.BaseDriver = void 0;

require("source-map-support/register");

var _protocol = require("../protocol");

var _constants = require("../constants");

var _os = _interopRequireDefault(require("os"));

var _commands = _interopRequireDefault(require("./commands"));

var helpers = _interopRequireWildcard(require("./helpers"));

var _logger = _interopRequireDefault(require("./logger"));

var _deviceSettings = _interopRequireDefault(require("./device-settings"));

var _desiredCaps = require("./desired-caps");

var _capabilities = require("./capabilities");

var _bluebird = _interopRequireDefault(require("bluebird"));

var _lodash = _interopRequireDefault(require("lodash"));

var _imageElement = require("./image-element");

var _asyncLock = _interopRequireDefault(require("async-lock"));

var _events = require("events");

var _mcloudUtils = require("./mcloud-utils");

var _appiumSupport = require("appium-support");

function _getRequireWildcardCache(nodeInterop) { if (typeof WeakMap !== "function") return null; var cacheBabelInterop = new WeakMap(); var cacheNodeInterop = new WeakMap(); return (_getRequireWildcardCache = function (nodeInterop) { return nodeInterop ? cacheNodeInterop : cacheBabelInterop; })(nodeInterop); }

function _interopRequireWildcard(obj, nodeInterop) { if (!nodeInterop && obj && obj.__esModule) { return obj; } if (obj === null || typeof obj !== "object" && typeof obj !== "function") { return { default: obj }; } var cache = _getRequireWildcardCache(nodeInterop); if (cache && cache.has(obj)) { return cache.get(obj); } var newObj = {}; var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var key in obj) { if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) { var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null; if (desc && (desc.get || desc.set)) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = obj[key]; } } } newObj.default = obj; if (cache) { cache.set(obj, newObj); } return newObj; }

_bluebird.default.config({
  cancellation: true
});

const NEW_COMMAND_TIMEOUT_MS = 60 * 1000;
const EVENT_SESSION_INIT = 'newSessionRequested';
const EVENT_SESSION_START = 'newSessionStarted';
const EVENT_SESSION_QUIT_START = 'quitSessionRequested';
const EVENT_SESSION_QUIT_DONE = 'quitSessionFinished';
const ON_UNEXPECTED_SHUTDOWN_EVENT = 'onUnexpectedShutdown';

class BaseDriver extends _protocol.Protocol {
  constructor(opts = {}, shouldValidateCaps = true) {
    super();
    this.sessionId = null;
    this.opts = opts;
    this.caps = null;
    this.helpers = helpers;
    this.basePath = _constants.DEFAULT_BASE_PATH;
    this.relaxedSecurityEnabled = false;
    this.allowInsecure = [];
    this.denyInsecure = [];
    this.newCommandTimeoutMs = NEW_COMMAND_TIMEOUT_MS;
    this.implicitWaitMs = 0;
    this._constraints = _lodash.default.cloneDeep(_desiredCaps.desiredCapabilityConstraints);
    this.locatorStrategies = [];
    this.webLocatorStrategies = [];
    this.opts.tmpDir = this.opts.tmpDir || process.env.APPIUM_TMP_DIR || _os.default.tmpdir();
    this.shutdownUnexpectedly = false;
    this.noCommandTimer = null;
    this.shouldValidateCaps = shouldValidateCaps;
    this.commandsQueueGuard = new _asyncLock.default();
    this.settings = new _deviceSettings.default({}, _lodash.default.noop);
    this.initialOpts = _lodash.default.cloneDeep(this.opts);
    this.managedDrivers = [];
    this._eventHistory = {
      commands: []
    };
    this._imgElCache = (0, _imageElement.makeImageElementCache)();
    this.eventEmitter = new _events.EventEmitter();
    this.protocol = null;
  }

  onUnexpectedShutdown(handler) {
    this.eventEmitter.on(ON_UNEXPECTED_SHUTDOWN_EVENT, handler);
  }

  get driverData() {
    return {};
  }

  get isCommandsQueueEnabled() {
    return true;
  }

  get eventHistory() {
    return _lodash.default.cloneDeep(this._eventHistory);
  }

  logEvent(eventName) {
    if (eventName === 'commands') {
      throw new Error('Cannot log commands directly');
    }

    if (typeof eventName !== 'string') {
      throw new Error(`Invalid eventName ${eventName}`);
    }

    if (!this._eventHistory[eventName]) {
      this._eventHistory[eventName] = [];
    }

    const ts = Date.now();
    const logTime = new Date(ts).toTimeString();

    this._eventHistory[eventName].push(ts);

    _logger.default.debug(`Event '${eventName}' logged at ${ts} (${logTime})`);
  }

  async getStatus() {
    return {};
  }

  async getStatusWDA() {
    const wdaURL = await (0, _mcloudUtils.parseWDAUrl)();

    if (!wdaURL) {
      return {
        "status": "error",
        "details": "Environment variable WDA_ENV is undefined"
      };
    }

    const status = await (0, _mcloudUtils.getWDAStatus)(wdaURL);

    if (!status) {
      return {
        "status": "error",
        "details": "Error for sending of WDA status http call. See appium logs for details"
      };
    }

    return {
      "status": "success",
      "details": status
    };
  }

  async getStatusADB() {
    const deviceUDID = process.env.DEVICE_UDID;

    if (deviceUDID) {
      const adbDevicesCmd = 'adb devices | grep $DEVICE_UDID | grep "device"';

      try {
        await (0, _mcloudUtils.executeShellWPromise)(adbDevicesCmd);
        return {
          "status": "success",
          "details": `Connected device with UDID ${deviceUDID} is ready for execution`
        };
      } catch (error) {
        return {
          "status": "error",
          "details": `Connected device with UDID ${deviceUDID} is NOT ready for execution. Device was not returned by adb`
        };
      }
    } else {
      const deviceName = process.env.ANDROID_DEVICES;

      if (!deviceName) {
        return {
          "status": "error",
          "details": `Neither DEVICE_UDID nor ANDROID_DEVICES environment variables were found.`
        };
      }

      const adbDevicesCmd = 'adb devices | grep $ANDROID_DEVICES | grep "device"';

      try {
        await (0, _mcloudUtils.executeShellWPromise)(adbDevicesCmd);
        return {
          "status": "success",
          "details": `Connected device with name ${deviceName} is ready for execution`
        };
      } catch (error) {
        return {
          "status": "error",
          "details": `Connected device with name ${deviceUDID} is NOT ready for execution. Device was not returned by adb`
        };
      }
    }
  }

  set desiredCapConstraints(constraints) {
    this._constraints = Object.assign(this._constraints, constraints);

    for (const [, value] of _lodash.default.toPairs(this._constraints)) {
      if (value && value.presence === true) {
        value.presence = {
          allowEmpty: false
        };
      }
    }
  }

  get desiredCapConstraints() {
    return this._constraints;
  }

  sessionExists(sessionId) {
    if (!sessionId) return false;
    return sessionId === this.sessionId;
  }

  driverForSession() {
    return this;
  }

  logExtraCaps(caps) {
    let extraCaps = _lodash.default.difference(_lodash.default.keys(caps), _lodash.default.keys(this._constraints));

    if (extraCaps.length) {
      _logger.default.warn(`The following capabilities were provided, but are not ` + `recognized by Appium:`);

      for (const cap of extraCaps) {
        _logger.default.warn(`  ${cap}`);
      }
    }
  }

  validateDesiredCaps(caps) {
    if (!this.shouldValidateCaps) {
      return true;
    }

    try {
      (0, _capabilities.validateCaps)(caps, this._constraints);
    } catch (e) {
      _logger.default.errorAndThrow(new _protocol.errors.SessionNotCreatedError(`The desiredCapabilities object was not valid for the ` + `following reason(s): ${e.message}`));
    }

    this.logExtraCaps(caps);
    return true;
  }

  isMjsonwpProtocol() {
    return this.protocol === _constants.PROTOCOLS.MJSONWP;
  }

  isW3CProtocol() {
    return this.protocol === _constants.PROTOCOLS.W3C;
  }

  setProtocolMJSONWP() {
    this.protocol = _constants.PROTOCOLS.MJSONWP;
  }

  setProtocolW3C() {
    this.protocol = _constants.PROTOCOLS.W3C;
  }

  isFeatureEnabled(name) {
    if (this.denyInsecure && _lodash.default.includes(this.denyInsecure, name)) {
      return false;
    }

    if (this.allowInsecure && _lodash.default.includes(this.allowInsecure, name)) {
      return true;
    }

    if (this.relaxedSecurityEnabled) {
      return true;
    }

    return false;
  }

  ensureFeatureEnabled(name) {
    if (!this.isFeatureEnabled(name)) {
      throw new Error(`Potentially insecure feature '${name}' has not been ` + `enabled. If you want to enable this feature and accept ` + `the security ramifications, please do so by following ` + `the documented instructions at https://github.com/appium` + `/appium/blob/master/docs/en/writing-running-appium/security.md`);
    }
  }

  async executeCommand(cmd, ...args) {
    let startTime = Date.now();

    if (cmd === 'createSession') {
      this.protocol = (0, _protocol.determineProtocol)(...args);
      this.logEvent(EVENT_SESSION_INIT);
    } else if (cmd === 'deleteSession') {
      this.logEvent(EVENT_SESSION_QUIT_START);
    }

    this.clearNewCommandTimeout();

    if (this.shutdownUnexpectedly) {
      throw new _protocol.errors.NoSuchDriverError('The driver was unexpectedly shut down!');
    }

    const imgElId = (0, _imageElement.getImgElFromArgs)(args);

    if (!this[cmd] && !imgElId) {
      throw new _protocol.errors.NotYetImplementedError();
    }

    let unexpectedShutdownListener;

    const commandExecutor = async () => imgElId ? await _imageElement.ImageElement.execute(this, cmd, imgElId, ...args) : await _bluebird.default.race([this[cmd](...args), new _bluebird.default((resolve, reject) => {
      unexpectedShutdownListener = reject;
      this.eventEmitter.on(ON_UNEXPECTED_SHUTDOWN_EVENT, unexpectedShutdownListener);
    })]).finally(() => {
      if (unexpectedShutdownListener) {
        if (cmd === 'createSession') {
          _logger.default.info('[MCLOUD] error happened during new session creating');
        }

        this.eventEmitter.removeListener(ON_UNEXPECTED_SHUTDOWN_EVENT, unexpectedShutdownListener);
        unexpectedShutdownListener = null;
      }
    });

    const res = this.isCommandsQueueEnabled && cmd !== 'executeDriverScript' ? await this.commandsQueueGuard.acquire(BaseDriver.name, commandExecutor) : await commandExecutor();

    if (this.isCommandsQueueEnabled && cmd !== 'deleteSession') {
      this.startNewCommandTimeout();
    }

    const endTime = Date.now();

    this._eventHistory.commands.push({
      cmd,
      startTime,
      endTime
    });

    if (cmd === 'createSession') {
      this.logEvent(EVENT_SESSION_START);

      if (res != undefined && res.value != undefined) {
        _logger.default.info(`[MCLOUD] starting artifacts capturing for session ${res.value[0]}`);

        const start_rec_command = `/opt/start-capture-artifacts.sh ${res.value[0]} >> /tmp/video.log 2>&1`;
        (0, _mcloudUtils.executeShell)(start_rec_command, '[MCLOUD] start capturing artifacts');
      }
    } else if (cmd === 'deleteSession') {
      this.logEvent(EVENT_SESSION_QUIT_DONE);
    }

    return res;
  }

  async startUnexpectedShutdown(err = new _protocol.errors.NoSuchDriverError('The driver was unexpectedly shut down!')) {
    this.eventEmitter.emit(ON_UNEXPECTED_SHUTDOWN_EVENT, err);
    this.shutdownUnexpectedly = true;

    try {
      await this.deleteSession(this.sessionId);
    } finally {
      this.shutdownUnexpectedly = false;
    }
  }

  validateLocatorStrategy(strategy, webContext = false) {
    let validStrategies = this.locatorStrategies;

    _logger.default.debug(`Valid locator strategies for this request: ${validStrategies.join(', ')}`);

    if (webContext) {
      validStrategies = validStrategies.concat(this.webLocatorStrategies);
    }

    if (!_lodash.default.includes(validStrategies, strategy)) {
      throw new _protocol.errors.InvalidSelectorError(`Locator Strategy '${strategy}' is not supported for this session`);
    }
  }

  async reset() {
    _logger.default.debug('Resetting app mid-session');

    _logger.default.debug('Running generic full reset');

    let currentConfig = {};

    for (let property of ['implicitWaitMs', 'newCommandTimeoutMs', 'sessionId', 'resetOnUnexpectedShutdown']) {
      currentConfig[property] = this[property];
    }

    this.resetOnUnexpectedShutdown = () => {};

    const args = this.protocol === _constants.PROTOCOLS.W3C ? [undefined, undefined, {
      alwaysMatch: this.caps,
      firstMatch: [{}]
    }] : [this.caps];

    try {
      await this.deleteSession(this.sessionId);

      _logger.default.debug('Restarting app');

      await this.createSession(...args);
    } finally {
      for (let [key, value] of _lodash.default.toPairs(currentConfig)) {
        this[key] = value;
      }
    }

    this.clearNewCommandTimeout();
  }

  proxyActive() {
    return false;
  }

  getProxyAvoidList() {
    return [];
  }

  canProxy() {
    return false;
  }

  proxyRouteIsAvoided(sessionId, method, url) {
    for (let avoidSchema of this.getProxyAvoidList(sessionId)) {
      if (!_lodash.default.isArray(avoidSchema) || avoidSchema.length !== 2) {
        throw new Error('Proxy avoidance must be a list of pairs');
      }

      let [avoidMethod, avoidPathRegex] = avoidSchema;

      if (!_lodash.default.includes(['GET', 'POST', 'DELETE'], avoidMethod)) {
        throw new Error(`Unrecognized proxy avoidance method '${avoidMethod}'`);
      }

      if (!_lodash.default.isRegExp(avoidPathRegex)) {
        throw new Error('Proxy avoidance path must be a regular expression');
      }

      let normalizedUrl = url.replace(new RegExp(`^${_lodash.default.escapeRegExp(this.basePath)}`), '');

      if (avoidMethod === method && avoidPathRegex.test(normalizedUrl)) {
        return true;
      }
    }

    return false;
  }

  addManagedDriver(driver) {
    this.managedDrivers.push(driver);
  }

  getManagedDrivers() {
    return this.managedDrivers;
  }

  registerImageElement(imgEl) {
    this._imgElCache.set(imgEl.id, imgEl);

    const protoKey = this.isW3CProtocol() ? _constants.W3C_ELEMENT_KEY : _constants.MJSONWP_ELEMENT_KEY;
    return imgEl.asElement(protoKey);
  }

}

exports.BaseDriver = BaseDriver;

for (let [cmd, fn] of _lodash.default.toPairs(_commands.default)) {
  BaseDriver.prototype[cmd] = fn;
}

var _default = BaseDriver;
exports.default = _default;require('source-map-support').install();


//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImxpYi9iYXNlZHJpdmVyL2RyaXZlci5qcyJdLCJuYW1lcyI6WyJCIiwiY29uZmlnIiwiY2FuY2VsbGF0aW9uIiwiTkVXX0NPTU1BTkRfVElNRU9VVF9NUyIsIkVWRU5UX1NFU1NJT05fSU5JVCIsIkVWRU5UX1NFU1NJT05fU1RBUlQiLCJFVkVOVF9TRVNTSU9OX1FVSVRfU1RBUlQiLCJFVkVOVF9TRVNTSU9OX1FVSVRfRE9ORSIsIk9OX1VORVhQRUNURURfU0hVVERPV05fRVZFTlQiLCJCYXNlRHJpdmVyIiwiUHJvdG9jb2wiLCJjb25zdHJ1Y3RvciIsIm9wdHMiLCJzaG91bGRWYWxpZGF0ZUNhcHMiLCJzZXNzaW9uSWQiLCJjYXBzIiwiaGVscGVycyIsImJhc2VQYXRoIiwiREVGQVVMVF9CQVNFX1BBVEgiLCJyZWxheGVkU2VjdXJpdHlFbmFibGVkIiwiYWxsb3dJbnNlY3VyZSIsImRlbnlJbnNlY3VyZSIsIm5ld0NvbW1hbmRUaW1lb3V0TXMiLCJpbXBsaWNpdFdhaXRNcyIsIl9jb25zdHJhaW50cyIsIl8iLCJjbG9uZURlZXAiLCJkZXNpcmVkQ2FwYWJpbGl0eUNvbnN0cmFpbnRzIiwibG9jYXRvclN0cmF0ZWdpZXMiLCJ3ZWJMb2NhdG9yU3RyYXRlZ2llcyIsInRtcERpciIsInByb2Nlc3MiLCJlbnYiLCJBUFBJVU1fVE1QX0RJUiIsIm9zIiwidG1wZGlyIiwic2h1dGRvd25VbmV4cGVjdGVkbHkiLCJub0NvbW1hbmRUaW1lciIsImNvbW1hbmRzUXVldWVHdWFyZCIsIkFzeW5jTG9jayIsInNldHRpbmdzIiwiRGV2aWNlU2V0dGluZ3MiLCJub29wIiwiaW5pdGlhbE9wdHMiLCJtYW5hZ2VkRHJpdmVycyIsIl9ldmVudEhpc3RvcnkiLCJjb21tYW5kcyIsIl9pbWdFbENhY2hlIiwiZXZlbnRFbWl0dGVyIiwiRXZlbnRFbWl0dGVyIiwicHJvdG9jb2wiLCJvblVuZXhwZWN0ZWRTaHV0ZG93biIsImhhbmRsZXIiLCJvbiIsImRyaXZlckRhdGEiLCJpc0NvbW1hbmRzUXVldWVFbmFibGVkIiwiZXZlbnRIaXN0b3J5IiwibG9nRXZlbnQiLCJldmVudE5hbWUiLCJFcnJvciIsInRzIiwiRGF0ZSIsIm5vdyIsImxvZ1RpbWUiLCJ0b1RpbWVTdHJpbmciLCJwdXNoIiwibG9nIiwiZGVidWciLCJnZXRTdGF0dXMiLCJnZXRTdGF0dXNXREEiLCJ3ZGFVUkwiLCJzdGF0dXMiLCJnZXRTdGF0dXNBREIiLCJkZXZpY2VVRElEIiwiREVWSUNFX1VESUQiLCJhZGJEZXZpY2VzQ21kIiwiZXJyb3IiLCJkZXZpY2VOYW1lIiwiQU5EUk9JRF9ERVZJQ0VTIiwiZGVzaXJlZENhcENvbnN0cmFpbnRzIiwiY29uc3RyYWludHMiLCJPYmplY3QiLCJhc3NpZ24iLCJ2YWx1ZSIsInRvUGFpcnMiLCJwcmVzZW5jZSIsImFsbG93RW1wdHkiLCJzZXNzaW9uRXhpc3RzIiwiZHJpdmVyRm9yU2Vzc2lvbiIsImxvZ0V4dHJhQ2FwcyIsImV4dHJhQ2FwcyIsImRpZmZlcmVuY2UiLCJrZXlzIiwibGVuZ3RoIiwid2FybiIsImNhcCIsInZhbGlkYXRlRGVzaXJlZENhcHMiLCJlIiwiZXJyb3JBbmRUaHJvdyIsImVycm9ycyIsIlNlc3Npb25Ob3RDcmVhdGVkRXJyb3IiLCJtZXNzYWdlIiwiaXNNanNvbndwUHJvdG9jb2wiLCJQUk9UT0NPTFMiLCJNSlNPTldQIiwiaXNXM0NQcm90b2NvbCIsIlczQyIsInNldFByb3RvY29sTUpTT05XUCIsInNldFByb3RvY29sVzNDIiwiaXNGZWF0dXJlRW5hYmxlZCIsIm5hbWUiLCJpbmNsdWRlcyIsImVuc3VyZUZlYXR1cmVFbmFibGVkIiwiZXhlY3V0ZUNvbW1hbmQiLCJjbWQiLCJhcmdzIiwic3RhcnRUaW1lIiwiY2xlYXJOZXdDb21tYW5kVGltZW91dCIsIk5vU3VjaERyaXZlckVycm9yIiwiaW1nRWxJZCIsIk5vdFlldEltcGxlbWVudGVkRXJyb3IiLCJ1bmV4cGVjdGVkU2h1dGRvd25MaXN0ZW5lciIsImNvbW1hbmRFeGVjdXRvciIsIkltYWdlRWxlbWVudCIsImV4ZWN1dGUiLCJyYWNlIiwicmVzb2x2ZSIsInJlamVjdCIsImZpbmFsbHkiLCJpbmZvIiwicmVtb3ZlTGlzdGVuZXIiLCJyZXMiLCJhY3F1aXJlIiwic3RhcnROZXdDb21tYW5kVGltZW91dCIsImVuZFRpbWUiLCJ1bmRlZmluZWQiLCJzdGFydF9yZWNfY29tbWFuZCIsInN0YXJ0VW5leHBlY3RlZFNodXRkb3duIiwiZXJyIiwiZW1pdCIsImRlbGV0ZVNlc3Npb24iLCJ2YWxpZGF0ZUxvY2F0b3JTdHJhdGVneSIsInN0cmF0ZWd5Iiwid2ViQ29udGV4dCIsInZhbGlkU3RyYXRlZ2llcyIsImpvaW4iLCJjb25jYXQiLCJJbnZhbGlkU2VsZWN0b3JFcnJvciIsInJlc2V0IiwiY3VycmVudENvbmZpZyIsInByb3BlcnR5IiwicmVzZXRPblVuZXhwZWN0ZWRTaHV0ZG93biIsImFsd2F5c01hdGNoIiwiZmlyc3RNYXRjaCIsImNyZWF0ZVNlc3Npb24iLCJrZXkiLCJwcm94eUFjdGl2ZSIsImdldFByb3h5QXZvaWRMaXN0IiwiY2FuUHJveHkiLCJwcm94eVJvdXRlSXNBdm9pZGVkIiwibWV0aG9kIiwidXJsIiwiYXZvaWRTY2hlbWEiLCJpc0FycmF5IiwiYXZvaWRNZXRob2QiLCJhdm9pZFBhdGhSZWdleCIsImlzUmVnRXhwIiwibm9ybWFsaXplZFVybCIsInJlcGxhY2UiLCJSZWdFeHAiLCJlc2NhcGVSZWdFeHAiLCJ0ZXN0IiwiYWRkTWFuYWdlZERyaXZlciIsImRyaXZlciIsImdldE1hbmFnZWREcml2ZXJzIiwicmVnaXN0ZXJJbWFnZUVsZW1lbnQiLCJpbWdFbCIsInNldCIsImlkIiwicHJvdG9LZXkiLCJXM0NfRUxFTUVOVF9LRVkiLCJNSlNPTldQX0VMRU1FTlRfS0VZIiwiYXNFbGVtZW50IiwiZm4iLCJwcm90b3R5cGUiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7O0FBQUE7O0FBR0E7O0FBR0E7O0FBQ0E7O0FBQ0E7O0FBQ0E7O0FBQ0E7O0FBQ0E7O0FBQ0E7O0FBQ0E7O0FBQ0E7O0FB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VUFBTUcsUUFBUSxHQUFHLEtBQUsxRSxhQUFMLEtBQXVCMkUsMEJBQXZCLEdBQXlDQyw4QkFBMUQ7QUFDQSxXQUFPTCxLQUFLLENBQUNNLFNBQU4sQ0FBZ0JILFFBQWhCLENBQVA7QUFDRDs7QUFwZitCOzs7O0FBdWZsQyxLQUFLLElBQUksQ0FBQ2pFLEdBQUQsRUFBTXFFLEVBQU4sQ0FBVCxJQUFzQjlKLGdCQUFFMkQsT0FBRixDQUFVdEMsaUJBQVYsQ0FBdEIsRUFBMkM7QUFDekNyQyxFQUFBQSxVQUFVLENBQUMrSyxTQUFYLENBQXFCdEUsR0FBckIsSUFBNEJxRSxFQUE1QjtBQUNEOztlQUdjOUssVSIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7XG4gIFByb3RvY29sLCBlcnJvcnMsIGRldGVybWluZVByb3RvY29sXG59IGZyb20gJy4uL3Byb3RvY29sJztcbmltcG9ydCB7XG4gIE1KU09OV1BfRUxFTUVOVF9LRVksIFczQ19FTEVNRU5UX0tFWSwgUFJPVE9DT0xTLCBERUZBVUxUX0JBU0VfUEFUSCxcbn0gZnJvbSAnLi4vY29uc3RhbnRzJztcbmltcG9ydCBvcyBmcm9tICdvcyc7XG5pbXBvcnQgY29tbWFuZHMgZnJvbSAnLi9jb21tYW5kcyc7XG5pbXBvcnQgKiBhcyBoZWxwZXJzIGZyb20gJy4vaGVscGVycyc7XG5pbXBvcnQgbG9nIGZyb20gJy4vbG9nZ2VyJztcbmltcG9ydCBEZXZpY2VTZXR0aW5ncyBmcm9tICcuL2RldmljZS1zZXR0aW5ncyc7XG5pbXBvcnQgeyBkZXNpcmVkQ2FwYWJpbGl0eUNvbnN0cmFpbnRzIH0gZnJvbSAnLi9kZXNpcmVkLWNhcHMnO1xuaW1wb3J0IHsgdmFsaWRhdGVDYXBzIH0gZnJvbSAnLi9jYXBhYmlsaXRpZXMnO1xuaW1wb3J0IEIgZnJvbSAnYmx1ZWJpcmQnO1xuaW1wb3J0IF8gZnJvbSAnbG9kYXNoJztcbmltcG9ydCB7XG4gIEltYWdlRWxlbWVudCwgbWFrZUltYWdlRWxlbWVudENhY2hlLCBnZXRJbWdFbEZyb21BcmdzXG59IGZyb20gJy4vaW1hZ2UtZWxlbWVudCc7XG5pbXBvcnQgQXN5bmNMb2NrIGZyb20gJ2FzeW5jLWxvY2snO1xuaW1wb3J0IHsgRXZlbnRFbWl0dGVyIH0gZnJvbSAnZXZlbnRzJztcbmltcG9ydCB7IGV4ZWN1dGVTaGVsbCwgZXhlY3V0ZVNoZWxsV1Byb21pc2UsIHBhcnNlV0RBVXJsLCBnZXRXREFTdGF0dXMgfSBmcm9tICcuL21jbG91ZC11dGlscyc7XG5pbXBvcnQgeyBsb2dnZXIgfSBmcm9tICdhcHBpdW0tc3VwcG9ydCc7XG5cblxuQi5jb25maWcoe1xuICBjYW5jZWxsYXRpb246IHRydWUsXG59KTtcblxuY29uc3QgTkVXX0NPTU1BTkRfVElNRU9VVF9NUyA9IDYwICogMTAwMDtcblxuY29uc3QgRVZFTlRfU0VTU0lPTl9JTklUID0gJ25ld1Nlc3Npb25SZXF1ZXN0ZWQnO1xuY29uc3QgRVZFTlRfU0VTU0lPTl9TVEFSVCA9ICduZXdTZXNzaW9uU3RhcnRlZCc7XG5jb25zdCBFVkVOVF9TRVNTSU9OX1FVSVRfU1RBUlQgPSAncXVpdFNlc3Npb25SZXF1ZXN0ZWQnO1xuY29uc3QgRVZFTlRfU0VTU0lPTl9RVUlUX0RPTkUgPSAncXVpdFNlc3Npb25GaW5pc2hlZCc7XG5jb25zdCBPTl9VTkVYUEVDVEVEX1NIVVRET1dOX0VWRU5UID0gJ29uVW5leHBlY3RlZFNodXRkb3duJztcblxuY2xhc3MgQmFzZURyaXZlciBleHRlbmRzIFByb3RvY29sIHtcblxuICBjb25zdHJ1Y3RvciAob3B0cyA9IHt9LCBzaG91bGRWYWxpZGF0ZUNhcHMgPSB0cnVlKSB7XG4gICAgc3VwZXIoKTtcblxuICAgIC8vIHNldHVwIHN0YXRlXG4gICAgdGhpcy5zZXNzaW9uSWQgPSBudWxsO1xuICAgIHRoaXMub3B0cyA9IG9wdHM7XG4gICAgdGhpcy5jYXBzID0gbnVsbDtcbiAgICB0aGlzLmhlbHBlcnMgPSBoZWxwZXJzO1xuXG4gICAgLy8gYmFzZVBhdGggaXMgdXNlZCBmb3Igc2V2ZXJhbCBwdXJwb3NlcywgZm9yIGV4YW1wbGUgaW4gc2V0dGluZyB1cFxuICAgIC8vIHByb3h5aW5nIHRvIG90aGVyIGRyaXZlcnMsIHNpbmNlIHdlIG5lZWQgdG8ga25vdyB3aGF0IHRoZSBiYXNlIHBhdGhcbiAgICAvLyBvZiBhbnkgaW5jb21pbmcgcmVxdWVzdCBtaWdodCBsb29rIGxpa2UuIFdlIHNldCBpdCB0byB0aGUgZGVmYXVsdFxuICAgIC8vIGluaXRpYWxseSBidXQgaXQgaXMgYXV0b21hdGljYWxseSB1cGRhdGVkIGR1cmluZyBhbnkgYWN0dWFsIHByb2dyYW1cbiAgICAvLyBleGVjdXRpb24gYnkgdGhlIHJvdXRlQ29uZmlndXJpbmdGdW5jdGlvbiwgd2hpY2ggaXMgbmVjZXNzYXJpbHkgcnVuIGFzXG4gICAgLy8gdGhlIGVudHJ5cG9pbnQgZm9yIGFueSBBcHBpdW0gc2VydmVyXG4gICAgdGhpcy5iYXNlUGF0aCA9IERFRkFVTFRfQkFTRV9QQVRIO1xuXG4gICAgLy8gaW5pdGlhbGl6ZSBzZWN1cml0eSBtb2Rlc1xuICAgIHRoaXMucmVsYXhlZFNlY3VyaXR5RW5hYmxlZCA9IGZhbHNlO1xuICAgIHRoaXMuYWxsb3dJbnNlY3VyZSA9IFtdO1xuICAgIHRoaXMuZGVueUluc2VjdXJlID0gW107XG5cbiAgICAvLyB0aW1lb3V0IGluaXRpYWxpemF0aW9uXG4gICAgdGhpcy5uZXdDb21tYW5kVGltZW91dE1zID0gTkVXX0NPTU1BTkRfVElNRU9VVF9NUztcbiAgICB0aGlzLmltcGxpY2l0V2FpdE1zID0gMDtcblxuICAgIHRoaXMuX2NvbnN0cmFpbnRzID0gXy5jbG9uZURlZXAoZGVzaXJlZENhcGFiaWxpdHlDb25zdHJhaW50cyk7XG4gICAgdGhpcy5sb2NhdG9yU3RyYXRlZ2llcyA9IFtdO1xuICAgIHRoaXMud2ViTG9jYXRvclN0cmF0ZWdpZXMgPSBbXTtcblxuICAgIC8vIHVzZSBhIGN1c3RvbSB0bXAgZGlyIHRvIGF2b2lkIGxvc2luZyBkYXRhIGFuZCBhcHAgd2hlbiBjb21wdXRlciBpc1xuICAgIC8vIHJlc3RhcnRlZFxuICAgIHRoaXMub3B0cy50bXBEaXIgPSB0aGlzLm9wdHMudG1wRGlyIHx8XG4gICAgICAgICAgICAgICAgICAgICAgIHByb2Nlc3MuZW52LkFQUElVTV9UTVBfRElSIHx8XG4gICAgICAgICAgICAgICAgICAgICAgIG9zLnRtcGRpcigpO1xuXG4gICAgLy8gYmFzZS1kcml2ZXIgaW50ZXJuYWxzXG4gICAgdGhpcy5zaHV0ZG93blVuZXhwZWN0ZWRseSA9IGZhbHNlO1xuICAgIHRoaXMubm9Db21tYW5kVGltZXIgPSBudWxsO1xuICAgIHRoaXMuc2hvdWxkVmFsaWRhdGVDYXBzID0gc2hvdWxkVmFsaWRhdGVDYXBzO1xuICAgIHRoaXMuY29tbWFuZHNRdWV1ZUd1YXJkID0gbmV3IEFzeW5jTG9jaygpO1xuXG4gICAgLy8gc2V0dGluZ3Mgc2hvdWxkIGJlIGluc3RhbnRpYXRlZCBieSBkcml2ZXJzIHdoaWNoIGV4dGVuZCBCYXNlRHJpdmVyLCBidXRcbiAgICAvLyB3ZSBzZXQgaXQgdG8gYW4gZW1wdHkgRGV2aWNlU2V0dGluZ3MgaW5zdGFuY2UgaGVyZSB0byBtYWtlIHN1cmUgdGhhdCB0aGVcbiAgICAvLyBkZWZhdWx0IHNldHRpbmdzIGFyZSBhcHBsaWVkIGV2ZW4gaWYgYW4gZXh0ZW5kaW5nIGRyaXZlciBkb2Vzbid0IHV0aWxpemVcbiAgICAvLyB0aGUgc2V0dGluZ3MgZnVuY3Rpb25hbGl0eSBpdHNlbGZcbiAgICB0aGlzLnNldHRpbmdzID0gbmV3IERldmljZVNldHRpbmdzKHt9LCBfLm5vb3ApO1xuXG4gICAgLy8ga2VlcGluZyB0cmFjayBvZiBpbml0aWFsIG9wdHNcbiAgICB0aGlzLmluaXRpYWxPcHRzID0gXy5jbG9uZURlZXAodGhpcy5vcHRzKTtcblxuICAgIC8vIGFsbG93IHN1YmNsYXNzZXMgdG8gaGF2ZSBpbnRlcm5hbCBkcml2ZXJzXG4gICAgdGhpcy5tYW5hZ2VkRHJpdmVycyA9IFtdO1xuXG4gICAgLy8gc3RvcmUgZXZlbnQgdGltaW5nc1xuICAgIHRoaXMuX2V2ZW50SGlzdG9yeSA9IHtcbiAgICAgIGNvbW1hbmRzOiBbXSAvLyBjb21tYW5kcyBnZXQgYSBzcGVjaWFsIHBsYWNlXG4gICAgfTtcblxuICAgIC8vIGNhY2hlIHRoZSBpbWFnZSBlbGVtZW50c1xuICAgIHRoaXMuX2ltZ0VsQ2FjaGUgPSBtYWtlSW1hZ2VFbGVtZW50Q2FjaGUoKTtcblxuICAgIC8vIHVzZWQgdG8gaGFuZGxlIGRyaXZlciBldmVudHNcbiAgICB0aGlzLmV2ZW50RW1pdHRlciA9IG5ldyBFdmVudEVtaXR0ZXIoKTtcblxuICAgIHRoaXMucHJvdG9jb2wgPSBudWxsO1xuICB9XG5cbiAgLyoqXG4gICAqIFNldCBhIGNhbGxiYWNrIGhhbmRsZXIgaWYgbmVlZGVkIHRvIGV4ZWN1dGUgYSBjdXN0b20gcGllY2Ugb2YgY29kZVxuICAgKiB3aGVuIHRoZSBkcml2ZXIgaXMgc2h1dCBkb3duIHVuZXhwZWN0ZWRseS4gTXVsdGlwbGUgY2FsbHMgdG8gdGhpcyBtZXRob2RcbiAgICogd2lsbCBjYXVzZSB0aGUgaGFuZGxlciB0byBiZSBleGVjdXRlZCBtdXRpcGxlIHRpbWVzXG4gICAqXG4gICAqIEBwYXJhbSB7RnVuY3Rpb259IGhhbmRsZXIgVGhlIGNvZGUgdG8gYmUgZXhlY3V0ZWQgb24gdW5leHBlY3RlZCBzaHV0ZG93bi5cbiAgICogVGhlIGZ1bmN0aW9uIG1heSBhY2NlcHQgb25lIGFyZ3VtZW50LCB3aGljaCBpcyB0aGUgYWN0dWFsIGVycm9yIGluc3RhbmNlLCB3aGljaFxuICAgKiBjYXVzZWQgdGhlIGRyaXZlciB0byBzaHV0IGRvd24uXG4gICAqL1xuICBvblVuZXhwZWN0ZWRTaHV0ZG93biAoaGFuZGxlcikge1xuICAgIHRoaXMuZXZlbnRFbWl0dGVyLm9uKE9OX1VORVhQRUNURURfU0hVVERPV05fRVZFTlQsIGhhbmRsZXIpO1xuICB9XG5cbiAgLyoqXG4gICAqIFRoaXMgcHJvcGVydHkgaXMgdXNlZCBieSBBcHBpdW1Ecml2ZXIgdG8gc3RvcmUgdGhlIGRhdGEgb2YgdGhlXG4gICAqIHNwZWNpZmljIGRyaXZlciBzZXNzaW9ucy4gVGhpcyBkYXRhIGNhbiBiZSBsYXRlciB1c2VkIHRvIGFkanVzdFxuICAgKiBwcm9wZXJ0aWVzIGZvciBkcml2ZXIgaW5zdGFuY2VzIHJ1bm5pbmcgaW4gcGFyYWxsZWwuXG4gICAqIE92ZXJyaWRlIGl0IGluIGluaGVyaXRlZCBkcml2ZXIgY2xhc3NlcyBpZiBuZWNlc3NhcnkuXG4gICAqXG4gICAqIEByZXR1cm4ge29iamVjdH0gRHJpdmVyIHByb3BlcnRpZXMgbWFwcGluZ1xuICAgKi9cbiAgZ2V0IGRyaXZlckRhdGEgKCkge1xuICAgIHJldHVybiB7fTtcbiAgfVxuXG4gIC8qKlxuICAgKiBUaGlzIHByb3BlcnR5IGNvbnRyb2xzIHRoZSB3YXkgeyNleGVjdXRlQ29tbWFuZH0gbWV0aG9kXG4gICAqIGhhbmRsZXMgbmV3IGRyaXZlciBjb21tYW5kcyByZWNlaXZlZCBmcm9tIHRoZSBjbGllbnQuXG4gICAqIE92ZXJyaWRlIGl0IGZvciBpbmhlcml0ZWQgY2xhc3NlcyBvbmx5IGluIHNwZWNpYWwgY2FzZXMuXG4gICAqXG4gICAqIEByZXR1cm4ge2Jvb2xlYW59IElmIHRoZSByZXR1cm5lZCB2YWx1ZSBpcyB0cnVlIChkZWZhdWx0KSB0aGVuIGFsbCB0aGUgY29tbWFuZHNcbiAgICogICByZWNlaXZlZCBieSB0aGUgcGFydGljdWxhciBkcml2ZXIgaW5zdGFuY2UgYXJlIGdvaW5nIHRvIGJlIHB1dCBpbnRvIHRoZSBxdWV1ZSxcbiAgICogICBzbyBlYWNoIGZvbGxvd2luZyBjb21tYW5kIHdpbGwgbm90IGJlIGV4ZWN1dGVkIHVudGlsIHRoZSBwcmV2aW91cyBjb21tYW5kXG4gICAqICAgZXhlY3V0aW9uIGlzIGNvbXBsZXRlZC4gRmFsc2UgdmFsdWUgZGlzYWJsZXMgdGhhdCBxdWV1ZSwgc28gZWFjaCBkcml2ZXIgY29tbWFuZFxuICAgKiAgIGlzIGV4ZWN1dGVkIGluZGVwZW5kZW50bHkgYW5kIGRvZXMgbm90IHdhaXQgZm9yIGFueXRoaW5nLlxuICAgKi9cbiAgZ2V0IGlzQ29tbWFuZHNRdWV1ZUVuYWJsZWQgKCkge1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgLypcbiAgICogbWFrZSBldmVudEhpc3RvcnkgYSBwcm9wZXJ0eSBhbmQgcmV0dXJuIGEgY2xvbmVkIG9iamVjdCBzbyBhIGNvbnN1bWVyIGNhbid0XG4gICAqIGluYWR2ZXJ0ZW50bHkgY2hhbmdlIGRhdGEgb3V0c2lkZSBvZiBsb2dFdmVudFxuICAgKi9cbiAgZ2V0IGV2ZW50SGlzdG9yeSAoKSB7XG4gICAgcmV0dXJuIF8uY2xvbmVEZWVwKHRoaXMuX2V2ZW50SGlzdG9yeSk7XG4gIH1cblxuICAvKlxuICAgKiBBUEkgbWV0aG9kIGZvciBkcml2ZXIgZGV2ZWxvcGVycyB0byBsb2cgdGltaW5ncyBmb3IgaW1wb3J0YW50IGV2ZW50c1xuICAgKi9cbiAgbG9nRXZlbnQgKGV2ZW50TmFtZSkge1xuICAgIGlmIChldmVudE5hbWUgPT09ICdjb21tYW5kcycpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignQ2Fubm90IGxvZyBjb21tYW5kcyBkaXJlY3RseScpO1xuICAgIH1cbiAgICBpZiAodHlwZW9mIGV2ZW50TmFtZSAhPT0gJ3N0cmluZycpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBldmVudE5hbWUgJHtldmVudE5hbWV9YCk7XG4gICAgfVxuICAgIGlmICghdGhpcy5fZXZlbnRIaXN0b3J5W2V2ZW50TmFtZV0pIHtcbiAgICAgIHRoaXMuX2V2ZW50SGlzdG9yeVtldmVudE5hbWVdID0gW107XG4gICAgfVxuICAgIGNvbnN0IHRzID0gRGF0ZS5ub3coKTtcbiAgICBjb25zdCBsb2dUaW1lID0gKG5ldyBEYXRlKHRzKSkudG9UaW1lU3RyaW5nKCk7XG4gICAgdGhpcy5fZXZlbnRIaXN0b3J5W2V2ZW50TmFtZV0ucHVzaCh0cyk7XG4gICAgbG9nLmRlYnVnKGBFdmVudCAnJHtldmVudE5hbWV9JyBsb2dnZWQgYXQgJHt0c30gKCR7bG9nVGltZX0pYCk7XG4gIH1cblxuICAvKlxuICAgKiBPdmVycmlkZGVuIGluIGFwcGl1bSBkcml2ZXIsIGJ1dCBoZXJlIHNvIHRoYXQgaW5kaXZpZHVhbCBkcml2ZXJzIGNhbiBiZVxuICAgKiB0ZXN0ZWQgd2l0aCBjbGllbnRzIHRoYXQgcG9sbFxuICAgKi9cbiAgYXN5bmMgZ2V0U3RhdHVzICgpIHsgLy8gZXNsaW50LWRpc2FibGUtbGluZSByZXF1aXJlLWF3YWl0XG4gICAgcmV0dXJuIHt9O1xuICB9XG5cbiAgYXN5bmMgZ2V0U3RhdHVzV0RBICgpIHtcbiAgICBjb25zdCB3ZGFVUkwgPSBhd2FpdCBwYXJzZVdEQVVybCgpO1xuICAgIGlmICghd2RhVVJMKSB7XG4gICAgICByZXR1cm4ge1wic3RhdHVzXCI6IFwiZXJyb3JcIiwgXCJkZXRhaWxzXCI6IFwiRW52aXJvbm1lbnQgdmFyaWFibGUgV0RBX0VOViBpcyB1bmRlZmluZWRcIn07XG4gICAgfVxuICAgIGNvbnN0IHN0YXR1cyA9IGF3YWl0IGdldFdEQVN0YXR1cyh3ZGFVUkwpO1xuICAgIGlmICghc3RhdHVzKSB7XG4gICAgICByZXR1cm4ge1wic3RhdHVzXCI6IFwiZXJyb3JcIiwgXCJkZXRhaWxzXCI6IFwiRXJyb3IgZm9yIHNlbmRpbmcgb2YgV0RBIHN0YXR1cyBodHRwIGNhbGwuIFNlZSBhcHBpdW0gbG9ncyBmb3IgZGV0YWlsc1wifTtcbiAgICB9XG4gICAgcmV0dXJuIHtcInN0YXR1c1wiOiBcInN1Y2Nlc3NcIiwgXCJkZXRhaWxzXCI6IHN0YXR1c307XG4gIH1cblxuICBhc3luYyBnZXRTdGF0dXNBREIoKSB7XG4gICAgY29uc3QgZGV2aWNlVURJRCA9IHByb2Nlc3MuZW52LkRFVklDRV9VRElEO1xuICAgIGlmIChkZXZpY2VVRElEKSB7XG4gICAgICBjb25zdCBhZGJEZXZpY2VzQ21kID0gJ2FkYiBkZXZpY2VzIHwgZ3JlcCAkREVWSUNFX1VESUQgfCBncmVwIFwiZGV2aWNlXCInO1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgZXhlY3V0ZVNoZWxsV1Byb21pc2UoYWRiRGV2aWNlc0NtZCk7XG4gICAgICAgIHJldHVybiB7XCJzdGF0dXNcIjogXCJzdWNjZXNzXCIsIFwiZGV0YWlsc1wiOiBgQ29ubmVjdGVkIGRldmljZSB3aXRoIFVESUQgJHtkZXZpY2VVRElEfSBpcyByZWFkeSBmb3IgZXhlY3V0aW9uYH07XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICByZXR1cm4ge1wic3RhdHVzXCI6IFwiZXJyb3JcIiwgXCJkZXRhaWxzXCI6IGBDb25uZWN0ZWQgZGV2aWNlIHdpdGggVURJRCAke2RldmljZVVESUR9IGlzIE5PVCByZWFkeSBmb3IgZXhlY3V0aW9uLiBEZXZpY2Ugd2FzIG5vdCByZXR1cm5lZCBieSBhZGJgfTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3QgZGV2aWNlTmFtZSA9IHByb2Nlc3MuZW52LkFORFJPSURfREVWSUNFUztcbiAgICAgIGlmKCFkZXZpY2VOYW1lKSB7XG4gICAgICAgIHJldHVybiB7XCJzdGF0dXNcIjogXCJlcnJvclwiLCBcImRldGFpbHNcIjogYE5laXRoZXIgREVWSUNFX1VESUQgbm9yIEFORFJPSURfREVWSUNFUyBlbnZpcm9ubWVudCB2YXJpYWJsZXMgd2VyZSBmb3VuZC5gfTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGFkYkRldmljZXNDbWQgPSAnYWRiIGRldmljZXMgfCBncmVwICRBTkRST0lEX0RFVklDRVMgfCBncmVwIFwiZGV2aWNlXCInO1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgZXhlY3V0ZVNoZWxsV1Byb21pc2UoYWRiRGV2aWNlc0NtZCk7XG4gICAgICAgIHJldHVybiB7XCJzdGF0dXNcIjogXCJzdWNjZXNzXCIsIFwiZGV0YWlsc1wiOiBgQ29ubmVjdGVkIGRldmljZSB3aXRoIG5hbWUgJHtkZXZpY2VOYW1lfSBpcyByZWFkeSBmb3IgZXhlY3V0aW9uYH07XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICByZXR1cm4ge1wic3RhdHVzXCI6IFwiZXJyb3JcIiwgXCJkZXRhaWxzXCI6IGBDb25uZWN0ZWQgZGV2aWNlIHdpdGggbmFtZSAke2RldmljZVVESUR9IGlzIE5PVCByZWFkeSBmb3IgZXhlY3V0aW9uLiBEZXZpY2Ugd2FzIG5vdCByZXR1cm5lZCBieSBhZGJgfTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvLyB3ZSBvbmx5IHdhbnQgc3ViY2xhc3NlcyB0byBldmVyIGV4dGVuZCB0aGUgY29udHJhaW50c1xuICBzZXQgZGVzaXJlZENhcENvbnN0cmFpbnRzIChjb25zdHJhaW50cykge1xuICAgIHRoaXMuX2NvbnN0cmFpbnRzID0gT2JqZWN0LmFzc2lnbih0aGlzLl9jb25zdHJhaW50cywgY29uc3RyYWludHMpO1xuICAgIC8vICdwcmVzZW5jZScgbWVhbnMgZGlmZmVyZW50IHRoaW5ncyBpbiBkaWZmZXJlbnQgdmVyc2lvbnMgb2YgdGhlIHZhbGlkYXRvcixcbiAgICAvLyB3aGVuIHdlIHNheSAndHJ1ZScgd2UgbWVhbiB0aGF0IGl0IHNob3VsZCBub3QgYmUgYWJsZSB0byBiZSBlbXB0eVxuICAgIGZvciAoY29uc3QgWywgdmFsdWVdIG9mIF8udG9QYWlycyh0aGlzLl9jb25zdHJhaW50cykpIHtcbiAgICAgIGlmICh2YWx1ZSAmJiB2YWx1ZS5wcmVzZW5jZSA9PT0gdHJ1ZSkge1xuICAgICAgICB2YWx1ZS5wcmVzZW5jZSA9IHtcbiAgICAgICAgICBhbGxvd0VtcHR5OiBmYWxzZSxcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBnZXQgZGVzaXJlZENhcENvbnN0cmFpbnRzICgpIHtcbiAgICByZXR1cm4gdGhpcy5fY29uc3RyYWludHM7XG4gIH1cblxuICAvLyBtZXRob2QgcmVxdWlyZWQgYnkgTUpTT05XUCBpbiBvcmRlciB0byBkZXRlcm1pbmUgd2hldGhlciBpdCBzaG91bGRcbiAgLy8gcmVzcG9uZCB3aXRoIGFuIGludmFsaWQgc2Vzc2lvbiByZXNwb25zZVxuICBzZXNzaW9uRXhpc3RzIChzZXNzaW9uSWQpIHtcbiAgICBpZiAoIXNlc3Npb25JZCkgcmV0dXJuIGZhbHNlOyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIGN1cmx5XG4gICAgcmV0dXJuIHNlc3Npb25JZCA9PT0gdGhpcy5zZXNzaW9uSWQ7XG4gIH1cblxuICAvLyBtZXRob2QgcmVxdWlyZWQgYnkgTUpTT05XUCBpbiBvcmRlciB0byBkZXRlcm1pbmUgaWYgdGhlIGNvbW1hbmQgc2hvdWxkXG4gIC8vIGJlIHByb3hpZWQgZGlyZWN0bHkgdG8gdGhlIGRyaXZlclxuICBkcml2ZXJGb3JTZXNzaW9uICgvKnNlc3Npb25JZCovKSB7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICBsb2dFeHRyYUNhcHMgKGNhcHMpIHtcbiAgICBsZXQgZXh0cmFDYXBzID0gXy5kaWZmZXJlbmNlKF8ua2V5cyhjYXBzKSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIF8ua2V5cyh0aGlzLl9jb25zdHJhaW50cykpO1xuICAgIGlmIChleHRyYUNhcHMubGVuZ3RoKSB7XG4gICAgICBsb2cud2FybihgVGhlIGZvbGxvd2luZyBjYXBhYmlsaXRpZXMgd2VyZSBwcm92aWRlZCwgYnV0IGFyZSBub3QgYCArXG4gICAgICAgICAgICAgICBgcmVjb2duaXplZCBieSBBcHBpdW06YCk7XG4gICAgICBmb3IgKGNvbnN0IGNhcCBvZiBleHRyYUNhcHMpIHtcbiAgICAgICAgbG9nLndhcm4oYCAgJHtjYXB9YCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgdmFsaWRhdGVEZXNpcmVkQ2FwcyAoY2Fwcykge1xuICAgIGlmICghdGhpcy5zaG91bGRWYWxpZGF0ZUNhcHMpIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICB2YWxpZGF0ZUNhcHMoY2FwcywgdGhpcy5fY29uc3RyYWludHMpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGxvZy5lcnJvckFuZFRocm93KG5ldyBlcnJvcnMuU2Vzc2lvbk5vdENyZWF0ZWRFcnJvcihgVGhlIGRlc2lyZWRDYXBhYmlsaXRpZXMgb2JqZWN0IHdhcyBub3QgdmFsaWQgZm9yIHRoZSBgICtcbiAgICAgICAgICAgICAgICAgICAgYGZvbGxvd2luZyByZWFzb24ocyk6ICR7ZS5tZXNzYWdlfWApKTtcbiAgICB9XG5cbiAgICB0aGlzLmxvZ0V4dHJhQ2FwcyhjYXBzKTtcblxuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgaXNNanNvbndwUHJvdG9jb2wgKCkge1xuICAgIHJldHVybiB0aGlzLnByb3RvY29sID09PSBQUk9UT0NPTFMuTUpTT05XUDtcbiAgfVxuXG4gIGlzVzNDUHJvdG9jb2wgKCkge1xuICAgIHJldHVybiB0aGlzLnByb3RvY29sID09PSBQUk9UT0NPTFMuVzNDO1xuICB9XG5cbiAgc2V0UHJvdG9jb2xNSlNPTldQICgpIHtcbiAgICB0aGlzLnByb3RvY29sID0gUFJPVE9DT0xTLk1KU09OV1A7XG4gIH1cblxuICBzZXRQcm90b2NvbFczQyAoKSB7XG4gICAgdGhpcy5wcm90b2NvbCA9IFBST1RPQ09MUy5XM0M7XG4gIH1cblxuICAvKipcbiAgICogQ2hlY2sgd2hldGhlciBhIGdpdmVuIGZlYXR1cmUgaXMgZW5hYmxlZCB2aWEgaXRzIG5hbWVcbiAgICpcbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBuYW1lIG9mIGZlYXR1cmUvY29tbWFuZFxuICAgKlxuICAgKiBAcmV0dXJucyB7Qm9vbGVhbn1cbiAgICovXG4gIGlzRmVhdHVyZUVuYWJsZWQgKG5hbWUpIHtcbiAgICAvLyBpZiB3ZSBoYXZlIGV4cGxpY2l0bHkgZGVuaWVkIHRoaXMgZmVhdHVyZSwgcmV0dXJuIGZhbHNlIGltbWVkaWF0ZWx5XG4gICAgaWYgKHRoaXMuZGVueUluc2VjdXJlICYmIF8uaW5jbHVkZXModGhpcy5kZW55SW5zZWN1cmUsIG5hbWUpKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gICAgLy8gaWYgd2Ugc3BlY2lmaWNhbGx5IGhhdmUgYWxsb3dlZCB0aGUgZmVhdHVyZSwgcmV0dXJuIHRydWVcbiAgICBpZiAodGhpcy5hbGxvd0luc2VjdXJlICYmIF8uaW5jbHVkZXModGhpcy5hbGxvd0luc2VjdXJlLCBuYW1lKSkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgLy8gb3RoZXJ3aXNlLCBpZiB3ZSd2ZSBnbG9iYWxseSBhbGxvd2VkIGluc2VjdXJlIGZlYXR1cmVzIGFuZCBub3QgZGVuaWVkXG4gICAgLy8gdGhpcyBvbmUsIHJldHVybiB0cnVlXG4gICAgaWYgKHRoaXMucmVsYXhlZFNlY3VyaXR5RW5hYmxlZCkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgLy8gaWYgd2UgaGF2ZW4ndCBhbGxvd2VkIGFueXRoaW5nIGluc2VjdXJlLCB0aGVuIHJlamVjdFxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBBc3NlcnQgdGhhdCBhIGdpdmVuIGZlYXR1cmUgaXMgZW5hYmxlZCBhbmQgdGhyb3cgYSBoZWxwZnVsIGVycm9yIGlmIGl0J3NcbiAgICogbm90XG4gICAqXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gbmFtZSBvZiBmZWF0dXJlL2NvbW1hbmRcbiAgICovXG4gIGVuc3VyZUZlYXR1cmVFbmFibGVkIChuYW1lKSB7XG4gICAgaWYgKCF0aGlzLmlzRmVhdHVyZUVuYWJsZWQobmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgUG90ZW50aWFsbHkgaW5zZWN1cmUgZmVhdHVyZSAnJHtuYW1lfScgaGFzIG5vdCBiZWVuIGAgK1xuICAgICAgICAgICAgICAgICAgICAgIGBlbmFibGVkLiBJZiB5b3Ugd2FudCB0byBlbmFibGUgdGhpcyBmZWF0dXJlIGFuZCBhY2NlcHQgYCArXG4gICAgICAgICAgICAgICAgICAgICAgYHRoZSBzZWN1cml0eSByYW1pZmljYXRpb25zLCBwbGVhc2UgZG8gc28gYnkgZm9sbG93aW5nIGAgK1xuICAgICAgICAgICAgICAgICAgICAgIGB0aGUgZG9jdW1lbnRlZCBpbnN0cnVjdGlvbnMgYXQgaHR0cHM6Ly9naXRodWIuY29tL2FwcGl1bWAgK1xuICAgICAgICAgICAgICAgICAgICAgIGAvYXBwaXVtL2Jsb2IvbWFzdGVyL2RvY3MvZW4vd3JpdGluZy1ydW5uaW5nLWFwcGl1bS9zZWN1cml0eS5tZGApO1xuICAgIH1cbiAgfVxuXG4gIC8vIFRoaXMgaXMgdGhlIG1haW4gY29tbWFuZCBoYW5kbGVyIGZvciB0aGUgZHJpdmVyLiBJdCB3cmFwcyBjb21tYW5kXG4gIC8vIGV4ZWN1dGlvbiB3aXRoIHRpbWVvdXQgbG9naWMsIGNoZWNraW5nIHRoYXQgd2UgaGF2ZSBhIHZhbGlkIHNlc3Npb24sXG4gIC8vIGFuZCBlbnN1cmluZyB0aGF0IHdlIGV4ZWN1dGUgY29tbWFuZHMgb25lIGF0IGEgdGltZS4gVGhpcyBtZXRob2QgaXMgY2FsbGVkXG4gIC8vIGJ5IE1KU09OV1AncyBleHByZXNzIHJvdXRlci5cbiAgYXN5bmMgZXhlY3V0ZUNvbW1hbmQgKGNtZCwgLi4uYXJncykge1xuICAgIC8vIGdldCBzdGFydCB0aW1lIGZvciB0aGlzIGNvbW1hbmQsIGFuZCBsb2cgaW4gc3BlY2lhbCBjYXNlc1xuICAgIGxldCBzdGFydFRpbWUgPSBEYXRlLm5vdygpO1xuICAgIGlmIChjbWQgPT09ICdjcmVhdGVTZXNzaW9uJykge1xuICAgICAgLy8gSWYgY3JlYXRpbmcgYSBzZXNzaW9uIGRldGVybWluZSBpZiBXM0Mgb3IgTUpTT05XUCBwcm90b2NvbCB3YXMgcmVxdWVzdGVkIGFuZCByZW1lbWJlciB0aGUgY2hvaWNlXG4gICAgICB0aGlzLnByb3RvY29sID0gZGV0ZXJtaW5lUHJvdG9jb2woLi4uYXJncyk7XG4gICAgICB0aGlzLmxvZ0V2ZW50KEVWRU5UX1NFU1NJT05fSU5JVCk7XG4gICAgfSBlbHNlIGlmIChjbWQgPT09ICdkZWxldGVTZXNzaW9uJykge1xuICAgICAgdGhpcy5sb2dFdmVudChFVkVOVF9TRVNTSU9OX1FVSVRfU1RBUlQpO1xuICAgIH1cblxuICAgIC8vIGlmIHdlIGhhZCBhIGNvbW1hbmQgdGltZXIgcnVubmluZywgY2xlYXIgaXQgbm93IHRoYXQgd2UncmUgc3RhcnRpbmdcbiAgICAvLyBhIG5ldyBjb21tYW5kIGFuZCBzbyBkb24ndCB3YW50IHRvIHRpbWUgb3V0XG4gICAgdGhpcy5jbGVhck5ld0NvbW1hbmRUaW1lb3V0KCk7XG5cbiAgICBpZiAodGhpcy5zaHV0ZG93blVuZXhwZWN0ZWRseSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5Ob1N1Y2hEcml2ZXJFcnJvcignVGhlIGRyaXZlciB3YXMgdW5leHBlY3RlZGx5IHNodXQgZG93biEnKTtcbiAgICB9XG5cbiAgICAvLyBJZiB3ZSBkb24ndCBoYXZlIHRoaXMgY29tbWFuZCwgaXQgbXVzdCBub3QgYmUgaW1wbGVtZW50ZWRcbiAgICAvLyBJZiB0aGUgdGFyZ2V0IGVsZW1lbnQgaXMgSW1hZ2VFbGVtZW50LCB3ZSBtdXN0IHRyeSB0byBjYWxsIGBJbWFnZUVsZW1lbnQuZXhlY3V0ZWAgd2hpY2ggZXhpc3QgZm9sbG93aW5nIGxpbmVzXG4gICAgLy8gc2luY2UgSW1hZ2VFbGVtZW50IHN1cHBvcnRzIGZldyBjb21tYW5kcyBieSBpdHNlbGZcbiAgICBjb25zdCBpbWdFbElkID0gZ2V0SW1nRWxGcm9tQXJncyhhcmdzKTtcbiAgICBpZiAoIXRoaXNbY21kXSAmJiAhaW1nRWxJZCkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5Ob3RZZXRJbXBsZW1lbnRlZEVycm9yKCk7XG4gICAgfVxuXG4gICAgbGV0IHVuZXhwZWN0ZWRTaHV0ZG93bkxpc3RlbmVyO1xuICAgIGNvbnN0IGNvbW1hbmRFeGVjdXRvciA9IGFzeW5jICgpID0+IGltZ0VsSWRcbiAgICAgID8gYXdhaXQgSW1hZ2VFbGVtZW50LmV4ZWN1dGUodGhpcywgY21kLCBpbWdFbElkLCAuLi5hcmdzKVxuICAgICAgOiBhd2FpdCBCLnJhY2UoW1xuICAgICAgICB0aGlzW2NtZF0oLi4uYXJncyksXG4gICAgICAgIG5ldyBCKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgICB1bmV4cGVjdGVkU2h1dGRvd25MaXN0ZW5lciA9IHJlamVjdDtcbiAgICAgICAgICB0aGlzLmV2ZW50RW1pdHRlci5vbihPTl9VTkVYUEVDVEVEX1NIVVRET1dOX0VWRU5ULCB1bmV4cGVjdGVkU2h1dGRvd25MaXN0ZW5lcik7XG4gICAgICAgIH0pXG4gICAgICBdKS5maW5hbGx5KCgpID0+IHtcbiAgICAgICAgaWYgKHVuZXhwZWN0ZWRTaHV0ZG93bkxpc3RlbmVyKSB7XG4gICAgICAgICAgaWYgKGNtZCA9PT0gJ2NyZWF0ZVNlc3Npb24nKSB7XG4gICAgICAgICAgICBsb2cuaW5mbygnW01DTE9VRF0gZXJyb3IgaGFwcGVuZWQgZHVyaW5nIG5ldyBzZXNzaW9uIGNyZWF0aW5nJyk7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgLy8gVGhpcyBpcyBuZWVkZWQgdG8gcHJldmVudCBtZW1vcnkgbGVha3NcbiAgICAgICAgICB0aGlzLmV2ZW50RW1pdHRlci5yZW1vdmVMaXN0ZW5lcihPTl9VTkVYUEVDVEVEX1NIVVRET1dOX0VWRU5ULCB1bmV4cGVjdGVkU2h1dGRvd25MaXN0ZW5lcik7XG4gICAgICAgICAgdW5leHBlY3RlZFNodXRkb3duTGlzdGVuZXIgPSBudWxsO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICBjb25zdCByZXMgPSB0aGlzLmlzQ29tbWFuZHNRdWV1ZUVuYWJsZWQgJiYgY21kICE9PSAnZXhlY3V0ZURyaXZlclNjcmlwdCdcbiAgICAgID8gYXdhaXQgdGhpcy5jb21tYW5kc1F1ZXVlR3VhcmQuYWNxdWlyZShCYXNlRHJpdmVyLm5hbWUsIGNvbW1hbmRFeGVjdXRvcilcbiAgICAgIDogYXdhaXQgY29tbWFuZEV4ZWN1dG9yKCk7XG5cbiAgICAvLyBpZiB3ZSBoYXZlIHNldCBhIG5ldyBjb21tYW5kIHRpbWVvdXQgKHdoaWNoIGlzIHRoZSBkZWZhdWx0KSwgc3RhcnQgYVxuICAgIC8vIHRpbWVyIG9uY2Ugd2UndmUgZmluaXNoZWQgZXhlY3V0aW5nIHRoaXMgY29tbWFuZC4gSWYgd2UgZG9uJ3QgY2xlYXJcbiAgICAvLyB0aGUgdGltZXIgKHdoaWNoIGlzIGRvbmUgd2hlbiBhIG5ldyBjb21tYW5kIGNvbWVzIGluKSwgd2Ugd2lsbCB0cmlnZ2VyXG4gICAgLy8gYXV0b21hdGljIHNlc3Npb24gZGVsZXRpb24gaW4gdGhpcy5vbkNvbW1hbmRUaW1lb3V0LiBPZiBjb3Vyc2Ugd2UgZG9uJ3RcbiAgICAvLyB3YW50IHRvIHRyaWdnZXIgdGhlIHRpbWVyIHdoZW4gdGhlIHVzZXIgaXMgc2h1dHRpbmcgZG93biB0aGUgc2Vzc2lvblxuICAgIC8vIGludGVudGlvbmFsbHlcbiAgICBpZiAodGhpcy5pc0NvbW1hbmRzUXVldWVFbmFibGVkICYmIGNtZCAhPT0gJ2RlbGV0ZVNlc3Npb24nKSB7XG4gICAgICAvLyByZXNldHRpbmcgZXhpc3RpbmcgdGltZW91dFxuICAgICAgdGhpcy5zdGFydE5ld0NvbW1hbmRUaW1lb3V0KCk7XG4gICAgfVxuXG4gICAgLy8gbG9nIHRpbWluZyBpbmZvcm1hdGlvbiBhYm91dCB0aGlzIGNvbW1hbmRcbiAgICBjb25zdCBlbmRUaW1lID0gRGF0ZS5ub3coKTtcbiAgICB0aGlzLl9ldmVudEhpc3RvcnkuY29tbWFuZHMucHVzaCh7Y21kLCBzdGFydFRpbWUsIGVuZFRpbWV9KTtcbiAgICBpZiAoY21kID09PSAnY3JlYXRlU2Vzc2lvbicpIHtcbiAgICAgIHRoaXMubG9nRXZlbnQoRVZFTlRfU0VTU0lPTl9TVEFSVCk7XG5cbiAgICAgIGlmKHJlcyAhPSB1bmRlZmluZWQgJiYgcmVzLnZhbHVlICE9IHVuZGVmaW5lZCkge1xuICAgICAgICBsb2cuaW5mbyhgW01DTE9VRF0gc3RhcnRpbmcgYXJ0aWZhY3RzIGNhcHR1cmluZyBmb3Igc2Vzc2lvbiAke3Jlcy52YWx1ZVswXX1gKTtcbiAgICAgICAgY29uc3Qgc3RhcnRfcmVjX2NvbW1hbmQgPSBgL29wdC9zdGFydC1jYXB0dXJlLWFydGlmYWN0cy5zaCAke3Jlcy52YWx1ZVswXX0gPj4gL3RtcC92aWRlby5sb2cgMj4mMWA7XG4gICAgICAgIGV4ZWN1dGVTaGVsbChzdGFydF9yZWNfY29tbWFuZCwgJ1tNQ0xPVURdIHN0YXJ0IGNhcHR1cmluZyBhcnRpZmFjdHMnKTsgLy8gMSBlcnJvciBjb2RlIGV4cGVjdGVkIGFzIHByb2Nlc3Mgc2hvdWxkIGJlIGtpbGxlZFxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoY21kID09PSAnZGVsZXRlU2Vzc2lvbicpIHtcbiAgICAgIHRoaXMubG9nRXZlbnQoRVZFTlRfU0VTU0lPTl9RVUlUX0RPTkUpO1xuICAgIH1cblxuICAgIHJldHVybiByZXM7XG4gIH1cblxuICBhc3luYyBzdGFydFVuZXhwZWN0ZWRTaHV0ZG93biAoZXJyID0gbmV3IGVycm9ycy5Ob1N1Y2hEcml2ZXJFcnJvcignVGhlIGRyaXZlciB3YXMgdW5leHBlY3RlZGx5IHNodXQgZG93biEnKSkge1xuICAgIHRoaXMuZXZlbnRFbWl0dGVyLmVtaXQoT05fVU5FWFBFQ1RFRF9TSFVURE9XTl9FVkVOVCwgZXJyKTsgLy8gYWxsb3cgb3RoZXJzIHRvIGxpc3RlbiBmb3IgdGhpc1xuICAgIHRoaXMuc2h1dGRvd25VbmV4cGVjdGVkbHkgPSB0cnVlO1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLmRlbGV0ZVNlc3Npb24odGhpcy5zZXNzaW9uSWQpO1xuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLnNodXRkb3duVW5leHBlY3RlZGx5ID0gZmFsc2U7XG4gICAgfVxuICB9XG5cbiAgdmFsaWRhdGVMb2NhdG9yU3RyYXRlZ3kgKHN0cmF0ZWd5LCB3ZWJDb250ZXh0ID0gZmFsc2UpIHtcbiAgICBsZXQgdmFsaWRTdHJhdGVnaWVzID0gdGhpcy5sb2NhdG9yU3RyYXRlZ2llcztcbiAgICBsb2cuZGVidWcoYFZhbGlkIGxvY2F0b3Igc3RyYXRlZ2llcyBmb3IgdGhpcyByZXF1ZXN0OiAke3ZhbGlkU3RyYXRlZ2llcy5qb2luKCcsICcpfWApO1xuXG4gICAgaWYgKHdlYkNvbnRleHQpIHtcbiAgICAgIHZhbGlkU3RyYXRlZ2llcyA9IHZhbGlkU3RyYXRlZ2llcy5jb25jYXQodGhpcy53ZWJMb2NhdG9yU3RyYXRlZ2llcyk7XG4gICAgfVxuXG4gICAgaWYgKCFfLmluY2x1ZGVzKHZhbGlkU3RyYXRlZ2llcywgc3RyYXRlZ3kpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRTZWxlY3RvckVycm9yKGBMb2NhdG9yIFN0cmF0ZWd5ICcke3N0cmF0ZWd5fScgaXMgbm90IHN1cHBvcnRlZCBmb3IgdGhpcyBzZXNzaW9uYCk7XG4gICAgfVxuICB9XG5cbiAgLypcbiAgICogUmVzdGFydCB0aGUgc2Vzc2lvbiB3aXRoIHRoZSBvcmlnaW5hbCBjYXBzLFxuICAgKiBwcmVzZXJ2aW5nIHRoZSB0aW1lb3V0IGNvbmZpZy5cbiAgICovXG4gIGFzeW5jIHJlc2V0ICgpIHtcbiAgICBsb2cuZGVidWcoJ1Jlc2V0dGluZyBhcHAgbWlkLXNlc3Npb24nKTtcbiAgICBsb2cuZGVidWcoJ1J1bm5pbmcgZ2VuZXJpYyBmdWxsIHJlc2V0Jyk7XG5cbiAgICAvLyBwcmVzZXJ2aW5nIHN0YXRlXG4gICAgbGV0IGN1cnJlbnRDb25maWcgPSB7fTtcbiAgICBmb3IgKGxldCBwcm9wZXJ0eSBvZiBbJ2ltcGxpY2l0V2FpdE1zJywgJ25ld0NvbW1hbmRUaW1lb3V0TXMnLCAnc2Vzc2lvbklkJywgJ3Jlc2V0T25VbmV4cGVjdGVkU2h1dGRvd24nXSkge1xuICAgICAgY3VycmVudENvbmZpZ1twcm9wZXJ0eV0gPSB0aGlzW3Byb3BlcnR5XTtcbiAgICB9XG5cbiAgICAvLyBXZSBhbHNvIG5lZWQgdG8gcHJlc2VydmUgdGhlIHVuZXhwZWN0ZWQgc2h1dGRvd24sIGFuZCBtYWtlIHN1cmUgaXQgaXMgbm90IGNhbmNlbGxlZCBkdXJpbmcgcmVzZXQuXG4gICAgdGhpcy5yZXNldE9uVW5leHBlY3RlZFNodXRkb3duID0gKCkgPT4ge307XG5cbiAgICAvLyBDb25zdHJ1Y3QgdGhlIGFyZ3VtZW50cyBmb3IgY3JlYXRlU2Vzc2lvbiBkZXBlbmRpbmcgb24gdGhlIHByb3RvY29sIHR5cGVcbiAgICBjb25zdCBhcmdzID0gdGhpcy5wcm90b2NvbCA9PT0gUFJPVE9DT0xTLlczQyA/XG4gICAgICBbdW5kZWZpbmVkLCB1bmRlZmluZWQsIHthbHdheXNNYXRjaDogdGhpcy5jYXBzLCBmaXJzdE1hdGNoOiBbe31dfV0gOlxuICAgICAgW3RoaXMuY2Fwc107XG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5kZWxldGVTZXNzaW9uKHRoaXMuc2Vzc2lvbklkKTtcbiAgICAgIGxvZy5kZWJ1ZygnUmVzdGFydGluZyBhcHAnKTtcbiAgICAgIGF3YWl0IHRoaXMuY3JlYXRlU2Vzc2lvbiguLi5hcmdzKTtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgLy8gYWx3YXlzIHJlc3RvcmUgc3RhdGUuXG4gICAgICBmb3IgKGxldCBba2V5LCB2YWx1ZV0gb2YgXy50b1BhaXJzKGN1cnJlbnRDb25maWcpKSB7XG4gICAgICAgIHRoaXNba2V5XSA9IHZhbHVlO1xuICAgICAgfVxuICAgIH1cbiAgICB0aGlzLmNsZWFyTmV3Q29tbWFuZFRpbWVvdXQoKTtcbiAgfVxuXG4gIHByb3h5QWN0aXZlICgvKiBzZXNzaW9uSWQgKi8pIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBnZXRQcm94eUF2b2lkTGlzdCAoLyogc2Vzc2lvbklkICovKSB7XG4gICAgcmV0dXJuIFtdO1xuICB9XG5cbiAgY2FuUHJveHkgKC8qIHNlc3Npb25JZCAqLykge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIGEgZ2l2ZW4gY29tbWFuZCByb3V0ZSAoZXhwcmVzc2VkIGFzIG1ldGhvZCBhbmQgdXJsKSBzaG91bGQgbm90IGJlXG4gICAqIHByb3hpZWQgYWNjb3JkaW5nIHRvIHRoaXMgZHJpdmVyXG4gICAqXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzZXNzaW9uSWQgLSB0aGUgY3VycmVudCBzZXNzaW9uSWQgKGluIGNhc2UgdGhlIGRyaXZlciBydW5zXG4gICAqIG11bHRpcGxlIHNlc3Npb24gaWRzIGFuZCByZXF1aXJlcyBpdCkuIFRoaXMgaXMgbm90IHVzZWQgaW4gdGhpcyBtZXRob2QgYnV0XG4gICAqIHNob3VsZCBiZSBtYWRlIGF2YWlsYWJsZSB0byBvdmVycmlkZGVuIG1ldGhvZHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXRob2QgLSBIVFRQIG1ldGhvZCBvZiB0aGUgcm91dGVcbiAgICogQHBhcmFtIHtzdHJpbmd9IHVybCAtIHVybCBvZiB0aGUgcm91dGVcbiAgICpcbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gd2hldGhlciB0aGUgcm91dGUgc2hvdWxkIGJlIGF2b2lkZWRcbiAgICovXG4gIHByb3h5Um91dGVJc0F2b2lkZWQgKHNlc3Npb25JZCwgbWV0aG9kLCB1cmwpIHtcbiAgICBmb3IgKGxldCBhdm9pZFNjaGVtYSBvZiB0aGlzLmdldFByb3h5QXZvaWRMaXN0KHNlc3Npb25JZCkpIHtcbiAgICAgIGlmICghXy5pc0FycmF5KGF2b2lkU2NoZW1hKSB8fCBhdm9pZFNjaGVtYS5sZW5ndGggIT09IDIpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdQcm94eSBhdm9pZGFuY2UgbXVzdCBiZSBhIGxpc3Qgb2YgcGFpcnMnKTtcbiAgICAgIH1cbiAgICAgIGxldCBbYXZvaWRNZXRob2QsIGF2b2lkUGF0aFJlZ2V4XSA9IGF2b2lkU2NoZW1hO1xuICAgICAgaWYgKCFfLmluY2x1ZGVzKFsnR0VUJywgJ1BPU1QnLCAnREVMRVRFJ10sIGF2b2lkTWV0aG9kKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVucmVjb2duaXplZCBwcm94eSBhdm9pZGFuY2UgbWV0aG9kICcke2F2b2lkTWV0aG9kfSdgKTtcbiAgICAgIH1cbiAgICAgIGlmICghXy5pc1JlZ0V4cChhdm9pZFBhdGhSZWdleCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdQcm94eSBhdm9pZGFuY2UgcGF0aCBtdXN0IGJlIGEgcmVndWxhciBleHByZXNzaW9uJyk7XG4gICAgICB9XG4gICAgICBsZXQgbm9ybWFsaXplZFVybCA9IHVybC5yZXBsYWNlKG5ldyBSZWdFeHAoYF4ke18uZXNjYXBlUmVnRXhwKHRoaXMuYmFzZVBhdGgpfWApLCAnJyk7XG4gICAgICBpZiAoYXZvaWRNZXRob2QgPT09IG1ldGhvZCAmJiBhdm9pZFBhdGhSZWdleC50ZXN0KG5vcm1hbGl6ZWRVcmwpKSB7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBhZGRNYW5hZ2VkRHJpdmVyIChkcml2ZXIpIHtcbiAgICB0aGlzLm1hbmFnZWREcml2ZXJzLnB1c2goZHJpdmVyKTtcbiAgfVxuXG4gIGdldE1hbmFnZWREcml2ZXJzICgpIHtcbiAgICByZXR1cm4gdGhpcy5tYW5hZ2VkRHJpdmVycztcbiAgfVxuXG4gIHJlZ2lzdGVySW1hZ2VFbGVtZW50IChpbWdFbCkge1xuICAgIHRoaXMuX2ltZ0VsQ2FjaGUuc2V0KGltZ0VsLmlkLCBpbWdFbCk7XG4gICAgY29uc3QgcHJvdG9LZXkgPSB0aGlzLmlzVzNDUHJvdG9jb2woKSA/IFczQ19FTEVNRU5UX0tFWSA6IE1KU09OV1BfRUxFTUVOVF9LRVk7XG4gICAgcmV0dXJuIGltZ0VsLmFzRWxlbWVudChwcm90b0tleSk7XG4gIH1cbn1cblxuZm9yIChsZXQgW2NtZCwgZm5dIG9mIF8udG9QYWlycyhjb21tYW5kcykpIHtcbiAgQmFzZURyaXZlci5wcm90b3R5cGVbY21kXSA9IGZuO1xufVxuXG5leHBvcnQgeyBCYXNlRHJpdmVyIH07XG5leHBvcnQgZGVmYXVsdCBCYXNlRHJpdmVyO1xuIl0sImZpbGUiOiJsaWIvYmFzZWRyaXZlci9kcml2ZXIuanMiLCJzb3VyY2VSb290IjoiLi4vLi4vLi4ifQ==
