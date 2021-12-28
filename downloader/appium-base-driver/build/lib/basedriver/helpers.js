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
  const localAppsFolder = await (0, _mcloudUtils.getLocalAppsFolder)();
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
      let localFile;
      let lockFile;

      if (localAppsFolder != undefined) {
        localFile = await (0, _mcloudUtils.getLocalFileForAppUrl)(newApp);
        lockFile = localFile + '.lock';

        if (await _appiumSupport.fs.exists(localFile)) {
          _logger.default.info(`Local version of app was found. Will check actuality of the file`);

          const remoteFileLength = await (0, _mcloudUtils.getFileContentLength)(app);
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

          const waitingTime = 5000;
          var maxAttemptsCount = 5 * 12;
          var attemptsCount = 0;

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


//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImxpYi9iYXNlZHJpdmVyL2hlbHBlcnMuanMiXSwibmFtZXMiOlsiSVBBX0VYVCIsIlpJUF9FWFRTIiwiWklQX01JTUVfVFlQRVMiLCJDQUNIRURfQVBQU19NQVhfQUdFIiwiQVBQTElDQVRJT05TX0NBQ0hFIiwiTFJVIiwibWF4QWdlIiwidXBkYXRlQWdlT25HZXQiLCJkaXNwb3NlIiwiYXBwIiwiZnVsbFBhdGgiLCJmcyIsImV4aXN0cyIsImxvZ2dlciIsImluZm8iLCJyaW1yYWYiLCJub0Rpc3Bvc2VPblNldCIsIkFQUExJQ0FUSU9OU19DQUNIRV9HVUFSRCIsIkFzeW5jTG9jayIsIlNBTklUSVpFX1JFUExBQ0VNRU5UIiwiREVGQVVMVF9CQVNFTkFNRSIsIkFQUF9ET1dOTE9BRF9USU1FT1VUX01TIiwicHJvY2VzcyIsIm9uIiwiaXRlbUNvdW50IiwiYXBwUGF0aHMiLCJ2YWx1ZXMiLCJtYXAiLCJkZWJ1ZyIsImxlbmd0aCIsInV0aWwiLCJwbHVyYWxpemUiLCJhcHBQYXRoIiwicmltcmFmU3luYyIsImUiLCJ3YXJuIiwibWVzc2FnZSIsInJldHJpZXZlSGVhZGVycyIsImxpbmsiLCJ1cmwiLCJtZXRob2QiLCJ0aW1lb3V0IiwiaGVhZGVycyIsImdldENhY2hlZEFwcGxpY2F0aW9uUGF0aCIsImN1cnJlbnRBcHBQcm9wcyIsInJlZnJlc2giLCJoYXMiLCJsYXN0TW9kaWZpZWQiLCJjdXJyZW50TW9kaWZpZWQiLCJpbW11dGFibGUiLCJjdXJyZW50SW1tdXRhYmxlIiwiY3VycmVudE1heEFnZSIsInRpbWVzdGFtcCIsImdldCIsImdldFRpbWUiLCJtc0xlZnQiLCJEYXRlIiwibm93IiwicGF0aCIsImJhc2VuYW1lIiwidmVyaWZ5QXBwRXh0ZW5zaW9uIiwic3VwcG9ydGVkQXBwRXh0ZW5zaW9ucyIsImluY2x1ZGVzIiwiZXh0bmFtZSIsIkVycm9yIiwiY29uZmlndXJlQXBwIiwiXyIsImlzU3RyaW5nIiwiaXNBcnJheSIsIm5ld0FwcCIsInNob3VsZFVuemlwQXBwIiwiYXJjaGl2ZUhhc2giLCJsb2NhbEFwcHNGb2xkZXIiLCJyZW1vdGVBcHBQcm9wcyIsInByb3RvY29sIiwicGF0aG5hbWUiLCJwYXJzZSIsImlzVXJsIiwiYWNxdWlyZSIsImlzRW1wdHkiLCJ0ZXN0IiwibWF4QWdlTWF0Y2giLCJleGVjIiwicGFyc2VJbnQiLCJkb3dubG9hZElzTmVhZGVkIiwibG9jYWxGaWxlIiwibG9ja0ZpbGUiLCJ1bmRlZmluZWQiLCJyZW1vdGVGaWxlTGVuZ3RoIiwic3RhdHMiLCJzdGF0IiwibG9jYWxGaWxlTGVuZ3RoIiwic2l6ZSIsInVubGluayIsIndhaXRpbmdUaW1lIiwibWF4QXR0ZW1wdHNDb3VudCIsImF0dGVtcHRzQ291bnQiLCJQcm9taXNlIiwicmVzb2x2ZSIsInNldFRpbWVvdXQiLCJzaGFyZWRGb2xkZXJQYXRoIiwiY2xvc2UiLCJvcGVuIiwiY2FjaGVkUGF0aCIsImRlbCIsImZpbGVOYW1lIiwic2FuaXRpemVOYW1lIiwiZGVjb2RlVVJJQ29tcG9uZW50IiwicmVwbGFjZW1lbnQiLCJjdCIsInNvbWUiLCJtaW1lVHlwZSIsIlJlZ0V4cCIsImVzY2FwZVJlZ0V4cCIsIm1hdGNoIiwicmVzdWx0aW5nTmFtZSIsInN1YnN0cmluZyIsInJlc3VsdGluZ0V4dCIsImZpcnN0IiwidGFyZ2V0UGF0aCIsInRlbXBEaXIiLCJwcmVmaXgiLCJzdWZmaXgiLCJkb3dubG9hZEFwcCIsImNvcHlGaWxlIiwiZXJyb3JNZXNzYWdlIiwiYXJjaGl2ZVBhdGgiLCJoYXNoIiwidG1wUm9vdCIsIm9wZW5EaXIiLCJ1bnppcEFwcCIsImlzQWJzb2x1dGUiLCJjd2QiLCJCb29sZWFuIiwic2V0IiwiaHJlZiIsIm5ldCIsImRvd25sb2FkRmlsZSIsImVyciIsInppcFBhdGgiLCJkc3RSb290IiwiemlwIiwiYXNzZXJ0VmFsaWRaaXAiLCJ0aW1lciIsInRpbWluZyIsIlRpbWVyIiwic3RhcnQiLCJ1c2VTeXN0ZW1VbnppcEVudiIsImVudiIsIkFQUElVTV9QUkVGRVJfU1lTVEVNX1VOWklQIiwidXNlU3lzdGVtVW56aXAiLCJ0b0xvd2VyIiwiZXh0cmFjdGlvbk9wdHMiLCJmaWxlTmFtZXNFbmNvZGluZyIsImV4dHJhY3RBbGxUbyIsImdsb2JQYXR0ZXJuIiwiZXh0IiwicmVwbGFjZSIsImpvaW4iLCJzb3J0ZWRCdW5kbGVJdGVtcyIsImdsb2IiLCJzdHJpY3QiLCJzb3J0IiwiYSIsImIiLCJzcGxpdCIsInNlcCIsImVycm9yQW5kVGhyb3ciLCJNYXRoIiwicm91bmQiLCJnZXREdXJhdGlvbiIsImFzTWlsbGlTZWNvbmRzIiwibWF0Y2hlZEJ1bmRsZSIsImRzdFBhdGgiLCJtdiIsIm1rZGlycCIsImlzUGFja2FnZU9yQnVuZGxlIiwiZHVwbGljYXRlS2V5cyIsImlucHV0IiwiZmlyc3RLZXkiLCJzZWNvbmRLZXkiLCJpdGVtIiwiaXNQbGFpbk9iamVjdCIsInJlc3VsdE9iaiIsImtleSIsInZhbHVlIiwidG9QYWlycyIsInJlY3Vyc2l2ZWx5Q2FsbGVkVmFsdWUiLCJwYXJzZUNhcHNBcnJheSIsImNhcCIsInBhcnNlZENhcHMiLCJKU09OIiwiaWduIl0sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7OztBQUFBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUVBLE1BQU1BLE9BQU8sR0FBRyxNQUFoQjtBQUNBLE1BQU1DLFFBQVEsR0FBRyxDQUFDLE1BQUQsRUFBU0QsT0FBVCxDQUFqQjtBQUNBLE1BQU1FLGNBQWMsR0FBRyxDQUNyQixpQkFEcUIsRUFFckIsOEJBRnFCLEVBR3JCLGlCQUhxQixDQUF2QjtBQUtBLE1BQU1DLG1CQUFtQixHQUFHLE9BQU8sRUFBUCxHQUFZLEVBQVosR0FBaUIsRUFBN0M7QUFDQSxNQUFNQyxrQkFBa0IsR0FBRyxJQUFJQyxpQkFBSixDQUFRO0FBQ2pDQyxFQUFBQSxNQUFNLEVBQUVILG1CQUR5QjtBQUVqQ0ksRUFBQUEsY0FBYyxFQUFFLElBRmlCO0FBR2pDQyxFQUFBQSxPQUFPLEVBQUUsT0FBT0Ms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QVA7QUFDRDs7QUFRRCxTQUFTVSxjQUFULENBQXlCQyxHQUF6QixFQUE4QjtBQUM1QixNQUFJM0gsZ0JBQUVFLE9BQUYsQ0FBVXlILEdBQVYsQ0FBSixFQUFvQjtBQUNsQixXQUFPQSxHQUFQO0FBQ0Q7O0FBRUQsTUFBSUMsVUFBSjs7QUFDQSxNQUFJO0FBQ0ZBLElBQUFBLFVBQVUsR0FBR0MsSUFBSSxDQUFDbkgsS0FBTCxDQUFXaUgsR0FBWCxDQUFiOztBQUNBLFFBQUkzSCxnQkFBRUUsT0FBRixDQUFVMEgsVUFBVixDQUFKLEVBQTJCO0FBQ3pCLGFBQU9BLFVBQVA7QUFDRDtBQUNGLEdBTEQsQ0FLRSxPQUFPRSxHQUFQLEVBQVk7QUFDWm5MLG9CQUFPc0IsSUFBUCxDQUFhLDBDQUFiO0FBQ0Q7O0FBQ0QsTUFBSStCLGdCQUFFQyxRQUFGLENBQVcwSCxHQUFYLENBQUosRUFBcUI7QUFDbkIsV0FBTyxDQUFDQSxHQUFELENBQVA7QUFDRDs7QUFDRCxRQUFNLElBQUk3SCxLQUFKLENBQVcsaURBQWdENkgsR0FBSSxFQUEvRCxDQUFOO0FBQ0QiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgXyBmcm9tICdsb2Rhc2gnO1xyXG5pbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcclxuaW1wb3J0IHVybCBmcm9tICd1cmwnO1xyXG5pbXBvcnQgbG9nZ2VyIGZyb20gJy4vbG9nZ2VyJztcclxuaW1wb3J0IHsgdGVtcERpciwgZnMsIHV0aWwsIHppcCwgbmV0LCB0aW1pbmcgfSBmcm9tICdhcHBpdW0tc3VwcG9ydCc7XHJcbmltcG9ydCBMUlUgZnJvbSAnbHJ1LWNhY2hlJztcclxuaW1wb3J0IEFzeW5jTG9jayBmcm9tICdhc3luYy1sb2NrJztcclxuaW1wb3J0IGF4aW9zIGZyb20gJ2F4aW9zJztcclxuaW1wb3J0IHsgZ2V0TG9jYWxBcHBzRm9sZGVyLCBnZXRTaGFyZWRGb2xkZXJGb3JBcHBVcmwsIGdldExvY2FsRmlsZUZvckFwcFVybCwgZ2V0RmlsZUNvbnRlbnRMZW5ndGggfSBmcm9tICcuL21jbG91ZC11dGlscyc7XHJcblxyXG5jb25zdCBJUEFfRVhUID0gJy5pcGEnO1xyXG5jb25zdCBaSVBfRVhUUyA9IFsnLnppcCcsIElQQV9FWFRdO1xyXG5jb25zdCBaSVBfTUlNRV9UWVBFUyA9IFtcclxuICAnYXBwbGljYXRpb24vemlwJyxcclxuICAnYXBwbGljYXRpb24veC16aXAtY29tcHJlc3NlZCcsXHJcbiAgJ211bHRpcGFydC94LXppcCcsXHJcbl07XHJcbmNvbnN0IENBQ0hFRF9BUFBTX01BWF9BR0UgPSAxMDAwICogNjAgKiA2MCAqIDI0OyAvLyBtc1xyXG5jb25zdCBBUFBMSUNBVElPTlNfQ0FDSEUgPSBuZXcgTFJVKHtcclxuICBtYXhBZ2U6IENBQ0hFRF9BUFBTX01BWF9BR0UsIC8vIGV4cGlyZSBhZnRlciAyNCBob3Vyc1xyXG4gIHVwZGF0ZUFnZU9uR2V0OiB0cnVlLFxyXG4gIGRpc3Bvc2U6IGFzeW5jIChhcHAsIHtmdWxsUGF0aH0pID0+IHtcclxuICAgIGlmICghYXdhaXQgZnMuZXhpc3RzKGZ1bGxQYXRoKSkge1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgbG9nZ2VyLmluZm8oYFRoZSBhcHBsaWNhdGlvbiAnJHthcHB9JyBjYWNoZWQgYXQgJyR7ZnVsbFBhdGh9JyBoYXMgZXhwaXJlZGApO1xyXG4gICAgYXdhaXQgZnMucmltcmFmKGZ1bGxQYXRoKTtcclxuICB9LFxyXG4gIG5vRGlzcG9zZU9uU2V0OiB0cnVlLFxyXG59KTtcclxuY29uc3QgQVBQTElDQVRJT05TX0NBQ0hFX0dVQVJEID0gbmV3IEFzeW5jTG9jaygpO1xyXG5jb25zdCBTQU5JVElaRV9SRVBMQUNFTUVOVCA9ICctJztcclxuY29uc3QgREVGQVVMVF9CQVNFTkFNRSA9ICdhcHBpdW0tYXBwJztcclxuY29uc3QgQVBQX0RPV05MT0FEX1RJTUVPVVRfTVMgPSAxMjAgKiAxMDAwO1xyXG5cclxucHJvY2Vzcy5vbignZXhpdCcsICgpID0+IHtcclxuICBpZiAoQVBQTElDQVRJT05TX0NBQ0hFLml0ZW1Db3VudCA9PT0gMCkge1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuXHJcbiAgY29uc3QgYXBwUGF0aHMgPSBBUFBMSUNBVElPTlNfQ0FDSEUudmFsdWVzKClcclxuICAgIC5tYXAoKHtmdWxsUGF0aH0pID0+IGZ1bGxQYXRoKTtcclxuICBsb2dnZXIuZGVidWcoYFBlcmZvcm1pbmcgY2xlYW51cCBvZiAke2FwcFBhdGhzLmxlbmd0aH0gY2FjaGVkIGAgK1xyXG4gICAgdXRpbC5wbHVyYWxpemUoJ2FwcGxpY2F0aW9uJywgYXBwUGF0aHMubGVuZ3RoKSk7XHJcbiAgZm9yIChjb25zdCBhcHBQYXRoIG9mIGFwcFBhdGhzKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICAvLyBBc3luY2hyb25vdXMgY2FsbHMgYXJlIG5vdCBzdXBwb3J0ZWQgaW4gb25FeGl0IGhhbmRsZXJcclxuICAgICAgZnMucmltcmFmU3luYyhhcHBQYXRoKTtcclxuICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgbG9nZ2VyLndhcm4oZS5tZXNzYWdlKTtcclxuICAgIH1cclxuICB9XHJcbn0pO1xyXG5cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIHJldHJpZXZlSGVhZGVycyAobGluaykge1xyXG4gIHRyeSB7XHJcbiAgICByZXR1cm4gKGF3YWl0IGF4aW9zKHtcclxuICAgICAgdXJsOiBsaW5rLFxyXG4gICAgICBtZXRob2Q6ICdIRUFEJyxcclxuICAgICAgdGltZW91dDogNTAwMCxcclxuICAgIH0pKS5oZWFkZXJzO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGxvZ2dlci5pbmZvKGBDYW5ub3Qgc2VuZCBIRUFEIHJlcXVlc3QgdG8gJyR7bGlua30nLiBPcmlnaW5hbCBlcnJvcjogJHtlLm1lc3NhZ2V9YCk7XHJcbiAgfVxyXG4gIHJldHVybiB7fTtcclxufVxyXG5cclxuZnVuY3Rpb24gZ2V0Q2FjaGVkQXBwbGljYXRpb25QYXRoIChsaW5rLCBjdXJyZW50QXBwUHJvcHMgPSB7fSkge1xyXG4gIGNvbnN0IHJlZnJlc2ggPSAoKSA9PiB7XHJcbiAgICBsb2dnZXIuaW5mbyhgQ1VTVE9NIEhFTFBFUiFgKTtcclxuICAgIGxvZ2dlci5kZWJ1ZyhgQSBmcmVzaCBjb3B5IG9mIHRoZSBhcHBsaWNhdGlvbiBpcyBnb2luZyB0byBiZSBkb3dubG9hZGVkIGZyb20gJHtsaW5rfWApO1xyXG4gICAgcmV0dXJuIG51bGw7XHJcbiAgfTtcclxuXHJcbiAgaWYgKEFQUExJQ0FUSU9OU19DQUNIRS5oYXMobGluaykpIHtcclxuICAgIGNvbnN0IHtcclxuICAgICAgbGFzdE1vZGlmaWVkOiBjdXJyZW50TW9kaWZpZWQsXHJcbiAgICAgIGltbXV0YWJsZTogY3VycmVudEltbXV0YWJsZSxcclxuICAgICAgLy8gbWF4QWdlIGlzIGluIHNlY29uZHNcclxuICAgICAgbWF4QWdlOiBjdXJyZW50TWF4QWdlLFxyXG4gICAgfSA9IGN1cnJlbnRBcHBQcm9wcztcclxuICAgIGNvbnN0IHtcclxuICAgICAgLy8gRGF0ZSBpbnN0YW5jZVxyXG4gICAgICBsYXN0TW9kaWZpZWQsXHJcbiAgICAgIC8vIGJvb2xlYW5cclxuICAgICAgaW1tdXRhYmxlLFxyXG4gICAgICAvLyBVbml4IHRpbWUgaW4gbWlsbGlzZWNvbmRzXHJcbiAgICAgIHRpbWVzdGFtcCxcclxuICAgICAgZnVsbFBhdGgsXHJcbiAgICB9ID0gQVBQTElDQVRJT05TX0NBQ0hFLmdldChsaW5rKTtcclxuICAgIGlmIChsYXN0TW9kaWZpZWQgJiYgY3VycmVudE1vZGlmaWVkKSB7XHJcbiAgICAgIGlmIChjdXJyZW50TW9kaWZpZWQuZ2V0VGltZSgpIDw9IGxhc3RNb2RpZmllZC5nZXRUaW1lKCkpIHtcclxuICAgICAgICBsb2dnZXIuZGVidWcoYFRoZSBhcHBsaWNhdGlvbiBhdCAke2xpbmt9IGhhcyBub3QgYmVlbiBtb2RpZmllZCBzaW5jZSAke2xhc3RNb2RpZmllZH1gKTtcclxuICAgICAgICByZXR1cm4gZnVsbFBhdGg7XHJcbiAgICAgIH1cclxuICAgICAgbG9nZ2VyLmRlYnVnKGBUaGUgYXBwbGljYXRpb24gYXQgJHtsaW5rfSBoYXMgYmVlbiBtb2RpZmllZCBzaW5jZSAke2xhc3RNb2RpZmllZH1gKTtcclxuICAgICAgcmV0dXJuIHJlZnJlc2goKTtcclxuICAgIH1cclxuICAgIGlmIChpbW11dGFibGUgJiYgY3VycmVudEltbXV0YWJsZSkge1xyXG4gICAgICBsb2dnZXIuZGVidWcoYFRoZSBhcHBsaWNhdGlvbiBhdCAke2xpbmt9IGlzIGltbXV0YWJsZWApO1xyXG4gICAgICByZXR1cm4gZnVsbFBhdGg7XHJcbiAgICB9XHJcbiAgICBpZiAoY3VycmVudE1heEFnZSAmJiB0aW1lc3RhbXApIHtcclxuICAgICAgY29uc3QgbXNMZWZ0ID0gdGltZXN0YW1wICsgY3VycmVudE1heEFnZSAqIDEwMDAgLSBEYXRlLm5vdygpO1xyXG4gICAgICBpZiAobXNMZWZ0ID4gMCkge1xyXG4gICAgICAgIGxvZ2dlci5kZWJ1ZyhgVGhlIGNhY2hlZCBhcHBsaWNhdGlvbiAnJHtwYXRoLmJhc2VuYW1lKGZ1bGxQYXRoKX0nIHdpbGwgZXhwaXJlIGluICR7bXNMZWZ0IC8gMTAwMH1zYCk7XHJcbiAgICAgICAgcmV0dXJuIGZ1bGxQYXRoO1xyXG4gICAgICB9XHJcbiAgICAgIGxvZ2dlci5kZWJ1ZyhgVGhlIGNhY2hlZCBhcHBsaWNhdGlvbiAnJHtwYXRoLmJhc2VuYW1lKGZ1bGxQYXRoKX0nIGhhcyBleHBpcmVkYCk7XHJcbiAgICB9XHJcbiAgfVxyXG4gIHJldHVybiByZWZyZXNoKCk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHZlcmlmeUFwcEV4dGVuc2lvbiAoYXBwLCBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zKSB7XHJcbiAgaWYgKHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMuaW5jbHVkZXMocGF0aC5leHRuYW1lKGFwcCkpKSB7XHJcbiAgICByZXR1cm4gYXBwO1xyXG4gIH1cclxuICB0aHJvdyBuZXcgRXJyb3IoYE5ldyBhcHAgcGF0aCAnJHthcHB9JyBkaWQgbm90IGhhdmUgYCArXHJcbiAgICBgJHt1dGlsLnBsdXJhbGl6ZSgnZXh0ZW5zaW9uJywgc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucy5sZW5ndGgsIGZhbHNlKX06IGAgK1xyXG4gICAgc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucyk7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGNvbmZpZ3VyZUFwcCAoYXBwLCBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zKSB7XHJcbiAgaWYgKCFfLmlzU3RyaW5nKGFwcCkpIHtcclxuICAgIC8vIGltbWVkaWF0ZWx5IHNob3J0Y2lyY3VpdCBpZiBub3QgZ2l2ZW4gYW4gYXBwXHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGlmICghXy5pc0FycmF5KHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMpKSB7XHJcbiAgICBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zID0gW3N1cHBvcnRlZEFwcEV4dGVuc2lvbnNdO1xyXG4gIH1cclxuXHJcbiAgbGV0IG5ld0FwcCA9IGFwcDtcclxuICBsZXQgc2hvdWxkVW56aXBBcHAgPSBmYWxzZTtcclxuICBsZXQgYXJjaGl2ZUhhc2ggPSBudWxsO1xyXG4gIGNvbnN0IGxvY2FsQXBwc0ZvbGRlciA9IGF3YWl0IGdldExvY2FsQXBwc0ZvbGRlcigpO1xyXG4gIGNvbnN0IHJlbW90ZUFwcFByb3BzID0ge1xyXG4gICAgbGFzdE1vZGlmaWVkOiBudWxsLFxyXG4gICAgaW1tdXRhYmxlOiBmYWxzZSxcclxuICAgIG1heEFnZTogbnVsbCxcclxuICB9O1xyXG4gIGNvbnN0IHtwcm90b2NvbCwgcGF0aG5hbWV9ID0gdXJsLnBhcnNlKG5ld0FwcCk7XHJcbiAgY29uc3QgaXNVcmwgPSBbJ2h0dHA6JywgJ2h0dHBzOiddLmluY2x1ZGVzKHByb3RvY29sKTtcclxuXHJcbiAgcmV0dXJuIGF3YWl0IEFQUExJQ0FUSU9OU19DQUNIRV9HVUFSRC5hY3F1aXJlKGFwcCwgYXN5bmMgKCkgPT4ge1xyXG4gICAgaWYgKGlzVXJsKSB7XHJcbiAgICAgIC8vIFVzZSB0aGUgYXBwIGZyb20gcmVtb3RlIFVSTFxyXG4gICAgICBsb2dnZXIuaW5mbyhgVXNpbmcgZG93bmxvYWRhYmxlIGFwcCAnJHtuZXdBcHB9J2ApO1xyXG4gICAgICBjb25zdCBoZWFkZXJzID0gYXdhaXQgcmV0cmlldmVIZWFkZXJzKG5ld0FwcCk7XHJcbiAgICAgIGlmICghXy5pc0VtcHR5KGhlYWRlcnMpKSB7XHJcbiAgICAgICAgaWYgKGhlYWRlcnNbJ2xhc3QtbW9kaWZpZWQnXSkge1xyXG4gICAgICAgICAgcmVtb3RlQXBwUHJvcHMubGFzdE1vZGlmaWVkID0gbmV3IERhdGUoaGVhZGVyc1snbGFzdC1tb2RpZmllZCddKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgbG9nZ2VyLmRlYnVnKGBMYXN0LU1vZGlmaWVkOiAke2hlYWRlcnNbJ2xhc3QtbW9kaWZpZWQnXX1gKTtcclxuICAgICAgICBpZiAoaGVhZGVyc1snY2FjaGUtY29udHJvbCddKSB7XHJcbiAgICAgICAgICByZW1vdGVBcHBQcm9wcy5pbW11dGFibGUgPSAvXFxiaW1tdXRhYmxlXFxiL2kudGVzdChoZWFkZXJzWydjYWNoZS1jb250cm9sJ10pO1xyXG4gICAgICAgICAgY29uc3QgbWF4QWdlTWF0Y2ggPSAvXFxibWF4LWFnZT0oXFxkKylcXGIvaS5leGVjKGhlYWRlcnNbJ2NhY2hlLWNvbnRyb2wnXSk7XHJcbiAgICAgICAgICBpZiAobWF4QWdlTWF0Y2gpIHtcclxuICAgICAgICAgICAgcmVtb3RlQXBwUHJvcHMubWF4QWdlID0gcGFyc2VJbnQobWF4QWdlTWF0Y2hbMV0sIDEwKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgbG9nZ2VyLmRlYnVnKGBDYWNoZS1Db250cm9sOiAke2hlYWRlcnNbJ2NhY2hlLWNvbnRyb2wnXX1gKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gKioqKiogQ3VzdG9tIGxvZ2ljIGZvciB2ZXJpZmljYXRpb24gb2YgbG9jYWwgc3RhdGljIHBhdGggZm9yIEFQUHMgKioqKipcclxuICAgICAgbGV0IGRvd25sb2FkSXNOZWFkZWQgPSB0cnVlO1xyXG4gICAgICBsZXQgbG9jYWxGaWxlO1xyXG4gICAgICBsZXQgbG9ja0ZpbGU7XHJcbiAgICAgIGlmKGxvY2FsQXBwc0ZvbGRlciAhPSB1bmRlZmluZWQpIHtcclxuICAgICAgICBsb2NhbEZpbGUgPSBhd2FpdCBnZXRMb2NhbEZpbGVGb3JBcHBVcmwobmV3QXBwKTtcclxuICAgICAgICBsb2NrRmlsZSA9IGxvY2FsRmlsZSArICcubG9jayc7XHJcblxyXG4gICAgICAgIGlmKGF3YWl0IGZzLmV4aXN0cyhsb2NhbEZpbGUpKSB7XHJcbiAgICAgICAgICBsb2dnZXIuaW5mbyhgTG9jYWwgdmVyc2lvbiBvZiBhcHAgd2FzIGZvdW5kLiBXaWxsIGNoZWNrIGFjdHVhbGl0eSBvZiB0aGUgZmlsZWApO1xyXG4gICAgICAgICAgLy8gQ2hlY2tpbmcgb2YgbG9jYWwgYXBwbGljYXRpb24gYWN0dWFsaXR5XHJcbiAgICAgICAgICBjb25zdCByZW1vdGVGaWxlTGVuZ3RoID0gYXdhaXQgZ2V0RmlsZUNvbnRlbnRMZW5ndGgoYXBwKTtcclxuICAgICAgICAgIGNvbnN0IHN0YXRzID0gYXdhaXQgZnMuc3RhdChsb2NhbEZpbGUpO1xyXG4gICAgICAgICAgY29uc3QgbG9jYWxGaWxlTGVuZ3RoID0gc3RhdHMuc2l6ZTtcclxuICAgICAgICAgIGxvZ2dlci5pbmZvKGBSZW1vdGUgZmlsZSBzaXplIGlzICR7cmVtb3RlRmlsZUxlbmd0aH0gYW5kIGxvY2FsIGZpbGUgc2l6ZSBpcyAke2xvY2FsRmlsZUxlbmd0aH1gKTtcclxuICAgICAgICAgIGlmKHJlbW90ZUZpbGVMZW5ndGggIT0gbG9jYWxGaWxlTGVuZ3RoKSB7XHJcbiAgICAgICAgICAgIGxvZ2dlci5pbmZvKGBTaXplcyBkaWZmZXIuIEhlbmNlIHRoYXQncyBuZWVkZWQgdG8gZG93bmxvYWQgZnJlc2ggdmVyc2lvbiBvZiB0aGUgYXBwYCk7XHJcbiAgICAgICAgICAgIGF3YWl0IGZzLnVubGluayhsb2NhbEZpbGUpO1xyXG4gICAgICAgICAgICBkb3dubG9hZElzTmVhZGVkID0gdHJ1ZTtcclxuICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIGxvZ2dlci5pbmZvKGBTaXplcyBhcmUgdGhlIHNhbWUuIEhlbmNlIHdpbGwgdXNlIGFscmVhZHkgc3RvcmVkIGFwcGxpY2F0aW9uIGZvciB0aGUgc2Vzc2lvbmApO1xyXG4gICAgICAgICAgICBuZXdBcHAgPSBsb2NhbEZpbGU7XHJcbiAgICAgICAgICAgIHNob3VsZFVuemlwQXBwID0gWklQX0VYVFMuaW5jbHVkZXMocGF0aC5leHRuYW1lKG5ld0FwcCkpO1xyXG4gICAgICAgICAgICBkb3dubG9hZElzTmVhZGVkID0gZmFsc2U7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfSBlbHNlIGlmIChhd2FpdCBmcy5leGlzdHMobG9ja0ZpbGUpKSB7XHJcbiAgICAgICAgICBsb2dnZXIuaW5mbyhgTG9jYWwgdmVyc2lvbiBvZiBhcHAgbm90IGZvdW5kIGJ1dCAubG9jayBmaWxlIGV4aXN0cy4gV2FpdGluZyBmb3IgLmxvY2sgdG8gZGlzYXBwZWFyYCk7XHJcbiAgICAgICAgICAvLyBXYWl0IGZvciBzb21lIHRpbWUgdGlsbCBBcHAgaXMgZG93bmxvYWRlZCBieSBzb21lIHBhcmFsbGVsIEFwcGl1bSBpbnN0YW5jZVxyXG4gICAgICAgICAgY29uc3Qgd2FpdGluZ1RpbWUgPSA1MDAwO1xyXG4gICAgICAgICAgdmFyIG1heEF0dGVtcHRzQ291bnQgPSA1ICogMTI7XHJcbiAgICAgICAgICAvLyBjb25zdCB3YWl0aW5nVGltZSA9IDEwMDA7XHJcbiAgICAgICAgICAvLyBjb25zdCBtYXhBdHRlbXB0c0NvdW50ID0gNTtcclxuICAgICAgICAgIHZhciBhdHRlbXB0c0NvdW50ID0gMDtcclxuICAgICAgICAgIHdoaWxlKGF3YWl0IGZzLmV4aXN0cyhsb2NrRmlsZSkgJiYgKGF0dGVtcHRzQ291bnQrKyA8IG1heEF0dGVtcHRzQ291bnQpKSB7XHJcbiAgICAgICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XHJcbiAgICAgICAgICAgICAgbG9nZ2VyLmluZm8oYEF0dGVtcHQgIyR7YXR0ZW1wdHNDb3VudH0gZm9yIC5sb2NrIGZpbGUgY2hlY2tpbmdgKTtcclxuICAgICAgICAgICAgICBzZXRUaW1lb3V0KHJlc29sdmUsIHdhaXRpbmdUaW1lKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBpZihhd2FpdCBmcy5leGlzdHMobG9ja0ZpbGUpKSB7XHJcbiAgICAgICAgICAgIHRocm93IEVycm9yKGAubG9jayBmaWxlIGZvciBkb3dubG9hZGluZyBhcHBsaWNhdGlvbiBoYXMgbm90IGRpc2FwcGVhcmVkIGFmdGVyICR7d2FpdGluZ1RpbWUgKiBtYXhBdHRlbXB0c0NvdW50fW1zYCk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBpZighYXdhaXQgZnMuZXhpc3RzKGxvY2FsRmlsZSkpIHtcclxuICAgICAgICAgICAgdGhyb3cgRXJyb3IoYExvY2FsIGFwcGxpY2F0aW9uIGZpbGUgaGFzIG5vdCBhcHBlYXJlZCBhZnRlciAubG9jayBmaWxlIHJlbW92YWxgKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIGxvZ2dlci5pbmZvKGBMb2NhbCB2ZXJzaW9uIG9mIGFwcCB3YXMgZm91bmQgYWZ0ZXIgLmxvY2sgZmlsZSByZW1vdmFsLiBXaWxsIHVzZSBpdCBmb3IgbmV3IHNlc3Npb25gKTtcclxuICAgICAgICAgIG5ld0FwcCA9IGxvY2FsRmlsZTtcclxuICAgICAgICAgIHNob3VsZFVuemlwQXBwID0gWklQX0VYVFMuaW5jbHVkZXMocGF0aC5leHRuYW1lKG5ld0FwcCkpO1xyXG4gICAgICAgICAgZG93bmxvYWRJc05lYWRlZCA9IGZhbHNlO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICBsb2dnZXIuaW5mbyhgTmVpdGhlciBsb2NhbCB2ZXJzaW9uIG9mIGFwcCBub3IgLmxvY2sgZmlsZSB3YXMgZm91bmQuIFdpbGwgZG93bmxvYWQgYXBwIGZyb20gcmVtb3RlIFVSTC5gKTtcclxuICAgICAgICAgIGRvd25sb2FkSXNOZWFkZWQgPSB0cnVlO1xyXG4gICAgICAgIH1cclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBsb2dnZXIuaW5mbyhgTG9jYWwgYXBwcyBmb2xkZXIgaXMgbm90IGRlZmluZWQgdmlhIGVudmlyb25tZW50IHByb3BlcnRpZXMsIGhlbmNlIHNraXBwaW5nIHRoaXMgbG9naWNgKTtcclxuICAgICAgfVxyXG4gICAgICBpZihkb3dubG9hZElzTmVhZGVkKSB7XHJcbiAgICAgIFxyXG4gICAgICAgIGlmKGxvY2FsQXBwc0ZvbGRlciAhPSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgIGxvZ2dlci5pbmZvKGBMb2NhbCB2ZXJzaW9uIG9mIGFwcCB3YXMgbm90IGZvdW5kLiBIZW5jZSB1c2luZyBkZWZhdWx0IEFwcGl1bSBsb2dpYyBmb3IgZG93bmxvYWRpbmdgKTtcclxuICAgICAgICAgIGNvbnN0IHNoYXJlZEZvbGRlclBhdGggPSBhd2FpdCBnZXRTaGFyZWRGb2xkZXJGb3JBcHBVcmwoYXBwKTtcclxuICAgICAgICAgIGxvZ2dlci5pbmZvKGBGb2xkZXIgZm9yIGxvY2FsIHNoYXJlZCBhcHBzOiAke3NoYXJlZEZvbGRlclBhdGh9YCk7XHJcbiAgICAgICAgICBhd2FpdCBmcy5jbG9zZShhd2FpdCBmcy5vcGVuKGxvY2tGaWxlLCAndycpKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IGNhY2hlZFBhdGggPSBnZXRDYWNoZWRBcHBsaWNhdGlvblBhdGgoYXBwLCByZW1vdGVBcHBQcm9wcyk7XHJcbiAgICAgIGlmIChjYWNoZWRQYXRoKSB7XHJcbiAgICAgICAgaWYgKGF3YWl0IGZzLmV4aXN0cyhjYWNoZWRQYXRoKSkge1xyXG4gICAgICAgICAgbG9nZ2VyLmluZm8oYFJldXNpbmcgcHJldmlvdXNseSBkb3dubG9hZGVkIGFwcGxpY2F0aW9uIGF0ICcke2NhY2hlZFBhdGh9J2ApO1xyXG4gICAgICAgICAgcmV0dXJuIHZlcmlmeUFwcEV4dGVuc2lvbihjYWNoZWRQYXRoLCBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgbG9nZ2VyLmluZm8oYFRoZSBhcHBsaWNhdGlvbiBhdCAnJHtjYWNoZWRQYXRofScgZG9lcyBub3QgZXhpc3QgYW55bW9yZS4gRGVsZXRpbmcgaXQgZnJvbSB0aGUgY2FjaGVgKTtcclxuICAgICAgICBBUFBMSUNBVElPTlNfQ0FDSEUuZGVsKGFwcCk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGxldCBmaWxlTmFtZSA9IG51bGw7XHJcbiAgICAgIGNvbnN0IGJhc2VuYW1lID0gZnMuc2FuaXRpemVOYW1lKHBhdGguYmFzZW5hbWUoZGVjb2RlVVJJQ29tcG9uZW50KHBhdGhuYW1lKSksIHtcclxuICAgICAgICByZXBsYWNlbWVudDogU0FOSVRJWkVfUkVQTEFDRU1FTlRcclxuICAgICAgfSk7XHJcbiAgICAgIGNvbnN0IGV4dG5hbWUgPSBwYXRoLmV4dG5hbWUoYmFzZW5hbWUpO1xyXG4gICAgICAvLyB0byBkZXRlcm1pbmUgaWYgd2UgbmVlZCB0byB1bnppcCB0aGUgYXBwLCB3ZSBoYXZlIGEgbnVtYmVyIG9mIHBsYWNlc1xyXG4gICAgICAvLyB0byBsb29rOiBjb250ZW50IHR5cGUsIGNvbnRlbnQgZGlzcG9zaXRpb24sIG9yIHRoZSBmaWxlIGV4dGVuc2lvblxyXG4gICAgICBpZiAoWklQX0VYVFMuaW5jbHVkZXMoZXh0bmFtZSkpIHtcclxuICAgICAgICBmaWxlTmFtZSA9IGJhc2VuYW1lO1xyXG4gICAgICAgIHNob3VsZFVuemlwQXBwID0gdHJ1ZTtcclxuICAgICAgfVxyXG4gICAgICBpZiAoaGVhZGVyc1snY29udGVudC10eXBlJ10pIHtcclxuICAgICAgICBjb25zdCBjdCA9IGhlYWRlcnNbJ2NvbnRlbnQtdHlwZSddO1xyXG4gICAgICAgIGxvZ2dlci5kZWJ1ZyhgQ29udGVudC1UeXBlOiAke2N0fWApO1xyXG4gICAgICAgIC8vIHRoZSBmaWxldHlwZSBtYXkgbm90IGJlIG9idmlvdXMgZm9yIGNlcnRhaW4gdXJscywgc28gY2hlY2sgdGhlIG1pbWUgdHlwZSB0b29cclxuICAgICAgICBpZiAoWklQX01JTUVfVFlQRVMuc29tZSgobWltZVR5cGUpID0+IG5ldyBSZWdFeHAoYFxcXFxiJHtfLmVzY2FwZVJlZ0V4cChtaW1lVHlwZSl9XFxcXGJgKS50ZXN0KGN0KSkpIHtcclxuICAgICAgICAgIGlmICghZmlsZU5hbWUpIHtcclxuICAgICAgICAgICAgZmlsZU5hbWUgPSBgJHtERUZBVUxUX0JBU0VOQU1FfS56aXBgO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgc2hvdWxkVW56aXBBcHAgPSB0cnVlO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgICBpZiAoaGVhZGVyc1snY29udGVudC1kaXNwb3NpdGlvbiddICYmIC9eYXR0YWNobWVudC9pLnRlc3QoaGVhZGVyc1snY29udGVudC1kaXNwb3NpdGlvbiddKSkge1xyXG4gICAgICAgIGxvZ2dlci5kZWJ1ZyhgQ29udGVudC1EaXNwb3NpdGlvbjogJHtoZWFkZXJzWydjb250ZW50LWRpc3Bvc2l0aW9uJ119YCk7XHJcbiAgICAgICAgY29uc3QgbWF0Y2ggPSAvZmlsZW5hbWU9XCIoW15cIl0rKS9pLmV4ZWMoaGVhZGVyc1snY29udGVudC1kaXNwb3NpdGlvbiddKTtcclxuICAgICAgICBpZiAobWF0Y2gpIHtcclxuICAgICAgICAgIGZpbGVOYW1lID0gZnMuc2FuaXRpemVOYW1lKG1hdGNoWzFdLCB7XHJcbiAgICAgICAgICAgIHJlcGxhY2VtZW50OiBTQU5JVElaRV9SRVBMQUNFTUVOVFxyXG4gICAgICAgICAgfSk7XHJcbiAgICAgICAgICBzaG91bGRVbnppcEFwcCA9IHNob3VsZFVuemlwQXBwIHx8IFpJUF9FWFRTLmluY2x1ZGVzKHBhdGguZXh0bmFtZShmaWxlTmFtZSkpO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgICBpZiAoIWZpbGVOYW1lKSB7XHJcbiAgICAgICAgLy8gYXNzaWduIHRoZSBkZWZhdWx0IGZpbGUgbmFtZSBhbmQgdGhlIGV4dGVuc2lvbiBpZiBub25lIGhhcyBiZWVuIGRldGVjdGVkXHJcbiAgICAgICAgY29uc3QgcmVzdWx0aW5nTmFtZSA9IGJhc2VuYW1lXHJcbiAgICAgICAgICA/IGJhc2VuYW1lLnN1YnN0cmluZygwLCBiYXNlbmFtZS5sZW5ndGggLSBleHRuYW1lLmxlbmd0aClcclxuICAgICAgICAgIDogREVGQVVMVF9CQVNFTkFNRTtcclxuICAgICAgICBsZXQgcmVzdWx0aW5nRXh0ID0gZXh0bmFtZTtcclxuICAgICAgICBpZiAoIXN1cHBvcnRlZEFwcEV4dGVuc2lvbnMuaW5jbHVkZXMocmVzdWx0aW5nRXh0KSkge1xyXG4gICAgICAgICAgbG9nZ2VyLmluZm8oYFRoZSBjdXJyZW50IGZpbGUgZXh0ZW5zaW9uICcke3Jlc3VsdGluZ0V4dH0nIGlzIG5vdCBzdXBwb3J0ZWQuIGAgK1xyXG4gICAgICAgICAgICBgRGVmYXVsdGluZyB0byAnJHtfLmZpcnN0KHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMpfSdgKTtcclxuICAgICAgICAgIHJlc3VsdGluZ0V4dCA9IF8uZmlyc3Qoc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGZpbGVOYW1lID0gYCR7cmVzdWx0aW5nTmFtZX0ke3Jlc3VsdGluZ0V4dH1gO1xyXG4gICAgICB9XHJcbiAgICAgIGNvbnN0IHRhcmdldFBhdGggPSBhd2FpdCB0ZW1wRGlyLnBhdGgoe1xyXG4gICAgICAgIHByZWZpeDogZmlsZU5hbWUsXHJcbiAgICAgICAgc3VmZml4OiAnJyxcclxuICAgICAgfSk7XHJcbiAgICAgIG5ld0FwcCA9IGF3YWl0IGRvd25sb2FkQXBwKG5ld0FwcCwgdGFyZ2V0UGF0aCk7XHJcblxyXG4gICAgICAvLyAqKioqKiBDdXN0b20gbG9naWMgZm9yIGNvcHlpbmcgb2YgZG93bmxvYWRlZCBhcHAgdG8gc3RhdGljIGxvY2F0aW9uICoqKioqXHJcbiAgICAgIGlmKGxvY2FsQXBwc0ZvbGRlciAhPSB1bmRlZmluZWQpIHtcclxuICAgICAgICBsb2dnZXIuaW5mbyhgTmV3IGFwcCBwYXRoOiAke25ld0FwcH1gKTtcclxuICAgICAgICBhd2FpdCBmcy5jb3B5RmlsZShuZXdBcHAsIGxvY2FsRmlsZSk7XHJcbiAgICAgIH1cclxuICAgICAgfVxyXG4gICAgICBmaW5hbGx5IHtcclxuICAgICAgICBpZihsb2NhbEFwcHNGb2xkZXIgIT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICBsb2dnZXIuaW5mbyhgR29pbmcgdG8gcmVtb3ZlIGxvY2sgZmlsZSAke2xvY2tGaWxlfWApXHJcbiAgICAgICAgICBhd2FpdCBmcy51bmxpbmsobG9ja0ZpbGUpO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgICB9XHJcbiAgICB9IGVsc2UgaWYgKGF3YWl0IGZzLmV4aXN0cyhuZXdBcHApKSB7XHJcbiAgICAgIC8vIFVzZSB0aGUgbG9jYWwgYXBwXHJcbiAgICAgIGxvZ2dlci5pbmZvKGBVc2luZyBsb2NhbCBhcHAgJyR7bmV3QXBwfSdgKTtcclxuICAgICAgc2hvdWxkVW56aXBBcHAgPSBaSVBfRVhUUy5pbmNsdWRlcyhwYXRoLmV4dG5hbWUobmV3QXBwKSk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICBsZXQgZXJyb3JNZXNzYWdlID0gYFRoZSBhcHBsaWNhdGlvbiBhdCAnJHtuZXdBcHB9JyBkb2VzIG5vdCBleGlzdCBvciBpcyBub3QgYWNjZXNzaWJsZWA7XHJcbiAgICAgIC8vIHByb3RvY29sIHZhbHVlIGZvciAnQzpcXFxcdGVtcCcgaXMgJ2M6Jywgc28gd2UgY2hlY2sgdGhlIGxlbmd0aCBhcyB3ZWxsXHJcbiAgICAgIGlmIChfLmlzU3RyaW5nKHByb3RvY29sKSAmJiBwcm90b2NvbC5sZW5ndGggPiAyKSB7XHJcbiAgICAgICAgZXJyb3JNZXNzYWdlID0gYFRoZSBwcm90b2NvbCAnJHtwcm90b2NvbH0nIHVzZWQgaW4gJyR7bmV3QXBwfScgaXMgbm90IHN1cHBvcnRlZC4gYCArXHJcbiAgICAgICAgICBgT25seSBodHRwOiBhbmQgaHR0cHM6IHByb3RvY29scyBhcmUgc3VwcG9ydGVkYDtcclxuICAgICAgfVxyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoZXJyb3JNZXNzYWdlKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoc2hvdWxkVW56aXBBcHApIHtcclxuICAgICAgY29uc3QgYXJjaGl2ZVBhdGggPSBuZXdBcHA7XHJcbiAgICAgIGFyY2hpdmVIYXNoID0gYXdhaXQgZnMuaGFzaChhcmNoaXZlUGF0aCk7XHJcbiAgICAgIGlmIChBUFBMSUNBVElPTlNfQ0FDSEUuaGFzKGFwcCkgJiYgYXJjaGl2ZUhhc2ggPT09IEFQUExJQ0FUSU9OU19DQUNIRS5nZXQoYXBwKS5oYXNoKSB7XHJcbiAgICAgICAgY29uc3Qge2Z1bGxQYXRofSA9IEFQUExJQ0FUSU9OU19DQUNIRS5nZXQoYXBwKTtcclxuICAgICAgICBpZiAoYXdhaXQgZnMuZXhpc3RzKGZ1bGxQYXRoKSkge1xyXG4gICAgICAgICAgaWYgKGFyY2hpdmVQYXRoICE9PSBhcHAgJiYgbG9jYWxBcHBzRm9sZGVyID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgYXdhaXQgZnMucmltcmFmKGFyY2hpdmVQYXRoKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIGxvZ2dlci5pbmZvKGBXaWxsIHJldXNlIHByZXZpb3VzbHkgY2FjaGVkIGFwcGxpY2F0aW9uIGF0ICcke2Z1bGxQYXRofSdgKTtcclxuICAgICAgICAgIHJldHVybiB2ZXJpZnlBcHBFeHRlbnNpb24oZnVsbFBhdGgsIHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBsb2dnZXIuaW5mbyhgVGhlIGFwcGxpY2F0aW9uIGF0ICcke2Z1bGxQYXRofScgZG9lcyBub3QgZXhpc3QgYW55bW9yZS4gRGVsZXRpbmcgaXQgZnJvbSB0aGUgY2FjaGVgKTtcclxuICAgICAgICBBUFBMSUNBVElPTlNfQ0FDSEUuZGVsKGFwcCk7XHJcbiAgICAgIH1cclxuICAgICAgY29uc3QgdG1wUm9vdCA9IGF3YWl0IHRlbXBEaXIub3BlbkRpcigpO1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIG5ld0FwcCA9IGF3YWl0IHVuemlwQXBwKGFyY2hpdmVQYXRoLCB0bXBSb290LCBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zKTtcclxuICAgICAgfSBmaW5hbGx5IHtcclxuICAgICAgICBpZiAobmV3QXBwICE9PSBhcmNoaXZlUGF0aCAmJiBhcmNoaXZlUGF0aCAhPT0gYXBwICYmIGxvY2FsQXBwc0ZvbGRlciA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICBhd2FpdCBmcy5yaW1yYWYoYXJjaGl2ZVBhdGgpO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgICBsb2dnZXIuaW5mbyhgVW56aXBwZWQgbG9jYWwgYXBwIHRvICcke25ld0FwcH0nYCk7XHJcbiAgICB9IGVsc2UgaWYgKCFwYXRoLmlzQWJzb2x1dGUobmV3QXBwKSkge1xyXG4gICAgICBuZXdBcHAgPSBwYXRoLnJlc29sdmUocHJvY2Vzcy5jd2QoKSwgbmV3QXBwKTtcclxuICAgICAgbG9nZ2VyLndhcm4oYFRoZSBjdXJyZW50IGFwcGxpY2F0aW9uIHBhdGggJyR7YXBwfScgaXMgbm90IGFic29sdXRlIGAgK1xyXG4gICAgICAgIGBhbmQgaGFzIGJlZW4gcmV3cml0dGVuIHRvICcke25ld0FwcH0nLiBDb25zaWRlciB1c2luZyBhYnNvbHV0ZSBwYXRocyByYXRoZXIgdGhhbiByZWxhdGl2ZWApO1xyXG4gICAgICBhcHAgPSBuZXdBcHA7XHJcbiAgICB9XHJcblxyXG4gICAgdmVyaWZ5QXBwRXh0ZW5zaW9uKG5ld0FwcCwgc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucyk7XHJcblxyXG4gICAgaWYgKGFwcCAhPT0gbmV3QXBwICYmIChhcmNoaXZlSGFzaCB8fCBfLnZhbHVlcyhyZW1vdGVBcHBQcm9wcykuc29tZShCb29sZWFuKSkpIHtcclxuICAgICAgaWYgKEFQUExJQ0FUSU9OU19DQUNIRS5oYXMoYXBwKSkge1xyXG4gICAgICAgIGNvbnN0IHtmdWxsUGF0aH0gPSBBUFBMSUNBVElPTlNfQ0FDSEUuZ2V0KGFwcCk7XHJcbiAgICAgICAgLy8gQ2xlYW4gdXAgdGhlIG9ic29sZXRlIGVudHJ5IGZpcnN0IGlmIG5lZWRlZFxyXG4gICAgICAgIGlmIChmdWxsUGF0aCAhPT0gbmV3QXBwICYmIGF3YWl0IGZzLmV4aXN0cyhmdWxsUGF0aCkpIHtcclxuICAgICAgICAgIGF3YWl0IGZzLnJpbXJhZihmdWxsUGF0aCk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIEFQUExJQ0FUSU9OU19DQUNIRS5zZXQoYXBwLCB7XHJcbiAgICAgICAgLi4ucmVtb3RlQXBwUHJvcHMsXHJcbiAgICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxyXG4gICAgICAgIGhhc2g6IGFyY2hpdmVIYXNoLFxyXG4gICAgICAgIGZ1bGxQYXRoOiBuZXdBcHAsXHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIG5ld0FwcDtcclxuICB9KTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gZG93bmxvYWRBcHAgKGFwcCwgdGFyZ2V0UGF0aCkge1xyXG4gIGNvbnN0IHtocmVmfSA9IHVybC5wYXJzZShhcHApO1xyXG4gIHRyeSB7XHJcbiAgICBhd2FpdCBuZXQuZG93bmxvYWRGaWxlKGhyZWYsIHRhcmdldFBhdGgsIHtcclxuICAgICAgdGltZW91dDogQVBQX0RPV05MT0FEX1RJTUVPVVRfTVMsXHJcbiAgICB9KTtcclxuICB9IGNhdGNoIChlcnIpIHtcclxuICAgIHRocm93IG5ldyBFcnJvcihgVW5hYmxlIHRvIGRvd25sb2FkIHRoZSBhcHA6ICR7ZXJyLm1lc3NhZ2V9YCk7XHJcbiAgfVxyXG4gIHJldHVybiB0YXJnZXRQYXRoO1xyXG59XHJcblxyXG4vKipcclxuICogRXh0cmFjdHMgdGhlIGJ1bmRsZSBmcm9tIGFuIGFyY2hpdmUgaW50byB0aGUgZ2l2ZW4gZm9sZGVyXHJcbiAqXHJcbiAqIEBwYXJhbSB7c3RyaW5nfSB6aXBQYXRoIEZ1bGwgcGF0aCB0byB0aGUgYXJjaGl2ZSBjb250YWluaW5nIHRoZSBidW5kbGVcclxuICogQHBhcmFtIHtzdHJpbmd9IGRzdFJvb3QgRnVsbCBwYXRoIHRvIHRoZSBmb2xkZXIgd2hlcmUgdGhlIGV4dHJhY3RlZCBidW5kbGVcclxuICogc2hvdWxkIGJlIHBsYWNlZFxyXG4gKiBAcGFyYW0ge0FycmF5PHN0cmluZz58c3RyaW5nfSBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zIFRoZSBsaXN0IG9mIGV4dGVuc2lvbnNcclxuICogdGhlIHRhcmdldCBhcHBsaWNhdGlvbiBidW5kbGUgc3VwcG9ydHMsIGZvciBleGFtcGxlIFsnLmFwaycsICcuYXBrcyddIGZvclxyXG4gKiBBbmRyb2lkIHBhY2thZ2VzXHJcbiAqIEByZXR1cm5zIHtzdHJpbmd9IEZ1bGwgcGF0aCB0byB0aGUgYnVuZGxlIGluIHRoZSBkZXN0aW5hdGlvbiBmb2xkZXJcclxuICogQHRocm93cyB7RXJyb3J9IElmIHRoZSBnaXZlbiBhcmNoaXZlIGlzIGludmFsaWQgb3Igbm8gYXBwbGljYXRpb24gYnVuZGxlc1xyXG4gKiBoYXZlIGJlZW4gZm91bmQgaW5zaWRlXHJcbiAqL1xyXG5hc3luYyBmdW5jdGlvbiB1bnppcEFwcCAoemlwUGF0aCwgZHN0Um9vdCwgc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucykge1xyXG4gIGF3YWl0IHppcC5hc3NlcnRWYWxpZFppcCh6aXBQYXRoKTtcclxuXHJcbiAgaWYgKCFfLmlzQXJyYXkoc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucykpIHtcclxuICAgIHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMgPSBbc3VwcG9ydGVkQXBwRXh0ZW5zaW9uc107XHJcbiAgfVxyXG5cclxuICBjb25zdCB0bXBSb290ID0gYXdhaXQgdGVtcERpci5vcGVuRGlyKCk7XHJcbiAgdHJ5IHtcclxuICAgIGxvZ2dlci5kZWJ1ZyhgVW56aXBwaW5nICcke3ppcFBhdGh9J2ApO1xyXG4gICAgY29uc3QgdGltZXIgPSBuZXcgdGltaW5nLlRpbWVyKCkuc3RhcnQoKTtcclxuICAgIGNvbnN0IHVzZVN5c3RlbVVuemlwRW52ID0gcHJvY2Vzcy5lbnYuQVBQSVVNX1BSRUZFUl9TWVNURU1fVU5aSVA7XHJcbiAgICBjb25zdCB1c2VTeXN0ZW1VbnppcCA9IF8uaXNFbXB0eSh1c2VTeXN0ZW1VbnppcEVudilcclxuICAgICAgfHwgIVsnMCcsICdmYWxzZSddLmluY2x1ZGVzKF8udG9Mb3dlcih1c2VTeXN0ZW1VbnppcEVudikpO1xyXG4gICAgLyoqXHJcbiAgICAgKiBBdHRlbXB0IHRvIHVzZSB1c2UgdGhlIHN5c3RlbSBgdW56aXBgIChlLmcuLCBgL3Vzci9iaW4vdW56aXBgKSBkdWVcclxuICAgICAqIHRvIHRoZSBzaWduaWZpY2FudCBwZXJmb3JtYW5jZSBpbXByb3ZlbWVudCBpdCBwcm92aWRlcyBvdmVyIHRoZSBuYXRpdmVcclxuICAgICAqIEpTIFwidW56aXBcIiBpbXBsZW1lbnRhdGlvbi5cclxuICAgICAqIEB0eXBlIHtpbXBvcnQoJ2FwcGl1bS1zdXBwb3J0L2xpYi96aXAnKS5FeHRyYWN0QWxsT3B0aW9uc31cclxuICAgICAqL1xyXG4gICAgY29uc3QgZXh0cmFjdGlvbk9wdHMgPSB7dXNlU3lzdGVtVW56aXB9O1xyXG4gICAgLy8gaHR0cHM6Ly9naXRodWIuY29tL2FwcGl1bS9hcHBpdW0vaXNzdWVzLzE0MTAwXHJcbiAgICBpZiAocGF0aC5leHRuYW1lKHppcFBhdGgpID09PSBJUEFfRVhUKSB7XHJcbiAgICAgIGxvZ2dlci5kZWJ1ZyhgRW5mb3JjaW5nIFVURi04IGVuY29kaW5nIG9uIHRoZSBleHRyYWN0ZWQgZmlsZSBuYW1lcyBmb3IgJyR7cGF0aC5iYXNlbmFtZSh6aXBQYXRoKX0nYCk7XHJcbiAgICAgIGV4dHJhY3Rpb25PcHRzLmZpbGVOYW1lc0VuY29kaW5nID0gJ3V0ZjgnO1xyXG4gICAgfVxyXG4gICAgYXdhaXQgemlwLmV4dHJhY3RBbGxUbyh6aXBQYXRoLCB0bXBSb290LCBleHRyYWN0aW9uT3B0cyk7XHJcbiAgICBjb25zdCBnbG9iUGF0dGVybiA9IGAqKi8qLisoJHtzdXBwb3J0ZWRBcHBFeHRlbnNpb25zLm1hcCgoZXh0KSA9PiBleHQucmVwbGFjZSgvXlxcLi8sICcnKSkuam9pbignfCcpfSlgO1xyXG4gICAgY29uc3Qgc29ydGVkQnVuZGxlSXRlbXMgPSAoYXdhaXQgZnMuZ2xvYihnbG9iUGF0dGVybiwge1xyXG4gICAgICBjd2Q6IHRtcFJvb3QsXHJcbiAgICAgIHN0cmljdDogZmFsc2UsXHJcbiAgICAvLyBHZXQgdGhlIHRvcCBsZXZlbCBtYXRjaFxyXG4gICAgfSkpLnNvcnQoKGEsIGIpID0+IGEuc3BsaXQocGF0aC5zZXApLmxlbmd0aCAtIGIuc3BsaXQocGF0aC5zZXApLmxlbmd0aCk7XHJcbiAgICBpZiAoXy5pc0VtcHR5KHNvcnRlZEJ1bmRsZUl0ZW1zKSkge1xyXG4gICAgICBsb2dnZXIuZXJyb3JBbmRUaHJvdyhgQXBwIHVuemlwcGVkIE9LLCBidXQgd2UgY291bGQgbm90IGZpbmQgYW55ICcke3N1cHBvcnRlZEFwcEV4dGVuc2lvbnN9JyBgICtcclxuICAgICAgICB1dGlsLnBsdXJhbGl6ZSgnYnVuZGxlJywgc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucy5sZW5ndGgsIGZhbHNlKSArXHJcbiAgICAgICAgYCBpbiBpdC4gTWFrZSBzdXJlIHlvdXIgYXJjaGl2ZSBjb250YWlucyBhdCBsZWFzdCBvbmUgcGFja2FnZSBoYXZpbmcgYCArXHJcbiAgICAgICAgYCcke3N1cHBvcnRlZEFwcEV4dGVuc2lvbnN9JyAke3V0aWwucGx1cmFsaXplKCdleHRlbnNpb24nLCBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zLmxlbmd0aCwgZmFsc2UpfWApO1xyXG4gICAgfVxyXG4gICAgbG9nZ2VyLmRlYnVnKGBFeHRyYWN0ZWQgJHt1dGlsLnBsdXJhbGl6ZSgnYnVuZGxlIGl0ZW0nLCBzb3J0ZWRCdW5kbGVJdGVtcy5sZW5ndGgsIHRydWUpfSBgICtcclxuICAgICAgYGZyb20gJyR7emlwUGF0aH0nIGluICR7TWF0aC5yb3VuZCh0aW1lci5nZXREdXJhdGlvbigpLmFzTWlsbGlTZWNvbmRzKX1tczogJHtzb3J0ZWRCdW5kbGVJdGVtc31gKTtcclxuICAgIGNvbnN0IG1hdGNoZWRCdW5kbGUgPSBfLmZpcnN0KHNvcnRlZEJ1bmRsZUl0ZW1zKTtcclxuICAgIGxvZ2dlci5pbmZvKGBBc3N1bWluZyAnJHttYXRjaGVkQnVuZGxlfScgaXMgdGhlIGNvcnJlY3QgYnVuZGxlYCk7XHJcbiAgICBjb25zdCBkc3RQYXRoID0gcGF0aC5yZXNvbHZlKGRzdFJvb3QsIHBhdGguYmFzZW5hbWUobWF0Y2hlZEJ1bmRsZSkpO1xyXG4gICAgYXdhaXQgZnMubXYocGF0aC5yZXNvbHZlKHRtcFJvb3QsIG1hdGNoZWRCdW5kbGUpLCBkc3RQYXRoLCB7bWtkaXJwOiB0cnVlfSk7XHJcbiAgICByZXR1cm4gZHN0UGF0aDtcclxuICB9IGZpbmFsbHkge1xyXG4gICAgYXdhaXQgZnMucmltcmFmKHRtcFJvb3QpO1xyXG4gIH1cclxufVxyXG5cclxuZnVuY3Rpb24gaXNQYWNrYWdlT3JCdW5kbGUgKGFwcCkge1xyXG4gIHJldHVybiAoL14oW2EtekEtWjAtOVxcLV9dK1xcLlthLXpBLVowLTlcXC1fXSspKyQvKS50ZXN0KGFwcCk7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBGaW5kcyBhbGwgaW5zdGFuY2VzICdmaXJzdEtleScgYW5kIGNyZWF0ZSBhIGR1cGxpY2F0ZSB3aXRoIHRoZSBrZXkgJ3NlY29uZEtleScsXHJcbiAqIERvIHRoZSBzYW1lIHRoaW5nIGluIHJldmVyc2UuIElmIHdlIGZpbmQgJ3NlY29uZEtleScsIGNyZWF0ZSBhIGR1cGxpY2F0ZSB3aXRoIHRoZSBrZXkgJ2ZpcnN0S2V5Jy5cclxuICpcclxuICogVGhpcyB3aWxsIGNhdXNlIGtleXMgdG8gYmUgb3ZlcndyaXR0ZW4gaWYgdGhlIG9iamVjdCBjb250YWlucyAnZmlyc3RLZXknIGFuZCAnc2Vjb25kS2V5Jy5cclxuXHJcbiAqIEBwYXJhbSB7Kn0gaW5wdXQgQW55IHR5cGUgb2YgaW5wdXRcclxuICogQHBhcmFtIHtTdHJpbmd9IGZpcnN0S2V5IFRoZSBmaXJzdCBrZXkgdG8gZHVwbGljYXRlXHJcbiAqIEBwYXJhbSB7U3RyaW5nfSBzZWNvbmRLZXkgVGhlIHNlY29uZCBrZXkgdG8gZHVwbGljYXRlXHJcbiAqL1xyXG5mdW5jdGlvbiBkdXBsaWNhdGVLZXlzIChpbnB1dCwgZmlyc3RLZXksIHNlY29uZEtleSkge1xyXG4gIC8vIElmIGFycmF5IHByb3ZpZGVkLCByZWN1cnNpdmVseSBjYWxsIG9uIGFsbCBlbGVtZW50c1xyXG4gIGlmIChfLmlzQXJyYXkoaW5wdXQpKSB7XHJcbiAgICByZXR1cm4gaW5wdXQubWFwKChpdGVtKSA9PiBkdXBsaWNhdGVLZXlzKGl0ZW0sIGZpcnN0S2V5LCBzZWNvbmRLZXkpKTtcclxuICB9XHJcblxyXG4gIC8vIElmIG9iamVjdCwgY3JlYXRlIGR1cGxpY2F0ZXMgZm9yIGtleXMgYW5kIHRoZW4gcmVjdXJzaXZlbHkgY2FsbCBvbiB2YWx1ZXNcclxuICBpZiAoXy5pc1BsYWluT2JqZWN0KGlucHV0KSkge1xyXG4gICAgY29uc3QgcmVzdWx0T2JqID0ge307XHJcbiAgICBmb3IgKGxldCBba2V5LCB2YWx1ZV0gb2YgXy50b1BhaXJzKGlucHV0KSkge1xyXG4gICAgICBjb25zdCByZWN1cnNpdmVseUNhbGxlZFZhbHVlID0gZHVwbGljYXRlS2V5cyh2YWx1ZSwgZmlyc3RLZXksIHNlY29uZEtleSk7XHJcbiAgICAgIGlmIChrZXkgPT09IGZpcnN0S2V5KSB7XHJcbiAgICAgICAgcmVzdWx0T2JqW3NlY29uZEtleV0gPSByZWN1cnNpdmVseUNhbGxlZFZhbHVlO1xyXG4gICAgICB9IGVsc2UgaWYgKGtleSA9PT0gc2Vjb25kS2V5KSB7XHJcbiAgICAgICAgcmVzdWx0T2JqW2ZpcnN0S2V5XSA9IHJlY3Vyc2l2ZWx5Q2FsbGVkVmFsdWU7XHJcbiAgICAgIH1cclxuICAgICAgcmVzdWx0T2JqW2tleV0gPSByZWN1cnNpdmVseUNhbGxlZFZhbHVlO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHJlc3VsdE9iajtcclxuICB9XHJcblxyXG4gIC8vIEJhc2UgY2FzZS4gUmV0dXJuIHByaW1pdGl2ZXMgd2l0aG91dCBkb2luZyBhbnl0aGluZy5cclxuICByZXR1cm4gaW5wdXQ7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBUYWtlcyBhIGRlc2lyZWQgY2FwYWJpbGl0eSBhbmQgdHJpZXMgdG8gSlNPTi5wYXJzZSBpdCBhcyBhbiBhcnJheSxcclxuICogYW5kIGVpdGhlciByZXR1cm5zIHRoZSBwYXJzZWQgYXJyYXkgb3IgYSBzaW5nbGV0b24gYXJyYXkuXHJcbiAqXHJcbiAqIEBwYXJhbSB7c3RyaW5nfEFycmF5PFN0cmluZz59IGNhcCBBIGRlc2lyZWQgY2FwYWJpbGl0eVxyXG4gKi9cclxuZnVuY3Rpb24gcGFyc2VDYXBzQXJyYXkgKGNhcCkge1xyXG4gIGlmIChfLmlzQXJyYXkoY2FwKSkge1xyXG4gICAgcmV0dXJuIGNhcDtcclxuICB9XHJcblxyXG4gIGxldCBwYXJzZWRDYXBzO1xyXG4gIHRyeSB7XHJcbiAgICBwYXJzZWRDYXBzID0gSlNPTi5wYXJzZShjYXApO1xyXG4gICAgaWYgKF8uaXNBcnJheShwYXJzZWRDYXBzKSkge1xyXG4gICAgICByZXR1cm4gcGFyc2VkQ2FwcztcclxuICAgIH1cclxuICB9IGNhdGNoIChpZ24pIHtcclxuICAgIGxvZ2dlci53YXJuKGBGYWlsZWQgdG8gcGFyc2UgY2FwYWJpbGl0eSBhcyBKU09OIGFycmF5YCk7XHJcbiAgfVxyXG4gIGlmIChfLmlzU3RyaW5nKGNhcCkpIHtcclxuICAgIHJldHVybiBbY2FwXTtcclxuICB9XHJcbiAgdGhyb3cgbmV3IEVycm9yKGBtdXN0IHByb3ZpZGUgYSBzdHJpbmcgb3IgSlNPTiBBcnJheTsgcmVjZWl2ZWQgJHtjYXB9YCk7XHJcbn1cclxuXHJcbmV4cG9ydCB7XHJcbiAgY29uZmlndXJlQXBwLCBpc1BhY2thZ2VPckJ1bmRsZSwgZHVwbGljYXRlS2V5cywgcGFyc2VDYXBzQXJyYXlcclxufTtcclxuIl0sImZpbGUiOiJsaWIvYmFzZWRyaXZlci9oZWxwZXJzLmpzIiwic291cmNlUm9vdCI6Ii4uXFwuLlxcLi4ifQ==
