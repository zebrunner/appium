'use strict';

// The Playwright versions of the driver: a client connects only to a server of its major.minor version (Playwright
// checks User-Agent), so the driver serves the version of the client. The one of the image is bundled, the others are
// installed on the first connection into PLAYWRIGHT_CACHE_DIR (the volume of the apps, shared by the devices of a host).
// The APKs of the Android driver of a version go to PLAYWRIGHT_BROWSERS_PATH of the container, not to the shared cache:
// a container that finds a version in the cache installs its APKs once.

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// "Playwright/1.65.0 (arm64; macOS 15.0) node/24.0" -> 1.65.0; a pre-release keeps its suffix
const USER_AGENT = /^Playwright\/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
// the versions whose APKs are in PLAYWRIGHT_BROWSERS_PATH of this container
const CONTAINER_APKS = new Set();

/**
 * @param {string|undefined} userAgent the User-Agent of a Playwright client
 * @returns {string|null} the Playwright version of the client, null for another client
 */
function clientVersion(userAgent) {
  const match = USER_AGENT.exec(userAgent ?? '');
  return match ? match[1] : null;
}

/** @returns {string} major.minor of a version */
function minor(version) {
  return version.split('.').slice(0, 2).join('.');
}

class PlaywrightVersions {
  /**
   * @param {object} opts
   * @param {string} [opts.cacheDir] where the other versions are installed, none without it
   * @param {(cmd: string, args: string[], env: object) => Promise<void>} [opts.run] runs a command (tests)
   * @param {{info: Function, warn: Function}} [opts.log]
   * @param {Set<string>} [opts.apks] the versions whose APKs the container has (tests)
   */
  constructor({cacheDir, run = runCommand, log = console, apks = CONTAINER_APKS} = {}) {
    this.cacheDir = cacheDir;
    this.run = run;
    this.log = log;
    this.apks = apks;
    this.bundled = require('playwright-core/package.json').version;
    /** @type {Map<string, Promise<string>>} version -> the dir of its playwright-core, installs in progress */
    this.installs = new Map();
  }

  /**
   * @param {string|null} wanted the version of the client, the bundled one when null
   * @returns {Promise<{version: string, playwright: object}>} playwright-core of the major.minor of the version
   */
  async load(wanted) {
    if (!wanted || minor(wanted) === minor(this.bundled)) {
      return {version: this.bundled, playwright: require('playwright-core')};
    }
    if (!VERSION.test(wanted)) {
      throw new Error(`'${wanted}' is not a Playwright version`);
    }
    if (!this.cacheDir) {
      throw new Error(`Playwright ${wanted} is not available on the device host: only ${this.bundled} is, ` +
        `use Playwright ${minor(this.bundled)} in the tests`);
    }
    let install = this.installs.get(wanted);
    if (!install) {
      install = this.install(wanted).finally(() => this.installs.delete(wanted));
      this.installs.set(wanted, install);
    }
    const dir = await install;
    return {version: wanted, playwright: require(dir)};
  }

  /** @returns {Promise<string>} the dir of the installed playwright-core of the version */
  async install(version) {
    const target = path.join(this.cacheDir, version);
    const module = path.join(target, 'node_modules', 'playwright-core');
    if (fs.existsSync(path.join(target, '.complete'))) {
      await this.installApks(version, module);
      return module;
    }
    // installed beside and renamed: another device of the host may install the same version at the same time
    const temp = `${target}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    this.log.info(`[MCLOUD] Installing Playwright ${version} for the clients of that version into ${target}`);
    try {
      fs.mkdirSync(temp, {recursive: true});
      await this.run('npm', ['install', '--prefix', temp, '--no-save', '--no-package-lock', '--no-audit', '--no-fund',
        '--loglevel=error', `playwright-core@${version}`], process.env);
      // the APKs of the Playwright driver of the device, into PLAYWRIGHT_BROWSERS_PATH
      await this.run(process.execPath, [path.join(temp, 'node_modules', 'playwright-core', 'cli.js'), 'install', 'android'],
        process.env);
      this.apks.add(version);
      fs.writeFileSync(path.join(temp, '.complete'), new Date().toISOString());
      try {
        fs.renameSync(temp, target);
      } catch (err) {
        if (!fs.existsSync(path.join(target, '.complete'))) {
          throw err;
        }
      }
    } catch (err) {
      throw this.installError(version, err);
    } finally {
      fs.rmSync(temp, {recursive: true, force: true});
    }
    this.log.info(`[MCLOUD] Playwright ${version} is installed`);
    return module;
  }

  /** the APKs of a version of the cache, into PLAYWRIGHT_BROWSERS_PATH of this container once (the ones there are kept) */
  async installApks(version, module) {
    if (this.apks.has(version)) {
      return;
    }
    this.log.info(`[MCLOUD] Installing the Android driver APKs of Playwright ${version} into this container`);
    try {
      await this.run(process.execPath, [path.join(module, 'cli.js'), 'install', 'android'], process.env);
    } catch (err) {
      throw this.installError(version, err);
    }
    this.apks.add(version);
  }

  installError(version, err) {
    return new Error(`Playwright ${version} could not be installed on the device host (${err.message}): ` +
      `use Playwright ${minor(this.bundled)} in the tests, the version of the farm`);
  }
}

function runCommand(cmd, args, env) {
  return new Promise((resolve, reject) => {
    childProcess.execFile(cmd, args, {env, timeout: INSTALL_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024}, (err, stdout, stderr) => {
      if (err) {
        const output = `${stderr}${stdout}`.trim().split('\n').slice(-5).join(' ');
        reject(new Error(`${path.basename(cmd)} ${args.slice(0, 2).join(' ')} failed: ${output || err.message}`));
      } else {
        resolve();
      }
    });
  });
}

module.exports = {PlaywrightVersions, clientVersion, minor};
