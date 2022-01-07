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
        _logger.default.info("stopping fallback session recording");

        const stop_rec_command = `sh /opt/stop-capture-artifacts.sh`;
        (0, _mcloudUtils.executeShell)(stop_rec_command, 'stop video recording');
        await new Promise(resolve => setTimeout(resolve, 300));

        _logger.default.info("starting new video recording on session init");

        const start_rec_command = `sh /opt/capture-artifacts.sh ${res.value[0]}`;
        (0, _mcloudUtils.executeShell)(start_rec_command, 'start video recording');
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


//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImxpYi9iYXNlZHJpdmVyL2RyaXZlci5qcyJdLCJuYW1lcyI6WyJCIiwiY29uZmlnIiwiY2FuY2VsbGF0aW9uIiwiTkVXX0NPTU1BTkRfVElNRU9VVF9NUyIsIkVWRU5UX1NFU1NJT05fSU5JVCIsIkVWRU5UX1NFU1NJT05fU1RBUlQiLCJFVkVOVF9TRVNTSU9OX1FVSVRfU1RBUlQiLCJFVkVOVF9TRVNTSU9OX1FVSVRfRE9ORSIsIk9OX1VORVhQRUNURURfU0hVVERPV05fRVZFTlQiLCJCYXNlRHJpdmVyIiwiUHJvdG9jb2wiLCJjb25zdHJ1Y3RvciIsIm9wdHMiLCJzaG91bGRWYWxpZGF0ZUNhcHMiLCJzZXNzaW9uSWQiLCJjYXBzIiwiaGVscGVycyIsImJhc2VQYXRoIiwiREVGQVVMVF9CQVNFX1BBVEgiLCJyZWxheGVkU2VjdXJpdHlFbmFibGVkIiwiYWxsb3dJbnNlY3VyZSIsImRlbnlJbnNlY3VyZSIsIm5ld0NvbW1hbmRUaW1lb3V0TXMiLCJpbXBsaWNpdFdhaXRNcyIsIl9jb25zdHJhaW50cyIsIl8iLCJjbG9uZURlZXAiLCJkZXNpcmVkQ2FwYWJpbGl0eUNvbnN0cmFpbnRzIiwibG9jYXRvclN0cmF0ZWdpZXMiLCJ3ZWJMb2NhdG9yU3RyYXRlZ2llcyIsInRtcERpciIsInByb2Nlc3MiLCJlbnYiLCJBUFBJVU1fVE1QX0RJUiIsIm9zIiwidG1wZGlyIiwic2h1dGRvd25VbmV4cGVjdGVkbHkiLCJub0NvbW1hbmRUaW1lciIsImNvbW1hbmRzUXVldWVHdWFyZCIsIkFzeW5jTG9jayIsInNldHRpbmdzIiwiRGV2aWNlU2V0dGluZ3MiLCJub29wIiwiaW5pdGlhbE9wdHMiLCJtYW5hZ2VkRHJpdmVycyIsIl9ldmVudEhpc3RvcnkiLCJjb21tYW5kcyIsIl9pbWdFbENhY2hlIiwiZXZlbnRFbWl0dGVyIiwiRXZlbnRFbWl0dGVyIiwicHJvdG9jb2wiLCJvblVuZXhwZWN0ZWRTaHV0ZG93biIsImhhbmRsZXIiLCJvbiIsImRyaXZlckRhdGEiLCJpc0NvbW1hbmRzUXVldWVFbmFibGVkIiwiZXZlbnRIaXN0b3J5IiwibG9nRXZlbnQiLCJldmVudE5hbWUiLCJFcnJvciIsInRzIiwiRGF0ZSIsIm5vdyIsImxvZ1RpbWUiLCJ0b1RpbWVTdHJpbmciLCJwdXNoIiwibG9nIiwiZGVidWciLCJnZXRTdGF0dXMiLCJkZXNpcmVkQ2FwQ29uc3RyYWludHMiLCJjb25zdHJhaW50cyIsIk9iamVjdCIsImFzc2lnbiIsInZhbHVlIiwidG9QYWlycyIsInByZXNlbmNlIiwiYWxsb3dFbXB0eSIsInNlc3Npb25FeGlzdHMiLCJkcml2ZXJGb3JTZXNzaW9uIiwibG9nRXh0cmFDYXBzIiwiZXh0cmFDYXBzIiwiZGlmZmVyZW5jZSIsImtleXMiLCJsZW5ndGgiLCJ3YXJuIiwiY2FwIiwidmFsaWRhdGVEZXNpcmVkQ2FwcyIsImUiLCJlcnJvckFuZFRocm93IiwiZXJyb3JzIiwiU2Vzc2lvbk5vdENyZWF0ZWRFcnJvciIsIm1lc3NhZ2UiLCJpc01qc29ud3BQcm90b2NvbCIsIlBST1RPQ09MUyIsIk1KU09OV1AiLCJpc1czQ1Byb3RvY29sIiwiVzNDIiwic2V0UHJvdG9jb2xNSlNPTldQIiwic2V0UHJvdG9jb2xXM0MiLCJpc0ZlYXR1cmVFbmFibGVkIiwibmFtZSIsImluY2x1ZGVzIiwiZW5zdXJlRmVhdHVyZUVuYWJsZWQiLCJleGVjdXRlQ29tbWFuZCIsImNtZCIsImFyZ3MiLCJzdGFydFRpbWUiLCJjbGVhck5ld0NvbW1hbmRUaW1lb3V0IiwiTm9TdWNoRHJpdmVyRXJyb3IiLCJpbWdFbElkIiwiTm90WWV0SW1wbGVtZW50ZWRFcnJvciIsInVuZXhwZWN0ZWRTaHV0ZG93bkxpc3RlbmVyIiwiY29tbWFuZEV4ZWN1dG9yIiwiSW1hZ2VFbGVtZW50IiwiZXhlY3V0ZSIsInJhY2UiLCJyZXNvbHZlIiwicmVqZWN0IiwiZmluYWxseSIsInJlbW92ZUxpc3RlbmVyIiwicmVzIiwiYWNxdWlyZSIsInN0YXJ0TmV3Q29tbWFuZFRpbWVvdXQiLCJlbmRUaW1lIiwidW5kZWZpbmVkIiwiaW5mbyIsInN0b3BfcmVjX2NvbW1hbmQiLCJQcm9taXNlIiwic2V0VGltZW91dCIsInN0YXJ0X3JlY19jb21tYW5kIiwic3RhcnRVbmV4cGVjdGVkU2h1dGRvd24iLCJlcnIiLCJlbWl0IiwiZGVsZXRlU2Vzc2lvbiIsInZhbGlkYXRlTG9jYXRvclN0cmF0ZWd5Iiwic3RyYXRlZ3kiLCJ3ZWJDb250ZXh0IiwidmFsaWRTdHJhdGVnaWVzIiwiam9pbiIsImNvbmNhdCIsIkludmFsaWRTZWxlY3RvckVycm9yIiwicmVzZXQiLCJjdXJyZW50Q29uZmlnIiwicHJvcGVydHkiLCJyZXNldE9uVW5leHBlY3RlZFNodXRkb3duIiwiYWx3YXlzTWF0Y2giLCJmaXJzdE1hdGNoIiwiY3JlYXRlU2Vzc2lvbiIsImtleSIsInByb3h5QWN0aXZlIiwiZ2V0UHJveHlBdm9pZExpc3QiLCJjYW5Qcm94eSIsInByb3h5Um91dGVJc0F2b2lkZWQiLCJtZXRob2QiLCJ1cmwiLCJhdm9pZFNjaGVtYSIsImlzQXJyYXkiLCJhdm9pZE1ldGhvZCIsImF2b2lkUGF0aFJlZ2V4IiwiaXNSZWdFeHAiLCJub3JtYWxpemVkVXJsIiwicmVwbGFjZSIsIlJlZ0V4cCIsImVzY2FwZVJlZ0V4cCIsInRlc3QiLCJhZGRNYW5hZ2VkRHJpdmVyIiwiZHJpdmVyIiwiZ2V0TWFuYWdlZERyaXZlcnMiLCJyZWdpc3RlckltYWdlRWxlbWVudCIsImltZ0VsIiwic2V0IiwiaWQiLCJwcm90b0tleSIsIlczQ19FTEVNRU5UX0tFWSIsIk1KU09OV1BfRUxFTUVOVF9LRVkiLCJhc0VsZW1lbnQiLCJmbiIsInByb3RvdHlwZSJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7QUFBQTs7QUFHQTs7QUFHQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFHQTs7QUFDQTs7QUFDQTs7Ozs7O0FBR0FBLGtCQUFFQyxNQUFGLENBQVM7QUFDUEMsRUFBQUEsWUFBWSxFQUFFO0FBRFAsQ0FBVDs7QUFJQSxNQUFNQyxzQkFBc0IsR0FBRyxLQUFLLElBQXBDO0FBRUEsTUFBTUMsa0JBQWtCLEdBQUcscUJBQTNCO0FBQ0EsTUFBTUMsbUJBQW1CLEdBQUcsbUJBQTVCO0FBQ0EsTUFBTUMsd0JBQXdCLEdBQUcsc0JBQWpDO0FBQ0EsTUFBTUMsdUJBQXVCLEdBQUcscUJBQWhDO0FBQ0EsTUFBTUMsNEJBQTRCLEdBQUcsc0JBQXJDOztBQUVBLE1BQU1DLFVBQU4sU0FBeUJDLGtCQUF6QixDQUFrQztBQUVoQ0MsRUFBQUEsV0FBVyxDQUFFQyxJQUFJLEdBQUcsRUFBVCxFQUFhQyxrQkFBa0IsR0FBRyxJQUFsQyxFQUF3QztBQUNqRDtBQUdBLFNBQUtDLFNBQUwsR0FBaUIsSUFBakI7QUFDQSxTQUFLRixJQUFMLEdBQVlBLElBQVo7QUFDQSxTQUFLRyxJQUFMLEdBQVksSUFBWjtBQUNBLFNBQUtDLE9BQUwsR0FBZUEsT0FBZjtBQVFBLFNBQUtDLFFBQUwsR0FBZ0JDLDRCQUFoQjtBQUdBLFNBQUtDLHNCQUFMLEdBQThCLEtBQTlCO0FBQ0EsU0FBS0MsYUFBTCxHQUFxQixFQUFyQjtBQUNBLFNBQUtDLFlBQUwsR0FBb0IsRUFBcEI7QUFHQSxTQUFLQyxtQkFBTCxHQUEyQm5CLHNCQUEzQjtBQUNBLFNBQUtvQixjQUFMLEdBQXNCLENBQXRCO0FBRUEsU0FBS0MsWUFBTCxHQUFvQkMsZ0JBQUVDLFNBQUYsQ0FBWUMseUNBQVosQ0FBcEI7QUFDQSxTQUFLQyxpQkFBTCxHQUF5QixFQUF6QjtBQUNBLFNBQUtDLG9CQUFMLEdBQTRCLEVBQTVCO0FBSUEsU0FBS2pCLElBQUwsQ0FBVWtCLE1BQVYsR0FBbUIsS0FBS2xCLElBQUwsQ0FBVWtCLE1BQVYsSUFDQUMsT0FBTyxDQUFDQyxHQUFSLENBQVlDLGNBRFosSUFFQUMsWUFBR0MsTUFBSCxFQUZuQjtBQUtBLFNBQUtDLG9CQUFMLEdBQTRCLEtBQTVCO0FBQ0EsU0FBS0MsY0FBTCxHQUFzQixJQUF0QjtBQUNBLFNBQUt4QixrQkFBTCxHQUEwQkEsa0JBQTFCO0FBQ0EsU0FBS3lCLGtCQUFMLEdBQTBCLElBQUlDLGtCQUFKLEVBQTFCO0FBTUEsU0FBS0MsUUFBTCxHQUFnQixJQUFJQyx1QkFBSixDQUFtQixFQUFuQixFQUF1QmhCLGdCQUFFaUIsSUFBekIsQ0FBaEI7QUFHQSxTQUFLQyxXQUFMLEdBQW1CbEIsZ0JBQUVDLFNBQUYsQ0FBWSxLQUFLZCxJQUFqQixDQUFuQjtBQUdBLFNBQUtnQyxjQUFMLEdBQXNCLEVBQXRCO0FBR0EsU0FBS0MsYUFBTCxHQUFxQjtBQUNuQkMsTUFBQUEsUUFBUSxFQUFFO0FBRFMsS0FBckI7QUFLQSxTQUFLQyxXQUFMLEdBQW1CLDBDQUFuQjtBQUdBLFNBQUtDLFlBQUwsR0FBb0IsSUFBSUMsb0JBQUosRUFBcEI7QUFFQSxTQUFLQyxRQUFMLEdBQWdCLElBQWhCO0FBQ0Q7O0FBV0RDLEVBQUFBLG9CQUFvQixDQUFFQyxPQUFGLEVBQVc7QUFDN0IsU0FBS0osWUFBTCxDQUFrQkssRUFBbEIsQ0FBcUI3Qyw0QkFBckIsRUFBbUQ0QyxPQUFuRDtBQUNEOztBQVVhLE1BQVZFLFVBQVUsR0FBSTtBQUNoQixXQUFPLEVBQVA7QUFDRDs7QUFheUIsTUFBdEJDLHNCQUFzQixHQUFJO0FBQzVCLFdBQU8sSUFBUDtBQUNEOztBQU1lLE1BQVpDLFlBQVksR0FBSTtBQUNsQixXQUFPL0IsZ0JBQUVDLFNBQUYsQ0FBWSxLQUFLbUIsYUFBakIsQ0FBUDtBQUNEOztBQUtEWSxFQUFBQSxRQUFRLENBQUVDLFNBQUYsRUFBYTtBQUNuQixRQUFJQSxTQUFTLEtBQUssVUFBbEIsRUFBOEI7QUFDNUIsWUFBTSxJQUFJQyxLQUFKLENBQVUsOEJBQVYsQ0FBTjtBQUNEOztBQUNELFFBQUksT0FBT0QsU0FBUCxLQUFxQixRQUF6QixFQUFtQztBQUNqQyxZQUFNLElBQUlDLEtBQUosQ0FBVyxxQkFBb0JELFNBQVUsRUFBekMsQ0FBTjtBQUNEOztBQUNELFFBQUksQ0FBQyxLQUFLYixhQUFMLENBQW1CYSxTQUFuQixDQUFMLEVBQW9DO0FBQ2xDLFdBQUtiLGFBQUwsQ0FBbUJhLFNBQW5CLElBQWdDLEVBQWhDO0FBQ0Q7O0FBQ0QsVUFBTUUsRUFBRSxHQUFHQyxJQUFJLENBQUNDLEdBQUwsRUFBWDtBQUNBLFVBQU1DLE9BQU8sR0FBSSxJQUFJRixJQUFKLENBQVNELEVBQVQsQ0FBRCxDQUFlSSxZQUFmLEVBQWhCOztBQUNBLFNBQUtuQixhQUFMLENBQW1CYSxTQUFuQixFQUE4Qk8sSUFBOUIsQ0FBbUNMLEVBQW5DOztBQUNBTSxvQkFBSUMsS0FBSixDQUFXLFVBQVNULFNBQVUsZUFBY0UsRUFBRyxLQUFJRyxPQUFRLEdBQTNEO0FBQ0Q7O0FBTWMsUUFBVEssU0FBUyxHQUFJO0FBQ2pCLFdBQU8sRUFBUDtBQUNEOztBQUd3QixNQUFyQkMscUJBQXFCLENBQUVDLFdBQUYsRUFBZTtBQUN0QyxTQUFLOUMsWUFBTCxHQUFvQitDLE1BQU0sQ0FBQ0MsTUFBUCxDQUFjLEtBQUtoRCxZQUFuQixFQUFpQzhDLFdBQWpDLENBQXBCOztBQUdBLFNBQUssTUFBTSxHQUFHRyxLQUFILENBQVgsSUFBd0JoRCxnQkFBRWlELE9BQUYsQ0FBVSxLQUFLbEQsWUFBZixDQUF4QixFQUFzRDtBQUNwRCxVQUFJaUQsS0FBSyxJQUFJQSxLQUFLLENBQUNFLFFBQU4sS0FBbUIsSUFBaEMsRUFBc0M7QUFDcENGLFFBQUFBLEtBQUssQ0FBQ0UsUUFBTixHQUFpQjtBQUNmQyxVQUFBQSxVQUFVLEVBQUU7QUFERyxTQUFqQjtBQUdEO0FBQ0Y7QUFDRjs7QUFFd0IsTUFBckJQLHFCQUFxQixHQUFJO0FBQzNCLFdBQU8sS0FBSzdDLFlBQVo7QUFDRDs7QUFJRHFELEVBQUFBLGFBQWEsQ0FBRS9ELFNBQUYsRUFBYTtBQUN4QixRQUFJLENBQUNBLFNBQUwsRUFBZ0IsT0FBTyxLQUFQO0FBQ2hCLFdBQU9BLFNBQVMsS0FBSyxLQUFLQSxTQUExQjtBQUNEOztBQUlEZ0UsRUFBQUEsZ0JBQWdCLEdBQWlCO0FBQy9CLFdBQU8sSUFBUDtBQUNEOztBQUVEQyxFQUFBQSxZQUFZLENBQUVoRSxJQUFGLEVBQVE7QUFDbEIsUUFBSWlFLFNBQVMsR0FBR3ZELGdCQUFFd0QsVUFBRixDQUFheEQsZ0JBQUV5RCxJQUFGLENBQU9uRSxJQUFQLENBQWIsRUFDYVUsZ0JBQUV5RCxJQUFGLENBQU8sS0FBSzFELFlBQVosQ0FEYixDQUFoQjs7QUFFQSxRQUFJd0QsU0FBUyxDQUFDRyxNQUFkLEVBQXNCO0FBQ3BCakIsc0JBQUlrQixJQUFKLENBQVUsd0RBQUQsR0FDQyx1QkFEVjs7QUFFQSxXQUFLLE1BQU1DLEdBQVgsSUFBa0JMLFNBQWxCLEVBQTZCO0FBQzNCZCx3QkFBSWtCLElBQUosQ0FBVSxLQUFJQyxHQUFJLEVBQWxCO0FBQ0Q7QUFDRjtBQUNGOztBQUVEQyxFQUFBQSxtQkFBbUIsQ0FBRXZFLElBQUYsRUFBUTtBQUN6QixRQUFJLENBQUMsS0FBS0Ysa0JBQVYsRUFBOEI7QUFDNUIsYUFBTyxJQUFQO0FBQ0Q7O0FBRUQsUUFBSTtBQUNGLHNDQUFhRSxJQUFiLEVBQW1CLEtBQUtTLFlBQXhCO0FBQ0QsS0FGRCxDQUVFLE9BQU8rRCxDQUFQLEVBQVU7QUFDVnJCLHNCQUFJc0IsYUFBSixDQUFrQixJQUFJQyxpQkFBT0Msc0JBQVgsQ0FBbUMsdURBQUQsR0FDckMsd0JBQXVCSCxDQUFDLENBQUNJLE9BQVEsRUFEOUIsQ0FBbEI7QUFFRDs7QUFFRCxTQUFLWixZQUFMLENBQWtCaEUsSUFBbEI7QUFFQSxXQUFPLElBQVA7QUFDRDs7QUFFRDZFLEVBQUFBLGlCQUFpQixHQUFJO0FBQ25CLFdBQU8sS0FBSzFDLFFBQUwsS0FBa0IyQyxxQkFBVUMsT0FBbkM7QUFDRDs7QUFFREMsRUFBQUEsYUFBYSxHQUFJO0FBQ2YsV0FBTyxLQUFLN0MsUUFBTCxLQUFrQjJDLHFCQUFVRyxHQUFuQztBQUNEOztBQUVEQyxFQUFBQSxrQkFBa0IsR0FBSTtBQUNwQixTQUFLL0MsUUFBTCxHQUFnQjJDLHFCQUFVQyxPQUExQjtBQUNEOztBQUVESSxFQUFBQSxjQUFjLEdBQUk7QUFDaEIsU0FBS2hELFFBQUwsR0FBZ0IyQyxxQkFBVUcsR0FBMUI7QUFDRDs7QUFTREcsRUFBQUEsZ0JBQWdCLENBQUVDLElBQUYsRUFBUTtBQUV0QixRQUFJLEtBQUsvRSxZQUFMLElBQXFCSSxnQkFBRTRFLFFBQUYsQ0FBVyxLQUFLaEYsWUFBaEIsRUFBOEIrRSxJQUE5QixDQUF6QixFQUE4RDtBQUM1RCxhQUFPLEtBQVA7QUFDRDs7QUFHRCxRQUFJLEtBQUtoRixhQUFMLElBQXNCSyxnQkFBRTRFLFFBQUYsQ0FBVyxLQUFLakYsYUFBaEIsRUFBK0JnRixJQUEvQixDQUExQixFQUFnRTtBQUM5RCxhQUFPLElBQVA7QUFDRDs7QUFJRCxRQUFJLEtBQUtqRixzQkFBVCxFQUFpQztBQUMvQixhQUFPLElBQVA7QUFDRDs7QUFHRCxXQUFPLEtBQVA7QUFDRDs7QUFRRG1GLEVBQUFBLG9CQUFvQixDQUFFRixJQUFGLEVBQVE7QUFDMUIsUUFBSSxDQUFDLEtBQUtELGdCQUFMLENBQXNCQyxJQUF0QixDQUFMLEVBQWtDO0FBQ2hDLFlBQU0sSUFBSXpDLEtBQUosQ0FBVyxpQ0FBZ0N5QyxJQUFLLGlCQUF0QyxHQUNDLHlEQURELEdBRUMsd0RBRkQsR0FHQywwREFIRCxHQUlDLGdFQUpYLENBQU47QUFLRDtBQUNGOztBQU1tQixRQUFkRyxjQUFjLENBQUVDLEdBQUYsRUFBTyxHQUFHQyxJQUFWLEVBQWdCO0FBRWxDLFFBQUlDLFNBQVMsR0FBRzdDLElBQUksQ0FBQ0MsR0FBTCxFQUFoQjs7QUFDQSxRQUFJMEMsR0FBRyxLQUFLLGVBQVosRUFBNkI7QUFFM0IsV0FBS3RELFFBQUwsR0FBZ0IsaUNBQWtCLEdBQUd1RCxJQUFyQixDQUFoQjtBQUNBLFdBQUtoRCxRQUFMLENBQWNyRCxrQkFBZDtBQUNELEtBSkQsTUFJTyxJQUFJb0csR0FBRyxLQUFLLGVBQVosRUFBNkI7QUFDbEMsV0FBSy9DLFFBQUwsQ0FBY25ELHdCQUFkO0FBQ0Q7O0FBSUQsU0FBS3FHLHNCQUFMOztBQUVBLFFBQUksS0FBS3ZFLG9CQUFULEVBQStCO0FBQzdCLFlBQU0sSUFBSXFELGlCQUFPbUIsaUJBQVgsQ0FBNkIsd0NBQTdCLENBQU47QUFDRDs7QUFLRCxVQUFNQyxPQUFPLEdBQUcsb0NBQWlCSixJQUFqQixDQUFoQjs7QUFDQSxRQUFJLENBQUMsS0FBS0QsR0FBTCxDQUFELElBQWMsQ0FBQ0ssT0FBbkIsRUFBNEI7QUFDMUIsWUFBTSxJQUFJcEIsaUJBQU9xQixzQkFBWCxFQUFOO0FBQ0Q7O0FBRUQsUUFBSUMsMEJBQUo7O0FBQ0EsVUFBTUMsZUFBZSxHQUFHLFlBQVlILE9BQU8sR0FDdkMsTUFBTUksMkJBQWFDLE9BQWIsQ0FBcUIsSUFBckIsRUFBMkJWLEdBQTNCLEVBQWdDSyxPQUFoQyxFQUF5QyxHQUFHSixJQUE1QyxDQURpQyxHQUV2QyxNQUFNekcsa0JBQUVtSCxJQUFGLENBQU8sQ0FDYixLQUFLWCxHQUFMLEVBQVUsR0FBR0MsSUFBYixDQURhLEVBRWIsSUFBSXpHLGlCQUFKLENBQU0sQ0FBQ29ILE9BQUQsRUFBVUMsTUFBVixLQUFxQjtBQUN6Qk4sTUFBQUEsMEJBQTBCLEdBQUdNLE1BQTdCO0FBQ0EsV0FBS3JFLFlBQUwsQ0FBa0JLLEVBQWxCLENBQXFCN0MsNEJBQXJCLEVBQW1EdUcsMEJBQW5EO0FBQ0QsS0FIRCxDQUZhLENBQVAsRUFNTE8sT0FOSyxDQU1HLE1BQU07QUFDZixVQUFJUCwwQkFBSixFQUFnQztBQUU5QixhQUFLL0QsWUFBTCxDQUFrQnVFLGNBQWxCLENBQWlDL0csNEJBQWpDLEVBQStEdUcsMEJBQS9EO0FBQ0FBLFFBQUFBLDBCQUEwQixHQUFHLElBQTdCO0FBQ0Q7QUFDRixLQVpPLENBRlY7O0FBZUEsVUFBTVMsR0FBRyxHQUFHLEtBQUtqRSxzQkFBTCxJQUErQmlELEdBQUcsS0FBSyxxQkFBdkMsR0FDUixNQUFNLEtBQUtsRSxrQkFBTCxDQUF3Qm1GLE9BQXhCLENBQWdDaEgsVUFBVSxDQUFDMkYsSUFBM0MsRUFBaURZLGVBQWpELENBREUsR0FFUixNQUFNQSxlQUFlLEVBRnpCOztBQVVBLFFBQUksS0FBS3pELHNCQUFMLElBQStCaUQsR0FBRyxLQUFLLGVBQTNDLEVBQTREO0FBRTFELFdBQUtrQixzQkFBTDtBQUNEOztBQUdELFVBQU1DLE9BQU8sR0FBRzlELElBQUksQ0FBQ0MsR0FBTCxFQUFoQjs7QUFDQSxTQUFLakIsYUFBTCxDQUFtQkMsUUFBbkIsQ0FBNEJtQixJQUE1QixDQUFpQztBQUFDdUMsTUFBQUEsR0FBRDtBQUFNRSxNQUFBQSxTQUFOO0FBQWlCaUIsTUFBQUE7QUFBakIsS0FBakM7O0FBQ0EsUUFBSW5CLEdBQUcsS0FBSyxlQUFaLEVBQTZCO0FBQzNCLFdBQUsvQyxRQUFMLENBQWNwRCxtQkFBZDs7QUFFQSxVQUFHbUgsR0FBRyxJQUFJSSxTQUFQLElBQW9CSixHQUFHLENBQUMvQyxLQUFKLElBQWFtRCxTQUFwQyxFQUErQztBQUM3QzFELHdCQUFJMkQsSUFBSixDQUFTLHFDQUFUOztBQUVBLGNBQU1DLGdCQUFnQixHQUFJLG1DQUExQjtBQUNBLHVDQUFhQSxnQkFBYixFQUErQixzQkFBL0I7QUFDQSxjQUFNLElBQUlDLE9BQUosQ0FBWVgsT0FBTyxJQUFJWSxVQUFVLENBQUNaLE9BQUQsRUFBVSxHQUFWLENBQWpDLENBQU47O0FBRUFsRCx3QkFBSTJELElBQUosQ0FBUyw4Q0FBVDs7QUFDQSxjQUFNSSxpQkFBaUIsR0FBSSxnQ0FBK0JULEdBQUcsQ0FBQy9DLEtBQUosQ0FBVSxDQUFWLENBQWEsRUFBdkU7QUFDQSx1Q0FBYXdELGlCQUFiLEVBQWdDLHVCQUFoQztBQUNEO0FBdUJGLEtBcENELE1Bb0NPLElBQUl6QixHQUFHLEtBQUssZUFBWixFQUE2QjtBQUNsQyxXQUFLL0MsUUFBTCxDQUFjbEQsdUJBQWQ7QUFDRDs7QUFFRCxXQUFPaUgsR0FBUDtBQUNEOztBQUU0QixRQUF2QlUsdUJBQXVCLENBQUVDLEdBQUcsR0FBRyxJQUFJMUMsaUJBQU9tQixpQkFBWCxDQUE2Qix3Q0FBN0IsQ0FBUixFQUFnRjtBQUMzRyxTQUFLNUQsWUFBTCxDQUFrQm9GLElBQWxCLENBQXVCNUgsNEJBQXZCLEVBQXFEMkgsR0FBckQ7QUFDQSxTQUFLL0Ysb0JBQUwsR0FBNEIsSUFBNUI7O0FBQ0EsUUFBSTtBQUNGLFlBQU0sS0FBS2lHLGFBQUwsQ0FBbUIsS0FBS3ZILFNBQXhCLENBQU47QUFDRCxLQUZELFNBRVU7QUFDUixXQUFLc0Isb0JBQUwsR0FBNEIsS0FBNUI7QUFDRDtBQUNGOztBQUVEa0csRUFBQUEsdUJBQXVCLENBQUVDLFFBQUYsRUFBWUMsVUFBVSxHQUFHLEtBQXpCLEVBQWdDO0FBQ3JELFFBQUlDLGVBQWUsR0FBRyxLQUFLN0csaUJBQTNCOztBQUNBc0Msb0JBQUlDLEtBQUosQ0FBVyw4Q0FBNkNzRSxlQUFlLENBQUNDLElBQWhCLENBQXFCLElBQXJCLENBQTJCLEVBQW5GOztBQUVBLFFBQUlGLFVBQUosRUFBZ0I7QUFDZEMsTUFBQUEsZUFBZSxHQUFHQSxlQUFlLENBQUNFLE1BQWhCLENBQXVCLEtBQUs5RyxvQkFBNUIsQ0FBbEI7QUFDRDs7QUFFRCxRQUFJLENBQUNKLGdCQUFFNEUsUUFBRixDQUFXb0MsZUFBWCxFQUE0QkYsUUFBNUIsQ0FBTCxFQUE0QztBQUMxQyxZQUFNLElBQUk5QyxpQkFBT21ELG9CQUFYLENBQWlDLHFCQUFvQkwsUUFBUyxxQ0FBOUQsQ0FBTjtBQUNEO0FBQ0Y7O0FBTVUsUUFBTE0sS0FBSyxHQUFJO0FBQ2IzRSxvQkFBSUMsS0FBSixDQUFVLDJCQUFWOztBQUNBRCxvQkFBSUMsS0FBSixDQUFVLDRCQUFWOztBQUdBLFFBQUkyRSxhQUFhLEdBQUcsRUFBcEI7O0FBQ0EsU0FBSyxJQUFJQyxRQUFULElBQXFCLENBQUMsZ0JBQUQsRUFBbUIscUJBQW5CLEVBQTBDLFdBQTFDLEVBQXVELDJCQUF2RCxDQUFyQixFQUEwRztBQUN4R0QsTUFBQUEsYUFBYSxDQUFDQyxRQUFELENBQWIsR0FBMEIsS0FBS0EsUUFBTCxDQUExQjtBQUNEOztBQUdELFNBQUtDLHlCQUFMLEdBQWlDLE1BQU0sQ0FBRSxDQUF6Qzs7QUFHQSxVQUFNdkMsSUFBSSxHQUFHLEtBQUt2RCxRQUFMLEtBQWtCMkMscUJBQVVHLEdBQTVCLEdBQ1gsQ0FBQzRCLFNBQUQsRUFBWUEsU0FBWixFQUF1QjtBQUFDcUIsTUFBQUEsV0FBVyxFQUFFLEtBQUtsSSxJQUFuQjtBQUF5Qm1JLE1BQUFBLFVBQVUsRUFBRSxDQUFDLEVBQUQ7QUFBckMsS0FBdkIsQ0FEVyxHQUVYLENBQUMsS0FBS25JLElBQU4sQ0FGRjs7QUFJQSxRQUFJO0FBQ0YsWUFBTSxLQUFLc0gsYUFBTCxDQUFtQixLQUFLdkgsU0FBeEIsQ0FBTjs7QUFDQW9ELHNCQUFJQyxLQUFKLENBQVUsZ0JBQVY7O0FBQ0EsWUFBTSxLQUFLZ0YsYUFBTCxDQUFtQixHQUFHMUMsSUFBdEIsQ0FBTjtBQUNELEtBSkQsU0FJVTtBQUVSLFdBQUssSUFBSSxDQUFDMkMsR0FBRCxFQUFNM0UsS0FBTixDQUFULElBQXlCaEQsZ0JBQUVpRCxPQUFGLENBQVVvRSxhQUFWLENBQXpCLEVBQW1EO0FBQ2pELGFBQUtNLEdBQUwsSUFBWTNFLEtBQVo7QUFDRDtBQUNGOztBQUNELFNBQUtrQyxzQkFBTDtBQUNEOztBQUVEMEMsRUFBQUEsV0FBVyxHQUFtQjtBQUM1QixXQUFPLEtBQVA7QUFDRDs7QUFFREMsRUFBQUEsaUJBQWlCLEdBQW1CO0FBQ2xDLFdBQU8sRUFBUDtBQUNEOztBQUVEQyxFQUFBQSxRQUFRLEdBQW1CO0FBQ3pCLFdBQU8sS0FBUDtBQUNEOztBQWNEQyxFQUFBQSxtQkFBbUIsQ0FBRTFJLFNBQUYsRUFBYTJJLE1BQWIsRUFBcUJDLEdBQXJCLEVBQTBCO0FBQzNDLFNBQUssSUFBSUMsV0FBVCxJQUF3QixLQUFLTCxpQkFBTCxDQUF1QnhJLFNBQXZCLENBQXhCLEVBQTJEO0FBQ3pELFVBQUksQ0FBQ1csZ0JBQUVtSSxPQUFGLENBQVVELFdBQVYsQ0FBRCxJQUEyQkEsV0FBVyxDQUFDeEUsTUFBWixLQUF1QixDQUF0RCxFQUF5RDtBQUN2RCxjQUFNLElBQUl4QixLQUFKLENBQVUseUNBQVYsQ0FBTjtBQUNEOztBQUNELFVBQUksQ0FBQ2tHLFdBQUQsRUFBY0MsY0FBZCxJQUFnQ0gsV0FBcEM7O0FBQ0EsVUFBSSxDQUFDbEksZ0JBQUU0RSxRQUFGLENBQVcsQ0FBQyxLQUFELEVBQVEsTUFBUixFQUFnQixRQUFoQixDQUFYLEVBQXNDd0QsV0FBdEMsQ0FBTCxFQUF5RDtBQUN2RCxjQUFNLElBQUlsRyxLQUFKLENBQVcsd0NBQXVDa0csV0FBWSxHQUE5RCxDQUFOO0FBQ0Q7O0FBQ0QsVUFBSSxDQUFDcEksZ0JBQUVzSSxRQUFGLENBQVdELGNBQVgsQ0FBTCxFQUFpQztBQUMvQixjQUFNLElBQUluRyxLQUFKLENBQVUsbURBQVYsQ0FBTjtBQUNEOztBQUNELFVBQUlxRyxhQUFhLEdBQUdOLEdBQUcsQ0FBQ08sT0FBSixDQUFZLElBQUlDLE1BQUosQ0FBWSxJQUFHekksZ0JBQUUwSSxZQUFGLENBQWUsS0FBS2xKLFFBQXBCLENBQThCLEVBQTdDLENBQVosRUFBNkQsRUFBN0QsQ0FBcEI7O0FBQ0EsVUFBSTRJLFdBQVcsS0FBS0osTUFBaEIsSUFBMEJLLGNBQWMsQ0FBQ00sSUFBZixDQUFvQkosYUFBcEIsQ0FBOUIsRUFBa0U7QUFDaEUsZUFBTyxJQUFQO0FBQ0Q7QUFDRjs7QUFDRCxXQUFPLEtBQVA7QUFDRDs7QUFFREssRUFBQUEsZ0JBQWdCLENBQUVDLE1BQUYsRUFBVTtBQUN4QixTQUFLMUgsY0FBTCxDQUFvQnFCLElBQXBCLENBQXlCcUcsTUFBekI7QUFDRDs7QUFFREMsRUFBQUEsaUJBQWlCLEdBQUk7QUFDbkIsV0FBTyxLQUFLM0gsY0FBWjtBQUNEOztBQUVENEgsRUFBQUEsb0JBQW9CLENBQUVDLEtBQUYsRUFBUztBQUMzQixTQUFLMUgsV0FBTCxDQUFpQjJILEdBQWpCLENBQXFCRCxLQUFLLENBQUNFLEVBQTNCLEVBQStCRixLQUEvQjs7QUFDQSxVQUFNRyxRQUFRLEdBQUcsS0FBSzdFLGFBQUwsS0FBdUI4RSwwQkFBdkIsR0FBeUNDLDhCQUExRDtBQUNBLFdBQU9MLEtBQUssQ0FBQ00sU0FBTixDQUFnQkgsUUFBaEIsQ0FBUDtBQUNEOztBQXZlK0I7Ozs7QUEwZWxDLEtBQUssSUFBSSxDQUFDcEUsR0FBRCxFQUFNd0UsRUFBTixDQUFULElBQXNCdkosZ0JBQUVpRCxPQUFGLENBQVU1QixpQkFBVixDQUF0QixFQUEyQztBQUN6Q3JDLEVBQUFBLFVBQVUsQ0FBQ3dLLFNBQVgsQ0FBcUJ6RSxHQUFyQixJQUE0QndFLEVBQTVCO0FBQ0Q7O2VBR2N2SyxVIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHtcbiAgUHJvdG9jb2wsIGVycm9ycywgZGV0ZXJtaW5lUHJvdG9jb2xcbn0gZnJvbSAnLi4vcHJvdG9jb2wnO1xuaW1wb3J0IHtcbiAgTUpTT05XUF9FTEVNRU5UX0tFWSwgVzNDX0VMRU1FTlRfS0VZLCBQUk9UT0NPTFMsIERFRkFVTFRfQkFTRV9QQVRILFxufSBmcm9tICcuLi9jb25zdGFudHMnO1xuaW1wb3J0IG9zIGZyb20gJ29zJztcbmltcG9ydCBjb21tYW5kcyBmcm9tICcuL2NvbW1hbmRzJztcbmltcG9ydCAqIGFzIGhlbHBlcnMgZnJvbSAnLi9oZWxwZXJzJztcbmltcG9ydCBsb2cgZnJvbSAnLi9sb2dnZXInO1xuaW1wb3J0IERldmljZVNldHRpbmdzIGZyb20gJy4vZGV2aWNlLXNldHRpbmdzJztcbmltcG9ydCB7IGRlc2lyZWRDYXBhYmlsaXR5Q29uc3RyYWludHMgfSBmcm9tICcuL2Rlc2lyZWQtY2Fwcyc7XG5pbXBvcnQgeyB2YWxpZGF0ZUNhcHMgfSBmcm9tICcuL2NhcGFiaWxpdGllcyc7XG5pbXBvcnQgQiBmcm9tICdibHVlYmlyZCc7XG5pbXBvcnQgXyBmcm9tICdsb2Rhc2gnO1xuaW1wb3J0IHtcbiAgSW1hZ2VFbGVtZW50LCBtYWtlSW1hZ2VFbGVtZW50Q2FjaGUsIGdldEltZ0VsRnJvbUFyZ3Ncbn0gZnJvbSAnLi9pbWFnZS1lbGVtZW50JztcbmltcG9ydCBBc3luY0xvY2sgZnJvbSAnYXN5bmMtbG9jayc7XG5pbXBvcnQgeyBFdmVudEVtaXR0ZXIgfSBmcm9tICdldmVudHMnO1xuaW1wb3J0IHsgZXhlY3V0ZVNoZWxsIH0gZnJvbSAnLi9tY2xvdWQtdXRpbHMnO1xuXG5cbkIuY29uZmlnKHtcbiAgY2FuY2VsbGF0aW9uOiB0cnVlLFxufSk7XG5cbmNvbnN0IE5FV19DT01NQU5EX1RJTUVPVVRfTVMgPSA2MCAqIDEwMDA7XG5cbmNvbnN0IEVWRU5UX1NFU1NJT05fSU5JVCA9ICduZXdTZXNzaW9uUmVxdWVzdGVkJztcbmNvbnN0IEVWRU5UX1NFU1NJT05fU1RBUlQgPSAnbmV3U2Vzc2lvblN0YXJ0ZWQnO1xuY29uc3QgRVZFTlRfU0VTU0lPTl9RVUlUX1NUQVJUID0gJ3F1aXRTZXNzaW9uUmVxdWVzdGVkJztcbmNvbnN0IEVWRU5UX1NFU1NJT05fUVVJVF9ET05FID0gJ3F1aXRTZXNzaW9uRmluaXNoZWQnO1xuY29uc3QgT05fVU5FWFBFQ1RFRF9TSFVURE9XTl9FVkVOVCA9ICdvblVuZXhwZWN0ZWRTaHV0ZG93bic7XG5cbmNsYXNzIEJhc2VEcml2ZXIgZXh0ZW5kcyBQcm90b2NvbCB7XG5cbiAgY29uc3RydWN0b3IgKG9wdHMgPSB7fSwgc2hvdWxkVmFsaWRhdGVDYXBzID0gdHJ1ZSkge1xuICAgIHN1cGVyKCk7XG5cbiAgICAvLyBzZXR1cCBzdGF0ZVxuICAgIHRoaXMuc2Vzc2lvbklkID0gbnVsbDtcbiAgICB0aGlzLm9wdHMgPSBvcHRzO1xuICAgIHRoaXMuY2FwcyA9IG51bGw7XG4gICAgdGhpcy5oZWxwZXJzID0gaGVscGVycztcblxuICAgIC8vIGJhc2VQYXRoIGlzIHVzZWQgZm9yIHNldmVyYWwgcHVycG9zZXMsIGZvciBleGFtcGxlIGluIHNldHRpbmcgdXBcbiAgICAvLyBwcm94eWluZyB0byBvdGhlciBkcml2ZXJzLCBzaW5jZSB3ZSBuZWVkIHRvIGtub3cgd2hhdCB0aGUgYmFzZSBwYXRoXG4gICAgLy8gb2YgYW55IGluY29taW5nIHJlcXVlc3QgbWlnaHQgbG9vayBsaWtlLiBXZSBzZXQgaXQgdG8gdGhlIGRlZmF1bHRcbiAgICAvLyBpbml0aWFsbHkgYnV0IGl0IGlzIGF1dG9tYXRpY2FsbHkgdXBkYXRlZCBkdXJpbmcgYW55IGFjdHVhbCBwcm9ncmFtXG4gICAgLy8gZXhlY3V0aW9uIGJ5IHRoZSByb3V0ZUNvbmZpZ3VyaW5nRnVuY3Rpb24sIHdoaWNoIGlzIG5lY2Vzc2FyaWx5IHJ1biBhc1xuICAgIC8vIHRoZSBlbnRyeXBvaW50IGZvciBhbnkgQXBwaXVtIHNlcnZlclxuICAgIHRoaXMuYmFzZVBhdGggPSBERUZBVUxUX0JBU0VfUEFUSDtcblxuICAgIC8vIGluaXRpYWxpemUgc2VjdXJpdHkgbW9kZXNcbiAgICB0aGlzLnJlbGF4ZWRTZWN1cml0eUVuYWJsZWQgPSBmYWxzZTtcbiAgICB0aGlzLmFsbG93SW5zZWN1cmUgPSBbXTtcbiAgICB0aGlzLmRlbnlJbnNlY3VyZSA9IFtdO1xuXG4gICAgLy8gdGltZW91dCBpbml0aWFsaXphdGlvblxuICAgIHRoaXMubmV3Q29tbWFuZFRpbWVvdXRNcyA9IE5FV19DT01NQU5EX1RJTUVPVVRfTVM7XG4gICAgdGhpcy5pbXBsaWNpdFdhaXRNcyA9IDA7XG5cbiAgICB0aGlzLl9jb25zdHJhaW50cyA9IF8uY2xvbmVEZWVwKGRlc2lyZWRDYXBhYmlsaXR5Q29uc3RyYWludHMpO1xuICAgIHRoaXMubG9jYXRvclN0cmF0ZWdpZXMgPSBbXTtcbiAgICB0aGlzLndlYkxvY2F0b3JTdHJhdGVnaWVzID0gW107XG5cbiAgICAvLyB1c2UgYSBjdXN0b20gdG1wIGRpciB0byBhdm9pZCBsb3NpbmcgZGF0YSBhbmQgYXBwIHdoZW4gY29tcHV0ZXIgaXNcbiAgICAvLyByZXN0YXJ0ZWRcbiAgICB0aGlzLm9wdHMudG1wRGlyID0gdGhpcy5vcHRzLnRtcERpciB8fFxuICAgICAgICAgICAgICAgICAgICAgICBwcm9jZXNzLmVudi5BUFBJVU1fVE1QX0RJUiB8fFxuICAgICAgICAgICAgICAgICAgICAgICBvcy50bXBkaXIoKTtcblxuICAgIC8vIGJhc2UtZHJpdmVyIGludGVybmFsc1xuICAgIHRoaXMuc2h1dGRvd25VbmV4cGVjdGVkbHkgPSBmYWxzZTtcbiAgICB0aGlzLm5vQ29tbWFuZFRpbWVyID0gbnVsbDtcbiAgICB0aGlzLnNob3VsZFZhbGlkYXRlQ2FwcyA9IHNob3VsZFZhbGlkYXRlQ2FwcztcbiAgICB0aGlzLmNvbW1hbmRzUXVldWVHdWFyZCA9IG5ldyBBc3luY0xvY2soKTtcblxuICAgIC8vIHNldHRpbmdzIHNob3VsZCBiZSBpbnN0YW50aWF0ZWQgYnkgZHJpdmVycyB3aGljaCBleHRlbmQgQmFzZURyaXZlciwgYnV0XG4gICAgLy8gd2Ugc2V0IGl0IHRvIGFuIGVtcHR5IERldmljZVNldHRpbmdzIGluc3RhbmNlIGhlcmUgdG8gbWFrZSBzdXJlIHRoYXQgdGhlXG4gICAgLy8gZGVmYXVsdCBzZXR0aW5ncyBhcmUgYXBwbGllZCBldmVuIGlmIGFuIGV4dGVuZGluZyBkcml2ZXIgZG9lc24ndCB1dGlsaXplXG4gICAgLy8gdGhlIHNldHRpbmdzIGZ1bmN0aW9uYWxpdHkgaXRzZWxmXG4gICAgdGhpcy5zZXR0aW5ncyA9IG5ldyBEZXZpY2VTZXR0aW5ncyh7fSwgXy5ub29wKTtcblxuICAgIC8vIGtlZXBpbmcgdHJhY2sgb2YgaW5pdGlhbCBvcHRzXG4gICAgdGhpcy5pbml0aWFsT3B0cyA9IF8uY2xvbmVEZWVwKHRoaXMub3B0cyk7XG5cbiAgICAvLyBhbGxvdyBzdWJjbGFzc2VzIHRvIGhhdmUgaW50ZXJuYWwgZHJpdmVyc1xuICAgIHRoaXMubWFuYWdlZERyaXZlcnMgPSBbXTtcblxuICAgIC8vIHN0b3JlIGV2ZW50IHRpbWluZ3NcbiAgICB0aGlzLl9ldmVudEhpc3RvcnkgPSB7XG4gICAgICBjb21tYW5kczogW10gLy8gY29tbWFuZHMgZ2V0IGEgc3BlY2lhbCBwbGFjZVxuICAgIH07XG5cbiAgICAvLyBjYWNoZSB0aGUgaW1hZ2UgZWxlbWVudHNcbiAgICB0aGlzLl9pbWdFbENhY2hlID0gbWFrZUltYWdlRWxlbWVudENhY2hlKCk7XG5cbiAgICAvLyB1c2VkIHRvIGhhbmRsZSBkcml2ZXIgZXZlbnRzXG4gICAgdGhpcy5ldmVudEVtaXR0ZXIgPSBuZXcgRXZlbnRFbWl0dGVyKCk7XG5cbiAgICB0aGlzLnByb3RvY29sID0gbnVsbDtcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXQgYSBjYWxsYmFjayBoYW5kbGVyIGlmIG5lZWRlZCB0byBleGVjdXRlIGEgY3VzdG9tIHBpZWNlIG9mIGNvZGVcbiAgICogd2hlbiB0aGUgZHJpdmVyIGlzIHNodXQgZG93biB1bmV4cGVjdGVkbHkuIE11bHRpcGxlIGNhbGxzIHRvIHRoaXMgbWV0aG9kXG4gICAqIHdpbGwgY2F1c2UgdGhlIGhhbmRsZXIgdG8gYmUgZXhlY3V0ZWQgbXV0aXBsZSB0aW1lc1xuICAgKlxuICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBoYW5kbGVyIFRoZSBjb2RlIHRvIGJlIGV4ZWN1dGVkIG9uIHVuZXhwZWN0ZWQgc2h1dGRvd24uXG4gICAqIFRoZSBmdW5jdGlvbiBtYXkgYWNjZXB0IG9uZSBhcmd1bWVudCwgd2hpY2ggaXMgdGhlIGFjdHVhbCBlcnJvciBpbnN0YW5jZSwgd2hpY2hcbiAgICogY2F1c2VkIHRoZSBkcml2ZXIgdG8gc2h1dCBkb3duLlxuICAgKi9cbiAgb25VbmV4cGVjdGVkU2h1dGRvd24gKGhhbmRsZXIpIHtcbiAgICB0aGlzLmV2ZW50RW1pdHRlci5vbihPTl9VTkVYUEVDVEVEX1NIVVRET1dOX0VWRU5ULCBoYW5kbGVyKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBUaGlzIHByb3BlcnR5IGlzIHVzZWQgYnkgQXBwaXVtRHJpdmVyIHRvIHN0b3JlIHRoZSBkYXRhIG9mIHRoZVxuICAgKiBzcGVjaWZpYyBkcml2ZXIgc2Vzc2lvbnMuIFRoaXMgZGF0YSBjYW4gYmUgbGF0ZXIgdXNlZCB0byBhZGp1c3RcbiAgICogcHJvcGVydGllcyBmb3IgZHJpdmVyIGluc3RhbmNlcyBydW5uaW5nIGluIHBhcmFsbGVsLlxuICAgKiBPdmVycmlkZSBpdCBpbiBpbmhlcml0ZWQgZHJpdmVyIGNsYXNzZXMgaWYgbmVjZXNzYXJ5LlxuICAgKlxuICAgKiBAcmV0dXJuIHtvYmplY3R9IERyaXZlciBwcm9wZXJ0aWVzIG1hcHBpbmdcbiAgICovXG4gIGdldCBkcml2ZXJEYXRhICgpIHtcbiAgICByZXR1cm4ge307XG4gIH1cblxuICAvKipcbiAgICogVGhpcyBwcm9wZXJ0eSBjb250cm9scyB0aGUgd2F5IHsjZXhlY3V0ZUNvbW1hbmR9IG1ldGhvZFxuICAgKiBoYW5kbGVzIG5ldyBkcml2ZXIgY29tbWFuZHMgcmVjZWl2ZWQgZnJvbSB0aGUgY2xpZW50LlxuICAgKiBPdmVycmlkZSBpdCBmb3IgaW5oZXJpdGVkIGNsYXNzZXMgb25seSBpbiBzcGVjaWFsIGNhc2VzLlxuICAgKlxuICAgKiBAcmV0dXJuIHtib29sZWFufSBJZiB0aGUgcmV0dXJuZWQgdmFsdWUgaXMgdHJ1ZSAoZGVmYXVsdCkgdGhlbiBhbGwgdGhlIGNvbW1hbmRzXG4gICAqICAgcmVjZWl2ZWQgYnkgdGhlIHBhcnRpY3VsYXIgZHJpdmVyIGluc3RhbmNlIGFyZSBnb2luZyB0byBiZSBwdXQgaW50byB0aGUgcXVldWUsXG4gICAqICAgc28gZWFjaCBmb2xsb3dpbmcgY29tbWFuZCB3aWxsIG5vdCBiZSBleGVjdXRlZCB1bnRpbCB0aGUgcHJldmlvdXMgY29tbWFuZFxuICAgKiAgIGV4ZWN1dGlvbiBpcyBjb21wbGV0ZWQuIEZhbHNlIHZhbHVlIGRpc2FibGVzIHRoYXQgcXVldWUsIHNvIGVhY2ggZHJpdmVyIGNvbW1hbmRcbiAgICogICBpcyBleGVjdXRlZCBpbmRlcGVuZGVudGx5IGFuZCBkb2VzIG5vdCB3YWl0IGZvciBhbnl0aGluZy5cbiAgICovXG4gIGdldCBpc0NvbW1hbmRzUXVldWVFbmFibGVkICgpIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIC8qXG4gICAqIG1ha2UgZXZlbnRIaXN0b3J5IGEgcHJvcGVydHkgYW5kIHJldHVybiBhIGNsb25lZCBvYmplY3Qgc28gYSBjb25zdW1lciBjYW4ndFxuICAgKiBpbmFkdmVydGVudGx5IGNoYW5nZSBkYXRhIG91dHNpZGUgb2YgbG9nRXZlbnRcbiAgICovXG4gIGdldCBldmVudEhpc3RvcnkgKCkge1xuICAgIHJldHVybiBfLmNsb25lRGVlcCh0aGlzLl9ldmVudEhpc3RvcnkpO1xuICB9XG5cbiAgLypcbiAgICogQVBJIG1ldGhvZCBmb3IgZHJpdmVyIGRldmVsb3BlcnMgdG8gbG9nIHRpbWluZ3MgZm9yIGltcG9ydGFudCBldmVudHNcbiAgICovXG4gIGxvZ0V2ZW50IChldmVudE5hbWUpIHtcbiAgICBpZiAoZXZlbnROYW1lID09PSAnY29tbWFuZHMnKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0Nhbm5vdCBsb2cgY29tbWFuZHMgZGlyZWN0bHknKTtcbiAgICB9XG4gICAgaWYgKHR5cGVvZiBldmVudE5hbWUgIT09ICdzdHJpbmcnKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgZXZlbnROYW1lICR7ZXZlbnROYW1lfWApO1xuICAgIH1cbiAgICBpZiAoIXRoaXMuX2V2ZW50SGlzdG9yeVtldmVudE5hbWVdKSB7XG4gICAgICB0aGlzLl9ldmVudEhpc3RvcnlbZXZlbnROYW1lXSA9IFtdO1xuICAgIH1cbiAgICBjb25zdCB0cyA9IERhdGUubm93KCk7XG4gICAgY29uc3QgbG9nVGltZSA9IChuZXcgRGF0ZSh0cykpLnRvVGltZVN0cmluZygpO1xuICAgIHRoaXMuX2V2ZW50SGlzdG9yeVtldmVudE5hbWVdLnB1c2godHMpO1xuICAgIGxvZy5kZWJ1ZyhgRXZlbnQgJyR7ZXZlbnROYW1lfScgbG9nZ2VkIGF0ICR7dHN9ICgke2xvZ1RpbWV9KWApO1xuICB9XG5cbiAgLypcbiAgICogT3ZlcnJpZGRlbiBpbiBhcHBpdW0gZHJpdmVyLCBidXQgaGVyZSBzbyB0aGF0IGluZGl2aWR1YWwgZHJpdmVycyBjYW4gYmVcbiAgICogdGVzdGVkIHdpdGggY2xpZW50cyB0aGF0IHBvbGxcbiAgICovXG4gIGFzeW5jIGdldFN0YXR1cyAoKSB7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgcmVxdWlyZS1hd2FpdFxuICAgIHJldHVybiB7fTtcbiAgfVxuXG4gIC8vIHdlIG9ubHkgd2FudCBzdWJjbGFzc2VzIHRvIGV2ZXIgZXh0ZW5kIHRoZSBjb250cmFpbnRzXG4gIHNldCBkZXNpcmVkQ2FwQ29uc3RyYWludHMgKGNvbnN0cmFpbnRzKSB7XG4gICAgdGhpcy5fY29uc3RyYWludHMgPSBPYmplY3QuYXNzaWduKHRoaXMuX2NvbnN0cmFpbnRzLCBjb25zdHJhaW50cyk7XG4gICAgLy8gJ3ByZXNlbmNlJyBtZWFucyBkaWZmZXJlbnQgdGhpbmdzIGluIGRpZmZlcmVudCB2ZXJzaW9ucyBvZiB0aGUgdmFsaWRhdG9yLFxuICAgIC8vIHdoZW4gd2Ugc2F5ICd0cnVlJyB3ZSBtZWFuIHRoYXQgaXQgc2hvdWxkIG5vdCBiZSBhYmxlIHRvIGJlIGVtcHR5XG4gICAgZm9yIChjb25zdCBbLCB2YWx1ZV0gb2YgXy50b1BhaXJzKHRoaXMuX2NvbnN0cmFpbnRzKSkge1xuICAgICAgaWYgKHZhbHVlICYmIHZhbHVlLnByZXNlbmNlID09PSB0cnVlKSB7XG4gICAgICAgIHZhbHVlLnByZXNlbmNlID0ge1xuICAgICAgICAgIGFsbG93RW1wdHk6IGZhbHNlLFxuICAgICAgICB9O1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGdldCBkZXNpcmVkQ2FwQ29uc3RyYWludHMgKCkge1xuICAgIHJldHVybiB0aGlzLl9jb25zdHJhaW50cztcbiAgfVxuXG4gIC8vIG1ldGhvZCByZXF1aXJlZCBieSBNSlNPTldQIGluIG9yZGVyIHRvIGRldGVybWluZSB3aGV0aGVyIGl0IHNob3VsZFxuICAvLyByZXNwb25kIHdpdGggYW4gaW52YWxpZCBzZXNzaW9uIHJlc3BvbnNlXG4gIHNlc3Npb25FeGlzdHMgKHNlc3Npb25JZCkge1xuICAgIGlmICghc2Vzc2lvbklkKSByZXR1cm4gZmFsc2U7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgY3VybHlcbiAgICByZXR1cm4gc2Vzc2lvbklkID09PSB0aGlzLnNlc3Npb25JZDtcbiAgfVxuXG4gIC8vIG1ldGhvZCByZXF1aXJlZCBieSBNSlNPTldQIGluIG9yZGVyIHRvIGRldGVybWluZSBpZiB0aGUgY29tbWFuZCBzaG91bGRcbiAgLy8gYmUgcHJveGllZCBkaXJlY3RseSB0byB0aGUgZHJpdmVyXG4gIGRyaXZlckZvclNlc3Npb24gKC8qc2Vzc2lvbklkKi8pIHtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIGxvZ0V4dHJhQ2FwcyAoY2Fwcykge1xuICAgIGxldCBleHRyYUNhcHMgPSBfLmRpZmZlcmVuY2UoXy5rZXlzKGNhcHMpLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXy5rZXlzKHRoaXMuX2NvbnN0cmFpbnRzKSk7XG4gICAgaWYgKGV4dHJhQ2Fwcy5sZW5ndGgpIHtcbiAgICAgIGxvZy53YXJuKGBUaGUgZm9sbG93aW5nIGNhcGFiaWxpdGllcyB3ZXJlIHByb3ZpZGVkLCBidXQgYXJlIG5vdCBgICtcbiAgICAgICAgICAgICAgIGByZWNvZ25pemVkIGJ5IEFwcGl1bTpgKTtcbiAgICAgIGZvciAoY29uc3QgY2FwIG9mIGV4dHJhQ2Fwcykge1xuICAgICAgICBsb2cud2FybihgICAke2NhcH1gKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICB2YWxpZGF0ZURlc2lyZWRDYXBzIChjYXBzKSB7XG4gICAgaWYgKCF0aGlzLnNob3VsZFZhbGlkYXRlQ2Fwcykge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIHZhbGlkYXRlQ2FwcyhjYXBzLCB0aGlzLl9jb25zdHJhaW50cyk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgbG9nLmVycm9yQW5kVGhyb3cobmV3IGVycm9ycy5TZXNzaW9uTm90Q3JlYXRlZEVycm9yKGBUaGUgZGVzaXJlZENhcGFiaWxpdGllcyBvYmplY3Qgd2FzIG5vdCB2YWxpZCBmb3IgdGhlIGAgK1xuICAgICAgICAgICAgICAgICAgICBgZm9sbG93aW5nIHJlYXNvbihzKTogJHtlLm1lc3NhZ2V9YCkpO1xuICAgIH1cblxuICAgIHRoaXMubG9nRXh0cmFDYXBzKGNhcHMpO1xuXG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICBpc01qc29ud3BQcm90b2NvbCAoKSB7XG4gICAgcmV0dXJuIHRoaXMucHJvdG9jb2wgPT09IFBST1RPQ09MUy5NSlNPTldQO1xuICB9XG5cbiAgaXNXM0NQcm90b2NvbCAoKSB7XG4gICAgcmV0dXJuIHRoaXMucHJvdG9jb2wgPT09IFBST1RPQ09MUy5XM0M7XG4gIH1cblxuICBzZXRQcm90b2NvbE1KU09OV1AgKCkge1xuICAgIHRoaXMucHJvdG9jb2wgPSBQUk9UT0NPTFMuTUpTT05XUDtcbiAgfVxuXG4gIHNldFByb3RvY29sVzNDICgpIHtcbiAgICB0aGlzLnByb3RvY29sID0gUFJPVE9DT0xTLlczQztcbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVjayB3aGV0aGVyIGEgZ2l2ZW4gZmVhdHVyZSBpcyBlbmFibGVkIHZpYSBpdHMgbmFtZVxuICAgKlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIG5hbWUgb2YgZmVhdHVyZS9jb21tYW5kXG4gICAqXG4gICAqIEByZXR1cm5zIHtCb29sZWFufVxuICAgKi9cbiAgaXNGZWF0dXJlRW5hYmxlZCAobmFtZSkge1xuICAgIC8vIGlmIHdlIGhhdmUgZXhwbGljaXRseSBkZW5pZWQgdGhpcyBmZWF0dXJlLCByZXR1cm4gZmFsc2UgaW1tZWRpYXRlbHlcbiAgICBpZiAodGhpcy5kZW55SW5zZWN1cmUgJiYgXy5pbmNsdWRlcyh0aGlzLmRlbnlJbnNlY3VyZSwgbmFtZSkpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICAvLyBpZiB3ZSBzcGVjaWZpY2FsbHkgaGF2ZSBhbGxvd2VkIHRoZSBmZWF0dXJlLCByZXR1cm4gdHJ1ZVxuICAgIGlmICh0aGlzLmFsbG93SW5zZWN1cmUgJiYgXy5pbmNsdWRlcyh0aGlzLmFsbG93SW5zZWN1cmUsIG5hbWUpKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICAvLyBvdGhlcndpc2UsIGlmIHdlJ3ZlIGdsb2JhbGx5IGFsbG93ZWQgaW5zZWN1cmUgZmVhdHVyZXMgYW5kIG5vdCBkZW5pZWRcbiAgICAvLyB0aGlzIG9uZSwgcmV0dXJuIHRydWVcbiAgICBpZiAodGhpcy5yZWxheGVkU2VjdXJpdHlFbmFibGVkKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICAvLyBpZiB3ZSBoYXZlbid0IGFsbG93ZWQgYW55dGhpbmcgaW5zZWN1cmUsIHRoZW4gcmVqZWN0XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgLyoqXG4gICAqIEFzc2VydCB0aGF0IGEgZ2l2ZW4gZmVhdHVyZSBpcyBlbmFibGVkIGFuZCB0aHJvdyBhIGhlbHBmdWwgZXJyb3IgaWYgaXQnc1xuICAgKiBub3RcbiAgICpcbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBuYW1lIG9mIGZlYXR1cmUvY29tbWFuZFxuICAgKi9cbiAgZW5zdXJlRmVhdHVyZUVuYWJsZWQgKG5hbWUpIHtcbiAgICBpZiAoIXRoaXMuaXNGZWF0dXJlRW5hYmxlZChuYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBQb3RlbnRpYWxseSBpbnNlY3VyZSBmZWF0dXJlICcke25hbWV9JyBoYXMgbm90IGJlZW4gYCArXG4gICAgICAgICAgICAgICAgICAgICAgYGVuYWJsZWQuIElmIHlvdSB3YW50IHRvIGVuYWJsZSB0aGlzIGZlYXR1cmUgYW5kIGFjY2VwdCBgICtcbiAgICAgICAgICAgICAgICAgICAgICBgdGhlIHNlY3VyaXR5IHJhbWlmaWNhdGlvbnMsIHBsZWFzZSBkbyBzbyBieSBmb2xsb3dpbmcgYCArXG4gICAgICAgICAgICAgICAgICAgICAgYHRoZSBkb2N1bWVudGVkIGluc3RydWN0aW9ucyBhdCBodHRwczovL2dpdGh1Yi5jb20vYXBwaXVtYCArXG4gICAgICAgICAgICAgICAgICAgICAgYC9hcHBpdW0vYmxvYi9tYXN0ZXIvZG9jcy9lbi93cml0aW5nLXJ1bm5pbmctYXBwaXVtL3NlY3VyaXR5Lm1kYCk7XG4gICAgfVxuICB9XG5cbiAgLy8gVGhpcyBpcyB0aGUgbWFpbiBjb21tYW5kIGhhbmRsZXIgZm9yIHRoZSBkcml2ZXIuIEl0IHdyYXBzIGNvbW1hbmRcbiAgLy8gZXhlY3V0aW9uIHdpdGggdGltZW91dCBsb2dpYywgY2hlY2tpbmcgdGhhdCB3ZSBoYXZlIGEgdmFsaWQgc2Vzc2lvbixcbiAgLy8gYW5kIGVuc3VyaW5nIHRoYXQgd2UgZXhlY3V0ZSBjb21tYW5kcyBvbmUgYXQgYSB0aW1lLiBUaGlzIG1ldGhvZCBpcyBjYWxsZWRcbiAgLy8gYnkgTUpTT05XUCdzIGV4cHJlc3Mgcm91dGVyLlxuICBhc3luYyBleGVjdXRlQ29tbWFuZCAoY21kLCAuLi5hcmdzKSB7XG4gICAgLy8gZ2V0IHN0YXJ0IHRpbWUgZm9yIHRoaXMgY29tbWFuZCwgYW5kIGxvZyBpbiBzcGVjaWFsIGNhc2VzXG4gICAgbGV0IHN0YXJ0VGltZSA9IERhdGUubm93KCk7XG4gICAgaWYgKGNtZCA9PT0gJ2NyZWF0ZVNlc3Npb24nKSB7XG4gICAgICAvLyBJZiBjcmVhdGluZyBhIHNlc3Npb24gZGV0ZXJtaW5lIGlmIFczQyBvciBNSlNPTldQIHByb3RvY29sIHdhcyByZXF1ZXN0ZWQgYW5kIHJlbWVtYmVyIHRoZSBjaG9pY2VcbiAgICAgIHRoaXMucHJvdG9jb2wgPSBkZXRlcm1pbmVQcm90b2NvbCguLi5hcmdzKTtcbiAgICAgIHRoaXMubG9nRXZlbnQoRVZFTlRfU0VTU0lPTl9JTklUKTtcbiAgICB9IGVsc2UgaWYgKGNtZCA9PT0gJ2RlbGV0ZVNlc3Npb24nKSB7XG4gICAgICB0aGlzLmxvZ0V2ZW50KEVWRU5UX1NFU1NJT05fUVVJVF9TVEFSVCk7XG4gICAgfVxuXG4gICAgLy8gaWYgd2UgaGFkIGEgY29tbWFuZCB0aW1lciBydW5uaW5nLCBjbGVhciBpdCBub3cgdGhhdCB3ZSdyZSBzdGFydGluZ1xuICAgIC8vIGEgbmV3IGNvbW1hbmQgYW5kIHNvIGRvbid0IHdhbnQgdG8gdGltZSBvdXRcbiAgICB0aGlzLmNsZWFyTmV3Q29tbWFuZFRpbWVvdXQoKTtcblxuICAgIGlmICh0aGlzLnNodXRkb3duVW5leHBlY3RlZGx5KSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLk5vU3VjaERyaXZlckVycm9yKCdUaGUgZHJpdmVyIHdhcyB1bmV4cGVjdGVkbHkgc2h1dCBkb3duIScpO1xuICAgIH1cblxuICAgIC8vIElmIHdlIGRvbid0IGhhdmUgdGhpcyBjb21tYW5kLCBpdCBtdXN0IG5vdCBiZSBpbXBsZW1lbnRlZFxuICAgIC8vIElmIHRoZSB0YXJnZXQgZWxlbWVudCBpcyBJbWFnZUVsZW1lbnQsIHdlIG11c3QgdHJ5IHRvIGNhbGwgYEltYWdlRWxlbWVudC5leGVjdXRlYCB3aGljaCBleGlzdCBmb2xsb3dpbmcgbGluZXNcbiAgICAvLyBzaW5jZSBJbWFnZUVsZW1lbnQgc3VwcG9ydHMgZmV3IGNvbW1hbmRzIGJ5IGl0c2VsZlxuICAgIGNvbnN0IGltZ0VsSWQgPSBnZXRJbWdFbEZyb21BcmdzKGFyZ3MpO1xuICAgIGlmICghdGhpc1tjbWRdICYmICFpbWdFbElkKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLk5vdFlldEltcGxlbWVudGVkRXJyb3IoKTtcbiAgICB9XG5cbiAgICBsZXQgdW5leHBlY3RlZFNodXRkb3duTGlzdGVuZXI7XG4gICAgY29uc3QgY29tbWFuZEV4ZWN1dG9yID0gYXN5bmMgKCkgPT4gaW1nRWxJZFxuICAgICAgPyBhd2FpdCBJbWFnZUVsZW1lbnQuZXhlY3V0ZSh0aGlzLCBjbWQsIGltZ0VsSWQsIC4uLmFyZ3MpXG4gICAgICA6IGF3YWl0IEIucmFjZShbXG4gICAgICAgIHRoaXNbY21kXSguLi5hcmdzKSxcbiAgICAgICAgbmV3IEIoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICAgIHVuZXhwZWN0ZWRTaHV0ZG93bkxpc3RlbmVyID0gcmVqZWN0O1xuICAgICAgICAgIHRoaXMuZXZlbnRFbWl0dGVyLm9uKE9OX1VORVhQRUNURURfU0hVVERPV05fRVZFTlQsIHVuZXhwZWN0ZWRTaHV0ZG93bkxpc3RlbmVyKTtcbiAgICAgICAgfSlcbiAgICAgIF0pLmZpbmFsbHkoKCkgPT4ge1xuICAgICAgICBpZiAodW5leHBlY3RlZFNodXRkb3duTGlzdGVuZXIpIHtcbiAgICAgICAgICAvLyBUaGlzIGlzIG5lZWRlZCB0byBwcmV2ZW50IG1lbW9yeSBsZWFrc1xuICAgICAgICAgIHRoaXMuZXZlbnRFbWl0dGVyLnJlbW92ZUxpc3RlbmVyKE9OX1VORVhQRUNURURfU0hVVERPV05fRVZFTlQsIHVuZXhwZWN0ZWRTaHV0ZG93bkxpc3RlbmVyKTtcbiAgICAgICAgICB1bmV4cGVjdGVkU2h1dGRvd25MaXN0ZW5lciA9IG51bGw7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIGNvbnN0IHJlcyA9IHRoaXMuaXNDb21tYW5kc1F1ZXVlRW5hYmxlZCAmJiBjbWQgIT09ICdleGVjdXRlRHJpdmVyU2NyaXB0J1xuICAgICAgPyBhd2FpdCB0aGlzLmNvbW1hbmRzUXVldWVHdWFyZC5hY3F1aXJlKEJhc2VEcml2ZXIubmFtZSwgY29tbWFuZEV4ZWN1dG9yKVxuICAgICAgOiBhd2FpdCBjb21tYW5kRXhlY3V0b3IoKTtcblxuICAgIC8vIGlmIHdlIGhhdmUgc2V0IGEgbmV3IGNvbW1hbmQgdGltZW91dCAod2hpY2ggaXMgdGhlIGRlZmF1bHQpLCBzdGFydCBhXG4gICAgLy8gdGltZXIgb25jZSB3ZSd2ZSBmaW5pc2hlZCBleGVjdXRpbmcgdGhpcyBjb21tYW5kLiBJZiB3ZSBkb24ndCBjbGVhclxuICAgIC8vIHRoZSB0aW1lciAod2hpY2ggaXMgZG9uZSB3aGVuIGEgbmV3IGNvbW1hbmQgY29tZXMgaW4pLCB3ZSB3aWxsIHRyaWdnZXJcbiAgICAvLyBhdXRvbWF0aWMgc2Vzc2lvbiBkZWxldGlvbiBpbiB0aGlzLm9uQ29tbWFuZFRpbWVvdXQuIE9mIGNvdXJzZSB3ZSBkb24ndFxuICAgIC8vIHdhbnQgdG8gdHJpZ2dlciB0aGUgdGltZXIgd2hlbiB0aGUgdXNlciBpcyBzaHV0dGluZyBkb3duIHRoZSBzZXNzaW9uXG4gICAgLy8gaW50ZW50aW9uYWxseVxuICAgIGlmICh0aGlzLmlzQ29tbWFuZHNRdWV1ZUVuYWJsZWQgJiYgY21kICE9PSAnZGVsZXRlU2Vzc2lvbicpIHtcbiAgICAgIC8vIHJlc2V0dGluZyBleGlzdGluZyB0aW1lb3V0XG4gICAgICB0aGlzLnN0YXJ0TmV3Q29tbWFuZFRpbWVvdXQoKTtcbiAgICB9XG5cbiAgICAvLyBsb2cgdGltaW5nIGluZm9ybWF0aW9uIGFib3V0IHRoaXMgY29tbWFuZFxuICAgIGNvbnN0IGVuZFRpbWUgPSBEYXRlLm5vdygpO1xuICAgIHRoaXMuX2V2ZW50SGlzdG9yeS5jb21tYW5kcy5wdXNoKHtjbWQsIHN0YXJ0VGltZSwgZW5kVGltZX0pO1xuICAgIGlmIChjbWQgPT09ICdjcmVhdGVTZXNzaW9uJykge1xuICAgICAgdGhpcy5sb2dFdmVudChFVkVOVF9TRVNTSU9OX1NUQVJUKTtcblxuICAgICAgaWYocmVzICE9IHVuZGVmaW5lZCAmJiByZXMudmFsdWUgIT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGxvZy5pbmZvKFwic3RvcHBpbmcgZmFsbGJhY2sgc2Vzc2lvbiByZWNvcmRpbmdcIik7XG4gICAgICAgIC8vIHN0b3BwaW5nIGFuZCByZW1vdmluZyBmYWxsYmFjayByZWNvcmRpbmdcbiAgICAgICAgY29uc3Qgc3RvcF9yZWNfY29tbWFuZCA9IGBzaCAvb3B0L3N0b3AtY2FwdHVyZS1hcnRpZmFjdHMuc2hgO1xuICAgICAgICBleGVjdXRlU2hlbGwoc3RvcF9yZWNfY29tbWFuZCwgJ3N0b3AgdmlkZW8gcmVjb3JkaW5nJyk7XG4gICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gc2V0VGltZW91dChyZXNvbHZlLCAzMDApKTtcbiAgICAgICAgLy8gc3RhcnRpbmcgbmV3IHNlc3Npb24gcmVjb3JkaW5nXG4gICAgICAgIGxvZy5pbmZvKFwic3RhcnRpbmcgbmV3IHZpZGVvIHJlY29yZGluZyBvbiBzZXNzaW9uIGluaXRcIilcbiAgICAgICAgY29uc3Qgc3RhcnRfcmVjX2NvbW1hbmQgPSBgc2ggL29wdC9jYXB0dXJlLWFydGlmYWN0cy5zaCAke3Jlcy52YWx1ZVswXX1gO1xuICAgICAgICBleGVjdXRlU2hlbGwoc3RhcnRfcmVjX2NvbW1hbmQsICdzdGFydCB2aWRlbyByZWNvcmRpbmcnKTtcbiAgICAgIH1cblxuXG4gICAgICAvLyBsZXQgc2Vzc2lvbklkID0gcmVzLnZhbHVlWzBdO1xuICAgICAgLy8gLy8gY29uc3QgdmlkZW9GaWxlPVwiQUFBXCI7XG4gICAgICAvLyBjb25zdCBwYXJ0PTA7XG4gICAgICAvLyBjb25zdCBTQ1JFRU5SRUNPUkRfT1BUUyA9ICcnO1xuICAgICAgLy8gY29uc3Qgc3RhcnRfcmVjX2NvbW1hbmQgPSBgYWRiIHNoZWxsIFwic2NyZWVucmVjb3JkIC0tdmVyYm9zZSAke1NDUkVFTlJFQ09SRF9PUFRTfSAvc2RjYXJkLyR7c2Vzc2lvbklkfV8ke3BhcnR9Lm1wNFwiYDtcblxuICAgICAgLy8gbG9nLmluZm8oYENVU1RPTTQhISBzZXNzaW9uIGlkICR7cmVzLnZhbHVlWzBdfWApO1xuICAgICAgLy8gLy8gY29uc29sZS5sb2cocmVzKTtcbiAgICAgIC8vIGxvZy5pbmZvKCdzdGFydGluZyB2aWRlbyByZWNvcmRpbmcgZm9yIHRoZSBzZXNzaW9uJylcbiAgICAgIC8vIGV4ZWMoc3RhcnRfcmVjX2NvbW1hbmQsIChlcnJvciwgc3Rkb3V0LCBzdGRlcnIpID0+IHtcbiAgICAgIC8vICAgaWYgKGVycm9yKSB7XG4gICAgICAvLyAgICAgICBsb2cuaW5mbyhgc3RhcnQgdmlkZW8gcmVjb3JkaW5nIGVycm9yOiAke2Vycm9yLm1lc3NhZ2V9YCk7XG4gICAgICAvLyAgICAgICAvLyByZXR1cm47XG4gICAgICAvLyAgIH1cbiAgICAgIC8vICAgaWYgKHN0ZGVycikge1xuICAgICAgLy8gICAgICAgbG9nLmluZm8oYHN0YXJ0IHZpZGVvIHJlY29yZGluZyBzdGRlcnI6ICR7c3RkZXJyfWApO1xuICAgICAgLy8gICAgICAgLy8gcmV0dXJuO1xuICAgICAgLy8gICB9XG4gICAgICAvLyAgIGxvZy5pbmZvKCd2aWRlbyByZWNvcmRpbmcgd2FzIHN1Y2Nlc3NmdWxseSBzdGFydGVkJyk7XG4gICAgICAvLyB9KTtcbiAgICB9IGVsc2UgaWYgKGNtZCA9PT0gJ2RlbGV0ZVNlc3Npb24nKSB7XG4gICAgICB0aGlzLmxvZ0V2ZW50KEVWRU5UX1NFU1NJT05fUVVJVF9ET05FKTtcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzO1xuICB9XG5cbiAgYXN5bmMgc3RhcnRVbmV4cGVjdGVkU2h1dGRvd24gKGVyciA9IG5ldyBlcnJvcnMuTm9TdWNoRHJpdmVyRXJyb3IoJ1RoZSBkcml2ZXIgd2FzIHVuZXhwZWN0ZWRseSBzaHV0IGRvd24hJykpIHtcbiAgICB0aGlzLmV2ZW50RW1pdHRlci5lbWl0KE9OX1VORVhQRUNURURfU0hVVERPV05fRVZFTlQsIGVycik7IC8vIGFsbG93IG90aGVycyB0byBsaXN0ZW4gZm9yIHRoaXNcbiAgICB0aGlzLnNodXRkb3duVW5leHBlY3RlZGx5ID0gdHJ1ZTtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5kZWxldGVTZXNzaW9uKHRoaXMuc2Vzc2lvbklkKTtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5zaHV0ZG93blVuZXhwZWN0ZWRseSA9IGZhbHNlO1xuICAgIH1cbiAgfVxuXG4gIHZhbGlkYXRlTG9jYXRvclN0cmF0ZWd5IChzdHJhdGVneSwgd2ViQ29udGV4dCA9IGZhbHNlKSB7XG4gICAgbGV0IHZhbGlkU3RyYXRlZ2llcyA9IHRoaXMubG9jYXRvclN0cmF0ZWdpZXM7XG4gICAgbG9nLmRlYnVnKGBWYWxpZCBsb2NhdG9yIHN0cmF0ZWdpZXMgZm9yIHRoaXMgcmVxdWVzdDogJHt2YWxpZFN0cmF0ZWdpZXMuam9pbignLCAnKX1gKTtcblxuICAgIGlmICh3ZWJDb250ZXh0KSB7XG4gICAgICB2YWxpZFN0cmF0ZWdpZXMgPSB2YWxpZFN0cmF0ZWdpZXMuY29uY2F0KHRoaXMud2ViTG9jYXRvclN0cmF0ZWdpZXMpO1xuICAgIH1cblxuICAgIGlmICghXy5pbmNsdWRlcyh2YWxpZFN0cmF0ZWdpZXMsIHN0cmF0ZWd5KSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkU2VsZWN0b3JFcnJvcihgTG9jYXRvciBTdHJhdGVneSAnJHtzdHJhdGVneX0nIGlzIG5vdCBzdXBwb3J0ZWQgZm9yIHRoaXMgc2Vzc2lvbmApO1xuICAgIH1cbiAgfVxuXG4gIC8qXG4gICAqIFJlc3RhcnQgdGhlIHNlc3Npb24gd2l0aCB0aGUgb3JpZ2luYWwgY2FwcyxcbiAgICogcHJlc2VydmluZyB0aGUgdGltZW91dCBjb25maWcuXG4gICAqL1xuICBhc3luYyByZXNldCAoKSB7XG4gICAgbG9nLmRlYnVnKCdSZXNldHRpbmcgYXBwIG1pZC1zZXNzaW9uJyk7XG4gICAgbG9nLmRlYnVnKCdSdW5uaW5nIGdlbmVyaWMgZnVsbCByZXNldCcpO1xuXG4gICAgLy8gcHJlc2VydmluZyBzdGF0ZVxuICAgIGxldCBjdXJyZW50Q29uZmlnID0ge307XG4gICAgZm9yIChsZXQgcHJvcGVydHkgb2YgWydpbXBsaWNpdFdhaXRNcycsICduZXdDb21tYW5kVGltZW91dE1zJywgJ3Nlc3Npb25JZCcsICdyZXNldE9uVW5leHBlY3RlZFNodXRkb3duJ10pIHtcbiAgICAgIGN1cnJlbnRDb25maWdbcHJvcGVydHldID0gdGhpc1twcm9wZXJ0eV07XG4gICAgfVxuXG4gICAgLy8gV2UgYWxzbyBuZWVkIHRvIHByZXNlcnZlIHRoZSB1bmV4cGVjdGVkIHNodXRkb3duLCBhbmQgbWFrZSBzdXJlIGl0IGlzIG5vdCBjYW5jZWxsZWQgZHVyaW5nIHJlc2V0LlxuICAgIHRoaXMucmVzZXRPblVuZXhwZWN0ZWRTaHV0ZG93biA9ICgpID0+IHt9O1xuXG4gICAgLy8gQ29uc3RydWN0IHRoZSBhcmd1bWVudHMgZm9yIGNyZWF0ZVNlc3Npb24gZGVwZW5kaW5nIG9uIHRoZSBwcm90b2NvbCB0eXBlXG4gICAgY29uc3QgYXJncyA9IHRoaXMucHJvdG9jb2wgPT09IFBST1RPQ09MUy5XM0MgP1xuICAgICAgW3VuZGVmaW5lZCwgdW5kZWZpbmVkLCB7YWx3YXlzTWF0Y2g6IHRoaXMuY2FwcywgZmlyc3RNYXRjaDogW3t9XX1dIDpcbiAgICAgIFt0aGlzLmNhcHNdO1xuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuZGVsZXRlU2Vzc2lvbih0aGlzLnNlc3Npb25JZCk7XG4gICAgICBsb2cuZGVidWcoJ1Jlc3RhcnRpbmcgYXBwJyk7XG4gICAgICBhd2FpdCB0aGlzLmNyZWF0ZVNlc3Npb24oLi4uYXJncyk7XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIC8vIGFsd2F5cyByZXN0b3JlIHN0YXRlLlxuICAgICAgZm9yIChsZXQgW2tleSwgdmFsdWVdIG9mIF8udG9QYWlycyhjdXJyZW50Q29uZmlnKSkge1xuICAgICAgICB0aGlzW2tleV0gPSB2YWx1ZTtcbiAgICAgIH1cbiAgICB9XG4gICAgdGhpcy5jbGVhck5ld0NvbW1hbmRUaW1lb3V0KCk7XG4gIH1cblxuICBwcm94eUFjdGl2ZSAoLyogc2Vzc2lvbklkICovKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgZ2V0UHJveHlBdm9pZExpc3QgKC8qIHNlc3Npb25JZCAqLykge1xuICAgIHJldHVybiBbXTtcbiAgfVxuXG4gIGNhblByb3h5ICgvKiBzZXNzaW9uSWQgKi8pIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICAvKipcbiAgICogV2hldGhlciBhIGdpdmVuIGNvbW1hbmQgcm91dGUgKGV4cHJlc3NlZCBhcyBtZXRob2QgYW5kIHVybCkgc2hvdWxkIG5vdCBiZVxuICAgKiBwcm94aWVkIGFjY29yZGluZyB0byB0aGlzIGRyaXZlclxuICAgKlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2Vzc2lvbklkIC0gdGhlIGN1cnJlbnQgc2Vzc2lvbklkIChpbiBjYXNlIHRoZSBkcml2ZXIgcnVuc1xuICAgKiBtdWx0aXBsZSBzZXNzaW9uIGlkcyBhbmQgcmVxdWlyZXMgaXQpLiBUaGlzIGlzIG5vdCB1c2VkIGluIHRoaXMgbWV0aG9kIGJ1dFxuICAgKiBzaG91bGQgYmUgbWFkZSBhdmFpbGFibGUgdG8gb3ZlcnJpZGRlbiBtZXRob2RzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbWV0aG9kIC0gSFRUUCBtZXRob2Qgb2YgdGhlIHJvdXRlXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB1cmwgLSB1cmwgb2YgdGhlIHJvdXRlXG4gICAqXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIHdoZXRoZXIgdGhlIHJvdXRlIHNob3VsZCBiZSBhdm9pZGVkXG4gICAqL1xuICBwcm94eVJvdXRlSXNBdm9pZGVkIChzZXNzaW9uSWQsIG1ldGhvZCwgdXJsKSB7XG4gICAgZm9yIChsZXQgYXZvaWRTY2hlbWEgb2YgdGhpcy5nZXRQcm94eUF2b2lkTGlzdChzZXNzaW9uSWQpKSB7XG4gICAgICBpZiAoIV8uaXNBcnJheShhdm9pZFNjaGVtYSkgfHwgYXZvaWRTY2hlbWEubGVuZ3RoICE9PSAyKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignUHJveHkgYXZvaWRhbmNlIG11c3QgYmUgYSBsaXN0IG9mIHBhaXJzJyk7XG4gICAgICB9XG4gICAgICBsZXQgW2F2b2lkTWV0aG9kLCBhdm9pZFBhdGhSZWdleF0gPSBhdm9pZFNjaGVtYTtcbiAgICAgIGlmICghXy5pbmNsdWRlcyhbJ0dFVCcsICdQT1NUJywgJ0RFTEVURSddLCBhdm9pZE1ldGhvZCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbnJlY29nbml6ZWQgcHJveHkgYXZvaWRhbmNlIG1ldGhvZCAnJHthdm9pZE1ldGhvZH0nYCk7XG4gICAgICB9XG4gICAgICBpZiAoIV8uaXNSZWdFeHAoYXZvaWRQYXRoUmVnZXgpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignUHJveHkgYXZvaWRhbmNlIHBhdGggbXVzdCBiZSBhIHJlZ3VsYXIgZXhwcmVzc2lvbicpO1xuICAgICAgfVxuICAgICAgbGV0IG5vcm1hbGl6ZWRVcmwgPSB1cmwucmVwbGFjZShuZXcgUmVnRXhwKGBeJHtfLmVzY2FwZVJlZ0V4cCh0aGlzLmJhc2VQYXRoKX1gKSwgJycpO1xuICAgICAgaWYgKGF2b2lkTWV0aG9kID09PSBtZXRob2QgJiYgYXZvaWRQYXRoUmVnZXgudGVzdChub3JtYWxpemVkVXJsKSkge1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgYWRkTWFuYWdlZERyaXZlciAoZHJpdmVyKSB7XG4gICAgdGhpcy5tYW5hZ2VkRHJpdmVycy5wdXNoKGRyaXZlcik7XG4gIH1cblxuICBnZXRNYW5hZ2VkRHJpdmVycyAoKSB7XG4gICAgcmV0dXJuIHRoaXMubWFuYWdlZERyaXZlcnM7XG4gIH1cblxuICByZWdpc3RlckltYWdlRWxlbWVudCAoaW1nRWwpIHtcbiAgICB0aGlzLl9pbWdFbENhY2hlLnNldChpbWdFbC5pZCwgaW1nRWwpO1xuICAgIGNvbnN0IHByb3RvS2V5ID0gdGhpcy5pc1czQ1Byb3RvY29sKCkgPyBXM0NfRUxFTUVOVF9LRVkgOiBNSlNPTldQX0VMRU1FTlRfS0VZO1xuICAgIHJldHVybiBpbWdFbC5hc0VsZW1lbnQocHJvdG9LZXkpO1xuICB9XG59XG5cbmZvciAobGV0IFtjbWQsIGZuXSBvZiBfLnRvUGFpcnMoY29tbWFuZHMpKSB7XG4gIEJhc2VEcml2ZXIucHJvdG90eXBlW2NtZF0gPSBmbjtcbn1cblxuZXhwb3J0IHsgQmFzZURyaXZlciB9O1xuZXhwb3J0IGRlZmF1bHQgQmFzZURyaXZlcjtcbiJdLCJmaWxlIjoibGliL2Jhc2Vkcml2ZXIvZHJpdmVyLmpzIiwic291cmNlUm9vdCI6Ii4uLy4uLy4uIn0=
