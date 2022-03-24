"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault");

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getAndroidBinaryPath = getAndroidBinaryPath;
Object.defineProperty(exports, "DEFAULT_ADB_EXEC_TIMEOUT", {
  enumerable: true,
  get: function () {
    return _helpers.DEFAULT_ADB_EXEC_TIMEOUT;
  }
});
exports.default = void 0;

require("source-map-support/register");

var _path = _interopRequireDefault(require("path"));

var _logger = _interopRequireDefault(require("../logger.js"));

var _bluebird = _interopRequireDefault(require("bluebird"));

var _appiumSupport = require("appium-support");

var _helpers = require("../helpers");

var _teen_process = require("teen_process");

var _asyncbox = require("asyncbox");

var _lodash = _interopRequireDefault(require("lodash"));

var _semver = _interopRequireDefault(require("semver"));

let systemCallMethods = {};
const DEFAULT_ADB_REBOOT_RETRIES = 90;
const LINKER_WARNING_REGEXP = /^WARNING: linker.+$/m;
const ADB_RETRY_ERROR_PATTERNS = [/protocol fault \(no status\)/i, /error: device ('.+' )?not found/i, /error: device still connecting/i];
const BINARY_VERSION_PATTERN = /^Version ([\d.]+)-(\d+)/m;
const BRIDGE_VERSION_PATTERN = /^Android Debug Bridge version ([\d.]+)/m;
const CERTS_ROOT = '/system/etc/security/cacerts';
const SDK_BINARY_ROOTS = ['platform-tools', 'emulator', ['cmdline-tools', 'latest', 'bin'], 'tools', ['tools', 'bin'], '.'];
const MIN_DELAY_ADB_API_LEVEL = 28;

systemCallMethods.getSdkBinaryPath = async function getSdkBinaryPath(binaryName) {
  return await this.getBinaryFromSdkRoot(binaryName);
};

systemCallMethods.getBinaryNameForOS = _lodash.default.memoize(function getBinaryNameForOSMemorize(binaryName) {
  return getBinaryNameForOS(binaryName);
});

function getBinaryNameForOS(binaryName) {
  if (!_appiumSupport.system.isWindows()) {
    return binaryName;
  }

  if (['android', 'apksigner', 'apkanalyzer'].includes(binaryName)) {
    return `${binaryName}.bat`;
  }

  if (!_path.default.extname(binaryName)) {
    return `${binaryName}.exe`;
  }

  return binaryName;
}

systemCallMethods.getBinaryFromSdkRoot = async function getBinaryFromSdkRoot(binaryName) {
  if (this.binaries[binaryName]) {
    return this.binaries[binaryName];
  }

  const fullBinaryName = this.getBinaryNameForOS(binaryName);
  const binaryLocs = getSdkBinaryLocationCandidates(this.sdkRoot, fullBinaryName);
  let buildToolsDirs = await (0, _helpers.getBuildToolsDirs)(this.sdkRoot);

  if (this.buildToolsVersion) {
    buildToolsDirs = buildToolsDirs.filter(x => _path.default.basename(x) === this.buildToolsVersion);

    if (_lodash.default.isEmpty(buildToolsDirs)) {
      _logger.default.info(`Found no build tools whose version matches to '${this.buildToolsVersion}'`);
    } else {
      _logger.default.info(`Using build tools at '${buildToolsDirs}'`);
    }
  }

  binaryLocs.push(..._lodash.default.flatten(buildToolsDirs.map(dir => [_path.default.resolve(dir, fullBinaryName), _path.default.resolve(dir, 'lib', fullBinaryName)])));
  let binaryLoc = null;

  for (const loc of binaryLocs) {
    if (await _appiumSupport.fs.exists(loc)) {
      binaryLoc = loc;
      break;
    }
  }

  if (_lodash.default.isNull(binaryLoc)) {
    throw new Error(`Could not find '${fullBinaryName}' in ${JSON.stringify(binaryLocs)}. ` + `Do you have Android Build Tools ${this.buildToolsVersion ? `v ${this.buildToolsVersion} ` : ''}` + `installed at '${this.sdkRoot}'?`);
  }

  _logger.default.info(`Using '${fullBinaryName}' from '${binaryLoc}'`);

  this.binaries[binaryName] = binaryLoc;
  return binaryLoc;
};

function getSdkBinaryLocationCandidates(sdkRoot, fullBinaryName) {
  return SDK_BINARY_ROOTS.map(x => _path.default.resolve(sdkRoot, ...(_lodash.default.isArray(x) ? x : [x]), fullBinaryName));
}

async function getAndroidBinaryPath(binaryName) {
  const fullBinaryName = getBinaryNameForOS(binaryName);
  const sdkRoot = (0, _helpers.getSdkRootFromEnv)();
  const binaryLocs = getSdkBinaryLocationCandidates(sdkRoot, fullBinaryName);

  for (const loc of binaryLocs) {
    if (await _appiumSupport.fs.exists(loc)) {
      return loc;
    }
  }

  throw new Error(`Could not find '${fullBinaryName}' in ${JSON.stringify(binaryLocs)}. ` + `Do you have Android Build Tools installed at '${sdkRoot}'?`);
}

systemCallMethods.getBinaryFromPath = async function getBinaryFromPath(binaryName) {
  if (this.binaries[binaryName]) {
    return this.binaries[binaryName];
  }

  const fullBinaryName = this.getBinaryNameForOS(binaryName);

  try {
    const binaryLoc = await _appiumSupport.fs.which(fullBinaryName);

    _logger.default.info(`Using '${fullBinaryName}' from '${binaryLoc}'`);

    this.binaries[binaryName] = binaryLoc;
    return binaryLoc;
  } catch (e) {
    throw new Error(`Could not find '${fullBinaryName}' in PATH. Please set the ANDROID_HOME ` + `or ANDROID_SDK_ROOT environment variables to the correct Android SDK root directory path.`);
  }
};

systemCallMethods.getConnectedDevices = async function getConnectedDevices() {
  _logger.default.debug('Getting connected devices');

  let stdout;

  try {
    ({
      stdout
    } = await (0, _teen_process.exec)(this.executable.path, [...this.executable.defaultArgs, 'devices']));
  } catch (e) {
    throw new Error(`Error while getting connected devices. Original error: ${e.message}`);
  }

  const listHeader = 'List of devices';
  const startingIndex = stdout.indexOf(listHeader);

  if (startingIndex < 0) {
    throw new Error(`Unexpected output while trying to get devices: ${stdout}`);
  }

  stdout = stdout.slice(startingIndex);
  let excludedLines = [listHeader, 'adb server', '* daemon'];

  if (!this.allowOfflineDevices) {
    excludedLines.push('offline');
  }

  const devices = stdout.split('\n').map(_lodash.default.trim).filter(line => line && !excludedLines.some(x => line.includes(x))).reduce((acc, line) => {
    const [udid, state] = line.split(/\s+/);
    acc.push({
      udid,
      state
    });
    return acc;
  }, []);

  if (_lodash.default.isEmpty(devices)) {
    _logger.default.debug('No connected devices have been detected');
  } else {
    _logger.default.debug(`Connected devices: ${JSON.stringify(devices)}`);
  }

  return devices;
};

systemCallMethods.getDevicesWithRetry = async function getDevicesWithRetry(timeoutMs = 60000) {
  const timer = new _appiumSupport.timing.Timer().start();

  _logger.default.debug('Trying to find a connected android device');

  const getDevices = async () => {
    if (timer.getDuration().asMilliSeconds > timeoutMs) {
      throw new Error(`Could not find a connected Android device in ${timer.getDuration().asMilliSeconds.toFixed(0)}ms.`);
    }

    try {
      const devices = await this.getConnectedDevices();

      if (devices.length > 0) {
        return devices;
      }
    } catch (ign) {}

    _logger.default.debug('Could not find online devices');

    try {
      await this.reconnect();
    } catch (ign) {
      await this.restartAdb();
    }

    await (0, _asyncbox.sleep)(200);
    return await getDevices();
  };

  return await getDevices();
};

systemCallMethods.reconnect = async function reconnect(target = 'offline') {
  _logger.default.debug(`Reconnecting adb (target ${target})`);

  const args = ['reconnect'];

  if (target) {
    args.push(target);
  }

  try {
    await this.adbExec(args);
  } catch (e) {
    throw new Error(`Cannot reconnect adb. Original error: ${e.stderr || e.message}`);
  }
};

systemCallMethods.restartAdb = async function restartAdb() {
  if (this.suppressKillServer) {
    _logger.default.debug(`Not restarting abd since 'suppressKillServer' is on`);

    return;
  }

  _logger.default.debug('Restarting adb');

  try {
    await this.killServer();
    await this.adbExec(['start-server']);
  } catch (e) {
    _logger.default.error(`Error killing ADB server, going to see if it's online anyway`);
  }
};

systemCallMethods.killServer = async function killServer() {
  _logger.default.debug(`Killing adb server on port '${this.adbPort}'`);

  await this.adbExec(['kill-server'], {
    exclusive: true
  });
};

systemCallMethods.resetTelnetAuthToken = _lodash.default.memoize(async function resetTelnetAuthToken() {
  const homeFolderPath = process.env[process.platform === 'win32' ? 'USERPROFILE' : 'HOME'];

  if (!homeFolderPath) {
    _logger.default.warn(`Cannot find the path to user home folder. Ignoring resetting of emulator's telnet authentication token`);

    return false;
  }

  const dstPath = _path.default.resolve(homeFolderPath, '.emulator_console_auth_token');

  _logger.default.debug(`Overriding ${dstPath} with an empty string to avoid telnet authentication for emulator commands`);

  try {
    await _appiumSupport.fs.writeFile(dstPath, '');
  } catch (e) {
    _logger.default.warn(`Error ${e.message} while resetting the content of ${dstPath}. Ignoring resetting of emulator's telnet authentication token`);

    return false;
  }

  return true;
});

systemCallMethods.adbExecEmu = async function adbExecEmu(cmd) {
  await this.verifyEmulatorConnected();
  await this.resetTelnetAuthToken();
  await this.adbExec(['emu', ...cmd]);
};

let isExecLocked = false;
systemCallMethods.EXEC_OUTPUT_FORMAT = Object.freeze({
  STDOUT: 'stdout',
  FULL: 'full'
});

systemCallMethods.adbExec = async function adbExec(cmd, opts = {}) {
  if (!cmd) {
    throw new Error('You need to pass in a command to adbExec()');
  }

  opts = _lodash.default.cloneDeep(opts);
  opts.timeout = opts.timeout || this.adbExecTimeout || _helpers.DEFAULT_ADB_EXEC_TIMEOUT;
  opts.timeoutCapName = opts.timeoutCapName || 'adbExecTimeout';
  const {
    outputFormat = this.EXEC_OUTPUT_FORMAT.STDOUT
  } = opts;
  cmd = _lodash.default.isArray(cmd) ? cmd : [cmd];
  let adbRetried = false;

  const execFunc = async () => {
    try {
      const args = [...this.executable.defaultArgs, ...cmd];

      _logger.default.debug(`Running '${this.executable.path} ` + (args.find(arg => /\s+/.test(arg)) ? _appiumSupport.util.quote(args) : args.join(' ')) + `'`);

      let {
        stdout,
        stderr
      } = await (0, _teen_process.exec)(this.executable.path, args, opts);
      stdout = stdout.replace(LINKER_WARNING_REGEXP, '').trim();
      return outputFormat === this.EXEC_OUTPUT_FORMAT.FULL ? {
        stdout,
        stderr
      } : stdout;
    } catch (e) {
      const errText = `${e.message}, ${e.stdout}, ${e.stderr}`;

      if (ADB_RETRY_ERROR_PATTERNS.some(p => p.test(errText))) {
        _logger.default.info(`Error sending command, reconnecting device and retrying: ${cmd}`);

        await (0, _asyncbox.sleep)(1000);
        await this.getDevicesWithRetry();

        if (adbRetried) {
          adbRetried = true;
          return await execFunc();
        }
      }

      if (e.code === 0 && e.stdout) {
        return e.stdout.replace(LINKER_WARNING_REGEXP, '').trim();
      }

      if (_lodash.default.isNull(e.code)) {
        e.message = `Error executing adbExec. Original error: '${e.message}'. ` + `Try to increase the ${opts.timeout}ms adb execution timeout represented by '${opts.timeoutCapName}' capability`;
      } else {
        e.message = `Error executing adbExec. Original error: '${e.message}'; ` + `Command output: ${e.stderr || e.stdout || '<empty>'}`;
      }

      throw e;
    }
  };

  if (isExecLocked) {
    _logger.default.debug('Waiting until the other exclusive ADB command is completed');

    await (0, _asyncbox.waitForCondition)(() => !isExecLocked, {
      waitMs: Number.MAX_SAFE_INTEGER,
      intervalMs: 10
    });

    _logger.default.debug('Continuing with the current ADB command');
  }

  if (opts.exclusive) {
    isExecLocked = true;
  }

  try {
    return await execFunc();
  } finally {
    if (opts.exclusive) {
      isExecLocked = false;
    }
  }
};

systemCallMethods.shell = async function shell(cmd, opts = {}) {
  const {
    privileged
  } = opts;
  const cmdArr = _lodash.default.isArray(cmd) ? cmd : [cmd];
  const fullCmd = ['shell'];

  if (privileged) {
    _logger.default.info(`'adb shell ${_appiumSupport.util.quote(cmdArr)}' requires root access`);

    if (await this.isRoot()) {
      _logger.default.info('The device already had root access');

      fullCmd.push(...cmdArr);
    } else {
      fullCmd.push('su', 'root', _appiumSupport.util.quote(cmdArr));
    }
  } else {
    fullCmd.push(...cmdArr);
  }

  return await this.adbExec(fullCmd, opts);
};

systemCallMethods.createSubProcess = function createSubProcess(args = []) {
  args = [...this.executable.defaultArgs, ...args];

  _logger.default.debug(`Creating ADB subprocess with args: ${JSON.stringify(args)}`);

  return new _teen_process.SubProcess(this.getAdbPath(), args);
};

systemCallMethods.getAdbServerPort = function getAdbServerPort() {
  return this.adbPort;
};

systemCallMethods.getEmulatorPort = async function getEmulatorPort() {
  _logger.default.debug('Getting running emulator port');

  if (this.emulatorPort !== null) {
    return this.emulatorPort;
  }

  try {
    let devices = await this.getConnectedDevices();
    let port = this.getPortFromEmulatorString(devices[0].udid);

    if (port) {
      return port;
    } else {
      throw new Error(`Emulator port not found`);
    }
  } catch (e) {
    throw new Error(`No devices connected. Original error: ${e.message}`);
  }
};

systemCallMethods.getPortFromEmulatorString = function getPortFromEmulatorString(emStr) {
  let portPattern = /emulator-(\d+)/;

  if (portPattern.test(emStr)) {
    return parseInt(portPattern.exec(emStr)[1], 10);
  }

  return false;
};

systemCallMethods.getConnectedEmulators = async function getConnectedEmulators() {
  _logger.default.debug('Getting connected emulators');

  try {
    let devices = await this.getConnectedDevices();
    let emulators = [];

    for (let device of devices) {
      let port = this.getPortFromEmulatorString(device.udid);

      if (port) {
        device.port = port;
        emulators.push(device);
      }
    }

    _logger.default.debug(`${_appiumSupport.util.pluralize('emulator', emulators.length, true)} connected`);

    return emulators;
  } catch (e) {
    throw new Error(`Error getting emulators. Original error: ${e.message}`);
  }
};

systemCallMethods.setEmulatorPort = function setEmulatorPort(emPort) {
  this.emulatorPort = emPort;
};

systemCallMethods.setDeviceId = function setDeviceId(deviceId) {
  _logger.default.debug(`Setting device id to ${deviceId}`);

  this.curDeviceId = deviceId;
  let argsHasDevice = this.executable.defaultArgs.indexOf('-s');

  if (argsHasDevice !== -1) {
    this.executable.defaultArgs.splice(argsHasDevice, 2);
  }

  this.executable.defaultArgs.push('-s', deviceId);
};

systemCallMethods.setDevice = function setDevice(deviceObj) {
  let deviceId = deviceObj.udid;
  let emPort = this.getPortFromEmulatorString(deviceId);
  this.setEmulatorPort(emPort);
  this.setDeviceId(deviceId);
};

systemCallMethods.getRunningAVD = async function getRunningAVD(avdName) {
  _logger.default.debug(`Trying to find '${avdName}' emulator`);

  try {
    const emulators = await this.getConnectedEmulators();

    for (const emulator of emulators) {
      this.setEmulatorPort(emulator.port);
      const runningAVDName = await this.execEmuConsoleCommand(['avd', 'name'], {
        port: emulator.port,
        execTimeout: 5000,
        connTimeout: 1000
      });

      if (_lodash.default.toLower(avdName) === _lodash.default.toLower(runningAVDName.trim())) {
        _logger.default.debug(`Found emulator '${avdName}' on port ${emulator.port}`);

        this.setDeviceId(emulator.udid);
        return emulator;
      }
    }

    _logger.default.debug(`Emulator '${avdName}' not running`);

    return null;
  } catch (e) {
    throw new Error(`Error getting AVD. Original error: ${e.message}`);
  }
};

systemCallMethods.getRunningAVDWithRetry = async function getRunningAVDWithRetry(avdName, timeoutMs = 20000) {
  try {
    return await (0, _asyncbox.waitForCondition)(async () => {
      try {
        return await this.getRunningAVD(avdName.replace('@', ''));
      } catch (e) {
        _logger.default.debug(e.message);

        return false;
      }
    }, {
      waitMs: timeoutMs,
      intervalMs: 1000
    });
  } catch (e) {
    throw new Error(`Error getting AVD with retry. Original error: ${e.message}`);
  }
};

systemCallMethods.killAllEmulators = async function killAllEmulators() {
  let cmd, args;

  if (_appiumSupport.system.isWindows()) {
    cmd = 'TASKKILL';
    args = ['TASKKILL', '/IM', 'emulator.exe'];
  } else {
    cmd = '/usr/bin/killall';
    args = ['-m', 'emulator*'];
  }

  try {
    await (0, _teen_process.exec)(cmd, args);
  } catch (e) {
    throw new Error(`Error killing emulators. Original error: ${e.message}`);
  }
};

systemCallMethods.killEmulator = async function killEmulator(avdName = null, timeout = 60000) {
  if (_appiumSupport.util.hasValue(avdName)) {
    _logger.default.debug(`Killing avd '${avdName}'`);

    const device = await this.getRunningAVD(avdName);

    if (!device) {
      _logger.default.info(`No avd with name '${avdName}' running. Skipping kill step.`);

      return false;
    }
  } else {
    _logger.default.debug(`Killing avd with id '${this.curDeviceId}'`);

    if (!(await this.isEmulatorConnected())) {
      _logger.default.debug(`Emulator with id '${this.curDeviceId}' not connected. Skipping kill step`);

      return false;
    }
  }

  await this.adbExec(['emu', 'kill']);

  _logger.default.debug(`Waiting up to ${timeout}ms until the emulator '${avdName ? avdName : this.curDeviceId}' is killed`);

  try {
    await (0, _asyncbox.waitForCondition)(async () => {
      try {
        return _appiumSupport.util.hasValue(avdName) ? !(await this.getRunningAVD(avdName)) : !(await this.isEmulatorConnected());
      } catch (ign) {}

      return false;
    }, {
      waitMs: timeout,
      intervalMs: 2000
    });
  } catch (e) {
    throw new Error(`The emulator '${avdName ? avdName : this.curDeviceId}' is still running after being killed ${timeout}ms ago`);
  }

  _logger.default.info(`Successfully killed the '${avdName ? avdName : this.curDeviceId}' emulator`);

  return true;
};

systemCallMethods.launchAVD = async function launchAVD(avdName, opts = {}) {
  const {
    args = [],
    env = {},
    language,
    country,
    launchTimeout = 60000,
    readyTimeout = 60000,
    retryTimes = 1
  } = opts;

  _logger.default.debug(`Launching Emulator with AVD ${avdName}, launchTimeout ` + `${launchTimeout}ms and readyTimeout ${readyTimeout}ms`);

  const emulatorBinaryPath = await this.getSdkBinaryPath('emulator');

  if (avdName[0] === '@') {
    avdName = avdName.substr(1);
  }

  await this.checkAvdExist(avdName);
  const launchArgs = ['-avd', avdName];
  launchArgs.push(...(0, _helpers.toAvdLocaleArgs)(language, country));
  let isDelayAdbFeatureEnabled = false;

  if (this.allowDelayAdb) {
    const {
      revision
    } = await this.getEmuVersionInfo();

    if (revision && _appiumSupport.util.compareVersions(revision, '>=', '29.0.7')) {
      try {
        const {
          target
        } = await this.getEmuImageProperties(avdName);
        const apiMatch = /\d+/.exec(target);

        if (apiMatch && parseInt(apiMatch[0], 10) >= MIN_DELAY_ADB_API_LEVEL) {
          launchArgs.push('-delay-adb');
          isDelayAdbFeatureEnabled = true;
        } else {
          throw new Error(`The actual image API version is below ${MIN_DELAY_ADB_API_LEVEL}`);
        }
      } catch (e) {
        _logger.default.info(`The -delay-adb emulator startup detection feature will not be enabled. ` + `Original error: ${e.message}`);
      }
    }
  } else {
    _logger.default.info('The -delay-adb emulator startup detection feature has been explicitly disabled');
  }

  if (!_lodash.default.isEmpty(args)) {
    launchArgs.push(...(_lodash.default.isArray(args) ? args : _appiumSupport.util.shellParse(`${args}`)));
  }

  _logger.default.debug(`Running '${emulatorBinaryPath}' with args: ${_appiumSupport.util.quote(launchArgs)}`);

  if (!_lodash.default.isEmpty(env)) {
    _logger.default.debug(`Customized emulator environment: ${JSON.stringify(env)}`);
  }

  const proc = new _teen_process.SubProcess(emulatorBinaryPath, launchArgs, {
    env: Object.assign({}, process.env, env)
  });
  await proc.start(0);
  proc.on('output', (stdout, stderr) => {
    for (let line of (stdout || stderr || '').split('\n').filter(Boolean)) {
      _logger.default.info(`[AVD OUTPUT] ${line}`);
    }
  });
  proc.on('die', (code, signal) => {
    _logger.default.warn(`Emulator avd ${avdName} exited with code ${code}${signal ? `, signal ${signal}` : ''}`);
  });
  await (0, _asyncbox.retry)(retryTimes, async () => await this.getRunningAVDWithRetry(avdName, launchTimeout));

  if (isDelayAdbFeatureEnabled) {
    try {
      await this.adbExec(['wait-for-device'], {
        timeout: readyTimeout
      });
    } catch (e) {
      throw new Error(`'${avdName}' Emulator has failed to boot: ${e.stderr || e.message}`);
    }
  } else {
    await this.waitForEmulatorReady(readyTimeout);
  }

  return proc;
};

systemCallMethods.getVersion = _lodash.default.memoize(async function getVersion() {
  let stdout;

  try {
    stdout = await this.adbExec('version');
  } catch (e) {
    throw new Error(`Error getting adb version: ${e.stderr || e.message}`);
  }

  const result = {};
  const binaryVersionMatch = BINARY_VERSION_PATTERN.exec(stdout);

  if (binaryVersionMatch) {
    result.binary = {
      version: _semver.default.coerce(binaryVersionMatch[1]),
      build: parseInt(binaryVersionMatch[2], 10)
    };
  }

  const bridgeVersionMatch = BRIDGE_VERSION_PATTERN.exec(stdout);

  if (bridgeVersionMatch) {
    result.bridge = {
      version: _semver.default.coerce(bridgeVersionMatch[1])
    };
  }

  return result;
});

systemCallMethods.waitForEmulatorReady = async function waitForEmulatorReady(timeoutMs = 20000) {
  try {
    await (0, _asyncbox.waitForCondition)(async () => {
      try {
        if (!(await this.shell(['getprop', 'init.svc.bootanim'])).includes('stopped')) {
          return false;
        }

        return /\d+\[\w+\]/.test(await this.shell(['pm', 'get-install-location']));
      } catch (err) {
        _logger.default.debug(`Waiting for emulator startup. Intermediate error: ${err.message}`);

        return false;
      }
    }, {
      waitMs: timeoutMs,
      intervalMs: 3000
    });
  } catch (e) {
    throw new Error(`Emulator is not ready within ${timeoutMs}ms`);
  }
};

systemCallMethods.waitForDevice = async function waitForDevice(appDeviceReadyTimeout = 30) {
  this.appDeviceReadyTimeout = appDeviceReadyTimeout;
  const retries = 3;
  const timeout = parseInt(this.appDeviceReadyTimeout, 10) * 1000 / retries;
  await (0, _asyncbox.retry)(retries, async () => {
    try {
      await this.adbExec('wait-for-device', {
        timeout
      });
      await this.ping();
    } catch (e) {
      try {
        await this.reconnect();
      } catch (ign) {
        await this.restartAdb();
      }

      await this.getConnectedDevices();
      throw new Error(`Error waiting for the device to be available. Original error: '${e.message}'`);
    }
  });
};

systemCallMethods.reboot = async function reboot(retries = DEFAULT_ADB_REBOOT_RETRIES) {
  const {
    wasAlreadyRooted
  } = await this.root();

  try {
    await this.shell(['stop']);
    await _bluebird.default.delay(2000);
    await this.setDeviceProperty('sys.boot_completed', 0, {
      privileged: false
    });
    await this.shell(['start']);
  } catch (e) {
    const {
      message
    } = e;

    if (message.includes('must be root')) {
      throw new Error(`Could not reboot device. Rebooting requires root access and ` + `attempt to get root access on device failed with error: '${message}'`);
    }

    throw e;
  } finally {
    if (!wasAlreadyRooted) {
      await this.unroot();
    }
  }

  const timer = new _appiumSupport.timing.Timer().start();
  await (0, _asyncbox.retryInterval)(retries, 1000, async () => {
    if ((await this.getDeviceProperty('sys.boot_completed')) === '1') {
      return;
    }

    const msg = `Reboot is not completed after ${timer.getDuration().asMilliSeconds.toFixed(0)}ms`;

    _logger.default.debug(msg);

    throw new Error(msg);
  });
};

systemCallMethods.changeUserPrivileges = async function changeUserPrivileges(isElevated) {
  const cmd = isElevated ? 'root' : 'unroot';

  const retryIfOffline = async cmdFunc => {
    try {
      return await cmdFunc();
    } catch (err) {
      if (['closed', 'device offline', 'timeout expired'].some(x => (err.stderr || '').toLowerCase().includes(x))) {
        _logger.default.warn(`Attempt to ${cmd} caused ADB to think the device went offline`);

        try {
          await this.reconnect();
        } catch (ign) {
          await this.restartAdb();
        }

        return await cmdFunc();
      } else {
        throw err;
      }
    }
  };

  const isRoot = await retryIfOffline(async () => await this.isRoot());

  if (isRoot && isElevated || !isRoot && !isElevated) {
    return {
      isSuccessful: true,
      wasAlreadyRooted: isRoot
    };
  }

  let wasAlreadyRooted = isRoot;

  try {
    const {
      stdout
    } = await retryIfOffline(async () => await this.adbExec([cmd]));

    _logger.default.debug(stdout);

    if (stdout) {
      if (stdout.includes('adbd cannot run as root')) {
        return {
          isSuccessful: false,
          wasAlreadyRooted
        };
      }

      if (stdout.includes('already running as root')) {
        wasAlreadyRooted = true;
      }
    }

    return {
      isSuccessful: true,
      wasAlreadyRooted
    };
  } catch (err) {
    const {
      stderr = '',
      message
    } = err;

    _logger.default.warn(`Unable to ${cmd} adb daemon. Original error: '${message}'. Stderr: '${stderr}'. Continuing.`);

    return {
      isSuccessful: false,
      wasAlreadyRooted
    };
  }
};

systemCallMethods.root = async function root() {
  return await this.changeUserPrivileges(true);
};

systemCallMethods.unroot = async function unroot() {
  return await this.changeUserPrivileges(false);
};

systemCallMethods.isRoot = async function isRoot() {
  return (await this.shell(['whoami'])).trim() === 'root';
};

systemCallMethods.fileExists = async function fileExists(remotePath) {
  const passFlag = '__PASS__';
  const checkCmd = `[ -e '${remotePath.replace(/'/g, `\\'`)}' ] && echo ${passFlag}`;

  try {
    return _lodash.default.includes(await this.shell([checkCmd]), passFlag);
  } catch (ign) {
    return false;
  }
};

systemCallMethods.ls = async function ls(remotePath, opts = []) {
  try {
    let args = ['ls', ...opts, remotePath];
    let stdout = await this.shell(args);
    let lines = stdout.split('\n');
    return lines.map(l => l.trim()).filter(Boolean).filter(l => l.indexOf('No such file') === -1);
  } catch (err) {
    if (err.message.indexOf('No such file or directory') === -1) {
      throw err;
    }

    return [];
  }
};

systemCallMethods.fileSize = async function fileSize(remotePath) {
  try {
    const files = await this.ls(remotePath, ['-la']);

    if (files.length !== 1) {
      throw new Error(`Remote path is not a file`);
    }

    const match = /[rwxsStT\-+]{10}[\s\d]*\s[^\s]+\s+[^\s]+\s+(\d+)/.exec(files[0]);

    if (!match || _lodash.default.isNaN(parseInt(match[1], 10))) {
      throw new Error(`Unable to parse size from list output: '${files[0]}'`);
    }

    return parseInt(match[1], 10);
  } catch (err) {
    throw new Error(`Unable to get file size for '${remotePath}': ${err.message}`);
  }
};

systemCallMethods.installMitmCertificate = async function installMitmCertificate(cert) {
  const openSsl = await (0, _helpers.getOpenSslForOs)();

  if (!_lodash.default.isBuffer(cert)) {
    cert = Buffer.from(cert, 'base64');
  }

  const tmpRoot = await _appiumSupport.tempDir.openDir();

  try {
    const srcCert = _path.default.resolve(tmpRoot, 'source.cer');

    await _appiumSupport.fs.writeFile(srcCert, cert);
    let {
      stdout
    } = await (0, _teen_process.exec)(openSsl, ['x509', '-noout', '-hash', '-in', srcCert]);
    const certHash = stdout.trim();

    _logger.default.debug(`Got certificate hash: ${certHash}`);

    _logger.default.debug('Preparing certificate content');

    ({
      stdout
    } = await (0, _teen_process.exec)(openSsl, ['x509', '-in', srcCert], {
      isBuffer: true
    }));
    let dstCertContent = stdout;
    ({
      stdout
    } = await (0, _teen_process.exec)(openSsl, ['x509', '-in', srcCert, '-text', '-fingerprint', '-noout'], {
      isBuffer: true
    }));
    dstCertContent = Buffer.concat([dstCertContent, stdout]);

    const dstCert = _path.default.resolve(tmpRoot, `${certHash}.0`);

    await _appiumSupport.fs.writeFile(dstCert, dstCertContent);

    _logger.default.debug('Remounting /system in rw mode');

    await (0, _asyncbox.retryInterval)(5, 2000, async () => await this.adbExec(['remount']));

    _logger.default.debug(`Uploading the generated certificate from '${dstCert}' to '${CERTS_ROOT}'`);

    await this.push(dstCert, CERTS_ROOT);

    _logger.default.debug('Remounting /system to confirm changes');

    await this.adbExec(['remount']);
  } catch (err) {
    throw new Error(`Cannot inject the custom certificate. ` + `Is the certificate properly encoded into base64-string? ` + `Do you have root permissions on the device? ` + `Original error: ${err.message}`);
  } finally {
    await _appiumSupport.fs.rimraf(tmpRoot);
  }
};

systemCallMethods.isMitmCertificateInstalled = async function isMitmCertificateInstalled(cert) {
  const openSsl = await (0, _helpers.getOpenSslForOs)();

  if (!_lodash.default.isBuffer(cert)) {
    cert = Buffer.from(cert, 'base64');
  }

  const tmpRoot = await _appiumSupport.tempDir.openDir();
  let certHash;

  try {
    const tmpCert = _path.default.resolve(tmpRoot, 'source.cer');

    await _appiumSupport.fs.writeFile(tmpCert, cert);
    const {
      stdout
    } = await (0, _teen_process.exec)(openSsl, ['x509', '-noout', '-hash', '-in', tmpCert]);
    certHash = stdout.trim();
  } catch (err) {
    throw new Error(`Cannot retrieve the certificate hash. ` + `Is the certificate properly encoded into base64-string? ` + `Original error: ${err.message}`);
  } finally {
    await _appiumSupport.fs.rimraf(tmpRoot);
  }

  const dstPath = _path.default.posix.resolve(CERTS_ROOT, `${certHash}.0`);

  _logger.default.debug(`Checking if the certificate is already installed at '${dstPath}'`);

  return await this.fileExists(dstPath);
};

var _default = systemCallMethods;
exports.default = _default;require('source-map-support').install();


//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImxpYi90b29scy9zeXN0ZW0tY2FsbHMuanMiXSwibmFtZXMiOlsic3lzdGVtQ2FsbE1ldGhvZHMiLCJERUZBVUxUX0FEQl9SRUJPT1RfUkVUUklFUyIsIkxJTktFUl9XQVJOSU5HX1JFR0VYUCIsIkFEQl9SRVRSWV9FUlJPUl9QQVRURVJOUyIsIkJJTkFSWV9WRVJTSU9OX1BBVFRFUk4iLCJCUklER0VfVkVSU0lPTl9QQVRURVJOIiwiQ0VSVFNfUk9PVCIsIlNES19CSU5BUllfUk9PVFMiLCJNSU5fREVMQVlfQURCX0FQSV9MRVZFTCIsImdldFNka0JpbmFyeVBhdGgiLCJiaW5hcnlOYW1lIiwiZ2V0QmluYXJ5RnJvbVNka1Jvb3QiLCJnZXRCaW5hcnlOYW1lRm9yT1MiLCJfIiwibWVtb2l6ZSIsImdldEJpbmFyeU5hbWVGb3JPU01lbW9yaXplIiwic3lzdGVtIiwiaXNXaW5kb3dzIiwiaW5jbHVkZXMiLCJwYXRoIiwiZXh0bmFtZSIsImJpbmFyaWVzIiwiZnVsbEJpbmFyeU5hbWUiLCJiaW5hcnlMb2NzIiwiZ2V0U2RrQmluYXJ5TG9jYXRpb25DYW5kaWRhdGVzIiwic2RrUm9vdCIsImJ1aWxkVG9vbHNEaXJzIiwiYnVpbGRUb29sc1ZlcnNpb24iLCJmaWx0ZXIiLCJ4IiwiYmFzZW5hbWUiLCJpc0VtcHR5IiwibG9nIiwiaW5mbyIsInB1c2giLCJmbGF0dGVuIiwibWFwIiwiZGlyIiwicmVzb2x2ZSIsImJpbmFyeUxvYyIsImxvYyIsImZzIiwiZXhpc3RzIiwiaXNOdWxsIiwiRXJyb3IiLCJKU09OIiwic3RyaW5naWZ5IiwiaXNBcnJheSIsImdldEFuZHJvaWRCaW5hcnlQYXRoIiwiZ2V0QmluYXJ5RnJvbVBhdGgiLCJ3aGljaCIsImUiLCJnZXRDb25uZWN0ZWREZXZpY2VzIiwiZGVidWciLCJzdGRvdXQiLCJleGVjdXRhYmxlIiwiZGVmYXVsdEFyZ3MiLCJtZXNzYWdlIiwibGlzdEhlYWRlciIsInN0YXJ0aW5nSW5kZXgiLCJpbmRleE9mIiwic2xpY2UiLCJleGNsdWRlZExpbmVzIiwiYWxsb3dPZmZsaW5lRGV2aWNlcyIsImRldmljZXMiLCJzcGxpdCIsInRyaW0iLCJsaW5lIiwic29tZSIsInJlZHVjZSIsImFjYyIsInVkaWQiLCJzdGF0ZSIsImdldERldmljZXNXaXRoUmV0cnkiLCJ0aW1lb3V0TXMiLCJ0aW1lciIsInRpbWluZyIsIlRpbWVyIiwic3RhcnQiLCJnZXREZXZpY2VzIiwiZ2V0RHVyYXRpb24iLCJhc01pbGxpU2Vjb25kcyIsInRvRml4ZWQiLCJsZW5ndGgiLCJpZ24iLCJyZWNvbm5lY3QiLCJyZXN0YXJ0QWRiIiwidGFyZ2V0IiwiYXJncyIsImFkYkV4ZWMiLCJzdGRlcnIiLCJzdXBwcmVzc0tpbGxTZXJ2ZXIiLCJraWxsU2VydmVyIiwiZXJyb3IiLCJhZGJQb3J0IiwiZXhjbHVzaXZlIiwicmVzZXRUZWxuZXRBdXRoVG9rZW4iLCJob21lRm9sZGVyUGF0aCIsInByb2Nlc3MiLCJlbnYiLCJwbGF0Zm9ybSIsIndhcm4iLCJkc3RQYXRoIiwid3JpdGVGaWxlIiwiYWRiRXhlY0VtdSIsImNtZCIsInZlcmlmeUVtdWxhdG9yQ29ubmVjdGVkIiwiaXNFeGVjTG9ja2VkIiwiRVhFQ19PVVRQVVRfRk9STUFUIiwiT2JqZWN0IiwiZnJlZXplIiwiU1RET1VUIiwiRlVMTCIsIm9wdHMiLCJjbG9uZURlZXAiLCJ0aW1lb3V0IiwiYWRiRXhlY1RpbWVvdXQiLCJERUZBVUxUX0FEQl9FWEVDX1RJTUVPVVQiLCJ0aW1lb3V0Q2FwTmFtZSIsIm91dHB1dEZvcm1hdCIsImFkYlJldHJpZWQiLCJleGVjRnVuYyIsImZpbmQiLCJhcmciLCJ0ZXN0IiwidXRpbCIsInF1b3RlIiwiam9pbiIsInJlcGxhY2UiLCJlcnJUZXh0IiwicCIsImNvZGUiLCJ3YWl0TXMiLCJOdW1iZXIiLCJNQVhfU0FGRV9JTlRFR0VSIiwiaW50ZXJ2YWxNcyIsInNoZWxsIiwicHJpdmlsZWdlZCIsImNtZEFyciIsImZ1bGxDbWQiLCJpc1Jvb3QiLCJjcmVhdGVTdWJQcm9jZXNzIiwiU3ViUHJvY2VzcyIsImdldEFkYlBhdGgiLCJnZXRBZGJTZXJ2ZXJQb3J0IiwiZ2V0RW11bGF0b3JQb3J0IiwiZW11bGF0b3JQb3J0IiwicG9ydCIsImdldFBvcnRGcm9tRW11bGF0b3JTdHJpbmciLCJlbVN0ciIsInBvcnRQYXR0ZXJuIiwicGFyc2VJbnQiLCJleGVjIiwiZ2V0Q29ubmVjdGVkRW11bGF0b3JzIiwiZW11bGF0b3JzIiwiZGV2aWNlIiwicGx1cmFsaXplIiwic2V0RW11bGF0b3JQb3J0IiwiZW1Qb3J0Iiwic2V0RGV2aWNlSWQiLCJkZXZpY2VJZCIsImN1ckRldmljZUlkIiwiYXJnc0hhc0RldmljZSIsInNwbGljZSIsInNldERldmljZSIsImRldmljZU9iaiIsImdldFJ1bm5pbmdBVkQiLCJhdmROYW1lIiwiZW11bGF0b3IiLCJydW5uaW5nQVZETmFtZSIsImV4ZWNFbXVDb25zb2xlQ29tbWFuZCIsImV4ZWNUaW1lb3V0IiwiY29ublRpbWVvdXQiLCJ0b0xvd2VyIiwiZ2V0UnVubmluZ0FWRFdpdGhSZXRyeSIsImtpbGxBbGxFbXVsYXRvcnMiLCJraWxsRW11bGF0b3IiLCJoYXNWYWx1ZSIsImlzRW11bGF0b3JDb25uZWN0ZWQiLCJsYXVuY2hBVkQiLCJsYW5ndWFnZSIsImNvdW50cnkiLCJsYXVuY2hUaW1lb3V0IiwicmVhZHlUaW1lb3V0IiwicmV0cnlUaW1lcyIsImVtdWxhdG9yQmluYXJ5UGF0aCIsInN1YnN0ciIsImNoZWNrQXZkRXhpc3QiLCJsYXVuY2hBcmdzIiwiaXNEZWxheUFkYkZlYXR1cmVFbmFibGVkIiwiYWxsb3dEZWxheUFkYiIsInJldmlzaW9uIiwiZ2V0RW11VmVyc2lvbkluZm8iLCJjb21wYXJlVmVyc2lvbnMiLCJnZXRFbXVJbWFnZVByb3BlcnRpZXMiLCJhcGlNYXRjaCIsInNoZWxsUGFyc2UiLCJwcm9jIiwiYXNzaWduIiwib24iLCJCb29sZWFuIiwic2lnbmFsIiwid2FpdEZvckVtdWxhdG9yUmVhZHkiLCJnZXRWZXJzaW9uIiwicmVzdWx0IiwiYmluYXJ5VmVyc2lvbk1hdGNoIiwiYmluYXJ5IiwidmVyc2lvbiIsInNlbXZlciIsImNvZXJjZSIsImJ1aWxkIiwiYnJpZGdlVmVyc2lvbk1hdGNoIiwiYnJpZGdlIiwiZXJyIiwid2FpdEZvckRldmljZSIsImFwcERldmljZVJlYWR5VGltZW91dCIsInJldHJpZXMiLCJwaW5nIiwicmVib290Iiwid2FzQWxyZWFkeVJvb3RlZCIsInJvb3QiLCJCIiwiZGVsYXkiLCJzZXREZXZpY2VQcm9wZXJ0eSIsInVucm9vdCIsImdldERldmljZVByb3BlcnR5IiwibXNnIiwiY2hhbmdlVXNlclByaXZpbGVnZXMiLCJpc0VsZXZhdGVkIiwicmV0cnlJZk9mZmxpbmUiLCJjbWRGdW5jIiwidG9Mb3dlckNhc2UiLCJpc1N1Y2Nlc3NmdWwiLCJmaWxlRXhpc3RzIiwicmVtb3RlUGF0aCIsInBhc3NGbGFnIiwiY2hlY2tDbWQiLCJscyIsImxpbmVzIiwibCIsImZpbGVTaXplIiwiZmlsZXMiLCJtYXRjaCIsImlzTmFOIiwiaW5zdGFsbE1pdG1DZXJ0aWZpY2F0ZSIsImNlcnQiLCJvcGVuU3NsIiwiaXNCdWZmZXIiLCJCdWZmZXIiLCJmcm9tIiwidG1wUm9vdCIsInRlbXBEaXIiLCJvcGVuRGlyIiwic3JjQ2VydCIsImNlcnRIYXNoIiwiZHN0Q2VydENvbnRlbnQiLCJjb25jYXQiLCJkc3RDZXJ0IiwicmltcmFmIiwiaXNNaXRtQ2VydGlmaWNhdGVJbnN0YWxsZWQiLCJ0bXBDZXJ0IiwicG9zaXgiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUlBOztBQUNBOztBQUNBOztBQUNBOztBQUdBLElBQUlBLGlCQUFpQixHQUFHLEVBQXhCO0FBRUEsTUFBTUMsMEJBQTBCLEdBQUcsRUFBbkM7QUFDQSxNQUFNQyxxQkFBcUIsR0FBRyxzQkFBOUI7QUFDQSxNQUFNQyx3QkFBd0IsR0FBRyxDQUMvQiwrQkFEK0IsRUFFL0Isa0NBRitCLEVBRy9CLGlDQUgrQixDQUFqQztB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QXNCLFlBQXRCLENBQWhCOztBQUNBLFVBQU1qTixrQkFBRzhELFNBQUgsQ0FBYTZKLE9BQWIsRUFBc0JmLElBQXRCLENBQU47QUFDQSxVQUFNO0FBQUMvTCxNQUFBQTtBQUFELFFBQVcsTUFBTSx3QkFBS2dNLE9BQUwsRUFBYyxDQUFDLE1BQUQsRUFBUyxRQUFULEVBQW1CLE9BQW5CLEVBQTRCLEtBQTVCLEVBQW1DYyxPQUFuQyxDQUFkLENBQXZCO0FBQ0FOLElBQUFBLFFBQVEsR0FBR3hNLE1BQU0sQ0FBQ1ksSUFBUCxFQUFYO0FBQ0QsR0FMRCxDQUtFLE9BQU9tSixHQUFQLEVBQVk7QUFDWixVQUFNLElBQUl6SyxLQUFKLENBQVcsd0NBQUQsR0FDQywwREFERCxHQUVDLG1CQUFrQnlLLEdBQUcsQ0FBQzVKLE9BQVEsRUFGekMsQ0FBTjtBQUdELEdBVEQsU0FTVTtBQUNSLFVBQU1oQixrQkFBR3lOLE1BQUgsQ0FBVVIsT0FBVixDQUFOO0FBQ0Q7O0FBQ0QsUUFBTXBKLE9BQU8sR0FBR25GLGNBQUtrUCxLQUFMLENBQVcvTixPQUFYLENBQW1CaEMsVUFBbkIsRUFBZ0MsR0FBRXdQLFFBQVMsSUFBM0MsQ0FBaEI7O0FBQ0E5TixrQkFBSXFCLEtBQUosQ0FBVyx3REFBdURpRCxPQUFRLEdBQTFFOztBQUNBLFNBQU8sTUFBTSxLQUFLbUksVUFBTCxDQUFnQm5JLE9BQWhCLENBQWI7QUFDRCxDQXhCRDs7ZUEwQmV0RyxpQiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0IGxvZyBmcm9tICcuLi9sb2dnZXIuanMnO1xuaW1wb3J0IEIgZnJvbSAnYmx1ZWJpcmQnO1xuaW1wb3J0IHsgc3lzdGVtLCBmcywgdXRpbCwgdGVtcERpciwgdGltaW5nIH0gZnJvbSAnYXBwaXVtLXN1cHBvcnQnO1xuaW1wb3J0IHtcbiAgZ2V0QnVpbGRUb29sc0RpcnMsIHRvQXZkTG9jYWxlQXJncyxcbiAgZ2V0T3BlblNzbEZvck9zLCBERUZBVUxUX0FEQl9FWEVDX1RJTUVPVVQsIGdldFNka1Jvb3RGcm9tRW52XG59IGZyb20gJy4uL2hlbHBlcnMnO1xuaW1wb3J0IHsgZXhlYywgU3ViUHJvY2VzcyB9IGZyb20gJ3RlZW5fcHJvY2Vzcyc7XG5pbXBvcnQgeyBzbGVlcCwgcmV0cnksIHJldHJ5SW50ZXJ2YWwsIHdhaXRGb3JDb25kaXRpb24gfSBmcm9tICdhc3luY2JveCc7XG5pbXBvcnQgXyBmcm9tICdsb2Rhc2gnO1xuaW1wb3J0IHNlbXZlciBmcm9tICdzZW12ZXInO1xuXG5cbmxldCBzeXN0ZW1DYWxsTWV0aG9kcyA9IHt9O1xuXG5jb25zdCBERUZBVUxUX0FEQl9SRUJPT1RfUkVUUklFUyA9IDkwO1xuY29uc3QgTElOS0VSX1dBUk5JTkdfUkVHRVhQID0gL15XQVJOSU5HOiBsaW5rZXIuKyQvbTtcbmNvbnN0IEFEQl9SRVRSWV9FUlJPUl9QQVRURVJOUyA9IFtcbiAgL3Byb3RvY29sIGZhdWx0IFxcKG5vIHN0YXR1c1xcKS9pLFxuICAvZXJyb3I6IGRldmljZSAoJy4rJyApP25vdCBmb3VuZC9pLFxuICAvZXJyb3I6IGRldmljZSBzdGlsbCBjb25uZWN0aW5nL2ksXG5dO1xuY29uc3QgQklOQVJZX1ZFUlNJT05fUEFUVEVSTiA9IC9eVmVyc2lvbiAoW1xcZC5dKyktKFxcZCspL207XG5jb25zdCBCUklER0VfVkVSU0lPTl9QQVRURVJOID0gL15BbmRyb2lkIERlYnVnIEJyaWRnZSB2ZXJzaW9uIChbXFxkLl0rKS9tO1xuY29uc3QgQ0VSVFNfUk9PVCA9ICcvc3lzdGVtL2V0Yy9zZWN1cml0eS9jYWNlcnRzJztcbmNvbnN0IFNES19CSU5BUllfUk9PVFMgPSBbXG4gICdwbGF0Zm9ybS10b29scycsXG4gICdlbXVsYXRvcicsXG4gIFsnY21kbGluZS10b29scycsICdsYXRlc3QnLCAnYmluJ10sXG4gICd0b29scycsXG4gIFsndG9vbHMnLCAnYmluJ10sXG4gICcuJyAvLyBBbGxvdyBjdXN0b20gc2RrUm9vdCB0byBzcGVjaWZ5IGZ1bGwgZm9sZGVyIHBhdGhcbl07XG5jb25zdCBNSU5fREVMQVlfQURCX0FQSV9MRVZFTCA9IDI4O1xuXG4vKipcbiAqIFJldHJpZXZlIGZ1bGwgcGF0aCB0byB0aGUgZ2l2ZW4gYmluYXJ5LlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBiaW5hcnlOYW1lIC0gVGhlIG5hbWUgb2YgdGhlIGJpbmFyeS5cbiAqIEByZXR1cm4ge3N0cmluZ30gRnVsbCBwYXRoIHRvIHRoZSBnaXZlbiBiaW5hcnkgaW5jbHVkaW5nIGN1cnJlbnQgU0RLIHJvb3QuXG4gKi9cbnN5c3RlbUNhbGxNZXRob2RzLmdldFNka0JpbmFyeVBhdGggPSBhc3luYyBmdW5jdGlvbiBnZXRTZGtCaW5hcnlQYXRoIChiaW5hcnlOYW1lKSB7XG4gIHJldHVybiBhd2FpdCB0aGlzLmdldEJpbmFyeUZyb21TZGtSb290KGJpbmFyeU5hbWUpO1xufTtcblxuLyoqXG4gKiBSZXRyaWV2ZSBmdWxsIGJpbmFyeSBuYW1lIGZvciB0aGUgY3VycmVudCBvcGVyYXRpbmcgc3lzdGVtIGFzIG1lbW90aXplLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBiaW5hcnlOYW1lIC0gc2ltcGxlIGJpbmFyeSBuYW1lLCBmb3IgZXhhbXBsZSAnYW5kcm9pZCcuXG4gKiBAcmV0dXJuIHtzdHJpbmd9IEZvcm1hdHRlZCBiaW5hcnkgbmFtZSBkZXBlbmRpbmcgb24gdGhlIGN1cnJlbnQgcGxhdGZvcm0sXG4gKiAgICAgICAgICAgICAgICAgIGZvciBleGFtcGxlLCAnYW5kcm9pZC5iYXQnIG9uIFdpbmRvd3MuXG4gKi9cbnN5c3RlbUNhbGxNZXRob2RzLmdldEJpbmFyeU5hbWVGb3JPUyA9IF8ubWVtb2l6ZShmdW5jdGlvbiBnZXRCaW5hcnlOYW1lRm9yT1NNZW1vcml6ZSAoYmluYXJ5TmFtZSkge1xuICByZXR1cm4gZ2V0QmluYXJ5TmFtZUZvck9TKGJpbmFyeU5hbWUpO1xufSk7XG5cbi8qKlxuICogUmV0cmlldmUgZnVsbCBiaW5hcnkgbmFtZSBmb3IgdGhlIGN1cnJlbnQgb3BlcmF0aW5nIHN5c3RlbS5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gYmluYXJ5TmFtZSAtIHNpbXBsZSBiaW5hcnkgbmFtZSwgZm9yIGV4YW1wbGUgJ2FuZHJvaWQnLlxuICogQHJldHVybiB7c3RyaW5nfSBGb3JtYXR0ZWQgYmluYXJ5IG5hbWUgZGVwZW5kaW5nIG9uIHRoZSBjdXJyZW50IHBsYXRmb3JtLFxuICogICAgICAgICAgICAgICAgICBmb3IgZXhhbXBsZSwgJ2FuZHJvaWQuYmF0JyBvbiBXaW5kb3dzLlxuICovXG5mdW5jdGlvbiBnZXRCaW5hcnlOYW1lRm9yT1MgKGJpbmFyeU5hbWUpIHtcbiAgaWYgKCFzeXN0ZW0uaXNXaW5kb3dzKCkpIHtcbiAgICByZXR1cm4gYmluYXJ5TmFtZTtcbiAgfVxuXG4gIGlmIChbJ2FuZHJvaWQnLCAnYXBrc2lnbmVyJywgJ2Fwa2FuYWx5emVyJ10uaW5jbHVkZXMoYmluYXJ5TmFtZSkpIHtcbiAgICByZXR1cm4gYCR7YmluYXJ5TmFtZX0uYmF0YDtcbiAgfVxuICBpZiAoIXBhdGguZXh0bmFtZShiaW5hcnlOYW1lKSkge1xuICAgIHJldHVybiBgJHtiaW5hcnlOYW1lfS5leGVgO1xuICB9XG4gIHJldHVybiBiaW5hcnlOYW1lO1xufVxuXG4vKipcbiAqIFJldHJpZXZlIGZ1bGwgcGF0aCB0byB0aGUgZ2l2ZW4gYmluYXJ5IGFuZCBjYWNoZXMgaXQgaW50byBgYmluYXJpZXNgXG4gKiBwcm9wZXJ0eSBvZiB0aGUgY3VycmVudCBBREIgaW5zdGFuY2UuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IGJpbmFyeU5hbWUgLSBTaW1wbGUgbmFtZSBvZiBhIGJpbmFyeSBmaWxlLlxuICogQHJldHVybiB7c3RyaW5nfSBGdWxsIHBhdGggdG8gdGhlIGdpdmVuIGJpbmFyeS4gVGhlIG1ldGhvZCB0cmllc1xuICogICAgICAgICAgICAgICAgICB0byBlbnVtZXJhdGUgYWxsIHRoZSBrbm93biBsb2NhdGlvbnMgd2hlcmUgdGhlIGJpbmFyeVxuICogICAgICAgICAgICAgICAgICBtaWdodCBiZSBsb2NhdGVkIGFuZCBzdG9wcyB0aGUgc2VhcmNoIGFzIHNvb24gYXMgdGhlIGZpcnN0XG4gKiAgICAgICAgICAgICAgICAgIG1hdGNoIGlzIGZvdW5kIG9uIHRoZSBsb2NhbCBmaWxlIHN5c3RlbS5cbiAqIEB0aHJvd3Mge0Vycm9yfSBJZiB0aGUgYmluYXJ5IHdpdGggZ2l2ZW4gbmFtZSBpcyBub3QgcHJlc2VudCBhdCBhbnlcbiAqICAgICAgICAgICAgICAgICBvZiBrbm93biBsb2NhdGlvbnMgb3IgQW5kcm9pZCBTREsgaXMgbm90IGluc3RhbGxlZCBvbiB0aGVcbiAqICAgICAgICAgICAgICAgICBsb2NhbCBmaWxlIHN5c3RlbS5cbiAqL1xuc3lzdGVtQ2FsbE1ldGhvZHMuZ2V0QmluYXJ5RnJvbVNka1Jvb3QgPSBhc3luYyBmdW5jdGlvbiBnZXRCaW5hcnlGcm9tU2RrUm9vdCAoYmluYXJ5TmFtZSkge1xuICBpZiAodGhpcy5iaW5hcmllc1tiaW5hcnlOYW1lXSkge1xuICAgIHJldHVybiB0aGlzLmJpbmFyaWVzW2JpbmFyeU5hbWVdO1xuICB9XG4gIGNvbnN0IGZ1bGxCaW5hcnlOYW1lID0gdGhpcy5nZXRCaW5hcnlOYW1lRm9yT1MoYmluYXJ5TmFtZSk7XG4gIGNvbnN0IGJpbmFyeUxvY3MgPSBnZXRTZGtCaW5hcnlMb2NhdGlvbkNhbmRpZGF0ZXModGhpcy5zZGtSb290LCBmdWxsQmluYXJ5TmFtZSk7XG5cbiAgLy8gZ2V0IHN1YnBhdGhzIGZvciBjdXJyZW50bHkgaW5zdGFsbGVkIGJ1aWxkIHRvb2wgZGlyZWN0b3JpZXNcbiAgbGV0IGJ1aWxkVG9vbHNEaXJzID0gYXdhaXQgZ2V0QnVpbGRUb29sc0RpcnModGhpcy5zZGtSb290KTtcbiAgaWYgKHRoaXMuYnVpbGRUb29sc1ZlcnNpb24pIHtcbiAgICBidWlsZFRvb2xzRGlycyA9IGJ1aWxkVG9vbHNEaXJzXG4gICAgICAuZmlsdGVyKCh4KSA9PiBwYXRoLmJhc2VuYW1lKHgpID09PSB0aGlzLmJ1aWxkVG9vbHNWZXJzaW9uKTtcbiAgICBpZiAoXy5pc0VtcHR5KGJ1aWxkVG9vbHNEaXJzKSkge1xuICAgICAgbG9nLmluZm8oYEZvdW5kIG5vIGJ1aWxkIHRvb2xzIHdob3NlIHZlcnNpb24gbWF0Y2hlcyB0byAnJHt0aGlzLmJ1aWxkVG9vbHNWZXJzaW9ufSdgKTtcbiAgICB9IGVsc2Uge1xuICAgICAgbG9nLmluZm8oYFVzaW5nIGJ1aWxkIHRvb2xzIGF0ICcke2J1aWxkVG9vbHNEaXJzfSdgKTtcbiAgICB9XG4gIH1cbiAgYmluYXJ5TG9jcy5wdXNoKC4uLihfLmZsYXR0ZW4oYnVpbGRUb29sc0RpcnNcbiAgICAubWFwKChkaXIpID0+IFtcbiAgICAgIHBhdGgucmVzb2x2ZShkaXIsIGZ1bGxCaW5hcnlOYW1lKSxcbiAgICAgIHBhdGgucmVzb2x2ZShkaXIsICdsaWInLCBmdWxsQmluYXJ5TmFtZSksXG4gICAgXSkpXG4gICkpO1xuXG4gIGxldCBiaW5hcnlMb2MgPSBudWxsO1xuICBmb3IgKGNvbnN0IGxvYyBvZiBiaW5hcnlMb2NzKSB7XG4gICAgaWYgKGF3YWl0IGZzLmV4aXN0cyhsb2MpKSB7XG4gICAgICBiaW5hcnlMb2MgPSBsb2M7XG4gICAgICBicmVhaztcbiAgICB9XG4gIH1cbiAgaWYgKF8uaXNOdWxsKGJpbmFyeUxvYykpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYENvdWxkIG5vdCBmaW5kICcke2Z1bGxCaW5hcnlOYW1lfScgaW4gJHtKU09OLnN0cmluZ2lmeShiaW5hcnlMb2NzKX0uIGAgK1xuICAgICAgYERvIHlvdSBoYXZlIEFuZHJvaWQgQnVpbGQgVG9vbHMgJHt0aGlzLmJ1aWxkVG9vbHNWZXJzaW9uID8gYHYgJHt0aGlzLmJ1aWxkVG9vbHNWZXJzaW9ufSBgIDogJyd9YCArXG4gICAgICBgaW5zdGFsbGVkIGF0ICcke3RoaXMuc2RrUm9vdH0nP2ApO1xuICB9XG4gIGxvZy5pbmZvKGBVc2luZyAnJHtmdWxsQmluYXJ5TmFtZX0nIGZyb20gJyR7YmluYXJ5TG9jfSdgKTtcbiAgdGhpcy5iaW5hcmllc1tiaW5hcnlOYW1lXSA9IGJpbmFyeUxvYztcbiAgcmV0dXJuIGJpbmFyeUxvYztcbn07XG5cbi8qKlxuICogIFJldHVybnMgdGhlIEFuZHJvaWQgYmluYXJpZXMgbG9jYXRpb25zXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IHNka1Jvb3QgVGhlIHBhdGggdG8gQW5kcm9pZCBTREsgcm9vdC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBmdWxsQmluYXJ5TmFtZSBUaGUgbmFtZSBvZiBmdWxsIGJpbmFyeSBuYW1lLlxuICogQHJldHVybiB7QXJyYXk8c3RyaW5nPn0gVGhlIGxpc3Qgb2YgU0RLX0JJTkFSWV9ST09UUyBwYXRoc1xuICogICAgICAgICAgICAgICAgICAgICAgICAgIHdpdGggc2RrUm9vdCBhbmQgZnVsbEJpbmFyeU5hbWUuXG4gKi9cbmZ1bmN0aW9uIGdldFNka0JpbmFyeUxvY2F0aW9uQ2FuZGlkYXRlcyAoc2RrUm9vdCwgZnVsbEJpbmFyeU5hbWUpIHtcbiAgcmV0dXJuIFNES19CSU5BUllfUk9PVFMubWFwKCh4KSA9PlxuICAgIHBhdGgucmVzb2x2ZShzZGtSb290LCAuLi4oXy5pc0FycmF5KHgpID8geCA6IFt4XSksIGZ1bGxCaW5hcnlOYW1lKSk7XG59XG5cbi8qKlxuICogUmV0cmlldmUgZnVsbCBwYXRoIHRvIHRoZSBnaXZlbiBiaW5hcnkuXG4gKiBUaGlzIG1ldGhvZCBkb2VzIG5vdCBoYXZlIGNhY2hlLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBiaW5hcnlOYW1lIC0gU2ltcGxlIG5hbWUgb2YgYSBiaW5hcnkgZmlsZS5cbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZS5nLiAnYWRiJywgJ2FuZHJvaWQnXG4gKiBAcmV0dXJuIHtzdHJpbmd9IEZ1bGwgcGF0aCB0byB0aGUgZ2l2ZW4gYmluYXJ5LiBUaGUgbWV0aG9kIHRyaWVzXG4gKiAgICAgICAgICAgICAgICAgIHRvIGVudW1lcmF0ZSBhbGwgdGhlIGtub3duIGxvY2F0aW9ucyB3aGVyZSB0aGUgYmluYXJ5XG4gKiAgICAgICAgICAgICAgICAgIG1pZ2h0IGJlIGxvY2F0ZWQgYW5kIHN0b3BzIHRoZSBzZWFyY2ggYXMgc29vbiBhcyB0aGUgZmlyc3RcbiAqICAgICAgICAgICAgICAgICAgbWF0Y2ggaXMgZm91bmQgb24gdGhlIGxvY2FsIGZpbGUgc3lzdGVtLlxuICogICAgICAgICAgICAgICAgICBlLmcuICcvUGF0aC9Uby9BbmRyb2lkL3Nkay9wbGF0Zm9ybS10b29scy9hZGInXG4gKiBAdGhyb3dzIHtFcnJvcn0gSWYgdGhlIGJpbmFyeSB3aXRoIGdpdmVuIG5hbWUgaXMgbm90IHByZXNlbnQgYXQgYW55XG4gKiAgICAgICAgICAgICAgICAgb2Yga25vd24gbG9jYXRpb25zIG9yIEFuZHJvaWQgU0RLIGlzIG5vdCBpbnN0YWxsZWQgb24gdGhlXG4gKiAgICAgICAgICAgICAgICAgbG9jYWwgZmlsZSBzeXN0ZW0uXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGdldEFuZHJvaWRCaW5hcnlQYXRoIChiaW5hcnlOYW1lKSB7XG4gIGNvbnN0IGZ1bGxCaW5hcnlOYW1lID0gZ2V0QmluYXJ5TmFtZUZvck9TKGJpbmFyeU5hbWUpO1xuICBjb25zdCBzZGtSb290ID0gZ2V0U2RrUm9vdEZyb21FbnYoKTtcbiAgY29uc3QgYmluYXJ5TG9jcyA9IGdldFNka0JpbmFyeUxvY2F0aW9uQ2FuZGlkYXRlcyhzZGtSb290LCBmdWxsQmluYXJ5TmFtZSk7XG4gIGZvciAoY29uc3QgbG9jIG9mIGJpbmFyeUxvY3MpIHtcbiAgICBpZiAoYXdhaXQgZnMuZXhpc3RzKGxvYykpIHtcbiAgICAgIHJldHVybiBsb2M7XG4gICAgfVxuICB9XG4gIHRocm93IG5ldyBFcnJvcihgQ291bGQgbm90IGZpbmQgJyR7ZnVsbEJpbmFyeU5hbWV9JyBpbiAke0pTT04uc3RyaW5naWZ5KGJpbmFyeUxvY3MpfS4gYCArXG4gICAgYERvIHlvdSBoYXZlIEFuZHJvaWQgQnVpbGQgVG9vbHMgaW5zdGFsbGVkIGF0ICcke3Nka1Jvb3R9Jz9gKTtcbn1cblxuLyoqXG4gKiBSZXRyaWV2ZSBmdWxsIHBhdGggdG8gYSBiaW5hcnkgZmlsZSB1c2luZyB0aGUgc3RhbmRhcmQgc3lzdGVtIGxvb2t1cCB0b29sLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBiaW5hcnlOYW1lIC0gVGhlIG5hbWUgb2YgdGhlIGJpbmFyeS5cbiAqIEByZXR1cm4ge3N0cmluZ30gRnVsbCBwYXRoIHRvIHRoZSBiaW5hcnkgcmVjZWl2ZWQgZnJvbSAnd2hpY2gnLyd3aGVyZSdcbiAqICAgICAgICAgICAgICAgICAgb3V0cHV0LlxuICogQHRocm93cyB7RXJyb3J9IElmIGxvb2t1cCB0b29sIHJldHVybnMgbm9uLXplcm8gcmV0dXJuIGNvZGUuXG4gKi9cbnN5c3RlbUNhbGxNZXRob2RzLmdldEJpbmFyeUZyb21QYXRoID0gYXN5bmMgZnVuY3Rpb24gZ2V0QmluYXJ5RnJvbVBhdGggKGJpbmFyeU5hbWUpIHtcbiAgaWYgKHRoaXMuYmluYXJpZXNbYmluYXJ5TmFtZV0pIHtcbiAgICByZXR1cm4gdGhpcy5iaW5hcmllc1tiaW5hcnlOYW1lXTtcbiAgfVxuXG4gIGNvbnN0IGZ1bGxCaW5hcnlOYW1lID0gdGhpcy5nZXRCaW5hcnlOYW1lRm9yT1MoYmluYXJ5TmFtZSk7XG4gIHRyeSB7XG4gICAgY29uc3QgYmluYXJ5TG9jID0gYXdhaXQgZnMud2hpY2goZnVsbEJpbmFyeU5hbWUpO1xuICAgIGxvZy5pbmZvKGBVc2luZyAnJHtmdWxsQmluYXJ5TmFtZX0nIGZyb20gJyR7YmluYXJ5TG9jfSdgKTtcbiAgICB0aGlzLmJpbmFyaWVzW2JpbmFyeU5hbWVdID0gYmluYXJ5TG9jO1xuICAgIHJldHVybiBiaW5hcnlMb2M7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYENvdWxkIG5vdCBmaW5kICcke2Z1bGxCaW5hcnlOYW1lfScgaW4gUEFUSC4gUGxlYXNlIHNldCB0aGUgQU5EUk9JRF9IT01FIGAgK1xuICAgICAgYG9yIEFORFJPSURfU0RLX1JPT1QgZW52aXJvbm1lbnQgdmFyaWFibGVzIHRvIHRoZSBjb3JyZWN0IEFuZHJvaWQgU0RLIHJvb3QgZGlyZWN0b3J5IHBhdGguYCk7XG4gIH1cbn07XG5cbi8qKlxuICogQHR5cGVkZWYge09iamVjdH0gRGV2aWNlXG4gKiBAcHJvcGVydHkge3N0cmluZ30gdWRpZCAtIFRoZSBkZXZpY2UgdWRpZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBzdGF0ZSAtIEN1cnJlbnQgZGV2aWNlIHN0YXRlLCBhcyBpdCBpcyB2aXNpYmxlIGluXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICBfYWRiIGRldmljZXMgLWxfIG91dHB1dC5cbiAqL1xuXG4vKipcbiAqIFJldHJpZXZlIHRoZSBsaXN0IG9mIGRldmljZXMgdmlzaWJsZSB0byBhZGIuXG4gKlxuICogQHJldHVybiB7QXJyYXkuPERldmljZT59IFRoZSBsaXN0IG9mIGRldmljZXMgb3IgYW4gZW1wdHkgbGlzdCBpZlxuICogICAgICAgICAgICAgICAgICAgICAgICAgIG5vIGRldmljZXMgYXJlIGNvbm5lY3RlZC5cbiAqIEB0aHJvd3Mge0Vycm9yfSBJZiB0aGVyZSB3YXMgYW4gZXJyb3Igd2hpbGUgbGlzdGluZyBkZXZpY2VzLlxuICovXG5zeXN0ZW1DYWxsTWV0aG9kcy5nZXRDb25uZWN0ZWREZXZpY2VzID0gYXN5bmMgZnVuY3Rpb24gZ2V0Q29ubmVjdGVkRGV2aWNlcyAoKSB7XG4gIGxvZy5kZWJ1ZygnR2V0dGluZyBjb25uZWN0ZWQgZGV2aWNlcycpO1xuICBsZXQgc3Rkb3V0O1xuICB0cnkge1xuICAgICh7c3Rkb3V0fSA9IGF3YWl0IGV4ZWModGhpcy5leGVjdXRhYmxlLnBhdGgsIFsuLi50aGlzLmV4ZWN1dGFibGUuZGVmYXVsdEFyZ3MsICdkZXZpY2VzJ10pKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgRXJyb3Igd2hpbGUgZ2V0dGluZyBjb25uZWN0ZWQgZGV2aWNlcy4gT3JpZ2luYWwgZXJyb3I6ICR7ZS5tZXNzYWdlfWApO1xuICB9XG4gIGNvbnN0IGxpc3RIZWFkZXIgPSAnTGlzdCBvZiBkZXZpY2VzJztcbiAgLy8gZXhwZWN0aW5nIGFkYiBkZXZpY2VzIHRvIHJldHVybiBvdXRwdXQgYXNcbiAgLy8gTGlzdCBvZiBkZXZpY2VzIGF0dGFjaGVkXG4gIC8vIGVtdWxhdG9yLTU1NTRcdGRldmljZVxuICBjb25zdCBzdGFydGluZ0luZGV4ID0gc3Rkb3V0LmluZGV4T2YobGlzdEhlYWRlcik7XG4gIGlmIChzdGFydGluZ0luZGV4IDwgMCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgVW5leHBlY3RlZCBvdXRwdXQgd2hpbGUgdHJ5aW5nIHRvIGdldCBkZXZpY2VzOiAke3N0ZG91dH1gKTtcbiAgfVxuICAvLyBzbGljaW5nIG91dHB1dCB3ZSBjYXJlIGFib3V0XG4gIHN0ZG91dCA9IHN0ZG91dC5zbGljZShzdGFydGluZ0luZGV4KTtcbiAgbGV0IGV4Y2x1ZGVkTGluZXMgPSBbbGlzdEhlYWRlciwgJ2FkYiBzZXJ2ZXInLCAnKiBkYWVtb24nXTtcbiAgaWYgKCF0aGlzLmFsbG93T2ZmbGluZURldmljZXMpIHtcbiAgICBleGNsdWRlZExpbmVzLnB1c2goJ29mZmxpbmUnKTtcbiAgfVxuICBjb25zdCBkZXZpY2VzID0gc3Rkb3V0LnNwbGl0KCdcXG4nKVxuICAgIC5tYXAoXy50cmltKVxuICAgIC5maWx0ZXIoKGxpbmUpID0+IGxpbmUgJiYgIWV4Y2x1ZGVkTGluZXMuc29tZSgoeCkgPT4gbGluZS5pbmNsdWRlcyh4KSkpXG4gICAgLnJlZHVjZSgoYWNjLCBsaW5lKSA9PiB7XG4gICAgICAvLyBzdGF0ZSBpcyBcImRldmljZVwiLCBhZmFpY1xuICAgICAgY29uc3QgW3VkaWQsIHN0YXRlXSA9IGxpbmUuc3BsaXQoL1xccysvKTtcbiAgICAgIGFjYy5wdXNoKHt1ZGlkLCBzdGF0ZX0pO1xuICAgICAgcmV0dXJuIGFjYztcbiAgICB9LCBbXSk7XG4gIGlmIChfLmlzRW1wdHkoZGV2aWNlcykpIHtcbiAgICBsb2cuZGVidWcoJ05vIGNvbm5lY3RlZCBkZXZpY2VzIGhhdmUgYmVlbiBkZXRlY3RlZCcpO1xuICB9IGVsc2Uge1xuICAgIGxvZy5kZWJ1ZyhgQ29ubmVjdGVkIGRldmljZXM6ICR7SlNPTi5zdHJpbmdpZnkoZGV2aWNlcyl9YCk7XG4gIH1cbiAgcmV0dXJuIGRldmljZXM7XG59O1xuXG4vKipcbiAqIFJldHJpZXZlIHRoZSBsaXN0IG9mIGRldmljZXMgdmlzaWJsZSB0byBhZGIgd2l0aGluIHRoZSBnaXZlbiB0aW1lb3V0LlxuICpcbiAqIEBwYXJhbSB7bnVtYmVyfSB0aW1lb3V0TXMgLSBUaGUgbWF4aW11bSBudW1iZXIgb2YgbWlsbGlzZWNvbmRzIHRvIGdldCBhdCBsZWFzdFxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9uZSBsaXN0IGl0ZW0uXG4gKiBAcmV0dXJuIHtBcnJheS48RGV2aWNlPn0gVGhlIGxpc3Qgb2YgY29ubmVjdGVkIGRldmljZXMuXG4gKiBAdGhyb3dzIHtFcnJvcn0gSWYgbm8gY29ubmVjdGVkIGRldmljZXMgY2FuIGJlIGRldGVjdGVkIHdpdGhpbiB0aGUgZ2l2ZW4gdGltZW91dC5cbiAqL1xuc3lzdGVtQ2FsbE1ldGhvZHMuZ2V0RGV2aWNlc1dpdGhSZXRyeSA9IGFzeW5jIGZ1bmN0aW9uIGdldERldmljZXNXaXRoUmV0cnkgKHRpbWVvdXRNcyA9IDIwMDAwKSB7XG4gIGNvbnN0IHRpbWVyID0gbmV3IHRpbWluZy5UaW1lcigpLnN0YXJ0KCk7XG4gIGxvZy5kZWJ1ZygnVHJ5aW5nIHRvIGZpbmQgYSBjb25uZWN0ZWQgYW5kcm9pZCBkZXZpY2UnKTtcbiAgY29uc3QgZ2V0RGV2aWNlcyA9IGFzeW5jICgpID0+IHtcbiAgICBpZiAodGltZXIuZ2V0RHVyYXRpb24oKS5hc01pbGxpU2Vjb25kcyA+IHRpbWVvdXRNcykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBDb3VsZCBub3QgZmluZCBhIGNvbm5lY3RlZCBBbmRyb2lkIGRldmljZSBpbiAke3RpbWVyLmdldER1cmF0aW9uKCkuYXNNaWxsaVNlY29uZHMudG9GaXhlZCgwKX1tcy5gKTtcbiAgICB9XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGRldmljZXMgPSBhd2FpdCB0aGlzLmdldENvbm5lY3RlZERldmljZXMoKTtcbiAgICAgIGlmIChkZXZpY2VzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgcmV0dXJuIGRldmljZXM7XG4gICAgICB9XG4gICAgfSBjYXRjaCAoaWduKSB7fVxuXG4gICAgbG9nLmRlYnVnKCdDb3VsZCBub3QgZmluZCBvbmxpbmUgZGV2aWNlcycpO1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLnJlY29ubmVjdCgpO1xuICAgIH0gY2F0Y2ggKGlnbikge1xuICAgICAgYXdhaXQgdGhpcy5yZXN0YXJ0QWRiKCk7XG4gICAgfVxuICAgIC8vIGNvb2wgZG93blxuICAgIGF3YWl0IHNsZWVwKDIwMCk7XG4gICAgcmV0dXJuIGF3YWl0IGdldERldmljZXMoKTtcbiAgfTtcbiAgcmV0dXJuIGF3YWl0IGdldERldmljZXMoKTtcbn07XG5cbi8qKlxuICogS2ljayBjdXJyZW50IGNvbm5lY3Rpb24gZnJvbSBob3N0L2RldmljZSBzaWRlIGFuZCBtYWtlIGl0IHJlY29ubmVjdFxuICpcbiAqIEBwYXJhbSB7P3N0cmluZ30gdGFyZ2V0IFtvZmZsaW5lXSBPbmUgb2YgcG9zc2libGUgdGFyZ2V0cyB0byByZWNvbm5lY3Q6XG4gKiBvZmZsaW5lLCBkZXZpY2Ugb3IgbnVsbFxuICogUHJvdmlkaW5nIGBudWxsYCB3aWxsIGNhdXNlIHJlY29ubmVjdGlvbiB0byBoYXBwZW4gZnJvbSB0aGUgaG9zdCBzaWRlLlxuICpcbiAqIEB0aHJvd3Mge0Vycm9yfSBJZiBlaXRoZXIgQURCIHZlcnNpb24gaXMgdG9vIG9sZCBhbmQgZG9lcyBub3Qgc3VwcG9ydCB0aGlzXG4gKiBjb21tYW5kIG9yIHRoZXJlIHdhcyBhIGZhaWx1cmUgZHVyaW5nIHJlY29ubmVjdC5cbiAqL1xuc3lzdGVtQ2FsbE1ldGhvZHMucmVjb25uZWN0ID0gYXN5bmMgZnVuY3Rpb24gcmVjb25uZWN0ICh0YXJnZXQgPSAnb2ZmbGluZScpIHtcbiAgbG9nLmRlYnVnKGBSZWNvbm5lY3RpbmcgYWRiICh0YXJnZXQgJHt0YXJnZXR9KWApO1xuXG4gIGNvbnN0IGFyZ3MgPSBbJ3JlY29ubmVjdCddO1xuICBpZiAodGFyZ2V0KSB7XG4gICAgYXJncy5wdXNoKHRhcmdldCk7XG4gIH1cbiAgdHJ5IHtcbiAgICBhd2FpdCB0aGlzLmFkYkV4ZWMoYXJncyk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCByZWNvbm5lY3QgYWRiLiBPcmlnaW5hbCBlcnJvcjogJHtlLnN0ZGVyciB8fCBlLm1lc3NhZ2V9YCk7XG4gIH1cbn07XG5cbi8qKlxuICogUmVzdGFydCBhZGIgc2VydmVyLCB1bmxlc3MgX3RoaXMuc3VwcHJlc3NLaWxsU2VydmVyXyBwcm9wZXJ0eSBpcyB0cnVlLlxuICovXG5zeXN0ZW1DYWxsTWV0aG9kcy5yZXN0YXJ0QWRiID0gYXN5bmMgZnVuY3Rpb24gcmVzdGFydEFkYiAoKSB7XG4gIGlmICh0aGlzLnN1cHByZXNzS2lsbFNlcnZlcikge1xuICAgIGxvZy5kZWJ1ZyhgTm90IHJlc3RhcnRpbmcgYWJkIHNpbmNlICdzdXBwcmVzc0tpbGxTZXJ2ZXInIGlzIG9uYCk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgbG9nLmRlYnVnKCdSZXN0YXJ0aW5nIGFkYicpO1xuICB0cnkge1xuICAgIGF3YWl0IHRoaXMua2lsbFNlcnZlcigpO1xuICAgIGF3YWl0IHRoaXMuYWRiRXhlYyhbJ3N0YXJ0LXNlcnZlciddKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGxvZy5lcnJvcihgRXJyb3Iga2lsbGluZyBBREIgc2VydmVyLCBnb2luZyB0byBzZWUgaWYgaXQncyBvbmxpbmUgYW55d2F5YCk7XG4gIH1cbn07XG5cbi8qKlxuICogS2lsbCBhZGIgc2VydmVyLlxuICovXG5zeXN0ZW1DYWxsTWV0aG9kcy5raWxsU2VydmVyID0gYXN5bmMgZnVuY3Rpb24ga2lsbFNlcnZlciAoKSB7XG4gIGxvZy5kZWJ1ZyhgS2lsbGluZyBhZGIgc2VydmVyIG9uIHBvcnQgJyR7dGhpcy5hZGJQb3J0fSdgKTtcbiAgYXdhaXQgdGhpcy5hZGJFeGVjKFsna2lsbC1zZXJ2ZXInXSwge1xuICAgIGV4Y2x1c2l2ZTogdHJ1ZSxcbiAgfSk7XG59O1xuXG4vKipcbiAqIFJlc2V0IFRlbG5ldCBhdXRoZW50aWNhdGlvbiB0b2tlbi5cbiAqIEBzZWUge0BsaW5rIGh0dHA6Ly90b29scy5hbmRyb2lkLmNvbS9yZWNlbnQvZW11bGF0b3IyNTE2cmVsZWFzZW5vdGVzfSBmb3IgbW9yZSBkZXRhaWxzLlxuICpcbiAqIEByZXR1cm5zIHtib29sZWFufSBJZiB0b2tlbiByZXNldCB3YXMgc3VjY2Vzc2Z1bC5cbiAqL1xuc3lzdGVtQ2FsbE1ldGhvZHMucmVzZXRUZWxuZXRBdXRoVG9rZW4gPSBfLm1lbW9pemUoYXN5bmMgZnVuY3Rpb24gcmVzZXRUZWxuZXRBdXRoVG9rZW4gKCkge1xuICAvLyBUaGUgbWV0aG9kcyBpcyB1c2VkIHRvIHJlbW92ZSB0ZWxuZXQgYXV0aCB0b2tlblxuICAvL1xuICBjb25zdCBob21lRm9sZGVyUGF0aCA9IHByb2Nlc3MuZW52Wyhwcm9jZXNzLnBsYXRmb3JtID09PSAnd2luMzInKSA/ICdVU0VSUFJPRklMRScgOiAnSE9NRSddO1xuICBpZiAoIWhvbWVGb2xkZXJQYXRoKSB7XG4gICAgbG9nLndhcm4oYENhbm5vdCBmaW5kIHRoZSBwYXRoIHRvIHVzZXIgaG9tZSBmb2xkZXIuIElnbm9yaW5nIHJlc2V0dGluZyBvZiBlbXVsYXRvcidzIHRlbG5ldCBhdXRoZW50aWNhdGlvbiB0b2tlbmApO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICBjb25zdCBkc3RQYXRoID0gcGF0aC5yZXNvbHZlKGhvbWVGb2xkZXJQYXRoLCAnLmVtdWxhdG9yX2NvbnNvbGVfYXV0aF90b2tlbicpO1xuICBsb2cuZGVidWcoYE92ZXJyaWRpbmcgJHtkc3RQYXRofSB3aXRoIGFuIGVtcHR5IHN0cmluZyB0byBhdm9pZCB0ZWxuZXQgYXV0aGVudGljYXRpb24gZm9yIGVtdWxhdG9yIGNvbW1hbmRzYCk7XG4gIHRyeSB7XG4gICAgYXdhaXQgZnMud3JpdGVGaWxlKGRzdFBhdGgsICcnKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGxvZy53YXJuKGBFcnJvciAke2UubWVzc2FnZX0gd2hpbGUgcmVzZXR0aW5nIHRoZSBjb250ZW50IG9mICR7ZHN0UGF0aH0uIElnbm9yaW5nIHJlc2V0dGluZyBvZiBlbXVsYXRvcidzIHRlbG5ldCBhdXRoZW50aWNhdGlvbiB0b2tlbmApO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICByZXR1cm4gdHJ1ZTtcbn0pO1xuXG4vKipcbiAqIEV4ZWN1dGUgdGhlIGdpdmVuIGVtdWxhdG9yIGNvbW1hbmQgdXNpbmcgX2FkYiBlbXVfIHRvb2wuXG4gKlxuICogQHBhcmFtIHtBcnJheS48c3RyaW5nPn0gY21kIC0gVGhlIGFycmF5IG9mIHJlc3QgY29tbWFuZCBsaW5lIHBhcmFtZXRlcnMuXG4gKi9cbnN5c3RlbUNhbGxNZXRob2RzLmFkYkV4ZWNFbXUgPSBhc3luYyBmdW5jdGlvbiBhZGJFeGVjRW11IChjbWQpIHtcbiAgYXdhaXQgdGhpcy52ZXJpZnlFbXVsYXRvckNvbm5lY3RlZCgpO1xuICBhd2FpdCB0aGlzLnJlc2V0VGVsbmV0QXV0aFRva2VuKCk7XG4gIGF3YWl0IHRoaXMuYWRiRXhlYyhbJ2VtdScsIC4uLmNtZF0pO1xufTtcblxubGV0IGlzRXhlY0xvY2tlZCA9IGZhbHNlO1xuXG5zeXN0ZW1DYWxsTWV0aG9kcy5FWEVDX09VVFBVVF9GT1JNQVQgPSBPYmplY3QuZnJlZXplKHtcbiAgU1RET1VUOiAnc3Rkb3V0JyxcbiAgRlVMTDogJ2Z1bGwnLFxufSk7XG5cbi8qKlxuICogQHR5cGVkZWYge09iamVjdH0gRXhlY1Jlc3VsdFxuICogQHByb3BlcnR5IHtzdHJpbmd9IHN0ZG91dCBUaGUgc3Rkb3V0IHJlY2VpdmVkIGZyb20gZXhlY1xuICogQHByb3BlcnR5IHtzdHJpbmd9IHN0ZGVyciBUaGUgc3RkZXJyIHJlY2VpdmVkIGZyb20gZXhlY1xuICovXG5cbi8qKlxuICogRXhlY3V0ZSB0aGUgZ2l2ZW4gYWRiIGNvbW1hbmQuXG4gKlxuICogQHBhcmFtIHtBcnJheS48c3RyaW5nPn0gY21kIC0gVGhlIGFycmF5IG9mIHJlc3QgY29tbWFuZCBsaW5lIHBhcmFtZXRlcnNcbiAqICAgICAgICAgICAgICAgICAgICAgIG9yIGEgc2luZ2xlIHN0cmluZyBwYXJhbWV0ZXIuXG4gKiBAcGFyYW0ge09iamVjdH0gb3B0cyAtIEFkZGl0aW9uYWwgb3B0aW9ucyBtYXBwaW5nLiBTZWVcbiAqICAgICAgICAgICAgICAgICAgICAgICAge0BsaW5rIGh0dHBzOi8vZ2l0aHViLmNvbS9hcHBpdW0vbm9kZS10ZWVuX3Byb2Nlc3N9XG4gKiAgICAgICAgICAgICAgICAgICAgICAgIGZvciBtb3JlIGRldGFpbHMuXG4gKiAgICAgICAgICAgICAgICAgICAgICAgIFlvdSBjYW4gYWxzbyBzZXQgdGhlIGFkZGl0aW9uYWwgYGV4Y2x1c2l2ZWAgcGFyYW1cbiAqICAgICAgICAgICAgICAgICAgICAgICAgdG8gYHRydWVgIHRoYXQgYXNzdXJlcyBubyBvdGhlciBwYXJhbGxlbCBhZGIgY29tbWFuZHNcbiAqICAgICAgICAgICAgICAgICAgICAgICAgYXJlIGdvaW5nIHRvIGJlIGV4ZWN1dGVkIHdoaWxlIHRoZSBjdXJyZW50IG9uZSBpcyBydW5uaW5nXG4gKiAgICAgICAgICAgICAgICAgICAgICAgIFlvdSBjYW4gc2V0IHRoZSBgb3V0cHV0Rm9ybWF0YCBwYXJhbSB0byBgc3Rkb3V0YCB0byByZWNlaXZlIGp1c3QgdGhlIHN0ZG91dFxuICogICAgICAgICAgICAgICAgICAgICAgICBvdXRwdXQgKGRlZmF1bHQpIG9yIGBmdWxsYCB0byByZWNlaXZlIHRoZSBzdGRvdXQgYW5kIHN0ZGVyciByZXNwb25zZSBmcm9tIGFcbiAqICAgICAgICAgICAgICAgICAgICAgICAgY29tbWFuZCB3aXRoIGEgemVybyBleGl0IGNvZGVcbiAqIEByZXR1cm4ge3N0cmluZ3xFeGVjUmVzdWx0fSAtIENvbW1hbmQncyBzdGRvdXQgb3IgYW4gb2JqZWN0IGNvbnRhaW5pbmcgc3Rkb3V0IGFuZCBzdGRlcnIuXG4gKiBAdGhyb3dzIHtFcnJvcn0gSWYgdGhlIGNvbW1hbmQgcmV0dXJuZWQgbm9uLXplcm8gZXhpdCBjb2RlLlxuICovXG5zeXN0ZW1DYWxsTWV0aG9kcy5hZGJFeGVjID0gYXN5bmMgZnVuY3Rpb24gYWRiRXhlYyAoY21kLCBvcHRzID0ge30pIHtcbiAgaWYgKCFjbWQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ1lvdSBuZWVkIHRvIHBhc3MgaW4gYSBjb21tYW5kIHRvIGFkYkV4ZWMoKScpO1xuICB9XG5cbiAgb3B0cyA9IF8uY2xvbmVEZWVwKG9wdHMpO1xuICAvLyBzZXR0aW5nIGRlZmF1bHQgdGltZW91dCBmb3IgZWFjaCBjb21tYW5kIHRvIHByZXZlbnQgaW5maW5pdGUgd2FpdC5cbiAgb3B0cy50aW1lb3V0ID0gb3B0cy50aW1lb3V0IHx8IHRoaXMuYWRiRXhlY1RpbWVvdXQgfHwgREVGQVVMVF9BREJfRVhFQ19USU1FT1VUO1xuICBvcHRzLnRpbWVvdXRDYXBOYW1lID0gb3B0cy50aW1lb3V0Q2FwTmFtZSB8fCAnYWRiRXhlY1RpbWVvdXQnOyAvLyBGb3IgZXJyb3IgbWVzc2FnZVxuXG4gIGNvbnN0IHtvdXRwdXRGb3JtYXQgPSB0aGlzLkVYRUNfT1VUUFVUX0ZPUk1BVC5TVERPVVR9ID0gb3B0cztcblxuICBjbWQgPSBfLmlzQXJyYXkoY21kKSA/IGNtZCA6IFtjbWRdO1xuICBsZXQgYWRiUmV0cmllZCA9IGZhbHNlO1xuICBjb25zdCBleGVjRnVuYyA9IGFzeW5jICgpID0+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgYXJncyA9IFsuLi50aGlzLmV4ZWN1dGFibGUuZGVmYXVsdEFyZ3MsIC4uLmNtZF07XG4gICAgICBsb2cuZGVidWcoYFJ1bm5pbmcgJyR7dGhpcy5leGVjdXRhYmxlLnBhdGh9IGAgK1xuICAgICAgICAoYXJncy5maW5kKChhcmcpID0+IC9cXHMrLy50ZXN0KGFyZykpID8gdXRpbC5xdW90ZShhcmdzKSA6IGFyZ3Muam9pbignICcpKSArIGAnYCk7XG4gICAgICBsZXQge3N0ZG91dCwgc3RkZXJyfSA9IGF3YWl0IGV4ZWModGhpcy5leGVjdXRhYmxlLnBhdGgsIGFyZ3MsIG9wdHMpO1xuICAgICAgLy8gc29tZXRpbWVzIEFEQiBwcmludHMgb3V0IHdlaXJkIHN0ZG91dCB3YXJuaW5ncyB0aGF0IHdlIGRvbid0IHdhbnRcbiAgICAgIC8vIHRvIGluY2x1ZGUgaW4gYW55IG9mIHRoZSByZXNwb25zZSBkYXRhLCBzbyBsZXQncyBzdHJpcCBpdCBvdXRcbiAgICAgIHN0ZG91dCA9IHN0ZG91dC5yZXBsYWNlKExJTktFUl9XQVJOSU5HX1JFR0VYUCwgJycpLnRyaW0oKTtcbiAgICAgIHJldHVybiBvdXRwdXRGb3JtYXQgPT09IHRoaXMuRVhFQ19PVVRQVVRfRk9STUFULkZVTEwgPyB7c3Rkb3V0LCBzdGRlcnJ9IDogc3Rkb3V0O1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGNvbnN0IGVyclRleHQgPSBgJHtlLm1lc3NhZ2V9LCAke2Uuc3Rkb3V0fSwgJHtlLnN0ZGVycn1gO1xuICAgICAgaWYgKEFEQl9SRVRSWV9FUlJPUl9QQVRURVJOUy5zb21lKChwKSA9PiBwLnRlc3QoZXJyVGV4dCkpKSB7XG4gICAgICAgIGxvZy5pbmZvKGBFcnJvciBzZW5kaW5nIGNvbW1hbmQsIHJlY29ubmVjdGluZyBkZXZpY2UgYW5kIHJldHJ5aW5nOiAke2NtZH1gKTtcbiAgICAgICAgYXdhaXQgc2xlZXAoMTAwMCk7XG4gICAgICAgIGF3YWl0IHRoaXMuZ2V0RGV2aWNlc1dpdGhSZXRyeSgpO1xuXG4gICAgICAgIC8vIHRyeSBhZ2FpbiBvbmUgdGltZVxuICAgICAgICBpZiAoYWRiUmV0cmllZCkge1xuICAgICAgICAgIGFkYlJldHJpZWQgPSB0cnVlO1xuICAgICAgICAgIHJldHVybiBhd2FpdCBleGVjRnVuYygpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmIChlLmNvZGUgPT09IDAgJiYgZS5zdGRvdXQpIHtcbiAgICAgICAgcmV0dXJuIGUuc3Rkb3V0LnJlcGxhY2UoTElOS0VSX1dBUk5JTkdfUkVHRVhQLCAnJykudHJpbSgpO1xuICAgICAgfVxuXG4gICAgICBpZiAoXy5pc051bGwoZS5jb2RlKSkge1xuICAgICAgICBlLm1lc3NhZ2UgPSBgRXJyb3IgZXhlY3V0aW5nIGFkYkV4ZWMuIE9yaWdpbmFsIGVycm9yOiAnJHtlLm1lc3NhZ2V9Jy4gYCArXG4gICAgICAgICAgYFRyeSB0byBpbmNyZWFzZSB0aGUgJHtvcHRzLnRpbWVvdXR9bXMgYWRiIGV4ZWN1dGlvbiB0aW1lb3V0IHJlcHJlc2VudGVkIGJ5ICcke29wdHMudGltZW91dENhcE5hbWV9JyBjYXBhYmlsaXR5YDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGUubWVzc2FnZSA9IGBFcnJvciBleGVjdXRpbmcgYWRiRXhlYy4gT3JpZ2luYWwgZXJyb3I6ICcke2UubWVzc2FnZX0nOyBgICtcbiAgICAgICAgICBgQ29tbWFuZCBvdXRwdXQ6ICR7ZS5zdGRlcnIgfHwgZS5zdGRvdXQgfHwgJzxlbXB0eT4nfWA7XG4gICAgICB9XG4gICAgICB0aHJvdyBlO1xuICAgIH1cbiAgfTtcblxuICBpZiAoaXNFeGVjTG9ja2VkKSB7XG4gICAgbG9nLmRlYnVnKCdXYWl0aW5nIHVudGlsIHRoZSBvdGhlciBleGNsdXNpdmUgQURCIGNvbW1hbmQgaXMgY29tcGxldGVkJyk7XG4gICAgYXdhaXQgd2FpdEZvckNvbmRpdGlvbigoKSA9PiAhaXNFeGVjTG9ja2VkLCB7XG4gICAgICB3YWl0TXM6IE51bWJlci5NQVhfU0FGRV9JTlRFR0VSLFxuICAgICAgaW50ZXJ2YWxNczogMTAsXG4gICAgfSk7XG4gICAgbG9nLmRlYnVnKCdDb250aW51aW5nIHdpdGggdGhlIGN1cnJlbnQgQURCIGNvbW1hbmQnKTtcbiAgfVxuICBpZiAob3B0cy5leGNsdXNpdmUpIHtcbiAgICBpc0V4ZWNMb2NrZWQgPSB0cnVlO1xuICB9XG4gIHRyeSB7XG4gICAgcmV0dXJuIGF3YWl0IGV4ZWNGdW5jKCk7XG4gIH0gZmluYWxseSB7XG4gICAgaWYgKG9wdHMuZXhjbHVzaXZlKSB7XG4gICAgICBpc0V4ZWNMb2NrZWQgPSBmYWxzZTtcbiAgICB9XG4gIH1cbn07XG5cbi8qKlxuICogQHR5cGVkZWYge09iamVjdH0gU2hlbGxFeGVjT3B0aW9uc1xuICogQHByb3BlcnR5IHs/c3RyaW5nfSB0aW1lb3V0Q2FwTmFtZSBbYWRiRXhlY1RpbWVvdXRdIC0gdGhlIG5hbWUgb2YgdGhlIGNvcnJlc3BvbmRpbmcgQXBwaXVtJ3MgdGltZW91dCBjYXBhYmlsaXR5XG4gKiAodXNlZCBpbiB0aGUgZXJyb3IgbWVzc2FnZXMpLlxuICogQHByb3BlcnR5IHs/bnVtYmVyfSB0aW1lb3V0IFthZGJFeGVjVGltZW91dF0gLSBjb21tYW5kIGV4ZWN1dGlvbiB0aW1lb3V0LlxuICogQHByb3BlcnR5IHs/Ym9vbGVhbn0gcHJpdmlsZWdlZCBbZmFsc3ldIC0gV2hldGhlciB0byBydW4gdGhlIGdpdmVuIGNvbW1hbmQgYXMgcm9vdC5cbiAqIEBwcm9wZXJ0eSB7P3N0cmluZ30gb3V0cHV0Rm9ybWF0IFtzdGRvdXRdIC0gV2hldGhlciByZXNwb25zZSBzaG91bGQgaW5jbHVkZSBmdWxsIGV4ZWMgb3V0cHV0IG9yIGp1c3Qgc3Rkb3V0LlxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBQb3RlbnRpYWwgdmFsdWVzIGFyZSBmdWxsIG9yIHN0ZG91dC5cbiAqXG4gKiBBbGwgb3RoZXIgcHJvcGVydGllcyBhcmUgdGhlIHNhbWUgYXMgZm9yIGBleGVjYCBjYWxsIGZyb20ge0BsaW5rIGh0dHBzOi8vZ2l0aHViLmNvbS9hcHBpdW0vbm9kZS10ZWVuX3Byb2Nlc3N9XG4gKiBtb2R1bGVcbiAqL1xuXG4vKipcbiAqIEV4ZWN1dGUgdGhlIGdpdmVuIGNvbW1hbmQgdXNpbmcgX2FkYiBzaGVsbF8gcHJlZml4LlxuICpcbiAqIEBwYXJhbSB7IUFycmF5LjxzdHJpbmc+fHN0cmluZ30gY21kIC0gVGhlIGFycmF5IG9mIHJlc3QgY29tbWFuZCBsaW5lIHBhcmFtZXRlcnMgb3IgYSBzaW5nbGVcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdHJpbmcgcGFyYW1ldGVyLlxuICogQHBhcmFtIHs/U2hlbGxFeGVjT3B0aW9uc30gb3B0cyBbe31dIC0gQWRkaXRpb25hbCBvcHRpb25zIG1hcHBpbmcuXG4gKiBAcmV0dXJuIHtzdHJpbmd9IC0gQ29tbWFuZCdzIHN0ZG91dC5cbiAqIEB0aHJvd3Mge0Vycm9yfSBJZiB0aGUgY29tbWFuZCByZXR1cm5lZCBub24temVybyBleGl0IGNvZGUuXG4gKi9cbnN5c3RlbUNhbGxNZXRob2RzLnNoZWxsID0gYXN5bmMgZnVuY3Rpb24gc2hlbGwgKGNtZCwgb3B0cyA9IHt9KSB7XG4gIGNvbnN0IHtcbiAgICBwcml2aWxlZ2VkLFxuICB9ID0gb3B0cztcblxuICBjb25zdCBjbWRBcnIgPSBfLmlzQXJyYXkoY21kKSA/IGNtZCA6IFtjbWRdO1xuICBjb25zdCBmdWxsQ21kID0gWydzaGVsbCddO1xuICBpZiAocHJpdmlsZWdlZCkge1xuICAgIGxvZy5pbmZvKGAnYWRiIHNoZWxsICR7dXRpbC5xdW90ZShjbWRBcnIpfScgcmVxdWlyZXMgcm9vdCBhY2Nlc3NgKTtcbiAgICBpZiAoYXdhaXQgdGhpcy5pc1Jvb3QoKSkge1xuICAgICAgbG9nLmluZm8oJ1RoZSBkZXZpY2UgYWxyZWFkeSBoYWQgcm9vdCBhY2Nlc3MnKTtcbiAgICAgIGZ1bGxDbWQucHVzaCguLi5jbWRBcnIpO1xuICAgIH0gZWxzZSB7XG4gICAgICBmdWxsQ21kLnB1c2goJ3N1JywgJ3Jvb3QnLCB1dGlsLnF1b3RlKGNtZEFycikpO1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICBmdWxsQ21kLnB1c2goLi4uY21kQXJyKTtcbiAgfVxuICByZXR1cm4gYXdhaXQgdGhpcy5hZGJFeGVjKGZ1bGxDbWQsIG9wdHMpO1xufTtcblxuc3lzdGVtQ2FsbE1ldGhvZHMuY3JlYXRlU3ViUHJvY2VzcyA9IGZ1bmN0aW9uIGNyZWF0ZVN1YlByb2Nlc3MgKGFyZ3MgPSBbXSkge1xuICAvLyBhZGQgdGhlIGRlZmF1bHQgYXJndW1lbnRzXG4gIGFyZ3MgPSBbLi4udGhpcy5leGVjdXRhYmxlLmRlZmF1bHRBcmdzLCAuLi5hcmdzXTtcbiAgbG9nLmRlYnVnKGBDcmVhdGluZyBBREIgc3VicHJvY2VzcyB3aXRoIGFyZ3M6ICR7SlNPTi5zdHJpbmdpZnkoYXJncyl9YCk7XG4gIHJldHVybiBuZXcgU3ViUHJvY2Vzcyh0aGlzLmdldEFkYlBhdGgoKSwgYXJncyk7XG59O1xuXG4vKipcbiAqIFJldHJpZXZlIHRoZSBjdXJyZW50IGFkYiBwb3J0LlxuICogQHRvZG8gY2FuIHByb2JhYmx5IGRlcHJlY2F0ZSB0aGlzIG5vdyB0aGF0IHRoZSBsb2dpYyBpcyBqdXN0IHRvIHJlYWQgdGhpcy5hZGJQb3J0XG4gKiBAcmV0dXJuIHtudW1iZXJ9IFRoZSBjdXJyZW50IGFkYiBwb3J0IG51bWJlci5cbiAqL1xuc3lzdGVtQ2FsbE1ldGhvZHMuZ2V0QWRiU2VydmVyUG9ydCA9IGZ1bmN0aW9uIGdldEFkYlNlcnZlclBvcnQgKCkge1xuICByZXR1cm4gdGhpcy5hZGJQb3J0O1xufTtcblxuLyoqXG4gKiBSZXRyaWV2ZSB0aGUgY3VycmVudCBlbXVsYXRvciBwb3J0IGZyb20gX2FkYiBkZXZpdmVzXyBvdXRwdXQuXG4gKlxuICogQHJldHVybiB7bnVtYmVyfSBUaGUgY3VycmVudCBlbXVsYXRvciBwb3J0LlxuICogQHRocm93cyB7RXJyb3J9IElmIHRoZXJlIGFyZSBubyBjb25uZWN0ZWQgZGV2aWNlcy5cbiAqL1xuc3lzdGVtQ2FsbE1ldGhvZHMuZ2V0RW11bGF0b3JQb3J0ID0gYXN5bmMgZnVuY3Rpb24gZ2V0RW11bGF0b3JQb3J0ICgpIHtcbiAgbG9nLmRlYnVnKCdHZXR0aW5nIHJ1bm5pbmcgZW11bGF0b3IgcG9ydCcpO1xuICBpZiAodGhpcy5lbXVsYXRvclBvcnQgIT09IG51bGwpIHtcbiAgICByZXR1cm4gdGhpcy5lbXVsYXRvclBvcnQ7XG4gIH1cbiAgdHJ5IHtcbiAgICBsZXQgZGV2aWNlcyA9IGF3YWl0IHRoaXMuZ2V0Q29ubmVjdGVkRGV2aWNlcygpO1xuICAgIGxldCBwb3J0ID0gdGhpcy5nZXRQb3J0RnJvbUVtdWxhdG9yU3RyaW5nKGRldmljZXNbMF0udWRpZCk7XG4gICAgaWYgKHBvcnQpIHtcbiAgICAgIHJldHVybiBwb3J0O1xuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEVtdWxhdG9yIHBvcnQgbm90IGZvdW5kYCk7XG4gICAgfVxuICB9IGNhdGNoIChlKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBObyBkZXZpY2VzIGNvbm5lY3RlZC4gT3JpZ2luYWwgZXJyb3I6ICR7ZS5tZXNzYWdlfWApO1xuICB9XG59O1xuXG4vKipcbiAqIFJldHJpZXZlIHRoZSBjdXJyZW50IGVtdWxhdG9yIHBvcnQgYnkgcGFyc2luZyBlbXVsYXRvciBuYW1lIHN0cmluZy5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gZW1TdHIgLSBFbXVsYXRvciBuYW1lIHN0cmluZy5cbiAqIEByZXR1cm4ge251bWJlcnxib29sZWFufSBFaXRoZXIgdGhlIGN1cnJlbnQgZW11bGF0b3IgcG9ydCBvclxuICogICAgICAgICAgICAgICAgICAgICAgICAgIF9mYWxzZV8gaWYgcG9ydCBudW1iZXIgY2Fubm90IGJlIHBhcnNlZC5cbiAqL1xuc3lzdGVtQ2FsbE1ldGhvZHMuZ2V0UG9ydEZyb21FbXVsYXRvclN0cmluZyA9IGZ1bmN0aW9uIGdldFBvcnRGcm9tRW11bGF0b3JTdHJpbmcgKGVtU3RyKSB7XG4gIGxldCBwb3J0UGF0dGVybiA9IC9lbXVsYXRvci0oXFxkKykvO1xuICBpZiAocG9ydFBhdHRlcm4udGVzdChlbVN0cikpIHtcbiAgICByZXR1cm4gcGFyc2VJbnQocG9ydFBhdHRlcm4uZXhlYyhlbVN0cilbMV0sIDEwKTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59O1xuXG4vKipcbiAqIFJldHJpZXZlIHRoZSBsaXN0IG9mIGN1cnJlbnRseSBjb25uZWN0ZWQgZW11bGF0b3JzLlxuICpcbiAqIEByZXR1cm4ge0FycmF5LjxEZXZpY2U+fSBUaGUgbGlzdCBvZiBjb25uZWN0ZWQgZGV2aWNlcy5cbiAqL1xuc3lzdGVtQ2FsbE1ldGhvZHMuZ2V0Q29ubmVjdGVkRW11bGF0b3JzID0gYXN5bmMgZnVuY3Rpb24gZ2V0Q29ubmVjdGVkRW11bGF0b3JzICgpIHtcbiAgbG9nLmRlYnVnKCdHZXR0aW5nIGNvbm5lY3RlZCBlbXVsYXRvcnMnKTtcbiAgdHJ5IHtcbiAgICBsZXQgZGV2aWNlcyA9IGF3YWl0IHRoaXMuZ2V0Q29ubmVjdGVkRGV2aWNlcygpO1xuICAgIGxldCBlbXVsYXRvcnMgPSBbXTtcbiAgICBmb3IgKGxldCBkZXZpY2Ugb2YgZGV2aWNlcykge1xuICAgICAgbGV0IHBvcnQgPSB0aGlzLmdldFBvcnRGcm9tRW11bGF0b3JTdHJpbmcoZGV2aWNlLnVkaWQpO1xuICAgICAgaWYgKHBvcnQpIHtcbiAgICAgICAgZGV2aWNlLnBvcnQgPSBwb3J0O1xuICAgICAgICBlbXVsYXRvcnMucHVzaChkZXZpY2UpO1xuICAgICAgfVxuICAgIH1cbiAgICBsb2cuZGVidWcoYCR7dXRpbC5wbHVyYWxpemUoJ2VtdWxhdG9yJywgZW11bGF0b3JzLmxlbmd0aCwgdHJ1ZSl9IGNvbm5lY3RlZGApO1xuICAgIHJldHVybiBlbXVsYXRvcnM7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEVycm9yIGdldHRpbmcgZW11bGF0b3JzLiBPcmlnaW5hbCBlcnJvcjogJHtlLm1lc3NhZ2V9YCk7XG4gIH1cbn07XG5cbi8qKlxuICogU2V0IF9lbXVsYXRvclBvcnRfIHByb3BlcnR5IG9mIHRoZSBjdXJyZW50IGNsYXNzLlxuICpcbiAqIEBwYXJhbSB7bnVtYmVyfSBlbVBvcnQgLSBUaGUgZW11bGF0b3IgcG9ydCB0byBiZSBzZXQuXG4gKi9cbnN5c3RlbUNhbGxNZXRob2RzLnNldEVtdWxhdG9yUG9ydCA9IGZ1bmN0aW9uIHNldEVtdWxhdG9yUG9ydCAoZW1Qb3J0KSB7XG4gIHRoaXMuZW11bGF0b3JQb3J0ID0gZW1Qb3J0O1xufTtcblxuLyoqXG4gKiBTZXQgdGhlIGlkZW50aWZpZXIgb2YgdGhlIGN1cnJlbnQgZGV2aWNlIChfdGhpcy5jdXJEZXZpY2VJZF8pLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSAtIFRoZSBkZXZpY2UgaWRlbnRpZmllci5cbiAqL1xuc3lzdGVtQ2FsbE1ldGhvZHMuc2V0RGV2aWNlSWQgPSBmdW5jdGlvbiBzZXREZXZpY2VJZCAoZGV2aWNlSWQpIHtcbiAgbG9nLmRlYnVnKGBTZXR0aW5nIGRldmljZSBpZCB0byAke2RldmljZUlkfWApO1xuICB0aGlzLmN1ckRldmljZUlkID0gZGV2aWNlSWQ7XG4gIGxldCBhcmdzSGFzRGV2aWNlID0gdGhpcy5leGVjdXRhYmxlLmRlZmF1bHRBcmdzLmluZGV4T2YoJy1zJyk7XG4gIGlmIChhcmdzSGFzRGV2aWNlICE9PSAtMSkge1xuICAgIC8vIHJlbW92ZSB0aGUgb2xkIGRldmljZSBpZCBmcm9tIHRoZSBhcmd1bWVudHNcbiAgICB0aGlzLmV4ZWN1dGFibGUuZGVmYXVsdEFyZ3Muc3BsaWNlKGFyZ3NIYXNEZXZpY2UsIDIpO1xuICB9XG4gIHRoaXMuZXhlY3V0YWJsZS5kZWZhdWx0QXJncy5wdXNoKCctcycsIGRldmljZUlkKTtcbn07XG5cbi8qKlxuICogU2V0IHRoZSB0aGUgY3VycmVudCBkZXZpY2Ugb2JqZWN0LlxuICpcbiAqIEBwYXJhbSB7RGV2aWNlfSBkZXZpY2VPYmogLSBUaGUgZGV2aWNlIG9iamVjdCB0byBiZSBzZXQuXG4gKi9cbnN5c3RlbUNhbGxNZXRob2RzLnNldERldmljZSA9IGZ1bmN0aW9uIHNldERldmljZSAoZGV2aWNlT2JqKSB7XG4gIGxldCBkZXZpY2VJZCA9IGRldmljZU9iai51ZGlkO1xuICBsZXQgZW1Qb3J0ID0gdGhpcy5nZXRQb3J0RnJvbUVtdWxhdG9yU3RyaW5nKGRldmljZUlkKTtcbiAgdGhpcy5zZXRFbXVsYXRvclBvcnQoZW1Qb3J0KTtcbiAgdGhpcy5zZXREZXZpY2VJZChkZXZpY2VJZCk7XG59O1xuXG4vKipcbiAqIEdldCB0aGUgb2JqZWN0IGZvciB0aGUgY3VycmVudGx5IHJ1bm5pbmcgZW11bGF0b3IuXG4gKiAhISEgVGhpcyBtZXRob2QgaGFzIGEgc2lkZSBlZmZlY3QgLSBpdCBpbXBsaWNpdGx5IGNoYW5nZXMgdGhlXG4gKiBgZGV2aWNlSWRgIChvbmx5IGlmIEFWRCB3aXRoIGEgbWF0Y2hpbmcgbmFtZSBpcyBmb3VuZClcbiAqIGFuZCBgZW11bGF0b3JQb3J0YCBpbnN0YW5jZSBwcm9wZXJ0aWVzLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBhdmROYW1lIC0gRW11bGF0b3IgbmFtZS5cbiAqIEByZXR1cm4gez9EZXZpY2V9IEN1cnJlbnRseSBydW5uaW5nIGVtdWxhdG9yIG9yIF9udWxsXy5cbiAqL1xuc3lzdGVtQ2FsbE1ldGhvZHMuZ2V0UnVubmluZ0FWRCA9IGFzeW5jIGZ1bmN0aW9uIGdldFJ1bm5pbmdBVkQgKGF2ZE5hbWUpIHtcbiAgbG9nLmRlYnVnKGBUcnlpbmcgdG8gZmluZCAnJHthdmROYW1lfScgZW11bGF0b3JgKTtcbiAgdHJ5IHtcbiAgICBjb25zdCBlbXVsYXRvcnMgPSBhd2FpdCB0aGlzLmdldENvbm5lY3RlZEVtdWxhdG9ycygpO1xuICAgIGZvciAoY29uc3QgZW11bGF0b3Igb2YgZW11bGF0b3JzKSB7XG4gICAgICB0aGlzLnNldEVtdWxhdG9yUG9ydChlbXVsYXRvci5wb3J0KTtcbiAgICAgIGNvbnN0IHJ1bm5pbmdBVkROYW1lID0gYXdhaXQgdGhpcy5leGVjRW11Q29uc29sZUNvbW1hbmQoWydhdmQnLCAnbmFtZSddLCB7XG4gICAgICAgIHBvcnQ6IGVtdWxhdG9yLnBvcnQsXG4gICAgICAgIGV4ZWNUaW1lb3V0OiA1MDAwLFxuICAgICAgICBjb25uVGltZW91dDogMTAwMCxcbiAgICAgIH0pO1xuICAgICAgaWYgKF8udG9Mb3dlcihhdmROYW1lKSA9PT0gXy50b0xvd2VyKHJ1bm5pbmdBVkROYW1lLnRyaW0oKSkpIHtcbiAgICAgICAgbG9nLmRlYnVnKGBGb3VuZCBlbXVsYXRvciAnJHthdmROYW1lfScgb24gcG9ydCAke2VtdWxhdG9yLnBvcnR9YCk7XG4gICAgICAgIHRoaXMuc2V0RGV2aWNlSWQoZW11bGF0b3IudWRpZCk7XG4gICAgICAgIHJldHVybiBlbXVsYXRvcjtcbiAgICAgIH1cbiAgICB9XG4gICAgbG9nLmRlYnVnKGBFbXVsYXRvciAnJHthdmROYW1lfScgbm90IHJ1bm5pbmdgKTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfSBjYXRjaCAoZSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgRXJyb3IgZ2V0dGluZyBBVkQuIE9yaWdpbmFsIGVycm9yOiAke2UubWVzc2FnZX1gKTtcbiAgfVxufTtcblxuLyoqXG4gKiBHZXQgdGhlIG9iamVjdCBmb3IgdGhlIGN1cnJlbnRseSBydW5uaW5nIGVtdWxhdG9yLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBhdmROYW1lIC0gRW11bGF0b3IgbmFtZS5cbiAqIEBwYXJhbSB7bnVtYmVyfSB0aW1lb3V0TXMgWzIwMDAwXSAtIFRoZSBtYXhpbXVtIG51bWJlciBvZiBtaWxsaXNlY29uZHNcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRvIHdhaXQgdW50aWwgYXQgbGVhc3Qgb25lIHJ1bm5pbmcgQVZEIG9iamVjdFxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaXMgZGV0ZWN0ZWQuXG4gKiBAcmV0dXJuIHs/RGV2aWNlfSBDdXJyZW50bHkgcnVubmluZyBlbXVsYXRvciBvciBfbnVsbF8uXG4gKiBAdGhyb3dzIHtFcnJvcn0gSWYgbm8gZGV2aWNlIGhhcyBiZWVuIGRldGVjdGVkIHdpdGhpbiB0aGUgdGltZW91dC5cbiAqL1xuc3lzdGVtQ2FsbE1ldGhvZHMuZ2V0UnVubmluZ0FWRFdpdGhSZXRyeSA9IGFzeW5jIGZ1bmN0aW9uIGdldFJ1bm5pbmdBVkRXaXRoUmV0cnkgKGF2ZE5hbWUsIHRpbWVvdXRNcyA9IDIwMDAwKSB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIGF3YWl0IHdhaXRGb3JDb25kaXRpb24oYXN5bmMgKCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuZ2V0UnVubmluZ0FWRChhdmROYW1lLnJlcGxhY2UoJ0AnLCAnJykpO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBsb2cuZGVidWcoZS5tZXNzYWdlKTtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgIH0sIHtcbiAgICAgIHdhaXRNczogdGltZW91dE1zLFxuICAgICAgaW50ZXJ2YWxNczogMTAwMCxcbiAgICB9KTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgRXJyb3IgZ2V0dGluZyBBVkQgd2l0aCByZXRyeS4gT3JpZ2luYWwgZXJyb3I6ICR7ZS5tZXNzYWdlfWApO1xuICB9XG59O1xuXG4vKipcbiAqIFNodXRkb3duIGFsbCBydW5uaW5nIGVtdWxhdG9ycyBieSBraWxsaW5nIHRoZWlyIHByb2Nlc3Nlcy5cbiAqXG4gKiBAdGhyb3dzIHtFcnJvcn0gSWYga2lsbGluZyB0b29sIHJldHVybmVkIG5vbi16ZXJvIHJldHVybiBjb2RlLlxuICovXG5zeXN0ZW1DYWxsTWV0aG9kcy5raWxsQWxsRW11bGF0b3JzID0gYXN5bmMgZnVuY3Rpb24ga2lsbEFsbEVtdWxhdG9ycyAoKSB7XG4gIGxldCBjbWQsIGFyZ3M7XG4gIGlmIChzeXN0ZW0uaXNXaW5kb3dzKCkpIHtcbiAgICBjbWQgPSAnVEFTS0tJTEwnO1xuICAgIGFyZ3MgPSBbJ1RBU0tLSUxMJywgJy9JTScsICdlbXVsYXRvci5leGUnXTtcbiAgfSBlbHNlIHtcbiAgICBjbWQgPSAnL3Vzci9iaW4va2lsbGFsbCc7XG4gICAgYXJncyA9IFsnLW0nLCAnZW11bGF0b3IqJ107XG4gIH1cbiAgdHJ5IHtcbiAgICBhd2FpdCBleGVjKGNtZCwgYXJncyk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEVycm9yIGtpbGxpbmcgZW11bGF0b3JzLiBPcmlnaW5hbCBlcnJvcjogJHtlLm1lc3NhZ2V9YCk7XG4gIH1cbn07XG5cbi8qKlxuICogS2lsbCBlbXVsYXRvciB3aXRoIHRoZSBnaXZlbiBuYW1lLiBObyBlcnJvclxuICogaXMgdGhyb3duIGlzIGdpdmVuIGF2ZCBkb2VzIG5vdCBleGlzdC9pcyBub3QgcnVubmluZy5cbiAqXG4gKiBAcGFyYW0gez9zdHJpbmd9IGF2ZE5hbWUgLSBUaGUgbmFtZSBvZiB0aGUgZW11bGF0b3IgdG8gYmUga2lsbGVkLiBJZiBlbXB0eSxcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoZSBjdXJyZW50IGVtdWxhdG9yIHdpbGwgYmUga2lsbGVkLlxuICogQHBhcmFtIHs/bnVtYmVyfSB0aW1lb3V0IFs2MDAwMF0gLSBUaGUgYW1vdW50IG9mIHRpbWUgdG8gd2FpdCBiZWZvcmUgdGhyb3dpbmdcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYW4gZXhjZXB0aW9uIGFib3V0IHVuc3VjY2Vzc2Z1bCBraWxsaW5nXG4gKiBAcmV0dXJuIHtib29sZWFufSAtIFRydWUgaWYgdGhlIGVtdWxhdG9yIHdhcyBraWxsZWQsIGZhbHNlIG90aGVyd2lzZS5cbiAqIEB0aHJvd3Mge0Vycm9yfSBpZiB0aGVyZSB3YXMgYSBmYWlsdXJlIGJ5IGtpbGxpbmcgdGhlIGVtdWxhdG9yXG4gKi9cbnN5c3RlbUNhbGxNZXRob2RzLmtpbGxFbXVsYXRvciA9IGFzeW5jIGZ1bmN0aW9uIGtpbGxFbXVsYXRvciAoYXZkTmFtZSA9IG51bGwsIHRpbWVvdXQgPSA2MDAwMCkge1xuICBpZiAodXRpbC5oYXNWYWx1ZShhdmROYW1lKSkge1xuICAgIGxvZy5kZWJ1ZyhgS2lsbGluZyBhdmQgJyR7YXZkTmFtZX0nYCk7XG4gICAgY29uc3QgZGV2aWNlID0gYXdhaXQgdGhpcy5nZXRSdW5uaW5nQVZEKGF2ZE5hbWUpO1xuICAgIGlmICghZGV2aWNlKSB7XG4gICAgICBsb2cuaW5mbyhgTm8gYXZkIHdpdGggbmFtZSAnJHthdmROYW1lfScgcnVubmluZy4gU2tpcHBpbmcga2lsbCBzdGVwLmApO1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICAvLyBraWxsaW5nIHRoZSBjdXJyZW50IGF2ZFxuICAgIGxvZy5kZWJ1ZyhgS2lsbGluZyBhdmQgd2l0aCBpZCAnJHt0aGlzLmN1ckRldmljZUlkfSdgKTtcbiAgICBpZiAoIWF3YWl0IHRoaXMuaXNFbXVsYXRvckNvbm5lY3RlZCgpKSB7XG4gICAgICBsb2cuZGVidWcoYEVtdWxhdG9yIHdpdGggaWQgJyR7dGhpcy5jdXJEZXZpY2VJZH0nIG5vdCBjb25uZWN0ZWQuIFNraXBwaW5nIGtpbGwgc3RlcGApO1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuICBhd2FpdCB0aGlzLmFkYkV4ZWMoWydlbXUnLCAna2lsbCddKTtcbiAgbG9nLmRlYnVnKGBXYWl0aW5nIHVwIHRvICR7dGltZW91dH1tcyB1bnRpbCB0aGUgZW11bGF0b3IgJyR7YXZkTmFtZSA/IGF2ZE5hbWUgOiB0aGlzLmN1ckRldmljZUlkfScgaXMga2lsbGVkYCk7XG4gIHRyeSB7XG4gICAgYXdhaXQgd2FpdEZvckNvbmRpdGlvbihhc3luYyAoKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICByZXR1cm4gdXRpbC5oYXNWYWx1ZShhdmROYW1lKVxuICAgICAgICAgID8gIWF3YWl0IHRoaXMuZ2V0UnVubmluZ0FWRChhdmROYW1lKVxuICAgICAgICAgIDogIWF3YWl0IHRoaXMuaXNFbXVsYXRvckNvbm5lY3RlZCgpO1xuICAgICAgfSBjYXRjaCAoaWduKSB7fVxuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH0sIHtcbiAgICAgIHdhaXRNczogdGltZW91dCxcbiAgICAgIGludGVydmFsTXM6IDIwMDAsXG4gICAgfSk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFRoZSBlbXVsYXRvciAnJHthdmROYW1lID8gYXZkTmFtZSA6IHRoaXMuY3VyRGV2aWNlSWR9JyBpcyBzdGlsbCBydW5uaW5nIGFmdGVyIGJlaW5nIGtpbGxlZCAke3RpbWVvdXR9bXMgYWdvYCk7XG4gIH1cbiAgbG9nLmluZm8oYFN1Y2Nlc3NmdWxseSBraWxsZWQgdGhlICcke2F2ZE5hbWUgPyBhdmROYW1lIDogdGhpcy5jdXJEZXZpY2VJZH0nIGVtdWxhdG9yYCk7XG4gIHJldHVybiB0cnVlO1xufTtcblxuLyoqXG4gKiBAdHlwZWRlZiB7T2JqZWN0fSBBdmRMYXVuY2hPcHRpb25zXG4gKiBAcHJvcGVydHkge3N0cmluZ3xBcnJheTxzdHJpbmc+fSBhcmdzIEFkZGl0aW9uYWwgZW11bGF0b3IgY29tbWFuZCBsaW5lIGFyZ3VtZW50c1xuICogQHByb3BlcnR5IHtPYmplY3R9IGVudiBBZGRpdGlvbmFsIGVtdWxhdG9yIGVudmlyb25tZW50IHZhcmlhYmxlc1xuICogQHByb3BlcnR5IHtzdHJpbmd9IGxhbmd1YWdlIEVtdWxhdG9yIHN5c3RlbSBsYW5ndWFnZVxuICogQHByb3BlcnR5IHtzdHJpbmd9IGNvdW50cnkgRW11bGF0b3Igc3lzdGVtIGNvdW50cnlcbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBsYXVuY2hUaW1lb3V0IFs2MDAwMF0gRW11bGF0b3Igc3RhcnR1cCB0aW1lb3V0IGluIG1pbGxpc2Vjb25kc1xuICogQHByb3BlcnR5IHtudW1iZXJ9IHJlYWR5VGltZW91dCBbNjAwMDBdIFRoZSBtYXhpbXVtIHBlcmlvZCBvZiB0aW1lIHRvIHdhaXQgdW50aWwgRW11bGF0b3JcbiAqIGlzIHJlYWR5IGZvciB1c2FnZSBpbiBtaWxsaXNlY29uZHNcbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSByZXRyeVRpbWVzIFsxXSBUaGUgbWF4aW11bSBudW1iZXIgb2Ygc3RhcnR1cCByZXRyaWVzXG4gKi9cblxuLyoqXG4gKiBTdGFydCBhbiBlbXVsYXRvciB3aXRoIGdpdmVuIHBhcmFtZXRlcnMgYW5kIHdhaXQgdW50aWwgaXQgaXMgZnVsbHkgc3RhcnRlZC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gYXZkTmFtZSAtIFRoZSBuYW1lIG9mIGFuIGV4aXN0aW5nIGVtdWxhdG9yLlxuICogQHBhcmFtIHs/QXZkTGF1bmNoT3B0aW9uc30gb3B0c1xuICogQHJldHVybnMge1N1YlByb2Nlc3N9IEVtdWxhdG9yIHN1YnByb2Nlc3MgaW5zdGFuY2VcbiAqIEB0aHJvd3Mge0Vycm9yfSBJZiB0aGUgZW11bGF0b3IgZmFpbHMgdG8gc3RhcnQgd2l0aGluIHRoZSBnaXZlbiB0aW1lb3V0LlxuICovXG5zeXN0ZW1DYWxsTWV0aG9kcy5sYXVuY2hBVkQgPSBhc3luYyBmdW5jdGlvbiBsYXVuY2hBVkQgKGF2ZE5hbWUsIG9wdHMgPSB7fSkge1xuICBjb25zdCB7XG4gICAgYXJncyA9IFtdLFxuICAgIGVudiA9IHt9LFxuICAgIGxhbmd1YWdlLFxuICAgIGNvdW50cnksXG4gICAgbGF1bmNoVGltZW91dCA9IDYwMDAwLFxuICAgIHJlYWR5VGltZW91dCA9IDYwMDAwLFxuICAgIHJldHJ5VGltZXMgPSAxLFxuICB9ID0gb3B0cztcbiAgbG9nLmRlYnVnKGBMYXVuY2hpbmcgRW11bGF0b3Igd2l0aCBBVkQgJHthdmROYW1lfSwgbGF1bmNoVGltZW91dCBgICtcbiAgICAgICAgICAgIGAke2xhdW5jaFRpbWVvdXR9bXMgYW5kIHJlYWR5VGltZW91dCAke3JlYWR5VGltZW91dH1tc2ApO1xuICBjb25zdCBlbXVsYXRvckJpbmFyeVBhdGggPSBhd2FpdCB0aGlzLmdldFNka0JpbmFyeVBhdGgoJ2VtdWxhdG9yJyk7XG4gIGlmIChhdmROYW1lWzBdID09PSAnQCcpIHtcbiAgICBhdmROYW1lID0gYXZkTmFtZS5zdWJzdHIoMSk7XG4gIH1cbiAgYXdhaXQgdGhpcy5jaGVja0F2ZEV4aXN0KGF2ZE5hbWUpO1xuXG4gIGNvbnN0IGxhdW5jaEFyZ3MgPSBbJy1hdmQnLCBhdmROYW1lXTtcbiAgbGF1bmNoQXJncy5wdXNoKC4uLih0b0F2ZExvY2FsZUFyZ3MobGFuZ3VhZ2UsIGNvdW50cnkpKSk7XG5cbiAgbGV0IGlzRGVsYXlBZGJGZWF0dXJlRW5hYmxlZCA9IGZhbHNlO1xuICBpZiAodGhpcy5hbGxvd0RlbGF5QWRiKSB7XG4gICAgY29uc3Qge3JldmlzaW9ufSA9IGF3YWl0IHRoaXMuZ2V0RW11VmVyc2lvbkluZm8oKTtcbiAgICBpZiAocmV2aXNpb24gJiYgdXRpbC5jb21wYXJlVmVyc2lvbnMocmV2aXNpb24sICc+PScsICcyOS4wLjcnKSkge1xuICAgICAgLy8gaHR0cHM6Ly9hbmRyb2lkc3R1ZGlvLmdvb2dsZWJsb2cuY29tLzIwMTkvMDUvZW11bGF0b3ItMjkwNy1jYW5hcnkuaHRtbFxuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3Qge3RhcmdldH0gPSBhd2FpdCB0aGlzLmdldEVtdUltYWdlUHJvcGVydGllcyhhdmROYW1lKTtcbiAgICAgICAgY29uc3QgYXBpTWF0Y2ggPSAvXFxkKy8uZXhlYyh0YXJnZXQpO1xuICAgICAgICAvLyBodHRwczovL2lzc3VldHJhY2tlci5nb29nbGUuY29tL2lzc3Vlcy8xNDI1MzMzNTVcbiAgICAgICAgaWYgKGFwaU1hdGNoICYmIHBhcnNlSW50KGFwaU1hdGNoWzBdLCAxMCkgPj0gTUlOX0RFTEFZX0FEQl9BUElfTEVWRUwpIHtcbiAgICAgICAgICBsYXVuY2hBcmdzLnB1c2goJy1kZWxheS1hZGInKTtcbiAgICAgICAgICBpc0RlbGF5QWRiRmVhdHVyZUVuYWJsZWQgPSB0cnVlO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVGhlIGFjdHVhbCBpbWFnZSBBUEkgdmVyc2lvbiBpcyBiZWxvdyAke01JTl9ERUxBWV9BREJfQVBJX0xFVkVMfWApO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGxvZy5pbmZvKGBUaGUgLWRlbGF5LWFkYiBlbXVsYXRvciBzdGFydHVwIGRldGVjdGlvbiBmZWF0dXJlIHdpbGwgbm90IGJlIGVuYWJsZWQuIGAgK1xuICAgICAgICAgIGBPcmlnaW5hbCBlcnJvcjogJHtlLm1lc3NhZ2V9YCk7XG4gICAgICB9XG4gICAgfVxuICB9IGVsc2Uge1xuICAgIGxvZy5pbmZvKCdUaGUgLWRlbGF5LWFkYiBlbXVsYXRvciBzdGFydHVwIGRldGVjdGlvbiBmZWF0dXJlIGhhcyBiZWVuIGV4cGxpY2l0bHkgZGlzYWJsZWQnKTtcbiAgfVxuXG4gIGlmICghXy5pc0VtcHR5KGFyZ3MpKSB7XG4gICAgbGF1bmNoQXJncy5wdXNoKC4uLihfLmlzQXJyYXkoYXJncykgPyBhcmdzIDogdXRpbC5zaGVsbFBhcnNlKGAke2FyZ3N9YCkpKTtcbiAgfVxuXG4gIGxvZy5kZWJ1ZyhgUnVubmluZyAnJHtlbXVsYXRvckJpbmFyeVBhdGh9JyB3aXRoIGFyZ3M6ICR7dXRpbC5xdW90ZShsYXVuY2hBcmdzKX1gKTtcbiAgaWYgKCFfLmlzRW1wdHkoZW52KSkge1xuICAgIGxvZy5kZWJ1ZyhgQ3VzdG9taXplZCBlbXVsYXRvciBlbnZpcm9ubWVudDogJHtKU09OLnN0cmluZ2lmeShlbnYpfWApO1xuICB9XG4gIGNvbnN0IHByb2MgPSBuZXcgU3ViUHJvY2VzcyhlbXVsYXRvckJpbmFyeVBhdGgsIGxhdW5jaEFyZ3MsIHtcbiAgICBlbnY6IE9iamVjdC5hc3NpZ24oe30sIHByb2Nlc3MuZW52LCBlbnYpLFxuICB9KTtcbiAgYXdhaXQgcHJvYy5zdGFydCgwKTtcbiAgcHJvYy5vbignb3V0cHV0JywgKHN0ZG91dCwgc3RkZXJyKSA9PiB7XG4gICAgZm9yIChsZXQgbGluZSBvZiAoc3Rkb3V0IHx8IHN0ZGVyciB8fCAnJykuc3BsaXQoJ1xcbicpLmZpbHRlcihCb29sZWFuKSkge1xuICAgICAgbG9nLmluZm8oYFtBVkQgT1VUUFVUXSAke2xpbmV9YCk7XG4gICAgfVxuICB9KTtcbiAgcHJvYy5vbignZGllJywgKGNvZGUsIHNpZ25hbCkgPT4ge1xuICAgIGxvZy53YXJuKGBFbXVsYXRvciBhdmQgJHthdmROYW1lfSBleGl0ZWQgd2l0aCBjb2RlICR7Y29kZX0ke3NpZ25hbCA/IGAsIHNpZ25hbCAke3NpZ25hbH1gIDogJyd9YCk7XG4gIH0pO1xuICBhd2FpdCByZXRyeShyZXRyeVRpbWVzLCBhc3luYyAoKSA9PiBhd2FpdCB0aGlzLmdldFJ1bm5pbmdBVkRXaXRoUmV0cnkoYXZkTmFtZSwgbGF1bmNoVGltZW91dCkpO1xuICAvLyBBdCB0aGlzIHBvaW50IHdlIGhhdmUgZGV2aWNlSWQgYWxyZWFkeSBhc3NpZ25lZFxuICBpZiAoaXNEZWxheUFkYkZlYXR1cmVFbmFibGVkKSB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuYWRiRXhlYyhbJ3dhaXQtZm9yLWRldmljZSddLCB7dGltZW91dDogcmVhZHlUaW1lb3V0fSk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAnJHthdmROYW1lfScgRW11bGF0b3IgaGFzIGZhaWxlZCB0byBib290OiAke2Uuc3RkZXJyIHx8IGUubWVzc2FnZX1gKTtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgYXdhaXQgdGhpcy53YWl0Rm9yRW11bGF0b3JSZWFkeShyZWFkeVRpbWVvdXQpO1xuICB9XG4gIHJldHVybiBwcm9jO1xufTtcblxuLyoqXG4gKiBAdHlwZWRlZiB7T2JqZWN0fSBCaW5hcnlWZXJzaW9uXG4gKiBAcHJvcGVydHkge1NlbVZlcn0gdmVyc2lvbiAtIFRoZSBBREIgYmluYXJ5IHZlcnNpb24gbnVtYmVyXG4gKiBAcHJvcGVydHkge251bWJlcn0gYnVpbGQgLSBUaGUgQURCIGJpbmFyeSBidWlsZCBudW1iZXJcbiAqL1xuXG4vKipcbiAqIEB0eXBlZGVmIHtPYmplY3R9IEJyaWRnZVZlcnNpb25cbiAqIEBwcm9wZXJ0eSB7U2VtVmVyfSB2ZXJzaW9uIC0gVGhlIEFuZHJvaWQgRGVidWcgQnJpZGdlIHZlcnNpb24gbnVtYmVyXG4gKi9cblxuLyoqXG4gKiBAdHlwZWRlZiB7T2JqZWN0fSBWZXJzaW9uXG4gKiBAcHJvcGVydHkgez9CaW5hcnlWZXJzaW9ufSBiaW5hcnkgVGhpcyB2ZXJzaW9uIG51bWJlciBtaWdodCBub3QgYmVcbiAqIGJlIHByZXNlbnQgZm9yIG9sZGVyIEFEQiByZWxlYXNlcy5cbiAqIEBwcm9wZXJ0eSB7QnJpZGdlVmVyc2lvbn0gYnJpZGdlXG4gKi9cblxuLyoqXG4gKiBHZXQgdGhlIGFkYiB2ZXJzaW9uLiBUaGUgcmVzdWx0IG9mIHRoaXMgbWV0aG9kIGlzIGNhY2hlZC5cbiAqXG4gKiBAcmV0dXJuIHtWZXJzaW9ufVxuICogQHRocm93cyB7RXJyb3J9IElmIGl0IGlzIG5vdCBwb3NzaWJsZSB0byBwYXJzZSBhZGIgYmluYXJ5IHZlcnNpb24uXG4gKi9cbnN5c3RlbUNhbGxNZXRob2RzLmdldFZlcnNpb24gPSBfLm1lbW9pemUoYXN5bmMgZnVuY3Rpb24gZ2V0VmVyc2lvbiAoKSB7XG4gIGxldCBzdGRvdXQ7XG4gIHRyeSB7XG4gICAgc3Rkb3V0ID0gYXdhaXQgdGhpcy5hZGJFeGVjKCd2ZXJzaW9uJyk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEVycm9yIGdldHRpbmcgYWRiIHZlcnNpb246ICR7ZS5zdGRlcnIgfHwgZS5tZXNzYWdlfWApO1xuICB9XG5cbiAgY29uc3QgcmVzdWx0ID0ge307XG4gIGNvbnN0IGJpbmFyeVZlcnNpb25NYXRjaCA9IEJJTkFSWV9WRVJTSU9OX1BBVFRFUk4uZXhlYyhzdGRvdXQpO1xuICBpZiAoYmluYXJ5VmVyc2lvbk1hdGNoKSB7XG4gICAgcmVzdWx0LmJpbmFyeSA9IHtcbiAgICAgIHZlcnNpb246IHNlbXZlci5jb2VyY2UoYmluYXJ5VmVyc2lvbk1hdGNoWzFdKSxcbiAgICAgIGJ1aWxkOiBwYXJzZUludChiaW5hcnlWZXJzaW9uTWF0Y2hbMl0sIDEwKSxcbiAgICB9O1xuICB9XG4gIGNvbnN0IGJyaWRnZVZlcnNpb25NYXRjaCA9IEJSSURHRV9WRVJTSU9OX1BBVFRFUk4uZXhlYyhzdGRvdXQpO1xuICBpZiAoYnJpZGdlVmVyc2lvbk1hdGNoKSB7XG4gICAgcmVzdWx0LmJyaWRnZSA9IHtcbiAgICAgIHZlcnNpb246IHNlbXZlci5jb2VyY2UoYnJpZGdlVmVyc2lvbk1hdGNoWzFdKSxcbiAgICB9O1xuICB9XG4gIHJldHVybiByZXN1bHQ7XG59KTtcblxuLyoqXG4gKiBDaGVjayBpZiB0aGUgY3VycmVudCBlbXVsYXRvciBpcyByZWFkeSB0byBhY2NlcHQgZnVydGhlciBjb21tYW5kcyAoYm9vdGluZyBjb21wbGV0ZWQpLlxuICpcbiAqIEBwYXJhbSB7bnVtYmVyfSB0aW1lb3V0TXMgWzIwMDAwXSAtIFRoZSBtYXhpbXVtIG51bWJlciBvZiBtaWxsaXNlY29uZHMgdG8gd2FpdC5cbiAqIEB0aHJvd3Mge0Vycm9yfSBJZiB0aGUgZW11bGF0b3IgaXMgbm90IHJlYWR5IHdpdGhpbiB0aGUgZ2l2ZW4gdGltZW91dC5cbiAqL1xuc3lzdGVtQ2FsbE1ldGhvZHMud2FpdEZvckVtdWxhdG9yUmVhZHkgPSBhc3luYyBmdW5jdGlvbiB3YWl0Rm9yRW11bGF0b3JSZWFkeSAodGltZW91dE1zID0gMjAwMDApIHtcbiAgdHJ5IHtcbiAgICBhd2FpdCB3YWl0Rm9yQ29uZGl0aW9uKGFzeW5jICgpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGlmICghKGF3YWl0IHRoaXMuc2hlbGwoWydnZXRwcm9wJywgJ2luaXQuc3ZjLmJvb3RhbmltJ10pKS5pbmNsdWRlcygnc3RvcHBlZCcpKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIC8vIFNvbWV0aW1lcyB0aGUgcGFja2FnZSBtYW5hZ2VyIHNlcnZpY2UgbWlnaHQgc3RpbGwgYmVpbmcgaW5pdGlhbGl6ZWRcbiAgICAgICAgLy8gb24gc2xvdyBzeXN0ZW1zIGV2ZW4gYWZ0ZXIgZW11bGF0b3IgYm9vdGluZyBpcyBjb21wbGV0ZWQuXG4gICAgICAgIC8vIFRoZSB1c3VhbCBvdXRwdXQgb2YgYHBtIGdldC1pbnN0YWxsLWxvY2F0aW9uYCBjb21tYW5kIGxvb2tzIGxpa2UgYDBbYXV0b11gXG4gICAgICAgIHJldHVybiAvXFxkK1xcW1xcdytcXF0vLnRlc3QoYXdhaXQgdGhpcy5zaGVsbChbJ3BtJywgJ2dldC1pbnN0YWxsLWxvY2F0aW9uJ10pKTtcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICBsb2cuZGVidWcoYFdhaXRpbmcgZm9yIGVtdWxhdG9yIHN0YXJ0dXAuIEludGVybWVkaWF0ZSBlcnJvcjogJHtlcnIubWVzc2FnZX1gKTtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgIH0sIHtcbiAgICAgIHdhaXRNczogdGltZW91dE1zLFxuICAgICAgaW50ZXJ2YWxNczogMzAwMCxcbiAgICB9KTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgRW11bGF0b3IgaXMgbm90IHJlYWR5IHdpdGhpbiAke3RpbWVvdXRNc31tc2ApO1xuICB9XG59O1xuXG4vKipcbiAqIENoZWNrIGlmIHRoZSBjdXJyZW50IGRldmljZSBpcyByZWFkeSB0byBhY2NlcHQgZnVydGhlciBjb21tYW5kcyAoYm9vdGluZyBjb21wbGV0ZWQpLlxuICpcbiAqIEBwYXJhbSB7bnVtYmVyfSBhcHBEZXZpY2VSZWFkeVRpbWVvdXQgWzMwXSAtIFRoZSBtYXhpbXVtIG51bWJlciBvZiBzZWNvbmRzIHRvIHdhaXQuXG4gKiBAdGhyb3dzIHtFcnJvcn0gSWYgdGhlIGRldmljZSBpcyBub3QgcmVhZHkgd2l0aGluIHRoZSBnaXZlbiB0aW1lb3V0LlxuICovXG5zeXN0ZW1DYWxsTWV0aG9kcy53YWl0Rm9yRGV2aWNlID0gYXN5bmMgZnVuY3Rpb24gd2FpdEZvckRldmljZSAoYXBwRGV2aWNlUmVhZHlUaW1lb3V0ID0gMzApIHtcbiAgdGhpcy5hcHBEZXZpY2VSZWFkeVRpbWVvdXQgPSBhcHBEZXZpY2VSZWFkeVRpbWVvdXQ7XG4gIGNvbnN0IHJldHJpZXMgPSAzO1xuICBjb25zdCB0aW1lb3V0ID0gcGFyc2VJbnQodGhpcy5hcHBEZXZpY2VSZWFkeVRpbWVvdXQsIDEwKSAqIDEwMDAgLyByZXRyaWVzO1xuICBhd2FpdCByZXRyeShyZXRyaWVzLCBhc3luYyAoKSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuYWRiRXhlYygnd2FpdC1mb3ItZGV2aWNlJywge3RpbWVvdXR9KTtcbiAgICAgIGF3YWl0IHRoaXMucGluZygpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMucmVjb25uZWN0KCk7XG4gICAgICB9IGNhdGNoIChpZ24pIHtcbiAgICAgICAgYXdhaXQgdGhpcy5yZXN0YXJ0QWRiKCk7XG4gICAgICB9XG4gICAgICBhd2FpdCB0aGlzLmdldENvbm5lY3RlZERldmljZXMoKTtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXJyb3Igd2FpdGluZyBmb3IgdGhlIGRldmljZSB0byBiZSBhdmFpbGFibGUuIE9yaWdpbmFsIGVycm9yOiAnJHtlLm1lc3NhZ2V9J2ApO1xuICAgIH1cbiAgfSk7XG59O1xuXG4vKipcbiAqIFJlYm9vdCB0aGUgY3VycmVudCBkZXZpY2UgYW5kIHdhaXQgdW50aWwgaXQgaXMgY29tcGxldGVkLlxuICpcbiAqIEBwYXJhbSB7bnVtYmVyfSByZXRyaWVzIFtERUZBVUxUX0FEQl9SRUJPT1RfUkVUUklFU10gLSBUaGUgbWF4aW11bSBudW1iZXIgb2YgcmVib290IHJldHJpZXMuXG4gKiBAdGhyb3dzIHtFcnJvcn0gSWYgdGhlIGRldmljZSBmYWlsZWQgdG8gcmVib290IGFuZCBudW1iZXIgb2YgcmV0cmllcyBpcyBleGNlZWRlZC5cbiAqL1xuc3lzdGVtQ2FsbE1ldGhvZHMucmVib290ID0gYXN5bmMgZnVuY3Rpb24gcmVib290IChyZXRyaWVzID0gREVGQVVMVF9BREJfUkVCT09UX1JFVFJJRVMpIHtcbiAgLy8gR2V0IHJvb3QgYWNjZXNzIHNvIHdlIGNhbiBydW4gdGhlIG5leHQgc2hlbGwgY29tbWFuZHMgd2hpY2ggcmVxdWlyZSByb290IGFjY2Vzc1xuICBjb25zdCB7IHdhc0FscmVhZHlSb290ZWQgfSA9IGF3YWl0IHRoaXMucm9vdCgpO1xuICB0cnkge1xuICAgIC8vIFN0b3AgYW5kIHJlLXN0YXJ0IHRoZSBkZXZpY2VcbiAgICBhd2FpdCB0aGlzLnNoZWxsKFsnc3RvcCddKTtcbiAgICBhd2FpdCBCLmRlbGF5KDIwMDApOyAvLyBsZXQgdGhlIGVtdSBmaW5pc2ggc3RvcHBpbmc7XG4gICAgYXdhaXQgdGhpcy5zZXREZXZpY2VQcm9wZXJ0eSgnc3lzLmJvb3RfY29tcGxldGVkJywgMCwge1xuICAgICAgcHJpdmlsZWdlZDogZmFsc2UgLy8gbm8gbmVlZCB0byBzZXQgcHJpdmlsZWdlZCB0cnVlIGJlY2F1c2UgZGV2aWNlIGFscmVhZHkgcm9vdGVkXG4gICAgfSk7XG4gICAgYXdhaXQgdGhpcy5zaGVsbChbJ3N0YXJ0J10pO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc3Qge21lc3NhZ2V9ID0gZTtcblxuICAgIC8vIHByb3ZpZGUgYSBoZWxwZnVsIGVycm9yIG1lc3NhZ2UgaWYgdGhlIHJlYXNvbiByZWJvb3QgZmFpbGVkIHdhcyBiZWNhdXNlIEFEQiBjb3VsZG4ndCBnYWluIHJvb3QgYWNjZXNzXG4gICAgaWYgKG1lc3NhZ2UuaW5jbHVkZXMoJ211c3QgYmUgcm9vdCcpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENvdWxkIG5vdCByZWJvb3QgZGV2aWNlLiBSZWJvb3RpbmcgcmVxdWlyZXMgcm9vdCBhY2Nlc3MgYW5kIGAgK1xuICAgICAgICBgYXR0ZW1wdCB0byBnZXQgcm9vdCBhY2Nlc3Mgb24gZGV2aWNlIGZhaWxlZCB3aXRoIGVycm9yOiAnJHttZXNzYWdlfSdgKTtcbiAgICB9XG4gICAgdGhyb3cgZTtcbiAgfSBmaW5hbGx5IHtcbiAgICAvLyBSZXR1cm4gcm9vdCBzdGF0ZSB0byB3aGF0IGl0IHdhcyBiZWZvcmVcbiAgICBpZiAoIXdhc0FscmVhZHlSb290ZWQpIHtcbiAgICAgIGF3YWl0IHRoaXMudW5yb290KCk7XG4gICAgfVxuICB9XG4gIGNvbnN0IHRpbWVyID0gbmV3IHRpbWluZy5UaW1lcigpLnN0YXJ0KCk7XG4gIGF3YWl0IHJldHJ5SW50ZXJ2YWwocmV0cmllcywgMTAwMCwgYXN5bmMgKCkgPT4ge1xuICAgIGlmICgoYXdhaXQgdGhpcy5nZXREZXZpY2VQcm9wZXJ0eSgnc3lzLmJvb3RfY29tcGxldGVkJykpID09PSAnMScpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgLy8gd2UgZG9uJ3Qgd2FudCB0aGUgc3RhY2sgdHJhY2UsIHNvIG5vIGxvZy5lcnJvckFuZFRocm93XG4gICAgY29uc3QgbXNnID0gYFJlYm9vdCBpcyBub3QgY29tcGxldGVkIGFmdGVyICR7dGltZXIuZ2V0RHVyYXRpb24oKS5hc01pbGxpU2Vjb25kcy50b0ZpeGVkKDApfW1zYDtcbiAgICBsb2cuZGVidWcobXNnKTtcbiAgICB0aHJvdyBuZXcgRXJyb3IobXNnKTtcbiAgfSk7XG59O1xuXG4vKipcbiAqIEB0eXBlZGVmIHtPYmplY3R9IHJvb3RSZXN1bHRcbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gaXNTdWNjZXNzZnVsIFRydWUgaWYgdGhlIGNhbGwgdG8gcm9vdC91bnJvb3Qgd2FzIHN1Y2Nlc3NmdWxcbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gd2FzQWxyZWFkeVJvb3RlZCBUcnVlIGlmIHRoZSBkZXZpY2Ugd2FzIGFscmVhZHkgcm9vdGVkXG4gKi9cblxuLyoqXG4gKiBTd2l0Y2ggYWRiIHNlcnZlciByb290IHByaXZpbGVnZXMuXG4gKiBAcGFyYW0ge2Jvb2xlYW59IGlzRWxldmF0ZWQgLSBTaG91bGQgd2UgZWxldmF0ZSB0byB0byByb290IG9yIHVucm9vdD8gKGRlZmF1bHQgdHJ1ZSlcbiAqIEByZXR1cm4ge3Jvb3RSZXN1bHR9XG4gKi9cbnN5c3RlbUNhbGxNZXRob2RzLmNoYW5nZVVzZXJQcml2aWxlZ2VzID0gYXN5bmMgZnVuY3Rpb24gY2hhbmdlVXNlclByaXZpbGVnZXMgKGlzRWxldmF0ZWQpIHtcbiAgY29uc3QgY21kID0gaXNFbGV2YXRlZCA/ICdyb290JyA6ICd1bnJvb3QnO1xuXG4gIGNvbnN0IHJldHJ5SWZPZmZsaW5lID0gYXN5bmMgKGNtZEZ1bmMpID0+IHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IGNtZEZ1bmMoKTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIC8vIENoZWNrIHRoZSBvdXRwdXQgb2YgdGhlIHN0ZEVyciB0byBzZWUgaWYgdGhlcmUncyBhbnkgY2x1ZXMgdGhhdCBzaG93IHRoYXQgdGhlIGRldmljZSB3ZW50IG9mZmxpbmVcbiAgICAgIC8vIGFuZCBpZiBpdCBkaWQgZ28gb2ZmbGluZSwgcmVzdGFydCBBREJcbiAgICAgIGlmIChbJ2Nsb3NlZCcsICdkZXZpY2Ugb2ZmbGluZScsICd0aW1lb3V0IGV4cGlyZWQnXVxuICAgICAgICAgIC5zb21lKCh4KSA9PiAoZXJyLnN0ZGVyciB8fCAnJykudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyh4KSkpIHtcbiAgICAgICAgbG9nLndhcm4oYEF0dGVtcHQgdG8gJHtjbWR9IGNhdXNlZCBBREIgdG8gdGhpbmsgdGhlIGRldmljZSB3ZW50IG9mZmxpbmVgKTtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCB0aGlzLnJlY29ubmVjdCgpO1xuICAgICAgICB9IGNhdGNoIChpZ24pIHtcbiAgICAgICAgICBhd2FpdCB0aGlzLnJlc3RhcnRBZGIoKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gYXdhaXQgY21kRnVuYygpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgfVxuICAgIH1cbiAgfTtcblxuICAvLyBJZiBpdCdzIGFscmVhZHkgcm9vdGVkLCBvdXIgam9iIGlzIGRvbmUuIE5vIG5lZWQgdG8gcm9vdCBpdCBhZ2Fpbi5cbiAgY29uc3QgaXNSb290ID0gYXdhaXQgcmV0cnlJZk9mZmxpbmUoYXN5bmMgKCkgPT4gYXdhaXQgdGhpcy5pc1Jvb3QoKSk7XG4gIGlmICgoaXNSb290ICYmIGlzRWxldmF0ZWQpIHx8ICghaXNSb290ICYmICFpc0VsZXZhdGVkKSkge1xuICAgIHJldHVybiB7aXNTdWNjZXNzZnVsOiB0cnVlLCB3YXNBbHJlYWR5Um9vdGVkOiBpc1Jvb3R9O1xuICB9XG5cbiAgbGV0IHdhc0FscmVhZHlSb290ZWQgPSBpc1Jvb3Q7XG4gIHRyeSB7XG4gICAgY29uc3Qge3N0ZG91dH0gPSBhd2FpdCByZXRyeUlmT2ZmbGluZShhc3luYyAoKSA9PiBhd2FpdCB0aGlzLmFkYkV4ZWMoW2NtZF0pKTtcbiAgICBsb2cuZGVidWcoc3Rkb3V0KTtcblxuICAgIC8vIG9uIHJlYWwgZGV2aWNlcyBpbiBzb21lIHNpdHVhdGlvbnMgd2UgZ2V0IGFuIGVycm9yIGluIHRoZSBzdGRvdXRcbiAgICBpZiAoc3Rkb3V0KSB7XG4gICAgICBpZiAoc3Rkb3V0LmluY2x1ZGVzKCdhZGJkIGNhbm5vdCBydW4gYXMgcm9vdCcpKSB7XG4gICAgICAgIHJldHVybiB7aXNTdWNjZXNzZnVsOiBmYWxzZSwgd2FzQWxyZWFkeVJvb3RlZH07XG4gICAgICB9XG4gICAgICAvLyBpZiB0aGUgZGV2aWNlIHdhcyBhbHJlYWR5IHJvb3RlZCwgcmV0dXJuIHRoYXQgaW4gdGhlIHJlc3VsdFxuICAgICAgaWYgKHN0ZG91dC5pbmNsdWRlcygnYWxyZWFkeSBydW5uaW5nIGFzIHJvb3QnKSkge1xuICAgICAgICB3YXNBbHJlYWR5Um9vdGVkID0gdHJ1ZTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHtpc1N1Y2Nlc3NmdWw6IHRydWUsIHdhc0FscmVhZHlSb290ZWR9O1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICBjb25zdCB7c3RkZXJyID0gJycsIG1lc3NhZ2V9ID0gZXJyO1xuICAgIGxvZy53YXJuKGBVbmFibGUgdG8gJHtjbWR9IGFkYiBkYWVtb24uIE9yaWdpbmFsIGVycm9yOiAnJHttZXNzYWdlfScuIFN0ZGVycjogJyR7c3RkZXJyfScuIENvbnRpbnVpbmcuYCk7XG4gICAgcmV0dXJuIHtpc1N1Y2Nlc3NmdWw6IGZhbHNlLCB3YXNBbHJlYWR5Um9vdGVkfTtcbiAgfVxufTtcblxuLyoqXG4gKiBTd2l0Y2ggYWRiIHNlcnZlciB0byByb290IG1vZGVcbiAqIEByZXR1cm4ge3Jvb3RSZXN1bHR9XG4gKi9cbnN5c3RlbUNhbGxNZXRob2RzLnJvb3QgPSBhc3luYyBmdW5jdGlvbiByb290ICgpIHtcbiAgcmV0dXJuIGF3YWl0IHRoaXMuY2hhbmdlVXNlclByaXZpbGVnZXModHJ1ZSk7XG59O1xuXG4vKipcbiAqIFN3aXRjaCBhZGIgc2VydmVyIHRvIG5vbi1yb290IG1vZGUuXG4gKlxuICogQHJldHVybiB7cm9vdFJlc3VsdH1cbiAqL1xuc3lzdGVtQ2FsbE1ldGhvZHMudW5yb290ID0gYXN5bmMgZnVuY3Rpb24gdW5yb290ICgpIHtcbiAgcmV0dXJuIGF3YWl0IHRoaXMuY2hhbmdlVXNlclByaXZpbGVnZXMoZmFsc2UpO1xufTtcblxuLyoqXG4gKiBDaGVja3Mgd2hldGhlciB0aGUgY3VycmVudCB1c2VyIGlzIHJvb3RcbiAqXG4gKiBAcmV0dXJuIHtib29sZWFufSBUcnVlIGlmIHRoZSB1c2VyIGlzIHJvb3RcbiAqIEB0aHJvd3Mge0Vycm9yfSBpZiB0aGVyZSB3YXMgYW4gZXJyb3Igd2hpbGUgaWRlbnRpZnlpbmdcbiAqIHRoZSB1c2VyLlxuICovXG5zeXN0ZW1DYWxsTWV0aG9kcy5pc1Jvb3QgPSBhc3luYyBmdW5jdGlvbiBpc1Jvb3QgKCkge1xuICByZXR1cm4gKGF3YWl0IHRoaXMuc2hlbGwoWyd3aG9hbWknXSkpLnRyaW0oKSA9PT0gJ3Jvb3QnO1xufTtcblxuLyoqXG4gKiBWZXJpZnkgd2hldGhlciBhIHJlbW90ZSBwYXRoIGV4aXN0cyBvbiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IHJlbW90ZVBhdGggLSBUaGUgcmVtb3RlIHBhdGggdG8gdmVyaWZ5LlxuICogQHJldHVybiB7Ym9vbGVhbn0gVHJ1ZSBpZiB0aGUgZ2l2ZW4gcGF0aCBleGlzdHMgb24gdGhlIGRldmljZS5cbiAqL1xuc3lzdGVtQ2FsbE1ldGhvZHMuZmlsZUV4aXN0cyA9IGFzeW5jIGZ1bmN0aW9uIGZpbGVFeGlzdHMgKHJlbW90ZVBhdGgpIHtcbiAgY29uc3QgcGFzc0ZsYWcgPSAnX19QQVNTX18nO1xuICBjb25zdCBjaGVja0NtZCA9IGBbIC1lICcke3JlbW90ZVBhdGgucmVwbGFjZSgvJy9nLCBgXFxcXCdgKX0nIF0gJiYgZWNobyAke3Bhc3NGbGFnfWA7XG4gIHRyeSB7XG4gICAgcmV0dXJuIF8uaW5jbHVkZXMoYXdhaXQgdGhpcy5zaGVsbChbY2hlY2tDbWRdKSwgcGFzc0ZsYWcpO1xuICB9IGNhdGNoIChpZ24pIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn07XG5cbi8qKlxuICogR2V0IHRoZSBvdXRwdXQgb2YgX2xzXyBjb21tYW5kIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gcmVtb3RlUGF0aCAtIFRoZSByZW1vdGUgcGF0aCAodGhlIGZpcnN0IGFyZ3VtZW50IHRvIHRoZSBfbHNfIGNvbW1hbmQpLlxuICogQHBhcmFtIHtBcnJheS48U3RyaW5nPn0gb3B0cyBbW11dIC0gQWRkaXRpb25hbCBfbHNfIG9wdGlvbnMuXG4gKiBAcmV0dXJuIHtBcnJheS48U3RyaW5nPn0gVGhlIF9sc18gb3V0cHV0IGFzIGFuIGFycmF5IG9mIHNwbGl0IGxpbmVzLlxuICogICAgICAgICAgICAgICAgICAgICAgICAgIEFuIGVtcHR5IGFycmF5IGlzIHJldHVybmVkIG9mIHRoZSBnaXZlbiBfcmVtb3RlUGF0aF9cbiAqICAgICAgICAgICAgICAgICAgICAgICAgICBkb2VzIG5vdCBleGlzdC5cbiAqL1xuc3lzdGVtQ2FsbE1ldGhvZHMubHMgPSBhc3luYyBmdW5jdGlvbiBscyAocmVtb3RlUGF0aCwgb3B0cyA9IFtdKSB7XG4gIHRyeSB7XG4gICAgbGV0IGFyZ3MgPSBbJ2xzJywgLi4ub3B0cywgcmVtb3RlUGF0aF07XG4gICAgbGV0IHN0ZG91dCA9IGF3YWl0IHRoaXMuc2hlbGwoYXJncyk7XG4gICAgbGV0IGxpbmVzID0gc3Rkb3V0LnNwbGl0KCdcXG4nKTtcbiAgICByZXR1cm4gbGluZXMubWFwKChsKSA9PiBsLnRyaW0oKSlcbiAgICAgIC5maWx0ZXIoQm9vbGVhbilcbiAgICAgIC5maWx0ZXIoKGwpID0+IGwuaW5kZXhPZignTm8gc3VjaCBmaWxlJykgPT09IC0xKTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgaWYgKGVyci5tZXNzYWdlLmluZGV4T2YoJ05vIHN1Y2ggZmlsZSBvciBkaXJlY3RvcnknKSA9PT0gLTEpIHtcbiAgICAgIHRocm93IGVycjtcbiAgICB9XG4gICAgcmV0dXJuIFtdO1xuICB9XG59O1xuXG4vKipcbiAqIEdldCB0aGUgc2l6ZSBvZiB0aGUgcGFydGljdWxhciBmaWxlIGxvY2F0ZWQgb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSByZW1vdGVQYXRoIC0gVGhlIHJlbW90ZSBwYXRoIHRvIHRoZSBmaWxlLlxuICogQHJldHVybiB7bnVtYmVyfSBGaWxlIHNpemUgaW4gYnl0ZXMuXG4gKiBAdGhyb3dzIHtFcnJvcn0gSWYgdGhlcmUgd2FzIGFuIGVycm9yIHdoaWxlIGdldHRpbmcgdGhlIHNpemUgb2YgdGhlIGdpdmVuIGZpbGUuXG4gKi9cbnN5c3RlbUNhbGxNZXRob2RzLmZpbGVTaXplID0gYXN5bmMgZnVuY3Rpb24gZmlsZVNpemUgKHJlbW90ZVBhdGgpIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBmaWxlcyA9IGF3YWl0IHRoaXMubHMocmVtb3RlUGF0aCwgWyctbGEnXSk7XG4gICAgaWYgKGZpbGVzLmxlbmd0aCAhPT0gMSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBSZW1vdGUgcGF0aCBpcyBub3QgYSBmaWxlYCk7XG4gICAgfVxuICAgIC8vIGh0dHBzOi8vcmVnZXgxMDEuY29tL3IvZk9zNFA0LzhcbiAgICBjb25zdCBtYXRjaCA9IC9bcnd4c1N0VFxcLStdezEwfVtcXHNcXGRdKlxcc1teXFxzXStcXHMrW15cXHNdK1xccysoXFxkKykvLmV4ZWMoZmlsZXNbMF0pO1xuICAgIGlmICghbWF0Y2ggfHwgXy5pc05hTihwYXJzZUludChtYXRjaFsxXSwgMTApKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmFibGUgdG8gcGFyc2Ugc2l6ZSBmcm9tIGxpc3Qgb3V0cHV0OiAnJHtmaWxlc1swXX0nYCk7XG4gICAgfVxuICAgIHJldHVybiBwYXJzZUludChtYXRjaFsxXSwgMTApO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFVuYWJsZSB0byBnZXQgZmlsZSBzaXplIGZvciAnJHtyZW1vdGVQYXRofSc6ICR7ZXJyLm1lc3NhZ2V9YCk7XG4gIH1cbn07XG5cbi8qKlxuICogSW5zdGFsbHMgdGhlIGdpdmVuIGNlcnRpZmljYXRlIG9uIGEgcm9vdGVkIHJlYWwgZGV2aWNlIG9yXG4gKiBhbiBlbXVsYXRvci4gVGhlIGVtdWxhdG9yIG11c3QgYmUgZXhlY3V0ZWQgd2l0aCBgLXdyaXRhYmxlLXN5c3RlbWBcbiAqIGNvbW1hbmQgbGluZSBvcHRpb24gYW5kIGFkYiBkYWVtb24gc2hvdWxkIGJlIHJ1bm5pbmcgaW4gcm9vdFxuICogbW9kZSBmb3IgdGhpcyBtZXRob2QgdG8gd29yayBwcm9wZXJseS4gVGhlIG1ldGhvZCBhbHNvIHJlcXVpcmVzXG4gKiBvcGVuc3NsIHRvb2wgdG8gYmUgYXZhaWxhYmxlIG9uIHRoZSBkZXN0aW5hdGlvbiBzeXN0ZW0uXG4gKiBSZWFkIGh0dHBzOi8vZ2l0aHViLmNvbS9hcHBpdW0vYXBwaXVtL2lzc3Vlcy8xMDk2NFxuICogZm9yIG1vcmUgZGV0YWlscyBvbiB0aGlzIHRvcGljXG4gKlxuICogQHBhcmFtIHtCdWZmZXJ8c3RyaW5nfSBjZXJ0IC0gYmFzZTY0LWRlY29kZWQgY29udGVudCBvZiB0aGUgYWN0dWFsIGNlcnRpZmljYXRlXG4gKiByZXByZXNlbnRlZCBhcyBhIHN0cmluZyBvciBhIGJ1ZmZlclxuICogQHRocm93cyB7RXJyb3J9IElmIG9wZW5zc2wgdG9vbCBpcyBub3QgYXZhaWxhYmxlIG9uIHRoZSBkZXN0aW5hdGlvbiBzeXN0ZW1cbiAqIG9yIGlmIHRoZXJlIHdhcyBhbiBlcnJvciB3aGlsZSBpbnN0YWxsaW5nIHRoZSBjZXJ0aWZpY2F0ZVxuICovXG5zeXN0ZW1DYWxsTWV0aG9kcy5pbnN0YWxsTWl0bUNlcnRpZmljYXRlID0gYXN5bmMgZnVuY3Rpb24gaW5zdGFsbE1pdG1DZXJ0aWZpY2F0ZSAoY2VydCkge1xuICBjb25zdCBvcGVuU3NsID0gYXdhaXQgZ2V0T3BlblNzbEZvck9zKCk7XG5cbiAgaWYgKCFfLmlzQnVmZmVyKGNlcnQpKSB7XG4gICAgY2VydCA9IEJ1ZmZlci5mcm9tKGNlcnQsICdiYXNlNjQnKTtcbiAgfVxuXG4gIGNvbnN0IHRtcFJvb3QgPSBhd2FpdCB0ZW1wRGlyLm9wZW5EaXIoKTtcbiAgdHJ5IHtcbiAgICBjb25zdCBzcmNDZXJ0ID0gcGF0aC5yZXNvbHZlKHRtcFJvb3QsICdzb3VyY2UuY2VyJyk7XG4gICAgYXdhaXQgZnMud3JpdGVGaWxlKHNyY0NlcnQsIGNlcnQpO1xuICAgIGxldCB7c3Rkb3V0fSA9IGF3YWl0IGV4ZWMob3BlblNzbCwgWyd4NTA5JywgJy1ub291dCcsICctaGFzaCcsICctaW4nLCBzcmNDZXJ0XSk7XG4gICAgY29uc3QgY2VydEhhc2ggPSBzdGRvdXQudHJpbSgpO1xuICAgIGxvZy5kZWJ1ZyhgR290IGNlcnRpZmljYXRlIGhhc2g6ICR7Y2VydEhhc2h9YCk7XG4gICAgbG9nLmRlYnVnKCdQcmVwYXJpbmcgY2VydGlmaWNhdGUgY29udGVudCcpO1xuICAgICh7c3Rkb3V0fSA9IGF3YWl0IGV4ZWMob3BlblNzbCwgWyd4NTA5JywgJy1pbicsIHNyY0NlcnRdLCB7aXNCdWZmZXI6IHRydWV9KSk7XG4gICAgbGV0IGRzdENlcnRDb250ZW50ID0gc3Rkb3V0O1xuICAgICh7c3Rkb3V0fSA9IGF3YWl0IGV4ZWMob3BlblNzbCwgWyd4NTA5JyxcbiAgICAgICctaW4nLCBzcmNDZXJ0LFxuICAgICAgJy10ZXh0JyxcbiAgICAgICctZmluZ2VycHJpbnQnLFxuICAgICAgJy1ub291dCddLCB7aXNCdWZmZXI6IHRydWV9KSk7XG4gICAgZHN0Q2VydENvbnRlbnQgPSBCdWZmZXIuY29uY2F0KFtkc3RDZXJ0Q29udGVudCwgc3Rkb3V0XSk7XG4gICAgY29uc3QgZHN0Q2VydCA9IHBhdGgucmVzb2x2ZSh0bXBSb290LCBgJHtjZXJ0SGFzaH0uMGApO1xuICAgIGF3YWl0IGZzLndyaXRlRmlsZShkc3RDZXJ0LCBkc3RDZXJ0Q29udGVudCk7XG4gICAgbG9nLmRlYnVnKCdSZW1vdW50aW5nIC9zeXN0ZW0gaW4gcncgbW9kZScpO1xuICAgIC8vIFNvbWV0aW1lcyBlbXVsYXRvciByZWJvb3QgaXMgc3RpbGwgbm90IGZ1bGx5IGZpbmlzaGVkIG9uIHRoaXMgc3RhZ2UsIHNvIHJldHJ5XG4gICAgYXdhaXQgcmV0cnlJbnRlcnZhbCg1LCAyMDAwLCBhc3luYyAoKSA9PiBhd2FpdCB0aGlzLmFkYkV4ZWMoWydyZW1vdW50J10pKTtcbiAgICBsb2cuZGVidWcoYFVwbG9hZGluZyB0aGUgZ2VuZXJhdGVkIGNlcnRpZmljYXRlIGZyb20gJyR7ZHN0Q2VydH0nIHRvICcke0NFUlRTX1JPT1R9J2ApO1xuICAgIGF3YWl0IHRoaXMucHVzaChkc3RDZXJ0LCBDRVJUU19ST09UKTtcbiAgICBsb2cuZGVidWcoJ1JlbW91bnRpbmcgL3N5c3RlbSB0byBjb25maXJtIGNoYW5nZXMnKTtcbiAgICBhd2FpdCB0aGlzLmFkYkV4ZWMoWydyZW1vdW50J10pO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCBpbmplY3QgdGhlIGN1c3RvbSBjZXJ0aWZpY2F0ZS4gYCArXG4gICAgICAgICAgICAgICAgICAgIGBJcyB0aGUgY2VydGlmaWNhdGUgcHJvcGVybHkgZW5jb2RlZCBpbnRvIGJhc2U2NC1zdHJpbmc/IGAgK1xuICAgICAgICAgICAgICAgICAgICBgRG8geW91IGhhdmUgcm9vdCBwZXJtaXNzaW9ucyBvbiB0aGUgZGV2aWNlPyBgICtcbiAgICAgICAgICAgICAgICAgICAgYE9yaWdpbmFsIGVycm9yOiAke2Vyci5tZXNzYWdlfWApO1xuICB9IGZpbmFsbHkge1xuICAgIGF3YWl0IGZzLnJpbXJhZih0bXBSb290KTtcbiAgfVxufTtcblxuLyoqXG4gKiBWZXJpZmllcyBpZiB0aGUgZ2l2ZW4gcm9vdCBjZXJ0aWZpY2F0ZSBpcyBhbHJlYWR5IGluc3RhbGxlZCBvbiB0aGUgZGV2aWNlLlxuICpcbiAqIEBwYXJhbSB7QnVmZmVyfHN0cmluZ30gY2VydCAtIGJhc2U2NC1kZWNvZGVkIGNvbnRlbnQgb2YgdGhlIGFjdHVhbCBjZXJ0aWZpY2F0ZVxuICogcmVwcmVzZW50ZWQgYXMgYSBzdHJpbmcgb3IgYSBidWZmZXJcbiAqIEB0aHJvd3Mge0Vycm9yfSBJZiBvcGVuc3NsIHRvb2wgaXMgbm90IGF2YWlsYWJsZSBvbiB0aGUgZGVzdGluYXRpb24gc3lzdGVtXG4gKiBvciBpZiB0aGVyZSB3YXMgYW4gZXJyb3Igd2hpbGUgY2hlY2tpbmcgdGhlIGNlcnRpZmljYXRlXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gdHJ1ZSBpZiB0aGUgZ2l2ZW4gY2VydGlmaWNhdGUgaXMgYWxyZWFkeSBpbnN0YWxsZWRcbiAqL1xuc3lzdGVtQ2FsbE1ldGhvZHMuaXNNaXRtQ2VydGlmaWNhdGVJbnN0YWxsZWQgPSBhc3luYyBmdW5jdGlvbiBpc01pdG1DZXJ0aWZpY2F0ZUluc3RhbGxlZCAoY2VydCkge1xuICBjb25zdCBvcGVuU3NsID0gYXdhaXQgZ2V0T3BlblNzbEZvck9zKCk7XG5cbiAgaWYgKCFfLmlzQnVmZmVyKGNlcnQpKSB7XG4gICAgY2VydCA9IEJ1ZmZlci5mcm9tKGNlcnQsICdiYXNlNjQnKTtcbiAgfVxuXG4gIGNvbnN0IHRtcFJvb3QgPSBhd2FpdCB0ZW1wRGlyLm9wZW5EaXIoKTtcbiAgbGV0IGNlcnRIYXNoO1xuICB0cnkge1xuICAgIGNvbnN0IHRtcENlcnQgPSBwYXRoLnJlc29sdmUodG1wUm9vdCwgJ3NvdXJjZS5jZXInKTtcbiAgICBhd2FpdCBmcy53cml0ZUZpbGUodG1wQ2VydCwgY2VydCk7XG4gICAgY29uc3Qge3N0ZG91dH0gPSBhd2FpdCBleGVjKG9wZW5Tc2wsIFsneDUwOScsICctbm9vdXQnLCAnLWhhc2gnLCAnLWluJywgdG1wQ2VydF0pO1xuICAgIGNlcnRIYXNoID0gc3Rkb3V0LnRyaW0oKTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgcmV0cmlldmUgdGhlIGNlcnRpZmljYXRlIGhhc2guIGAgK1xuICAgICAgICAgICAgICAgICAgICBgSXMgdGhlIGNlcnRpZmljYXRlIHByb3Blcmx5IGVuY29kZWQgaW50byBiYXNlNjQtc3RyaW5nPyBgICtcbiAgICAgICAgICAgICAgICAgICAgYE9yaWdpbmFsIGVycm9yOiAke2Vyci5tZXNzYWdlfWApO1xuICB9IGZpbmFsbHkge1xuICAgIGF3YWl0IGZzLnJpbXJhZih0bXBSb290KTtcbiAgfVxuICBjb25zdCBkc3RQYXRoID0gcGF0aC5wb3NpeC5yZXNvbHZlKENFUlRTX1JPT1QsIGAke2NlcnRIYXNofS4wYCk7XG4gIGxvZy5kZWJ1ZyhgQ2hlY2tpbmcgaWYgdGhlIGNlcnRpZmljYXRlIGlzIGFscmVhZHkgaW5zdGFsbGVkIGF0ICcke2RzdFBhdGh9J2ApO1xuICByZXR1cm4gYXdhaXQgdGhpcy5maWxlRXhpc3RzKGRzdFBhdGgpO1xufTtcblxuZXhwb3J0IGRlZmF1bHQgc3lzdGVtQ2FsbE1ldGhvZHM7XG5leHBvcnQgeyBERUZBVUxUX0FEQl9FWEVDX1RJTUVPVVQsIGdldEFuZHJvaWRCaW5hcnlQYXRoIH07XG4iXSwiZmlsZSI6ImxpYi90b29scy9zeXN0ZW0tY2FsbHMuanMiLCJzb3VyY2VSb290IjoiLi4vLi4vLi4ifQ==
