"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault");

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.configureApp = configureApp;
exports.duplicateKeys = duplicateKeys;
exports.isPackageOrBundle = isPackageOrBundle;
exports.parseCapsArray = parseCapsArray;

require("source-map-support/register");

var _lodash = _interopRequireDefault(require("lodash"));

var _path = _interopRequireDefault(require("path"));

var _url = _interopRequireDefault(require("url"));

var _logger = _interopRequireDefault(require("./logger"));

var _appiumSupport = require("appium-support");

var _lruCache = _interopRequireDefault(require("lru-cache"));

var _asyncLock = _interopRequireDefault(require("async-lock"));

var _axios = _interopRequireDefault(require("axios"));

var _mcloudUtils = require("./mcloud-utils");

const IPA_EXT = '.ipa';
const ZIP_EXTS = ['.zip', IPA_EXT];
const ZIP_MIME_TYPES = ['application/zip', 'application/x-zip-compressed', 'multipart/x-zip'];
const CACHED_APPS_MAX_AGE = 1000 * 60 * 60 * 24;
const APPLICATIONS_CACHE = new _lruCache.default({
  maxAge: CACHED_APPS_MAX_AGE,
  updateAgeOnGet: true,
  dispose: async (app, {
    fullPath
  }) => {
    if (!(await _appiumSupport.fs.exists(fullPath))) {
      return;
    }

    _logger.default.info(`The application '${app}' cached at '${fullPath}' has expired`);

    await _appiumSupport.fs.rimraf(fullPath);
  },
  noDisposeOnSet: true
});
const APPLICATIONS_CACHE_GUARD = new _asyncLock.default();
const SANITIZE_REPLACEMENT = '-';
const DEFAULT_BASENAME = 'appium-app';
const APP_DOWNLOAD_TIMEOUT_MS = 120 * 1000;
process.on('exit', () => {
  if (APPLICATIONS_CACHE.itemCount === 0) {
    return;
  }

  const appPaths = APPLICATIONS_CACHE.values().map(({
    fullPath
  }) => fullPath);

  _logger.default.debug(`Performing cleanup of ${appPaths.length} cached ` + _appiumSupport.util.pluralize('application', appPaths.length));

  for (const appPath of appPaths) {
    try {
      _appiumSupport.fs.rimrafSync(appPath);
    } catch (e) {
      _logger.default.warn(e.message);
    }
  }
});

async function retrieveHeaders(link) {
  try {
    return (await (0, _axios.default)({
      url: link,
      method: 'HEAD',
      timeout: 5000
    })).headers;
  } catch (e) {
    _logger.default.info(`Cannot send HEAD request to '${link}'. Original error: ${e.message}`);
  }

  return {};
}

function getCachedApplicationPath(link, currentAppProps = {}) {
  const refresh = () => {
    _logger.default.info(`CUSTOM HELPER!`);

    _logger.default.debug(`A fresh copy of the application is going to be downloaded from ${link}`);

    return null;
  };

  if (APPLICATIONS_CACHE.has(link)) {
    const {
      lastModified: currentModified,
      immutable: currentImmutable,
      maxAge: currentMaxAge
    } = currentAppProps;
    const {
      lastModified,
      immutable,
      timestamp,
      fullPath
    } = APPLICATIONS_CACHE.get(link);

    if (lastModified && currentModified) {
      if (currentModified.getTime() <= lastModified.getTime()) {
        _logger.default.debug(`The application at ${link} has not been modified since ${lastModified}`);

        return fullPath;
      }

      _logger.default.debug(`The application at ${link} has been modified since ${lastModified}`);

      return refresh();
    }

    if (immutable && currentImmutable) {
      _logger.default.debug(`The application at ${link} is immutable`);

      return fullPath;
    }

    if (currentMaxAge && timestamp) {
      const msLeft = timestamp + currentMaxAge * 1000 - Date.now();

      if (msLeft > 0) {
        _logger.default.debug(`The cached application '${_path.default.basename(fullPath)}' will expire in ${msLeft / 1000}s`);

        return fullPath;
      }

      _logger.default.debug(`The cached application '${_path.default.basename(fullPath)}' has expired`);
    }
  }

  return refresh();
}

function verifyAppExtension(app, supportedAppExtensions) {
  if (supportedAppExtensions.includes(_path.default.extname(app))) {
    return app;
  }

  throw new Error(`New app path '${app}' did not have ` + `${_appiumSupport.util.pluralize('extension', supportedAppExtensions.length, false)}: ` + supportedAppExtensions);
}

async function configureApp(app, supportedAppExtensions) {
  if (!_lodash.default.isString(app)) {
    return;
  }

  if (!_lodash.default.isArray(supportedAppExtensions)) {
    supportedAppExtensions = [supportedAppExtensions];
  }

  let newApp = app;
  let shouldUnzipApp = false;
  let archiveHash = null;
  let localAppsFolder;
  const remoteAppProps = {
    lastModified: null,
    immutable: false,
    maxAge: null
  };

  const {
    protocol,
    pathname
  } = _url.default.parse(newApp);

  const isUrl = ['http:', 'https:'].includes(protocol);
  return await APPLICATIONS_CACHE_GUARD.acquire(app, async () => {
    if (isUrl) {
      _logger.default.info(`Using downloadable app '${newApp}'`);

      const headers = await retrieveHeaders(newApp);

      if (!_lodash.default.isEmpty(headers)) {
        if (headers['last-modified']) {
          remoteAppProps.lastModified = new Date(headers['last-modified']);
        }

        _logger.default.debug(`Last-Modified: ${headers['last-modified']}`);

        if (headers['cache-control']) {
          remoteAppProps.immutable = /\bimmutable\b/i.test(headers['cache-control']);
          const maxAgeMatch = /\bmax-age=(\d+)\b/i.exec(headers['cache-control']);

          if (maxAgeMatch) {
            remoteAppProps.maxAge = parseInt(maxAgeMatch[1], 10);
          }
        }

        _logger.default.debug(`Cache-Control: ${headers['cache-control']}`);
      }

      let downloadIsNeaded = true;
      localAppsFolder = await (0, _mcloudUtils.getLocalAppsFolder)();
      let localFile;
      let lockFile;
      const waitingTime = 5000;
      const maxAttemptsCount = 5 * 12;

      if (localAppsFolder != undefined) {
        localFile = await (0, _mcloudUtils.getLocalFileForAppUrl)(newApp);
        lockFile = localFile + '.lock';

        if (await _appiumSupport.fs.exists(localFile)) {
          _logger.default.info(`Local version of app was found. Will check actuality of the file`);

          const remoteFileLength = await (0, _mcloudUtils.getFileContentLength)(app);
          let attemptsCount = 0;

          while (!(await _appiumSupport.fs.exists(localFile)) && attemptsCount++ < maxAttemptsCount) {
            await new Promise(resolve => {
              _logger.default.info(`Attempt #${attemptsCount} for local app file to appear again`);

              setTimeout(resolve, waitingTime);
            });
          }

          if (!(await _appiumSupport.fs.exists(localFile))) {
            throw Error(`Local application file has not appeared after updating by parallel Appium session`);
          }

          const stats = await _appiumSupport.fs.stat(localFile);
          const localFileLength = stats.size;

          _logger.default.info(`Remote file size is ${remoteFileLength} and local file size is ${localFileLength}`);

          if (remoteFileLength != localFileLength) {
            _logger.default.info(`Sizes differ. Hence that's needed to download fresh version of the app`);

            await _appiumSupport.fs.unlink(localFile);
            downloadIsNeaded = true;
          } else {
            _logger.default.info(`Sizes are the same. Hence will use already stored application for the session`);

            newApp = localFile;
            shouldUnzipApp = ZIP_EXTS.includes(_path.default.extname(newApp));
            downloadIsNeaded = false;
          }
        } else if (await _appiumSupport.fs.exists(lockFile)) {
          _logger.default.info(`Local version of app not found but .lock file exists. Waiting for .lock to disappear`);

          let attemptsCount = 0;

          while ((await _appiumSupport.fs.exists(lockFile)) && attemptsCount++ < maxAttemptsCount) {
            await new Promise(resolve => {
              _logger.default.info(`Attempt #${attemptsCount} for .lock file checking`);

              setTimeout(resolve, waitingTime);
            });
          }

          if (await _appiumSupport.fs.exists(lockFile)) {
            throw Error(`.lock file for downloading application has not disappeared after ${waitingTime * maxAttemptsCount}ms`);
          }

          if (!(await _appiumSupport.fs.exists(localFile))) {
            throw Error(`Local application file has not appeared after .lock file removal`);
          }

          _logger.default.info(`Local version of app was found after .lock file removal. Will use it for new session`);

          newApp = localFile;
          shouldUnzipApp = ZIP_EXTS.includes(_path.default.extname(newApp));
          downloadIsNeaded = false;
        } else {
          _logger.default.info(`Neither local version of app nor .lock file was found. Will download app from remote URL.`);

          downloadIsNeaded = true;
        }
      } else {
        _logger.default.info(`Local apps folder is not defined via environment properties, hence skipping this logic`);
      }

      if (downloadIsNeaded) {
        if (localAppsFolder != undefined) {
          _logger.default.info(`Local version of app was not found. Hence using default Appium logic for downloading`);

          const sharedFolderPath = await (0, _mcloudUtils.getSharedFolderForAppUrl)(app);

          _logger.default.info(`Folder for local shared apps: ${sharedFolderPath}`);

          await _appiumSupport.fs.close(await _appiumSupport.fs.open(lockFile, 'w'));
        }

        try {
          const cachedPath = getCachedApplicationPath(app, remoteAppProps);

          if (cachedPath) {
            if (await _appiumSupport.fs.exists(cachedPath)) {
              _logger.default.info(`Reusing previously downloaded application at '${cachedPath}'`);

              return verifyAppExtension(cachedPath, supportedAppExtensions);
            }

            _logger.default.info(`The application at '${cachedPath}' does not exist anymore. Deleting it from the cache`);

            APPLICATIONS_CACHE.del(app);
          }

          let fileName = null;

          const basename = _appiumSupport.fs.sanitizeName(_path.default.basename(decodeURIComponent(pathname)), {
            replacement: SANITIZE_REPLACEMENT
          });

          const extname = _path.default.extname(basename);

          if (ZIP_EXTS.includes(extname)) {
            fileName = basename;
            shouldUnzipApp = true;
          }

          if (headers['content-type']) {
            const ct = headers['content-type'];

            _logger.default.debug(`Content-Type: ${ct}`);

            if (ZIP_MIME_TYPES.some(mimeType => new RegExp(`\\b${_lodash.default.escapeRegExp(mimeType)}\\b`).test(ct))) {
              if (!fileName) {
                fileName = `${DEFAULT_BASENAME}.zip`;
              }

              shouldUnzipApp = true;
            }
          }

          if (headers['content-disposition'] && /^attachment/i.test(headers['content-disposition'])) {
            _logger.default.debug(`Content-Disposition: ${headers['content-disposition']}`);

            const match = /filename="([^"]+)/i.exec(headers['content-disposition']);

            if (match) {
              fileName = _appiumSupport.fs.sanitizeName(match[1], {
                replacement: SANITIZE_REPLACEMENT
              });
              shouldUnzipApp = shouldUnzipApp || ZIP_EXTS.includes(_path.default.extname(fileName));
            }
          }

          if (!fileName) {
            const resultingName = basename ? basename.substring(0, basename.length - extname.length) : DEFAULT_BASENAME;
            let resultingExt = extname;

            if (!supportedAppExtensions.includes(resultingExt)) {
              _logger.default.info(`The current file extension '${resultingExt}' is not supported. ` + `Defaulting to '${_lodash.default.first(supportedAppExtensions)}'`);

              resultingExt = _lodash.default.first(supportedAppExtensions);
            }

            fileName = `${resultingName}${resultingExt}`;
          }

          const targetPath = await _appiumSupport.tempDir.path({
            prefix: fileName,
            suffix: ''
          });
          newApp = await downloadApp(newApp, targetPath);

          if (localAppsFolder != undefined) {
            _logger.default.info(`New app path: ${newApp}`);

            await _appiumSupport.fs.copyFile(newApp, localFile);
          }
        } finally {
          if (localAppsFolder != undefined) {
            _logger.default.info(`Going to remove lock file ${lockFile}`);

            await _appiumSupport.fs.unlink(lockFile);
          }
        }
      }
    } else if (await _appiumSupport.fs.exists(newApp)) {
      _logger.default.info(`Using local app '${newApp}'`);

      shouldUnzipApp = ZIP_EXTS.includes(_path.default.extname(newApp));
    } else {
      let errorMessage = `The application at '${newApp}' does not exist or is not accessible`;

      if (_lodash.default.isString(protocol) && protocol.length > 2) {
        errorMessage = `The protocol '${protocol}' used in '${newApp}' is not supported. ` + `Only http: and https: protocols are supported`;
      }

      throw new Error(errorMessage);
    }

    if (shouldUnzipApp) {
      const archivePath = newApp;
      archiveHash = await _appiumSupport.fs.hash(archivePath);

      if (APPLICATIONS_CACHE.has(app) && archiveHash === APPLICATIONS_CACHE.get(app).hash) {
        const {
          fullPath
        } = APPLICATIONS_CACHE.get(app);

        if (await _appiumSupport.fs.exists(fullPath)) {
          if (archivePath !== app && localAppsFolder === undefined) {
            await _appiumSupport.fs.rimraf(archivePath);
          }

          _logger.default.info(`Will reuse previously cached application at '${fullPath}'`);

          return verifyAppExtension(fullPath, supportedAppExtensions);
        }

        _logger.default.info(`The application at '${fullPath}' does not exist anymore. Deleting it from the cache`);

        APPLICATIONS_CACHE.del(app);
      }

      const tmpRoot = await _appiumSupport.tempDir.openDir();

      try {
        newApp = await unzipApp(archivePath, tmpRoot, supportedAppExtensions);
      } finally {
        if (newApp !== archivePath && archivePath !== app && localAppsFolder === undefined) {
          await _appiumSupport.fs.rimraf(archivePath);
        }
      }

      _logger.default.info(`Unzipped local app to '${newApp}'`);
    } else if (!_path.default.isAbsolute(newApp)) {
      newApp = _path.default.resolve(process.cwd(), newApp);

      _logger.default.warn(`The current application path '${app}' is not absolute ` + `and has been rewritten to '${newApp}'. Consider using absolute paths rather than relative`);

      app = newApp;
    }

    verifyAppExtension(newApp, supportedAppExtensions);

    if (app !== newApp && (archiveHash || _lodash.default.values(remoteAppProps).some(Boolean))) {
      if (APPLICATIONS_CACHE.has(app)) {
        const {
          fullPath
        } = APPLICATIONS_CACHE.get(app);

        if (fullPath !== newApp && (await _appiumSupport.fs.exists(fullPath))) {
          await _appiumSupport.fs.rimraf(fullPath);
        }
      }

      APPLICATIONS_CACHE.set(app, { ...remoteAppProps,
        timestamp: Date.now(),
        hash: archiveHash,
        fullPath: newApp
      });
    }

    return newApp;
  });
}

async function downloadApp(app, targetPath) {
  const {
    href
  } = _url.default.parse(app);

  try {
    await _appiumSupport.net.downloadFile(href, targetPath, {
      timeout: APP_DOWNLOAD_TIMEOUT_MS
    });
  } catch (err) {
    throw new Error(`Unable to download the app: ${err.message}`);
  }

  return targetPath;
}

async function unzipApp(zipPath, dstRoot, supportedAppExtensions) {
  await _appiumSupport.zip.assertValidZip(zipPath);

  if (!_lodash.default.isArray(supportedAppExtensions)) {
    supportedAppExtensions = [supportedAppExtensions];
  }

  const tmpRoot = await _appiumSupport.tempDir.openDir();

  try {
    _logger.default.debug(`Unzipping '${zipPath}'`);

    const timer = new _appiumSupport.timing.Timer().start();
    const useSystemUnzipEnv = process.env.APPIUM_PREFER_SYSTEM_UNZIP;
    const useSystemUnzip = _lodash.default.isEmpty(useSystemUnzipEnv) || !['0', 'false'].includes(_lodash.default.toLower(useSystemUnzipEnv));
    const extractionOpts = {
      useSystemUnzip
    };

    if (_path.default.extname(zipPath) === IPA_EXT) {
      _logger.default.debug(`Enforcing UTF-8 encoding on the extracted file names for '${_path.default.basename(zipPath)}'`);

      extractionOpts.fileNamesEncoding = 'utf8';
    }

    await _appiumSupport.zip.extractAllTo(zipPath, tmpRoot, extractionOpts);
    const globPattern = `**/*.+(${supportedAppExtensions.map(ext => ext.replace(/^\./, '')).join('|')})`;
    const sortedBundleItems = (await _appiumSupport.fs.glob(globPattern, {
      cwd: tmpRoot,
      strict: false
    })).sort((a, b) => a.split(_path.default.sep).length - b.split(_path.default.sep).length);

    if (_lodash.default.isEmpty(sortedBundleItems)) {
      _logger.default.errorAndThrow(`App unzipped OK, but we could not find any '${supportedAppExtensions}' ` + _appiumSupport.util.pluralize('bundle', supportedAppExtensions.length, false) + ` in it. Make sure your archive contains at least one package having ` + `'${supportedAppExtensions}' ${_appiumSupport.util.pluralize('extension', supportedAppExtensions.length, false)}`);
    }

    _logger.default.debug(`Extracted ${_appiumSupport.util.pluralize('bundle item', sortedBundleItems.length, true)} ` + `from '${zipPath}' in ${Math.round(timer.getDuration().asMilliSeconds)}ms: ${sortedBundleItems}`);

    const matchedBundle = _lodash.default.first(sortedBundleItems);

    _logger.default.info(`Assuming '${matchedBundle}' is the correct bundle`);

    const dstPath = _path.default.resolve(dstRoot, _path.default.basename(matchedBundle));

    await _appiumSupport.fs.mv(_path.default.resolve(tmpRoot, matchedBundle), dstPath, {
      mkdirp: true
    });
    return dstPath;
  } finally {
    await _appiumSupport.fs.rimraf(tmpRoot);
  }
}

function isPackageOrBundle(app) {
  return /^([a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+)+$/.test(app);
}

function duplicateKeys(input, firstKey, secondKey) {
  if (_lodash.default.isArray(input)) {
    return input.map(item => duplicateKeys(item, firstKey, secondKey));
  }

  if (_lodash.default.isPlainObject(input)) {
    const resultObj = {};

    for (let [key, value] of _lodash.default.toPairs(input)) {
      const recursivelyCalledValue = duplicateKeys(value, firstKey, secondKey);

      if (key === firstKey) {
        resultObj[secondKey] = recursivelyCalledValue;
      } else if (key === secondKey) {
        resultObj[firstKey] = recursivelyCalledValue;
      }

      resultObj[key] = recursivelyCalledValue;
    }

    return resultObj;
  }

  return input;
}

function parseCapsArray(cap) {
  if (_lodash.default.isArray(cap)) {
    return cap;
  }

  let parsedCaps;

  try {
    parsedCaps = JSON.parse(cap);

    if (_lodash.default.isArray(parsedCaps)) {
      return parsedCaps;
    }
  } catch (ign) {
    _logger.default.warn(`Failed to parse capability as JSON array`);
  }

  if (_lodash.default.isString(cap)) {
    return [cap];
  }

  throw new Error(`must provide a string or JSON Array; received ${cap}`);
}require('source-map-support').install();


//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImxpYi9iYXNlZHJpdmVyL2hlbHBlcnMuanMiXSwibmFtZXMiOlsiSVBBX0VYVCIsIlpJUF9FWFRTIiwiWklQX01JTUVfVFlQRVMiLCJDQUNIRURfQVBQU19NQVhfQUdFIiwiQVBQTElDQVRJT05TX0NBQ0hFIiwiTFJVIiwibWF4QWdlIiwidXBkYXRlQWdlT25HZXQiLCJkaXNwb3NlIiwiYXBwIiwiZnVsbFBhdGgiLCJmcyIsImV4aXN0cyIsImxvZ2dlciIsImluZm8iLCJyaW1yYWYiLCJub0Rpc3Bvc2VPblNldCIsIkFQUExJQ0FUSU9OU19DQUNIRV9HVUFSRCIsIkFzeW5jTG9jayIsIlNBTklUSVpFX1JFUExBQ0VNRU5UIiwiREVGQVVMVF9CQVNFTkFNRSIsIkFQUF9ET1dOTE9BRF9USU1FT1VUX01TIiwicHJvY2VzcyIsIm9uIiwiaXRlbUNvdW50IiwiYXBwUGF0aHMiLCJ2YWx1ZXMiLCJtYXAiLCJkZWJ1ZyIsImxlbmd0aCIsInV0aWwiLCJwbHVyYWxpemUiLCJhcHBQYXRoIiwicmltcmFmU3luYyIsImUiLCJ3YXJuIiwibWVzc2FnZSIsInJldHJpZXZlSGVhZGVycyIsImxpbmsiLCJ1cmwiLCJtZXRob2QiLCJ0aW1lb3V0IiwiaGVhZGVycyIsImdldENhY2hlZEFwcGxpY2F0aW9uUGF0aCIsImN1cnJlbnRBcHBQcm9wcyIsInJlZnJlc2giLCJoYXMiLCJsYXN0TW9kaWZpZWQiLCJjdXJyZW50TW9kaWZpZWQiLCJpbW11dGFibGUiLCJjdXJyZW50SW1tdXRhYmxlIiwiY3VycmVudE1heEFnZSIsInRpbWVzdGFtcCIsImdldCIsImdldFRpbWUiLCJtc0xlZnQiLCJEYXRlIiwibm93IiwicGF0aCIsImJhc2VuYW1lIiwidmVyaWZ5QXBwRXh0ZW5zaW9uIiwic3VwcG9ydGVkQXBwRXh0ZW5zaW9ucyIsImluY2x1ZGVzIiwiZXh0bmFtZSIsIkVycm9yIiwiY29uZmlndXJlQXBwIiwiXyIsImlzU3RyaW5nIiwiaXNBcnJheSIsIm5ld0FwcCIsInNob3VsZFVuemlwQXBwIiwiYXJjaGl2ZUhhc2giLCJsb2NhbEFwcHNGb2xkZXIiLCJyZW1vdGVBcHBQcm9wcyIsInByb3RvY29sIiwicGF0aG5hbWUiLCJwYXJzZSIsImlzVXJsIiwiYWNxdWlyZSIsImlzRW1wdHkiLCJ0ZXN0IiwibWF4QWdlTWF0Y2giLCJleGVjIiwicGFyc2VJbnQiLCJkb3dubG9hZElzTmVhZGVkIiwibG9jYWxGaWxlIiwibG9ja0ZpbGUiLCJ3YWl0aW5nVGltZSIsIm1heEF0dGVtcHRzQ291bnQiLCJ1bmRlZmluZWQiLCJyZW1vdGVGaWxlTGVuZ3RoIiwiYXR0ZW1wdHNDb3VudCIsIlByb21pc2UiLCJyZXNvbHZlIiwic2V0VGltZW91dCIsInN0YXRzIiwic3RhdCIsImxvY2FsRmlsZUxlbmd0aCIsInNpemUiLCJ1bmxpbmsiLCJzaGFyZWRGb2xkZXJQYXRoIiwiY2xvc2UiLCJvcGVuIiwiY2FjaGVkUGF0aCIsImRlbCIsImZpbGVOYW1lIiwic2FuaXRpemVOYW1lIiwiZGVjb2RlVVJJQ29tcG9uZW50IiwicmVwbGFjZW1lbnQiLCJjdCIsInNvbWUiLCJtaW1lVHlwZSIsIlJlZ0V4cCIsImVzY2FwZVJlZ0V4cCIsIm1hdGNoIiwicmVzdWx0aW5nTmFtZSIsInN1YnN0cmluZyIsInJlc3VsdGluZ0V4dCIsImZpcnN0IiwidGFyZ2V0UGF0aCIsInRlbXBEaXIiLCJwcmVmaXgiLCJzdWZmaXgiLCJkb3dubG9hZEFwcCIsImNvcHlGaWxlIiwiZXJyb3JNZXNzYWdlIiwiYXJjaGl2ZVBhdGgiLCJoYXNoIiwidG1wUm9vdCIsIm9wZW5EaXIiLCJ1bnppcEFwcCIsImlzQWJzb2x1dGUiLCJjd2QiLCJCb29sZWFuIiwic2V0IiwiaHJlZiIsIm5ldCIsImRvd25sb2FkRmlsZSIsImVyciIsInppcFBhdGgiLCJkc3RSb290IiwiemlwIiwiYXNzZXJ0VmFsaWRaaXAiLCJ0aW1lciIsInRpbWluZyIsIlRpbWVyIiwic3RhcnQiLCJ1c2VTeXN0ZW1VbnppcEVudiIsImVudiIsIkFQUElVTV9QUkVGRVJfU1lTVEVNX1VOWklQIiwidXNlU3lzdGVtVW56aXAiLCJ0b0xvd2VyIiwiZXh0cmFjdGlvbk9wdHMiLCJmaWxlTmFtZXNFbmNvZGluZyIsImV4dHJhY3RBbGxUbyIsImdsb2JQYXR0ZXJuIiwiZXh0IiwicmVwbGFjZSIsImpvaW4iLCJzb3J0ZWRCdW5kbGVJdGVtcyIsImdsb2IiLCJzdHJpY3QiLCJzb3J0IiwiYSIsImIiLCJzcGxpdCIsInNlcCIsImVycm9yQW5kVGhyb3ciLCJNYXRoIiwicm91bmQiLCJnZXREdXJhdGlvbiIsImFzTWlsbGlTZWNvbmRzIiwibWF0Y2hlZEJ1bmRsZSIsImRzdFBhdGgiLCJtdiIsIm1rZGlycCIsImlzUGFja2FnZU9yQnVuZGxlIiwiZHVwbGljYXRlS2V5cyIsImlucHV0IiwiZmlyc3RLZXkiLCJzZWNvbmRLZXkiLCJpdGVtIiwiaXNQbGFpbk9iamVjdCIsInJlc3VsdE9iaiIsImtleSIsInZhbHVlIiwidG9QYWlycyIsInJlY3Vyc2l2ZWx5Q2FsbGVkVmFsdWUiLCJwYXJzZUNhcHNBcnJheSIsImNhcCIsInBhcnNlZENhcHMiLCJKU09OIiwiaWduIl0sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7OztBQUFBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUVBLE1BQU1BLE9BQU8sR0FBRyxNQUFoQjtBQUNBLE1BQU1DLFFBQVEsR0FBRyxDQUFDLE1BQUQsRUFBU0QsT0FBVCxDQUFqQjtBQUNBLE1BQU1FLGNBQWMsR0FBRyxDQUNyQixpQkFEcUIsRUFFckIsOEJBRnFCLEVBR3JCLGlCQUhxQixDQUF2QjtBQUtBLE1BQU1DLG1CQUFtQixHQUFHLE9BQU8sRUFBUCxHQUFZLEVBQVosR0FBaUIsRUFBN0M7QUFDQSxNQUFNQyxrQkFBa0IsR0FBRyxJQUFJQyxpQkFBSixDQUFRO0FBQ2pDQyxFQUFBQSxNQUFNLEVBQUVILG1CQUR5QjtBQUVqQ0ksRUFBQUEsY0FBYyxFQUFFLElBRmlCO0FBR2pDQyxFQUFBQSxPQUFPLEVBQUUsT0FBT0Ms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c2gnO1xyXG5pbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcclxuaW1wb3J0IHVybCBmcm9tICd1cmwnO1xyXG5pbXBvcnQgbG9nZ2VyIGZyb20gJy4vbG9nZ2VyJztcclxuaW1wb3J0IHsgdGVtcERpciwgZnMsIHV0aWwsIHppcCwgbmV0LCB0aW1pbmcgfSBmcm9tICdhcHBpdW0tc3VwcG9ydCc7XHJcbmltcG9ydCBMUlUgZnJvbSAnbHJ1LWNhY2hlJztcclxuaW1wb3J0IEFzeW5jTG9jayBmcm9tICdhc3luYy1sb2NrJztcclxuaW1wb3J0IGF4aW9zIGZyb20gJ2F4aW9zJztcclxuaW1wb3J0IHsgZ2V0TG9jYWxBcHBzRm9sZGVyLCBnZXRTaGFyZWRGb2xkZXJGb3JBcHBVcmwsIGdldExvY2FsRmlsZUZvckFwcFVybCwgZ2V0RmlsZUNvbnRlbnRMZW5ndGggfSBmcm9tICcuL21jbG91ZC11dGlscyc7XHJcblxyXG5jb25zdCBJUEFfRVhUID0gJy5pcGEnO1xyXG5jb25zdCBaSVBfRVhUUyA9IFsnLnppcCcsIElQQV9FWFRdO1xyXG5jb25zdCBaSVBfTUlNRV9UWVBFUyA9IFtcclxuICAnYXBwbGljYXRpb24vemlwJyxcclxuICAnYXBwbGljYXRpb24veC16aXAtY29tcHJlc3NlZCcsXHJcbiAgJ211bHRpcGFydC94LXppcCcsXHJcbl07XHJcbmNvbnN0IENBQ0hFRF9BUFBTX01BWF9BR0UgPSAxMDAwICogNjAgKiA2MCAqIDI0OyAvLyBtc1xyXG5jb25zdCBBUFBMSUNBVElPTlNfQ0FDSEUgPSBuZXcgTFJVKHtcclxuICBtYXhBZ2U6IENBQ0hFRF9BUFBTX01BWF9BR0UsIC8vIGV4cGlyZSBhZnRlciAyNCBob3Vyc1xyXG4gIHVwZGF0ZUFnZU9uR2V0OiB0cnVlLFxyXG4gIGRpc3Bvc2U6IGFzeW5jIChhcHAsIHtmdWxsUGF0aH0pID0+IHtcclxuICAgIGlmICghYXdhaXQgZnMuZXhpc3RzKGZ1bGxQYXRoKSkge1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgbG9nZ2VyLmluZm8oYFRoZSBhcHBsaWNhdGlvbiAnJHthcHB9JyBjYWNoZWQgYXQgJyR7ZnVsbFBhdGh9JyBoYXMgZXhwaXJlZGApO1xyXG4gICAgYXdhaXQgZnMucmltcmFmKGZ1bGxQYXRoKTtcclxuICB9LFxyXG4gIG5vRGlzcG9zZU9uU2V0OiB0cnVlLFxyXG59KTtcclxuY29uc3QgQVBQTElDQVRJT05TX0NBQ0hFX0dVQVJEID0gbmV3IEFzeW5jTG9jaygpO1xyXG5jb25zdCBTQU5JVElaRV9SRVBMQUNFTUVOVCA9ICctJztcclxuY29uc3QgREVGQVVMVF9CQVNFTkFNRSA9ICdhcHBpdW0tYXBwJztcclxuY29uc3QgQVBQX0RPV05MT0FEX1RJTUVPVVRfTVMgPSAxMjAgKiAxMDAwO1xyXG5cclxucHJvY2Vzcy5vbignZXhpdCcsICgpID0+IHtcclxuICBpZiAoQVBQTElDQVRJT05TX0NBQ0hFLml0ZW1Db3VudCA9PT0gMCkge1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuXHJcbiAgY29uc3QgYXBwUGF0aHMgPSBBUFBMSUNBVElPTlNfQ0FDSEUudmFsdWVzKClcclxuICAgIC5tYXAoKHtmdWxsUGF0aH0pID0+IGZ1bGxQYXRoKTtcclxuICBsb2dnZXIuZGVidWcoYFBlcmZvcm1pbmcgY2xlYW51cCBvZiAke2FwcFBhdGhzLmxlbmd0aH0gY2FjaGVkIGAgK1xyXG4gICAgdXRpbC5wbHVyYWxpemUoJ2FwcGxpY2F0aW9uJywgYXBwUGF0aHMubGVuZ3RoKSk7XHJcbiAgZm9yIChjb25zdCBhcHBQYXRoIG9mIGFwcFBhdGhzKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICAvLyBBc3luY2hyb25vdXMgY2FsbHMgYXJlIG5vdCBzdXBwb3J0ZWQgaW4gb25FeGl0IGhhbmRsZXJcclxuICAgICAgZnMucmltcmFmU3luYyhhcHBQYXRoKTtcclxuICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgbG9nZ2VyLndhcm4oZS5tZXNzYWdlKTtcclxuICAgIH1cclxuICB9XHJcbn0pO1xyXG5cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIHJldHJpZXZlSGVhZGVycyAobGluaykge1xyXG4gIHRyeSB7XHJcbiAgICByZXR1cm4gKGF3YWl0IGF4aW9zKHtcclxuICAgICAgdXJsOiBsaW5rLFxyXG4gICAgICBtZXRob2Q6ICdIRUFEJyxcclxuICAgICAgdGltZW91dDogNTAwMCxcclxuICAgIH0pKS5oZWFkZXJzO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGxvZ2dlci5pbmZvKGBDYW5ub3Qgc2VuZCBIRUFEIHJlcXVlc3QgdG8gJyR7bGlua30nLiBPcmlnaW5hbCBlcnJvcjogJHtlLm1lc3NhZ2V9YCk7XHJcbiAgfVxyXG4gIHJldHVybiB7fTtcclxufVxyXG5cclxuZnVuY3Rpb24gZ2V0Q2FjaGVkQXBwbGljYXRpb25QYXRoIChsaW5rLCBjdXJyZW50QXBwUHJvcHMgPSB7fSkge1xyXG4gIGNvbnN0IHJlZnJlc2ggPSAoKSA9PiB7XHJcbiAgICBsb2dnZXIuaW5mbyhgQ1VTVE9NIEhFTFBFUiFgKTtcclxuICAgIGxvZ2dlci5kZWJ1ZyhgQSBmcmVzaCBjb3B5IG9mIHRoZSBhcHBsaWNhdGlvbiBpcyBnb2luZyB0byBiZSBkb3dubG9hZGVkIGZyb20gJHtsaW5rfWApO1xyXG4gICAgcmV0dXJuIG51bGw7XHJcbiAgfTtcclxuXHJcbiAgaWYgKEFQUExJQ0FUSU9OU19DQUNIRS5oYXMobGluaykpIHtcclxuICAgIGNvbnN0IHtcclxuICAgICAgbGFzdE1vZGlmaWVkOiBjdXJyZW50TW9kaWZpZWQsXHJcbiAgICAgIGltbXV0YWJsZTogY3VycmVudEltbXV0YWJsZSxcclxuICAgICAgLy8gbWF4QWdlIGlzIGluIHNlY29uZHNcclxuICAgICAgbWF4QWdlOiBjdXJyZW50TWF4QWdlLFxyXG4gICAgfSA9IGN1cnJlbnRBcHBQcm9wcztcclxuICAgIGNvbnN0IHtcclxuICAgICAgLy8gRGF0ZSBpbnN0YW5jZVxyXG4gICAgICBsYXN0TW9kaWZpZWQsXHJcbiAgICAgIC8vIGJvb2xlYW5cclxuICAgICAgaW1tdXRhYmxlLFxyXG4gICAgICAvLyBVbml4IHRpbWUgaW4gbWlsbGlzZWNvbmRzXHJcbiAgICAgIHRpbWVzdGFtcCxcclxuICAgICAgZnVsbFBhdGgsXHJcbiAgICB9ID0gQVBQTElDQVRJT05TX0NBQ0hFLmdldChsaW5rKTtcclxuICAgIGlmIChsYXN0TW9kaWZpZWQgJiYgY3VycmVudE1vZGlmaWVkKSB7XHJcbiAgICAgIGlmIChjdXJyZW50TW9kaWZpZWQuZ2V0VGltZSgpIDw9IGxhc3RNb2RpZmllZC5nZXRUaW1lKCkpIHtcclxuICAgICAgICBsb2dnZXIuZGVidWcoYFRoZSBhcHBsaWNhdGlvbiBhdCAke2xpbmt9IGhhcyBub3QgYmVlbiBtb2RpZmllZCBzaW5jZSAke2xhc3RNb2RpZmllZH1gKTtcclxuICAgICAgICByZXR1cm4gZnVsbFBhdGg7XHJcbiAgICAgIH1cclxuICAgICAgbG9nZ2VyLmRlYnVnKGBUaGUgYXBwbGljYXRpb24gYXQgJHtsaW5rfSBoYXMgYmVlbiBtb2RpZmllZCBzaW5jZSAke2xhc3RNb2RpZmllZH1gKTtcclxuICAgICAgcmV0dXJuIHJlZnJlc2goKTtcclxuICAgIH1cclxuICAgIGlmIChpbW11dGFibGUgJiYgY3VycmVudEltbXV0YWJsZSkge1xyXG4gICAgICBsb2dnZXIuZGVidWcoYFRoZSBhcHBsaWNhdGlvbiBhdCAke2xpbmt9IGlzIGltbXV0YWJsZWApO1xyXG4gICAgICByZXR1cm4gZnVsbFBhdGg7XHJcbiAgICB9XHJcbiAgICBpZiAoY3VycmVudE1heEFnZSAmJiB0aW1lc3RhbXApIHtcclxuICAgICAgY29uc3QgbXNMZWZ0ID0gdGltZXN0YW1wICsgY3VycmVudE1heEFnZSAqIDEwMDAgLSBEYXRlLm5vdygpO1xyXG4gICAgICBpZiAobXNMZWZ0ID4gMCkge1xyXG4gICAgICAgIGxvZ2dlci5kZWJ1ZyhgVGhlIGNhY2hlZCBhcHBsaWNhdGlvbiAnJHtwYXRoLmJhc2VuYW1lKGZ1bGxQYXRoKX0nIHdpbGwgZXhwaXJlIGluICR7bXNMZWZ0IC8gMTAwMH1zYCk7XHJcbiAgICAgICAgcmV0dXJuIGZ1bGxQYXRoO1xyXG4gICAgICB9XHJcbiAgICAgIGxvZ2dlci5kZWJ1ZyhgVGhlIGNhY2hlZCBhcHBsaWNhdGlvbiAnJHtwYXRoLmJhc2VuYW1lKGZ1bGxQYXRoKX0nIGhhcyBleHBpcmVkYCk7XHJcbiAgICB9XHJcbiAgfVxyXG4gIHJldHVybiByZWZyZXNoKCk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHZlcmlmeUFwcEV4dGVuc2lvbiAoYXBwLCBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zKSB7XHJcbiAgaWYgKHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMuaW5jbHVkZXMocGF0aC5leHRuYW1lKGFwcCkpKSB7XHJcbiAgICByZXR1cm4gYXBwO1xyXG4gIH1cclxuICB0aHJvdyBuZXcgRXJyb3IoYE5ldyBhcHAgcGF0aCAnJHthcHB9JyBkaWQgbm90IGhhdmUgYCArXHJcbiAgICBgJHt1dGlsLnBsdXJhbGl6ZSgnZXh0ZW5zaW9uJywgc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucy5sZW5ndGgsIGZhbHNlKX06IGAgK1xyXG4gICAgc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucyk7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGNvbmZpZ3VyZUFwcCAoYXBwLCBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zKSB7XHJcbiAgaWYgKCFfLmlzU3RyaW5nKGFwcCkpIHtcclxuICAgIC8vIGltbWVkaWF0ZWx5IHNob3J0Y2lyY3VpdCBpZiBub3QgZ2l2ZW4gYW4gYXBwXHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGlmICghXy5pc0FycmF5KHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMpKSB7XHJcbiAgICBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zID0gW3N1cHBvcnRlZEFwcEV4dGVuc2lvbnNdO1xyXG4gIH1cclxuXHJcbiAgbGV0IG5ld0FwcCA9IGFwcDtcclxuICBsZXQgc2hvdWxkVW56aXBBcHAgPSBmYWxzZTtcclxuICBsZXQgYXJjaGl2ZUhhc2ggPSBudWxsO1xyXG4gIGxldCBsb2NhbEFwcHNGb2xkZXI7XHJcbiAgY29uc3QgcmVtb3RlQXBwUHJvcHMgPSB7XHJcbiAgICBsYXN0TW9kaWZpZWQ6IG51bGwsXHJcbiAgICBpbW11dGFibGU6IGZhbHNlLFxyXG4gICAgbWF4QWdlOiBudWxsLFxyXG4gIH07XHJcbiAgY29uc3Qge3Byb3RvY29sLCBwYXRobmFtZX0gPSB1cmwucGFyc2UobmV3QXBwKTtcclxuICBjb25zdCBpc1VybCA9IFsnaHR0cDonLCAnaHR0cHM6J10uaW5jbHVkZXMocHJvdG9jb2wpO1xyXG5cclxuICByZXR1cm4gYXdhaXQgQVBQTElDQVRJT05TX0NBQ0hFX0dVQVJELmFjcXVpcmUoYXBwLCBhc3luYyAoKSA9PiB7XHJcbiAgICBpZiAoaXNVcmwpIHtcclxuICAgICAgLy8gVXNlIHRoZSBhcHAgZnJvbSByZW1vdGUgVVJMXHJcbiAgICAgIGxvZ2dlci5pbmZvKGBVc2luZyBkb3dubG9hZGFibGUgYXBwICcke25ld0FwcH0nYCk7XHJcbiAgICAgIGNvbnN0IGhlYWRlcnMgPSBhd2FpdCByZXRyaWV2ZUhlYWRlcnMobmV3QXBwKTtcclxuICAgICAgaWYgKCFfLmlzRW1wdHkoaGVhZGVycykpIHtcclxuICAgICAgICBpZiAoaGVhZGVyc1snbGFzdC1tb2RpZmllZCddKSB7XHJcbiAgICAgICAgICByZW1vdGVBcHBQcm9wcy5sYXN0TW9kaWZpZWQgPSBuZXcgRGF0ZShoZWFkZXJzWydsYXN0LW1vZGlmaWVkJ10pO1xyXG4gICAgICAgIH1cclxuICAgICAgICBsb2dnZXIuZGVidWcoYExhc3QtTW9kaWZpZWQ6ICR7aGVhZGVyc1snbGFzdC1tb2RpZmllZCddfWApO1xyXG4gICAgICAgIGlmIChoZWFkZXJzWydjYWNoZS1jb250cm9sJ10pIHtcclxuICAgICAgICAgIHJlbW90ZUFwcFByb3BzLmltbXV0YWJsZSA9IC9cXGJpbW11dGFibGVcXGIvaS50ZXN0KGhlYWRlcnNbJ2NhY2hlLWNvbnRyb2wnXSk7XHJcbiAgICAgICAgICBjb25zdCBtYXhBZ2VNYXRjaCA9IC9cXGJtYXgtYWdlPShcXGQrKVxcYi9pLmV4ZWMoaGVhZGVyc1snY2FjaGUtY29udHJvbCddKTtcclxuICAgICAgICAgIGlmIChtYXhBZ2VNYXRjaCkge1xyXG4gICAgICAgICAgICByZW1vdGVBcHBQcm9wcy5tYXhBZ2UgPSBwYXJzZUludChtYXhBZ2VNYXRjaFsxXSwgMTApO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICBsb2dnZXIuZGVidWcoYENhY2hlLUNvbnRyb2w6ICR7aGVhZGVyc1snY2FjaGUtY29udHJvbCddfWApO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyAqKioqKiBDdXN0b20gbG9naWMgZm9yIHZlcmlmaWNhdGlvbiBvZiBsb2NhbCBzdGF0aWMgcGF0aCBmb3IgQVBQcyAqKioqKlxyXG4gICAgICBsZXQgZG93bmxvYWRJc05lYWRlZCA9IHRydWU7XHJcbiAgICAgIGxvY2FsQXBwc0ZvbGRlciA9IGF3YWl0IGdldExvY2FsQXBwc0ZvbGRlcigpO1xyXG4gICAgICBsZXQgbG9jYWxGaWxlO1xyXG4gICAgICBsZXQgbG9ja0ZpbGU7XHJcbiAgICAgIGNvbnN0IHdhaXRpbmdUaW1lID0gNTAwMDtcclxuICAgICAgY29uc3QgbWF4QXR0ZW1wdHNDb3VudCA9IDUgKiAxMjtcclxuICAgICAgXHJcbiAgICAgIGlmKGxvY2FsQXBwc0ZvbGRlciAhPSB1bmRlZmluZWQpIHtcclxuICAgICAgICBsb2NhbEZpbGUgPSBhd2FpdCBnZXRMb2NhbEZpbGVGb3JBcHBVcmwobmV3QXBwKTtcclxuICAgICAgICBsb2NrRmlsZSA9IGxvY2FsRmlsZSArICcubG9jayc7XHJcblxyXG4gICAgICAgIGlmKGF3YWl0IGZzLmV4aXN0cyhsb2NhbEZpbGUpKSB7XHJcbiAgICAgICAgICBsb2dnZXIuaW5mbyhgTG9jYWwgdmVyc2lvbiBvZiBhcHAgd2FzIGZvdW5kLiBXaWxsIGNoZWNrIGFjdHVhbGl0eSBvZiB0aGUgZmlsZWApO1xyXG4gICAgICAgICAgLy8gQ2hlY2tpbmcgb2YgbG9jYWwgYXBwbGljYXRpb24gYWN0dWFsaXR5XHJcbiAgICAgICAgICBjb25zdCByZW1vdGVGaWxlTGVuZ3RoID0gYXdhaXQgZ2V0RmlsZUNvbnRlbnRMZW5ndGgoYXBwKTtcclxuICAgICAgICAgIC8vIEF0IHRoaXMgcG9pbnQgbG9jYWwgZmlsZSBtaWdodCBiZSBkZWxldGVkIGJ5IHBhcmFsbGVsIHNlc3Npb24gd2hpY2ggdXBkYXRlcyBvdXRkYXRlZCBhcHBcclxuICAgICAgICAgIGxldCBhdHRlbXB0c0NvdW50ID0gMDtcclxuICAgICAgICAgIHdoaWxlKCFhd2FpdCBmcy5leGlzdHMobG9jYWxGaWxlKSAmJiAoYXR0ZW1wdHNDb3VudCsrIDwgbWF4QXR0ZW1wdHNDb3VudCkpIHtcclxuICAgICAgICAgICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcclxuICAgICAgICAgICAgICBsb2dnZXIuaW5mbyhgQXR0ZW1wdCAjJHthdHRlbXB0c0NvdW50fSBmb3IgbG9jYWwgYXBwIGZpbGUgdG8gYXBwZWFyIGFnYWluYCk7XHJcbiAgICAgICAgICAgICAgc2V0VGltZW91dChyZXNvbHZlLCB3YWl0aW5nVGltZSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgaWYoIWF3YWl0IGZzLmV4aXN0cyhsb2NhbEZpbGUpKSB7XHJcbiAgICAgICAgICAgIHRocm93IEVycm9yKGBMb2NhbCBhcHBsaWNhdGlvbiBmaWxlIGhhcyBub3QgYXBwZWFyZWQgYWZ0ZXIgdXBkYXRpbmcgYnkgcGFyYWxsZWwgQXBwaXVtIHNlc3Npb25gKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIGNvbnN0IHN0YXRzID0gYXdhaXQgZnMuc3RhdChsb2NhbEZpbGUpO1xyXG4gICAgICAgICAgY29uc3QgbG9jYWxGaWxlTGVuZ3RoID0gc3RhdHMuc2l6ZTtcclxuICAgICAgICAgIGxvZ2dlci5pbmZvKGBSZW1vdGUgZmlsZSBzaXplIGlzICR7cmVtb3RlRmlsZUxlbmd0aH0gYW5kIGxvY2FsIGZpbGUgc2l6ZSBpcyAke2xvY2FsRmlsZUxlbmd0aH1gKTtcclxuICAgICAgICAgIGlmKHJlbW90ZUZpbGVMZW5ndGggIT0gbG9jYWxGaWxlTGVuZ3RoKSB7XHJcbiAgICAgICAgICAgIGxvZ2dlci5pbmZvKGBTaXplcyBkaWZmZXIuIEhlbmNlIHRoYXQncyBuZWVkZWQgdG8gZG93bmxvYWQgZnJlc2ggdmVyc2lvbiBvZiB0aGUgYXBwYCk7XHJcbiAgICAgICAgICAgIGF3YWl0IGZzLnVubGluayhsb2NhbEZpbGUpO1xyXG4gICAgICAgICAgICBkb3dubG9hZElzTmVhZGVkID0gdHJ1ZTtcclxuICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIGxvZ2dlci5pbmZvKGBTaXplcyBhcmUgdGhlIHNhbWUuIEhlbmNlIHdpbGwgdXNlIGFscmVhZHkgc3RvcmVkIGFwcGxpY2F0aW9uIGZvciB0aGUgc2Vzc2lvbmApO1xyXG4gICAgICAgICAgICBuZXdBcHAgPSBsb2NhbEZpbGU7XHJcbiAgICAgICAgICAgIHNob3VsZFVuemlwQXBwID0gWklQX0VYVFMuaW5jbHVkZXMocGF0aC5leHRuYW1lKG5ld0FwcCkpO1xyXG4gICAgICAgICAgICBkb3dubG9hZElzTmVhZGVkID0gZmFsc2U7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfSBlbHNlIGlmIChhd2FpdCBmcy5leGlzdHMobG9ja0ZpbGUpKSB7XHJcbiAgICAgICAgICBsb2dnZXIuaW5mbyhgTG9jYWwgdmVyc2lvbiBvZiBhcHAgbm90IGZvdW5kIGJ1dCAubG9jayBmaWxlIGV4aXN0cy4gV2FpdGluZyBmb3IgLmxvY2sgdG8gZGlzYXBwZWFyYCk7XHJcbiAgICAgICAgICAvLyBXYWl0IGZvciBzb21lIHRpbWUgdGlsbCBBcHAgaXMgZG93bmxvYWRlZCBieSBzb21lIHBhcmFsbGVsIEFwcGl1bSBpbnN0YW5jZVxyXG4gICAgICAgICAgbGV0IGF0dGVtcHRzQ291bnQgPSAwO1xyXG4gICAgICAgICAgd2hpbGUoYXdhaXQgZnMuZXhpc3RzKGxvY2tGaWxlKSAmJiAoYXR0ZW1wdHNDb3VudCsrIDwgbWF4QXR0ZW1wdHNDb3VudCkpIHtcclxuICAgICAgICAgICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcclxuICAgICAgICAgICAgICBsb2dnZXIuaW5mbyhgQXR0ZW1wdCAjJHthdHRlbXB0c0NvdW50fSBmb3IgLmxvY2sgZmlsZSBjaGVja2luZ2ApO1xyXG4gICAgICAgICAgICAgIHNldFRpbWVvdXQocmVzb2x2ZSwgd2FpdGluZ1RpbWUpO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIGlmKGF3YWl0IGZzLmV4aXN0cyhsb2NrRmlsZSkpIHtcclxuICAgICAgICAgICAgdGhyb3cgRXJyb3IoYC5sb2NrIGZpbGUgZm9yIGRvd25sb2FkaW5nIGFwcGxpY2F0aW9uIGhhcyBub3QgZGlzYXBwZWFyZWQgYWZ0ZXIgJHt3YWl0aW5nVGltZSAqIG1heEF0dGVtcHRzQ291bnR9bXNgKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIGlmKCFhd2FpdCBmcy5leGlzdHMobG9jYWxGaWxlKSkge1xyXG4gICAgICAgICAgICB0aHJvdyBFcnJvcihgTG9jYWwgYXBwbGljYXRpb24gZmlsZSBoYXMgbm90IGFwcGVhcmVkIGFmdGVyIC5sb2NrIGZpbGUgcmVtb3ZhbGApO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgbG9nZ2VyLmluZm8oYExvY2FsIHZlcnNpb24gb2YgYXBwIHdhcyBmb3VuZCBhZnRlciAubG9jayBmaWxlIHJlbW92YWwuIFdpbGwgdXNlIGl0IGZvciBuZXcgc2Vzc2lvbmApO1xyXG4gICAgICAgICAgbmV3QXBwID0gbG9jYWxGaWxlO1xyXG4gICAgICAgICAgc2hvdWxkVW56aXBBcHAgPSBaSVBfRVhUUy5pbmNsdWRlcyhwYXRoLmV4dG5hbWUobmV3QXBwKSk7XHJcbiAgICAgICAgICBkb3dubG9hZElzTmVhZGVkID0gZmFsc2U7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgIGxvZ2dlci5pbmZvKGBOZWl0aGVyIGxvY2FsIHZlcnNpb24gb2YgYXBwIG5vciAubG9jayBmaWxlIHdhcyBmb3VuZC4gV2lsbCBkb3dubG9hZCBhcHAgZnJvbSByZW1vdGUgVVJMLmApO1xyXG4gICAgICAgICAgZG93bmxvYWRJc05lYWRlZCA9IHRydWU7XHJcbiAgICAgICAgfVxyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIGxvZ2dlci5pbmZvKGBMb2NhbCBhcHBzIGZvbGRlciBpcyBub3QgZGVmaW5lZCB2aWEgZW52aXJvbm1lbnQgcHJvcGVydGllcywgaGVuY2Ugc2tpcHBpbmcgdGhpcyBsb2dpY2ApO1xyXG4gICAgICB9XHJcbiAgICAgIGlmKGRvd25sb2FkSXNOZWFkZWQpIHtcclxuICAgICAgXHJcbiAgICAgICAgaWYobG9jYWxBcHBzRm9sZGVyICE9IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgbG9nZ2VyLmluZm8oYExvY2FsIHZlcnNpb24gb2YgYXBwIHdhcyBub3QgZm91bmQuIEhlbmNlIHVzaW5nIGRlZmF1bHQgQXBwaXVtIGxvZ2ljIGZvciBkb3dubG9hZGluZ2ApO1xyXG4gICAgICAgICAgY29uc3Qgc2hhcmVkRm9sZGVyUGF0aCA9IGF3YWl0IGdldFNoYXJlZEZvbGRlckZvckFwcFVybChhcHApO1xyXG4gICAgICAgICAgbG9nZ2VyLmluZm8oYEZvbGRlciBmb3IgbG9jYWwgc2hhcmVkIGFwcHM6ICR7c2hhcmVkRm9sZGVyUGF0aH1gKTtcclxuICAgICAgICAgIGF3YWl0IGZzLmNsb3NlKGF3YWl0IGZzLm9wZW4obG9ja0ZpbGUsICd3JykpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgY29uc3QgY2FjaGVkUGF0aCA9IGdldENhY2hlZEFwcGxpY2F0aW9uUGF0aChhcHAsIHJlbW90ZUFwcFByb3BzKTtcclxuICAgICAgaWYgKGNhY2hlZFBhdGgpIHtcclxuICAgICAgICBpZiAoYXdhaXQgZnMuZXhpc3RzKGNhY2hlZFBhdGgpKSB7XHJcbiAgICAgICAgICBsb2dnZXIuaW5mbyhgUmV1c2luZyBwcmV2aW91c2x5IGRvd25sb2FkZWQgYXBwbGljYXRpb24gYXQgJyR7Y2FjaGVkUGF0aH0nYCk7XHJcbiAgICAgICAgICByZXR1cm4gdmVyaWZ5QXBwRXh0ZW5zaW9uKGNhY2hlZFBhdGgsIHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBsb2dnZXIuaW5mbyhgVGhlIGFwcGxpY2F0aW9uIGF0ICcke2NhY2hlZFBhdGh9JyBkb2VzIG5vdCBleGlzdCBhbnltb3JlLiBEZWxldGluZyBpdCBmcm9tIHRoZSBjYWNoZWApO1xyXG4gICAgICAgIEFQUExJQ0FUSU9OU19DQUNIRS5kZWwoYXBwKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgbGV0IGZpbGVOYW1lID0gbnVsbDtcclxuICAgICAgY29uc3QgYmFzZW5hbWUgPSBmcy5zYW5pdGl6ZU5hbWUocGF0aC5iYXNlbmFtZShkZWNvZGVVUklDb21wb25lbnQocGF0aG5hbWUpKSwge1xyXG4gICAgICAgIHJlcGxhY2VtZW50OiBTQU5JVElaRV9SRVBMQUNFTUVOVFxyXG4gICAgICB9KTtcclxuICAgICAgY29uc3QgZXh0bmFtZSA9IHBhdGguZXh0bmFtZShiYXNlbmFtZSk7XHJcbiAgICAgIC8vIHRvIGRldGVybWluZSBpZiB3ZSBuZWVkIHRvIHVuemlwIHRoZSBhcHAsIHdlIGhhdmUgYSBudW1iZXIgb2YgcGxhY2VzXHJcbiAgICAgIC8vIHRvIGxvb2s6IGNvbnRlbnQgdHlwZSwgY29udGVudCBkaXNwb3NpdGlvbiwgb3IgdGhlIGZpbGUgZXh0ZW5zaW9uXHJcbiAgICAgIGlmIChaSVBfRVhUUy5pbmNsdWRlcyhleHRuYW1lKSkge1xyXG4gICAgICAgIGZpbGVOYW1lID0gYmFzZW5hbWU7XHJcbiAgICAgICAgc2hvdWxkVW56aXBBcHAgPSB0cnVlO1xyXG4gICAgICB9XHJcbiAgICAgIGlmIChoZWFkZXJzWydjb250ZW50LXR5cGUnXSkge1xyXG4gICAgICAgIGNvbnN0IGN0ID0gaGVhZGVyc1snY29udGVudC10eXBlJ107XHJcbiAgICAgICAgbG9nZ2VyLmRlYnVnKGBDb250ZW50LVR5cGU6ICR7Y3R9YCk7XHJcbiAgICAgICAgLy8gdGhlIGZpbGV0eXBlIG1heSBub3QgYmUgb2J2aW91cyBmb3IgY2VydGFpbiB1cmxzLCBzbyBjaGVjayB0aGUgbWltZSB0eXBlIHRvb1xyXG4gICAgICAgIGlmIChaSVBfTUlNRV9UWVBFUy5zb21lKChtaW1lVHlwZSkgPT4gbmV3IFJlZ0V4cChgXFxcXGIke18uZXNjYXBlUmVnRXhwKG1pbWVUeXBlKX1cXFxcYmApLnRlc3QoY3QpKSkge1xyXG4gICAgICAgICAgaWYgKCFmaWxlTmFtZSkge1xyXG4gICAgICAgICAgICBmaWxlTmFtZSA9IGAke0RFRkFVTFRfQkFTRU5BTUV9LnppcGA7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBzaG91bGRVbnppcEFwcCA9IHRydWU7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIGlmIChoZWFkZXJzWydjb250ZW50LWRpc3Bvc2l0aW9uJ10gJiYgL15hdHRhY2htZW50L2kudGVzdChoZWFkZXJzWydjb250ZW50LWRpc3Bvc2l0aW9uJ10pKSB7XHJcbiAgICAgICAgbG9nZ2VyLmRlYnVnKGBDb250ZW50LURpc3Bvc2l0aW9uOiAke2hlYWRlcnNbJ2NvbnRlbnQtZGlzcG9zaXRpb24nXX1gKTtcclxuICAgICAgICBjb25zdCBtYXRjaCA9IC9maWxlbmFtZT1cIihbXlwiXSspL2kuZXhlYyhoZWFkZXJzWydjb250ZW50LWRpc3Bvc2l0aW9uJ10pO1xyXG4gICAgICAgIGlmIChtYXRjaCkge1xyXG4gICAgICAgICAgZmlsZU5hbWUgPSBmcy5zYW5pdGl6ZU5hbWUobWF0Y2hbMV0sIHtcclxuICAgICAgICAgICAgcmVwbGFjZW1lbnQ6IFNBTklUSVpFX1JFUExBQ0VNRU5UXHJcbiAgICAgICAgICB9KTtcclxuICAgICAgICAgIHNob3VsZFVuemlwQXBwID0gc2hvdWxkVW56aXBBcHAgfHwgWklQX0VYVFMuaW5jbHVkZXMocGF0aC5leHRuYW1lKGZpbGVOYW1lKSk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIGlmICghZmlsZU5hbWUpIHtcclxuICAgICAgICAvLyBhc3NpZ24gdGhlIGRlZmF1bHQgZmlsZSBuYW1lIGFuZCB0aGUgZXh0ZW5zaW9uIGlmIG5vbmUgaGFzIGJlZW4gZGV0ZWN0ZWRcclxuICAgICAgICBjb25zdCByZXN1bHRpbmdOYW1lID0gYmFzZW5hbWVcclxuICAgICAgICAgID8gYmFzZW5hbWUuc3Vic3RyaW5nKDAsIGJhc2VuYW1lLmxlbmd0aCAtIGV4dG5hbWUubGVuZ3RoKVxyXG4gICAgICAgICAgOiBERUZBVUxUX0JBU0VOQU1FO1xyXG4gICAgICAgIGxldCByZXN1bHRpbmdFeHQgPSBleHRuYW1lO1xyXG4gICAgICAgIGlmICghc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucy5pbmNsdWRlcyhyZXN1bHRpbmdFeHQpKSB7XHJcbiAgICAgICAgICBsb2dnZXIuaW5mbyhgVGhlIGN1cnJlbnQgZmlsZSBleHRlbnNpb24gJyR7cmVzdWx0aW5nRXh0fScgaXMgbm90IHN1cHBvcnRlZC4gYCArXHJcbiAgICAgICAgICAgIGBEZWZhdWx0aW5nIHRvICcke18uZmlyc3Qoc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucyl9J2ApO1xyXG4gICAgICAgICAgcmVzdWx0aW5nRXh0ID0gXy5maXJzdChzdXBwb3J0ZWRBcHBFeHRlbnNpb25zKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgZmlsZU5hbWUgPSBgJHtyZXN1bHRpbmdOYW1lfSR7cmVzdWx0aW5nRXh0fWA7XHJcbiAgICAgIH1cclxuICAgICAgY29uc3QgdGFyZ2V0UGF0aCA9IGF3YWl0IHRlbXBEaXIucGF0aCh7XHJcbiAgICAgICAgcHJlZml4OiBmaWxlTmFtZSxcclxuICAgICAgICBzdWZmaXg6ICcnLFxyXG4gICAgICB9KTtcclxuICAgICAgbmV3QXBwID0gYXdhaXQgZG93bmxvYWRBcHAobmV3QXBwLCB0YXJnZXRQYXRoKTtcclxuXHJcbiAgICAgIC8vICoqKioqIEN1c3RvbSBsb2dpYyBmb3IgY29weWluZyBvZiBkb3dubG9hZGVkIGFwcCB0byBzdGF0aWMgbG9jYXRpb24gKioqKipcclxuICAgICAgaWYobG9jYWxBcHBzRm9sZGVyICE9IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIGxvZ2dlci5pbmZvKGBOZXcgYXBwIHBhdGg6ICR7bmV3QXBwfWApO1xyXG4gICAgICAgIGF3YWl0IGZzLmNvcHlGaWxlKG5ld0FwcCwgbG9jYWxGaWxlKTtcclxuICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIGZpbmFsbHkge1xyXG4gICAgICAgIGlmKGxvY2FsQXBwc0ZvbGRlciAhPSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgIGxvZ2dlci5pbmZvKGBHb2luZyB0byByZW1vdmUgbG9jayBmaWxlICR7bG9ja0ZpbGV9YClcclxuICAgICAgICAgIGF3YWl0IGZzLnVubGluayhsb2NrRmlsZSk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIH1cclxuICAgIH0gZWxzZSBpZiAoYXdhaXQgZnMuZXhpc3RzKG5ld0FwcCkpIHtcclxuICAgICAgLy8gVXNlIHRoZSBsb2NhbCBhcHBcclxuICAgICAgbG9nZ2VyLmluZm8oYFVzaW5nIGxvY2FsIGFwcCAnJHtuZXdBcHB9J2ApO1xyXG4gICAgICBzaG91bGRVbnppcEFwcCA9IFpJUF9FWFRTLmluY2x1ZGVzKHBhdGguZXh0bmFtZShuZXdBcHApKTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIGxldCBlcnJvck1lc3NhZ2UgPSBgVGhlIGFwcGxpY2F0aW9uIGF0ICcke25ld0FwcH0nIGRvZXMgbm90IGV4aXN0IG9yIGlzIG5vdCBhY2Nlc3NpYmxlYDtcclxuICAgICAgLy8gcHJvdG9jb2wgdmFsdWUgZm9yICdDOlxcXFx0ZW1wJyBpcyAnYzonLCBzbyB3ZSBjaGVjayB0aGUgbGVuZ3RoIGFzIHdlbGxcclxuICAgICAgaWYgKF8uaXNTdHJpbmcocHJvdG9jb2wpICYmIHByb3RvY29sLmxlbmd0aCA+IDIpIHtcclxuICAgICAgICBlcnJvck1lc3NhZ2UgPSBgVGhlIHByb3RvY29sICcke3Byb3RvY29sfScgdXNlZCBpbiAnJHtuZXdBcHB9JyBpcyBub3Qgc3VwcG9ydGVkLiBgICtcclxuICAgICAgICAgIGBPbmx5IGh0dHA6IGFuZCBodHRwczogcHJvdG9jb2xzIGFyZSBzdXBwb3J0ZWRgO1xyXG4gICAgICB9XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcihlcnJvck1lc3NhZ2UpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChzaG91bGRVbnppcEFwcCkge1xyXG4gICAgICBjb25zdCBhcmNoaXZlUGF0aCA9IG5ld0FwcDtcclxuICAgICAgYXJjaGl2ZUhhc2ggPSBhd2FpdCBmcy5oYXNoKGFyY2hpdmVQYXRoKTtcclxuICAgICAgaWYgKEFQUExJQ0FUSU9OU19DQUNIRS5oYXMoYXBwKSAmJiBhcmNoaXZlSGFzaCA9PT0gQVBQTElDQVRJT05TX0NBQ0hFLmdldChhcHApLmhhc2gpIHtcclxuICAgICAgICBjb25zdCB7ZnVsbFBhdGh9ID0gQVBQTElDQVRJT05TX0NBQ0hFLmdldChhcHApO1xyXG4gICAgICAgIGlmIChhd2FpdCBmcy5leGlzdHMoZnVsbFBhdGgpKSB7XHJcbiAgICAgICAgICBpZiAoYXJjaGl2ZVBhdGggIT09IGFwcCAmJiBsb2NhbEFwcHNGb2xkZXIgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICBhd2FpdCBmcy5yaW1yYWYoYXJjaGl2ZVBhdGgpO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgbG9nZ2VyLmluZm8oYFdpbGwgcmV1c2UgcHJldmlvdXNseSBjYWNoZWQgYXBwbGljYXRpb24gYXQgJyR7ZnVsbFBhdGh9J2ApO1xyXG4gICAgICAgICAgcmV0dXJuIHZlcmlmeUFwcEV4dGVuc2lvbihmdWxsUGF0aCwgc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGxvZ2dlci5pbmZvKGBUaGUgYXBwbGljYXRpb24gYXQgJyR7ZnVsbFBhdGh9JyBkb2VzIG5vdCBleGlzdCBhbnltb3JlLiBEZWxldGluZyBpdCBmcm9tIHRoZSBjYWNoZWApO1xyXG4gICAgICAgIEFQUExJQ0FUSU9OU19DQUNIRS5kZWwoYXBwKTtcclxuICAgICAgfVxyXG4gICAgICBjb25zdCB0bXBSb290ID0gYXdhaXQgdGVtcERpci5vcGVuRGlyKCk7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgbmV3QXBwID0gYXdhaXQgdW56aXBBcHAoYXJjaGl2ZVBhdGgsIHRtcFJvb3QsIHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMpO1xyXG4gICAgICB9IGZpbmFsbHkge1xyXG4gICAgICAgIGlmIChuZXdBcHAgIT09IGFyY2hpdmVQYXRoICYmIGFyY2hpdmVQYXRoICE9PSBhcHAgJiYgbG9jYWxBcHBzRm9sZGVyID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgIGF3YWl0IGZzLnJpbXJhZihhcmNoaXZlUGF0aCk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIGxvZ2dlci5pbmZvKGBVbnppcHBlZCBsb2NhbCBhcHAgdG8gJyR7bmV3QXBwfSdgKTtcclxuICAgIH0gZWxzZSBpZiAoIXBhdGguaXNBYnNvbHV0ZShuZXdBcHApKSB7XHJcbiAgICAgIG5ld0FwcCA9IHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpLCBuZXdBcHApO1xyXG4gICAgICBsb2dnZXIud2FybihgVGhlIGN1cnJlbnQgYXBwbGljYXRpb24gcGF0aCAnJHthcHB9JyBpcyBub3QgYWJzb2x1dGUgYCArXHJcbiAgICAgICAgYGFuZCBoYXMgYmVlbiByZXdyaXR0ZW4gdG8gJyR7bmV3QXBwfScuIENvbnNpZGVyIHVzaW5nIGFic29sdXRlIHBhdGhzIHJhdGhlciB0aGFuIHJlbGF0aXZlYCk7XHJcbiAgICAgIGFwcCA9IG5ld0FwcDtcclxuICAgIH1cclxuXHJcbiAgICB2ZXJpZnlBcHBFeHRlbnNpb24obmV3QXBwLCBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zKTtcclxuXHJcbiAgICBpZiAoYXBwICE9PSBuZXdBcHAgJiYgKGFyY2hpdmVIYXNoIHx8IF8udmFsdWVzKHJlbW90ZUFwcFByb3BzKS5zb21lKEJvb2xlYW4pKSkge1xyXG4gICAgICBpZiAoQVBQTElDQVRJT05TX0NBQ0hFLmhhcyhhcHApKSB7XHJcbiAgICAgICAgY29uc3Qge2Z1bGxQYXRofSA9IEFQUExJQ0FUSU9OU19DQUNIRS5nZXQoYXBwKTtcclxuICAgICAgICAvLyBDbGVhbiB1cCB0aGUgb2Jzb2xldGUgZW50cnkgZmlyc3QgaWYgbmVlZGVkXHJcbiAgICAgICAgaWYgKGZ1bGxQYXRoICE9PSBuZXdBcHAgJiYgYXdhaXQgZnMuZXhpc3RzKGZ1bGxQYXRoKSkge1xyXG4gICAgICAgICAgYXdhaXQgZnMucmltcmFmKGZ1bGxQYXRoKTtcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgICAgQVBQTElDQVRJT05TX0NBQ0hFLnNldChhcHAsIHtcclxuICAgICAgICAuLi5yZW1vdGVBcHBQcm9wcyxcclxuICAgICAgICB0aW1lc3RhbXA6IERhdGUubm93KCksXHJcbiAgICAgICAgaGFzaDogYXJjaGl2ZUhhc2gsXHJcbiAgICAgICAgZnVsbFBhdGg6IG5ld0FwcCxcclxuICAgICAgfSk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gbmV3QXBwO1xyXG4gIH0pO1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBkb3dubG9hZEFwcCAoYXBwLCB0YXJnZXRQYXRoKSB7XHJcbiAgY29uc3Qge2hyZWZ9ID0gdXJsLnBhcnNlKGFwcCk7XHJcbiAgdHJ5IHtcclxuICAgIGF3YWl0IG5ldC5kb3dubG9hZEZpbGUoaHJlZiwgdGFyZ2V0UGF0aCwge1xyXG4gICAgICB0aW1lb3V0OiBBUFBfRE9XTkxPQURfVElNRU9VVF9NUyxcclxuICAgIH0pO1xyXG4gIH0gY2F0Y2ggKGVycikge1xyXG4gICAgdGhyb3cgbmV3IEVycm9yKGBVbmFibGUgdG8gZG93bmxvYWQgdGhlIGFwcDogJHtlcnIubWVzc2FnZX1gKTtcclxuICB9XHJcbiAgcmV0dXJuIHRhcmdldFBhdGg7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBFeHRyYWN0cyB0aGUgYnVuZGxlIGZyb20gYW4gYXJjaGl2ZSBpbnRvIHRoZSBnaXZlbiBmb2xkZXJcclxuICpcclxuICogQHBhcmFtIHtzdHJpbmd9IHppcFBhdGggRnVsbCBwYXRoIHRvIHRoZSBhcmNoaXZlIGNvbnRhaW5pbmcgdGhlIGJ1bmRsZVxyXG4gKiBAcGFyYW0ge3N0cmluZ30gZHN0Um9vdCBGdWxsIHBhdGggdG8gdGhlIGZvbGRlciB3aGVyZSB0aGUgZXh0cmFjdGVkIGJ1bmRsZVxyXG4gKiBzaG91bGQgYmUgcGxhY2VkXHJcbiAqIEBwYXJhbSB7QXJyYXk8c3RyaW5nPnxzdHJpbmd9IHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMgVGhlIGxpc3Qgb2YgZXh0ZW5zaW9uc1xyXG4gKiB0aGUgdGFyZ2V0IGFwcGxpY2F0aW9uIGJ1bmRsZSBzdXBwb3J0cywgZm9yIGV4YW1wbGUgWycuYXBrJywgJy5hcGtzJ10gZm9yXHJcbiAqIEFuZHJvaWQgcGFja2FnZXNcclxuICogQHJldHVybnMge3N0cmluZ30gRnVsbCBwYXRoIHRvIHRoZSBidW5kbGUgaW4gdGhlIGRlc3RpbmF0aW9uIGZvbGRlclxyXG4gKiBAdGhyb3dzIHtFcnJvcn0gSWYgdGhlIGdpdmVuIGFyY2hpdmUgaXMgaW52YWxpZCBvciBubyBhcHBsaWNhdGlvbiBidW5kbGVzXHJcbiAqIGhhdmUgYmVlbiBmb3VuZCBpbnNpZGVcclxuICovXHJcbmFzeW5jIGZ1bmN0aW9uIHVuemlwQXBwICh6aXBQYXRoLCBkc3RSb290LCBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zKSB7XHJcbiAgYXdhaXQgemlwLmFzc2VydFZhbGlkWmlwKHppcFBhdGgpO1xyXG5cclxuICBpZiAoIV8uaXNBcnJheShzdXBwb3J0ZWRBcHBFeHRlbnNpb25zKSkge1xyXG4gICAgc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucyA9IFtzdXBwb3J0ZWRBcHBFeHRlbnNpb25zXTtcclxuICB9XHJcblxyXG4gIGNvbnN0IHRtcFJvb3QgPSBhd2FpdCB0ZW1wRGlyLm9wZW5EaXIoKTtcclxuICB0cnkge1xyXG4gICAgbG9nZ2VyLmRlYnVnKGBVbnppcHBpbmcgJyR7emlwUGF0aH0nYCk7XHJcbiAgICBjb25zdCB0aW1lciA9IG5ldyB0aW1pbmcuVGltZXIoKS5zdGFydCgpO1xyXG4gICAgY29uc3QgdXNlU3lzdGVtVW56aXBFbnYgPSBwcm9jZXNzLmVudi5BUFBJVU1fUFJFRkVSX1NZU1RFTV9VTlpJUDtcclxuICAgIGNvbnN0IHVzZVN5c3RlbVVuemlwID0gXy5pc0VtcHR5KHVzZVN5c3RlbVVuemlwRW52KVxyXG4gICAgICB8fCAhWycwJywgJ2ZhbHNlJ10uaW5jbHVkZXMoXy50b0xvd2VyKHVzZVN5c3RlbVVuemlwRW52KSk7XHJcbiAgICAvKipcclxuICAgICAqIEF0dGVtcHQgdG8gdXNlIHVzZSB0aGUgc3lzdGVtIGB1bnppcGAgKGUuZy4sIGAvdXNyL2Jpbi91bnppcGApIGR1ZVxyXG4gICAgICogdG8gdGhlIHNpZ25pZmljYW50IHBlcmZvcm1hbmNlIGltcHJvdmVtZW50IGl0IHByb3ZpZGVzIG92ZXIgdGhlIG5hdGl2ZVxyXG4gICAgICogSlMgXCJ1bnppcFwiIGltcGxlbWVudGF0aW9uLlxyXG4gICAgICogQHR5cGUge2ltcG9ydCgnYXBwaXVtLXN1cHBvcnQvbGliL3ppcCcpLkV4dHJhY3RBbGxPcHRpb25zfVxyXG4gICAgICovXHJcbiAgICBjb25zdCBleHRyYWN0aW9uT3B0cyA9IHt1c2VTeXN0ZW1VbnppcH07XHJcbiAgICAvLyBodHRwczovL2dpdGh1Yi5jb20vYXBwaXVtL2FwcGl1bS9pc3N1ZXMvMTQxMDBcclxuICAgIGlmIChwYXRoLmV4dG5hbWUoemlwUGF0aCkgPT09IElQQV9FWFQpIHtcclxuICAgICAgbG9nZ2VyLmRlYnVnKGBFbmZvcmNpbmcgVVRGLTggZW5jb2Rpbmcgb24gdGhlIGV4dHJhY3RlZCBmaWxlIG5hbWVzIGZvciAnJHtwYXRoLmJhc2VuYW1lKHppcFBhdGgpfSdgKTtcclxuICAgICAgZXh0cmFjdGlvbk9wdHMuZmlsZU5hbWVzRW5jb2RpbmcgPSAndXRmOCc7XHJcbiAgICB9XHJcbiAgICBhd2FpdCB6aXAuZXh0cmFjdEFsbFRvKHppcFBhdGgsIHRtcFJvb3QsIGV4dHJhY3Rpb25PcHRzKTtcclxuICAgIGNvbnN0IGdsb2JQYXR0ZXJuID0gYCoqLyouKygke3N1cHBvcnRlZEFwcEV4dGVuc2lvbnMubWFwKChleHQpID0+IGV4dC5yZXBsYWNlKC9eXFwuLywgJycpKS5qb2luKCd8Jyl9KWA7XHJcbiAgICBjb25zdCBzb3J0ZWRCdW5kbGVJdGVtcyA9IChhd2FpdCBmcy5nbG9iKGdsb2JQYXR0ZXJuLCB7XHJcbiAgICAgIGN3ZDogdG1wUm9vdCxcclxuICAgICAgc3RyaWN0OiBmYWxzZSxcclxuICAgIC8vIEdldCB0aGUgdG9wIGxldmVsIG1hdGNoXHJcbiAgICB9KSkuc29ydCgoYSwgYikgPT4gYS5zcGxpdChwYXRoLnNlcCkubGVuZ3RoIC0gYi5zcGxpdChwYXRoLnNlcCkubGVuZ3RoKTtcclxuICAgIGlmIChfLmlzRW1wdHkoc29ydGVkQnVuZGxlSXRlbXMpKSB7XHJcbiAgICAgIGxvZ2dlci5lcnJvckFuZFRocm93KGBBcHAgdW56aXBwZWQgT0ssIGJ1dCB3ZSBjb3VsZCBub3QgZmluZCBhbnkgJyR7c3VwcG9ydGVkQXBwRXh0ZW5zaW9uc30nIGAgK1xyXG4gICAgICAgIHV0aWwucGx1cmFsaXplKCdidW5kbGUnLCBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zLmxlbmd0aCwgZmFsc2UpICtcclxuICAgICAgICBgIGluIGl0LiBNYWtlIHN1cmUgeW91ciBhcmNoaXZlIGNvbnRhaW5zIGF0IGxlYXN0IG9uZSBwYWNrYWdlIGhhdmluZyBgICtcclxuICAgICAgICBgJyR7c3VwcG9ydGVkQXBwRXh0ZW5zaW9uc30nICR7dXRpbC5wbHVyYWxpemUoJ2V4dGVuc2lvbicsIHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMubGVuZ3RoLCBmYWxzZSl9YCk7XHJcbiAgICB9XHJcbiAgICBsb2dnZXIuZGVidWcoYEV4dHJhY3RlZCAke3V0aWwucGx1cmFsaXplKCdidW5kbGUgaXRlbScsIHNvcnRlZEJ1bmRsZUl0ZW1zLmxlbmd0aCwgdHJ1ZSl9IGAgK1xyXG4gICAgICBgZnJvbSAnJHt6aXBQYXRofScgaW4gJHtNYXRoLnJvdW5kKHRpbWVyLmdldER1cmF0aW9uKCkuYXNNaWxsaVNlY29uZHMpfW1zOiAke3NvcnRlZEJ1bmRsZUl0ZW1zfWApO1xyXG4gICAgY29uc3QgbWF0Y2hlZEJ1bmRsZSA9IF8uZmlyc3Qoc29ydGVkQnVuZGxlSXRlbXMpO1xyXG4gICAgbG9nZ2VyLmluZm8oYEFzc3VtaW5nICcke21hdGNoZWRCdW5kbGV9JyBpcyB0aGUgY29ycmVjdCBidW5kbGVgKTtcclxuICAgIGNvbnN0IGRzdFBhdGggPSBwYXRoLnJlc29sdmUoZHN0Um9vdCwgcGF0aC5iYXNlbmFtZShtYXRjaGVkQnVuZGxlKSk7XHJcbiAgICBhd2FpdCBmcy5tdihwYXRoLnJlc29sdmUodG1wUm9vdCwgbWF0Y2hlZEJ1bmRsZSksIGRzdFBhdGgsIHtta2RpcnA6IHRydWV9KTtcclxuICAgIHJldHVybiBkc3RQYXRoO1xyXG4gIH0gZmluYWxseSB7XHJcbiAgICBhd2FpdCBmcy5yaW1yYWYodG1wUm9vdCk7XHJcbiAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiBpc1BhY2thZ2VPckJ1bmRsZSAoYXBwKSB7XHJcbiAgcmV0dXJuICgvXihbYS16QS1aMC05XFwtX10rXFwuW2EtekEtWjAtOVxcLV9dKykrJC8pLnRlc3QoYXBwKTtcclxufVxyXG5cclxuLyoqXHJcbiAqIEZpbmRzIGFsbCBpbnN0YW5jZXMgJ2ZpcnN0S2V5JyBhbmQgY3JlYXRlIGEgZHVwbGljYXRlIHdpdGggdGhlIGtleSAnc2Vjb25kS2V5JyxcclxuICogRG8gdGhlIHNhbWUgdGhpbmcgaW4gcmV2ZXJzZS4gSWYgd2UgZmluZCAnc2Vjb25kS2V5JywgY3JlYXRlIGEgZHVwbGljYXRlIHdpdGggdGhlIGtleSAnZmlyc3RLZXknLlxyXG4gKlxyXG4gKiBUaGlzIHdpbGwgY2F1c2Uga2V5cyB0byBiZSBvdmVyd3JpdHRlbiBpZiB0aGUgb2JqZWN0IGNvbnRhaW5zICdmaXJzdEtleScgYW5kICdzZWNvbmRLZXknLlxyXG5cclxuICogQHBhcmFtIHsqfSBpbnB1dCBBbnkgdHlwZSBvZiBpbnB1dFxyXG4gKiBAcGFyYW0ge1N0cmluZ30gZmlyc3RLZXkgVGhlIGZpcnN0IGtleSB0byBkdXBsaWNhdGVcclxuICogQHBhcmFtIHtTdHJpbmd9IHNlY29uZEtleSBUaGUgc2Vjb25kIGtleSB0byBkdXBsaWNhdGVcclxuICovXHJcbmZ1bmN0aW9uIGR1cGxpY2F0ZUtleXMgKGlucHV0LCBmaXJzdEtleSwgc2Vjb25kS2V5KSB7XHJcbiAgLy8gSWYgYXJyYXkgcHJvdmlkZWQsIHJlY3Vyc2l2ZWx5IGNhbGwgb24gYWxsIGVsZW1lbnRzXHJcbiAgaWYgKF8uaXNBcnJheShpbnB1dCkpIHtcclxuICAgIHJldHVybiBpbnB1dC5tYXAoKGl0ZW0pID0+IGR1cGxpY2F0ZUtleXMoaXRlbSwgZmlyc3RLZXksIHNlY29uZEtleSkpO1xyXG4gIH1cclxuXHJcbiAgLy8gSWYgb2JqZWN0LCBjcmVhdGUgZHVwbGljYXRlcyBmb3Iga2V5cyBhbmQgdGhlbiByZWN1cnNpdmVseSBjYWxsIG9uIHZhbHVlc1xyXG4gIGlmIChfLmlzUGxhaW5PYmplY3QoaW5wdXQpKSB7XHJcbiAgICBjb25zdCByZXN1bHRPYmogPSB7fTtcclxuICAgIGZvciAobGV0IFtrZXksIHZhbHVlXSBvZiBfLnRvUGFpcnMoaW5wdXQpKSB7XHJcbiAgICAgIGNvbnN0IHJlY3Vyc2l2ZWx5Q2FsbGVkVmFsdWUgPSBkdXBsaWNhdGVLZXlzKHZhbHVlLCBmaXJzdEtleSwgc2Vjb25kS2V5KTtcclxuICAgICAgaWYgKGtleSA9PT0gZmlyc3RLZXkpIHtcclxuICAgICAgICByZXN1bHRPYmpbc2Vjb25kS2V5XSA9IHJlY3Vyc2l2ZWx5Q2FsbGVkVmFsdWU7XHJcbiAgICAgIH0gZWxzZSBpZiAoa2V5ID09PSBzZWNvbmRLZXkpIHtcclxuICAgICAgICByZXN1bHRPYmpbZmlyc3RLZXldID0gcmVjdXJzaXZlbHlDYWxsZWRWYWx1ZTtcclxuICAgICAgfVxyXG4gICAgICByZXN1bHRPYmpba2V5XSA9IHJlY3Vyc2l2ZWx5Q2FsbGVkVmFsdWU7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gcmVzdWx0T2JqO1xyXG4gIH1cclxuXHJcbiAgLy8gQmFzZSBjYXNlLiBSZXR1cm4gcHJpbWl0aXZlcyB3aXRob3V0IGRvaW5nIGFueXRoaW5nLlxyXG4gIHJldHVybiBpbnB1dDtcclxufVxyXG5cclxuLyoqXHJcbiAqIFRha2VzIGEgZGVzaXJlZCBjYXBhYmlsaXR5IGFuZCB0cmllcyB0byBKU09OLnBhcnNlIGl0IGFzIGFuIGFycmF5LFxyXG4gKiBhbmQgZWl0aGVyIHJldHVybnMgdGhlIHBhcnNlZCBhcnJheSBvciBhIHNpbmdsZXRvbiBhcnJheS5cclxuICpcclxuICogQHBhcmFtIHtzdHJpbmd8QXJyYXk8U3RyaW5nPn0gY2FwIEEgZGVzaXJlZCBjYXBhYmlsaXR5XHJcbiAqL1xyXG5mdW5jdGlvbiBwYXJzZUNhcHNBcnJheSAoY2FwKSB7XHJcbiAgaWYgKF8uaXNBcnJheShjYXApKSB7XHJcbiAgICByZXR1cm4gY2FwO1xyXG4gIH1cclxuXHJcbiAgbGV0IHBhcnNlZENhcHM7XHJcbiAgdHJ5IHtcclxuICAgIHBhcnNlZENhcHMgPSBKU09OLnBhcnNlKGNhcCk7XHJcbiAgICBpZiAoXy5pc0FycmF5KHBhcnNlZENhcHMpKSB7XHJcbiAgICAgIHJldHVybiBwYXJzZWRDYXBzO1xyXG4gICAgfVxyXG4gIH0gY2F0Y2ggKGlnbikge1xyXG4gICAgbG9nZ2VyLndhcm4oYEZhaWxlZCB0byBwYXJzZSBjYXBhYmlsaXR5IGFzIEpTT04gYXJyYXlgKTtcclxuICB9XHJcbiAgaWYgKF8uaXNTdHJpbmcoY2FwKSkge1xyXG4gICAgcmV0dXJuIFtjYXBdO1xyXG4gIH1cclxuICB0aHJvdyBuZXcgRXJyb3IoYG11c3QgcHJvdmlkZSBhIHN0cmluZyBvciBKU09OIEFycmF5OyByZWNlaXZlZCAke2NhcH1gKTtcclxufVxyXG5cclxuZXhwb3J0IHtcclxuICBjb25maWd1cmVBcHAsIGlzUGFja2FnZU9yQnVuZGxlLCBkdXBsaWNhdGVLZXlzLCBwYXJzZUNhcHNBcnJheVxyXG59O1xyXG4iXSwiZmlsZSI6ImxpYi9iYXNlZHJpdmVyL2hlbHBlcnMuanMiLCJzb3VyY2VSb290IjoiLi5cXC4uXFwuLiJ9
