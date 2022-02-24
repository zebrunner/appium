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
    _logger.default.debug(`[MCLOUD] A fresh copy of the application is going to be downloaded from ${link}`);

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
      const waitingTime = 1000;
      const maxAttemptsCount = process.env.APPIUM_APP_WAITING_TIMEOUT;

      if (localAppsFolder != undefined) {
        localFile = await (0, _mcloudUtils.getLocalFileForAppUrl)(newApp);
        lockFile = localFile + '.lock';

        if (await _appiumSupport.fs.exists(localFile)) {
          _logger.default.info(`[MCLOUD] Local version of app was found. Will check actuality of the file`);

          const remoteFileLength = await (0, _mcloudUtils.getFileContentLength)(app);
          let attemptsCount = 0;

          while (!(await _appiumSupport.fs.exists(localFile)) && attemptsCount++ < maxAttemptsCount) {
            await new Promise(resolve => {
              _logger.default.info(`[MCLOUD] Attempt #${attemptsCount} for local app file to appear again`);

              setTimeout(resolve, waitingTime);
            });
          }

          if (!(await _appiumSupport.fs.exists(localFile))) {
            throw Error(`[MCLOUD] Local application file has not appeared after updating by parallel Appium session`);
          }

          const stats = await _appiumSupport.fs.stat(localFile);
          const localFileLength = stats.size;

          _logger.default.info(`[MCLOUD] Remote file size is ${remoteFileLength} and local file size is ${localFileLength}`);

          if (remoteFileLength != localFileLength) {
            _logger.default.info(`[MCLOUD] Sizes differ. Hence that's needed to download fresh version of the app`);

            await _appiumSupport.fs.unlink(localFile);
            downloadIsNeaded = true;
          } else {
            _logger.default.info(`[MCLOUD] Sizes are the same. Hence will use already stored application for the session`);

            newApp = localFile;
            shouldUnzipApp = ZIP_EXTS.includes(_path.default.extname(newApp));
            downloadIsNeaded = false;
          }
        } else if (await _appiumSupport.fs.exists(lockFile)) {
          _logger.default.info(`[MCLOUD] Local version of app not found but .lock file exists. Waiting for .lock to disappear`);

          let attemptsCount = 0;

          while ((await _appiumSupport.fs.exists(lockFile)) && attemptsCount++ < maxAttemptsCount) {
            await new Promise(resolve => {
              _logger.default.info(`[MCLOUD] Attempt #${attemptsCount} for .lock file checking`);

              setTimeout(resolve, waitingTime);
            });
          }

          if (await _appiumSupport.fs.exists(lockFile)) {
            throw Error(`[MCLOUD] .lock file for downloading application has not disappeared after ${waitingTime * maxAttemptsCount}ms`);
          }

          if (!(await _appiumSupport.fs.exists(localFile))) {
            throw Error(`[MCLOUD] Local application file has not appeared after .lock file removal`);
          }

          _logger.default.info(`[MCLOUD] Local version of app was found after .lock file removal. Will use it for new session`);

          newApp = localFile;
          shouldUnzipApp = ZIP_EXTS.includes(_path.default.extname(newApp));
          downloadIsNeaded = false;
        } else {
          _logger.default.info(`[MCLOUD] Neither local version of app nor .lock file was found. Will download app from remote URL.`);

          downloadIsNeaded = true;
        }
      } else {
        _logger.default.info(`[MCLOUD] Local apps folder is not defined via environment properties, hence skipping this logic`);
      }

      if (downloadIsNeaded) {
        if (localAppsFolder != undefined) {
          _logger.default.info(`[MCLOUD] Local version of app was not found. Hence using default Appium logic for downloading`);

          const sharedFolderPath = await (0, _mcloudUtils.getSharedFolderForAppUrl)(app);

          _logger.default.info(`[MCLOUD] Folder for local shared apps: ${sharedFolderPath}`);

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
            _logger.default.info(`[MCLOUD] New app path: ${newApp}`);

            await _appiumSupport.fs.copyFile(newApp, localFile);
          }
        } finally {
          if (localAppsFolder != undefined) {
            _logger.default.info(`[MCLOUD] Going to remove lock file ${lockFile}`);

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
    const extractionOpts = {
      useSystemUnzip: true
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


//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImxpYi9iYXNlZHJpdmVyL2hlbHBlcnMuanMiXSwibmFtZXMiOlsiSVBBX0VYVCIsIlpJUF9FWFRTIiwiWklQX01JTUVfVFlQRVMiLCJDQUNIRURfQVBQU19NQVhfQUdFIiwiQVBQTElDQVRJT05TX0NBQ0hFIiwiTFJVIiwibWF4QWdlIiwidXBkYXRlQWdlT25HZXQiLCJkaXNwb3NlIiwiYXBwIiwiZnVsbFBhdGgiLCJmcyIsImV4aXN0cyIsImxvZ2dlciIsImluZm8iLCJyaW1yYWYiLCJub0Rpc3Bvc2VPblNldCIsIkFQUExJQ0FUSU9OU19DQUNIRV9HVUFSRCIsIkFzeW5jTG9jayIsIlNBTklUSVpFX1JFUExBQ0VNRU5UIiwiREVGQVVMVF9CQVNFTkFNRSIsIkFQUF9ET1dOTE9BRF9USU1FT1VUX01TIiwicHJvY2VzcyIsIm9uIiwiaXRlbUNvdW50IiwiYXBwUGF0aHMiLCJ2YWx1ZXMiLCJtYXAiLCJkZWJ1ZyIsImxlbmd0aCIsInV0aWwiLCJwbHVyYWxpemUiLCJhcHBQYXRoIiwicmltcmFmU3luYyIsImUiLCJ3YXJuIiwibWVzc2FnZSIsInJldHJpZXZlSGVhZGVycyIsImxpbmsiLCJ1cmwiLCJtZXRob2QiLCJ0aW1lb3V0IiwiaGVhZGVycyIsImdldENhY2hlZEFwcGxpY2F0aW9uUGF0aCIsImN1cnJlbnRBcHBQcm9wcyIsInJlZnJlc2giLCJoYXMiLCJsYXN0TW9kaWZpZWQiLCJjdXJyZW50TW9kaWZpZWQiLCJpbW11dGFibGUiLCJjdXJyZW50SW1tdXRhYmxlIiwiY3VycmVudE1heEFnZSIsInRpbWVzdGFtcCIsImdldCIsImdldFRpbWUiLCJtc0xlZnQiLCJEYXRlIiwibm93IiwicGF0aCIsImJhc2VuYW1lIiwidmVyaWZ5QXBwRXh0ZW5zaW9uIiwic3VwcG9ydGVkQXBwRXh0ZW5zaW9ucyIsImluY2x1ZGVzIiwiZXh0bmFtZSIsIkVycm9yIiwiY29uZmlndXJlQXBwIiwiXyIsImlzU3RyaW5nIiwiaXNBcnJheSIsIm5ld0FwcCIsInNob3VsZFVuemlwQXBwIiwiYXJjaGl2ZUhhc2giLCJsb2NhbEFwcHNGb2xkZXIiLCJyZW1vdGVBcHBQcm9wcyIsInByb3RvY29sIiwicGF0aG5hbWUiLCJwYXJzZSIsImlzVXJsIiwiYWNxdWlyZSIsImlzRW1wdHkiLCJ0ZXN0IiwibWF4QWdlTWF0Y2giLCJleGVjIiwicGFyc2VJbnQiLCJkb3dubG9hZElzTmVhZGVkIiwibG9jYWxGaWxlIiwibG9ja0ZpbGUiLCJ3YWl0aW5nVGltZSIsIm1heEF0dGVtcHRzQ291bnQiLCJlbnYiLCJBUFBJVU1fQVBQX1dBSVRJTkdfVElNRU9VVCIsInVuZGVmaW5lZCIsInJlbW90ZUZpbGVMZW5ndGgiLCJhdHRlbXB0c0NvdW50IiwiUHJvbWlzZSIsInJlc29sdmUiLCJzZXRUaW1lb3V0Iiwic3RhdHMiLCJzdGF0IiwibG9jYWxGaWxlTGVuZ3RoIiwic2l6ZSIsInVubGluayIsInNoYXJlZEZvbGRlclBhdGgiLCJjbG9zZSIsIm9wZW4iLCJjYWNoZWRQYXRoIiwiZGVsIiwiZmlsZU5hbWUiLCJzYW5pdGl6ZU5hbWUiLCJkZWNvZGVVUklDb21wb25lbnQiLCJyZXBsYWNlbWVudCIsImN0Iiwic29tZSIsIm1pbWVUeXBlIiwiUmVnRXhwIiwiZXNjYXBlUmVnRXhwIiwibWF0Y2giLCJyZXN1bHRpbmdOYW1lIiwic3Vic3RyaW5nIiwicmVzdWx0aW5nRXh0IiwiZmlyc3QiLCJ0YXJnZXRQYXRoIiwidGVtcERpciIsInByZWZpeCIsInN1ZmZpeCIsImRvd25sb2FkQXBwIiwiY29weUZpbGUiLCJlcnJvck1lc3NhZ2UiLCJhcmNoaXZlUGF0aCIsImhhc2giLCJ0bXBSb290Iiwib3BlbkRpciIsInVuemlwQXBwIiwiaXNBYnNvbHV0ZSIsImN3ZCIsIkJvb2xlYW4iLCJzZXQiLCJocmVmIiwibmV0IiwiZG93bmxvYWRGaWxlIiwiZXJyIiwiemlwUGF0aCIsImRzdFJvb3QiLCJ6aXAiLCJhc3NlcnRWYWxpZFppcCIsInRpbWVyIiwidGltaW5nIiwiVGltZXIiLCJzdGFydCIsImV4dHJhY3Rpb25PcHRzIiwidXNlU3lzdGVtVW56aXAiLCJmaWxlTmFtZXNFbmNvZGluZyIsImV4dHJhY3RBbGxUbyIsImdsb2JQYXR0ZXJuIiwiZXh0IiwicmVwbGFjZSIsImpvaW4iLCJzb3J0ZWRCdW5kbGVJdGVtcyIsImdsb2IiLCJzdHJpY3QiLCJzb3J0IiwiYSIsImIiLCJzcGxpdCIsInNlcCIsImVycm9yQW5kVGhyb3ciLCJNYXRoIiwicm91bmQiLCJnZXREdXJhdGlvbiIsImFzTWlsbGlTZWNvbmRzIiwibWF0Y2hlZEJ1bmRsZSIsImRzdFBhdGgiLCJtdiIsIm1rZGlycCIsImlzUGFja2FnZU9yQnVuZGxlIiwiZHVwbGljYXRlS2V5cyIsImlucHV0IiwiZmlyc3RLZXkiLCJzZWNvbmRLZXkiLCJpdGVtIiwiaXNQbGFpbk9iamVjdCIsInJlc3VsdE9iaiIsImtleSIsInZhbHVlIiwidG9QYWlycyIsInJlY3Vyc2l2ZWx5Q2FsbGVkVmFsdWUiLCJwYXJzZUNhcHNBcnJheSIsImNhcCIsInBhcnNlZENhcHMiLCJKU09OIiwiaWduIl0sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7OztBQUFBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUVBLE1BQU1BLE9BQU8sR0FBRyxNQUFoQjtBQUNBLE1BQU1DLFFBQVEsR0FBRyxDQUFDLE1BQUQsRUFBU0QsT0FBVCxDQUFqQjtBQUNBLE1BQU1FLGNBQWMsR0FBRyxDQUNyQixpQkFEcUIsRUFFckIsOEJBRnFCLEVBR3JCLGlCQUhxQixDQUF2QjtBQUtBLE1BQU1DLG1CQUFtQixHQUFHLE9BQU8sRUFBUCxHQUFZLEVBQVosR0FBaUIsRUFBN0M7QUFDQSxNQUFNQyxrQkFBa0IsR0FBRyxJQUFJQyxpQkFBSixDQUFRO0FBQ2pDQyxFQUFBQSxNQUFNLEVBQUVILG1CQUR5QjtBQUVqQ0ksRUFBQUEsY0FBYyxFQUFFLElBRmlCO0FBR2pDQyxFQUFBQSxPQUFPLEVBQUUsT0FBT0MsR0FBUCxFQUFZO0FBQUNDLElBQUFBO0FBQUQsR0FB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TUFFTyxJQUFJSCxHQUFHLEtBQUtKLFNBQVosRUFBdUI7QUFDNUJHLFFBQUFBLFNBQVMsQ0FBQ0osUUFBRCxDQUFULEdBQXNCUSxzQkFBdEI7QUFDRDs7QUFDREosTUFBQUEsU0FBUyxDQUFDQyxHQUFELENBQVQsR0FBaUJHLHNCQUFqQjtBQUNEOztBQUNELFdBQU9KLFNBQVA7QUFDRDs7QUFHRCxTQUFPTCxLQUFQO0FBQ0Q7O0FBUUQsU0FBU1UsY0FBVCxDQUF5QkMsR0FBekIsRUFBOEI7QUFDNUIsTUFBSXpILGdCQUFFRSxPQUFGLENBQVV1SCxHQUFWLENBQUosRUFBb0I7QUFDbEIsV0FBT0EsR0FBUDtBQUNEOztBQUVELE1BQUlDLFVBQUo7O0FBQ0EsTUFBSTtBQUNGQSxJQUFBQSxVQUFVLEdBQUdDLElBQUksQ0FBQ2pILEtBQUwsQ0FBVytHLEdBQVgsQ0FBYjs7QUFDQSxRQUFJekgsZ0JBQUVFLE9BQUYsQ0FBVXdILFVBQVYsQ0FBSixFQUEyQjtBQUN6QixhQUFPQSxVQUFQO0FBQ0Q7QUFDRixHQUxELENBS0UsT0FBT0UsR0FBUCxFQUFZO0FBQ1pqTCxvQkFBT3NCLElBQVAsQ0FBYSwwQ0FBYjtBQUNEOztBQUNELE1BQUkrQixnQkFBRUMsUUFBRixDQUFXd0gsR0FBWCxDQUFKLEVBQXFCO0FBQ25CLFdBQU8sQ0FBQ0EsR0FBRCxDQUFQO0FBQ0Q7O0FBQ0QsUUFBTSxJQUFJM0gsS0FBSixDQUFXLGlEQUFnRDJILEdBQUksRUFBL0QsQ0FBTjtBQUNEIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IF8gZnJvbSAnbG9kYXNoJztcbmltcG9ydCBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0IHVybCBmcm9tICd1cmwnO1xuaW1wb3J0IGxvZ2dlciBmcm9tICcuL2xvZ2dlcic7XG5pbXBvcnQgeyB0ZW1wRGlyLCBmcywgdXRpbCwgemlwLCBuZXQsIHRpbWluZyB9IGZyb20gJ2FwcGl1bS1zdXBwb3J0JztcbmltcG9ydCBMUlUgZnJvbSAnbHJ1LWNhY2hlJztcbmltcG9ydCBBc3luY0xvY2sgZnJvbSAnYXN5bmMtbG9jayc7XG5pbXBvcnQgYXhpb3MgZnJvbSAnYXhpb3MnO1xuaW1wb3J0IHsgZ2V0TG9jYWxBcHBzRm9sZGVyLCBnZXRTaGFyZWRGb2xkZXJGb3JBcHBVcmwsIGdldExvY2FsRmlsZUZvckFwcFVybCwgZ2V0RmlsZUNvbnRlbnRMZW5ndGggfSBmcm9tICcuL21jbG91ZC11dGlscyc7XG5cbmNvbnN0IElQQV9FWFQgPSAnLmlwYSc7XG5jb25zdCBaSVBfRVhUUyA9IFsnLnppcCcsIElQQV9FWFRdO1xuY29uc3QgWklQX01JTUVfVFlQRVMgPSBbXG4gICdhcHBsaWNhdGlvbi96aXAnLFxuICAnYXBwbGljYXRpb24veC16aXAtY29tcHJlc3NlZCcsXG4gICdtdWx0aXBhcnQveC16aXAnLFxuXTtcbmNvbnN0IENBQ0hFRF9BUFBTX01BWF9BR0UgPSAxMDAwICogNjAgKiA2MCAqIDI0OyAvLyBtc1xuY29uc3QgQVBQTElDQVRJT05TX0NBQ0hFID0gbmV3IExSVSh7XG4gIG1heEFnZTogQ0FDSEVEX0FQUFNfTUFYX0FHRSwgLy8gZXhwaXJlIGFmdGVyIDI0IGhvdXJzXG4gIHVwZGF0ZUFnZU9uR2V0OiB0cnVlLFxuICBkaXNwb3NlOiBhc3luYyAoYXBwLCB7ZnVsbFBhdGh9KSA9PiB7XG4gICAgaWYgKCFhd2FpdCBmcy5leGlzdHMoZnVsbFBhdGgpKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgbG9nZ2VyLmluZm8oYFRoZSBhcHBsaWNhdGlvbiAnJHthcHB9JyBjYWNoZWQgYXQgJyR7ZnVsbFBhdGh9JyBoYXMgZXhwaXJlZGApO1xuICAgIGF3YWl0IGZzLnJpbXJhZihmdWxsUGF0aCk7XG4gIH0sXG4gIG5vRGlzcG9zZU9uU2V0OiB0cnVlLFxufSk7XG5jb25zdCBBUFBMSUNBVElPTlNfQ0FDSEVfR1VBUkQgPSBuZXcgQXN5bmNMb2NrKCk7XG5jb25zdCBTQU5JVElaRV9SRVBMQUNFTUVOVCA9ICctJztcbmNvbnN0IERFRkFVTFRfQkFTRU5BTUUgPSAnYXBwaXVtLWFwcCc7XG5jb25zdCBBUFBfRE9XTkxPQURfVElNRU9VVF9NUyA9IDEyMCAqIDEwMDA7XG5cbnByb2Nlc3Mub24oJ2V4aXQnLCAoKSA9PiB7XG4gIGlmIChBUFBMSUNBVElPTlNfQ0FDSEUuaXRlbUNvdW50ID09PSAwKSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgY29uc3QgYXBwUGF0aHMgPSBBUFBMSUNBVElPTlNfQ0FDSEUudmFsdWVzKClcbiAgICAubWFwKCh7ZnVsbFBhdGh9KSA9PiBmdWxsUGF0aCk7XG4gIGxvZ2dlci5kZWJ1ZyhgUGVyZm9ybWluZyBjbGVhbnVwIG9mICR7YXBwUGF0aHMubGVuZ3RofSBjYWNoZWQgYCArXG4gICAgdXRpbC5wbHVyYWxpemUoJ2FwcGxpY2F0aW9uJywgYXBwUGF0aHMubGVuZ3RoKSk7XG4gIGZvciAoY29uc3QgYXBwUGF0aCBvZiBhcHBQYXRocykge1xuICAgIHRyeSB7XG4gICAgICAvLyBBc3luY2hyb25vdXMgY2FsbHMgYXJlIG5vdCBzdXBwb3J0ZWQgaW4gb25FeGl0IGhhbmRsZXJcbiAgICAgIGZzLnJpbXJhZlN5bmMoYXBwUGF0aCk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgbG9nZ2VyLndhcm4oZS5tZXNzYWdlKTtcbiAgICB9XG4gIH1cbn0pO1xuXG5cbmFzeW5jIGZ1bmN0aW9uIHJldHJpZXZlSGVhZGVycyAobGluaykge1xuICB0cnkge1xuICAgIHJldHVybiAoYXdhaXQgYXhpb3Moe1xuICAgICAgdXJsOiBsaW5rLFxuICAgICAgbWV0aG9kOiAnSEVBRCcsXG4gICAgICB0aW1lb3V0OiA1MDAwLFxuICAgIH0pKS5oZWFkZXJzO1xuICB9IGNhdGNoIChlKSB7XG4gICAgbG9nZ2VyLmluZm8oYENhbm5vdCBzZW5kIEhFQUQgcmVxdWVzdCB0byAnJHtsaW5rfScuIE9yaWdpbmFsIGVycm9yOiAke2UubWVzc2FnZX1gKTtcbiAgfVxuICByZXR1cm4ge307XG59XG5cbmZ1bmN0aW9uIGdldENhY2hlZEFwcGxpY2F0aW9uUGF0aCAobGluaywgY3VycmVudEFwcFByb3BzID0ge30pIHtcbiAgY29uc3QgcmVmcmVzaCA9ICgpID0+IHtcbiAgICBsb2dnZXIuZGVidWcoYFtNQ0xPVURdIEEgZnJlc2ggY29weSBvZiB0aGUgYXBwbGljYXRpb24gaXMgZ29pbmcgdG8gYmUgZG93bmxvYWRlZCBmcm9tICR7bGlua31gKTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfTtcblxuICBpZiAoQVBQTElDQVRJT05TX0NBQ0hFLmhhcyhsaW5rKSkge1xuICAgIGNvbnN0IHtcbiAgICAgIGxhc3RNb2RpZmllZDogY3VycmVudE1vZGlmaWVkLFxuICAgICAgaW1tdXRhYmxlOiBjdXJyZW50SW1tdXRhYmxlLFxuICAgICAgLy8gbWF4QWdlIGlzIGluIHNlY29uZHNcbiAgICAgIG1heEFnZTogY3VycmVudE1heEFnZSxcbiAgICB9ID0gY3VycmVudEFwcFByb3BzO1xuICAgIGNvbnN0IHtcbiAgICAgIC8vIERhdGUgaW5zdGFuY2VcbiAgICAgIGxhc3RNb2RpZmllZCxcbiAgICAgIC8vIGJvb2xlYW5cbiAgICAgIGltbXV0YWJsZSxcbiAgICAgIC8vIFVuaXggdGltZSBpbiBtaWxsaXNlY29uZHNcbiAgICAgIHRpbWVzdGFtcCxcbiAgICAgIGZ1bGxQYXRoLFxuICAgIH0gPSBBUFBMSUNBVElPTlNfQ0FDSEUuZ2V0KGxpbmspO1xuICAgIGlmIChsYXN0TW9kaWZpZWQgJiYgY3VycmVudE1vZGlmaWVkKSB7XG4gICAgICBpZiAoY3VycmVudE1vZGlmaWVkLmdldFRpbWUoKSA8PSBsYXN0TW9kaWZpZWQuZ2V0VGltZSgpKSB7XG4gICAgICAgIGxvZ2dlci5kZWJ1ZyhgVGhlIGFwcGxpY2F0aW9uIGF0ICR7bGlua30gaGFzIG5vdCBiZWVuIG1vZGlmaWVkIHNpbmNlICR7bGFzdE1vZGlmaWVkfWApO1xuICAgICAgICByZXR1cm4gZnVsbFBhdGg7XG4gICAgICB9XG4gICAgICBsb2dnZXIuZGVidWcoYFRoZSBhcHBsaWNhdGlvbiBhdCAke2xpbmt9IGhhcyBiZWVuIG1vZGlmaWVkIHNpbmNlICR7bGFzdE1vZGlmaWVkfWApO1xuICAgICAgcmV0dXJuIHJlZnJlc2goKTtcbiAgICB9XG4gICAgaWYgKGltbXV0YWJsZSAmJiBjdXJyZW50SW1tdXRhYmxlKSB7XG4gICAgICBsb2dnZXIuZGVidWcoYFRoZSBhcHBsaWNhdGlvbiBhdCAke2xpbmt9IGlzIGltbXV0YWJsZWApO1xuICAgICAgcmV0dXJuIGZ1bGxQYXRoO1xuICAgIH1cbiAgICBpZiAoY3VycmVudE1heEFnZSAmJiB0aW1lc3RhbXApIHtcbiAgICAgIGNvbnN0IG1zTGVmdCA9IHRpbWVzdGFtcCArIGN1cnJlbnRNYXhBZ2UgKiAxMDAwIC0gRGF0ZS5ub3coKTtcbiAgICAgIGlmIChtc0xlZnQgPiAwKSB7XG4gICAgICAgIGxvZ2dlci5kZWJ1ZyhgVGhlIGNhY2hlZCBhcHBsaWNhdGlvbiAnJHtwYXRoLmJhc2VuYW1lKGZ1bGxQYXRoKX0nIHdpbGwgZXhwaXJlIGluICR7bXNMZWZ0IC8gMTAwMH1zYCk7XG4gICAgICAgIHJldHVybiBmdWxsUGF0aDtcbiAgICAgIH1cbiAgICAgIGxvZ2dlci5kZWJ1ZyhgVGhlIGNhY2hlZCBhcHBsaWNhdGlvbiAnJHtwYXRoLmJhc2VuYW1lKGZ1bGxQYXRoKX0nIGhhcyBleHBpcmVkYCk7XG4gICAgfVxuICB9XG4gIHJldHVybiByZWZyZXNoKCk7XG59XG5cbmZ1bmN0aW9uIHZlcmlmeUFwcEV4dGVuc2lvbiAoYXBwLCBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zKSB7XG4gIGlmIChzdXBwb3J0ZWRBcHBFeHRlbnNpb25zLmluY2x1ZGVzKHBhdGguZXh0bmFtZShhcHApKSkge1xuICAgIHJldHVybiBhcHA7XG4gIH1cbiAgdGhyb3cgbmV3IEVycm9yKGBOZXcgYXBwIHBhdGggJyR7YXBwfScgZGlkIG5vdCBoYXZlIGAgK1xuICAgIGAke3V0aWwucGx1cmFsaXplKCdleHRlbnNpb24nLCBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zLmxlbmd0aCwgZmFsc2UpfTogYCArXG4gICAgc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucyk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGNvbmZpZ3VyZUFwcCAoYXBwLCBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zKSB7XG4gIGlmICghXy5pc1N0cmluZyhhcHApKSB7XG4gICAgLy8gaW1tZWRpYXRlbHkgc2hvcnRjaXJjdWl0IGlmIG5vdCBnaXZlbiBhbiBhcHBcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKCFfLmlzQXJyYXkoc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucykpIHtcbiAgICBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zID0gW3N1cHBvcnRlZEFwcEV4dGVuc2lvbnNdO1xuICB9XG5cbiAgbGV0IG5ld0FwcCA9IGFwcDtcbiAgbGV0IHNob3VsZFVuemlwQXBwID0gZmFsc2U7XG4gIGxldCBhcmNoaXZlSGFzaCA9IG51bGw7XG4gIGxldCBsb2NhbEFwcHNGb2xkZXI7XG4gIGNvbnN0IHJlbW90ZUFwcFByb3BzID0ge1xuICAgIGxhc3RNb2RpZmllZDogbnVsbCxcbiAgICBpbW11dGFibGU6IGZhbHNlLFxuICAgIG1heEFnZTogbnVsbCxcbiAgfTtcbiAgY29uc3Qge3Byb3RvY29sLCBwYXRobmFtZX0gPSB1cmwucGFyc2UobmV3QXBwKTtcbiAgY29uc3QgaXNVcmwgPSBbJ2h0dHA6JywgJ2h0dHBzOiddLmluY2x1ZGVzKHByb3RvY29sKTtcblxuICByZXR1cm4gYXdhaXQgQVBQTElDQVRJT05TX0NBQ0hFX0dVQVJELmFjcXVpcmUoYXBwLCBhc3luYyAoKSA9PiB7XG4gICAgaWYgKGlzVXJsKSB7XG4gICAgICAvLyBVc2UgdGhlIGFwcCBmcm9tIHJlbW90ZSBVUkxcbiAgICAgIGxvZ2dlci5pbmZvKGBVc2luZyBkb3dubG9hZGFibGUgYXBwICcke25ld0FwcH0nYCk7XG4gICAgICBjb25zdCBoZWFkZXJzID0gYXdhaXQgcmV0cmlldmVIZWFkZXJzKG5ld0FwcCk7XG4gICAgICBpZiAoIV8uaXNFbXB0eShoZWFkZXJzKSkge1xuICAgICAgICBpZiAoaGVhZGVyc1snbGFzdC1tb2RpZmllZCddKSB7XG4gICAgICAgICAgcmVtb3RlQXBwUHJvcHMubGFzdE1vZGlmaWVkID0gbmV3IERhdGUoaGVhZGVyc1snbGFzdC1tb2RpZmllZCddKTtcbiAgICAgICAgfVxuICAgICAgICBsb2dnZXIuZGVidWcoYExhc3QtTW9kaWZpZWQ6ICR7aGVhZGVyc1snbGFzdC1tb2RpZmllZCddfWApO1xuICAgICAgICBpZiAoaGVhZGVyc1snY2FjaGUtY29udHJvbCddKSB7XG4gICAgICAgICAgcmVtb3RlQXBwUHJvcHMuaW1tdXRhYmxlID0gL1xcYmltbXV0YWJsZVxcYi9pLnRlc3QoaGVhZGVyc1snY2FjaGUtY29udHJvbCddKTtcbiAgICAgICAgICBjb25zdCBtYXhBZ2VNYXRjaCA9IC9cXGJtYXgtYWdlPShcXGQrKVxcYi9pLmV4ZWMoaGVhZGVyc1snY2FjaGUtY29udHJvbCddKTtcbiAgICAgICAgICBpZiAobWF4QWdlTWF0Y2gpIHtcbiAgICAgICAgICAgIHJlbW90ZUFwcFByb3BzLm1heEFnZSA9IHBhcnNlSW50KG1heEFnZU1hdGNoWzFdLCAxMCk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGxvZ2dlci5kZWJ1ZyhgQ2FjaGUtQ29udHJvbDogJHtoZWFkZXJzWydjYWNoZS1jb250cm9sJ119YCk7XG4gICAgICB9XG5cbiAgICAgIC8vICoqKioqIEN1c3RvbSBsb2dpYyBmb3IgdmVyaWZpY2F0aW9uIG9mIGxvY2FsIHN0YXRpYyBwYXRoIGZvciBBUFBzICoqKioqXG4gICAgICBsZXQgZG93bmxvYWRJc05lYWRlZCA9IHRydWU7XG4gICAgICBsb2NhbEFwcHNGb2xkZXIgPSBhd2FpdCBnZXRMb2NhbEFwcHNGb2xkZXIoKTtcbiAgICAgIGxldCBsb2NhbEZpbGU7XG4gICAgICBsZXQgbG9ja0ZpbGU7XG4gICAgICBjb25zdCB3YWl0aW5nVGltZSA9IDEwMDA7XG4gICAgICBjb25zdCBtYXhBdHRlbXB0c0NvdW50ID0gcHJvY2Vzcy5lbnYuQVBQSVVNX0FQUF9XQUlUSU5HX1RJTUVPVVQ7XG4gICAgICBcbiAgICAgIGlmKGxvY2FsQXBwc0ZvbGRlciAhPSB1bmRlZmluZWQpIHtcbiAgICAgICAgbG9jYWxGaWxlID0gYXdhaXQgZ2V0TG9jYWxGaWxlRm9yQXBwVXJsKG5ld0FwcCk7XG4gICAgICAgIGxvY2tGaWxlID0gbG9jYWxGaWxlICsgJy5sb2NrJztcblxuICAgICAgICBpZihhd2FpdCBmcy5leGlzdHMobG9jYWxGaWxlKSkge1xuICAgICAgICAgIGxvZ2dlci5pbmZvKGBbTUNMT1VEXSBMb2NhbCB2ZXJzaW9uIG9mIGFwcCB3YXMgZm91bmQuIFdpbGwgY2hlY2sgYWN0dWFsaXR5IG9mIHRoZSBmaWxlYCk7XG4gICAgICAgICAgLy8gQ2hlY2tpbmcgb2YgbG9jYWwgYXBwbGljYXRpb24gYWN0dWFsaXR5XG4gICAgICAgICAgY29uc3QgcmVtb3RlRmlsZUxlbmd0aCA9IGF3YWl0IGdldEZpbGVDb250ZW50TGVuZ3RoKGFwcCk7XG4gICAgICAgICAgLy8gQXQgdGhpcyBwb2ludCBsb2NhbCBmaWxlIG1pZ2h0IGJlIGRlbGV0ZWQgYnkgcGFyYWxsZWwgc2Vzc2lvbiB3aGljaCB1cGRhdGVzIG91dGRhdGVkIGFwcFxuICAgICAgICAgIGxldCBhdHRlbXB0c0NvdW50ID0gMDtcbiAgICAgICAgICB3aGlsZSghYXdhaXQgZnMuZXhpc3RzKGxvY2FsRmlsZSkgJiYgKGF0dGVtcHRzQ291bnQrKyA8IG1heEF0dGVtcHRzQ291bnQpKSB7XG4gICAgICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgICAgICAgICBsb2dnZXIuaW5mbyhgW01DTE9VRF0gQXR0ZW1wdCAjJHthdHRlbXB0c0NvdW50fSBmb3IgbG9jYWwgYXBwIGZpbGUgdG8gYXBwZWFyIGFnYWluYCk7XG4gICAgICAgICAgICAgIHNldFRpbWVvdXQocmVzb2x2ZSwgd2FpdGluZ1RpbWUpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmKCFhd2FpdCBmcy5leGlzdHMobG9jYWxGaWxlKSkge1xuICAgICAgICAgICAgdGhyb3cgRXJyb3IoYFtNQ0xPVURdIExvY2FsIGFwcGxpY2F0aW9uIGZpbGUgaGFzIG5vdCBhcHBlYXJlZCBhZnRlciB1cGRhdGluZyBieSBwYXJhbGxlbCBBcHBpdW0gc2Vzc2lvbmApO1xuICAgICAgICAgIH1cbiAgICAgICAgICBjb25zdCBzdGF0cyA9IGF3YWl0IGZzLnN0YXQobG9jYWxGaWxlKTtcbiAgICAgICAgICBjb25zdCBsb2NhbEZpbGVMZW5ndGggPSBzdGF0cy5zaXplO1xuICAgICAgICAgIGxvZ2dlci5pbmZvKGBbTUNMT1VEXSBSZW1vdGUgZmlsZSBzaXplIGlzICR7cmVtb3RlRmlsZUxlbmd0aH0gYW5kIGxvY2FsIGZpbGUgc2l6ZSBpcyAke2xvY2FsRmlsZUxlbmd0aH1gKTtcbiAgICAgICAgICBpZihyZW1vdGVGaWxlTGVuZ3RoICE9IGxvY2FsRmlsZUxlbmd0aCkge1xuICAgICAgICAgICAgbG9nZ2VyLmluZm8oYFtNQ0xPVURdIFNpemVzIGRpZmZlci4gSGVuY2UgdGhhdCdzIG5lZWRlZCB0byBkb3dubG9hZCBmcmVzaCB2ZXJzaW9uIG9mIHRoZSBhcHBgKTtcbiAgICAgICAgICAgIGF3YWl0IGZzLnVubGluayhsb2NhbEZpbGUpO1xuICAgICAgICAgICAgZG93bmxvYWRJc05lYWRlZCA9IHRydWU7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGxvZ2dlci5pbmZvKGBbTUNMT1VEXSBTaXplcyBhcmUgdGhlIHNhbWUuIEhlbmNlIHdpbGwgdXNlIGFscmVhZHkgc3RvcmVkIGFwcGxpY2F0aW9uIGZvciB0aGUgc2Vzc2lvbmApO1xuICAgICAgICAgICAgbmV3QXBwID0gbG9jYWxGaWxlO1xuICAgICAgICAgICAgc2hvdWxkVW56aXBBcHAgPSBaSVBfRVhUUy5pbmNsdWRlcyhwYXRoLmV4dG5hbWUobmV3QXBwKSk7XG4gICAgICAgICAgICBkb3dubG9hZElzTmVhZGVkID0gZmFsc2U7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKGF3YWl0IGZzLmV4aXN0cyhsb2NrRmlsZSkpIHtcbiAgICAgICAgICBsb2dnZXIuaW5mbyhgW01DTE9VRF0gTG9jYWwgdmVyc2lvbiBvZiBhcHAgbm90IGZvdW5kIGJ1dCAubG9jayBmaWxlIGV4aXN0cy4gV2FpdGluZyBmb3IgLmxvY2sgdG8gZGlzYXBwZWFyYCk7XG4gICAgICAgICAgLy8gV2FpdCBmb3Igc29tZSB0aW1lIHRpbGwgQXBwIGlzIGRvd25sb2FkZWQgYnkgc29tZSBwYXJhbGxlbCBBcHBpdW0gaW5zdGFuY2VcbiAgICAgICAgICBsZXQgYXR0ZW1wdHNDb3VudCA9IDA7XG4gICAgICAgICAgd2hpbGUoYXdhaXQgZnMuZXhpc3RzKGxvY2tGaWxlKSAmJiAoYXR0ZW1wdHNDb3VudCsrIDwgbWF4QXR0ZW1wdHNDb3VudCkpIHtcbiAgICAgICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICAgICAgICAgIGxvZ2dlci5pbmZvKGBbTUNMT1VEXSBBdHRlbXB0ICMke2F0dGVtcHRzQ291bnR9IGZvciAubG9jayBmaWxlIGNoZWNraW5nYCk7XG4gICAgICAgICAgICAgIHNldFRpbWVvdXQocmVzb2x2ZSwgd2FpdGluZ1RpbWUpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmKGF3YWl0IGZzLmV4aXN0cyhsb2NrRmlsZSkpIHtcbiAgICAgICAgICAgIHRocm93IEVycm9yKGBbTUNMT1VEXSAubG9jayBmaWxlIGZvciBkb3dubG9hZGluZyBhcHBsaWNhdGlvbiBoYXMgbm90IGRpc2FwcGVhcmVkIGFmdGVyICR7d2FpdGluZ1RpbWUgKiBtYXhBdHRlbXB0c0NvdW50fW1zYCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmKCFhd2FpdCBmcy5leGlzdHMobG9jYWxGaWxlKSkge1xuICAgICAgICAgICAgdGhyb3cgRXJyb3IoYFtNQ0xPVURdIExvY2FsIGFwcGxpY2F0aW9uIGZpbGUgaGFzIG5vdCBhcHBlYXJlZCBhZnRlciAubG9jayBmaWxlIHJlbW92YWxgKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgbG9nZ2VyLmluZm8oYFtNQ0xPVURdIExvY2FsIHZlcnNpb24gb2YgYXBwIHdhcyBmb3VuZCBhZnRlciAubG9jayBmaWxlIHJlbW92YWwuIFdpbGwgdXNlIGl0IGZvciBuZXcgc2Vzc2lvbmApO1xuICAgICAgICAgIG5ld0FwcCA9IGxvY2FsRmlsZTtcbiAgICAgICAgICBzaG91bGRVbnppcEFwcCA9IFpJUF9FWFRTLmluY2x1ZGVzKHBhdGguZXh0bmFtZShuZXdBcHApKTtcbiAgICAgICAgICBkb3dubG9hZElzTmVhZGVkID0gZmFsc2U7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgbG9nZ2VyLmluZm8oYFtNQ0xPVURdIE5laXRoZXIgbG9jYWwgdmVyc2lvbiBvZiBhcHAgbm9yIC5sb2NrIGZpbGUgd2FzIGZvdW5kLiBXaWxsIGRvd25sb2FkIGFwcCBmcm9tIHJlbW90ZSBVUkwuYCk7XG4gICAgICAgICAgZG93bmxvYWRJc05lYWRlZCA9IHRydWU7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGxvZ2dlci5pbmZvKGBbTUNMT1VEXSBMb2NhbCBhcHBzIGZvbGRlciBpcyBub3QgZGVmaW5lZCB2aWEgZW52aXJvbm1lbnQgcHJvcGVydGllcywgaGVuY2Ugc2tpcHBpbmcgdGhpcyBsb2dpY2ApO1xuICAgICAgfVxuICAgICAgaWYoZG93bmxvYWRJc05lYWRlZCkge1xuICAgICAgXG4gICAgICAgIGlmKGxvY2FsQXBwc0ZvbGRlciAhPSB1bmRlZmluZWQpIHtcbiAgICAgICAgICBsb2dnZXIuaW5mbyhgW01DTE9VRF0gTG9jYWwgdmVyc2lvbiBvZiBhcHAgd2FzIG5vdCBmb3VuZC4gSGVuY2UgdXNpbmcgZGVmYXVsdCBBcHBpdW0gbG9naWMgZm9yIGRvd25sb2FkaW5nYCk7XG4gICAgICAgICAgY29uc3Qgc2hhcmVkRm9sZGVyUGF0aCA9IGF3YWl0IGdldFNoYXJlZEZvbGRlckZvckFwcFVybChhcHApO1xuICAgICAgICAgIGxvZ2dlci5pbmZvKGBbTUNMT1VEXSBGb2xkZXIgZm9yIGxvY2FsIHNoYXJlZCBhcHBzOiAke3NoYXJlZEZvbGRlclBhdGh9YCk7XG4gICAgICAgICAgYXdhaXQgZnMuY2xvc2UoYXdhaXQgZnMub3Blbihsb2NrRmlsZSwgJ3cnKSk7XG4gICAgICAgIH1cblxuICAgICAgICB0cnkge1xuICAgICAgY29uc3QgY2FjaGVkUGF0aCA9IGdldENhY2hlZEFwcGxpY2F0aW9uUGF0aChhcHAsIHJlbW90ZUFwcFByb3BzKTtcbiAgICAgIGlmIChjYWNoZWRQYXRoKSB7XG4gICAgICAgIGlmIChhd2FpdCBmcy5leGlzdHMoY2FjaGVkUGF0aCkpIHtcbiAgICAgICAgICBsb2dnZXIuaW5mbyhgUmV1c2luZyBwcmV2aW91c2x5IGRvd25sb2FkZWQgYXBwbGljYXRpb24gYXQgJyR7Y2FjaGVkUGF0aH0nYCk7XG4gICAgICAgICAgcmV0dXJuIHZlcmlmeUFwcEV4dGVuc2lvbihjYWNoZWRQYXRoLCBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zKTtcbiAgICAgICAgfVxuICAgICAgICBsb2dnZXIuaW5mbyhgVGhlIGFwcGxpY2F0aW9uIGF0ICcke2NhY2hlZFBhdGh9JyBkb2VzIG5vdCBleGlzdCBhbnltb3JlLiBEZWxldGluZyBpdCBmcm9tIHRoZSBjYWNoZWApO1xuICAgICAgICBBUFBMSUNBVElPTlNfQ0FDSEUuZGVsKGFwcCk7XG4gICAgICB9XG5cbiAgICAgIGxldCBmaWxlTmFtZSA9IG51bGw7XG4gICAgICBjb25zdCBiYXNlbmFtZSA9IGZzLnNhbml0aXplTmFtZShwYXRoLmJhc2VuYW1lKGRlY29kZVVSSUNvbXBvbmVudChwYXRobmFtZSkpLCB7XG4gICAgICAgIHJlcGxhY2VtZW50OiBTQU5JVElaRV9SRVBMQUNFTUVOVFxuICAgICAgfSk7XG4gICAgICBjb25zdCBleHRuYW1lID0gcGF0aC5leHRuYW1lKGJhc2VuYW1lKTtcbiAgICAgIC8vIHRvIGRldGVybWluZSBpZiB3ZSBuZWVkIHRvIHVuemlwIHRoZSBhcHAsIHdlIGhhdmUgYSBudW1iZXIgb2YgcGxhY2VzXG4gICAgICAvLyB0byBsb29rOiBjb250ZW50IHR5cGUsIGNvbnRlbnQgZGlzcG9zaXRpb24sIG9yIHRoZSBmaWxlIGV4dGVuc2lvblxuICAgICAgaWYgKFpJUF9FWFRTLmluY2x1ZGVzKGV4dG5hbWUpKSB7XG4gICAgICAgIGZpbGVOYW1lID0gYmFzZW5hbWU7XG4gICAgICAgIHNob3VsZFVuemlwQXBwID0gdHJ1ZTtcbiAgICAgIH1cbiAgICAgIGlmIChoZWFkZXJzWydjb250ZW50LXR5cGUnXSkge1xuICAgICAgICBjb25zdCBjdCA9IGhlYWRlcnNbJ2NvbnRlbnQtdHlwZSddO1xuICAgICAgICBsb2dnZXIuZGVidWcoYENvbnRlbnQtVHlwZTogJHtjdH1gKTtcbiAgICAgICAgLy8gdGhlIGZpbGV0eXBlIG1heSBub3QgYmUgb2J2aW91cyBmb3IgY2VydGFpbiB1cmxzLCBzbyBjaGVjayB0aGUgbWltZSB0eXBlIHRvb1xuICAgICAgICBpZiAoWklQX01JTUVfVFlQRVMuc29tZSgobWltZVR5cGUpID0+IG5ldyBSZWdFeHAoYFxcXFxiJHtfLmVzY2FwZVJlZ0V4cChtaW1lVHlwZSl9XFxcXGJgKS50ZXN0KGN0KSkpIHtcbiAgICAgICAgICBpZiAoIWZpbGVOYW1lKSB7XG4gICAgICAgICAgICBmaWxlTmFtZSA9IGAke0RFRkFVTFRfQkFTRU5BTUV9LnppcGA7XG4gICAgICAgICAgfVxuICAgICAgICAgIHNob3VsZFVuemlwQXBwID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKGhlYWRlcnNbJ2NvbnRlbnQtZGlzcG9zaXRpb24nXSAmJiAvXmF0dGFjaG1lbnQvaS50ZXN0KGhlYWRlcnNbJ2NvbnRlbnQtZGlzcG9zaXRpb24nXSkpIHtcbiAgICAgICAgbG9nZ2VyLmRlYnVnKGBDb250ZW50LURpc3Bvc2l0aW9uOiAke2hlYWRlcnNbJ2NvbnRlbnQtZGlzcG9zaXRpb24nXX1gKTtcbiAgICAgICAgY29uc3QgbWF0Y2ggPSAvZmlsZW5hbWU9XCIoW15cIl0rKS9pLmV4ZWMoaGVhZGVyc1snY29udGVudC1kaXNwb3NpdGlvbiddKTtcbiAgICAgICAgaWYgKG1hdGNoKSB7XG4gICAgICAgICAgZmlsZU5hbWUgPSBmcy5zYW5pdGl6ZU5hbWUobWF0Y2hbMV0sIHtcbiAgICAgICAgICAgIHJlcGxhY2VtZW50OiBTQU5JVElaRV9SRVBMQUNFTUVOVFxuICAgICAgICAgIH0pO1xuICAgICAgICAgIHNob3VsZFVuemlwQXBwID0gc2hvdWxkVW56aXBBcHAgfHwgWklQX0VYVFMuaW5jbHVkZXMocGF0aC5leHRuYW1lKGZpbGVOYW1lKSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmICghZmlsZU5hbWUpIHtcbiAgICAgICAgLy8gYXNzaWduIHRoZSBkZWZhdWx0IGZpbGUgbmFtZSBhbmQgdGhlIGV4dGVuc2lvbiBpZiBub25lIGhhcyBiZWVuIGRldGVjdGVkXG4gICAgICAgIGNvbnN0IHJlc3VsdGluZ05hbWUgPSBiYXNlbmFtZVxuICAgICAgICAgID8gYmFzZW5hbWUuc3Vic3RyaW5nKDAsIGJhc2VuYW1lLmxlbmd0aCAtIGV4dG5hbWUubGVuZ3RoKVxuICAgICAgICAgIDogREVGQVVMVF9CQVNFTkFNRTtcbiAgICAgICAgbGV0IHJlc3VsdGluZ0V4dCA9IGV4dG5hbWU7XG4gICAgICAgIGlmICghc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucy5pbmNsdWRlcyhyZXN1bHRpbmdFeHQpKSB7XG4gICAgICAgICAgbG9nZ2VyLmluZm8oYFRoZSBjdXJyZW50IGZpbGUgZXh0ZW5zaW9uICcke3Jlc3VsdGluZ0V4dH0nIGlzIG5vdCBzdXBwb3J0ZWQuIGAgK1xuICAgICAgICAgICAgYERlZmF1bHRpbmcgdG8gJyR7Xy5maXJzdChzdXBwb3J0ZWRBcHBFeHRlbnNpb25zKX0nYCk7XG4gICAgICAgICAgcmVzdWx0aW5nRXh0ID0gXy5maXJzdChzdXBwb3J0ZWRBcHBFeHRlbnNpb25zKTtcbiAgICAgICAgfVxuICAgICAgICBmaWxlTmFtZSA9IGAke3Jlc3VsdGluZ05hbWV9JHtyZXN1bHRpbmdFeHR9YDtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHRhcmdldFBhdGggPSBhd2FpdCB0ZW1wRGlyLnBhdGgoe1xuICAgICAgICBwcmVmaXg6IGZpbGVOYW1lLFxuICAgICAgICBzdWZmaXg6ICcnLFxuICAgICAgfSk7XG4gICAgICBuZXdBcHAgPSBhd2FpdCBkb3dubG9hZEFwcChuZXdBcHAsIHRhcmdldFBhdGgpO1xuXG4gICAgICAvLyAqKioqKiBDdXN0b20gbG9naWMgZm9yIGNvcHlpbmcgb2YgZG93bmxvYWRlZCBhcHAgdG8gc3RhdGljIGxvY2F0aW9uICoqKioqXG4gICAgICBpZihsb2NhbEFwcHNGb2xkZXIgIT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGxvZ2dlci5pbmZvKGBbTUNMT1VEXSBOZXcgYXBwIHBhdGg6ICR7bmV3QXBwfWApO1xuICAgICAgICBhd2FpdCBmcy5jb3B5RmlsZShuZXdBcHAsIGxvY2FsRmlsZSk7XG4gICAgICB9XG4gICAgICB9XG4gICAgICBmaW5hbGx5IHtcbiAgICAgICAgaWYobG9jYWxBcHBzRm9sZGVyICE9IHVuZGVmaW5lZCkge1xuICAgICAgICAgIGxvZ2dlci5pbmZvKGBbTUNMT1VEXSBHb2luZyB0byByZW1vdmUgbG9jayBmaWxlICR7bG9ja0ZpbGV9YClcbiAgICAgICAgICBhd2FpdCBmcy51bmxpbmsobG9ja0ZpbGUpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChhd2FpdCBmcy5leGlzdHMobmV3QXBwKSkge1xuICAgICAgLy8gVXNlIHRoZSBsb2NhbCBhcHBcbiAgICAgIGxvZ2dlci5pbmZvKGBVc2luZyBsb2NhbCBhcHAgJyR7bmV3QXBwfSdgKTtcbiAgICAgIHNob3VsZFVuemlwQXBwID0gWklQX0VYVFMuaW5jbHVkZXMocGF0aC5leHRuYW1lKG5ld0FwcCkpO1xuICAgIH0gZWxzZSB7XG4gICAgICBsZXQgZXJyb3JNZXNzYWdlID0gYFRoZSBhcHBsaWNhdGlvbiBhdCAnJHtuZXdBcHB9JyBkb2VzIG5vdCBleGlzdCBvciBpcyBub3QgYWNjZXNzaWJsZWA7XG4gICAgICAvLyBwcm90b2NvbCB2YWx1ZSBmb3IgJ0M6XFxcXHRlbXAnIGlzICdjOicsIHNvIHdlIGNoZWNrIHRoZSBsZW5ndGggYXMgd2VsbFxuICAgICAgaWYgKF8uaXNTdHJpbmcocHJvdG9jb2wpICYmIHByb3RvY29sLmxlbmd0aCA+IDIpIHtcbiAgICAgICAgZXJyb3JNZXNzYWdlID0gYFRoZSBwcm90b2NvbCAnJHtwcm90b2NvbH0nIHVzZWQgaW4gJyR7bmV3QXBwfScgaXMgbm90IHN1cHBvcnRlZC4gYCArXG4gICAgICAgICAgYE9ubHkgaHR0cDogYW5kIGh0dHBzOiBwcm90b2NvbHMgYXJlIHN1cHBvcnRlZGA7XG4gICAgICB9XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoZXJyb3JNZXNzYWdlKTtcbiAgICB9XG5cbiAgICBpZiAoc2hvdWxkVW56aXBBcHApIHtcbiAgICAgIGNvbnN0IGFyY2hpdmVQYXRoID0gbmV3QXBwO1xuICAgICAgYXJjaGl2ZUhhc2ggPSBhd2FpdCBmcy5oYXNoKGFyY2hpdmVQYXRoKTtcbiAgICAgIGlmIChBUFBMSUNBVElPTlNfQ0FDSEUuaGFzKGFwcCkgJiYgYXJjaGl2ZUhhc2ggPT09IEFQUExJQ0FUSU9OU19DQUNIRS5nZXQoYXBwKS5oYXNoKSB7XG4gICAgICAgIGNvbnN0IHtmdWxsUGF0aH0gPSBBUFBMSUNBVElPTlNfQ0FDSEUuZ2V0KGFwcCk7XG4gICAgICAgIGlmIChhd2FpdCBmcy5leGlzdHMoZnVsbFBhdGgpKSB7XG4gICAgICAgICAgaWYgKGFyY2hpdmVQYXRoICE9PSBhcHAgJiYgbG9jYWxBcHBzRm9sZGVyID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIGF3YWl0IGZzLnJpbXJhZihhcmNoaXZlUGF0aCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGxvZ2dlci5pbmZvKGBXaWxsIHJldXNlIHByZXZpb3VzbHkgY2FjaGVkIGFwcGxpY2F0aW9uIGF0ICcke2Z1bGxQYXRofSdgKTtcbiAgICAgICAgICByZXR1cm4gdmVyaWZ5QXBwRXh0ZW5zaW9uKGZ1bGxQYXRoLCBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zKTtcbiAgICAgICAgfVxuICAgICAgICBsb2dnZXIuaW5mbyhgVGhlIGFwcGxpY2F0aW9uIGF0ICcke2Z1bGxQYXRofScgZG9lcyBub3QgZXhpc3QgYW55bW9yZS4gRGVsZXRpbmcgaXQgZnJvbSB0aGUgY2FjaGVgKTtcbiAgICAgICAgQVBQTElDQVRJT05TX0NBQ0hFLmRlbChhcHApO1xuICAgICAgfVxuICAgICAgY29uc3QgdG1wUm9vdCA9IGF3YWl0IHRlbXBEaXIub3BlbkRpcigpO1xuICAgICAgdHJ5IHtcbiAgICAgICAgbmV3QXBwID0gYXdhaXQgdW56aXBBcHAoYXJjaGl2ZVBhdGgsIHRtcFJvb3QsIHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMpO1xuICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgaWYgKG5ld0FwcCAhPT0gYXJjaGl2ZVBhdGggJiYgYXJjaGl2ZVBhdGggIT09IGFwcCAmJiBsb2NhbEFwcHNGb2xkZXIgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIGF3YWl0IGZzLnJpbXJhZihhcmNoaXZlUGF0aCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGxvZ2dlci5pbmZvKGBVbnppcHBlZCBsb2NhbCBhcHAgdG8gJyR7bmV3QXBwfSdgKTtcbiAgICB9IGVsc2UgaWYgKCFwYXRoLmlzQWJzb2x1dGUobmV3QXBwKSkge1xuICAgICAgbmV3QXBwID0gcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksIG5ld0FwcCk7XG4gICAgICBsb2dnZXIud2FybihgVGhlIGN1cnJlbnQgYXBwbGljYXRpb24gcGF0aCAnJHthcHB9JyBpcyBub3QgYWJzb2x1dGUgYCArXG4gICAgICAgIGBhbmQgaGFzIGJlZW4gcmV3cml0dGVuIHRvICcke25ld0FwcH0nLiBDb25zaWRlciB1c2luZyBhYnNvbHV0ZSBwYXRocyByYXRoZXIgdGhhbiByZWxhdGl2ZWApO1xuICAgICAgYXBwID0gbmV3QXBwO1xuICAgIH1cblxuICAgIHZlcmlmeUFwcEV4dGVuc2lvbihuZXdBcHAsIHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMpO1xuXG4gICAgaWYgKGFwcCAhPT0gbmV3QXBwICYmIChhcmNoaXZlSGFzaCB8fCBfLnZhbHVlcyhyZW1vdGVBcHBQcm9wcykuc29tZShCb29sZWFuKSkpIHtcbiAgICAgIGlmIChBUFBMSUNBVElPTlNfQ0FDSEUuaGFzKGFwcCkpIHtcbiAgICAgICAgY29uc3Qge2Z1bGxQYXRofSA9IEFQUExJQ0FUSU9OU19DQUNIRS5nZXQoYXBwKTtcbiAgICAgICAgLy8gQ2xlYW4gdXAgdGhlIG9ic29sZXRlIGVudHJ5IGZpcnN0IGlmIG5lZWRlZFxuICAgICAgICBpZiAoZnVsbFBhdGggIT09IG5ld0FwcCAmJiBhd2FpdCBmcy5leGlzdHMoZnVsbFBhdGgpKSB7XG4gICAgICAgICAgYXdhaXQgZnMucmltcmFmKGZ1bGxQYXRoKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgQVBQTElDQVRJT05TX0NBQ0hFLnNldChhcHAsIHtcbiAgICAgICAgLi4ucmVtb3RlQXBwUHJvcHMsXG4gICAgICAgIHRpbWVzdGFtcDogRGF0ZS5ub3coKSxcbiAgICAgICAgaGFzaDogYXJjaGl2ZUhhc2gsXG4gICAgICAgIGZ1bGxQYXRoOiBuZXdBcHAsXG4gICAgICB9KTtcbiAgICB9XG4gICAgcmV0dXJuIG5ld0FwcDtcbiAgfSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGRvd25sb2FkQXBwIChhcHAsIHRhcmdldFBhdGgpIHtcbiAgY29uc3Qge2hyZWZ9ID0gdXJsLnBhcnNlKGFwcCk7XG4gIHRyeSB7XG4gICAgYXdhaXQgbmV0LmRvd25sb2FkRmlsZShocmVmLCB0YXJnZXRQYXRoLCB7XG4gICAgICB0aW1lb3V0OiBBUFBfRE9XTkxPQURfVElNRU9VVF9NUyxcbiAgICB9KTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBVbmFibGUgdG8gZG93bmxvYWQgdGhlIGFwcDogJHtlcnIubWVzc2FnZX1gKTtcbiAgfVxuICByZXR1cm4gdGFyZ2V0UGF0aDtcbn1cblxuLyoqXG4gKiBFeHRyYWN0cyB0aGUgYnVuZGxlIGZyb20gYW4gYXJjaGl2ZSBpbnRvIHRoZSBnaXZlbiBmb2xkZXJcbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gemlwUGF0aCBGdWxsIHBhdGggdG8gdGhlIGFyY2hpdmUgY29udGFpbmluZyB0aGUgYnVuZGxlXG4gKiBAcGFyYW0ge3N0cmluZ30gZHN0Um9vdCBGdWxsIHBhdGggdG8gdGhlIGZvbGRlciB3aGVyZSB0aGUgZXh0cmFjdGVkIGJ1bmRsZVxuICogc2hvdWxkIGJlIHBsYWNlZFxuICogQHBhcmFtIHtBcnJheTxzdHJpbmc+fHN0cmluZ30gc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucyBUaGUgbGlzdCBvZiBleHRlbnNpb25zXG4gKiB0aGUgdGFyZ2V0IGFwcGxpY2F0aW9uIGJ1bmRsZSBzdXBwb3J0cywgZm9yIGV4YW1wbGUgWycuYXBrJywgJy5hcGtzJ10gZm9yXG4gKiBBbmRyb2lkIHBhY2thZ2VzXG4gKiBAcmV0dXJucyB7c3RyaW5nfSBGdWxsIHBhdGggdG8gdGhlIGJ1bmRsZSBpbiB0aGUgZGVzdGluYXRpb24gZm9sZGVyXG4gKiBAdGhyb3dzIHtFcnJvcn0gSWYgdGhlIGdpdmVuIGFyY2hpdmUgaXMgaW52YWxpZCBvciBubyBhcHBsaWNhdGlvbiBidW5kbGVzXG4gKiBoYXZlIGJlZW4gZm91bmQgaW5zaWRlXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHVuemlwQXBwICh6aXBQYXRoLCBkc3RSb290LCBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zKSB7XG4gIGF3YWl0IHppcC5hc3NlcnRWYWxpZFppcCh6aXBQYXRoKTtcblxuICBpZiAoIV8uaXNBcnJheShzdXBwb3J0ZWRBcHBFeHRlbnNpb25zKSkge1xuICAgIHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMgPSBbc3VwcG9ydGVkQXBwRXh0ZW5zaW9uc107XG4gIH1cblxuICBjb25zdCB0bXBSb290ID0gYXdhaXQgdGVtcERpci5vcGVuRGlyKCk7XG4gIHRyeSB7XG4gICAgbG9nZ2VyLmRlYnVnKGBVbnppcHBpbmcgJyR7emlwUGF0aH0nYCk7XG4gICAgY29uc3QgdGltZXIgPSBuZXcgdGltaW5nLlRpbWVyKCkuc3RhcnQoKTtcbiAgICAvKipcbiAgICAgKiBBdHRlbXB0IHRvIHVzZSB1c2UgdGhlIHN5c3RlbSBgdW56aXBgIChlLmcuLCBgL3Vzci9iaW4vdW56aXBgKSBkdWVcbiAgICAgKiB0byB0aGUgc2lnbmlmaWNhbnQgcGVyZm9ybWFuY2UgaW1wcm92ZW1lbnQgaXQgcHJvdmlkZXMgb3ZlciB0aGUgbmF0aXZlXG4gICAgICogSlMgXCJ1bnppcFwiIGltcGxlbWVudGF0aW9uLlxuICAgICAqIEB0eXBlIHtpbXBvcnQoJ2FwcGl1bS1zdXBwb3J0L2xpYi96aXAnKS5FeHRyYWN0QWxsT3B0aW9uc31cbiAgICAgKi9cbiAgICBjb25zdCBleHRyYWN0aW9uT3B0cyA9IHtcbiAgICAgIHVzZVN5c3RlbVVuemlwOiB0cnVlLFxuICAgIH07XG4gICAgLy8gaHR0cHM6Ly9naXRodWIuY29tL2FwcGl1bS9hcHBpdW0vaXNzdWVzLzE0MTAwXG4gICAgaWYgKHBhdGguZXh0bmFtZSh6aXBQYXRoKSA9PT0gSVBBX0VYVCkge1xuICAgICAgbG9nZ2VyLmRlYnVnKGBFbmZvcmNpbmcgVVRGLTggZW5jb2Rpbmcgb24gdGhlIGV4dHJhY3RlZCBmaWxlIG5hbWVzIGZvciAnJHtwYXRoLmJhc2VuYW1lKHppcFBhdGgpfSdgKTtcbiAgICAgIGV4dHJhY3Rpb25PcHRzLmZpbGVOYW1lc0VuY29kaW5nID0gJ3V0ZjgnO1xuICAgIH1cbiAgICBhd2FpdCB6aXAuZXh0cmFjdEFsbFRvKHppcFBhdGgsIHRtcFJvb3QsIGV4dHJhY3Rpb25PcHRzKTtcbiAgICBjb25zdCBnbG9iUGF0dGVybiA9IGAqKi8qLisoJHtzdXBwb3J0ZWRBcHBFeHRlbnNpb25zLm1hcCgoZXh0KSA9PiBleHQucmVwbGFjZSgvXlxcLi8sICcnKSkuam9pbignfCcpfSlgO1xuICAgIGNvbnN0IHNvcnRlZEJ1bmRsZUl0ZW1zID0gKGF3YWl0IGZzLmdsb2IoZ2xvYlBhdHRlcm4sIHtcbiAgICAgIGN3ZDogdG1wUm9vdCxcbiAgICAgIHN0cmljdDogZmFsc2UsXG4gICAgLy8gR2V0IHRoZSB0b3AgbGV2ZWwgbWF0Y2hcbiAgICB9KSkuc29ydCgoYSwgYikgPT4gYS5zcGxpdChwYXRoLnNlcCkubGVuZ3RoIC0gYi5zcGxpdChwYXRoLnNlcCkubGVuZ3RoKTtcbiAgICBpZiAoXy5pc0VtcHR5KHNvcnRlZEJ1bmRsZUl0ZW1zKSkge1xuICAgICAgbG9nZ2VyLmVycm9yQW5kVGhyb3coYEFwcCB1bnppcHBlZCBPSywgYnV0IHdlIGNvdWxkIG5vdCBmaW5kIGFueSAnJHtzdXBwb3J0ZWRBcHBFeHRlbnNpb25zfScgYCArXG4gICAgICAgIHV0aWwucGx1cmFsaXplKCdidW5kbGUnLCBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zLmxlbmd0aCwgZmFsc2UpICtcbiAgICAgICAgYCBpbiBpdC4gTWFrZSBzdXJlIHlvdXIgYXJjaGl2ZSBjb250YWlucyBhdCBsZWFzdCBvbmUgcGFja2FnZSBoYXZpbmcgYCArXG4gICAgICAgIGAnJHtzdXBwb3J0ZWRBcHBFeHRlbnNpb25zfScgJHt1dGlsLnBsdXJhbGl6ZSgnZXh0ZW5zaW9uJywgc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucy5sZW5ndGgsIGZhbHNlKX1gKTtcbiAgICB9XG4gICAgbG9nZ2VyLmRlYnVnKGBFeHRyYWN0ZWQgJHt1dGlsLnBsdXJhbGl6ZSgnYnVuZGxlIGl0ZW0nLCBzb3J0ZWRCdW5kbGVJdGVtcy5sZW5ndGgsIHRydWUpfSBgICtcbiAgICAgIGBmcm9tICcke3ppcFBhdGh9JyBpbiAke01hdGgucm91bmQodGltZXIuZ2V0RHVyYXRpb24oKS5hc01pbGxpU2Vjb25kcyl9bXM6ICR7c29ydGVkQnVuZGxlSXRlbXN9YCk7XG4gICAgY29uc3QgbWF0Y2hlZEJ1bmRsZSA9IF8uZmlyc3Qoc29ydGVkQnVuZGxlSXRlbXMpO1xuICAgIGxvZ2dlci5pbmZvKGBBc3N1bWluZyAnJHttYXRjaGVkQnVuZGxlfScgaXMgdGhlIGNvcnJlY3QgYnVuZGxlYCk7XG4gICAgY29uc3QgZHN0UGF0aCA9IHBhdGgucmVzb2x2ZShkc3RSb290LCBwYXRoLmJhc2VuYW1lKG1hdGNoZWRCdW5kbGUpKTtcbiAgICBhd2FpdCBmcy5tdihwYXRoLnJlc29sdmUodG1wUm9vdCwgbWF0Y2hlZEJ1bmRsZSksIGRzdFBhdGgsIHtta2RpcnA6IHRydWV9KTtcbiAgICByZXR1cm4gZHN0UGF0aDtcbiAgfSBmaW5hbGx5IHtcbiAgICBhd2FpdCBmcy5yaW1yYWYodG1wUm9vdCk7XG4gIH1cbn1cblxuZnVuY3Rpb24gaXNQYWNrYWdlT3JCdW5kbGUgKGFwcCkge1xuICByZXR1cm4gKC9eKFthLXpBLVowLTlcXC1fXStcXC5bYS16QS1aMC05XFwtX10rKSskLykudGVzdChhcHApO1xufVxuXG4vKipcbiAqIEZpbmRzIGFsbCBpbnN0YW5jZXMgJ2ZpcnN0S2V5JyBhbmQgY3JlYXRlIGEgZHVwbGljYXRlIHdpdGggdGhlIGtleSAnc2Vjb25kS2V5JyxcbiAqIERvIHRoZSBzYW1lIHRoaW5nIGluIHJldmVyc2UuIElmIHdlIGZpbmQgJ3NlY29uZEtleScsIGNyZWF0ZSBhIGR1cGxpY2F0ZSB3aXRoIHRoZSBrZXkgJ2ZpcnN0S2V5Jy5cbiAqXG4gKiBUaGlzIHdpbGwgY2F1c2Uga2V5cyB0byBiZSBvdmVyd3JpdHRlbiBpZiB0aGUgb2JqZWN0IGNvbnRhaW5zICdmaXJzdEtleScgYW5kICdzZWNvbmRLZXknLlxuXG4gKiBAcGFyYW0geyp9IGlucHV0IEFueSB0eXBlIG9mIGlucHV0XG4gKiBAcGFyYW0ge1N0cmluZ30gZmlyc3RLZXkgVGhlIGZpcnN0IGtleSB0byBkdXBsaWNhdGVcbiAqIEBwYXJhbSB7U3RyaW5nfSBzZWNvbmRLZXkgVGhlIHNlY29uZCBrZXkgdG8gZHVwbGljYXRlXG4gKi9cbmZ1bmN0aW9uIGR1cGxpY2F0ZUtleXMgKGlucHV0LCBmaXJzdEtleSwgc2Vjb25kS2V5KSB7XG4gIC8vIElmIGFycmF5IHByb3ZpZGVkLCByZWN1cnNpdmVseSBjYWxsIG9uIGFsbCBlbGVtZW50c1xuICBpZiAoXy5pc0FycmF5KGlucHV0KSkge1xuICAgIHJldHVybiBpbnB1dC5tYXAoKGl0ZW0pID0+IGR1cGxpY2F0ZUtleXMoaXRlbSwgZmlyc3RLZXksIHNlY29uZEtleSkpO1xuICB9XG5cbiAgLy8gSWYgb2JqZWN0LCBjcmVhdGUgZHVwbGljYXRlcyBmb3Iga2V5cyBhbmQgdGhlbiByZWN1cnNpdmVseSBjYWxsIG9uIHZhbHVlc1xuICBpZiAoXy5pc1BsYWluT2JqZWN0KGlucHV0KSkge1xuICAgIGNvbnN0IHJlc3VsdE9iaiA9IHt9O1xuICAgIGZvciAobGV0IFtrZXksIHZhbHVlXSBvZiBfLnRvUGFpcnMoaW5wdXQpKSB7XG4gICAgICBjb25zdCByZWN1cnNpdmVseUNhbGxlZFZhbHVlID0gZHVwbGljYXRlS2V5cyh2YWx1ZSwgZmlyc3RLZXksIHNlY29uZEtleSk7XG4gICAgICBpZiAoa2V5ID09PSBmaXJzdEtleSkge1xuICAgICAgICByZXN1bHRPYmpbc2Vjb25kS2V5XSA9IHJlY3Vyc2l2ZWx5Q2FsbGVkVmFsdWU7XG4gICAgICB9IGVsc2UgaWYgKGtleSA9PT0gc2Vjb25kS2V5KSB7XG4gICAgICAgIHJlc3VsdE9ialtmaXJzdEtleV0gPSByZWN1cnNpdmVseUNhbGxlZFZhbHVlO1xuICAgICAgfVxuICAgICAgcmVzdWx0T2JqW2tleV0gPSByZWN1cnNpdmVseUNhbGxlZFZhbHVlO1xuICAgIH1cbiAgICByZXR1cm4gcmVzdWx0T2JqO1xuICB9XG5cbiAgLy8gQmFzZSBjYXNlLiBSZXR1cm4gcHJpbWl0aXZlcyB3aXRob3V0IGRvaW5nIGFueXRoaW5nLlxuICByZXR1cm4gaW5wdXQ7XG59XG5cbi8qKlxuICogVGFrZXMgYSBkZXNpcmVkIGNhcGFiaWxpdHkgYW5kIHRyaWVzIHRvIEpTT04ucGFyc2UgaXQgYXMgYW4gYXJyYXksXG4gKiBhbmQgZWl0aGVyIHJldHVybnMgdGhlIHBhcnNlZCBhcnJheSBvciBhIHNpbmdsZXRvbiBhcnJheS5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ3xBcnJheTxTdHJpbmc+fSBjYXAgQSBkZXNpcmVkIGNhcGFiaWxpdHlcbiAqL1xuZnVuY3Rpb24gcGFyc2VDYXBzQXJyYXkgKGNhcCkge1xuICBpZiAoXy5pc0FycmF5KGNhcCkpIHtcbiAgICByZXR1cm4gY2FwO1xuICB9XG5cbiAgbGV0IHBhcnNlZENhcHM7XG4gIHRyeSB7XG4gICAgcGFyc2VkQ2FwcyA9IEpTT04ucGFyc2UoY2FwKTtcbiAgICBpZiAoXy5pc0FycmF5KHBhcnNlZENhcHMpKSB7XG4gICAgICByZXR1cm4gcGFyc2VkQ2FwcztcbiAgICB9XG4gIH0gY2F0Y2ggKGlnbikge1xuICAgIGxvZ2dlci53YXJuKGBGYWlsZWQgdG8gcGFyc2UgY2FwYWJpbGl0eSBhcyBKU09OIGFycmF5YCk7XG4gIH1cbiAgaWYgKF8uaXNTdHJpbmcoY2FwKSkge1xuICAgIHJldHVybiBbY2FwXTtcbiAgfVxuICB0aHJvdyBuZXcgRXJyb3IoYG11c3QgcHJvdmlkZSBhIHN0cmluZyBvciBKU09OIEFycmF5OyByZWNlaXZlZCAke2NhcH1gKTtcbn1cblxuZXhwb3J0IHtcbiAgY29uZmlndXJlQXBwLCBpc1BhY2thZ2VPckJ1bmRsZSwgZHVwbGljYXRlS2V5cywgcGFyc2VDYXBzQXJyYXlcbn07XG4iXSwiZmlsZSI6ImxpYi9iYXNlZHJpdmVyL2hlbHBlcnMuanMiLCJzb3VyY2VSb290IjoiLi4vLi4vLi4ifQ==
