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
      const waitingTime = 1000;
      const maxAttemptsCount = process.env.APPIUM_APP_WAITING_TIMEOUT;

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


//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImxpYi9iYXNlZHJpdmVyL2hlbHBlcnMuanMiXSwibmFtZXMiOlsiSVBBX0VYVCIsIlpJUF9FWFRTIiwiWklQX01JTUVfVFlQRVMiLCJDQUNIRURfQVBQU19NQVhfQUdFIiwiQVBQTElDQVRJT05TX0NBQ0hFIiwiTFJVIiwibWF4QWdlIiwidXBkYXRlQWdlT25HZXQiLCJkaXNwb3NlIiwiYXBwIiwiZnVsbFBhdGgiLCJmcyIsImV4aXN0cyIsImxvZ2dlciIsImluZm8iLCJyaW1yYWYiLCJub0Rpc3Bvc2VPblNldCIsIkFQUExJQ0FUSU9OU19DQUNIRV9HVUFSRCIsIkFzeW5jTG9jayIsIlNBTklUSVpFX1JFUExBQ0VNRU5UIiwiREVGQVVMVF9CQVNFTkFNRSIsIkFQUF9ET1dOTE9BRF9USU1FT1VUX01TIiwicHJvY2VzcyIsIm9uIiwiaXRlbUNvdW50IiwiYXBwUGF0aHMiLCJ2YWx1ZXMiLCJtYXAiLCJkZWJ1ZyIsImxlbmd0aCIsInV0aWwiLCJwbHVyYWxpemUiLCJhcHBQYXRoIiwicmltcmFmU3luYyIsImUiLCJ3YXJuIiwibWVzc2FnZSIsInJldHJpZXZlSGVhZGVycyIsImxpbmsiLCJ1cmwiLCJtZXRob2QiLCJ0aW1lb3V0IiwiaGVhZGVycyIsImdldENhY2hlZEFwcGxpY2F0aW9uUGF0aCIsImN1cnJlbnRBcHBQcm9wcyIsInJlZnJlc2giLCJoYXMiLCJsYXN0TW9kaWZpZWQiLCJjdXJyZW50TW9kaWZpZWQiLCJpbW11dGFibGUiLCJjdXJyZW50SW1tdXRhYmxlIiwiY3VycmVudE1heEFnZSIsInRpbWVzdGFtcCIsImdldCIsImdldFRpbWUiLCJtc0xlZnQiLCJEYXRlIiwibm93IiwicGF0aCIsImJhc2VuYW1lIiwidmVyaWZ5QXBwRXh0ZW5zaW9uIiwic3VwcG9ydGVkQXBwRXh0ZW5zaW9ucyIsImluY2x1ZGVzIiwiZXh0bmFtZSIsIkVycm9yIiwiY29uZmlndXJlQXBwIiwiXyIsImlzU3RyaW5nIiwiaXNBcnJheSIsIm5ld0FwcCIsInNob3VsZFVuemlwQXBwIiwiYXJjaGl2ZUhhc2giLCJsb2NhbEFwcHNGb2xkZXIiLCJyZW1vdGVBcHBQcm9wcyIsInByb3RvY29sIiwicGF0aG5hbWUiLCJwYXJzZSIsImlzVXJsIiwiYWNxdWlyZSIsImlzRW1wdHkiLCJ0ZXN0IiwibWF4QWdlTWF0Y2giLCJleGVjIiwicGFyc2VJbnQiLCJkb3dubG9hZElzTmVhZGVkIiwibG9jYWxGaWxlIiwibG9ja0ZpbGUiLCJ3YWl0aW5nVGltZSIsIm1heEF0dGVtcHRzQ291bnQiLCJlbnYiLCJBUFBJVU1fQVBQX1dBSVRJTkdfVElNRU9VVCIsInVuZGVmaW5lZCIsInJlbW90ZUZpbGVMZW5ndGgiLCJhdHRlbXB0c0NvdW50IiwiUHJvbWlzZSIsInJlc29sdmUiLCJzZXRUaW1lb3V0Iiwic3RhdHMiLCJzdGF0IiwibG9jYWxGaWxlTGVuZ3RoIiwic2l6ZSIsInVubGluayIsInNoYXJlZEZvbGRlclBhdGgiLCJjbG9zZSIsIm9wZW4iLCJjYWNoZWRQYXRoIiwiZGVsIiwiZmlsZU5hbWUiLCJzYW5pdGl6ZU5hbWUiLCJkZWNvZGVVUklDb21wb25lbnQiLCJyZXBsYWNlbWVudCIsImN0Iiwic29tZSIsIm1pbWVUeXBlIiwiUmVnRXhwIiwiZXNjYXBlUmVnRXhwIiwibWF0Y2giLCJyZXN1bHRpbmdOYW1lIiwic3Vic3RyaW5nIiwicmVzdWx0aW5nRXh0IiwiZmlyc3QiLCJ0YXJnZXRQYXRoIiwidGVtcERpciIsInByZWZpeCIsInN1ZmZpeCIsImRvd25sb2FkQXBwIiwiY29weUZpbGUiLCJlcnJvck1lc3NhZ2UiLCJhcmNoaXZlUGF0aCIsImhhc2giLCJ0bXBSb290Iiwib3BlbkRpciIsInVuemlwQXBwIiwiaXNBYnNvbHV0ZSIsImN3ZCIsIkJvb2xlYW4iLCJzZXQiLCJocmVmIiwibmV0IiwiZG93bmxvYWRGaWxlIiwiZXJyIiwiemlwUGF0aCIsImRzdFJvb3QiLCJ6aXAiLCJhc3NlcnRWYWxpZFppcCIsInRpbWVyIiwidGltaW5nIiwiVGltZXIiLCJzdGFydCIsImV4dHJhY3Rpb25PcHRzIiwidXNlU3lzdGVtVW56aXAiLCJmaWxlTmFtZXNFbmNvZGluZyIsImV4dHJhY3RBbGxUbyIsImdsb2JQYXR0ZXJuIiwiZXh0IiwicmVwbGFjZSIsImpvaW4iLCJzb3J0ZWRCdW5kbGVJdGVtcyIsImdsb2IiLCJzdHJpY3QiLCJzb3J0IiwiYSIsImIiLCJzcGxpdCIsInNlcCIsImVycm9yQW5kVGhyb3ciLCJNYXRoIiwicm91bmQiLCJnZXREdXJhdGlvbiIsImFzTWlsbGlTZWNvbmRzIiwibWF0Y2hlZEJ1bmRsZSIsImRzdFBhdGgiLCJtdiIsIm1rZGlycCIsImlzUGFja2FnZU9yQnVuZGxlIiwiZHVwbGljYXRlS2V5cyIsImlucHV0IiwiZmlyc3RLZXkiLCJzZWNvbmRLZXkiLCJpdGVtIiwiaXNQbGFpbk9iamVjdCIsInJlc3VsdE9iaiIsImtleSIsInZhbHVlIiwidG9QYWlycyIsInJlY3Vyc2l2ZWx5Q2FsbGVkVmFsdWUiLCJwYXJzZUNhcHNBcnJheSIsImNhcCIsInBhcnNlZENhcHMiLCJKU09OIiwiaWduIl0sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7OztBQUFBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUVBLE1BQU1BLE9BQU8sR0FBRyxNQUFoQjtBQUNBLE1BQU1DLFFBQVEsR0FBRyxDQUFDLE1BQUQsRUFBU0QsT0FBVCxDQUFqQjtBQUNBLE1BQU1FLGNBQWMsR0FBRyxDQUNyQixpQkFEcUIsRUFFckIsOEJBRnFCLEVBR3JCLGlCQUhxQixDQUF2QjtBQUtBLE1BQU1DLG1CQUFtQixHQUFHLE9BQU8sRUFBUCxHQUFZLEVBQVosR0FBaUIsRUFBN0M7QUFDQSxNQUFNQyxrQkFBa0IsR0FBRyxJQUFJQyxpQkFBSixDQUFRO0FBQ2pDQyxFQUFBQSxNQUFNLEVBQUVILG1CQUR5QjtBQUVqQ0ksRUFBQUEsY0FBYyxFQUFFLElBRmlCO0FBR2pDQyxFQUFBQSxPQUFPLEVBQUUsT0FBT0MsR0FBUCxFQUFZO0FBQUNDLElBQUFBO0FBQUQsR0FB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VCxHQUF1Qk8sc0JBQXZCO0FBQ0QsT0FGRCxNQUVPLElBQUlILEdBQUcsS0FBS0osU0FBWixFQUF1QjtBQUM1QkcsUUFBQUEsU0FBUyxDQUFDSixRQUFELENBQVQsR0FBc0JRLHNCQUF0QjtBQUNEOztBQUNESixNQUFBQSxTQUFTLENBQUNDLEdBQUQsQ0FBVCxHQUFpQkcsc0JBQWpCO0FBQ0Q7O0FBQ0QsV0FBT0osU0FBUDtBQUNEOztBQUdELFNBQU9MLEtBQVA7QUFDRDs7QUFRRCxTQUFTVSxjQUFULENBQXlCQyxHQUF6QixFQUE4QjtBQUM1QixNQUFJekgsZ0JBQUVFLE9BQUYsQ0FBVXVILEdBQVYsQ0FBSixFQUFvQjtBQUNsQixXQUFPQSxHQUFQO0FBQ0Q7O0FBRUQsTUFBSUMsVUFBSjs7QUFDQSxNQUFJO0FBQ0ZBLElBQUFBLFVBQVUsR0FBR0MsSUFBSSxDQUFDakgsS0FBTCxDQUFXK0csR0FBWCxDQUFiOztBQUNBLFFBQUl6SCxnQkFBRUUsT0FBRixDQUFVd0gsVUFBVixDQUFKLEVBQTJCO0FBQ3pCLGFBQU9BLFVBQVA7QUFDRDtBQUNGLEdBTEQsQ0FLRSxPQUFPRSxHQUFQLEVBQVk7QUFDWmpMLG9CQUFPc0IsSUFBUCxDQUFhLDBDQUFiO0FBQ0Q7O0FBQ0QsTUFBSStCLGdCQUFFQyxRQUFGLENBQVd3SCxHQUFYLENBQUosRUFBcUI7QUFDbkIsV0FBTyxDQUFDQSxHQUFELENBQVA7QUFDRDs7QUFDRCxRQUFNLElBQUkzSCxLQUFKLENBQVcsaURBQWdEMkgsR0FBSSxFQUEvRCxDQUFOO0FBQ0QiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgXyBmcm9tICdsb2Rhc2gnO1xuaW1wb3J0IHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgdXJsIGZyb20gJ3VybCc7XG5pbXBvcnQgbG9nZ2VyIGZyb20gJy4vbG9nZ2VyJztcbmltcG9ydCB7IHRlbXBEaXIsIGZzLCB1dGlsLCB6aXAsIG5ldCwgdGltaW5nIH0gZnJvbSAnYXBwaXVtLXN1cHBvcnQnO1xuaW1wb3J0IExSVSBmcm9tICdscnUtY2FjaGUnO1xuaW1wb3J0IEFzeW5jTG9jayBmcm9tICdhc3luYy1sb2NrJztcbmltcG9ydCBheGlvcyBmcm9tICdheGlvcyc7XG5pbXBvcnQgeyBnZXRMb2NhbEFwcHNGb2xkZXIsIGdldFNoYXJlZEZvbGRlckZvckFwcFVybCwgZ2V0TG9jYWxGaWxlRm9yQXBwVXJsLCBnZXRGaWxlQ29udGVudExlbmd0aCB9IGZyb20gJy4vbWNsb3VkLXV0aWxzJztcblxuY29uc3QgSVBBX0VYVCA9ICcuaXBhJztcbmNvbnN0IFpJUF9FWFRTID0gWycuemlwJywgSVBBX0VYVF07XG5jb25zdCBaSVBfTUlNRV9UWVBFUyA9IFtcbiAgJ2FwcGxpY2F0aW9uL3ppcCcsXG4gICdhcHBsaWNhdGlvbi94LXppcC1jb21wcmVzc2VkJyxcbiAgJ211bHRpcGFydC94LXppcCcsXG5dO1xuY29uc3QgQ0FDSEVEX0FQUFNfTUFYX0FHRSA9IDEwMDAgKiA2MCAqIDYwICogMjQ7IC8vIG1zXG5jb25zdCBBUFBMSUNBVElPTlNfQ0FDSEUgPSBuZXcgTFJVKHtcbiAgbWF4QWdlOiBDQUNIRURfQVBQU19NQVhfQUdFLCAvLyBleHBpcmUgYWZ0ZXIgMjQgaG91cnNcbiAgdXBkYXRlQWdlT25HZXQ6IHRydWUsXG4gIGRpc3Bvc2U6IGFzeW5jIChhcHAsIHtmdWxsUGF0aH0pID0+IHtcbiAgICBpZiAoIWF3YWl0IGZzLmV4aXN0cyhmdWxsUGF0aCkpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBsb2dnZXIuaW5mbyhgVGhlIGFwcGxpY2F0aW9uICcke2FwcH0nIGNhY2hlZCBhdCAnJHtmdWxsUGF0aH0nIGhhcyBleHBpcmVkYCk7XG4gICAgYXdhaXQgZnMucmltcmFmKGZ1bGxQYXRoKTtcbiAgfSxcbiAgbm9EaXNwb3NlT25TZXQ6IHRydWUsXG59KTtcbmNvbnN0IEFQUExJQ0FUSU9OU19DQUNIRV9HVUFSRCA9IG5ldyBBc3luY0xvY2soKTtcbmNvbnN0IFNBTklUSVpFX1JFUExBQ0VNRU5UID0gJy0nO1xuY29uc3QgREVGQVVMVF9CQVNFTkFNRSA9ICdhcHBpdW0tYXBwJztcbmNvbnN0IEFQUF9ET1dOTE9BRF9USU1FT1VUX01TID0gMTIwICogMTAwMDtcblxucHJvY2Vzcy5vbignZXhpdCcsICgpID0+IHtcbiAgaWYgKEFQUExJQ0FUSU9OU19DQUNIRS5pdGVtQ291bnQgPT09IDApIHtcbiAgICByZXR1cm47XG4gIH1cblxuICBjb25zdCBhcHBQYXRocyA9IEFQUExJQ0FUSU9OU19DQUNIRS52YWx1ZXMoKVxuICAgIC5tYXAoKHtmdWxsUGF0aH0pID0+IGZ1bGxQYXRoKTtcbiAgbG9nZ2VyLmRlYnVnKGBQZXJmb3JtaW5nIGNsZWFudXAgb2YgJHthcHBQYXRocy5sZW5ndGh9IGNhY2hlZCBgICtcbiAgICB1dGlsLnBsdXJhbGl6ZSgnYXBwbGljYXRpb24nLCBhcHBQYXRocy5sZW5ndGgpKTtcbiAgZm9yIChjb25zdCBhcHBQYXRoIG9mIGFwcFBhdGhzKSB7XG4gICAgdHJ5IHtcbiAgICAgIC8vIEFzeW5jaHJvbm91cyBjYWxscyBhcmUgbm90IHN1cHBvcnRlZCBpbiBvbkV4aXQgaGFuZGxlclxuICAgICAgZnMucmltcmFmU3luYyhhcHBQYXRoKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBsb2dnZXIud2FybihlLm1lc3NhZ2UpO1xuICAgIH1cbiAgfVxufSk7XG5cblxuYXN5bmMgZnVuY3Rpb24gcmV0cmlldmVIZWFkZXJzIChsaW5rKSB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIChhd2FpdCBheGlvcyh7XG4gICAgICB1cmw6IGxpbmssXG4gICAgICBtZXRob2Q6ICdIRUFEJyxcbiAgICAgIHRpbWVvdXQ6IDUwMDAsXG4gICAgfSkpLmhlYWRlcnM7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBsb2dnZXIuaW5mbyhgQ2Fubm90IHNlbmQgSEVBRCByZXF1ZXN0IHRvICcke2xpbmt9Jy4gT3JpZ2luYWwgZXJyb3I6ICR7ZS5tZXNzYWdlfWApO1xuICB9XG4gIHJldHVybiB7fTtcbn1cblxuZnVuY3Rpb24gZ2V0Q2FjaGVkQXBwbGljYXRpb25QYXRoIChsaW5rLCBjdXJyZW50QXBwUHJvcHMgPSB7fSkge1xuICBjb25zdCByZWZyZXNoID0gKCkgPT4ge1xuICAgIGxvZ2dlci5pbmZvKGBDVVNUT00gSEVMUEVSIWApO1xuICAgIGxvZ2dlci5kZWJ1ZyhgQSBmcmVzaCBjb3B5IG9mIHRoZSBhcHBsaWNhdGlvbiBpcyBnb2luZyB0byBiZSBkb3dubG9hZGVkIGZyb20gJHtsaW5rfWApO1xuICAgIHJldHVybiBudWxsO1xuICB9O1xuXG4gIGlmIChBUFBMSUNBVElPTlNfQ0FDSEUuaGFzKGxpbmspKSB7XG4gICAgY29uc3Qge1xuICAgICAgbGFzdE1vZGlmaWVkOiBjdXJyZW50TW9kaWZpZWQsXG4gICAgICBpbW11dGFibGU6IGN1cnJlbnRJbW11dGFibGUsXG4gICAgICAvLyBtYXhBZ2UgaXMgaW4gc2Vjb25kc1xuICAgICAgbWF4QWdlOiBjdXJyZW50TWF4QWdlLFxuICAgIH0gPSBjdXJyZW50QXBwUHJvcHM7XG4gICAgY29uc3Qge1xuICAgICAgLy8gRGF0ZSBpbnN0YW5jZVxuICAgICAgbGFzdE1vZGlmaWVkLFxuICAgICAgLy8gYm9vbGVhblxuICAgICAgaW1tdXRhYmxlLFxuICAgICAgLy8gVW5peCB0aW1lIGluIG1pbGxpc2Vjb25kc1xuICAgICAgdGltZXN0YW1wLFxuICAgICAgZnVsbFBhdGgsXG4gICAgfSA9IEFQUExJQ0FUSU9OU19DQUNIRS5nZXQobGluayk7XG4gICAgaWYgKGxhc3RNb2RpZmllZCAmJiBjdXJyZW50TW9kaWZpZWQpIHtcbiAgICAgIGlmIChjdXJyZW50TW9kaWZpZWQuZ2V0VGltZSgpIDw9IGxhc3RNb2RpZmllZC5nZXRUaW1lKCkpIHtcbiAgICAgICAgbG9nZ2VyLmRlYnVnKGBUaGUgYXBwbGljYXRpb24gYXQgJHtsaW5rfSBoYXMgbm90IGJlZW4gbW9kaWZpZWQgc2luY2UgJHtsYXN0TW9kaWZpZWR9YCk7XG4gICAgICAgIHJldHVybiBmdWxsUGF0aDtcbiAgICAgIH1cbiAgICAgIGxvZ2dlci5kZWJ1ZyhgVGhlIGFwcGxpY2F0aW9uIGF0ICR7bGlua30gaGFzIGJlZW4gbW9kaWZpZWQgc2luY2UgJHtsYXN0TW9kaWZpZWR9YCk7XG4gICAgICByZXR1cm4gcmVmcmVzaCgpO1xuICAgIH1cbiAgICBpZiAoaW1tdXRhYmxlICYmIGN1cnJlbnRJbW11dGFibGUpIHtcbiAgICAgIGxvZ2dlci5kZWJ1ZyhgVGhlIGFwcGxpY2F0aW9uIGF0ICR7bGlua30gaXMgaW1tdXRhYmxlYCk7XG4gICAgICByZXR1cm4gZnVsbFBhdGg7XG4gICAgfVxuICAgIGlmIChjdXJyZW50TWF4QWdlICYmIHRpbWVzdGFtcCkge1xuICAgICAgY29uc3QgbXNMZWZ0ID0gdGltZXN0YW1wICsgY3VycmVudE1heEFnZSAqIDEwMDAgLSBEYXRlLm5vdygpO1xuICAgICAgaWYgKG1zTGVmdCA+IDApIHtcbiAgICAgICAgbG9nZ2VyLmRlYnVnKGBUaGUgY2FjaGVkIGFwcGxpY2F0aW9uICcke3BhdGguYmFzZW5hbWUoZnVsbFBhdGgpfScgd2lsbCBleHBpcmUgaW4gJHttc0xlZnQgLyAxMDAwfXNgKTtcbiAgICAgICAgcmV0dXJuIGZ1bGxQYXRoO1xuICAgICAgfVxuICAgICAgbG9nZ2VyLmRlYnVnKGBUaGUgY2FjaGVkIGFwcGxpY2F0aW9uICcke3BhdGguYmFzZW5hbWUoZnVsbFBhdGgpfScgaGFzIGV4cGlyZWRgKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHJlZnJlc2goKTtcbn1cblxuZnVuY3Rpb24gdmVyaWZ5QXBwRXh0ZW5zaW9uIChhcHAsIHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMpIHtcbiAgaWYgKHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMuaW5jbHVkZXMocGF0aC5leHRuYW1lKGFwcCkpKSB7XG4gICAgcmV0dXJuIGFwcDtcbiAgfVxuICB0aHJvdyBuZXcgRXJyb3IoYE5ldyBhcHAgcGF0aCAnJHthcHB9JyBkaWQgbm90IGhhdmUgYCArXG4gICAgYCR7dXRpbC5wbHVyYWxpemUoJ2V4dGVuc2lvbicsIHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMubGVuZ3RoLCBmYWxzZSl9OiBgICtcbiAgICBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gY29uZmlndXJlQXBwIChhcHAsIHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMpIHtcbiAgaWYgKCFfLmlzU3RyaW5nKGFwcCkpIHtcbiAgICAvLyBpbW1lZGlhdGVseSBzaG9ydGNpcmN1aXQgaWYgbm90IGdpdmVuIGFuIGFwcFxuICAgIHJldHVybjtcbiAgfVxuICBpZiAoIV8uaXNBcnJheShzdXBwb3J0ZWRBcHBFeHRlbnNpb25zKSkge1xuICAgIHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMgPSBbc3VwcG9ydGVkQXBwRXh0ZW5zaW9uc107XG4gIH1cblxuICBsZXQgbmV3QXBwID0gYXBwO1xuICBsZXQgc2hvdWxkVW56aXBBcHAgPSBmYWxzZTtcbiAgbGV0IGFyY2hpdmVIYXNoID0gbnVsbDtcbiAgbGV0IGxvY2FsQXBwc0ZvbGRlcjtcbiAgY29uc3QgcmVtb3RlQXBwUHJvcHMgPSB7XG4gICAgbGFzdE1vZGlmaWVkOiBudWxsLFxuICAgIGltbXV0YWJsZTogZmFsc2UsXG4gICAgbWF4QWdlOiBudWxsLFxuICB9O1xuICBjb25zdCB7cHJvdG9jb2wsIHBhdGhuYW1lfSA9IHVybC5wYXJzZShuZXdBcHApO1xuICBjb25zdCBpc1VybCA9IFsnaHR0cDonLCAnaHR0cHM6J10uaW5jbHVkZXMocHJvdG9jb2wpO1xuXG4gIHJldHVybiBhd2FpdCBBUFBMSUNBVElPTlNfQ0FDSEVfR1VBUkQuYWNxdWlyZShhcHAsIGFzeW5jICgpID0+IHtcbiAgICBpZiAoaXNVcmwpIHtcbiAgICAgIC8vIFVzZSB0aGUgYXBwIGZyb20gcmVtb3RlIFVSTFxuICAgICAgbG9nZ2VyLmluZm8oYFVzaW5nIGRvd25sb2FkYWJsZSBhcHAgJyR7bmV3QXBwfSdgKTtcbiAgICAgIGNvbnN0IGhlYWRlcnMgPSBhd2FpdCByZXRyaWV2ZUhlYWRlcnMobmV3QXBwKTtcbiAgICAgIGlmICghXy5pc0VtcHR5KGhlYWRlcnMpKSB7XG4gICAgICAgIGlmIChoZWFkZXJzWydsYXN0LW1vZGlmaWVkJ10pIHtcbiAgICAgICAgICByZW1vdGVBcHBQcm9wcy5sYXN0TW9kaWZpZWQgPSBuZXcgRGF0ZShoZWFkZXJzWydsYXN0LW1vZGlmaWVkJ10pO1xuICAgICAgICB9XG4gICAgICAgIGxvZ2dlci5kZWJ1ZyhgTGFzdC1Nb2RpZmllZDogJHtoZWFkZXJzWydsYXN0LW1vZGlmaWVkJ119YCk7XG4gICAgICAgIGlmIChoZWFkZXJzWydjYWNoZS1jb250cm9sJ10pIHtcbiAgICAgICAgICByZW1vdGVBcHBQcm9wcy5pbW11dGFibGUgPSAvXFxiaW1tdXRhYmxlXFxiL2kudGVzdChoZWFkZXJzWydjYWNoZS1jb250cm9sJ10pO1xuICAgICAgICAgIGNvbnN0IG1heEFnZU1hdGNoID0gL1xcYm1heC1hZ2U9KFxcZCspXFxiL2kuZXhlYyhoZWFkZXJzWydjYWNoZS1jb250cm9sJ10pO1xuICAgICAgICAgIGlmIChtYXhBZ2VNYXRjaCkge1xuICAgICAgICAgICAgcmVtb3RlQXBwUHJvcHMubWF4QWdlID0gcGFyc2VJbnQobWF4QWdlTWF0Y2hbMV0sIDEwKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgbG9nZ2VyLmRlYnVnKGBDYWNoZS1Db250cm9sOiAke2hlYWRlcnNbJ2NhY2hlLWNvbnRyb2wnXX1gKTtcbiAgICAgIH1cblxuICAgICAgLy8gKioqKiogQ3VzdG9tIGxvZ2ljIGZvciB2ZXJpZmljYXRpb24gb2YgbG9jYWwgc3RhdGljIHBhdGggZm9yIEFQUHMgKioqKipcbiAgICAgIGxldCBkb3dubG9hZElzTmVhZGVkID0gdHJ1ZTtcbiAgICAgIGxvY2FsQXBwc0ZvbGRlciA9IGF3YWl0IGdldExvY2FsQXBwc0ZvbGRlcigpO1xuICAgICAgbGV0IGxvY2FsRmlsZTtcbiAgICAgIGxldCBsb2NrRmlsZTtcbiAgICAgIGNvbnN0IHdhaXRpbmdUaW1lID0gMTAwMDtcbiAgICAgIGNvbnN0IG1heEF0dGVtcHRzQ291bnQgPSBwcm9jZXNzLmVudi5BUFBJVU1fQVBQX1dBSVRJTkdfVElNRU9VVDtcbiAgICAgIFxuICAgICAgaWYobG9jYWxBcHBzRm9sZGVyICE9IHVuZGVmaW5lZCkge1xuICAgICAgICBsb2NhbEZpbGUgPSBhd2FpdCBnZXRMb2NhbEZpbGVGb3JBcHBVcmwobmV3QXBwKTtcbiAgICAgICAgbG9ja0ZpbGUgPSBsb2NhbEZpbGUgKyAnLmxvY2snO1xuXG4gICAgICAgIGlmKGF3YWl0IGZzLmV4aXN0cyhsb2NhbEZpbGUpKSB7XG4gICAgICAgICAgbG9nZ2VyLmluZm8oYExvY2FsIHZlcnNpb24gb2YgYXBwIHdhcyBmb3VuZC4gV2lsbCBjaGVjayBhY3R1YWxpdHkgb2YgdGhlIGZpbGVgKTtcbiAgICAgICAgICAvLyBDaGVja2luZyBvZiBsb2NhbCBhcHBsaWNhdGlvbiBhY3R1YWxpdHlcbiAgICAgICAgICBjb25zdCByZW1vdGVGaWxlTGVuZ3RoID0gYXdhaXQgZ2V0RmlsZUNvbnRlbnRMZW5ndGgoYXBwKTtcbiAgICAgICAgICAvLyBBdCB0aGlzIHBvaW50IGxvY2FsIGZpbGUgbWlnaHQgYmUgZGVsZXRlZCBieSBwYXJhbGxlbCBzZXNzaW9uIHdoaWNoIHVwZGF0ZXMgb3V0ZGF0ZWQgYXBwXG4gICAgICAgICAgbGV0IGF0dGVtcHRzQ291bnQgPSAwO1xuICAgICAgICAgIHdoaWxlKCFhd2FpdCBmcy5leGlzdHMobG9jYWxGaWxlKSAmJiAoYXR0ZW1wdHNDb3VudCsrIDwgbWF4QXR0ZW1wdHNDb3VudCkpIHtcbiAgICAgICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICAgICAgICAgIGxvZ2dlci5pbmZvKGBBdHRlbXB0ICMke2F0dGVtcHRzQ291bnR9IGZvciBsb2NhbCBhcHAgZmlsZSB0byBhcHBlYXIgYWdhaW5gKTtcbiAgICAgICAgICAgICAgc2V0VGltZW91dChyZXNvbHZlLCB3YWl0aW5nVGltZSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYoIWF3YWl0IGZzLmV4aXN0cyhsb2NhbEZpbGUpKSB7XG4gICAgICAgICAgICB0aHJvdyBFcnJvcihgTG9jYWwgYXBwbGljYXRpb24gZmlsZSBoYXMgbm90IGFwcGVhcmVkIGFmdGVyIHVwZGF0aW5nIGJ5IHBhcmFsbGVsIEFwcGl1bSBzZXNzaW9uYCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGNvbnN0IHN0YXRzID0gYXdhaXQgZnMuc3RhdChsb2NhbEZpbGUpO1xuICAgICAgICAgIGNvbnN0IGxvY2FsRmlsZUxlbmd0aCA9IHN0YXRzLnNpemU7XG4gICAgICAgICAgbG9nZ2VyLmluZm8oYFJlbW90ZSBmaWxlIHNpemUgaXMgJHtyZW1vdGVGaWxlTGVuZ3RofSBhbmQgbG9jYWwgZmlsZSBzaXplIGlzICR7bG9jYWxGaWxlTGVuZ3RofWApO1xuICAgICAgICAgIGlmKHJlbW90ZUZpbGVMZW5ndGggIT0gbG9jYWxGaWxlTGVuZ3RoKSB7XG4gICAgICAgICAgICBsb2dnZXIuaW5mbyhgU2l6ZXMgZGlmZmVyLiBIZW5jZSB0aGF0J3MgbmVlZGVkIHRvIGRvd25sb2FkIGZyZXNoIHZlcnNpb24gb2YgdGhlIGFwcGApO1xuICAgICAgICAgICAgYXdhaXQgZnMudW5saW5rKGxvY2FsRmlsZSk7XG4gICAgICAgICAgICBkb3dubG9hZElzTmVhZGVkID0gdHJ1ZTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgbG9nZ2VyLmluZm8oYFNpemVzIGFyZSB0aGUgc2FtZS4gSGVuY2Ugd2lsbCB1c2UgYWxyZWFkeSBzdG9yZWQgYXBwbGljYXRpb24gZm9yIHRoZSBzZXNzaW9uYCk7XG4gICAgICAgICAgICBuZXdBcHAgPSBsb2NhbEZpbGU7XG4gICAgICAgICAgICBzaG91bGRVbnppcEFwcCA9IFpJUF9FWFRTLmluY2x1ZGVzKHBhdGguZXh0bmFtZShuZXdBcHApKTtcbiAgICAgICAgICAgIGRvd25sb2FkSXNOZWFkZWQgPSBmYWxzZTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAoYXdhaXQgZnMuZXhpc3RzKGxvY2tGaWxlKSkge1xuICAgICAgICAgIGxvZ2dlci5pbmZvKGBMb2NhbCB2ZXJzaW9uIG9mIGFwcCBub3QgZm91bmQgYnV0IC5sb2NrIGZpbGUgZXhpc3RzLiBXYWl0aW5nIGZvciAubG9jayB0byBkaXNhcHBlYXJgKTtcbiAgICAgICAgICAvLyBXYWl0IGZvciBzb21lIHRpbWUgdGlsbCBBcHAgaXMgZG93bmxvYWRlZCBieSBzb21lIHBhcmFsbGVsIEFwcGl1bSBpbnN0YW5jZVxuICAgICAgICAgIGxldCBhdHRlbXB0c0NvdW50ID0gMDtcbiAgICAgICAgICB3aGlsZShhd2FpdCBmcy5leGlzdHMobG9ja0ZpbGUpICYmIChhdHRlbXB0c0NvdW50KysgPCBtYXhBdHRlbXB0c0NvdW50KSkge1xuICAgICAgICAgICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgICAgICAgICAgbG9nZ2VyLmluZm8oYEF0dGVtcHQgIyR7YXR0ZW1wdHNDb3VudH0gZm9yIC5sb2NrIGZpbGUgY2hlY2tpbmdgKTtcbiAgICAgICAgICAgICAgc2V0VGltZW91dChyZXNvbHZlLCB3YWl0aW5nVGltZSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYoYXdhaXQgZnMuZXhpc3RzKGxvY2tGaWxlKSkge1xuICAgICAgICAgICAgdGhyb3cgRXJyb3IoYC5sb2NrIGZpbGUgZm9yIGRvd25sb2FkaW5nIGFwcGxpY2F0aW9uIGhhcyBub3QgZGlzYXBwZWFyZWQgYWZ0ZXIgJHt3YWl0aW5nVGltZSAqIG1heEF0dGVtcHRzQ291bnR9bXNgKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYoIWF3YWl0IGZzLmV4aXN0cyhsb2NhbEZpbGUpKSB7XG4gICAgICAgICAgICB0aHJvdyBFcnJvcihgTG9jYWwgYXBwbGljYXRpb24gZmlsZSBoYXMgbm90IGFwcGVhcmVkIGFmdGVyIC5sb2NrIGZpbGUgcmVtb3ZhbGApO1xuICAgICAgICAgIH1cbiAgICAgICAgICBsb2dnZXIuaW5mbyhgTG9jYWwgdmVyc2lvbiBvZiBhcHAgd2FzIGZvdW5kIGFmdGVyIC5sb2NrIGZpbGUgcmVtb3ZhbC4gV2lsbCB1c2UgaXQgZm9yIG5ldyBzZXNzaW9uYCk7XG4gICAgICAgICAgbmV3QXBwID0gbG9jYWxGaWxlO1xuICAgICAgICAgIHNob3VsZFVuemlwQXBwID0gWklQX0VYVFMuaW5jbHVkZXMocGF0aC5leHRuYW1lKG5ld0FwcCkpO1xuICAgICAgICAgIGRvd25sb2FkSXNOZWFkZWQgPSBmYWxzZTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBsb2dnZXIuaW5mbyhgTmVpdGhlciBsb2NhbCB2ZXJzaW9uIG9mIGFwcCBub3IgLmxvY2sgZmlsZSB3YXMgZm91bmQuIFdpbGwgZG93bmxvYWQgYXBwIGZyb20gcmVtb3RlIFVSTC5gKTtcbiAgICAgICAgICBkb3dubG9hZElzTmVhZGVkID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbG9nZ2VyLmluZm8oYExvY2FsIGFwcHMgZm9sZGVyIGlzIG5vdCBkZWZpbmVkIHZpYSBlbnZpcm9ubWVudCBwcm9wZXJ0aWVzLCBoZW5jZSBza2lwcGluZyB0aGlzIGxvZ2ljYCk7XG4gICAgICB9XG4gICAgICBpZihkb3dubG9hZElzTmVhZGVkKSB7XG4gICAgICBcbiAgICAgICAgaWYobG9jYWxBcHBzRm9sZGVyICE9IHVuZGVmaW5lZCkge1xuICAgICAgICAgIGxvZ2dlci5pbmZvKGBMb2NhbCB2ZXJzaW9uIG9mIGFwcCB3YXMgbm90IGZvdW5kLiBIZW5jZSB1c2luZyBkZWZhdWx0IEFwcGl1bSBsb2dpYyBmb3IgZG93bmxvYWRpbmdgKTtcbiAgICAgICAgICBjb25zdCBzaGFyZWRGb2xkZXJQYXRoID0gYXdhaXQgZ2V0U2hhcmVkRm9sZGVyRm9yQXBwVXJsKGFwcCk7XG4gICAgICAgICAgbG9nZ2VyLmluZm8oYEZvbGRlciBmb3IgbG9jYWwgc2hhcmVkIGFwcHM6ICR7c2hhcmVkRm9sZGVyUGF0aH1gKTtcbiAgICAgICAgICBhd2FpdCBmcy5jbG9zZShhd2FpdCBmcy5vcGVuKGxvY2tGaWxlLCAndycpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRyeSB7XG4gICAgICBjb25zdCBjYWNoZWRQYXRoID0gZ2V0Q2FjaGVkQXBwbGljYXRpb25QYXRoKGFwcCwgcmVtb3RlQXBwUHJvcHMpO1xuICAgICAgaWYgKGNhY2hlZFBhdGgpIHtcbiAgICAgICAgaWYgKGF3YWl0IGZzLmV4aXN0cyhjYWNoZWRQYXRoKSkge1xuICAgICAgICAgIGxvZ2dlci5pbmZvKGBSZXVzaW5nIHByZXZpb3VzbHkgZG93bmxvYWRlZCBhcHBsaWNhdGlvbiBhdCAnJHtjYWNoZWRQYXRofSdgKTtcbiAgICAgICAgICByZXR1cm4gdmVyaWZ5QXBwRXh0ZW5zaW9uKGNhY2hlZFBhdGgsIHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMpO1xuICAgICAgICB9XG4gICAgICAgIGxvZ2dlci5pbmZvKGBUaGUgYXBwbGljYXRpb24gYXQgJyR7Y2FjaGVkUGF0aH0nIGRvZXMgbm90IGV4aXN0IGFueW1vcmUuIERlbGV0aW5nIGl0IGZyb20gdGhlIGNhY2hlYCk7XG4gICAgICAgIEFQUExJQ0FUSU9OU19DQUNIRS5kZWwoYXBwKTtcbiAgICAgIH1cblxuICAgICAgbGV0IGZpbGVOYW1lID0gbnVsbDtcbiAgICAgIGNvbnN0IGJhc2VuYW1lID0gZnMuc2FuaXRpemVOYW1lKHBhdGguYmFzZW5hbWUoZGVjb2RlVVJJQ29tcG9uZW50KHBhdGhuYW1lKSksIHtcbiAgICAgICAgcmVwbGFjZW1lbnQ6IFNBTklUSVpFX1JFUExBQ0VNRU5UXG4gICAgICB9KTtcbiAgICAgIGNvbnN0IGV4dG5hbWUgPSBwYXRoLmV4dG5hbWUoYmFzZW5hbWUpO1xuICAgICAgLy8gdG8gZGV0ZXJtaW5lIGlmIHdlIG5lZWQgdG8gdW56aXAgdGhlIGFwcCwgd2UgaGF2ZSBhIG51bWJlciBvZiBwbGFjZXNcbiAgICAgIC8vIHRvIGxvb2s6IGNvbnRlbnQgdHlwZSwgY29udGVudCBkaXNwb3NpdGlvbiwgb3IgdGhlIGZpbGUgZXh0ZW5zaW9uXG4gICAgICBpZiAoWklQX0VYVFMuaW5jbHVkZXMoZXh0bmFtZSkpIHtcbiAgICAgICAgZmlsZU5hbWUgPSBiYXNlbmFtZTtcbiAgICAgICAgc2hvdWxkVW56aXBBcHAgPSB0cnVlO1xuICAgICAgfVxuICAgICAgaWYgKGhlYWRlcnNbJ2NvbnRlbnQtdHlwZSddKSB7XG4gICAgICAgIGNvbnN0IGN0ID0gaGVhZGVyc1snY29udGVudC10eXBlJ107XG4gICAgICAgIGxvZ2dlci5kZWJ1ZyhgQ29udGVudC1UeXBlOiAke2N0fWApO1xuICAgICAgICAvLyB0aGUgZmlsZXR5cGUgbWF5IG5vdCBiZSBvYnZpb3VzIGZvciBjZXJ0YWluIHVybHMsIHNvIGNoZWNrIHRoZSBtaW1lIHR5cGUgdG9vXG4gICAgICAgIGlmIChaSVBfTUlNRV9UWVBFUy5zb21lKChtaW1lVHlwZSkgPT4gbmV3IFJlZ0V4cChgXFxcXGIke18uZXNjYXBlUmVnRXhwKG1pbWVUeXBlKX1cXFxcYmApLnRlc3QoY3QpKSkge1xuICAgICAgICAgIGlmICghZmlsZU5hbWUpIHtcbiAgICAgICAgICAgIGZpbGVOYW1lID0gYCR7REVGQVVMVF9CQVNFTkFNRX0uemlwYDtcbiAgICAgICAgICB9XG4gICAgICAgICAgc2hvdWxkVW56aXBBcHAgPSB0cnVlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAoaGVhZGVyc1snY29udGVudC1kaXNwb3NpdGlvbiddICYmIC9eYXR0YWNobWVudC9pLnRlc3QoaGVhZGVyc1snY29udGVudC1kaXNwb3NpdGlvbiddKSkge1xuICAgICAgICBsb2dnZXIuZGVidWcoYENvbnRlbnQtRGlzcG9zaXRpb246ICR7aGVhZGVyc1snY29udGVudC1kaXNwb3NpdGlvbiddfWApO1xuICAgICAgICBjb25zdCBtYXRjaCA9IC9maWxlbmFtZT1cIihbXlwiXSspL2kuZXhlYyhoZWFkZXJzWydjb250ZW50LWRpc3Bvc2l0aW9uJ10pO1xuICAgICAgICBpZiAobWF0Y2gpIHtcbiAgICAgICAgICBmaWxlTmFtZSA9IGZzLnNhbml0aXplTmFtZShtYXRjaFsxXSwge1xuICAgICAgICAgICAgcmVwbGFjZW1lbnQ6IFNBTklUSVpFX1JFUExBQ0VNRU5UXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgc2hvdWxkVW56aXBBcHAgPSBzaG91bGRVbnppcEFwcCB8fCBaSVBfRVhUUy5pbmNsdWRlcyhwYXRoLmV4dG5hbWUoZmlsZU5hbWUpKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKCFmaWxlTmFtZSkge1xuICAgICAgICAvLyBhc3NpZ24gdGhlIGRlZmF1bHQgZmlsZSBuYW1lIGFuZCB0aGUgZXh0ZW5zaW9uIGlmIG5vbmUgaGFzIGJlZW4gZGV0ZWN0ZWRcbiAgICAgICAgY29uc3QgcmVzdWx0aW5nTmFtZSA9IGJhc2VuYW1lXG4gICAgICAgICAgPyBiYXNlbmFtZS5zdWJzdHJpbmcoMCwgYmFzZW5hbWUubGVuZ3RoIC0gZXh0bmFtZS5sZW5ndGgpXG4gICAgICAgICAgOiBERUZBVUxUX0JBU0VOQU1FO1xuICAgICAgICBsZXQgcmVzdWx0aW5nRXh0ID0gZXh0bmFtZTtcbiAgICAgICAgaWYgKCFzdXBwb3J0ZWRBcHBFeHRlbnNpb25zLmluY2x1ZGVzKHJlc3VsdGluZ0V4dCkpIHtcbiAgICAgICAgICBsb2dnZXIuaW5mbyhgVGhlIGN1cnJlbnQgZmlsZSBleHRlbnNpb24gJyR7cmVzdWx0aW5nRXh0fScgaXMgbm90IHN1cHBvcnRlZC4gYCArXG4gICAgICAgICAgICBgRGVmYXVsdGluZyB0byAnJHtfLmZpcnN0KHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMpfSdgKTtcbiAgICAgICAgICByZXN1bHRpbmdFeHQgPSBfLmZpcnN0KHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMpO1xuICAgICAgICB9XG4gICAgICAgIGZpbGVOYW1lID0gYCR7cmVzdWx0aW5nTmFtZX0ke3Jlc3VsdGluZ0V4dH1gO1xuICAgICAgfVxuICAgICAgY29uc3QgdGFyZ2V0UGF0aCA9IGF3YWl0IHRlbXBEaXIucGF0aCh7XG4gICAgICAgIHByZWZpeDogZmlsZU5hbWUsXG4gICAgICAgIHN1ZmZpeDogJycsXG4gICAgICB9KTtcbiAgICAgIG5ld0FwcCA9IGF3YWl0IGRvd25sb2FkQXBwKG5ld0FwcCwgdGFyZ2V0UGF0aCk7XG5cbiAgICAgIC8vICoqKioqIEN1c3RvbSBsb2dpYyBmb3IgY29weWluZyBvZiBkb3dubG9hZGVkIGFwcCB0byBzdGF0aWMgbG9jYXRpb24gKioqKipcbiAgICAgIGlmKGxvY2FsQXBwc0ZvbGRlciAhPSB1bmRlZmluZWQpIHtcbiAgICAgICAgbG9nZ2VyLmluZm8oYE5ldyBhcHAgcGF0aDogJHtuZXdBcHB9YCk7XG4gICAgICAgIGF3YWl0IGZzLmNvcHlGaWxlKG5ld0FwcCwgbG9jYWxGaWxlKTtcbiAgICAgIH1cbiAgICAgIH1cbiAgICAgIGZpbmFsbHkge1xuICAgICAgICBpZihsb2NhbEFwcHNGb2xkZXIgIT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgbG9nZ2VyLmluZm8oYEdvaW5nIHRvIHJlbW92ZSBsb2NrIGZpbGUgJHtsb2NrRmlsZX1gKVxuICAgICAgICAgIGF3YWl0IGZzLnVubGluayhsb2NrRmlsZSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGF3YWl0IGZzLmV4aXN0cyhuZXdBcHApKSB7XG4gICAgICAvLyBVc2UgdGhlIGxvY2FsIGFwcFxuICAgICAgbG9nZ2VyLmluZm8oYFVzaW5nIGxvY2FsIGFwcCAnJHtuZXdBcHB9J2ApO1xuICAgICAgc2hvdWxkVW56aXBBcHAgPSBaSVBfRVhUUy5pbmNsdWRlcyhwYXRoLmV4dG5hbWUobmV3QXBwKSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGxldCBlcnJvck1lc3NhZ2UgPSBgVGhlIGFwcGxpY2F0aW9uIGF0ICcke25ld0FwcH0nIGRvZXMgbm90IGV4aXN0IG9yIGlzIG5vdCBhY2Nlc3NpYmxlYDtcbiAgICAgIC8vIHByb3RvY29sIHZhbHVlIGZvciAnQzpcXFxcdGVtcCcgaXMgJ2M6Jywgc28gd2UgY2hlY2sgdGhlIGxlbmd0aCBhcyB3ZWxsXG4gICAgICBpZiAoXy5pc1N0cmluZyhwcm90b2NvbCkgJiYgcHJvdG9jb2wubGVuZ3RoID4gMikge1xuICAgICAgICBlcnJvck1lc3NhZ2UgPSBgVGhlIHByb3RvY29sICcke3Byb3RvY29sfScgdXNlZCBpbiAnJHtuZXdBcHB9JyBpcyBub3Qgc3VwcG9ydGVkLiBgICtcbiAgICAgICAgICBgT25seSBodHRwOiBhbmQgaHR0cHM6IHByb3RvY29scyBhcmUgc3VwcG9ydGVkYDtcbiAgICAgIH1cbiAgICAgIHRocm93IG5ldyBFcnJvcihlcnJvck1lc3NhZ2UpO1xuICAgIH1cblxuICAgIGlmIChzaG91bGRVbnppcEFwcCkge1xuICAgICAgY29uc3QgYXJjaGl2ZVBhdGggPSBuZXdBcHA7XG4gICAgICBhcmNoaXZlSGFzaCA9IGF3YWl0IGZzLmhhc2goYXJjaGl2ZVBhdGgpO1xuICAgICAgaWYgKEFQUExJQ0FUSU9OU19DQUNIRS5oYXMoYXBwKSAmJiBhcmNoaXZlSGFzaCA9PT0gQVBQTElDQVRJT05TX0NBQ0hFLmdldChhcHApLmhhc2gpIHtcbiAgICAgICAgY29uc3Qge2Z1bGxQYXRofSA9IEFQUExJQ0FUSU9OU19DQUNIRS5nZXQoYXBwKTtcbiAgICAgICAgaWYgKGF3YWl0IGZzLmV4aXN0cyhmdWxsUGF0aCkpIHtcbiAgICAgICAgICBpZiAoYXJjaGl2ZVBhdGggIT09IGFwcCAmJiBsb2NhbEFwcHNGb2xkZXIgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgYXdhaXQgZnMucmltcmFmKGFyY2hpdmVQYXRoKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgbG9nZ2VyLmluZm8oYFdpbGwgcmV1c2UgcHJldmlvdXNseSBjYWNoZWQgYXBwbGljYXRpb24gYXQgJyR7ZnVsbFBhdGh9J2ApO1xuICAgICAgICAgIHJldHVybiB2ZXJpZnlBcHBFeHRlbnNpb24oZnVsbFBhdGgsIHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMpO1xuICAgICAgICB9XG4gICAgICAgIGxvZ2dlci5pbmZvKGBUaGUgYXBwbGljYXRpb24gYXQgJyR7ZnVsbFBhdGh9JyBkb2VzIG5vdCBleGlzdCBhbnltb3JlLiBEZWxldGluZyBpdCBmcm9tIHRoZSBjYWNoZWApO1xuICAgICAgICBBUFBMSUNBVElPTlNfQ0FDSEUuZGVsKGFwcCk7XG4gICAgICB9XG4gICAgICBjb25zdCB0bXBSb290ID0gYXdhaXQgdGVtcERpci5vcGVuRGlyKCk7XG4gICAgICB0cnkge1xuICAgICAgICBuZXdBcHAgPSBhd2FpdCB1bnppcEFwcChhcmNoaXZlUGF0aCwgdG1wUm9vdCwgc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucyk7XG4gICAgICB9IGZpbmFsbHkge1xuICAgICAgICBpZiAobmV3QXBwICE9PSBhcmNoaXZlUGF0aCAmJiBhcmNoaXZlUGF0aCAhPT0gYXBwICYmIGxvY2FsQXBwc0ZvbGRlciA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgYXdhaXQgZnMucmltcmFmKGFyY2hpdmVQYXRoKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgbG9nZ2VyLmluZm8oYFVuemlwcGVkIGxvY2FsIGFwcCB0byAnJHtuZXdBcHB9J2ApO1xuICAgIH0gZWxzZSBpZiAoIXBhdGguaXNBYnNvbHV0ZShuZXdBcHApKSB7XG4gICAgICBuZXdBcHAgPSBwYXRoLnJlc29sdmUocHJvY2Vzcy5jd2QoKSwgbmV3QXBwKTtcbiAgICAgIGxvZ2dlci53YXJuKGBUaGUgY3VycmVudCBhcHBsaWNhdGlvbiBwYXRoICcke2FwcH0nIGlzIG5vdCBhYnNvbHV0ZSBgICtcbiAgICAgICAgYGFuZCBoYXMgYmVlbiByZXdyaXR0ZW4gdG8gJyR7bmV3QXBwfScuIENvbnNpZGVyIHVzaW5nIGFic29sdXRlIHBhdGhzIHJhdGhlciB0aGFuIHJlbGF0aXZlYCk7XG4gICAgICBhcHAgPSBuZXdBcHA7XG4gICAgfVxuXG4gICAgdmVyaWZ5QXBwRXh0ZW5zaW9uKG5ld0FwcCwgc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucyk7XG5cbiAgICBpZiAoYXBwICE9PSBuZXdBcHAgJiYgKGFyY2hpdmVIYXNoIHx8IF8udmFsdWVzKHJlbW90ZUFwcFByb3BzKS5zb21lKEJvb2xlYW4pKSkge1xuICAgICAgaWYgKEFQUExJQ0FUSU9OU19DQUNIRS5oYXMoYXBwKSkge1xuICAgICAgICBjb25zdCB7ZnVsbFBhdGh9ID0gQVBQTElDQVRJT05TX0NBQ0hFLmdldChhcHApO1xuICAgICAgICAvLyBDbGVhbiB1cCB0aGUgb2Jzb2xldGUgZW50cnkgZmlyc3QgaWYgbmVlZGVkXG4gICAgICAgIGlmIChmdWxsUGF0aCAhPT0gbmV3QXBwICYmIGF3YWl0IGZzLmV4aXN0cyhmdWxsUGF0aCkpIHtcbiAgICAgICAgICBhd2FpdCBmcy5yaW1yYWYoZnVsbFBhdGgpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBBUFBMSUNBVElPTlNfQ0FDSEUuc2V0KGFwcCwge1xuICAgICAgICAuLi5yZW1vdGVBcHBQcm9wcyxcbiAgICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgICBoYXNoOiBhcmNoaXZlSGFzaCxcbiAgICAgICAgZnVsbFBhdGg6IG5ld0FwcCxcbiAgICAgIH0pO1xuICAgIH1cbiAgICByZXR1cm4gbmV3QXBwO1xuICB9KTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZG93bmxvYWRBcHAgKGFwcCwgdGFyZ2V0UGF0aCkge1xuICBjb25zdCB7aHJlZn0gPSB1cmwucGFyc2UoYXBwKTtcbiAgdHJ5IHtcbiAgICBhd2FpdCBuZXQuZG93bmxvYWRGaWxlKGhyZWYsIHRhcmdldFBhdGgsIHtcbiAgICAgIHRpbWVvdXQ6IEFQUF9ET1dOTE9BRF9USU1FT1VUX01TLFxuICAgIH0pO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFVuYWJsZSB0byBkb3dubG9hZCB0aGUgYXBwOiAke2Vyci5tZXNzYWdlfWApO1xuICB9XG4gIHJldHVybiB0YXJnZXRQYXRoO1xufVxuXG4vKipcbiAqIEV4dHJhY3RzIHRoZSBidW5kbGUgZnJvbSBhbiBhcmNoaXZlIGludG8gdGhlIGdpdmVuIGZvbGRlclxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSB6aXBQYXRoIEZ1bGwgcGF0aCB0byB0aGUgYXJjaGl2ZSBjb250YWluaW5nIHRoZSBidW5kbGVcbiAqIEBwYXJhbSB7c3RyaW5nfSBkc3RSb290IEZ1bGwgcGF0aCB0byB0aGUgZm9sZGVyIHdoZXJlIHRoZSBleHRyYWN0ZWQgYnVuZGxlXG4gKiBzaG91bGQgYmUgcGxhY2VkXG4gKiBAcGFyYW0ge0FycmF5PHN0cmluZz58c3RyaW5nfSBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zIFRoZSBsaXN0IG9mIGV4dGVuc2lvbnNcbiAqIHRoZSB0YXJnZXQgYXBwbGljYXRpb24gYnVuZGxlIHN1cHBvcnRzLCBmb3IgZXhhbXBsZSBbJy5hcGsnLCAnLmFwa3MnXSBmb3JcbiAqIEFuZHJvaWQgcGFja2FnZXNcbiAqIEByZXR1cm5zIHtzdHJpbmd9IEZ1bGwgcGF0aCB0byB0aGUgYnVuZGxlIGluIHRoZSBkZXN0aW5hdGlvbiBmb2xkZXJcbiAqIEB0aHJvd3Mge0Vycm9yfSBJZiB0aGUgZ2l2ZW4gYXJjaGl2ZSBpcyBpbnZhbGlkIG9yIG5vIGFwcGxpY2F0aW9uIGJ1bmRsZXNcbiAqIGhhdmUgYmVlbiBmb3VuZCBpbnNpZGVcbiAqL1xuYXN5bmMgZnVuY3Rpb24gdW56aXBBcHAgKHppcFBhdGgsIGRzdFJvb3QsIHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMpIHtcbiAgYXdhaXQgemlwLmFzc2VydFZhbGlkWmlwKHppcFBhdGgpO1xuXG4gIGlmICghXy5pc0FycmF5KHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMpKSB7XG4gICAgc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucyA9IFtzdXBwb3J0ZWRBcHBFeHRlbnNpb25zXTtcbiAgfVxuXG4gIGNvbnN0IHRtcFJvb3QgPSBhd2FpdCB0ZW1wRGlyLm9wZW5EaXIoKTtcbiAgdHJ5IHtcbiAgICBsb2dnZXIuZGVidWcoYFVuemlwcGluZyAnJHt6aXBQYXRofSdgKTtcbiAgICBjb25zdCB0aW1lciA9IG5ldyB0aW1pbmcuVGltZXIoKS5zdGFydCgpO1xuICAgIC8qKlxuICAgICAqIEF0dGVtcHQgdG8gdXNlIHVzZSB0aGUgc3lzdGVtIGB1bnppcGAgKGUuZy4sIGAvdXNyL2Jpbi91bnppcGApIGR1ZVxuICAgICAqIHRvIHRoZSBzaWduaWZpY2FudCBwZXJmb3JtYW5jZSBpbXByb3ZlbWVudCBpdCBwcm92aWRlcyBvdmVyIHRoZSBuYXRpdmVcbiAgICAgKiBKUyBcInVuemlwXCIgaW1wbGVtZW50YXRpb24uXG4gICAgICogQHR5cGUge2ltcG9ydCgnYXBwaXVtLXN1cHBvcnQvbGliL3ppcCcpLkV4dHJhY3RBbGxPcHRpb25zfVxuICAgICAqL1xuICAgIGNvbnN0IGV4dHJhY3Rpb25PcHRzID0ge1xuICAgICAgdXNlU3lzdGVtVW56aXA6IHRydWUsXG4gICAgfTtcbiAgICAvLyBodHRwczovL2dpdGh1Yi5jb20vYXBwaXVtL2FwcGl1bS9pc3N1ZXMvMTQxMDBcbiAgICBpZiAocGF0aC5leHRuYW1lKHppcFBhdGgpID09PSBJUEFfRVhUKSB7XG4gICAgICBsb2dnZXIuZGVidWcoYEVuZm9yY2luZyBVVEYtOCBlbmNvZGluZyBvbiB0aGUgZXh0cmFjdGVkIGZpbGUgbmFtZXMgZm9yICcke3BhdGguYmFzZW5hbWUoemlwUGF0aCl9J2ApO1xuICAgICAgZXh0cmFjdGlvbk9wdHMuZmlsZU5hbWVzRW5jb2RpbmcgPSAndXRmOCc7XG4gICAgfVxuICAgIGF3YWl0IHppcC5leHRyYWN0QWxsVG8oemlwUGF0aCwgdG1wUm9vdCwgZXh0cmFjdGlvbk9wdHMpO1xuICAgIGNvbnN0IGdsb2JQYXR0ZXJuID0gYCoqLyouKygke3N1cHBvcnRlZEFwcEV4dGVuc2lvbnMubWFwKChleHQpID0+IGV4dC5yZXBsYWNlKC9eXFwuLywgJycpKS5qb2luKCd8Jyl9KWA7XG4gICAgY29uc3Qgc29ydGVkQnVuZGxlSXRlbXMgPSAoYXdhaXQgZnMuZ2xvYihnbG9iUGF0dGVybiwge1xuICAgICAgY3dkOiB0bXBSb290LFxuICAgICAgc3RyaWN0OiBmYWxzZSxcbiAgICAvLyBHZXQgdGhlIHRvcCBsZXZlbCBtYXRjaFxuICAgIH0pKS5zb3J0KChhLCBiKSA9PiBhLnNwbGl0KHBhdGguc2VwKS5sZW5ndGggLSBiLnNwbGl0KHBhdGguc2VwKS5sZW5ndGgpO1xuICAgIGlmIChfLmlzRW1wdHkoc29ydGVkQnVuZGxlSXRlbXMpKSB7XG4gICAgICBsb2dnZXIuZXJyb3JBbmRUaHJvdyhgQXBwIHVuemlwcGVkIE9LLCBidXQgd2UgY291bGQgbm90IGZpbmQgYW55ICcke3N1cHBvcnRlZEFwcEV4dGVuc2lvbnN9JyBgICtcbiAgICAgICAgdXRpbC5wbHVyYWxpemUoJ2J1bmRsZScsIHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMubGVuZ3RoLCBmYWxzZSkgK1xuICAgICAgICBgIGluIGl0LiBNYWtlIHN1cmUgeW91ciBhcmNoaXZlIGNvbnRhaW5zIGF0IGxlYXN0IG9uZSBwYWNrYWdlIGhhdmluZyBgICtcbiAgICAgICAgYCcke3N1cHBvcnRlZEFwcEV4dGVuc2lvbnN9JyAke3V0aWwucGx1cmFsaXplKCdleHRlbnNpb24nLCBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zLmxlbmd0aCwgZmFsc2UpfWApO1xuICAgIH1cbiAgICBsb2dnZXIuZGVidWcoYEV4dHJhY3RlZCAke3V0aWwucGx1cmFsaXplKCdidW5kbGUgaXRlbScsIHNvcnRlZEJ1bmRsZUl0ZW1zLmxlbmd0aCwgdHJ1ZSl9IGAgK1xuICAgICAgYGZyb20gJyR7emlwUGF0aH0nIGluICR7TWF0aC5yb3VuZCh0aW1lci5nZXREdXJhdGlvbigpLmFzTWlsbGlTZWNvbmRzKX1tczogJHtzb3J0ZWRCdW5kbGVJdGVtc31gKTtcbiAgICBjb25zdCBtYXRjaGVkQnVuZGxlID0gXy5maXJzdChzb3J0ZWRCdW5kbGVJdGVtcyk7XG4gICAgbG9nZ2VyLmluZm8oYEFzc3VtaW5nICcke21hdGNoZWRCdW5kbGV9JyBpcyB0aGUgY29ycmVjdCBidW5kbGVgKTtcbiAgICBjb25zdCBkc3RQYXRoID0gcGF0aC5yZXNvbHZlKGRzdFJvb3QsIHBhdGguYmFzZW5hbWUobWF0Y2hlZEJ1bmRsZSkpO1xuICAgIGF3YWl0IGZzLm12KHBhdGgucmVzb2x2ZSh0bXBSb290LCBtYXRjaGVkQnVuZGxlKSwgZHN0UGF0aCwge21rZGlycDogdHJ1ZX0pO1xuICAgIHJldHVybiBkc3RQYXRoO1xuICB9IGZpbmFsbHkge1xuICAgIGF3YWl0IGZzLnJpbXJhZih0bXBSb290KTtcbiAgfVxufVxuXG5mdW5jdGlvbiBpc1BhY2thZ2VPckJ1bmRsZSAoYXBwKSB7XG4gIHJldHVybiAoL14oW2EtekEtWjAtOVxcLV9dK1xcLlthLXpBLVowLTlcXC1fXSspKyQvKS50ZXN0KGFwcCk7XG59XG5cbi8qKlxuICogRmluZHMgYWxsIGluc3RhbmNlcyAnZmlyc3RLZXknIGFuZCBjcmVhdGUgYSBkdXBsaWNhdGUgd2l0aCB0aGUga2V5ICdzZWNvbmRLZXknLFxuICogRG8gdGhlIHNhbWUgdGhpbmcgaW4gcmV2ZXJzZS4gSWYgd2UgZmluZCAnc2Vjb25kS2V5JywgY3JlYXRlIGEgZHVwbGljYXRlIHdpdGggdGhlIGtleSAnZmlyc3RLZXknLlxuICpcbiAqIFRoaXMgd2lsbCBjYXVzZSBrZXlzIHRvIGJlIG92ZXJ3cml0dGVuIGlmIHRoZSBvYmplY3QgY29udGFpbnMgJ2ZpcnN0S2V5JyBhbmQgJ3NlY29uZEtleScuXG5cbiAqIEBwYXJhbSB7Kn0gaW5wdXQgQW55IHR5cGUgb2YgaW5wdXRcbiAqIEBwYXJhbSB7U3RyaW5nfSBmaXJzdEtleSBUaGUgZmlyc3Qga2V5IHRvIGR1cGxpY2F0ZVxuICogQHBhcmFtIHtTdHJpbmd9IHNlY29uZEtleSBUaGUgc2Vjb25kIGtleSB0byBkdXBsaWNhdGVcbiAqL1xuZnVuY3Rpb24gZHVwbGljYXRlS2V5cyAoaW5wdXQsIGZpcnN0S2V5LCBzZWNvbmRLZXkpIHtcbiAgLy8gSWYgYXJyYXkgcHJvdmlkZWQsIHJlY3Vyc2l2ZWx5IGNhbGwgb24gYWxsIGVsZW1lbnRzXG4gIGlmIChfLmlzQXJyYXkoaW5wdXQpKSB7XG4gICAgcmV0dXJuIGlucHV0Lm1hcCgoaXRlbSkgPT4gZHVwbGljYXRlS2V5cyhpdGVtLCBmaXJzdEtleSwgc2Vjb25kS2V5KSk7XG4gIH1cblxuICAvLyBJZiBvYmplY3QsIGNyZWF0ZSBkdXBsaWNhdGVzIGZvciBrZXlzIGFuZCB0aGVuIHJlY3Vyc2l2ZWx5IGNhbGwgb24gdmFsdWVzXG4gIGlmIChfLmlzUGxhaW5PYmplY3QoaW5wdXQpKSB7XG4gICAgY29uc3QgcmVzdWx0T2JqID0ge307XG4gICAgZm9yIChsZXQgW2tleSwgdmFsdWVdIG9mIF8udG9QYWlycyhpbnB1dCkpIHtcbiAgICAgIGNvbnN0IHJlY3Vyc2l2ZWx5Q2FsbGVkVmFsdWUgPSBkdXBsaWNhdGVLZXlzKHZhbHVlLCBmaXJzdEtleSwgc2Vjb25kS2V5KTtcbiAgICAgIGlmIChrZXkgPT09IGZpcnN0S2V5KSB7XG4gICAgICAgIHJlc3VsdE9ialtzZWNvbmRLZXldID0gcmVjdXJzaXZlbHlDYWxsZWRWYWx1ZTtcbiAgICAgIH0gZWxzZSBpZiAoa2V5ID09PSBzZWNvbmRLZXkpIHtcbiAgICAgICAgcmVzdWx0T2JqW2ZpcnN0S2V5XSA9IHJlY3Vyc2l2ZWx5Q2FsbGVkVmFsdWU7XG4gICAgICB9XG4gICAgICByZXN1bHRPYmpba2V5XSA9IHJlY3Vyc2l2ZWx5Q2FsbGVkVmFsdWU7XG4gICAgfVxuICAgIHJldHVybiByZXN1bHRPYmo7XG4gIH1cblxuICAvLyBCYXNlIGNhc2UuIFJldHVybiBwcmltaXRpdmVzIHdpdGhvdXQgZG9pbmcgYW55dGhpbmcuXG4gIHJldHVybiBpbnB1dDtcbn1cblxuLyoqXG4gKiBUYWtlcyBhIGRlc2lyZWQgY2FwYWJpbGl0eSBhbmQgdHJpZXMgdG8gSlNPTi5wYXJzZSBpdCBhcyBhbiBhcnJheSxcbiAqIGFuZCBlaXRoZXIgcmV0dXJucyB0aGUgcGFyc2VkIGFycmF5IG9yIGEgc2luZ2xldG9uIGFycmF5LlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfEFycmF5PFN0cmluZz59IGNhcCBBIGRlc2lyZWQgY2FwYWJpbGl0eVxuICovXG5mdW5jdGlvbiBwYXJzZUNhcHNBcnJheSAoY2FwKSB7XG4gIGlmIChfLmlzQXJyYXkoY2FwKSkge1xuICAgIHJldHVybiBjYXA7XG4gIH1cblxuICBsZXQgcGFyc2VkQ2FwcztcbiAgdHJ5IHtcbiAgICBwYXJzZWRDYXBzID0gSlNPTi5wYXJzZShjYXApO1xuICAgIGlmIChfLmlzQXJyYXkocGFyc2VkQ2FwcykpIHtcbiAgICAgIHJldHVybiBwYXJzZWRDYXBzO1xuICAgIH1cbiAgfSBjYXRjaCAoaWduKSB7XG4gICAgbG9nZ2VyLndhcm4oYEZhaWxlZCB0byBwYXJzZSBjYXBhYmlsaXR5IGFzIEpTT04gYXJyYXlgKTtcbiAgfVxuICBpZiAoXy5pc1N0cmluZyhjYXApKSB7XG4gICAgcmV0dXJuIFtjYXBdO1xuICB9XG4gIHRocm93IG5ldyBFcnJvcihgbXVzdCBwcm92aWRlIGEgc3RyaW5nIG9yIEpTT04gQXJyYXk7IHJlY2VpdmVkICR7Y2FwfWApO1xufVxuXG5leHBvcnQge1xuICBjb25maWd1cmVBcHAsIGlzUGFja2FnZU9yQnVuZGxlLCBkdXBsaWNhdGVLZXlzLCBwYXJzZUNhcHNBcnJheVxufTtcbiJdLCJmaWxlIjoibGliL2Jhc2Vkcml2ZXIvaGVscGVycy5qcyIsInNvdXJjZVJvb3QiOiIuLi8uLi8uLiJ9
