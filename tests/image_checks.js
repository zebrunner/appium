// Checks of the Appium installation inside the image, run by tests/image_test.sh with node in a container of the
// image (APPIUM_HOME is set by the image). They catch the changes of a new base image, Appium or driver release
// that would silently break the image: the patch not loaded, an incompatible driver, renamed capabilities or
// insecure features, a changed minimum Android version.
//
// Usage: node image_checks.js <check> [args...]; prints one line per result:
//   ok\t<description>   or   fail\t<description>\t<details, \n escaped>
//
//   extensions <drivers json> <plugins json>  the installed drivers and plugins (`appium <type> list --installed --json`)
//   caps <driver name> <caps json file>       the generated default capabilities are known to the driver, with valid types
//   features <feature...>                     every insecure feature enabled by the entrypoint is used by a driver
//   min-android                               the minimum Android major version of the UiAutomator2 driver (prints the number)
'use strict';

const fs = require('fs');
const path = require('path');

const APPIUM_HOME = process.env.APPIUM_HOME;
if (!APPIUM_HOME) {
  console.log('fail\tAPPIUM_HOME is set\tAPPIUM_HOME is empty in the image');
  process.exit(0);
}
const modules = path.join(APPIUM_HOME, 'node_modules');
const req = (id) => require(require.resolve(id, {paths: [modules]}));
const BASE_DRIVER_DIR = path.join(modules, '@appium', 'base-driver');

const report = (passed, description, details = '') =>
  console.log(passed ? `ok\t${description}` : `fail\t${description}\t${String(details).replace(/\n/g, '\\n')}`);

// runs fn while the console output is collected, returns the output
function captureOutput(fn) {
  let output = '';
  const writes = [process.stdout.write, process.stderr.write];
  process.stdout.write = process.stderr.write = (chunk, ...rest) => {
    output += chunk;
    const callback = rest.find((arg) => typeof arg === 'function');
    if (callback) {
      callback();
    }
    return true;
  };
  try {
    fn();
  } catch (err) {
    output += `\nError: ${err.message}`;
  } finally {
    [process.stdout.write, process.stderr.write] = writes;
  }
  return output;
}

function checkExtensions(driversFile, pluginsFile) {
  const semver = req('semver');
  const appiumVersion = req('appium/package.json').version;
  const baseDriver = require(BASE_DRIVER_DIR);
  const patchedHelpers = require(path.join(BASE_DRIVER_DIR, 'build', 'lib', 'basedriver', 'helpers.js'));
  const drivers = JSON.parse(fs.readFileSync(driversFile, 'utf8'));
  const plugins = JSON.parse(fs.readFileSync(pluginsFile, 'utf8'));

  for (const [type, extensions] of [['driver', drivers], ['plugin', plugins]]) {
    for (const [name, ext] of Object.entries(extensions)) {
      report(
        path.resolve(ext.installPath).startsWith(path.resolve(modules) + path.sep),
        `the ${name} ${type} is installed in APPIUM_HOME`,
        `installed in ${ext.installPath}, APPIUM_HOME is ${APPIUM_HOME}`
      );
      report(
        Boolean(ext.appiumVersion) && semver.satisfies(appiumVersion, ext.appiumVersion, {includePrerelease: true}),
        `the ${name} ${type} ${ext.version} supports Appium ${appiumVersion}`,
        `it needs appium ${ext.appiumVersion}`
      );
    }
  }

  // the MCloud features of the patch (recording markers, shared app storage) work only when the drivers use the
  // patched base driver, not a copy of their own
  for (const [name, ext] of Object.entries(drivers)) {
    let DriverClass;
    try {
      DriverClass = require(ext.installPath)[ext.mainClass];
    } catch (err) {
      report(false, `the ${name} driver loads`, err.message);
      continue;
    }
    let proto = DriverClass?.prototype;
    while (proto && proto.constructor.name !== 'BaseDriver') {
      proto = Object.getPrototypeOf(proto);
    }
    report(
      proto === baseDriver.BaseDriver.prototype,
      `the ${name} driver extends the patched BaseDriver`,
      proto ? 'it extends a BaseDriver of another @appium/base-driver copy' : 'no BaseDriver in its class chain'
    );
    let configureApp;
    captureOutput(() => {
      configureApp = new DriverClass({}).helpers?.configureApp;
    });
    report(
      configureApp === patchedHelpers.configureApp,
      `the ${name} driver configures apps with the patched helpers (shared app storage)`,
      'driver.helpers.configureApp is not the one of the patched @appium/base-driver'
    );
  }
}

function checkCaps(driverName, capsFile) {
  const drivers = JSON.parse(fs.readFileSync(0, 'utf8'));
  const ext = drivers[driverName];
  if (!ext) {
    report(false, `the ${driverName} driver is installed`, `installed: ${Object.keys(drivers).join(', ')}`);
    return;
  }
  const {BASE_DESIRED_CAP_CONSTRAINTS} = req('@appium/types');
  const {STANDARD_CAPS} = require(BASE_DRIVER_DIR);
  const caps = JSON.parse(fs.readFileSync(capsFile, 'utf8'));
  const plain = Object.fromEntries(Object.entries(caps).map(([key, value]) => [key.replace(/^appium:/, ''), value]));

  let driver;
  captureOutput(() => {
    driver = new (require(ext.installPath)[ext.mainClass])({});
  });
  const known = new Set([
    ...Object.keys(driver.desiredCapConstraints ?? {}),
    ...Object.keys(BASE_DESIRED_CAP_CONSTRAINTS ?? {}),
    ...STANDARD_CAPS,
  ]);
  const unknown = Object.keys(plain).filter((key) => !known.has(key));
  report(unknown.length === 0, `the default caps are known to the ${driverName} driver`, `unknown caps: ${unknown.join(', ')}`);

  const output = captureOutput(() => driver.validateDesiredCaps(plain));
  const problems = output.split('\n').filter((line) => /as string|Error|not valid|must be/.test(line));
  report(problems.length === 0, `the default caps are valid for the ${driverName} driver`, problems.join('\n'));
}

// files under dir whose content contains text
function findText(dir, text, found = [], depth = 0) {
  if (depth > 12 || found.length > 0) {
    return found;
  }
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findText(full, text, found, depth + 1);
    } else if (entry.name.endsWith('.js') && fs.readFileSync(full, 'utf8').includes(text)) {
      found.push(full);
    }
  }
  return found;
}

function checkFeatures(features) {
  const drivers = JSON.parse(fs.readFileSync(0, 'utf8'));
  for (const feature of features) {
    const users = Object.entries(drivers).filter(([, ext]) => findText(ext.installPath, `'${feature}'`).length > 0
      || findText(ext.installPath, `"${feature}"`).length > 0);
    report(
      users.length > 0,
      `the insecure feature ${feature} is used by a driver`,
      `no installed driver mentions '${feature}': the --allow-insecure of the entrypoint enables nothing`
    );
  }
}

// the Android major version of an API level
const ANDROID_OF_API = {21: 5, 22: 5, 23: 6, 24: 7, 25: 7, 26: 8, 27: 8, 28: 9, 29: 10, 30: 11, 31: 12, 32: 12, 33: 13, 34: 14,
  35: 15, 36: 16};

function minAndroid() {
  const drivers = JSON.parse(fs.readFileSync(0, 'utf8'));
  const ext = drivers.uiautomator2;
  const matches = ext ? findText(path.join(ext.installPath, 'build'), 'MIN_SUPPORTED_API_LEVEL') : [];
  const level = matches.length ? fs.readFileSync(matches[0], 'utf8').match(/MIN_SUPPORTED_API_LEVEL\s*=\s*(\d+)/)?.[1] : undefined;
  console.log(level && ANDROID_OF_API[level] ? ANDROID_OF_API[level] : `unknown (API level ${level})`);
}

const [check, ...args] = process.argv.slice(2);
const checks = {
  extensions: () => checkExtensions(...args),
  caps: () => checkCaps(...args),
  features: () => checkFeatures(args),
  'min-android': minAndroid,
};
if (checks[check]) {
  checks[check]();
} else {
  report(false, `the image check ${check} exists`, `checks: ${Object.keys(checks).join(', ')}`);
}
