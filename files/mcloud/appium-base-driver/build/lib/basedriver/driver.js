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


//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImxpYi9iYXNlZHJpdmVyL2RyaXZlci5qcyJdLCJuYW1lcyI6WyJCIiwiY29uZmlnIiwiY2FuY2VsbGF0aW9uIiwiTkVXX0NPTU1BTkRfVElNRU9VVF9NUyIsIkVWRU5UX1NFU1NJT05fSU5JVCIsIkVWRU5UX1NFU1NJT05fU1RBUlQiLCJFVkVOVF9TRVNTSU9OX1FVSVRfU1RBUlQiLCJFVkVOVF9TRVNTSU9OX1FVSVRfRE9ORSIsIk9OX1VORVhQRUNURURfU0hVVERPV05fRVZFTlQiLCJCYXNlRHJpdmVyIiwiUHJvdG9jb2wiLCJjb25zdHJ1Y3RvciIsIm9wdHMiLCJzaG91bGRWYWxpZGF0ZUNhcHMiLCJzZXNzaW9uSWQiLCJjYXBzIiwiaGVscGVycyIsImJhc2VQYXRoIiwiREVGQVVMVF9CQVNFX1BBVEgiLCJyZWxheGVkU2VjdXJpdHlFbmFibGVkIiwiYWxsb3dJbnNlY3VyZSIsImRlbnlJbnNlY3VyZSIsIm5ld0NvbW1hbmRUaW1lb3V0TXMiLCJpbXBsaWNpdFdhaXRNcyIsIl9jb25zdHJhaW50cyIsIl8iLCJjbG9uZURlZXAiLCJkZXNpcmVkQ2FwYWJpbGl0eUNvbnN0cmFpbnRzIiwibG9jYXRvclN0cmF0ZWdpZXMiLCJ3ZWJMb2NhdG9yU3RyYXRlZ2llcyIsInRtcERpciIsInByb2Nlc3MiLCJlbnYiLCJBUFBJVU1fVE1QX0RJUiIsIm9zIiwidG1wZGlyIiwic2h1dGRvd25VbmV4cGVjdGVkbHkiLCJub0NvbW1hbmRUaW1lciIsImNvbW1hbmRzUXVldWVHdWFyZCIsIkFzeW5jTG9jayIsInNldHRpbmdzIiwiRGV2aWNlU2V0dGluZ3MiLCJub29wIiwiaW5pdGlhbE9wdHMiLCJtYW5hZ2VkRHJpdmVycyIsIl9ldmVudEhpc3RvcnkiLCJjb21tYW5kcyIsIl9pbWdFbENhY2hlIiwiZXZlbnRFbWl0dGVyIiwiRXZlbnRFbWl0dGVyIiwicHJvdG9jb2wiLCJvblVuZXhwZWN0ZWRTaHV0ZG93biIsImhhbmRsZXIiLCJvbiIsImRyaXZlckRhdGEiLCJpc0NvbW1hbmRzUXVldWVFbmFibGVkIiwiZXZlbnRIaXN0b3J5IiwibG9nRXZlbnQiLCJldmVudE5hbWUiLCJFcnJvciIsInRzIiwiRGF0ZSIsIm5vdyIsImxvZ1RpbWUiLCJ0b1RpbWVTdHJpbmciLCJwdXNoIiwibG9nIiwiZGVidWciLCJnZXRTdGF0dXMiLCJnZXRTdGF0dXNXREEiLCJ3ZGFVUkwiLCJzdGF0dXMiLCJkZXNpcmVkQ2FwQ29uc3RyYWludHMiLCJjb25zdHJhaW50cyIsIk9iamVjdCIsImFzc2lnbiIsInZhbHVlIiwidG9QYWlycyIsInByZXNlbmNlIiwiYWxsb3dFbXB0eSIsInNlc3Npb25FeGlzdHMiLCJkcml2ZXJGb3JTZXNzaW9uIiwibG9nRXh0cmFDYXBzIiwiZXh0cmFDYXBzIiwiZGlmZmVyZW5jZSIsImtleXMiLCJsZW5ndGgiLCJ3YXJuIiwiY2FwIiwidmFsaWRhdGVEZXNpcmVkQ2FwcyIsImUiLCJlcnJvckFuZFRocm93IiwiZXJyb3JzIiwiU2Vzc2lvbk5vdENyZWF0ZWRFcnJvciIsIm1lc3NhZ2UiLCJpc01qc29ud3BQcm90b2NvbCIsIlBST1RPQ09MUyIsIk1KU09OV1AiLCJpc1czQ1Byb3RvY29sIiwiVzNDIiwic2V0UHJvdG9jb2xNSlNPTldQIiwic2V0UHJvdG9jb2xXM0MiLCJpc0ZlYXR1cmVFbmFibGVkIiwibmFtZSIsImluY2x1ZGVzIiwiZW5zdXJlRmVhdHVyZUVuYWJsZWQiLCJleGVjdXRlQ29tbWFuZCIsImNtZCIsImFyZ3MiLCJzdGFydFRpbWUiLCJjbGVhck5ld0NvbW1hbmRUaW1lb3V0IiwiTm9TdWNoRHJpdmVyRXJyb3IiLCJpbWdFbElkIiwiTm90WWV0SW1wbGVtZW50ZWRFcnJvciIsInVuZXhwZWN0ZWRTaHV0ZG93bkxpc3RlbmVyIiwiY29tbWFuZEV4ZWN1dG9yIiwiSW1hZ2VFbGVtZW50IiwiZXhlY3V0ZSIsInJhY2UiLCJyZXNvbHZlIiwicmVqZWN0IiwiZmluYWxseSIsImluZm8iLCJyZW1vdmVMaXN0ZW5lciIsInJlcyIsImFjcXVpcmUiLCJzdGFydE5ld0NvbW1hbmRUaW1lb3V0IiwiZW5kVGltZSIsInVuZGVmaW5lZCIsInN0YXJ0X3JlY19jb21tYW5kIiwic3RhcnRVbmV4cGVjdGVkU2h1dGRvd24iLCJlcnIiLCJlbWl0IiwiZGVsZXRlU2Vzc2lvbiIsInZhbGlkYXRlTG9jYXRvclN0cmF0ZWd5Iiwic3RyYXRlZ3kiLCJ3ZWJDb250ZXh0IiwidmFsaWRTdHJhdGVnaWVzIiwiam9pbiIsImNvbmNhdCIsIkludmFsaWRTZWxlY3RvckVycm9yIiwicmVzZXQiLCJjdXJyZW50Q29uZmlnIiwicHJvcGVydHkiLCJyZXNldE9uVW5leHBlY3RlZFNodXRkb3duIiwiYWx3YXlzTWF0Y2giLCJmaXJzdE1hdGNoIiwiY3JlYXRlU2Vzc2lvbiIsImtleSIsInByb3h5QWN0aXZlIiwiZ2V0UHJveHlBdm9pZExpc3QiLCJjYW5Qcm94eSIsInByb3h5Um91dGVJc0F2b2lkZWQiLCJtZXRob2QiLCJ1cmwiLCJhdm9pZFNjaGVtYSIsImlzQXJyYXkiLCJhdm9pZE1ldGhvZCIsImF2b2lkUGF0aFJlZ2V4IiwiaXNSZWdFeHAiLCJub3JtYWxpemVkVXJsIiwicmVwbGFjZSIsIlJlZ0V4cCIsImVzY2FwZVJlZ0V4cCIsInRlc3QiLCJhZGRNYW5hZ2VkRHJpdmVyIiwiZHJpdmVyIiwiZ2V0TWFuYWdlZERyaXZlcnMiLCJyZWdpc3RlckltYWdlRWxlbWVudCIsImltZ0VsIiwic2V0IiwiaWQiLCJwcm90b0tleSIsIlczQ19FTEVNRU5UX0tFWSIsIk1KU09OV1BfRUxFTUVOVF9LRVkiLCJhc0VsZW1lbnQiLCJmbiIsInByb3RvdHlwZSJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7QUFBQTs7QUFHQTs7QUFHQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFHQTs7QUFDQTs7QUFDQTs7Ozs7O0FBR0FBLGtCQUFFQyxNQUFGLENBQVM7QUFDUEMsRUFBQUEsWUFBWSxFQUFFO0FBRFAsQ0FBVDs7QUFJQSxNQUFNQyxzQkFB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RixFQUFTO0FBQzNCLFNBQUsxSCxXQUFMLENBQWlCMkgsR0FBakIsQ0FBcUJELEtBQUssQ0FBQ0UsRUFBM0IsRUFBK0JGLEtBQS9COztBQUNBLFVBQU1HLFFBQVEsR0FBRyxLQUFLMUUsYUFBTCxLQUF1QjJFLDBCQUF2QixHQUF5Q0MsOEJBQTFEO0FBQ0EsV0FBT0wsS0FBSyxDQUFDTSxTQUFOLENBQWdCSCxRQUFoQixDQUFQO0FBQ0Q7O0FBM2QrQjs7OztBQThkbEMsS0FBSyxJQUFJLENBQUNqRSxHQUFELEVBQU1xRSxFQUFOLENBQVQsSUFBc0J2SixnQkFBRW9ELE9BQUYsQ0FBVS9CLGlCQUFWLENBQXRCLEVBQTJDO0FBQ3pDckMsRUFBQUEsVUFBVSxDQUFDd0ssU0FBWCxDQUFxQnRFLEdBQXJCLElBQTRCcUUsRUFBNUI7QUFDRDs7ZUFHY3ZLLFUiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQge1xuICBQcm90b2NvbCwgZXJyb3JzLCBkZXRlcm1pbmVQcm90b2NvbFxufSBmcm9tICcuLi9wcm90b2NvbCc7XG5pbXBvcnQge1xuICBNSlNPTldQX0VMRU1FTlRfS0VZLCBXM0NfRUxFTUVOVF9LRVksIFBST1RPQ09MUywgREVGQVVMVF9CQVNFX1BBVEgsXG59IGZyb20gJy4uL2NvbnN0YW50cyc7XG5pbXBvcnQgb3MgZnJvbSAnb3MnO1xuaW1wb3J0IGNvbW1hbmRzIGZyb20gJy4vY29tbWFuZHMnO1xuaW1wb3J0ICogYXMgaGVscGVycyBmcm9tICcuL2hlbHBlcnMnO1xuaW1wb3J0IGxvZyBmcm9tICcuL2xvZ2dlcic7XG5pbXBvcnQgRGV2aWNlU2V0dGluZ3MgZnJvbSAnLi9kZXZpY2Utc2V0dGluZ3MnO1xuaW1wb3J0IHsgZGVzaXJlZENhcGFiaWxpdHlDb25zdHJhaW50cyB9IGZyb20gJy4vZGVzaXJlZC1jYXBzJztcbmltcG9ydCB7IHZhbGlkYXRlQ2FwcyB9IGZyb20gJy4vY2FwYWJpbGl0aWVzJztcbmltcG9ydCBCIGZyb20gJ2JsdWViaXJkJztcbmltcG9ydCBfIGZyb20gJ2xvZGFzaCc7XG5pbXBvcnQge1xuICBJbWFnZUVsZW1lbnQsIG1ha2VJbWFnZUVsZW1lbnRDYWNoZSwgZ2V0SW1nRWxGcm9tQXJnc1xufSBmcm9tICcuL2ltYWdlLWVsZW1lbnQnO1xuaW1wb3J0IEFzeW5jTG9jayBmcm9tICdhc3luYy1sb2NrJztcbmltcG9ydCB7IEV2ZW50RW1pdHRlciB9IGZyb20gJ2V2ZW50cyc7XG5pbXBvcnQgeyBleGVjdXRlU2hlbGwsIHBhcnNlV0RBVXJsLCBnZXRXREFTdGF0dXMgfSBmcm9tICcuL21jbG91ZC11dGlscyc7XG5cblxuQi5jb25maWcoe1xuICBjYW5jZWxsYXRpb246IHRydWUsXG59KTtcblxuY29uc3QgTkVXX0NPTU1BTkRfVElNRU9VVF9NUyA9IDYwICogMTAwMDtcblxuY29uc3QgRVZFTlRfU0VTU0lPTl9JTklUID0gJ25ld1Nlc3Npb25SZXF1ZXN0ZWQnO1xuY29uc3QgRVZFTlRfU0VTU0lPTl9TVEFSVCA9ICduZXdTZXNzaW9uU3RhcnRlZCc7XG5jb25zdCBFVkVOVF9TRVNTSU9OX1FVSVRfU1RBUlQgPSAncXVpdFNlc3Npb25SZXF1ZXN0ZWQnO1xuY29uc3QgRVZFTlRfU0VTU0lPTl9RVUlUX0RPTkUgPSAncXVpdFNlc3Npb25GaW5pc2hlZCc7XG5jb25zdCBPTl9VTkVYUEVDVEVEX1NIVVRET1dOX0VWRU5UID0gJ29uVW5leHBlY3RlZFNodXRkb3duJztcblxuY2xhc3MgQmFzZURyaXZlciBleHRlbmRzIFByb3RvY29sIHtcblxuICBjb25zdHJ1Y3RvciAob3B0cyA9IHt9LCBzaG91bGRWYWxpZGF0ZUNhcHMgPSB0cnVlKSB7XG4gICAgc3VwZXIoKTtcblxuICAgIC8vIHNldHVwIHN0YXRlXG4gICAgdGhpcy5zZXNzaW9uSWQgPSBudWxsO1xuICAgIHRoaXMub3B0cyA9IG9wdHM7XG4gICAgdGhpcy5jYXBzID0gbnVsbDtcbiAgICB0aGlzLmhlbHBlcnMgPSBoZWxwZXJzO1xuXG4gICAgLy8gYmFzZVBhdGggaXMgdXNlZCBmb3Igc2V2ZXJhbCBwdXJwb3NlcywgZm9yIGV4YW1wbGUgaW4gc2V0dGluZyB1cFxuICAgIC8vIHByb3h5aW5nIHRvIG90aGVyIGRyaXZlcnMsIHNpbmNlIHdlIG5lZWQgdG8ga25vdyB3aGF0IHRoZSBiYXNlIHBhdGhcbiAgICAvLyBvZiBhbnkgaW5jb21pbmcgcmVxdWVzdCBtaWdodCBsb29rIGxpa2UuIFdlIHNldCBpdCB0byB0aGUgZGVmYXVsdFxuICAgIC8vIGluaXRpYWxseSBidXQgaXQgaXMgYXV0b21hdGljYWxseSB1cGRhdGVkIGR1cmluZyBhbnkgYWN0dWFsIHByb2dyYW1cbiAgICAvLyBleGVjdXRpb24gYnkgdGhlIHJvdXRlQ29uZmlndXJpbmdGdW5jdGlvbiwgd2hpY2ggaXMgbmVjZXNzYXJpbHkgcnVuIGFzXG4gICAgLy8gdGhlIGVudHJ5cG9pbnQgZm9yIGFueSBBcHBpdW0gc2VydmVyXG4gICAgdGhpcy5iYXNlUGF0aCA9IERFRkFVTFRfQkFTRV9QQVRIO1xuXG4gICAgLy8gaW5pdGlhbGl6ZSBzZWN1cml0eSBtb2Rlc1xuICAgIHRoaXMucmVsYXhlZFNlY3VyaXR5RW5hYmxlZCA9IGZhbHNlO1xuICAgIHRoaXMuYWxsb3dJbnNlY3VyZSA9IFtdO1xuICAgIHRoaXMuZGVueUluc2VjdXJlID0gW107XG5cbiAgICAvLyB0aW1lb3V0IGluaXRpYWxpemF0aW9uXG4gICAgdGhpcy5uZXdDb21tYW5kVGltZW91dE1zID0gTkVXX0NPTU1BTkRfVElNRU9VVF9NUztcbiAgICB0aGlzLmltcGxpY2l0V2FpdE1zID0gMDtcblxuICAgIHRoaXMuX2NvbnN0cmFpbnRzID0gXy5jbG9uZURlZXAoZGVzaXJlZENhcGFiaWxpdHlDb25zdHJhaW50cyk7XG4gICAgdGhpcy5sb2NhdG9yU3RyYXRlZ2llcyA9IFtdO1xuICAgIHRoaXMud2ViTG9jYXRvclN0cmF0ZWdpZXMgPSBbXTtcblxuICAgIC8vIHVzZSBhIGN1c3RvbSB0bXAgZGlyIHRvIGF2b2lkIGxvc2luZyBkYXRhIGFuZCBhcHAgd2hlbiBjb21wdXRlciBpc1xuICAgIC8vIHJlc3RhcnRlZFxuICAgIHRoaXMub3B0cy50bXBEaXIgPSB0aGlzLm9wdHMudG1wRGlyIHx8XG4gICAgICAgICAgICAgICAgICAgICAgIHByb2Nlc3MuZW52LkFQUElVTV9UTVBfRElSIHx8XG4gICAgICAgICAgICAgICAgICAgICAgIG9zLnRtcGRpcigpO1xuXG4gICAgLy8gYmFzZS1kcml2ZXIgaW50ZXJuYWxzXG4gICAgdGhpcy5zaHV0ZG93blVuZXhwZWN0ZWRseSA9IGZhbHNlO1xuICAgIHRoaXMubm9Db21tYW5kVGltZXIgPSBudWxsO1xuICAgIHRoaXMuc2hvdWxkVmFsaWRhdGVDYXBzID0gc2hvdWxkVmFsaWRhdGVDYXBzO1xuICAgIHRoaXMuY29tbWFuZHNRdWV1ZUd1YXJkID0gbmV3IEFzeW5jTG9jaygpO1xuXG4gICAgLy8gc2V0dGluZ3Mgc2hvdWxkIGJlIGluc3RhbnRpYXRlZCBieSBkcml2ZXJzIHdoaWNoIGV4dGVuZCBCYXNlRHJpdmVyLCBidXRcbiAgICAvLyB3ZSBzZXQgaXQgdG8gYW4gZW1wdHkgRGV2aWNlU2V0dGluZ3MgaW5zdGFuY2UgaGVyZSB0byBtYWtlIHN1cmUgdGhhdCB0aGVcbiAgICAvLyBkZWZhdWx0IHNldHRpbmdzIGFyZSBhcHBsaWVkIGV2ZW4gaWYgYW4gZXh0ZW5kaW5nIGRyaXZlciBkb2Vzbid0IHV0aWxpemVcbiAgICAvLyB0aGUgc2V0dGluZ3MgZnVuY3Rpb25hbGl0eSBpdHNlbGZcbiAgICB0aGlzLnNldHRpbmdzID0gbmV3IERldmljZVNldHRpbmdzKHt9LCBfLm5vb3ApO1xuXG4gICAgLy8ga2VlcGluZyB0cmFjayBvZiBpbml0aWFsIG9wdHNcbiAgICB0aGlzLmluaXRpYWxPcHRzID0gXy5jbG9uZURlZXAodGhpcy5vcHRzKTtcblxuICAgIC8vIGFsbG93IHN1YmNsYXNzZXMgdG8gaGF2ZSBpbnRlcm5hbCBkcml2ZXJzXG4gICAgdGhpcy5tYW5hZ2VkRHJpdmVycyA9IFtdO1xuXG4gICAgLy8gc3RvcmUgZXZlbnQgdGltaW5nc1xuICAgIHRoaXMuX2V2ZW50SGlzdG9yeSA9IHtcbiAgICAgIGNvbW1hbmRzOiBbXSAvLyBjb21tYW5kcyBnZXQgYSBzcGVjaWFsIHBsYWNlXG4gICAgfTtcblxuICAgIC8vIGNhY2hlIHRoZSBpbWFnZSBlbGVtZW50c1xuICAgIHRoaXMuX2ltZ0VsQ2FjaGUgPSBtYWtlSW1hZ2VFbGVtZW50Q2FjaGUoKTtcblxuICAgIC8vIHVzZWQgdG8gaGFuZGxlIGRyaXZlciBldmVudHNcbiAgICB0aGlzLmV2ZW50RW1pdHRlciA9IG5ldyBFdmVudEVtaXR0ZXIoKTtcblxuICAgIHRoaXMucHJvdG9jb2wgPSBudWxsO1xuICB9XG5cbiAgLyoqXG4gICAqIFNldCBhIGNhbGxiYWNrIGhhbmRsZXIgaWYgbmVlZGVkIHRvIGV4ZWN1dGUgYSBjdXN0b20gcGllY2Ugb2YgY29kZVxuICAgKiB3aGVuIHRoZSBkcml2ZXIgaXMgc2h1dCBkb3duIHVuZXhwZWN0ZWRseS4gTXVsdGlwbGUgY2FsbHMgdG8gdGhpcyBtZXRob2RcbiAgICogd2lsbCBjYXVzZSB0aGUgaGFuZGxlciB0byBiZSBleGVjdXRlZCBtdXRpcGxlIHRpbWVzXG4gICAqXG4gICAqIEBwYXJhbSB7RnVuY3Rpb259IGhhbmRsZXIgVGhlIGNvZGUgdG8gYmUgZXhlY3V0ZWQgb24gdW5leHBlY3RlZCBzaHV0ZG93bi5cbiAgICogVGhlIGZ1bmN0aW9uIG1heSBhY2NlcHQgb25lIGFyZ3VtZW50LCB3aGljaCBpcyB0aGUgYWN0dWFsIGVycm9yIGluc3RhbmNlLCB3aGljaFxuICAgKiBjYXVzZWQgdGhlIGRyaXZlciB0byBzaHV0IGRvd24uXG4gICAqL1xuICBvblVuZXhwZWN0ZWRTaHV0ZG93biAoaGFuZGxlcikge1xuICAgIHRoaXMuZXZlbnRFbWl0dGVyLm9uKE9OX1VORVhQRUNURURfU0hVVERPV05fRVZFTlQsIGhhbmRsZXIpO1xuICB9XG5cbiAgLyoqXG4gICAqIFRoaXMgcHJvcGVydHkgaXMgdXNlZCBieSBBcHBpdW1Ecml2ZXIgdG8gc3RvcmUgdGhlIGRhdGEgb2YgdGhlXG4gICAqIHNwZWNpZmljIGRyaXZlciBzZXNzaW9ucy4gVGhpcyBkYXRhIGNhbiBiZSBsYXRlciB1c2VkIHRvIGFkanVzdFxuICAgKiBwcm9wZXJ0aWVzIGZvciBkcml2ZXIgaW5zdGFuY2VzIHJ1bm5pbmcgaW4gcGFyYWxsZWwuXG4gICAqIE92ZXJyaWRlIGl0IGluIGluaGVyaXRlZCBkcml2ZXIgY2xhc3NlcyBpZiBuZWNlc3NhcnkuXG4gICAqXG4gICAqIEByZXR1cm4ge29iamVjdH0gRHJpdmVyIHByb3BlcnRpZXMgbWFwcGluZ1xuICAgKi9cbiAgZ2V0IGRyaXZlckRhdGEgKCkge1xuICAgIHJldHVybiB7fTtcbiAgfVxuXG4gIC8qKlxuICAgKiBUaGlzIHByb3BlcnR5IGNvbnRyb2xzIHRoZSB3YXkgeyNleGVjdXRlQ29tbWFuZH0gbWV0aG9kXG4gICAqIGhhbmRsZXMgbmV3IGRyaXZlciBjb21tYW5kcyByZWNlaXZlZCBmcm9tIHRoZSBjbGllbnQuXG4gICAqIE92ZXJyaWRlIGl0IGZvciBpbmhlcml0ZWQgY2xhc3NlcyBvbmx5IGluIHNwZWNpYWwgY2FzZXMuXG4gICAqXG4gICAqIEByZXR1cm4ge2Jvb2xlYW59IElmIHRoZSByZXR1cm5lZCB2YWx1ZSBpcyB0cnVlIChkZWZhdWx0KSB0aGVuIGFsbCB0aGUgY29tbWFuZHNcbiAgICogICByZWNlaXZlZCBieSB0aGUgcGFydGljdWxhciBkcml2ZXIgaW5zdGFuY2UgYXJlIGdvaW5nIHRvIGJlIHB1dCBpbnRvIHRoZSBxdWV1ZSxcbiAgICogICBzbyBlYWNoIGZvbGxvd2luZyBjb21tYW5kIHdpbGwgbm90IGJlIGV4ZWN1dGVkIHVudGlsIHRoZSBwcmV2aW91cyBjb21tYW5kXG4gICAqICAgZXhlY3V0aW9uIGlzIGNvbXBsZXRlZC4gRmFsc2UgdmFsdWUgZGlzYWJsZXMgdGhhdCBxdWV1ZSwgc28gZWFjaCBkcml2ZXIgY29tbWFuZFxuICAgKiAgIGlzIGV4ZWN1dGVkIGluZGVwZW5kZW50bHkgYW5kIGRvZXMgbm90IHdhaXQgZm9yIGFueXRoaW5nLlxuICAgKi9cbiAgZ2V0IGlzQ29tbWFuZHNRdWV1ZUVuYWJsZWQgKCkge1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgLypcbiAgICogbWFrZSBldmVudEhpc3RvcnkgYSBwcm9wZXJ0eSBhbmQgcmV0dXJuIGEgY2xvbmVkIG9iamVjdCBzbyBhIGNvbnN1bWVyIGNhbid0XG4gICAqIGluYWR2ZXJ0ZW50bHkgY2hhbmdlIGRhdGEgb3V0c2lkZSBvZiBsb2dFdmVudFxuICAgKi9cbiAgZ2V0IGV2ZW50SGlzdG9yeSAoKSB7XG4gICAgcmV0dXJuIF8uY2xvbmVEZWVwKHRoaXMuX2V2ZW50SGlzdG9yeSk7XG4gIH1cblxuICAvKlxuICAgKiBBUEkgbWV0aG9kIGZvciBkcml2ZXIgZGV2ZWxvcGVycyB0byBsb2cgdGltaW5ncyBmb3IgaW1wb3J0YW50IGV2ZW50c1xuICAgKi9cbiAgbG9nRXZlbnQgKGV2ZW50TmFtZSkge1xuICAgIGlmIChldmVudE5hbWUgPT09ICdjb21tYW5kcycpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignQ2Fubm90IGxvZyBjb21tYW5kcyBkaXJlY3RseScpO1xuICAgIH1cbiAgICBpZiAodHlwZW9mIGV2ZW50TmFtZSAhPT0gJ3N0cmluZycpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBldmVudE5hbWUgJHtldmVudE5hbWV9YCk7XG4gICAgfVxuICAgIGlmICghdGhpcy5fZXZlbnRIaXN0b3J5W2V2ZW50TmFtZV0pIHtcbiAgICAgIHRoaXMuX2V2ZW50SGlzdG9yeVtldmVudE5hbWVdID0gW107XG4gICAgfVxuICAgIGNvbnN0IHRzID0gRGF0ZS5ub3coKTtcbiAgICBjb25zdCBsb2dUaW1lID0gKG5ldyBEYXRlKHRzKSkudG9UaW1lU3RyaW5nKCk7XG4gICAgdGhpcy5fZXZlbnRIaXN0b3J5W2V2ZW50TmFtZV0ucHVzaCh0cyk7XG4gICAgbG9nLmRlYnVnKGBFdmVudCAnJHtldmVudE5hbWV9JyBsb2dnZWQgYXQgJHt0c30gKCR7bG9nVGltZX0pYCk7XG4gIH1cblxuICAvKlxuICAgKiBPdmVycmlkZGVuIGluIGFwcGl1bSBkcml2ZXIsIGJ1dCBoZXJlIHNvIHRoYXQgaW5kaXZpZHVhbCBkcml2ZXJzIGNhbiBiZVxuICAgKiB0ZXN0ZWQgd2l0aCBjbGllbnRzIHRoYXQgcG9sbFxuICAgKi9cbiAgYXN5bmMgZ2V0U3RhdHVzICgpIHsgLy8gZXNsaW50LWRpc2FibGUtbGluZSByZXF1aXJlLWF3YWl0XG4gICAgcmV0dXJuIHt9O1xuICB9XG5cbiAgYXN5bmMgZ2V0U3RhdHVzV0RBICgpIHtcbiAgICBjb25zdCB3ZGFVUkwgPSBhd2FpdCBwYXJzZVdEQVVybCgpO1xuICAgIGlmICghd2RhVVJMKSB7XG4gICAgICByZXR1cm4ge1wic3RhdHVzXCI6IFwiZXJyb3JcIiwgXCJkZXRhaWxzXCI6IFwiRW52aXJvbm1lbnQgdmFyaWFibGUgV0RBX0VOViBpcyB1bmRlZmluZWRcIn07XG4gICAgfVxuICAgIGNvbnN0IHN0YXR1cyA9IGF3YWl0IGdldFdEQVN0YXR1cyh3ZGFVUkwpO1xuICAgIGlmICghc3RhdHVzKSB7XG4gICAgICByZXR1cm4ge1wic3RhdHVzXCI6IFwiZXJyb3JcIiwgXCJkZXRhaWxzXCI6IFwiRXJyb3IgZm9yIHNlbmRpbmcgb2YgV0RBIHN0YXR1cyBodHRwIGNhbGwuIFNlZSBhcHBpdW0gbG9ncyBmb3IgZGV0YWlsc1wifTtcbiAgICB9XG4gICAgcmV0dXJuIHtcInN0YXR1c1wiOiBcInN1Y2Nlc3NcIiwgXCJkZXRhaWxzXCI6IHN0YXR1c307XG4gIH1cblxuICAvLyB3ZSBvbmx5IHdhbnQgc3ViY2xhc3NlcyB0byBldmVyIGV4dGVuZCB0aGUgY29udHJhaW50c1xuICBzZXQgZGVzaXJlZENhcENvbnN0cmFpbnRzIChjb25zdHJhaW50cykge1xuICAgIHRoaXMuX2NvbnN0cmFpbnRzID0gT2JqZWN0LmFzc2lnbih0aGlzLl9jb25zdHJhaW50cywgY29uc3RyYWludHMpO1xuICAgIC8vICdwcmVzZW5jZScgbWVhbnMgZGlmZmVyZW50IHRoaW5ncyBpbiBkaWZmZXJlbnQgdmVyc2lvbnMgb2YgdGhlIHZhbGlkYXRvcixcbiAgICAvLyB3aGVuIHdlIHNheSAndHJ1ZScgd2UgbWVhbiB0aGF0IGl0IHNob3VsZCBub3QgYmUgYWJsZSB0byBiZSBlbXB0eVxuICAgIGZvciAoY29uc3QgWywgdmFsdWVdIG9mIF8udG9QYWlycyh0aGlzLl9jb25zdHJhaW50cykpIHtcbiAgICAgIGlmICh2YWx1ZSAmJiB2YWx1ZS5wcmVzZW5jZSA9PT0gdHJ1ZSkge1xuICAgICAgICB2YWx1ZS5wcmVzZW5jZSA9IHtcbiAgICAgICAgICBhbGxvd0VtcHR5OiBmYWxzZSxcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBnZXQgZGVzaXJlZENhcENvbnN0cmFpbnRzICgpIHtcbiAgICByZXR1cm4gdGhpcy5fY29uc3RyYWludHM7XG4gIH1cblxuICAvLyBtZXRob2QgcmVxdWlyZWQgYnkgTUpTT05XUCBpbiBvcmRlciB0byBkZXRlcm1pbmUgd2hldGhlciBpdCBzaG91bGRcbiAgLy8gcmVzcG9uZCB3aXRoIGFuIGludmFsaWQgc2Vzc2lvbiByZXNwb25zZVxuICBzZXNzaW9uRXhpc3RzIChzZXNzaW9uSWQpIHtcbiAgICBpZiAoIXNlc3Npb25JZCkgcmV0dXJuIGZhbHNlOyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIGN1cmx5XG4gICAgcmV0dXJuIHNlc3Npb25JZCA9PT0gdGhpcy5zZXNzaW9uSWQ7XG4gIH1cblxuICAvLyBtZXRob2QgcmVxdWlyZWQgYnkgTUpTT05XUCBpbiBvcmRlciB0byBkZXRlcm1pbmUgaWYgdGhlIGNvbW1hbmQgc2hvdWxkXG4gIC8vIGJlIHByb3hpZWQgZGlyZWN0bHkgdG8gdGhlIGRyaXZlclxuICBkcml2ZXJGb3JTZXNzaW9uICgvKnNlc3Npb25JZCovKSB7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICBsb2dFeHRyYUNhcHMgKGNhcHMpIHtcbiAgICBsZXQgZXh0cmFDYXBzID0gXy5kaWZmZXJlbmNlKF8ua2V5cyhjYXBzKSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIF8ua2V5cyh0aGlzLl9jb25zdHJhaW50cykpO1xuICAgIGlmIChleHRyYUNhcHMubGVuZ3RoKSB7XG4gICAgICBsb2cud2FybihgVGhlIGZvbGxvd2luZyBjYXBhYmlsaXRpZXMgd2VyZSBwcm92aWRlZCwgYnV0IGFyZSBub3QgYCArXG4gICAgICAgICAgICAgICBgcmVjb2duaXplZCBieSBBcHBpdW06YCk7XG4gICAgICBmb3IgKGNvbnN0IGNhcCBvZiBleHRyYUNhcHMpIHtcbiAgICAgICAgbG9nLndhcm4oYCAgJHtjYXB9YCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgdmFsaWRhdGVEZXNpcmVkQ2FwcyAoY2Fwcykge1xuICAgIGlmICghdGhpcy5zaG91bGRWYWxpZGF0ZUNhcHMpIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICB2YWxpZGF0ZUNhcHMoY2FwcywgdGhpcy5fY29uc3RyYWludHMpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGxvZy5lcnJvckFuZFRocm93KG5ldyBlcnJvcnMuU2Vzc2lvbk5vdENyZWF0ZWRFcnJvcihgVGhlIGRlc2lyZWRDYXBhYmlsaXRpZXMgb2JqZWN0IHdhcyBub3QgdmFsaWQgZm9yIHRoZSBgICtcbiAgICAgICAgICAgICAgICAgICAgYGZvbGxvd2luZyByZWFzb24ocyk6ICR7ZS5tZXNzYWdlfWApKTtcbiAgICB9XG5cbiAgICB0aGlzLmxvZ0V4dHJhQ2FwcyhjYXBzKTtcblxuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgaXNNanNvbndwUHJvdG9jb2wgKCkge1xuICAgIHJldHVybiB0aGlzLnByb3RvY29sID09PSBQUk9UT0NPTFMuTUpTT05XUDtcbiAgfVxuXG4gIGlzVzNDUHJvdG9jb2wgKCkge1xuICAgIHJldHVybiB0aGlzLnByb3RvY29sID09PSBQUk9UT0NPTFMuVzNDO1xuICB9XG5cbiAgc2V0UHJvdG9jb2xNSlNPTldQICgpIHtcbiAgICB0aGlzLnByb3RvY29sID0gUFJPVE9DT0xTLk1KU09OV1A7XG4gIH1cblxuICBzZXRQcm90b2NvbFczQyAoKSB7XG4gICAgdGhpcy5wcm90b2NvbCA9IFBST1RPQ09MUy5XM0M7XG4gIH1cblxuICAvKipcbiAgICogQ2hlY2sgd2hldGhlciBhIGdpdmVuIGZlYXR1cmUgaXMgZW5hYmxlZCB2aWEgaXRzIG5hbWVcbiAgICpcbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBuYW1lIG9mIGZlYXR1cmUvY29tbWFuZFxuICAgKlxuICAgKiBAcmV0dXJucyB7Qm9vbGVhbn1cbiAgICovXG4gIGlzRmVhdHVyZUVuYWJsZWQgKG5hbWUpIHtcbiAgICAvLyBpZiB3ZSBoYXZlIGV4cGxpY2l0bHkgZGVuaWVkIHRoaXMgZmVhdHVyZSwgcmV0dXJuIGZhbHNlIGltbWVkaWF0ZWx5XG4gICAgaWYgKHRoaXMuZGVueUluc2VjdXJlICYmIF8uaW5jbHVkZXModGhpcy5kZW55SW5zZWN1cmUsIG5hbWUpKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gICAgLy8gaWYgd2Ugc3BlY2lmaWNhbGx5IGhhdmUgYWxsb3dlZCB0aGUgZmVhdHVyZSwgcmV0dXJuIHRydWVcbiAgICBpZiAodGhpcy5hbGxvd0luc2VjdXJlICYmIF8uaW5jbHVkZXModGhpcy5hbGxvd0luc2VjdXJlLCBuYW1lKSkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgLy8gb3RoZXJ3aXNlLCBpZiB3ZSd2ZSBnbG9iYWxseSBhbGxvd2VkIGluc2VjdXJlIGZlYXR1cmVzIGFuZCBub3QgZGVuaWVkXG4gICAgLy8gdGhpcyBvbmUsIHJldHVybiB0cnVlXG4gICAgaWYgKHRoaXMucmVsYXhlZFNlY3VyaXR5RW5hYmxlZCkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgLy8gaWYgd2UgaGF2ZW4ndCBhbGxvd2VkIGFueXRoaW5nIGluc2VjdXJlLCB0aGVuIHJlamVjdFxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBBc3NlcnQgdGhhdCBhIGdpdmVuIGZlYXR1cmUgaXMgZW5hYmxlZCBhbmQgdGhyb3cgYSBoZWxwZnVsIGVycm9yIGlmIGl0J3NcbiAgICogbm90XG4gICAqXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gbmFtZSBvZiBmZWF0dXJlL2NvbW1hbmRcbiAgICovXG4gIGVuc3VyZUZlYXR1cmVFbmFibGVkIChuYW1lKSB7XG4gICAgaWYgKCF0aGlzLmlzRmVhdHVyZUVuYWJsZWQobmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgUG90ZW50aWFsbHkgaW5zZWN1cmUgZmVhdHVyZSAnJHtuYW1lfScgaGFzIG5vdCBiZWVuIGAgK1xuICAgICAgICAgICAgICAgICAgICAgIGBlbmFibGVkLiBJZiB5b3Ugd2FudCB0byBlbmFibGUgdGhpcyBmZWF0dXJlIGFuZCBhY2NlcHQgYCArXG4gICAgICAgICAgICAgICAgICAgICAgYHRoZSBzZWN1cml0eSByYW1pZmljYXRpb25zLCBwbGVhc2UgZG8gc28gYnkgZm9sbG93aW5nIGAgK1xuICAgICAgICAgICAgICAgICAgICAgIGB0aGUgZG9jdW1lbnRlZCBpbnN0cnVjdGlvbnMgYXQgaHR0cHM6Ly9naXRodWIuY29tL2FwcGl1bWAgK1xuICAgICAgICAgICAgICAgICAgICAgIGAvYXBwaXVtL2Jsb2IvbWFzdGVyL2RvY3MvZW4vd3JpdGluZy1ydW5uaW5nLWFwcGl1bS9zZWN1cml0eS5tZGApO1xuICAgIH1cbiAgfVxuXG4gIC8vIFRoaXMgaXMgdGhlIG1haW4gY29tbWFuZCBoYW5kbGVyIGZvciB0aGUgZHJpdmVyLiBJdCB3cmFwcyBjb21tYW5kXG4gIC8vIGV4ZWN1dGlvbiB3aXRoIHRpbWVvdXQgbG9naWMsIGNoZWNraW5nIHRoYXQgd2UgaGF2ZSBhIHZhbGlkIHNlc3Npb24sXG4gIC8vIGFuZCBlbnN1cmluZyB0aGF0IHdlIGV4ZWN1dGUgY29tbWFuZHMgb25lIGF0IGEgdGltZS4gVGhpcyBtZXRob2QgaXMgY2FsbGVkXG4gIC8vIGJ5IE1KU09OV1AncyBleHByZXNzIHJvdXRlci5cbiAgYXN5bmMgZXhlY3V0ZUNvbW1hbmQgKGNtZCwgLi4uYXJncykge1xuICAgIC8vIGdldCBzdGFydCB0aW1lIGZvciB0aGlzIGNvbW1hbmQsIGFuZCBsb2cgaW4gc3BlY2lhbCBjYXNlc1xuICAgIGxldCBzdGFydFRpbWUgPSBEYXRlLm5vdygpO1xuICAgIGlmIChjbWQgPT09ICdjcmVhdGVTZXNzaW9uJykge1xuICAgICAgLy8gSWYgY3JlYXRpbmcgYSBzZXNzaW9uIGRldGVybWluZSBpZiBXM0Mgb3IgTUpTT05XUCBwcm90b2NvbCB3YXMgcmVxdWVzdGVkIGFuZCByZW1lbWJlciB0aGUgY2hvaWNlXG4gICAgICB0aGlzLnByb3RvY29sID0gZGV0ZXJtaW5lUHJvdG9jb2woLi4uYXJncyk7XG4gICAgICB0aGlzLmxvZ0V2ZW50KEVWRU5UX1NFU1NJT05fSU5JVCk7XG4gICAgfSBlbHNlIGlmIChjbWQgPT09ICdkZWxldGVTZXNzaW9uJykge1xuICAgICAgdGhpcy5sb2dFdmVudChFVkVOVF9TRVNTSU9OX1FVSVRfU1RBUlQpO1xuICAgIH1cblxuICAgIC8vIGlmIHdlIGhhZCBhIGNvbW1hbmQgdGltZXIgcnVubmluZywgY2xlYXIgaXQgbm93IHRoYXQgd2UncmUgc3RhcnRpbmdcbiAgICAvLyBhIG5ldyBjb21tYW5kIGFuZCBzbyBkb24ndCB3YW50IHRvIHRpbWUgb3V0XG4gICAgdGhpcy5jbGVhck5ld0NvbW1hbmRUaW1lb3V0KCk7XG5cbiAgICBpZiAodGhpcy5zaHV0ZG93blVuZXhwZWN0ZWRseSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5Ob1N1Y2hEcml2ZXJFcnJvcignVGhlIGRyaXZlciB3YXMgdW5leHBlY3RlZGx5IHNodXQgZG93biEnKTtcbiAgICB9XG5cbiAgICAvLyBJZiB3ZSBkb24ndCBoYXZlIHRoaXMgY29tbWFuZCwgaXQgbXVzdCBub3QgYmUgaW1wbGVtZW50ZWRcbiAgICAvLyBJZiB0aGUgdGFyZ2V0IGVsZW1lbnQgaXMgSW1hZ2VFbGVtZW50LCB3ZSBtdXN0IHRyeSB0byBjYWxsIGBJbWFnZUVsZW1lbnQuZXhlY3V0ZWAgd2hpY2ggZXhpc3QgZm9sbG93aW5nIGxpbmVzXG4gICAgLy8gc2luY2UgSW1hZ2VFbGVtZW50IHN1cHBvcnRzIGZldyBjb21tYW5kcyBieSBpdHNlbGZcbiAgICBjb25zdCBpbWdFbElkID0gZ2V0SW1nRWxGcm9tQXJncyhhcmdzKTtcbiAgICBpZiAoIXRoaXNbY21kXSAmJiAhaW1nRWxJZCkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5Ob3RZZXRJbXBsZW1lbnRlZEVycm9yKCk7XG4gICAgfVxuXG4gICAgbGV0IHVuZXhwZWN0ZWRTaHV0ZG93bkxpc3RlbmVyO1xuICAgIGNvbnN0IGNvbW1hbmRFeGVjdXRvciA9IGFzeW5jICgpID0+IGltZ0VsSWRcbiAgICAgID8gYXdhaXQgSW1hZ2VFbGVtZW50LmV4ZWN1dGUodGhpcywgY21kLCBpbWdFbElkLCAuLi5hcmdzKVxuICAgICAgOiBhd2FpdCBCLnJhY2UoW1xuICAgICAgICB0aGlzW2NtZF0oLi4uYXJncyksXG4gICAgICAgIG5ldyBCKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgICB1bmV4cGVjdGVkU2h1dGRvd25MaXN0ZW5lciA9IHJlamVjdDtcbiAgICAgICAgICB0aGlzLmV2ZW50RW1pdHRlci5vbihPTl9VTkVYUEVDVEVEX1NIVVRET1dOX0VWRU5ULCB1bmV4cGVjdGVkU2h1dGRvd25MaXN0ZW5lcik7XG4gICAgICAgIH0pXG4gICAgICBdKS5maW5hbGx5KCgpID0+IHtcbiAgICAgICAgaWYgKHVuZXhwZWN0ZWRTaHV0ZG93bkxpc3RlbmVyKSB7XG4gICAgICAgICAgaWYgKGNtZCA9PT0gJ2NyZWF0ZVNlc3Npb24nKSB7XG4gICAgICAgICAgICBsb2cuaW5mbygnW01DTE9VRF0gZXJyb3IgaGFwcGVuZWQgZHVyaW5nIG5ldyBzZXNzaW9uIGNyZWF0aW5nJyk7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgLy8gVGhpcyBpcyBuZWVkZWQgdG8gcHJldmVudCBtZW1vcnkgbGVha3NcbiAgICAgICAgICB0aGlzLmV2ZW50RW1pdHRlci5yZW1vdmVMaXN0ZW5lcihPTl9VTkVYUEVDVEVEX1NIVVRET1dOX0VWRU5ULCB1bmV4cGVjdGVkU2h1dGRvd25MaXN0ZW5lcik7XG4gICAgICAgICAgdW5leHBlY3RlZFNodXRkb3duTGlzdGVuZXIgPSBudWxsO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICBjb25zdCByZXMgPSB0aGlzLmlzQ29tbWFuZHNRdWV1ZUVuYWJsZWQgJiYgY21kICE9PSAnZXhlY3V0ZURyaXZlclNjcmlwdCdcbiAgICAgID8gYXdhaXQgdGhpcy5jb21tYW5kc1F1ZXVlR3VhcmQuYWNxdWlyZShCYXNlRHJpdmVyLm5hbWUsIGNvbW1hbmRFeGVjdXRvcilcbiAgICAgIDogYXdhaXQgY29tbWFuZEV4ZWN1dG9yKCk7XG5cbiAgICAvLyBpZiB3ZSBoYXZlIHNldCBhIG5ldyBjb21tYW5kIHRpbWVvdXQgKHdoaWNoIGlzIHRoZSBkZWZhdWx0KSwgc3RhcnQgYVxuICAgIC8vIHRpbWVyIG9uY2Ugd2UndmUgZmluaXNoZWQgZXhlY3V0aW5nIHRoaXMgY29tbWFuZC4gSWYgd2UgZG9uJ3QgY2xlYXJcbiAgICAvLyB0aGUgdGltZXIgKHdoaWNoIGlzIGRvbmUgd2hlbiBhIG5ldyBjb21tYW5kIGNvbWVzIGluKSwgd2Ugd2lsbCB0cmlnZ2VyXG4gICAgLy8gYXV0b21hdGljIHNlc3Npb24gZGVsZXRpb24gaW4gdGhpcy5vbkNvbW1hbmRUaW1lb3V0LiBPZiBjb3Vyc2Ugd2UgZG9uJ3RcbiAgICAvLyB3YW50IHRvIHRyaWdnZXIgdGhlIHRpbWVyIHdoZW4gdGhlIHVzZXIgaXMgc2h1dHRpbmcgZG93biB0aGUgc2Vzc2lvblxuICAgIC8vIGludGVudGlvbmFsbHlcbiAgICBpZiAodGhpcy5pc0NvbW1hbmRzUXVldWVFbmFibGVkICYmIGNtZCAhPT0gJ2RlbGV0ZVNlc3Npb24nKSB7XG4gICAgICAvLyByZXNldHRpbmcgZXhpc3RpbmcgdGltZW91dFxuICAgICAgdGhpcy5zdGFydE5ld0NvbW1hbmRUaW1lb3V0KCk7XG4gICAgfVxuXG4gICAgLy8gbG9nIHRpbWluZyBpbmZvcm1hdGlvbiBhYm91dCB0aGlzIGNvbW1hbmRcbiAgICBjb25zdCBlbmRUaW1lID0gRGF0ZS5ub3coKTtcbiAgICB0aGlzLl9ldmVudEhpc3RvcnkuY29tbWFuZHMucHVzaCh7Y21kLCBzdGFydFRpbWUsIGVuZFRpbWV9KTtcbiAgICBpZiAoY21kID09PSAnY3JlYXRlU2Vzc2lvbicpIHtcbiAgICAgIHRoaXMubG9nRXZlbnQoRVZFTlRfU0VTU0lPTl9TVEFSVCk7XG5cbiAgICAgIGlmKHJlcyAhPSB1bmRlZmluZWQgJiYgcmVzLnZhbHVlICE9IHVuZGVmaW5lZCkge1xuICAgICAgICBsb2cuaW5mbyhgW01DTE9VRF0gc3RhcnRpbmcgYXJ0aWZhY3RzIGNhcHR1cmluZyBmb3Igc2Vzc2lvbiAke3Jlcy52YWx1ZVswXX1gKTtcbiAgICAgICAgY29uc3Qgc3RhcnRfcmVjX2NvbW1hbmQgPSBgL29wdC9zdGFydC1jYXB0dXJlLWFydGlmYWN0cy5zaCAke3Jlcy52YWx1ZVswXX0gPj4gL3RtcC92aWRlby5sb2cgMj4mMWA7XG4gICAgICAgIGV4ZWN1dGVTaGVsbChzdGFydF9yZWNfY29tbWFuZCwgJ1tNQ0xPVURdIHN0YXJ0IGNhcHR1cmluZyBhcnRpZmFjdHMnKTsgLy8gMSBlcnJvciBjb2RlIGV4cGVjdGVkIGFzIHByb2Nlc3Mgc2hvdWxkIGJlIGtpbGxlZFxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoY21kID09PSAnZGVsZXRlU2Vzc2lvbicpIHtcbiAgICAgIHRoaXMubG9nRXZlbnQoRVZFTlRfU0VTU0lPTl9RVUlUX0RPTkUpO1xuICAgIH1cblxuICAgIHJldHVybiByZXM7XG4gIH1cblxuICBhc3luYyBzdGFydFVuZXhwZWN0ZWRTaHV0ZG93biAoZXJyID0gbmV3IGVycm9ycy5Ob1N1Y2hEcml2ZXJFcnJvcignVGhlIGRyaXZlciB3YXMgdW5leHBlY3RlZGx5IHNodXQgZG93biEnKSkge1xuICAgIHRoaXMuZXZlbnRFbWl0dGVyLmVtaXQoT05fVU5FWFBFQ1RFRF9TSFVURE9XTl9FVkVOVCwgZXJyKTsgLy8gYWxsb3cgb3RoZXJzIHRvIGxpc3RlbiBmb3IgdGhpc1xuICAgIHRoaXMuc2h1dGRvd25VbmV4cGVjdGVkbHkgPSB0cnVlO1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLmRlbGV0ZVNlc3Npb24odGhpcy5zZXNzaW9uSWQpO1xuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLnNodXRkb3duVW5leHBlY3RlZGx5ID0gZmFsc2U7XG4gICAgfVxuICB9XG5cbiAgdmFsaWRhdGVMb2NhdG9yU3RyYXRlZ3kgKHN0cmF0ZWd5LCB3ZWJDb250ZXh0ID0gZmFsc2UpIHtcbiAgICBsZXQgdmFsaWRTdHJhdGVnaWVzID0gdGhpcy5sb2NhdG9yU3RyYXRlZ2llcztcbiAgICBsb2cuZGVidWcoYFZhbGlkIGxvY2F0b3Igc3RyYXRlZ2llcyBmb3IgdGhpcyByZXF1ZXN0OiAke3ZhbGlkU3RyYXRlZ2llcy5qb2luKCcsICcpfWApO1xuXG4gICAgaWYgKHdlYkNvbnRleHQpIHtcbiAgICAgIHZhbGlkU3RyYXRlZ2llcyA9IHZhbGlkU3RyYXRlZ2llcy5jb25jYXQodGhpcy53ZWJMb2NhdG9yU3RyYXRlZ2llcyk7XG4gICAgfVxuXG4gICAgaWYgKCFfLmluY2x1ZGVzKHZhbGlkU3RyYXRlZ2llcywgc3RyYXRlZ3kpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRTZWxlY3RvckVycm9yKGBMb2NhdG9yIFN0cmF0ZWd5ICcke3N0cmF0ZWd5fScgaXMgbm90IHN1cHBvcnRlZCBmb3IgdGhpcyBzZXNzaW9uYCk7XG4gICAgfVxuICB9XG5cbiAgLypcbiAgICogUmVzdGFydCB0aGUgc2Vzc2lvbiB3aXRoIHRoZSBvcmlnaW5hbCBjYXBzLFxuICAgKiBwcmVzZXJ2aW5nIHRoZSB0aW1lb3V0IGNvbmZpZy5cbiAgICovXG4gIGFzeW5jIHJlc2V0ICgpIHtcbiAgICBsb2cuZGVidWcoJ1Jlc2V0dGluZyBhcHAgbWlkLXNlc3Npb24nKTtcbiAgICBsb2cuZGVidWcoJ1J1bm5pbmcgZ2VuZXJpYyBmdWxsIHJlc2V0Jyk7XG5cbiAgICAvLyBwcmVzZXJ2aW5nIHN0YXRlXG4gICAgbGV0IGN1cnJlbnRDb25maWcgPSB7fTtcbiAgICBmb3IgKGxldCBwcm9wZXJ0eSBvZiBbJ2ltcGxpY2l0V2FpdE1zJywgJ25ld0NvbW1hbmRUaW1lb3V0TXMnLCAnc2Vzc2lvbklkJywgJ3Jlc2V0T25VbmV4cGVjdGVkU2h1dGRvd24nXSkge1xuICAgICAgY3VycmVudENvbmZpZ1twcm9wZXJ0eV0gPSB0aGlzW3Byb3BlcnR5XTtcbiAgICB9XG5cbiAgICAvLyBXZSBhbHNvIG5lZWQgdG8gcHJlc2VydmUgdGhlIHVuZXhwZWN0ZWQgc2h1dGRvd24sIGFuZCBtYWtlIHN1cmUgaXQgaXMgbm90IGNhbmNlbGxlZCBkdXJpbmcgcmVzZXQuXG4gICAgdGhpcy5yZXNldE9uVW5leHBlY3RlZFNodXRkb3duID0gKCkgPT4ge307XG5cbiAgICAvLyBDb25zdHJ1Y3QgdGhlIGFyZ3VtZW50cyBmb3IgY3JlYXRlU2Vzc2lvbiBkZXBlbmRpbmcgb24gdGhlIHByb3RvY29sIHR5cGVcbiAgICBjb25zdCBhcmdzID0gdGhpcy5wcm90b2NvbCA9PT0gUFJPVE9DT0xTLlczQyA/XG4gICAgICBbdW5kZWZpbmVkLCB1bmRlZmluZWQsIHthbHdheXNNYXRjaDogdGhpcy5jYXBzLCBmaXJzdE1hdGNoOiBbe31dfV0gOlxuICAgICAgW3RoaXMuY2Fwc107XG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5kZWxldGVTZXNzaW9uKHRoaXMuc2Vzc2lvbklkKTtcbiAgICAgIGxvZy5kZWJ1ZygnUmVzdGFydGluZyBhcHAnKTtcbiAgICAgIGF3YWl0IHRoaXMuY3JlYXRlU2Vzc2lvbiguLi5hcmdzKTtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgLy8gYWx3YXlzIHJlc3RvcmUgc3RhdGUuXG4gICAgICBmb3IgKGxldCBba2V5LCB2YWx1ZV0gb2YgXy50b1BhaXJzKGN1cnJlbnRDb25maWcpKSB7XG4gICAgICAgIHRoaXNba2V5XSA9IHZhbHVlO1xuICAgICAgfVxuICAgIH1cbiAgICB0aGlzLmNsZWFyTmV3Q29tbWFuZFRpbWVvdXQoKTtcbiAgfVxuXG4gIHByb3h5QWN0aXZlICgvKiBzZXNzaW9uSWQgKi8pIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBnZXRQcm94eUF2b2lkTGlzdCAoLyogc2Vzc2lvbklkICovKSB7XG4gICAgcmV0dXJuIFtdO1xuICB9XG5cbiAgY2FuUHJveHkgKC8qIHNlc3Npb25JZCAqLykge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIGEgZ2l2ZW4gY29tbWFuZCByb3V0ZSAoZXhwcmVzc2VkIGFzIG1ldGhvZCBhbmQgdXJsKSBzaG91bGQgbm90IGJlXG4gICAqIHByb3hpZWQgYWNjb3JkaW5nIHRvIHRoaXMgZHJpdmVyXG4gICAqXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzZXNzaW9uSWQgLSB0aGUgY3VycmVudCBzZXNzaW9uSWQgKGluIGNhc2UgdGhlIGRyaXZlciBydW5zXG4gICAqIG11bHRpcGxlIHNlc3Npb24gaWRzIGFuZCByZXF1aXJlcyBpdCkuIFRoaXMgaXMgbm90IHVzZWQgaW4gdGhpcyBtZXRob2QgYnV0XG4gICAqIHNob3VsZCBiZSBtYWRlIGF2YWlsYWJsZSB0byBvdmVycmlkZGVuIG1ldGhvZHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXRob2QgLSBIVFRQIG1ldGhvZCBvZiB0aGUgcm91dGVcbiAgICogQHBhcmFtIHtzdHJpbmd9IHVybCAtIHVybCBvZiB0aGUgcm91dGVcbiAgICpcbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gd2hldGhlciB0aGUgcm91dGUgc2hvdWxkIGJlIGF2b2lkZWRcbiAgICovXG4gIHByb3h5Um91dGVJc0F2b2lkZWQgKHNlc3Npb25JZCwgbWV0aG9kLCB1cmwpIHtcbiAgICBmb3IgKGxldCBhdm9pZFNjaGVtYSBvZiB0aGlzLmdldFByb3h5QXZvaWRMaXN0KHNlc3Npb25JZCkpIHtcbiAgICAgIGlmICghXy5pc0FycmF5KGF2b2lkU2NoZW1hKSB8fCBhdm9pZFNjaGVtYS5sZW5ndGggIT09IDIpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdQcm94eSBhdm9pZGFuY2UgbXVzdCBiZSBhIGxpc3Qgb2YgcGFpcnMnKTtcbiAgICAgIH1cbiAgICAgIGxldCBbYXZvaWRNZXRob2QsIGF2b2lkUGF0aFJlZ2V4XSA9IGF2b2lkU2NoZW1hO1xuICAgICAgaWYgKCFfLmluY2x1ZGVzKFsnR0VUJywgJ1BPU1QnLCAnREVMRVRFJ10sIGF2b2lkTWV0aG9kKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVucmVjb2duaXplZCBwcm94eSBhdm9pZGFuY2UgbWV0aG9kICcke2F2b2lkTWV0aG9kfSdgKTtcbiAgICAgIH1cbiAgICAgIGlmICghXy5pc1JlZ0V4cChhdm9pZFBhdGhSZWdleCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdQcm94eSBhdm9pZGFuY2UgcGF0aCBtdXN0IGJlIGEgcmVndWxhciBleHByZXNzaW9uJyk7XG4gICAgICB9XG4gICAgICBsZXQgbm9ybWFsaXplZFVybCA9IHVybC5yZXBsYWNlKG5ldyBSZWdFeHAoYF4ke18uZXNjYXBlUmVnRXhwKHRoaXMuYmFzZVBhdGgpfWApLCAnJyk7XG4gICAgICBpZiAoYXZvaWRNZXRob2QgPT09IG1ldGhvZCAmJiBhdm9pZFBhdGhSZWdleC50ZXN0KG5vcm1hbGl6ZWRVcmwpKSB7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBhZGRNYW5hZ2VkRHJpdmVyIChkcml2ZXIpIHtcbiAgICB0aGlzLm1hbmFnZWREcml2ZXJzLnB1c2goZHJpdmVyKTtcbiAgfVxuXG4gIGdldE1hbmFnZWREcml2ZXJzICgpIHtcbiAgICByZXR1cm4gdGhpcy5tYW5hZ2VkRHJpdmVycztcbiAgfVxuXG4gIHJlZ2lzdGVySW1hZ2VFbGVtZW50IChpbWdFbCkge1xuICAgIHRoaXMuX2ltZ0VsQ2FjaGUuc2V0KGltZ0VsLmlkLCBpbWdFbCk7XG4gICAgY29uc3QgcHJvdG9LZXkgPSB0aGlzLmlzVzNDUHJvdG9jb2woKSA/IFczQ19FTEVNRU5UX0tFWSA6IE1KU09OV1BfRUxFTUVOVF9LRVk7XG4gICAgcmV0dXJuIGltZ0VsLmFzRWxlbWVudChwcm90b0tleSk7XG4gIH1cbn1cblxuZm9yIChsZXQgW2NtZCwgZm5dIG9mIF8udG9QYWlycyhjb21tYW5kcykpIHtcbiAgQmFzZURyaXZlci5wcm90b3R5cGVbY21kXSA9IGZuO1xufVxuXG5leHBvcnQgeyBCYXNlRHJpdmVyIH07XG5leHBvcnQgZGVmYXVsdCBCYXNlRHJpdmVyO1xuIl0sImZpbGUiOiJsaWIvYmFzZWRyaXZlci9kcml2ZXIuanMiLCJzb3VyY2VSb290IjoiLi4vLi4vLi4ifQ==
