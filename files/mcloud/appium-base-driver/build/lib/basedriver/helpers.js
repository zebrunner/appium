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

            if (await _appiumSupport.fs.exists(localFile)) {
              await _appiumSupport.fs.unlink(localFile);
            } else {
              _logger.default.warn(`[MCLOUD] Old local application file ${localFile} was not found. Probably it was removed by another thread which was downloading app in parallel`);
            }

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
        _logger.default.info(`[MCLOUD] Local apps folder is not defined via environment properties, hence skipping this logic. Use variable APPIUM_APPS_DIR for path setting`);
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

            if (await _appiumSupport.fs.exists(lockFile)) {
              await _appiumSupport.fs.unlink(lockFile);
            } else {
              _logger.default.warn(`[MCLOUD] Lock file ${lockFile} was not found. Probably it was removed by another thread which was downloading app in parallel`);
            }
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


//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImxpYi9iYXNlZHJpdmVyL2hlbHBlcnMuanMiXSwibmFtZXMiOlsiSVBBX0VYVCIsIlpJUF9FWFRTIiwiWklQX01JTUVfVFlQRVMiLCJDQUNIRURfQVBQU19NQVhfQUdFIiwiQVBQTElDQVRJT05TX0NBQ0hFIiwiTFJVIiwibWF4QWdlIiwidXBkYXRlQWdlT25HZXQiLCJkaXNwb3NlIiwiYXBwIiwiZnVsbFBhdGgiLCJmcyIsImV4aXN0cyIsImxvZ2dlciIsImluZm8iLCJyaW1yYWYiLCJub0Rpc3Bvc2VPblNldCIsIkFQUExJQ0FUSU9OU19DQUNIRV9HVUFSRCIsIkFzeW5jTG9jayIsIlNBTklUSVpFX1JFUExBQ0VNRU5UIiwiREVGQVVMVF9CQVNFTkFNRSIsIkFQUF9ET1dOTE9BRF9USU1FT1VUX01TIiwicHJvY2VzcyIsIm9uIiwiaXRlbUNvdW50IiwiYXBwUGF0aHMiLCJ2YWx1ZXMiLCJtYXAiLCJkZWJ1ZyIsImxlbmd0aCIsInV0aWwiLCJwbHVyYWxpemUiLCJhcHBQYXRoIiwicmltcmFmU3luYyIsImUiLCJ3YXJuIiwibWVzc2FnZSIsInJldHJpZXZlSGVhZGVycyIsImxpbmsiLCJ1cmwiLCJtZXRob2QiLCJ0aW1lb3V0IiwiaGVhZGVycyIsImdldENhY2hlZEFwcGxpY2F0aW9uUGF0aCIsImN1cnJlbnRBcHBQcm9wcyIsInJlZnJlc2giLCJoYXMiLCJsYXN0TW9kaWZpZWQiLCJjdXJyZW50TW9kaWZpZWQiLCJpbW11dGFibGUiLCJjdXJyZW50SW1tdXRhYmxlIiwiY3VycmVudE1heEFnZSIsInRpbWVzdGFtcCIsImdldCIsImdldFRpbWUiLCJtc0xlZnQiLCJEYXRlIiwibm93IiwicGF0aCIsImJhc2VuYW1lIiwidmVyaWZ5QXBwRXh0ZW5zaW9uIiwic3VwcG9ydGVkQXBwRXh0ZW5zaW9ucyIsImluY2x1ZGVzIiwiZXh0bmFtZSIsIkVycm9yIiwiY29uZmlndXJlQXBwIiwiXyIsImlzU3RyaW5nIiwiaXNBcnJheSIsIm5ld0FwcCIsInNob3VsZFVuemlwQXBwIiwiYXJjaGl2ZUhhc2giLCJsb2NhbEFwcHNGb2xkZXIiLCJyZW1vdGVBcHBQcm9wcyIsInByb3RvY29sIiwicGF0aG5hbWUiLCJwYXJzZSIsImlzVXJsIiwiYWNxdWlyZSIsImlzRW1wdHkiLCJ0ZXN0IiwibWF4QWdlTWF0Y2giLCJleGVjIiwicGFyc2VJbnQiLCJkb3dubG9hZElzTmVhZGVkIiwibG9jYWxGaWxlIiwibG9ja0ZpbGUiLCJ3YWl0aW5nVGltZSIsIm1heEF0dGVtcHRzQ291bnQiLCJlbnYiLCJBUFBJVU1fQVBQX1dBSVRJTkdfVElNRU9VVCIsInVuZGVmaW5lZCIsInJlbW90ZUZpbGVMZW5ndGgiLCJhdHRlbXB0c0NvdW50IiwiUHJvbWlzZSIsInJlc29sdmUiLCJzZXRUaW1lb3V0Iiwic3RhdHMiLCJzdGF0IiwibG9jYWxGaWxlTGVuZ3RoIiwic2l6ZSIsInVubGluayIsInNoYXJlZEZvbGRlclBhdGgiLCJjbG9zZSIsIm9wZW4iLCJjYWNoZWRQYXRoIiwiZGVsIiwiZmlsZU5hbWUiLCJzYW5pdGl6ZU5hbWUiLCJkZWNvZGVVUklDb21wb25lbnQiLCJyZXBsYWNlbWVudCIsImN0Iiwic29tZSIsIm1pbWVUeXBlIiwiUmVnRXhwIiwiZXNjYXBlUmVnRXhwIiwibWF0Y2giLCJyZXN1bHRpbmdOYW1lIiwic3Vic3RyaW5nIiwicmVzdWx0aW5nRXh0IiwiZmlyc3QiLCJ0YXJnZXRQYXRoIiwidGVtcERpciIsInByZWZpeCIsInN1ZmZpeCIsImRvd25sb2FkQXBwIiwiY29weUZpbGUiLCJlcnJvck1lc3NhZ2UiLCJhcmNoaXZlUGF0aCIsImhhc2giLCJ0bXBSb290Iiwib3BlbkRpciIsInVuemlwQXBwIiwiaXNBYnNvbHV0ZSIsImN3ZCIsIkJvb2xlYW4iLCJzZXQiLCJocmVmIiwibmV0IiwiZG93bmxvYWRGaWxlIiwiZXJyIiwiemlwUGF0aCIsImRzdFJvb3QiLCJ6aXAiLCJhc3NlcnRWYWxpZFppcCIsInRpbWVyIiwidGltaW5nIiwiVGltZXIiLCJzdGFydCIsImV4dHJhY3Rpb25PcHRzIiwidXNlU3lzdGVtVW56aXAiLCJmaWxlTmFtZXNFbmNvZGluZyIsImV4dHJhY3RBbGxUbyIsImdsb2JQYXR0ZXJuIiwiZXh0IiwicmVwbGFjZSIsImpvaW4iLCJzb3J0ZWRCdW5kbGVJdGVtcyIsImdsb2IiLCJzdHJpY3QiLCJzb3J0IiwiYSIsImIiLCJzcGxpdCIsInNlcCIsImVycm9yQW5kVGhyb3ciLCJNYXRoIiwicm91bmQiLCJnZXREdXJhdGlvbiIsImFzTWlsbGlTZWNvbmRzIiwibWF0Y2hlZEJ1bmRsZSIsImRzdFBhdGgiLCJtdiIsIm1rZGlycCIsImlzUGFja2FnZU9yQnVuZGxlIiwiZHVwbGljYXRlS2V5cyIsImlucHV0IiwiZmlyc3RLZXkiLCJzZWNvbmRLZXkiLCJpdGVtIiwiaXNQbGFpbk9iamVjdCIsInJlc3VsdE9iaiIsImtleSIsInZhbHVlIiwidG9QYWlycyIsInJlY3Vyc2l2ZWx5Q2FsbGVkVmFsdWUiLCJwYXJzZUNhcHNBcnJheSIsImNhcCIsInBhcnNlZENhcHMiLCJKU09OIiwiaWduIl0sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7OztBQUFBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUVBLE1BQU1BLE9BQU8sR0FBRyxNQUFoQjtBQUNBLE1BQU1DLFFBQVEsR0FBRyxDQUFDLE1BQUQsRUFBU0QsT0FBVCxDQUFqQjtBQUNBLE1BQU1FLGNBQWMsR0FBRyxDQUNyQixpQkFEcUIsRUFFckIsOEJBRnFCLEVBR3JCLGlCQUhxQixDQUF2QjtBQUtBLE1BQU1DLG1CQUFtQixHQUFHLE9BQU8sRUFBUCxHQUFZLEVBQVosR0FBaUIsRUFBN0M7QUFDQSxNQUFNQyxrQkFBa0IsR0FBRyxJQUFJQyxpQkFBSixDQUFRO0FBQ2pDQyxFQUFBQSxNQUFNLEVBQUVILG1CQUR5QjtBQUVqQ0ksRUFBQUEsY0FBYyxFQUFFLElBRmlCO0FBR2pDQyxFQUFBQSxPQUFPLEVBQUUsT0FBT0MsR0FBUCxFQUFZO0FBQUNDLElBQUFBO0FBQUQsR0FB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b250ZW50IjpbImltcG9ydCBfIGZyb20gJ2xvZGFzaCc7XG5pbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCB1cmwgZnJvbSAndXJsJztcbmltcG9ydCBsb2dnZXIgZnJvbSAnLi9sb2dnZXInO1xuaW1wb3J0IHsgdGVtcERpciwgZnMsIHV0aWwsIHppcCwgbmV0LCB0aW1pbmcgfSBmcm9tICdhcHBpdW0tc3VwcG9ydCc7XG5pbXBvcnQgTFJVIGZyb20gJ2xydS1jYWNoZSc7XG5pbXBvcnQgQXN5bmNMb2NrIGZyb20gJ2FzeW5jLWxvY2snO1xuaW1wb3J0IGF4aW9zIGZyb20gJ2F4aW9zJztcbmltcG9ydCB7IGdldExvY2FsQXBwc0ZvbGRlciwgZ2V0U2hhcmVkRm9sZGVyRm9yQXBwVXJsLCBnZXRMb2NhbEZpbGVGb3JBcHBVcmwsIGdldEZpbGVDb250ZW50TGVuZ3RoIH0gZnJvbSAnLi9tY2xvdWQtdXRpbHMnO1xuXG5jb25zdCBJUEFfRVhUID0gJy5pcGEnO1xuY29uc3QgWklQX0VYVFMgPSBbJy56aXAnLCBJUEFfRVhUXTtcbmNvbnN0IFpJUF9NSU1FX1RZUEVTID0gW1xuICAnYXBwbGljYXRpb24vemlwJyxcbiAgJ2FwcGxpY2F0aW9uL3gtemlwLWNvbXByZXNzZWQnLFxuICAnbXVsdGlwYXJ0L3gtemlwJyxcbl07XG5jb25zdCBDQUNIRURfQVBQU19NQVhfQUdFID0gMTAwMCAqIDYwICogNjAgKiAyNDsgLy8gbXNcbmNvbnN0IEFQUExJQ0FUSU9OU19DQUNIRSA9IG5ldyBMUlUoe1xuICBtYXhBZ2U6IENBQ0hFRF9BUFBTX01BWF9BR0UsIC8vIGV4cGlyZSBhZnRlciAyNCBob3Vyc1xuICB1cGRhdGVBZ2VPbkdldDogdHJ1ZSxcbiAgZGlzcG9zZTogYXN5bmMgKGFwcCwge2Z1bGxQYXRofSkgPT4ge1xuICAgIGlmICghYXdhaXQgZnMuZXhpc3RzKGZ1bGxQYXRoKSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGxvZ2dlci5pbmZvKGBUaGUgYXBwbGljYXRpb24gJyR7YXBwfScgY2FjaGVkIGF0ICcke2Z1bGxQYXRofScgaGFzIGV4cGlyZWRgKTtcbiAgICBhd2FpdCBmcy5yaW1yYWYoZnVsbFBhdGgpO1xuICB9LFxuICBub0Rpc3Bvc2VPblNldDogdHJ1ZSxcbn0pO1xuY29uc3QgQVBQTElDQVRJT05TX0NBQ0hFX0dVQVJEID0gbmV3IEFzeW5jTG9jaygpO1xuY29uc3QgU0FOSVRJWkVfUkVQTEFDRU1FTlQgPSAnLSc7XG5jb25zdCBERUZBVUxUX0JBU0VOQU1FID0gJ2FwcGl1bS1hcHAnO1xuY29uc3QgQVBQX0RPV05MT0FEX1RJTUVPVVRfTVMgPSAxMjAgKiAxMDAwO1xuXG5wcm9jZXNzLm9uKCdleGl0JywgKCkgPT4ge1xuICBpZiAoQVBQTElDQVRJT05TX0NBQ0hFLml0ZW1Db3VudCA9PT0gMCkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGNvbnN0IGFwcFBhdGhzID0gQVBQTElDQVRJT05TX0NBQ0hFLnZhbHVlcygpXG4gICAgLm1hcCgoe2Z1bGxQYXRofSkgPT4gZnVsbFBhdGgpO1xuICBsb2dnZXIuZGVidWcoYFBlcmZvcm1pbmcgY2xlYW51cCBvZiAke2FwcFBhdGhzLmxlbmd0aH0gY2FjaGVkIGAgK1xuICAgIHV0aWwucGx1cmFsaXplKCdhcHBsaWNhdGlvbicsIGFwcFBhdGhzLmxlbmd0aCkpO1xuICBmb3IgKGNvbnN0IGFwcFBhdGggb2YgYXBwUGF0aHMpIHtcbiAgICB0cnkge1xuICAgICAgLy8gQXN5bmNocm9ub3VzIGNhbGxzIGFyZSBub3Qgc3VwcG9ydGVkIGluIG9uRXhpdCBoYW5kbGVyXG4gICAgICBmcy5yaW1yYWZTeW5jKGFwcFBhdGgpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGxvZ2dlci53YXJuKGUubWVzc2FnZSk7XG4gICAgfVxuICB9XG59KTtcblxuXG5hc3luYyBmdW5jdGlvbiByZXRyaWV2ZUhlYWRlcnMgKGxpbmspIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gKGF3YWl0IGF4aW9zKHtcbiAgICAgIHVybDogbGluayxcbiAgICAgIG1ldGhvZDogJ0hFQUQnLFxuICAgICAgdGltZW91dDogNTAwMCxcbiAgICB9KSkuaGVhZGVycztcbiAgfSBjYXRjaCAoZSkge1xuICAgIGxvZ2dlci5pbmZvKGBDYW5ub3Qgc2VuZCBIRUFEIHJlcXVlc3QgdG8gJyR7bGlua30nLiBPcmlnaW5hbCBlcnJvcjogJHtlLm1lc3NhZ2V9YCk7XG4gIH1cbiAgcmV0dXJuIHt9O1xufVxuXG5mdW5jdGlvbiBnZXRDYWNoZWRBcHBsaWNhdGlvblBhdGggKGxpbmssIGN1cnJlbnRBcHBQcm9wcyA9IHt9KSB7XG4gIGNvbnN0IHJlZnJlc2ggPSAoKSA9PiB7XG4gICAgbG9nZ2VyLmRlYnVnKGBbTUNMT1VEXSBBIGZyZXNoIGNvcHkgb2YgdGhlIGFwcGxpY2F0aW9uIGlzIGdvaW5nIHRvIGJlIGRvd25sb2FkZWQgZnJvbSAke2xpbmt9YCk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH07XG5cbiAgaWYgKEFQUExJQ0FUSU9OU19DQUNIRS5oYXMobGluaykpIHtcbiAgICBjb25zdCB7XG4gICAgICBsYXN0TW9kaWZpZWQ6IGN1cnJlbnRNb2RpZmllZCxcbiAgICAgIGltbXV0YWJsZTogY3VycmVudEltbXV0YWJsZSxcbiAgICAgIC8vIG1heEFnZSBpcyBpbiBzZWNvbmRzXG4gICAgICBtYXhBZ2U6IGN1cnJlbnRNYXhBZ2UsXG4gICAgfSA9IGN1cnJlbnRBcHBQcm9wcztcbiAgICBjb25zdCB7XG4gICAgICAvLyBEYXRlIGluc3RhbmNlXG4gICAgICBsYXN0TW9kaWZpZWQsXG4gICAgICAvLyBib29sZWFuXG4gICAgICBpbW11dGFibGUsXG4gICAgICAvLyBVbml4IHRpbWUgaW4gbWlsbGlzZWNvbmRzXG4gICAgICB0aW1lc3RhbXAsXG4gICAgICBmdWxsUGF0aCxcbiAgICB9ID0gQVBQTElDQVRJT05TX0NBQ0hFLmdldChsaW5rKTtcbiAgICBpZiAobGFzdE1vZGlmaWVkICYmIGN1cnJlbnRNb2RpZmllZCkge1xuICAgICAgaWYgKGN1cnJlbnRNb2RpZmllZC5nZXRUaW1lKCkgPD0gbGFzdE1vZGlmaWVkLmdldFRpbWUoKSkge1xuICAgICAgICBsb2dnZXIuZGVidWcoYFRoZSBhcHBsaWNhdGlvbiBhdCAke2xpbmt9IGhhcyBub3QgYmVlbiBtb2RpZmllZCBzaW5jZSAke2xhc3RNb2RpZmllZH1gKTtcbiAgICAgICAgcmV0dXJuIGZ1bGxQYXRoO1xuICAgICAgfVxuICAgICAgbG9nZ2VyLmRlYnVnKGBUaGUgYXBwbGljYXRpb24gYXQgJHtsaW5rfSBoYXMgYmVlbiBtb2RpZmllZCBzaW5jZSAke2xhc3RNb2RpZmllZH1gKTtcbiAgICAgIHJldHVybiByZWZyZXNoKCk7XG4gICAgfVxuICAgIGlmIChpbW11dGFibGUgJiYgY3VycmVudEltbXV0YWJsZSkge1xuICAgICAgbG9nZ2VyLmRlYnVnKGBUaGUgYXBwbGljYXRpb24gYXQgJHtsaW5rfSBpcyBpbW11dGFibGVgKTtcbiAgICAgIHJldHVybiBmdWxsUGF0aDtcbiAgICB9XG4gICAgaWYgKGN1cnJlbnRNYXhBZ2UgJiYgdGltZXN0YW1wKSB7XG4gICAgICBjb25zdCBtc0xlZnQgPSB0aW1lc3RhbXAgKyBjdXJyZW50TWF4QWdlICogMTAwMCAtIERhdGUubm93KCk7XG4gICAgICBpZiAobXNMZWZ0ID4gMCkge1xuICAgICAgICBsb2dnZXIuZGVidWcoYFRoZSBjYWNoZWQgYXBwbGljYXRpb24gJyR7cGF0aC5iYXNlbmFtZShmdWxsUGF0aCl9JyB3aWxsIGV4cGlyZSBpbiAke21zTGVmdCAvIDEwMDB9c2ApO1xuICAgICAgICByZXR1cm4gZnVsbFBhdGg7XG4gICAgICB9XG4gICAgICBsb2dnZXIuZGVidWcoYFRoZSBjYWNoZWQgYXBwbGljYXRpb24gJyR7cGF0aC5iYXNlbmFtZShmdWxsUGF0aCl9JyBoYXMgZXhwaXJlZGApO1xuICAgIH1cbiAgfVxuICByZXR1cm4gcmVmcmVzaCgpO1xufVxuXG5mdW5jdGlvbiB2ZXJpZnlBcHBFeHRlbnNpb24gKGFwcCwgc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucykge1xuICBpZiAoc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucy5pbmNsdWRlcyhwYXRoLmV4dG5hbWUoYXBwKSkpIHtcbiAgICByZXR1cm4gYXBwO1xuICB9XG4gIHRocm93IG5ldyBFcnJvcihgTmV3IGFwcCBwYXRoICcke2FwcH0nIGRpZCBub3QgaGF2ZSBgICtcbiAgICBgJHt1dGlsLnBsdXJhbGl6ZSgnZXh0ZW5zaW9uJywgc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucy5sZW5ndGgsIGZhbHNlKX06IGAgK1xuICAgIHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBjb25maWd1cmVBcHAgKGFwcCwgc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucykge1xuICBpZiAoIV8uaXNTdHJpbmcoYXBwKSkge1xuICAgIC8vIGltbWVkaWF0ZWx5IHNob3J0Y2lyY3VpdCBpZiBub3QgZ2l2ZW4gYW4gYXBwXG4gICAgcmV0dXJuO1xuICB9XG4gIGlmICghXy5pc0FycmF5KHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMpKSB7XG4gICAgc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucyA9IFtzdXBwb3J0ZWRBcHBFeHRlbnNpb25zXTtcbiAgfVxuXG4gIGxldCBuZXdBcHAgPSBhcHA7XG4gIGxldCBzaG91bGRVbnppcEFwcCA9IGZhbHNlO1xuICBsZXQgYXJjaGl2ZUhhc2ggPSBudWxsO1xuICBsZXQgbG9jYWxBcHBzRm9sZGVyO1xuICBjb25zdCByZW1vdGVBcHBQcm9wcyA9IHtcbiAgICBsYXN0TW9kaWZpZWQ6IG51bGwsXG4gICAgaW1tdXRhYmxlOiBmYWxzZSxcbiAgICBtYXhBZ2U6IG51bGwsXG4gIH07XG4gIGNvbnN0IHtwcm90b2NvbCwgcGF0aG5hbWV9ID0gdXJsLnBhcnNlKG5ld0FwcCk7XG4gIGNvbnN0IGlzVXJsID0gWydodHRwOicsICdodHRwczonXS5pbmNsdWRlcyhwcm90b2NvbCk7XG5cbiAgcmV0dXJuIGF3YWl0IEFQUExJQ0FUSU9OU19DQUNIRV9HVUFSRC5hY3F1aXJlKGFwcCwgYXN5bmMgKCkgPT4ge1xuICAgIGlmIChpc1VybCkge1xuICAgICAgLy8gVXNlIHRoZSBhcHAgZnJvbSByZW1vdGUgVVJMXG4gICAgICBsb2dnZXIuaW5mbyhgVXNpbmcgZG93bmxvYWRhYmxlIGFwcCAnJHtuZXdBcHB9J2ApO1xuICAgICAgY29uc3QgaGVhZGVycyA9IGF3YWl0IHJldHJpZXZlSGVhZGVycyhuZXdBcHApO1xuICAgICAgaWYgKCFfLmlzRW1wdHkoaGVhZGVycykpIHtcbiAgICAgICAgaWYgKGhlYWRlcnNbJ2xhc3QtbW9kaWZpZWQnXSkge1xuICAgICAgICAgIHJlbW90ZUFwcFByb3BzLmxhc3RNb2RpZmllZCA9IG5ldyBEYXRlKGhlYWRlcnNbJ2xhc3QtbW9kaWZpZWQnXSk7XG4gICAgICAgIH1cbiAgICAgICAgbG9nZ2VyLmRlYnVnKGBMYXN0LU1vZGlmaWVkOiAke2hlYWRlcnNbJ2xhc3QtbW9kaWZpZWQnXX1gKTtcbiAgICAgICAgaWYgKGhlYWRlcnNbJ2NhY2hlLWNvbnRyb2wnXSkge1xuICAgICAgICAgIHJlbW90ZUFwcFByb3BzLmltbXV0YWJsZSA9IC9cXGJpbW11dGFibGVcXGIvaS50ZXN0KGhlYWRlcnNbJ2NhY2hlLWNvbnRyb2wnXSk7XG4gICAgICAgICAgY29uc3QgbWF4QWdlTWF0Y2ggPSAvXFxibWF4LWFnZT0oXFxkKylcXGIvaS5leGVjKGhlYWRlcnNbJ2NhY2hlLWNvbnRyb2wnXSk7XG4gICAgICAgICAgaWYgKG1heEFnZU1hdGNoKSB7XG4gICAgICAgICAgICByZW1vdGVBcHBQcm9wcy5tYXhBZ2UgPSBwYXJzZUludChtYXhBZ2VNYXRjaFsxXSwgMTApO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBsb2dnZXIuZGVidWcoYENhY2hlLUNvbnRyb2w6ICR7aGVhZGVyc1snY2FjaGUtY29udHJvbCddfWApO1xuICAgICAgfVxuXG4gICAgICAvLyAqKioqKiBDdXN0b20gbG9naWMgZm9yIHZlcmlmaWNhdGlvbiBvZiBsb2NhbCBzdGF0aWMgcGF0aCBmb3IgQVBQcyAqKioqKlxuICAgICAgbGV0IGRvd25sb2FkSXNOZWFkZWQgPSB0cnVlO1xuICAgICAgbG9jYWxBcHBzRm9sZGVyID0gYXdhaXQgZ2V0TG9jYWxBcHBzRm9sZGVyKCk7XG4gICAgICBsZXQgbG9jYWxGaWxlO1xuICAgICAgbGV0IGxvY2tGaWxlO1xuICAgICAgY29uc3Qgd2FpdGluZ1RpbWUgPSAxMDAwO1xuICAgICAgY29uc3QgbWF4QXR0ZW1wdHNDb3VudCA9IHByb2Nlc3MuZW52LkFQUElVTV9BUFBfV0FJVElOR19USU1FT1VUO1xuICAgICAgXG4gICAgICBpZihsb2NhbEFwcHNGb2xkZXIgIT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGxvY2FsRmlsZSA9IGF3YWl0IGdldExvY2FsRmlsZUZvckFwcFVybChuZXdBcHApO1xuICAgICAgICBsb2NrRmlsZSA9IGxvY2FsRmlsZSArICcubG9jayc7XG5cbiAgICAgICAgaWYoYXdhaXQgZnMuZXhpc3RzKGxvY2FsRmlsZSkpIHtcbiAgICAgICAgICBsb2dnZXIuaW5mbyhgW01DTE9VRF0gTG9jYWwgdmVyc2lvbiBvZiBhcHAgd2FzIGZvdW5kLiBXaWxsIGNoZWNrIGFjdHVhbGl0eSBvZiB0aGUgZmlsZWApO1xuICAgICAgICAgIC8vIENoZWNraW5nIG9mIGxvY2FsIGFwcGxpY2F0aW9uIGFjdHVhbGl0eVxuICAgICAgICAgIGNvbnN0IHJlbW90ZUZpbGVMZW5ndGggPSBhd2FpdCBnZXRGaWxlQ29udGVudExlbmd0aChhcHApO1xuICAgICAgICAgIC8vIEF0IHRoaXMgcG9pbnQgbG9jYWwgZmlsZSBtaWdodCBiZSBkZWxldGVkIGJ5IHBhcmFsbGVsIHNlc3Npb24gd2hpY2ggdXBkYXRlcyBvdXRkYXRlZCBhcHBcbiAgICAgICAgICBsZXQgYXR0ZW1wdHNDb3VudCA9IDA7XG4gICAgICAgICAgd2hpbGUoIWF3YWl0IGZzLmV4aXN0cyhsb2NhbEZpbGUpICYmIChhdHRlbXB0c0NvdW50KysgPCBtYXhBdHRlbXB0c0NvdW50KSkge1xuICAgICAgICAgICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgICAgICAgICAgbG9nZ2VyLmluZm8oYFtNQ0xPVURdIEF0dGVtcHQgIyR7YXR0ZW1wdHNDb3VudH0gZm9yIGxvY2FsIGFwcCBmaWxlIHRvIGFwcGVhciBhZ2FpbmApO1xuICAgICAgICAgICAgICBzZXRUaW1lb3V0KHJlc29sdmUsIHdhaXRpbmdUaW1lKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZighYXdhaXQgZnMuZXhpc3RzKGxvY2FsRmlsZSkpIHtcbiAgICAgICAgICAgIHRocm93IEVycm9yKGBbTUNMT1VEXSBMb2NhbCBhcHBsaWNhdGlvbiBmaWxlIGhhcyBub3QgYXBwZWFyZWQgYWZ0ZXIgdXBkYXRpbmcgYnkgcGFyYWxsZWwgQXBwaXVtIHNlc3Npb25gKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgY29uc3Qgc3RhdHMgPSBhd2FpdCBmcy5zdGF0KGxvY2FsRmlsZSk7XG4gICAgICAgICAgY29uc3QgbG9jYWxGaWxlTGVuZ3RoID0gc3RhdHMuc2l6ZTtcbiAgICAgICAgICBsb2dnZXIuaW5mbyhgW01DTE9VRF0gUmVtb3RlIGZpbGUgc2l6ZSBpcyAke3JlbW90ZUZpbGVMZW5ndGh9IGFuZCBsb2NhbCBmaWxlIHNpemUgaXMgJHtsb2NhbEZpbGVMZW5ndGh9YCk7XG4gICAgICAgICAgaWYocmVtb3RlRmlsZUxlbmd0aCAhPSBsb2NhbEZpbGVMZW5ndGgpIHtcbiAgICAgICAgICAgIGxvZ2dlci5pbmZvKGBbTUNMT1VEXSBTaXplcyBkaWZmZXIuIEhlbmNlIHRoYXQncyBuZWVkZWQgdG8gZG93bmxvYWQgZnJlc2ggdmVyc2lvbiBvZiB0aGUgYXBwYCk7XG4gICAgICAgICAgICBpZiAoYXdhaXQgZnMuZXhpc3RzKGxvY2FsRmlsZSkpIHtcbiAgICAgICAgICAgICAgYXdhaXQgZnMudW5saW5rKGxvY2FsRmlsZSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBsb2dnZXIud2FybihgW01DTE9VRF0gT2xkIGxvY2FsIGFwcGxpY2F0aW9uIGZpbGUgJHtsb2NhbEZpbGV9IHdhcyBub3QgZm91bmQuIFByb2JhYmx5IGl0IHdhcyByZW1vdmVkIGJ5IGFub3RoZXIgdGhyZWFkIHdoaWNoIHdhcyBkb3dubG9hZGluZyBhcHAgaW4gcGFyYWxsZWxgKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGRvd25sb2FkSXNOZWFkZWQgPSB0cnVlO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBsb2dnZXIuaW5mbyhgW01DTE9VRF0gU2l6ZXMgYXJlIHRoZSBzYW1lLiBIZW5jZSB3aWxsIHVzZSBhbHJlYWR5IHN0b3JlZCBhcHBsaWNhdGlvbiBmb3IgdGhlIHNlc3Npb25gKTtcbiAgICAgICAgICAgIG5ld0FwcCA9IGxvY2FsRmlsZTtcbiAgICAgICAgICAgIHNob3VsZFVuemlwQXBwID0gWklQX0VYVFMuaW5jbHVkZXMocGF0aC5leHRuYW1lKG5ld0FwcCkpO1xuICAgICAgICAgICAgZG93bmxvYWRJc05lYWRlZCA9IGZhbHNlO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmIChhd2FpdCBmcy5leGlzdHMobG9ja0ZpbGUpKSB7XG4gICAgICAgICAgbG9nZ2VyLmluZm8oYFtNQ0xPVURdIExvY2FsIHZlcnNpb24gb2YgYXBwIG5vdCBmb3VuZCBidXQgLmxvY2sgZmlsZSBleGlzdHMuIFdhaXRpbmcgZm9yIC5sb2NrIHRvIGRpc2FwcGVhcmApO1xuICAgICAgICAgIC8vIFdhaXQgZm9yIHNvbWUgdGltZSB0aWxsIEFwcCBpcyBkb3dubG9hZGVkIGJ5IHNvbWUgcGFyYWxsZWwgQXBwaXVtIGluc3RhbmNlXG4gICAgICAgICAgbGV0IGF0dGVtcHRzQ291bnQgPSAwO1xuICAgICAgICAgIHdoaWxlKGF3YWl0IGZzLmV4aXN0cyhsb2NrRmlsZSkgJiYgKGF0dGVtcHRzQ291bnQrKyA8IG1heEF0dGVtcHRzQ291bnQpKSB7XG4gICAgICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgICAgICAgICBsb2dnZXIuaW5mbyhgW01DTE9VRF0gQXR0ZW1wdCAjJHthdHRlbXB0c0NvdW50fSBmb3IgLmxvY2sgZmlsZSBjaGVja2luZ2ApO1xuICAgICAgICAgICAgICBzZXRUaW1lb3V0KHJlc29sdmUsIHdhaXRpbmdUaW1lKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZihhd2FpdCBmcy5leGlzdHMobG9ja0ZpbGUpKSB7XG4gICAgICAgICAgICB0aHJvdyBFcnJvcihgW01DTE9VRF0gLmxvY2sgZmlsZSBmb3IgZG93bmxvYWRpbmcgYXBwbGljYXRpb24gaGFzIG5vdCBkaXNhcHBlYXJlZCBhZnRlciAke3dhaXRpbmdUaW1lICogbWF4QXR0ZW1wdHNDb3VudH1tc2ApO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZighYXdhaXQgZnMuZXhpc3RzKGxvY2FsRmlsZSkpIHtcbiAgICAgICAgICAgIHRocm93IEVycm9yKGBbTUNMT1VEXSBMb2NhbCBhcHBsaWNhdGlvbiBmaWxlIGhhcyBub3QgYXBwZWFyZWQgYWZ0ZXIgLmxvY2sgZmlsZSByZW1vdmFsYCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGxvZ2dlci5pbmZvKGBbTUNMT1VEXSBMb2NhbCB2ZXJzaW9uIG9mIGFwcCB3YXMgZm91bmQgYWZ0ZXIgLmxvY2sgZmlsZSByZW1vdmFsLiBXaWxsIHVzZSBpdCBmb3IgbmV3IHNlc3Npb25gKTtcbiAgICAgICAgICBuZXdBcHAgPSBsb2NhbEZpbGU7XG4gICAgICAgICAgc2hvdWxkVW56aXBBcHAgPSBaSVBfRVhUUy5pbmNsdWRlcyhwYXRoLmV4dG5hbWUobmV3QXBwKSk7XG4gICAgICAgICAgZG93bmxvYWRJc05lYWRlZCA9IGZhbHNlO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGxvZ2dlci5pbmZvKGBbTUNMT1VEXSBOZWl0aGVyIGxvY2FsIHZlcnNpb24gb2YgYXBwIG5vciAubG9jayBmaWxlIHdhcyBmb3VuZC4gV2lsbCBkb3dubG9hZCBhcHAgZnJvbSByZW1vdGUgVVJMLmApO1xuICAgICAgICAgIGRvd25sb2FkSXNOZWFkZWQgPSB0cnVlO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBsb2dnZXIuaW5mbyhgW01DTE9VRF0gTG9jYWwgYXBwcyBmb2xkZXIgaXMgbm90IGRlZmluZWQgdmlhIGVudmlyb25tZW50IHByb3BlcnRpZXMsIGhlbmNlIHNraXBwaW5nIHRoaXMgbG9naWMuIFVzZSB2YXJpYWJsZSBBUFBJVU1fQVBQU19ESVIgZm9yIHBhdGggc2V0dGluZ2ApO1xuICAgICAgfVxuICAgICAgaWYoZG93bmxvYWRJc05lYWRlZCkge1xuICAgICAgXG4gICAgICAgIGlmKGxvY2FsQXBwc0ZvbGRlciAhPSB1bmRlZmluZWQpIHtcbiAgICAgICAgICBsb2dnZXIuaW5mbyhgW01DTE9VRF0gTG9jYWwgdmVyc2lvbiBvZiBhcHAgd2FzIG5vdCBmb3VuZC4gSGVuY2UgdXNpbmcgZGVmYXVsdCBBcHBpdW0gbG9naWMgZm9yIGRvd25sb2FkaW5nYCk7XG4gICAgICAgICAgY29uc3Qgc2hhcmVkRm9sZGVyUGF0aCA9IGF3YWl0IGdldFNoYXJlZEZvbGRlckZvckFwcFVybChhcHApO1xuICAgICAgICAgIGxvZ2dlci5pbmZvKGBbTUNMT1VEXSBGb2xkZXIgZm9yIGxvY2FsIHNoYXJlZCBhcHBzOiAke3NoYXJlZEZvbGRlclBhdGh9YCk7XG4gICAgICAgICAgYXdhaXQgZnMuY2xvc2UoYXdhaXQgZnMub3Blbihsb2NrRmlsZSwgJ3cnKSk7XG4gICAgICAgIH1cblxuICAgICAgICB0cnkge1xuICAgICAgY29uc3QgY2FjaGVkUGF0aCA9IGdldENhY2hlZEFwcGxpY2F0aW9uUGF0aChhcHAsIHJlbW90ZUFwcFByb3BzKTtcbiAgICAgIGlmIChjYWNoZWRQYXRoKSB7XG4gICAgICAgIGlmIChhd2FpdCBmcy5leGlzdHMoY2FjaGVkUGF0aCkpIHtcbiAgICAgICAgICBsb2dnZXIuaW5mbyhgUmV1c2luZyBwcmV2aW91c2x5IGRvd25sb2FkZWQgYXBwbGljYXRpb24gYXQgJyR7Y2FjaGVkUGF0aH0nYCk7XG4gICAgICAgICAgcmV0dXJuIHZlcmlmeUFwcEV4dGVuc2lvbihjYWNoZWRQYXRoLCBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zKTtcbiAgICAgICAgfVxuICAgICAgICBsb2dnZXIuaW5mbyhgVGhlIGFwcGxpY2F0aW9uIGF0ICcke2NhY2hlZFBhdGh9JyBkb2VzIG5vdCBleGlzdCBhbnltb3JlLiBEZWxldGluZyBpdCBmcm9tIHRoZSBjYWNoZWApO1xuICAgICAgICBBUFBMSUNBVElPTlNfQ0FDSEUuZGVsKGFwcCk7XG4gICAgICB9XG5cbiAgICAgIGxldCBmaWxlTmFtZSA9IG51bGw7XG4gICAgICBjb25zdCBiYXNlbmFtZSA9IGZzLnNhbml0aXplTmFtZShwYXRoLmJhc2VuYW1lKGRlY29kZVVSSUNvbXBvbmVudChwYXRobmFtZSkpLCB7XG4gICAgICAgIHJlcGxhY2VtZW50OiBTQU5JVElaRV9SRVBMQUNFTUVOVFxuICAgICAgfSk7XG4gICAgICBjb25zdCBleHRuYW1lID0gcGF0aC5leHRuYW1lKGJhc2VuYW1lKTtcbiAgICAgIC8vIHRvIGRldGVybWluZSBpZiB3ZSBuZWVkIHRvIHVuemlwIHRoZSBhcHAsIHdlIGhhdmUgYSBudW1iZXIgb2YgcGxhY2VzXG4gICAgICAvLyB0byBsb29rOiBjb250ZW50IHR5cGUsIGNvbnRlbnQgZGlzcG9zaXRpb24sIG9yIHRoZSBmaWxlIGV4dGVuc2lvblxuICAgICAgaWYgKFpJUF9FWFRTLmluY2x1ZGVzKGV4dG5hbWUpKSB7XG4gICAgICAgIGZpbGVOYW1lID0gYmFzZW5hbWU7XG4gICAgICAgIHNob3VsZFVuemlwQXBwID0gdHJ1ZTtcbiAgICAgIH1cbiAgICAgIGlmIChoZWFkZXJzWydjb250ZW50LXR5cGUnXSkge1xuICAgICAgICBjb25zdCBjdCA9IGhlYWRlcnNbJ2NvbnRlbnQtdHlwZSddO1xuICAgICAgICBsb2dnZXIuZGVidWcoYENvbnRlbnQtVHlwZTogJHtjdH1gKTtcbiAgICAgICAgLy8gdGhlIGZpbGV0eXBlIG1heSBub3QgYmUgb2J2aW91cyBmb3IgY2VydGFpbiB1cmxzLCBzbyBjaGVjayB0aGUgbWltZSB0eXBlIHRvb1xuICAgICAgICBpZiAoWklQX01JTUVfVFlQRVMuc29tZSgobWltZVR5cGUpID0+IG5ldyBSZWdFeHAoYFxcXFxiJHtfLmVzY2FwZVJlZ0V4cChtaW1lVHlwZSl9XFxcXGJgKS50ZXN0KGN0KSkpIHtcbiAgICAgICAgICBpZiAoIWZpbGVOYW1lKSB7XG4gICAgICAgICAgICBmaWxlTmFtZSA9IGAke0RFRkFVTFRfQkFTRU5BTUV9LnppcGA7XG4gICAgICAgICAgfVxuICAgICAgICAgIHNob3VsZFVuemlwQXBwID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKGhlYWRlcnNbJ2NvbnRlbnQtZGlzcG9zaXRpb24nXSAmJiAvXmF0dGFjaG1lbnQvaS50ZXN0KGhlYWRlcnNbJ2NvbnRlbnQtZGlzcG9zaXRpb24nXSkpIHtcbiAgICAgICAgbG9nZ2VyLmRlYnVnKGBDb250ZW50LURpc3Bvc2l0aW9uOiAke2hlYWRlcnNbJ2NvbnRlbnQtZGlzcG9zaXRpb24nXX1gKTtcbiAgICAgICAgY29uc3QgbWF0Y2ggPSAvZmlsZW5hbWU9XCIoW15cIl0rKS9pLmV4ZWMoaGVhZGVyc1snY29udGVudC1kaXNwb3NpdGlvbiddKTtcbiAgICAgICAgaWYgKG1hdGNoKSB7XG4gICAgICAgICAgZmlsZU5hbWUgPSBmcy5zYW5pdGl6ZU5hbWUobWF0Y2hbMV0sIHtcbiAgICAgICAgICAgIHJlcGxhY2VtZW50OiBTQU5JVElaRV9SRVBMQUNFTUVOVFxuICAgICAgICAgIH0pO1xuICAgICAgICAgIHNob3VsZFVuemlwQXBwID0gc2hvdWxkVW56aXBBcHAgfHwgWklQX0VYVFMuaW5jbHVkZXMocGF0aC5leHRuYW1lKGZpbGVOYW1lKSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmICghZmlsZU5hbWUpIHtcbiAgICAgICAgLy8gYXNzaWduIHRoZSBkZWZhdWx0IGZpbGUgbmFtZSBhbmQgdGhlIGV4dGVuc2lvbiBpZiBub25lIGhhcyBiZWVuIGRldGVjdGVkXG4gICAgICAgIGNvbnN0IHJlc3VsdGluZ05hbWUgPSBiYXNlbmFtZVxuICAgICAgICAgID8gYmFzZW5hbWUuc3Vic3RyaW5nKDAsIGJhc2VuYW1lLmxlbmd0aCAtIGV4dG5hbWUubGVuZ3RoKVxuICAgICAgICAgIDogREVGQVVMVF9CQVNFTkFNRTtcbiAgICAgICAgbGV0IHJlc3VsdGluZ0V4dCA9IGV4dG5hbWU7XG4gICAgICAgIGlmICghc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucy5pbmNsdWRlcyhyZXN1bHRpbmdFeHQpKSB7XG4gICAgICAgICAgbG9nZ2VyLmluZm8oYFRoZSBjdXJyZW50IGZpbGUgZXh0ZW5zaW9uICcke3Jlc3VsdGluZ0V4dH0nIGlzIG5vdCBzdXBwb3J0ZWQuIGAgK1xuICAgICAgICAgICAgYERlZmF1bHRpbmcgdG8gJyR7Xy5maXJzdChzdXBwb3J0ZWRBcHBFeHRlbnNpb25zKX0nYCk7XG4gICAgICAgICAgcmVzdWx0aW5nRXh0ID0gXy5maXJzdChzdXBwb3J0ZWRBcHBFeHRlbnNpb25zKTtcbiAgICAgICAgfVxuICAgICAgICBmaWxlTmFtZSA9IGAke3Jlc3VsdGluZ05hbWV9JHtyZXN1bHRpbmdFeHR9YDtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHRhcmdldFBhdGggPSBhd2FpdCB0ZW1wRGlyLnBhdGgoe1xuICAgICAgICBwcmVmaXg6IGZpbGVOYW1lLFxuICAgICAgICBzdWZmaXg6ICcnLFxuICAgICAgfSk7XG4gICAgICBuZXdBcHAgPSBhd2FpdCBkb3dubG9hZEFwcChuZXdBcHAsIHRhcmdldFBhdGgpO1xuXG4gICAgICAvLyAqKioqKiBDdXN0b20gbG9naWMgZm9yIGNvcHlpbmcgb2YgZG93bmxvYWRlZCBhcHAgdG8gc3RhdGljIGxvY2F0aW9uICoqKioqXG4gICAgICBpZihsb2NhbEFwcHNGb2xkZXIgIT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGxvZ2dlci5pbmZvKGBbTUNMT1VEXSBOZXcgYXBwIHBhdGg6ICR7bmV3QXBwfWApO1xuICAgICAgICBhd2FpdCBmcy5jb3B5RmlsZShuZXdBcHAsIGxvY2FsRmlsZSk7XG4gICAgICB9XG4gICAgICB9XG4gICAgICBmaW5hbGx5IHtcbiAgICAgICAgaWYobG9jYWxBcHBzRm9sZGVyICE9IHVuZGVmaW5lZCkge1xuICAgICAgICAgIGxvZ2dlci5pbmZvKGBbTUNMT1VEXSBHb2luZyB0byByZW1vdmUgbG9jayBmaWxlICR7bG9ja0ZpbGV9YClcbiAgICAgICAgICBpZiAoYXdhaXQgZnMuZXhpc3RzKGxvY2tGaWxlKSkge1xuICAgICAgICAgICAgYXdhaXQgZnMudW5saW5rKGxvY2tGaWxlKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgbG9nZ2VyLndhcm4oYFtNQ0xPVURdIExvY2sgZmlsZSAke2xvY2tGaWxlfSB3YXMgbm90IGZvdW5kLiBQcm9iYWJseSBpdCB3YXMgcmVtb3ZlZCBieSBhbm90aGVyIHRocmVhZCB3aGljaCB3YXMgZG93bmxvYWRpbmcgYXBwIGluIHBhcmFsbGVsYCk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChhd2FpdCBmcy5leGlzdHMobmV3QXBwKSkge1xuICAgICAgLy8gVXNlIHRoZSBsb2NhbCBhcHBcbiAgICAgIGxvZ2dlci5pbmZvKGBVc2luZyBsb2NhbCBhcHAgJyR7bmV3QXBwfSdgKTtcbiAgICAgIHNob3VsZFVuemlwQXBwID0gWklQX0VYVFMuaW5jbHVkZXMocGF0aC5leHRuYW1lKG5ld0FwcCkpO1xuICAgIH0gZWxzZSB7XG4gICAgICBsZXQgZXJyb3JNZXNzYWdlID0gYFRoZSBhcHBsaWNhdGlvbiBhdCAnJHtuZXdBcHB9JyBkb2VzIG5vdCBleGlzdCBvciBpcyBub3QgYWNjZXNzaWJsZWA7XG4gICAgICAvLyBwcm90b2NvbCB2YWx1ZSBmb3IgJ0M6XFxcXHRlbXAnIGlzICdjOicsIHNvIHdlIGNoZWNrIHRoZSBsZW5ndGggYXMgd2VsbFxuICAgICAgaWYgKF8uaXNTdHJpbmcocHJvdG9jb2wpICYmIHByb3RvY29sLmxlbmd0aCA+IDIpIHtcbiAgICAgICAgZXJyb3JNZXNzYWdlID0gYFRoZSBwcm90b2NvbCAnJHtwcm90b2NvbH0nIHVzZWQgaW4gJyR7bmV3QXBwfScgaXMgbm90IHN1cHBvcnRlZC4gYCArXG4gICAgICAgICAgYE9ubHkgaHR0cDogYW5kIGh0dHBzOiBwcm90b2NvbHMgYXJlIHN1cHBvcnRlZGA7XG4gICAgICB9XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoZXJyb3JNZXNzYWdlKTtcbiAgICB9XG5cbiAgICBpZiAoc2hvdWxkVW56aXBBcHApIHtcbiAgICAgIGNvbnN0IGFyY2hpdmVQYXRoID0gbmV3QXBwO1xuICAgICAgYXJjaGl2ZUhhc2ggPSBhd2FpdCBmcy5oYXNoKGFyY2hpdmVQYXRoKTtcbiAgICAgIGlmIChBUFBMSUNBVElPTlNfQ0FDSEUuaGFzKGFwcCkgJiYgYXJjaGl2ZUhhc2ggPT09IEFQUExJQ0FUSU9OU19DQUNIRS5nZXQoYXBwKS5oYXNoKSB7XG4gICAgICAgIGNvbnN0IHtmdWxsUGF0aH0gPSBBUFBMSUNBVElPTlNfQ0FDSEUuZ2V0KGFwcCk7XG4gICAgICAgIGlmIChhd2FpdCBmcy5leGlzdHMoZnVsbFBhdGgpKSB7XG4gICAgICAgICAgaWYgKGFyY2hpdmVQYXRoICE9PSBhcHAgJiYgbG9jYWxBcHBzRm9sZGVyID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIGF3YWl0IGZzLnJpbXJhZihhcmNoaXZlUGF0aCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGxvZ2dlci5pbmZvKGBXaWxsIHJldXNlIHByZXZpb3VzbHkgY2FjaGVkIGFwcGxpY2F0aW9uIGF0ICcke2Z1bGxQYXRofSdgKTtcbiAgICAgICAgICByZXR1cm4gdmVyaWZ5QXBwRXh0ZW5zaW9uKGZ1bGxQYXRoLCBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zKTtcbiAgICAgICAgfVxuICAgICAgICBsb2dnZXIuaW5mbyhgVGhlIGFwcGxpY2F0aW9uIGF0ICcke2Z1bGxQYXRofScgZG9lcyBub3QgZXhpc3QgYW55bW9yZS4gRGVsZXRpbmcgaXQgZnJvbSB0aGUgY2FjaGVgKTtcbiAgICAgICAgQVBQTElDQVRJT05TX0NBQ0hFLmRlbChhcHApO1xuICAgICAgfVxuICAgICAgY29uc3QgdG1wUm9vdCA9IGF3YWl0IHRlbXBEaXIub3BlbkRpcigpO1xuICAgICAgdHJ5IHtcbiAgICAgICAgbmV3QXBwID0gYXdhaXQgdW56aXBBcHAoYXJjaGl2ZVBhdGgsIHRtcFJvb3QsIHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMpO1xuICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgaWYgKG5ld0FwcCAhPT0gYXJjaGl2ZVBhdGggJiYgYXJjaGl2ZVBhdGggIT09IGFwcCAmJiBsb2NhbEFwcHNGb2xkZXIgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIGF3YWl0IGZzLnJpbXJhZihhcmNoaXZlUGF0aCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGxvZ2dlci5pbmZvKGBVbnppcHBlZCBsb2NhbCBhcHAgdG8gJyR7bmV3QXBwfSdgKTtcbiAgICB9IGVsc2UgaWYgKCFwYXRoLmlzQWJzb2x1dGUobmV3QXBwKSkge1xuICAgICAgbmV3QXBwID0gcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksIG5ld0FwcCk7XG4gICAgICBsb2dnZXIud2FybihgVGhlIGN1cnJlbnQgYXBwbGljYXRpb24gcGF0aCAnJHthcHB9JyBpcyBub3QgYWJzb2x1dGUgYCArXG4gICAgICAgIGBhbmQgaGFzIGJlZW4gcmV3cml0dGVuIHRvICcke25ld0FwcH0nLiBDb25zaWRlciB1c2luZyBhYnNvbHV0ZSBwYXRocyByYXRoZXIgdGhhbiByZWxhdGl2ZWApO1xuICAgICAgYXBwID0gbmV3QXBwO1xuICAgIH1cblxuICAgIHZlcmlmeUFwcEV4dGVuc2lvbihuZXdBcHAsIHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMpO1xuXG4gICAgaWYgKGFwcCAhPT0gbmV3QXBwICYmIChhcmNoaXZlSGFzaCB8fCBfLnZhbHVlcyhyZW1vdGVBcHBQcm9wcykuc29tZShCb29sZWFuKSkpIHtcbiAgICAgIGlmIChBUFBMSUNBVElPTlNfQ0FDSEUuaGFzKGFwcCkpIHtcbiAgICAgICAgY29uc3Qge2Z1bGxQYXRofSA9IEFQUExJQ0FUSU9OU19DQUNIRS5nZXQoYXBwKTtcbiAgICAgICAgLy8gQ2xlYW4gdXAgdGhlIG9ic29sZXRlIGVudHJ5IGZpcnN0IGlmIG5lZWRlZFxuICAgICAgICBpZiAoZnVsbFBhdGggIT09IG5ld0FwcCAmJiBhd2FpdCBmcy5leGlzdHMoZnVsbFBhdGgpKSB7XG4gICAgICAgICAgYXdhaXQgZnMucmltcmFmKGZ1bGxQYXRoKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgQVBQTElDQVRJT05TX0NBQ0hFLnNldChhcHAsIHtcbiAgICAgICAgLi4ucmVtb3RlQXBwUHJvcHMsXG4gICAgICAgIHRpbWVzdGFtcDogRGF0ZS5ub3coKSxcbiAgICAgICAgaGFzaDogYXJjaGl2ZUhhc2gsXG4gICAgICAgIGZ1bGxQYXRoOiBuZXdBcHAsXG4gICAgICB9KTtcbiAgICB9XG4gICAgcmV0dXJuIG5ld0FwcDtcbiAgfSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGRvd25sb2FkQXBwIChhcHAsIHRhcmdldFBhdGgpIHtcbiAgY29uc3Qge2hyZWZ9ID0gdXJsLnBhcnNlKGFwcCk7XG4gIHRyeSB7XG4gICAgYXdhaXQgbmV0LmRvd25sb2FkRmlsZShocmVmLCB0YXJnZXRQYXRoLCB7XG4gICAgICB0aW1lb3V0OiBBUFBfRE9XTkxPQURfVElNRU9VVF9NUyxcbiAgICB9KTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBVbmFibGUgdG8gZG93bmxvYWQgdGhlIGFwcDogJHtlcnIubWVzc2FnZX1gKTtcbiAgfVxuICByZXR1cm4gdGFyZ2V0UGF0aDtcbn1cblxuLyoqXG4gKiBFeHRyYWN0cyB0aGUgYnVuZGxlIGZyb20gYW4gYXJjaGl2ZSBpbnRvIHRoZSBnaXZlbiBmb2xkZXJcbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gemlwUGF0aCBGdWxsIHBhdGggdG8gdGhlIGFyY2hpdmUgY29udGFpbmluZyB0aGUgYnVuZGxlXG4gKiBAcGFyYW0ge3N0cmluZ30gZHN0Um9vdCBGdWxsIHBhdGggdG8gdGhlIGZvbGRlciB3aGVyZSB0aGUgZXh0cmFjdGVkIGJ1bmRsZVxuICogc2hvdWxkIGJlIHBsYWNlZFxuICogQHBhcmFtIHtBcnJheTxzdHJpbmc+fHN0cmluZ30gc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucyBUaGUgbGlzdCBvZiBleHRlbnNpb25zXG4gKiB0aGUgdGFyZ2V0IGFwcGxpY2F0aW9uIGJ1bmRsZSBzdXBwb3J0cywgZm9yIGV4YW1wbGUgWycuYXBrJywgJy5hcGtzJ10gZm9yXG4gKiBBbmRyb2lkIHBhY2thZ2VzXG4gKiBAcmV0dXJucyB7c3RyaW5nfSBGdWxsIHBhdGggdG8gdGhlIGJ1bmRsZSBpbiB0aGUgZGVzdGluYXRpb24gZm9sZGVyXG4gKiBAdGhyb3dzIHtFcnJvcn0gSWYgdGhlIGdpdmVuIGFyY2hpdmUgaXMgaW52YWxpZCBvciBubyBhcHBsaWNhdGlvbiBidW5kbGVzXG4gKiBoYXZlIGJlZW4gZm91bmQgaW5zaWRlXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHVuemlwQXBwICh6aXBQYXRoLCBkc3RSb290LCBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zKSB7XG4gIGF3YWl0IHppcC5hc3NlcnRWYWxpZFppcCh6aXBQYXRoKTtcblxuICBpZiAoIV8uaXNBcnJheShzdXBwb3J0ZWRBcHBFeHRlbnNpb25zKSkge1xuICAgIHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMgPSBbc3VwcG9ydGVkQXBwRXh0ZW5zaW9uc107XG4gIH1cblxuICBjb25zdCB0bXBSb290ID0gYXdhaXQgdGVtcERpci5vcGVuRGlyKCk7XG4gIHRyeSB7XG4gICAgbG9nZ2VyLmRlYnVnKGBVbnppcHBpbmcgJyR7emlwUGF0aH0nYCk7XG4gICAgY29uc3QgdGltZXIgPSBuZXcgdGltaW5nLlRpbWVyKCkuc3RhcnQoKTtcbiAgICAvKipcbiAgICAgKiBBdHRlbXB0IHRvIHVzZSB1c2UgdGhlIHN5c3RlbSBgdW56aXBgIChlLmcuLCBgL3Vzci9iaW4vdW56aXBgKSBkdWVcbiAgICAgKiB0byB0aGUgc2lnbmlmaWNhbnQgcGVyZm9ybWFuY2UgaW1wcm92ZW1lbnQgaXQgcHJvdmlkZXMgb3ZlciB0aGUgbmF0aXZlXG4gICAgICogSlMgXCJ1bnppcFwiIGltcGxlbWVudGF0aW9uLlxuICAgICAqIEB0eXBlIHtpbXBvcnQoJ2FwcGl1bS1zdXBwb3J0L2xpYi96aXAnKS5FeHRyYWN0QWxsT3B0aW9uc31cbiAgICAgKi9cbiAgICBjb25zdCBleHRyYWN0aW9uT3B0cyA9IHtcbiAgICAgIHVzZVN5c3RlbVVuemlwOiB0cnVlLFxuICAgIH07XG4gICAgLy8gaHR0cHM6Ly9naXRodWIuY29tL2FwcGl1bS9hcHBpdW0vaXNzdWVzLzE0MTAwXG4gICAgaWYgKHBhdGguZXh0bmFtZSh6aXBQYXRoKSA9PT0gSVBBX0VYVCkge1xuICAgICAgbG9nZ2VyLmRlYnVnKGBFbmZvcmNpbmcgVVRGLTggZW5jb2Rpbmcgb24gdGhlIGV4dHJhY3RlZCBmaWxlIG5hbWVzIGZvciAnJHtwYXRoLmJhc2VuYW1lKHppcFBhdGgpfSdgKTtcbiAgICAgIGV4dHJhY3Rpb25PcHRzLmZpbGVOYW1lc0VuY29kaW5nID0gJ3V0ZjgnO1xuICAgIH1cbiAgICBhd2FpdCB6aXAuZXh0cmFjdEFsbFRvKHppcFBhdGgsIHRtcFJvb3QsIGV4dHJhY3Rpb25PcHRzKTtcbiAgICBjb25zdCBnbG9iUGF0dGVybiA9IGAqKi8qLisoJHtzdXBwb3J0ZWRBcHBFeHRlbnNpb25zLm1hcCgoZXh0KSA9PiBleHQucmVwbGFjZSgvXlxcLi8sICcnKSkuam9pbignfCcpfSlgO1xuICAgIGNvbnN0IHNvcnRlZEJ1bmRsZUl0ZW1zID0gKGF3YWl0IGZzLmdsb2IoZ2xvYlBhdHRlcm4sIHtcbiAgICAgIGN3ZDogdG1wUm9vdCxcbiAgICAgIHN0cmljdDogZmFsc2UsXG4gICAgLy8gR2V0IHRoZSB0b3AgbGV2ZWwgbWF0Y2hcbiAgICB9KSkuc29ydCgoYSwgYikgPT4gYS5zcGxpdChwYXRoLnNlcCkubGVuZ3RoIC0gYi5zcGxpdChwYXRoLnNlcCkubGVuZ3RoKTtcbiAgICBpZiAoXy5pc0VtcHR5KHNvcnRlZEJ1bmRsZUl0ZW1zKSkge1xuICAgICAgbG9nZ2VyLmVycm9yQW5kVGhyb3coYEFwcCB1bnppcHBlZCBPSywgYnV0IHdlIGNvdWxkIG5vdCBmaW5kIGFueSAnJHtzdXBwb3J0ZWRBcHBFeHRlbnNpb25zfScgYCArXG4gICAgICAgIHV0aWwucGx1cmFsaXplKCdidW5kbGUnLCBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zLmxlbmd0aCwgZmFsc2UpICtcbiAgICAgICAgYCBpbiBpdC4gTWFrZSBzdXJlIHlvdXIgYXJjaGl2ZSBjb250YWlucyBhdCBsZWFzdCBvbmUgcGFja2FnZSBoYXZpbmcgYCArXG4gICAgICAgIGAnJHtzdXBwb3J0ZWRBcHBFeHRlbnNpb25zfScgJHt1dGlsLnBsdXJhbGl6ZSgnZXh0ZW5zaW9uJywgc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucy5sZW5ndGgsIGZhbHNlKX1gKTtcbiAgICB9XG4gICAgbG9nZ2VyLmRlYnVnKGBFeHRyYWN0ZWQgJHt1dGlsLnBsdXJhbGl6ZSgnYnVuZGxlIGl0ZW0nLCBzb3J0ZWRCdW5kbGVJdGVtcy5sZW5ndGgsIHRydWUpfSBgICtcbiAgICAgIGBmcm9tICcke3ppcFBhdGh9JyBpbiAke01hdGgucm91bmQodGltZXIuZ2V0RHVyYXRpb24oKS5hc01pbGxpU2Vjb25kcyl9bXM6ICR7c29ydGVkQnVuZGxlSXRlbXN9YCk7XG4gICAgY29uc3QgbWF0Y2hlZEJ1bmRsZSA9IF8uZmlyc3Qoc29ydGVkQnVuZGxlSXRlbXMpO1xuICAgIGxvZ2dlci5pbmZvKGBBc3N1bWluZyAnJHttYXRjaGVkQnVuZGxlfScgaXMgdGhlIGNvcnJlY3QgYnVuZGxlYCk7XG4gICAgY29uc3QgZHN0UGF0aCA9IHBhdGgucmVzb2x2ZShkc3RSb290LCBwYXRoLmJhc2VuYW1lKG1hdGNoZWRCdW5kbGUpKTtcbiAgICBhd2FpdCBmcy5tdihwYXRoLnJlc29sdmUodG1wUm9vdCwgbWF0Y2hlZEJ1bmRsZSksIGRzdFBhdGgsIHtta2RpcnA6IHRydWV9KTtcbiAgICByZXR1cm4gZHN0UGF0aDtcbiAgfSBmaW5hbGx5IHtcbiAgICBhd2FpdCBmcy5yaW1yYWYodG1wUm9vdCk7XG4gIH1cbn1cblxuZnVuY3Rpb24gaXNQYWNrYWdlT3JCdW5kbGUgKGFwcCkge1xuICByZXR1cm4gKC9eKFthLXpBLVowLTlcXC1fXStcXC5bYS16QS1aMC05XFwtX10rKSskLykudGVzdChhcHApO1xufVxuXG4vKipcbiAqIEZpbmRzIGFsbCBpbnN0YW5jZXMgJ2ZpcnN0S2V5JyBhbmQgY3JlYXRlIGEgZHVwbGljYXRlIHdpdGggdGhlIGtleSAnc2Vjb25kS2V5JyxcbiAqIERvIHRoZSBzYW1lIHRoaW5nIGluIHJldmVyc2UuIElmIHdlIGZpbmQgJ3NlY29uZEtleScsIGNyZWF0ZSBhIGR1cGxpY2F0ZSB3aXRoIHRoZSBrZXkgJ2ZpcnN0S2V5Jy5cbiAqXG4gKiBUaGlzIHdpbGwgY2F1c2Uga2V5cyB0byBiZSBvdmVyd3JpdHRlbiBpZiB0aGUgb2JqZWN0IGNvbnRhaW5zICdmaXJzdEtleScgYW5kICdzZWNvbmRLZXknLlxuXG4gKiBAcGFyYW0geyp9IGlucHV0IEFueSB0eXBlIG9mIGlucHV0XG4gKiBAcGFyYW0ge1N0cmluZ30gZmlyc3RLZXkgVGhlIGZpcnN0IGtleSB0byBkdXBsaWNhdGVcbiAqIEBwYXJhbSB7U3RyaW5nfSBzZWNvbmRLZXkgVGhlIHNlY29uZCBrZXkgdG8gZHVwbGljYXRlXG4gKi9cbmZ1bmN0aW9uIGR1cGxpY2F0ZUtleXMgKGlucHV0LCBmaXJzdEtleSwgc2Vjb25kS2V5KSB7XG4gIC8vIElmIGFycmF5IHByb3ZpZGVkLCByZWN1cnNpdmVseSBjYWxsIG9uIGFsbCBlbGVtZW50c1xuICBpZiAoXy5pc0FycmF5KGlucHV0KSkge1xuICAgIHJldHVybiBpbnB1dC5tYXAoKGl0ZW0pID0+IGR1cGxpY2F0ZUtleXMoaXRlbSwgZmlyc3RLZXksIHNlY29uZEtleSkpO1xuICB9XG5cbiAgLy8gSWYgb2JqZWN0LCBjcmVhdGUgZHVwbGljYXRlcyBmb3Iga2V5cyBhbmQgdGhlbiByZWN1cnNpdmVseSBjYWxsIG9uIHZhbHVlc1xuICBpZiAoXy5pc1BsYWluT2JqZWN0KGlucHV0KSkge1xuICAgIGNvbnN0IHJlc3VsdE9iaiA9IHt9O1xuICAgIGZvciAobGV0IFtrZXksIHZhbHVlXSBvZiBfLnRvUGFpcnMoaW5wdXQpKSB7XG4gICAgICBjb25zdCByZWN1cnNpdmVseUNhbGxlZFZhbHVlID0gZHVwbGljYXRlS2V5cyh2YWx1ZSwgZmlyc3RLZXksIHNlY29uZEtleSk7XG4gICAgICBpZiAoa2V5ID09PSBmaXJzdEtleSkge1xuICAgICAgICByZXN1bHRPYmpbc2Vjb25kS2V5XSA9IHJlY3Vyc2l2ZWx5Q2FsbGVkVmFsdWU7XG4gICAgICB9IGVsc2UgaWYgKGtleSA9PT0gc2Vjb25kS2V5KSB7XG4gICAgICAgIHJlc3VsdE9ialtmaXJzdEtleV0gPSByZWN1cnNpdmVseUNhbGxlZFZhbHVlO1xuICAgICAgfVxuICAgICAgcmVzdWx0T2JqW2tleV0gPSByZWN1cnNpdmVseUNhbGxlZFZhbHVlO1xuICAgIH1cbiAgICByZXR1cm4gcmVzdWx0T2JqO1xuICB9XG5cbiAgLy8gQmFzZSBjYXNlLiBSZXR1cm4gcHJpbWl0aXZlcyB3aXRob3V0IGRvaW5nIGFueXRoaW5nLlxuICByZXR1cm4gaW5wdXQ7XG59XG5cbi8qKlxuICogVGFrZXMgYSBkZXNpcmVkIGNhcGFiaWxpdHkgYW5kIHRyaWVzIHRvIEpTT04ucGFyc2UgaXQgYXMgYW4gYXJyYXksXG4gKiBhbmQgZWl0aGVyIHJldHVybnMgdGhlIHBhcnNlZCBhcnJheSBvciBhIHNpbmdsZXRvbiBhcnJheS5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ3xBcnJheTxTdHJpbmc+fSBjYXAgQSBkZXNpcmVkIGNhcGFiaWxpdHlcbiAqL1xuZnVuY3Rpb24gcGFyc2VDYXBzQXJyYXkgKGNhcCkge1xuICBpZiAoXy5pc0FycmF5KGNhcCkpIHtcbiAgICByZXR1cm4gY2FwO1xuICB9XG5cbiAgbGV0IHBhcnNlZENhcHM7XG4gIHRyeSB7XG4gICAgcGFyc2VkQ2FwcyA9IEpTT04ucGFyc2UoY2FwKTtcbiAgICBpZiAoXy5pc0FycmF5KHBhcnNlZENhcHMpKSB7XG4gICAgICByZXR1cm4gcGFyc2VkQ2FwcztcbiAgICB9XG4gIH0gY2F0Y2ggKGlnbikge1xuICAgIGxvZ2dlci53YXJuKGBGYWlsZWQgdG8gcGFyc2UgY2FwYWJpbGl0eSBhcyBKU09OIGFycmF5YCk7XG4gIH1cbiAgaWYgKF8uaXNTdHJpbmcoY2FwKSkge1xuICAgIHJldHVybiBbY2FwXTtcbiAgfVxuICB0aHJvdyBuZXcgRXJyb3IoYG11c3QgcHJvdmlkZSBhIHN0cmluZyBvciBKU09OIEFycmF5OyByZWNlaXZlZCAke2NhcH1gKTtcbn1cblxuZXhwb3J0IHtcbiAgY29uZmlndXJlQXBwLCBpc1BhY2thZ2VPckJ1bmRsZSwgZHVwbGljYXRlS2V5cywgcGFyc2VDYXBzQXJyYXlcbn07XG4iXSwiZmlsZSI6ImxpYi9iYXNlZHJpdmVyL2hlbHBlcnMuanMiLCJzb3VyY2VSb290IjoiLi4vLi4vLi4ifQ==
