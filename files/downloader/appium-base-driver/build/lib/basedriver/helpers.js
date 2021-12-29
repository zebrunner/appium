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


//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImxpYi9iYXNlZHJpdmVyL2hlbHBlcnMuanMiXSwibmFtZXMiOlsiSVBBX0VYVCIsIlpJUF9FWFRTIiwiWklQX01JTUVfVFlQRVMiLCJDQUNIRURfQVBQU19NQVhfQUdFIiwiQVBQTElDQVRJT05TX0NBQ0hFIiwiTFJVIiwibWF4QWdlIiwidXBkYXRlQWdlT25HZXQiLCJkaXNwb3NlIiwiYXBwIiwiZnVsbFBhdGgiLCJmcyIsImV4aXN0cyIsImxvZ2dlciIsImluZm8iLCJyaW1yYWYiLCJub0Rpc3Bvc2VPblNldCIsIkFQUExJQ0FUSU9OU19DQUNIRV9HVUFSRCIsIkFzeW5jTG9jayIsIlNBTklUSVpFX1JFUExBQ0VNRU5UIiwiREVGQVVMVF9CQVNFTkFNRSIsIkFQUF9ET1dOTE9BRF9USU1FT1VUX01TIiwicHJvY2VzcyIsIm9uIiwiaXRlbUNvdW50IiwiYXBwUGF0aHMiLCJ2YWx1ZXMiLCJtYXAiLCJkZWJ1ZyIsImxlbmd0aCIsInV0aWwiLCJwbHVyYWxpemUiLCJhcHBQYXRoIiwicmltcmFmU3luYyIsImUiLCJ3YXJuIiwibWVzc2FnZSIsInJldHJpZXZlSGVhZGVycyIsImxpbmsiLCJ1cmwiLCJtZXRob2QiLCJ0aW1lb3V0IiwiaGVhZGVycyIsImdldENhY2hlZEFwcGxpY2F0aW9uUGF0aCIsImN1cnJlbnRBcHBQcm9wcyIsInJlZnJlc2giLCJoYXMiLCJsYXN0TW9kaWZpZWQiLCJjdXJyZW50TW9kaWZpZWQiLCJpbW11dGFibGUiLCJjdXJyZW50SW1tdXRhYmxlIiwiY3VycmVudE1heEFnZSIsInRpbWVzdGFtcCIsImdldCIsImdldFRpbWUiLCJtc0xlZnQiLCJEYXRlIiwibm93IiwicGF0aCIsImJhc2VuYW1lIiwidmVyaWZ5QXBwRXh0ZW5zaW9uIiwic3VwcG9ydGVkQXBwRXh0ZW5zaW9ucyIsImluY2x1ZGVzIiwiZXh0bmFtZSIsIkVycm9yIiwiY29uZmlndXJlQXBwIiwiXyIsImlzU3RyaW5nIiwiaXNBcnJheSIsIm5ld0FwcCIsInNob3VsZFVuemlwQXBwIiwiYXJjaGl2ZUhhc2giLCJsb2NhbEFwcHNGb2xkZXIiLCJyZW1vdGVBcHBQcm9wcyIsInByb3RvY29sIiwicGF0aG5hbWUiLCJwYXJzZSIsImlzVXJsIiwiYWNxdWlyZSIsImlzRW1wdHkiLCJ0ZXN0IiwibWF4QWdlTWF0Y2giLCJleGVjIiwicGFyc2VJbnQiLCJkb3dubG9hZElzTmVhZGVkIiwibG9jYWxGaWxlIiwibG9ja0ZpbGUiLCJ3YWl0aW5nVGltZSIsIm1heEF0dGVtcHRzQ291bnQiLCJ1bmRlZmluZWQiLCJyZW1vdGVGaWxlTGVuZ3RoIiwiYXR0ZW1wdHNDb3VudCIsIlByb21pc2UiLCJyZXNvbHZlIiwic2V0VGltZW91dCIsInN0YXRzIiwic3RhdCIsImxvY2FsRmlsZUxlbmd0aCIsInNpemUiLCJ1bmxpbmsiLCJzaGFyZWRGb2xkZXJQYXRoIiwiY2xvc2UiLCJvcGVuIiwiY2FjaGVkUGF0aCIsImRlbCIsImZpbGVOYW1lIiwic2FuaXRpemVOYW1lIiwiZGVjb2RlVVJJQ29tcG9uZW50IiwicmVwbGFjZW1lbnQiLCJjdCIsInNvbWUiLCJtaW1lVHlwZSIsIlJlZ0V4cCIsImVzY2FwZVJlZ0V4cCIsIm1hdGNoIiwicmVzdWx0aW5nTmFtZSIsInN1YnN0cmluZyIsInJlc3VsdGluZ0V4dCIsImZpcnN0IiwidGFyZ2V0UGF0aCIsInRlbXBEaXIiLCJwcmVmaXgiLCJzdWZmaXgiLCJkb3dubG9hZEFwcCIsImNvcHlGaWxlIiwiZXJyb3JNZXNzYWdlIiwiYXJjaGl2ZVBhdGgiLCJoYXNoIiwidG1wUm9vdCIsIm9wZW5EaXIiLCJ1bnppcEFwcCIsImlzQWJzb2x1dGUiLCJjd2QiLCJCb29sZWFuIiwic2V0IiwiaHJlZiIsIm5ldCIsImRvd25sb2FkRmlsZSIsImVyciIsInppcFBhdGgiLCJkc3RSb290IiwiemlwIiwiYXNzZXJ0VmFsaWRaaXAiLCJ0aW1lciIsInRpbWluZyIsIlRpbWVyIiwic3RhcnQiLCJleHRyYWN0aW9uT3B0cyIsInVzZVN5c3RlbVVuemlwIiwiZmlsZU5hbWVzRW5jb2RpbmciLCJleHRyYWN0QWxsVG8iLCJnbG9iUGF0dGVybiIsImV4dCIsInJlcGxhY2UiLCJqb2luIiwic29ydGVkQnVuZGxlSXRlbXMiLCJnbG9iIiwic3RyaWN0Iiwic29ydCIsImEiLCJiIiwic3BsaXQiLCJzZXAiLCJlcnJvckFuZFRocm93IiwiTWF0aCIsInJvdW5kIiwiZ2V0RHVyYXRpb24iLCJhc01pbGxpU2Vjb25kcyIsIm1hdGNoZWRCdW5kbGUiLCJkc3RQYXRoIiwibXYiLCJta2RpcnAiLCJpc1BhY2thZ2VPckJ1bmRsZSIsImR1cGxpY2F0ZUtleXMiLCJpbnB1dCIsImZpcnN0S2V5Iiwic2Vjb25kS2V5IiwiaXRlbSIsImlzUGxhaW5PYmplY3QiLCJyZXN1bHRPYmoiLCJrZXkiLCJ2YWx1ZSIsInRvUGFpcnMiLCJyZWN1cnNpdmVseUNhbGxlZFZhbHVlIiwicGFyc2VDYXBzQXJyYXkiLCJjYXAiLCJwYXJzZWRDYXBzIiwiSlNPTiIsImlnbiJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7QUFBQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFFQSxNQUFNQSxPQUFPLEdBQUcsTUFBaEI7QUFDQSxNQUFNQyxRQUFRLEdBQUcsQ0FBQyxNQUFELEVBQVNELE9BQVQsQ0FBakI7QUFDQSxNQUFNRSxjQUFjLEdBQUcsQ0FDckIsaUJBRHFCLEVBRXJCLDhCQUZxQixFQUdyQixpQkFIcUIsQ0FBdkI7QUFLQSxNQUFNQyxtQkFBbUIsR0FBRyxPQUFPLEVBQVAsR0FBWSxFQUFaLEdBQWlCLEVBQTdDO0FBQ0EsTUFBTUMsa0JBQWtCLEdBQUcsSUFBSUMsaUJBQUosQ0FBUTtBQUNqQ0MsRUFBQUEsTUFBTSxFQUFFSCxtQkFEeUI7QUFFakNJLEVBQUFBLGNBQWMsRUFBRSxJQUZpQjtBQUdqQ0MsRUFBQUEsT0FBTyxFQUFFLE9BQU9DLEdBQVAsRUFBWTtBQUFDQyxJQUFBQTtBQUFELEdBQVosS0FBMkI7QUFDbEMsUUFBSSxFQUFDLE1BQU1DLGtCQUFH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QjtBQUM1QkcsUUFBQUEsU0FBUyxDQUFDSixRQUFELENBQVQsR0FBc0JRLHNCQUF0QjtBQUNEOztBQUNESixNQUFBQSxTQUFTLENBQUNDLEdBQUQsQ0FBVCxHQUFpQkcsc0JBQWpCO0FBQ0Q7O0FBQ0QsV0FBT0osU0FBUDtBQUNEOztBQUdELFNBQU9MLEtBQVA7QUFDRDs7QUFRRCxTQUFTVSxjQUFULENBQXlCQyxHQUF6QixFQUE4QjtBQUM1QixNQUFJdkgsZ0JBQUVFLE9BQUYsQ0FBVXFILEdBQVYsQ0FBSixFQUFvQjtBQUNsQixXQUFPQSxHQUFQO0FBQ0Q7O0FBRUQsTUFBSUMsVUFBSjs7QUFDQSxNQUFJO0FBQ0ZBLElBQUFBLFVBQVUsR0FBR0MsSUFBSSxDQUFDL0csS0FBTCxDQUFXNkcsR0FBWCxDQUFiOztBQUNBLFFBQUl2SCxnQkFBRUUsT0FBRixDQUFVc0gsVUFBVixDQUFKLEVBQTJCO0FBQ3pCLGFBQU9BLFVBQVA7QUFDRDtBQUNGLEdBTEQsQ0FLRSxPQUFPRSxHQUFQLEVBQVk7QUFDWi9LLG9CQUFPc0IsSUFBUCxDQUFhLDBDQUFiO0FBQ0Q7O0FBQ0QsTUFBSStCLGdCQUFFQyxRQUFGLENBQVdzSCxHQUFYLENBQUosRUFBcUI7QUFDbkIsV0FBTyxDQUFDQSxHQUFELENBQVA7QUFDRDs7QUFDRCxRQUFNLElBQUl6SCxLQUFKLENBQVcsaURBQWdEeUgsR0FBSSxFQUEvRCxDQUFOO0FBQ0QiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgXyBmcm9tICdsb2Rhc2gnO1xyXG5pbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcclxuaW1wb3J0IHVybCBmcm9tICd1cmwnO1xyXG5pbXBvcnQgbG9nZ2VyIGZyb20gJy4vbG9nZ2VyJztcclxuaW1wb3J0IHsgdGVtcERpciwgZnMsIHV0aWwsIHppcCwgbmV0LCB0aW1pbmcgfSBmcm9tICdhcHBpdW0tc3VwcG9ydCc7XHJcbmltcG9ydCBMUlUgZnJvbSAnbHJ1LWNhY2hlJztcclxuaW1wb3J0IEFzeW5jTG9jayBmcm9tICdhc3luYy1sb2NrJztcclxuaW1wb3J0IGF4aW9zIGZyb20gJ2F4aW9zJztcclxuaW1wb3J0IHsgZ2V0TG9jYWxBcHBzRm9sZGVyLCBnZXRTaGFyZWRGb2xkZXJGb3JBcHBVcmwsIGdldExvY2FsRmlsZUZvckFwcFVybCwgZ2V0RmlsZUNvbnRlbnRMZW5ndGggfSBmcm9tICcuL21jbG91ZC11dGlscyc7XHJcblxyXG5jb25zdCBJUEFfRVhUID0gJy5pcGEnO1xyXG5jb25zdCBaSVBfRVhUUyA9IFsnLnppcCcsIElQQV9FWFRdO1xyXG5jb25zdCBaSVBfTUlNRV9UWVBFUyA9IFtcclxuICAnYXBwbGljYXRpb24vemlwJyxcclxuICAnYXBwbGljYXRpb24veC16aXAtY29tcHJlc3NlZCcsXHJcbiAgJ211bHRpcGFydC94LXppcCcsXHJcbl07XHJcbmNvbnN0IENBQ0hFRF9BUFBTX01BWF9BR0UgPSAxMDAwICogNjAgKiA2MCAqIDI0OyAvLyBtc1xyXG5jb25zdCBBUFBMSUNBVElPTlNfQ0FDSEUgPSBuZXcgTFJVKHtcclxuICBtYXhBZ2U6IENBQ0hFRF9BUFBTX01BWF9BR0UsIC8vIGV4cGlyZSBhZnRlciAyNCBob3Vyc1xyXG4gIHVwZGF0ZUFnZU9uR2V0OiB0cnVlLFxyXG4gIGRpc3Bvc2U6IGFzeW5jIChhcHAsIHtmdWxsUGF0aH0pID0+IHtcclxuICAgIGlmICghYXdhaXQgZnMuZXhpc3RzKGZ1bGxQYXRoKSkge1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgbG9nZ2VyLmluZm8oYFRoZSBhcHBsaWNhdGlvbiAnJHthcHB9JyBjYWNoZWQgYXQgJyR7ZnVsbFBhdGh9JyBoYXMgZXhwaXJlZGApO1xyXG4gICAgYXdhaXQgZnMucmltcmFmKGZ1bGxQYXRoKTtcclxuICB9LFxyXG4gIG5vRGlzcG9zZU9uU2V0OiB0cnVlLFxyXG59KTtcclxuY29uc3QgQVBQTElDQVRJT05TX0NBQ0hFX0dVQVJEID0gbmV3IEFzeW5jTG9jaygpO1xyXG5jb25zdCBTQU5JVElaRV9SRVBMQUNFTUVOVCA9ICctJztcclxuY29uc3QgREVGQVVMVF9CQVNFTkFNRSA9ICdhcHBpdW0tYXBwJztcclxuY29uc3QgQVBQX0RPV05MT0FEX1RJTUVPVVRfTVMgPSAxMjAgKiAxMDAwO1xyXG5cclxucHJvY2Vzcy5vbignZXhpdCcsICgpID0+IHtcclxuICBpZiAoQVBQTElDQVRJT05TX0NBQ0hFLml0ZW1Db3VudCA9PT0gMCkge1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuXHJcbiAgY29uc3QgYXBwUGF0aHMgPSBBUFBMSUNBVElPTlNfQ0FDSEUudmFsdWVzKClcclxuICAgIC5tYXAoKHtmdWxsUGF0aH0pID0+IGZ1bGxQYXRoKTtcclxuICBsb2dnZXIuZGVidWcoYFBlcmZvcm1pbmcgY2xlYW51cCBvZiAke2FwcFBhdGhzLmxlbmd0aH0gY2FjaGVkIGAgK1xyXG4gICAgdXRpbC5wbHVyYWxpemUoJ2FwcGxpY2F0aW9uJywgYXBwUGF0aHMubGVuZ3RoKSk7XHJcbiAgZm9yIChjb25zdCBhcHBQYXRoIG9mIGFwcFBhdGhzKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICAvLyBBc3luY2hyb25vdXMgY2FsbHMgYXJlIG5vdCBzdXBwb3J0ZWQgaW4gb25FeGl0IGhhbmRsZXJcclxuICAgICAgZnMucmltcmFmU3luYyhhcHBQYXRoKTtcclxuICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgbG9nZ2VyLndhcm4oZS5tZXNzYWdlKTtcclxuICAgIH1cclxuICB9XHJcbn0pO1xyXG5cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIHJldHJpZXZlSGVhZGVycyAobGluaykge1xyXG4gIHRyeSB7XHJcbiAgICByZXR1cm4gKGF3YWl0IGF4aW9zKHtcclxuICAgICAgdXJsOiBsaW5rLFxyXG4gICAgICBtZXRob2Q6ICdIRUFEJyxcclxuICAgICAgdGltZW91dDogNTAwMCxcclxuICAgIH0pKS5oZWFkZXJzO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGxvZ2dlci5pbmZvKGBDYW5ub3Qgc2VuZCBIRUFEIHJlcXVlc3QgdG8gJyR7bGlua30nLiBPcmlnaW5hbCBlcnJvcjogJHtlLm1lc3NhZ2V9YCk7XHJcbiAgfVxyXG4gIHJldHVybiB7fTtcclxufVxyXG5cclxuZnVuY3Rpb24gZ2V0Q2FjaGVkQXBwbGljYXRpb25QYXRoIChsaW5rLCBjdXJyZW50QXBwUHJvcHMgPSB7fSkge1xyXG4gIGNvbnN0IHJlZnJlc2ggPSAoKSA9PiB7XHJcbiAgICBsb2dnZXIuaW5mbyhgQ1VTVE9NIEhFTFBFUiFgKTtcclxuICAgIGxvZ2dlci5kZWJ1ZyhgQSBmcmVzaCBjb3B5IG9mIHRoZSBhcHBsaWNhdGlvbiBpcyBnb2luZyB0byBiZSBkb3dubG9hZGVkIGZyb20gJHtsaW5rfWApO1xyXG4gICAgcmV0dXJuIG51bGw7XHJcbiAgfTtcclxuXHJcbiAgaWYgKEFQUExJQ0FUSU9OU19DQUNIRS5oYXMobGluaykpIHtcclxuICAgIGNvbnN0IHtcclxuICAgICAgbGFzdE1vZGlmaWVkOiBjdXJyZW50TW9kaWZpZWQsXHJcbiAgICAgIGltbXV0YWJsZTogY3VycmVudEltbXV0YWJsZSxcclxuICAgICAgLy8gbWF4QWdlIGlzIGluIHNlY29uZHNcclxuICAgICAgbWF4QWdlOiBjdXJyZW50TWF4QWdlLFxyXG4gICAgfSA9IGN1cnJlbnRBcHBQcm9wcztcclxuICAgIGNvbnN0IHtcclxuICAgICAgLy8gRGF0ZSBpbnN0YW5jZVxyXG4gICAgICBsYXN0TW9kaWZpZWQsXHJcbiAgICAgIC8vIGJvb2xlYW5cclxuICAgICAgaW1tdXRhYmxlLFxyXG4gICAgICAvLyBVbml4IHRpbWUgaW4gbWlsbGlzZWNvbmRzXHJcbiAgICAgIHRpbWVzdGFtcCxcclxuICAgICAgZnVsbFBhdGgsXHJcbiAgICB9ID0gQVBQTElDQVRJT05TX0NBQ0hFLmdldChsaW5rKTtcclxuICAgIGlmIChsYXN0TW9kaWZpZWQgJiYgY3VycmVudE1vZGlmaWVkKSB7XHJcbiAgICAgIGlmIChjdXJyZW50TW9kaWZpZWQuZ2V0VGltZSgpIDw9IGxhc3RNb2RpZmllZC5nZXRUaW1lKCkpIHtcclxuICAgICAgICBsb2dnZXIuZGVidWcoYFRoZSBhcHBsaWNhdGlvbiBhdCAke2xpbmt9IGhhcyBub3QgYmVlbiBtb2RpZmllZCBzaW5jZSAke2xhc3RNb2RpZmllZH1gKTtcclxuICAgICAgICByZXR1cm4gZnVsbFBhdGg7XHJcbiAgICAgIH1cclxuICAgICAgbG9nZ2VyLmRlYnVnKGBUaGUgYXBwbGljYXRpb24gYXQgJHtsaW5rfSBoYXMgYmVlbiBtb2RpZmllZCBzaW5jZSAke2xhc3RNb2RpZmllZH1gKTtcclxuICAgICAgcmV0dXJuIHJlZnJlc2goKTtcclxuICAgIH1cclxuICAgIGlmIChpbW11dGFibGUgJiYgY3VycmVudEltbXV0YWJsZSkge1xyXG4gICAgICBsb2dnZXIuZGVidWcoYFRoZSBhcHBsaWNhdGlvbiBhdCAke2xpbmt9IGlzIGltbXV0YWJsZWApO1xyXG4gICAgICByZXR1cm4gZnVsbFBhdGg7XHJcbiAgICB9XHJcbiAgICBpZiAoY3VycmVudE1heEFnZSAmJiB0aW1lc3RhbXApIHtcclxuICAgICAgY29uc3QgbXNMZWZ0ID0gdGltZXN0YW1wICsgY3VycmVudE1heEFnZSAqIDEwMDAgLSBEYXRlLm5vdygpO1xyXG4gICAgICBpZiAobXNMZWZ0ID4gMCkge1xyXG4gICAgICAgIGxvZ2dlci5kZWJ1ZyhgVGhlIGNhY2hlZCBhcHBsaWNhdGlvbiAnJHtwYXRoLmJhc2VuYW1lKGZ1bGxQYXRoKX0nIHdpbGwgZXhwaXJlIGluICR7bXNMZWZ0IC8gMTAwMH1zYCk7XHJcbiAgICAgICAgcmV0dXJuIGZ1bGxQYXRoO1xyXG4gICAgICB9XHJcbiAgICAgIGxvZ2dlci5kZWJ1ZyhgVGhlIGNhY2hlZCBhcHBsaWNhdGlvbiAnJHtwYXRoLmJhc2VuYW1lKGZ1bGxQYXRoKX0nIGhhcyBleHBpcmVkYCk7XHJcbiAgICB9XHJcbiAgfVxyXG4gIHJldHVybiByZWZyZXNoKCk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHZlcmlmeUFwcEV4dGVuc2lvbiAoYXBwLCBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zKSB7XHJcbiAgaWYgKHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMuaW5jbHVkZXMocGF0aC5leHRuYW1lKGFwcCkpKSB7XHJcbiAgICByZXR1cm4gYXBwO1xyXG4gIH1cclxuICB0aHJvdyBuZXcgRXJyb3IoYE5ldyBhcHAgcGF0aCAnJHthcHB9JyBkaWQgbm90IGhhdmUgYCArXHJcbiAgICBgJHt1dGlsLnBsdXJhbGl6ZSgnZXh0ZW5zaW9uJywgc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucy5sZW5ndGgsIGZhbHNlKX06IGAgK1xyXG4gICAgc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucyk7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGNvbmZpZ3VyZUFwcCAoYXBwLCBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zKSB7XHJcbiAgaWYgKCFfLmlzU3RyaW5nKGFwcCkpIHtcclxuICAgIC8vIGltbWVkaWF0ZWx5IHNob3J0Y2lyY3VpdCBpZiBub3QgZ2l2ZW4gYW4gYXBwXHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGlmICghXy5pc0FycmF5KHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMpKSB7XHJcbiAgICBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zID0gW3N1cHBvcnRlZEFwcEV4dGVuc2lvbnNdO1xyXG4gIH1cclxuXHJcbiAgbGV0IG5ld0FwcCA9IGFwcDtcclxuICBsZXQgc2hvdWxkVW56aXBBcHAgPSBmYWxzZTtcclxuICBsZXQgYXJjaGl2ZUhhc2ggPSBudWxsO1xyXG4gIGxldCBsb2NhbEFwcHNGb2xkZXI7XHJcbiAgY29uc3QgcmVtb3RlQXBwUHJvcHMgPSB7XHJcbiAgICBsYXN0TW9kaWZpZWQ6IG51bGwsXHJcbiAgICBpbW11dGFibGU6IGZhbHNlLFxyXG4gICAgbWF4QWdlOiBudWxsLFxyXG4gIH07XHJcbiAgY29uc3Qge3Byb3RvY29sLCBwYXRobmFtZX0gPSB1cmwucGFyc2UobmV3QXBwKTtcclxuICBjb25zdCBpc1VybCA9IFsnaHR0cDonLCAnaHR0cHM6J10uaW5jbHVkZXMocHJvdG9jb2wpO1xyXG5cclxuICByZXR1cm4gYXdhaXQgQVBQTElDQVRJT05TX0NBQ0hFX0dVQVJELmFjcXVpcmUoYXBwLCBhc3luYyAoKSA9PiB7XHJcbiAgICBpZiAoaXNVcmwpIHtcclxuICAgICAgLy8gVXNlIHRoZSBhcHAgZnJvbSByZW1vdGUgVVJMXHJcbiAgICAgIGxvZ2dlci5pbmZvKGBVc2luZyBkb3dubG9hZGFibGUgYXBwICcke25ld0FwcH0nYCk7XHJcbiAgICAgIGNvbnN0IGhlYWRlcnMgPSBhd2FpdCByZXRyaWV2ZUhlYWRlcnMobmV3QXBwKTtcclxuICAgICAgaWYgKCFfLmlzRW1wdHkoaGVhZGVycykpIHtcclxuICAgICAgICBpZiAoaGVhZGVyc1snbGFzdC1tb2RpZmllZCddKSB7XHJcbiAgICAgICAgICByZW1vdGVBcHBQcm9wcy5sYXN0TW9kaWZpZWQgPSBuZXcgRGF0ZShoZWFkZXJzWydsYXN0LW1vZGlmaWVkJ10pO1xyXG4gICAgICAgIH1cclxuICAgICAgICBsb2dnZXIuZGVidWcoYExhc3QtTW9kaWZpZWQ6ICR7aGVhZGVyc1snbGFzdC1tb2RpZmllZCddfWApO1xyXG4gICAgICAgIGlmIChoZWFkZXJzWydjYWNoZS1jb250cm9sJ10pIHtcclxuICAgICAgICAgIHJlbW90ZUFwcFByb3BzLmltbXV0YWJsZSA9IC9cXGJpbW11dGFibGVcXGIvaS50ZXN0KGhlYWRlcnNbJ2NhY2hlLWNvbnRyb2wnXSk7XHJcbiAgICAgICAgICBjb25zdCBtYXhBZ2VNYXRjaCA9IC9cXGJtYXgtYWdlPShcXGQrKVxcYi9pLmV4ZWMoaGVhZGVyc1snY2FjaGUtY29udHJvbCddKTtcclxuICAgICAgICAgIGlmIChtYXhBZ2VNYXRjaCkge1xyXG4gICAgICAgICAgICByZW1vdGVBcHBQcm9wcy5tYXhBZ2UgPSBwYXJzZUludChtYXhBZ2VNYXRjaFsxXSwgMTApO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICBsb2dnZXIuZGVidWcoYENhY2hlLUNvbnRyb2w6ICR7aGVhZGVyc1snY2FjaGUtY29udHJvbCddfWApO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyAqKioqKiBDdXN0b20gbG9naWMgZm9yIHZlcmlmaWNhdGlvbiBvZiBsb2NhbCBzdGF0aWMgcGF0aCBmb3IgQVBQcyAqKioqKlxyXG4gICAgICBsZXQgZG93bmxvYWRJc05lYWRlZCA9IHRydWU7XHJcbiAgICAgIGxvY2FsQXBwc0ZvbGRlciA9IGF3YWl0IGdldExvY2FsQXBwc0ZvbGRlcigpO1xyXG4gICAgICBsZXQgbG9jYWxGaWxlO1xyXG4gICAgICBsZXQgbG9ja0ZpbGU7XHJcbiAgICAgIGNvbnN0IHdhaXRpbmdUaW1lID0gNTAwMDtcclxuICAgICAgY29uc3QgbWF4QXR0ZW1wdHNDb3VudCA9IDUgKiAxMjtcclxuICAgICAgXHJcbiAgICAgIGlmKGxvY2FsQXBwc0ZvbGRlciAhPSB1bmRlZmluZWQpIHtcclxuICAgICAgICBsb2NhbEZpbGUgPSBhd2FpdCBnZXRMb2NhbEZpbGVGb3JBcHBVcmwobmV3QXBwKTtcclxuICAgICAgICBsb2NrRmlsZSA9IGxvY2FsRmlsZSArICcubG9jayc7XHJcblxyXG4gICAgICAgIGlmKGF3YWl0IGZzLmV4aXN0cyhsb2NhbEZpbGUpKSB7XHJcbiAgICAgICAgICBsb2dnZXIuaW5mbyhgTG9jYWwgdmVyc2lvbiBvZiBhcHAgd2FzIGZvdW5kLiBXaWxsIGNoZWNrIGFjdHVhbGl0eSBvZiB0aGUgZmlsZWApO1xyXG4gICAgICAgICAgLy8gQ2hlY2tpbmcgb2YgbG9jYWwgYXBwbGljYXRpb24gYWN0dWFsaXR5XHJcbiAgICAgICAgICBjb25zdCByZW1vdGVGaWxlTGVuZ3RoID0gYXdhaXQgZ2V0RmlsZUNvbnRlbnRMZW5ndGgoYXBwKTtcclxuICAgICAgICAgIC8vIEF0IHRoaXMgcG9pbnQgbG9jYWwgZmlsZSBtaWdodCBiZSBkZWxldGVkIGJ5IHBhcmFsbGVsIHNlc3Npb24gd2hpY2ggdXBkYXRlcyBvdXRkYXRlZCBhcHBcclxuICAgICAgICAgIGxldCBhdHRlbXB0c0NvdW50ID0gMDtcclxuICAgICAgICAgIHdoaWxlKCFhd2FpdCBmcy5leGlzdHMobG9jYWxGaWxlKSAmJiAoYXR0ZW1wdHNDb3VudCsrIDwgbWF4QXR0ZW1wdHNDb3VudCkpIHtcclxuICAgICAgICAgICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcclxuICAgICAgICAgICAgICBsb2dnZXIuaW5mbyhgQXR0ZW1wdCAjJHthdHRlbXB0c0NvdW50fSBmb3IgbG9jYWwgYXBwIGZpbGUgdG8gYXBwZWFyIGFnYWluYCk7XHJcbiAgICAgICAgICAgICAgc2V0VGltZW91dChyZXNvbHZlLCB3YWl0aW5nVGltZSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgaWYoIWF3YWl0IGZzLmV4aXN0cyhsb2NhbEZpbGUpKSB7XHJcbiAgICAgICAgICAgIHRocm93IEVycm9yKGBMb2NhbCBhcHBsaWNhdGlvbiBmaWxlIGhhcyBub3QgYXBwZWFyZWQgYWZ0ZXIgdXBkYXRpbmcgYnkgcGFyYWxsZWwgQXBwaXVtIHNlc3Npb25gKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIGNvbnN0IHN0YXRzID0gYXdhaXQgZnMuc3RhdChsb2NhbEZpbGUpO1xyXG4gICAgICAgICAgY29uc3QgbG9jYWxGaWxlTGVuZ3RoID0gc3RhdHMuc2l6ZTtcclxuICAgICAgICAgIGxvZ2dlci5pbmZvKGBSZW1vdGUgZmlsZSBzaXplIGlzICR7cmVtb3RlRmlsZUxlbmd0aH0gYW5kIGxvY2FsIGZpbGUgc2l6ZSBpcyAke2xvY2FsRmlsZUxlbmd0aH1gKTtcclxuICAgICAgICAgIGlmKHJlbW90ZUZpbGVMZW5ndGggIT0gbG9jYWxGaWxlTGVuZ3RoKSB7XHJcbiAgICAgICAgICAgIGxvZ2dlci5pbmZvKGBTaXplcyBkaWZmZXIuIEhlbmNlIHRoYXQncyBuZWVkZWQgdG8gZG93bmxvYWQgZnJlc2ggdmVyc2lvbiBvZiB0aGUgYXBwYCk7XHJcbiAgICAgICAgICAgIGF3YWl0IGZzLnVubGluayhsb2NhbEZpbGUpO1xyXG4gICAgICAgICAgICBkb3dubG9hZElzTmVhZGVkID0gdHJ1ZTtcclxuICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIGxvZ2dlci5pbmZvKGBTaXplcyBhcmUgdGhlIHNhbWUuIEhlbmNlIHdpbGwgdXNlIGFscmVhZHkgc3RvcmVkIGFwcGxpY2F0aW9uIGZvciB0aGUgc2Vzc2lvbmApO1xyXG4gICAgICAgICAgICBuZXdBcHAgPSBsb2NhbEZpbGU7XHJcbiAgICAgICAgICAgIHNob3VsZFVuemlwQXBwID0gWklQX0VYVFMuaW5jbHVkZXMocGF0aC5leHRuYW1lKG5ld0FwcCkpO1xyXG4gICAgICAgICAgICBkb3dubG9hZElzTmVhZGVkID0gZmFsc2U7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfSBlbHNlIGlmIChhd2FpdCBmcy5leGlzdHMobG9ja0ZpbGUpKSB7XHJcbiAgICAgICAgICBsb2dnZXIuaW5mbyhgTG9jYWwgdmVyc2lvbiBvZiBhcHAgbm90IGZvdW5kIGJ1dCAubG9jayBmaWxlIGV4aXN0cy4gV2FpdGluZyBmb3IgLmxvY2sgdG8gZGlzYXBwZWFyYCk7XHJcbiAgICAgICAgICAvLyBXYWl0IGZvciBzb21lIHRpbWUgdGlsbCBBcHAgaXMgZG93bmxvYWRlZCBieSBzb21lIHBhcmFsbGVsIEFwcGl1bSBpbnN0YW5jZVxyXG4gICAgICAgICAgbGV0IGF0dGVtcHRzQ291bnQgPSAwO1xyXG4gICAgICAgICAgd2hpbGUoYXdhaXQgZnMuZXhpc3RzKGxvY2tGaWxlKSAmJiAoYXR0ZW1wdHNDb3VudCsrIDwgbWF4QXR0ZW1wdHNDb3VudCkpIHtcclxuICAgICAgICAgICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcclxuICAgICAgICAgICAgICBsb2dnZXIuaW5mbyhgQXR0ZW1wdCAjJHthdHRlbXB0c0NvdW50fSBmb3IgLmxvY2sgZmlsZSBjaGVja2luZ2ApO1xyXG4gICAgICAgICAgICAgIHNldFRpbWVvdXQocmVzb2x2ZSwgd2FpdGluZ1RpbWUpO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIGlmKGF3YWl0IGZzLmV4aXN0cyhsb2NrRmlsZSkpIHtcclxuICAgICAgICAgICAgdGhyb3cgRXJyb3IoYC5sb2NrIGZpbGUgZm9yIGRvd25sb2FkaW5nIGFwcGxpY2F0aW9uIGhhcyBub3QgZGlzYXBwZWFyZWQgYWZ0ZXIgJHt3YWl0aW5nVGltZSAqIG1heEF0dGVtcHRzQ291bnR9bXNgKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIGlmKCFhd2FpdCBmcy5leGlzdHMobG9jYWxGaWxlKSkge1xyXG4gICAgICAgICAgICB0aHJvdyBFcnJvcihgTG9jYWwgYXBwbGljYXRpb24gZmlsZSBoYXMgbm90IGFwcGVhcmVkIGFmdGVyIC5sb2NrIGZpbGUgcmVtb3ZhbGApO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgbG9nZ2VyLmluZm8oYExvY2FsIHZlcnNpb24gb2YgYXBwIHdhcyBmb3VuZCBhZnRlciAubG9jayBmaWxlIHJlbW92YWwuIFdpbGwgdXNlIGl0IGZvciBuZXcgc2Vzc2lvbmApO1xyXG4gICAgICAgICAgbmV3QXBwID0gbG9jYWxGaWxlO1xyXG4gICAgICAgICAgc2hvdWxkVW56aXBBcHAgPSBaSVBfRVhUUy5pbmNsdWRlcyhwYXRoLmV4dG5hbWUobmV3QXBwKSk7XHJcbiAgICAgICAgICBkb3dubG9hZElzTmVhZGVkID0gZmFsc2U7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgIGxvZ2dlci5pbmZvKGBOZWl0aGVyIGxvY2FsIHZlcnNpb24gb2YgYXBwIG5vciAubG9jayBmaWxlIHdhcyBmb3VuZC4gV2lsbCBkb3dubG9hZCBhcHAgZnJvbSByZW1vdGUgVVJMLmApO1xyXG4gICAgICAgICAgZG93bmxvYWRJc05lYWRlZCA9IHRydWU7XHJcbiAgICAgICAgfVxyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIGxvZ2dlci5pbmZvKGBMb2NhbCBhcHBzIGZvbGRlciBpcyBub3QgZGVmaW5lZCB2aWEgZW52aXJvbm1lbnQgcHJvcGVydGllcywgaGVuY2Ugc2tpcHBpbmcgdGhpcyBsb2dpY2ApO1xyXG4gICAgICB9XHJcbiAgICAgIGlmKGRvd25sb2FkSXNOZWFkZWQpIHtcclxuICAgICAgXHJcbiAgICAgICAgaWYobG9jYWxBcHBzRm9sZGVyICE9IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgbG9nZ2VyLmluZm8oYExvY2FsIHZlcnNpb24gb2YgYXBwIHdhcyBub3QgZm91bmQuIEhlbmNlIHVzaW5nIGRlZmF1bHQgQXBwaXVtIGxvZ2ljIGZvciBkb3dubG9hZGluZ2ApO1xyXG4gICAgICAgICAgY29uc3Qgc2hhcmVkRm9sZGVyUGF0aCA9IGF3YWl0IGdldFNoYXJlZEZvbGRlckZvckFwcFVybChhcHApO1xyXG4gICAgICAgICAgbG9nZ2VyLmluZm8oYEZvbGRlciBmb3IgbG9jYWwgc2hhcmVkIGFwcHM6ICR7c2hhcmVkRm9sZGVyUGF0aH1gKTtcclxuICAgICAgICAgIGF3YWl0IGZzLmNsb3NlKGF3YWl0IGZzLm9wZW4obG9ja0ZpbGUsICd3JykpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgY29uc3QgY2FjaGVkUGF0aCA9IGdldENhY2hlZEFwcGxpY2F0aW9uUGF0aChhcHAsIHJlbW90ZUFwcFByb3BzKTtcclxuICAgICAgaWYgKGNhY2hlZFBhdGgpIHtcclxuICAgICAgICBpZiAoYXdhaXQgZnMuZXhpc3RzKGNhY2hlZFBhdGgpKSB7XHJcbiAgICAgICAgICBsb2dnZXIuaW5mbyhgUmV1c2luZyBwcmV2aW91c2x5IGRvd25sb2FkZWQgYXBwbGljYXRpb24gYXQgJyR7Y2FjaGVkUGF0aH0nYCk7XHJcbiAgICAgICAgICByZXR1cm4gdmVyaWZ5QXBwRXh0ZW5zaW9uKGNhY2hlZFBhdGgsIHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBsb2dnZXIuaW5mbyhgVGhlIGFwcGxpY2F0aW9uIGF0ICcke2NhY2hlZFBhdGh9JyBkb2VzIG5vdCBleGlzdCBhbnltb3JlLiBEZWxldGluZyBpdCBmcm9tIHRoZSBjYWNoZWApO1xyXG4gICAgICAgIEFQUExJQ0FUSU9OU19DQUNIRS5kZWwoYXBwKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgbGV0IGZpbGVOYW1lID0gbnVsbDtcclxuICAgICAgY29uc3QgYmFzZW5hbWUgPSBmcy5zYW5pdGl6ZU5hbWUocGF0aC5iYXNlbmFtZShkZWNvZGVVUklDb21wb25lbnQocGF0aG5hbWUpKSwge1xyXG4gICAgICAgIHJlcGxhY2VtZW50OiBTQU5JVElaRV9SRVBMQUNFTUVOVFxyXG4gICAgICB9KTtcclxuICAgICAgY29uc3QgZXh0bmFtZSA9IHBhdGguZXh0bmFtZShiYXNlbmFtZSk7XHJcbiAgICAgIC8vIHRvIGRldGVybWluZSBpZiB3ZSBuZWVkIHRvIHVuemlwIHRoZSBhcHAsIHdlIGhhdmUgYSBudW1iZXIgb2YgcGxhY2VzXHJcbiAgICAgIC8vIHRvIGxvb2s6IGNvbnRlbnQgdHlwZSwgY29udGVudCBkaXNwb3NpdGlvbiwgb3IgdGhlIGZpbGUgZXh0ZW5zaW9uXHJcbiAgICAgIGlmIChaSVBfRVhUUy5pbmNsdWRlcyhleHRuYW1lKSkge1xyXG4gICAgICAgIGZpbGVOYW1lID0gYmFzZW5hbWU7XHJcbiAgICAgICAgc2hvdWxkVW56aXBBcHAgPSB0cnVlO1xyXG4gICAgICB9XHJcbiAgICAgIGlmIChoZWFkZXJzWydjb250ZW50LXR5cGUnXSkge1xyXG4gICAgICAgIGNvbnN0IGN0ID0gaGVhZGVyc1snY29udGVudC10eXBlJ107XHJcbiAgICAgICAgbG9nZ2VyLmRlYnVnKGBDb250ZW50LVR5cGU6ICR7Y3R9YCk7XHJcbiAgICAgICAgLy8gdGhlIGZpbGV0eXBlIG1heSBub3QgYmUgb2J2aW91cyBmb3IgY2VydGFpbiB1cmxzLCBzbyBjaGVjayB0aGUgbWltZSB0eXBlIHRvb1xyXG4gICAgICAgIGlmIChaSVBfTUlNRV9UWVBFUy5zb21lKChtaW1lVHlwZSkgPT4gbmV3IFJlZ0V4cChgXFxcXGIke18uZXNjYXBlUmVnRXhwKG1pbWVUeXBlKX1cXFxcYmApLnRlc3QoY3QpKSkge1xyXG4gICAgICAgICAgaWYgKCFmaWxlTmFtZSkge1xyXG4gICAgICAgICAgICBmaWxlTmFtZSA9IGAke0RFRkFVTFRfQkFTRU5BTUV9LnppcGA7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBzaG91bGRVbnppcEFwcCA9IHRydWU7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIGlmIChoZWFkZXJzWydjb250ZW50LWRpc3Bvc2l0aW9uJ10gJiYgL15hdHRhY2htZW50L2kudGVzdChoZWFkZXJzWydjb250ZW50LWRpc3Bvc2l0aW9uJ10pKSB7XHJcbiAgICAgICAgbG9nZ2VyLmRlYnVnKGBDb250ZW50LURpc3Bvc2l0aW9uOiAke2hlYWRlcnNbJ2NvbnRlbnQtZGlzcG9zaXRpb24nXX1gKTtcclxuICAgICAgICBjb25zdCBtYXRjaCA9IC9maWxlbmFtZT1cIihbXlwiXSspL2kuZXhlYyhoZWFkZXJzWydjb250ZW50LWRpc3Bvc2l0aW9uJ10pO1xyXG4gICAgICAgIGlmIChtYXRjaCkge1xyXG4gICAgICAgICAgZmlsZU5hbWUgPSBmcy5zYW5pdGl6ZU5hbWUobWF0Y2hbMV0sIHtcclxuICAgICAgICAgICAgcmVwbGFjZW1lbnQ6IFNBTklUSVpFX1JFUExBQ0VNRU5UXHJcbiAgICAgICAgICB9KTtcclxuICAgICAgICAgIHNob3VsZFVuemlwQXBwID0gc2hvdWxkVW56aXBBcHAgfHwgWklQX0VYVFMuaW5jbHVkZXMocGF0aC5leHRuYW1lKGZpbGVOYW1lKSk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIGlmICghZmlsZU5hbWUpIHtcclxuICAgICAgICAvLyBhc3NpZ24gdGhlIGRlZmF1bHQgZmlsZSBuYW1lIGFuZCB0aGUgZXh0ZW5zaW9uIGlmIG5vbmUgaGFzIGJlZW4gZGV0ZWN0ZWRcclxuICAgICAgICBjb25zdCByZXN1bHRpbmdOYW1lID0gYmFzZW5hbWVcclxuICAgICAgICAgID8gYmFzZW5hbWUuc3Vic3RyaW5nKDAsIGJhc2VuYW1lLmxlbmd0aCAtIGV4dG5hbWUubGVuZ3RoKVxyXG4gICAgICAgICAgOiBERUZBVUxUX0JBU0VOQU1FO1xyXG4gICAgICAgIGxldCByZXN1bHRpbmdFeHQgPSBleHRuYW1lO1xyXG4gICAgICAgIGlmICghc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucy5pbmNsdWRlcyhyZXN1bHRpbmdFeHQpKSB7XHJcbiAgICAgICAgICBsb2dnZXIuaW5mbyhgVGhlIGN1cnJlbnQgZmlsZSBleHRlbnNpb24gJyR7cmVzdWx0aW5nRXh0fScgaXMgbm90IHN1cHBvcnRlZC4gYCArXHJcbiAgICAgICAgICAgIGBEZWZhdWx0aW5nIHRvICcke18uZmlyc3Qoc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucyl9J2ApO1xyXG4gICAgICAgICAgcmVzdWx0aW5nRXh0ID0gXy5maXJzdChzdXBwb3J0ZWRBcHBFeHRlbnNpb25zKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgZmlsZU5hbWUgPSBgJHtyZXN1bHRpbmdOYW1lfSR7cmVzdWx0aW5nRXh0fWA7XHJcbiAgICAgIH1cclxuICAgICAgY29uc3QgdGFyZ2V0UGF0aCA9IGF3YWl0IHRlbXBEaXIucGF0aCh7XHJcbiAgICAgICAgcHJlZml4OiBmaWxlTmFtZSxcclxuICAgICAgICBzdWZmaXg6ICcnLFxyXG4gICAgICB9KTtcclxuICAgICAgbmV3QXBwID0gYXdhaXQgZG93bmxvYWRBcHAobmV3QXBwLCB0YXJnZXRQYXRoKTtcclxuXHJcbiAgICAgIC8vICoqKioqIEN1c3RvbSBsb2dpYyBmb3IgY29weWluZyBvZiBkb3dubG9hZGVkIGFwcCB0byBzdGF0aWMgbG9jYXRpb24gKioqKipcclxuICAgICAgaWYobG9jYWxBcHBzRm9sZGVyICE9IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIGxvZ2dlci5pbmZvKGBOZXcgYXBwIHBhdGg6ICR7bmV3QXBwfWApO1xyXG4gICAgICAgIGF3YWl0IGZzLmNvcHlGaWxlKG5ld0FwcCwgbG9jYWxGaWxlKTtcclxuICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIGZpbmFsbHkge1xyXG4gICAgICAgIGlmKGxvY2FsQXBwc0ZvbGRlciAhPSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgIGxvZ2dlci5pbmZvKGBHb2luZyB0byByZW1vdmUgbG9jayBmaWxlICR7bG9ja0ZpbGV9YClcclxuICAgICAgICAgIGF3YWl0IGZzLnVubGluayhsb2NrRmlsZSk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIH1cclxuICAgIH0gZWxzZSBpZiAoYXdhaXQgZnMuZXhpc3RzKG5ld0FwcCkpIHtcclxuICAgICAgLy8gVXNlIHRoZSBsb2NhbCBhcHBcclxuICAgICAgbG9nZ2VyLmluZm8oYFVzaW5nIGxvY2FsIGFwcCAnJHtuZXdBcHB9J2ApO1xyXG4gICAgICBzaG91bGRVbnppcEFwcCA9IFpJUF9FWFRTLmluY2x1ZGVzKHBhdGguZXh0bmFtZShuZXdBcHApKTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIGxldCBlcnJvck1lc3NhZ2UgPSBgVGhlIGFwcGxpY2F0aW9uIGF0ICcke25ld0FwcH0nIGRvZXMgbm90IGV4aXN0IG9yIGlzIG5vdCBhY2Nlc3NpYmxlYDtcclxuICAgICAgLy8gcHJvdG9jb2wgdmFsdWUgZm9yICdDOlxcXFx0ZW1wJyBpcyAnYzonLCBzbyB3ZSBjaGVjayB0aGUgbGVuZ3RoIGFzIHdlbGxcclxuICAgICAgaWYgKF8uaXNTdHJpbmcocHJvdG9jb2wpICYmIHByb3RvY29sLmxlbmd0aCA+IDIpIHtcclxuICAgICAgICBlcnJvck1lc3NhZ2UgPSBgVGhlIHByb3RvY29sICcke3Byb3RvY29sfScgdXNlZCBpbiAnJHtuZXdBcHB9JyBpcyBub3Qgc3VwcG9ydGVkLiBgICtcclxuICAgICAgICAgIGBPbmx5IGh0dHA6IGFuZCBodHRwczogcHJvdG9jb2xzIGFyZSBzdXBwb3J0ZWRgO1xyXG4gICAgICB9XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcihlcnJvck1lc3NhZ2UpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChzaG91bGRVbnppcEFwcCkge1xyXG4gICAgICBjb25zdCBhcmNoaXZlUGF0aCA9IG5ld0FwcDtcclxuICAgICAgYXJjaGl2ZUhhc2ggPSBhd2FpdCBmcy5oYXNoKGFyY2hpdmVQYXRoKTtcclxuICAgICAgaWYgKEFQUExJQ0FUSU9OU19DQUNIRS5oYXMoYXBwKSAmJiBhcmNoaXZlSGFzaCA9PT0gQVBQTElDQVRJT05TX0NBQ0hFLmdldChhcHApLmhhc2gpIHtcclxuICAgICAgICBjb25zdCB7ZnVsbFBhdGh9ID0gQVBQTElDQVRJT05TX0NBQ0hFLmdldChhcHApO1xyXG4gICAgICAgIGlmIChhd2FpdCBmcy5leGlzdHMoZnVsbFBhdGgpKSB7XHJcbiAgICAgICAgICBpZiAoYXJjaGl2ZVBhdGggIT09IGFwcCAmJiBsb2NhbEFwcHNGb2xkZXIgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICBhd2FpdCBmcy5yaW1yYWYoYXJjaGl2ZVBhdGgpO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgbG9nZ2VyLmluZm8oYFdpbGwgcmV1c2UgcHJldmlvdXNseSBjYWNoZWQgYXBwbGljYXRpb24gYXQgJyR7ZnVsbFBhdGh9J2ApO1xyXG4gICAgICAgICAgcmV0dXJuIHZlcmlmeUFwcEV4dGVuc2lvbihmdWxsUGF0aCwgc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGxvZ2dlci5pbmZvKGBUaGUgYXBwbGljYXRpb24gYXQgJyR7ZnVsbFBhdGh9JyBkb2VzIG5vdCBleGlzdCBhbnltb3JlLiBEZWxldGluZyBpdCBmcm9tIHRoZSBjYWNoZWApO1xyXG4gICAgICAgIEFQUExJQ0FUSU9OU19DQUNIRS5kZWwoYXBwKTtcclxuICAgICAgfVxyXG4gICAgICBjb25zdCB0bXBSb290ID0gYXdhaXQgdGVtcERpci5vcGVuRGlyKCk7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgbmV3QXBwID0gYXdhaXQgdW56aXBBcHAoYXJjaGl2ZVBhdGgsIHRtcFJvb3QsIHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMpO1xyXG4gICAgICB9IGZpbmFsbHkge1xyXG4gICAgICAgIGlmIChuZXdBcHAgIT09IGFyY2hpdmVQYXRoICYmIGFyY2hpdmVQYXRoICE9PSBhcHAgJiYgbG9jYWxBcHBzRm9sZGVyID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgIGF3YWl0IGZzLnJpbXJhZihhcmNoaXZlUGF0aCk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIGxvZ2dlci5pbmZvKGBVbnppcHBlZCBsb2NhbCBhcHAgdG8gJyR7bmV3QXBwfSdgKTtcclxuICAgIH0gZWxzZSBpZiAoIXBhdGguaXNBYnNvbHV0ZShuZXdBcHApKSB7XHJcbiAgICAgIG5ld0FwcCA9IHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpLCBuZXdBcHApO1xyXG4gICAgICBsb2dnZXIud2FybihgVGhlIGN1cnJlbnQgYXBwbGljYXRpb24gcGF0aCAnJHthcHB9JyBpcyBub3QgYWJzb2x1dGUgYCArXHJcbiAgICAgICAgYGFuZCBoYXMgYmVlbiByZXdyaXR0ZW4gdG8gJyR7bmV3QXBwfScuIENvbnNpZGVyIHVzaW5nIGFic29sdXRlIHBhdGhzIHJhdGhlciB0aGFuIHJlbGF0aXZlYCk7XHJcbiAgICAgIGFwcCA9IG5ld0FwcDtcclxuICAgIH1cclxuXHJcbiAgICB2ZXJpZnlBcHBFeHRlbnNpb24obmV3QXBwLCBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zKTtcclxuXHJcbiAgICBpZiAoYXBwICE9PSBuZXdBcHAgJiYgKGFyY2hpdmVIYXNoIHx8IF8udmFsdWVzKHJlbW90ZUFwcFByb3BzKS5zb21lKEJvb2xlYW4pKSkge1xyXG4gICAgICBpZiAoQVBQTElDQVRJT05TX0NBQ0hFLmhhcyhhcHApKSB7XHJcbiAgICAgICAgY29uc3Qge2Z1bGxQYXRofSA9IEFQUExJQ0FUSU9OU19DQUNIRS5nZXQoYXBwKTtcclxuICAgICAgICAvLyBDbGVhbiB1cCB0aGUgb2Jzb2xldGUgZW50cnkgZmlyc3QgaWYgbmVlZGVkXHJcbiAgICAgICAgaWYgKGZ1bGxQYXRoICE9PSBuZXdBcHAgJiYgYXdhaXQgZnMuZXhpc3RzKGZ1bGxQYXRoKSkge1xyXG4gICAgICAgICAgYXdhaXQgZnMucmltcmFmKGZ1bGxQYXRoKTtcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgICAgQVBQTElDQVRJT05TX0NBQ0hFLnNldChhcHAsIHtcclxuICAgICAgICAuLi5yZW1vdGVBcHBQcm9wcyxcclxuICAgICAgICB0aW1lc3RhbXA6IERhdGUubm93KCksXHJcbiAgICAgICAgaGFzaDogYXJjaGl2ZUhhc2gsXHJcbiAgICAgICAgZnVsbFBhdGg6IG5ld0FwcCxcclxuICAgICAgfSk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gbmV3QXBwO1xyXG4gIH0pO1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBkb3dubG9hZEFwcCAoYXBwLCB0YXJnZXRQYXRoKSB7XHJcbiAgY29uc3Qge2hyZWZ9ID0gdXJsLnBhcnNlKGFwcCk7XHJcbiAgdHJ5IHtcclxuICAgIGF3YWl0IG5ldC5kb3dubG9hZEZpbGUoaHJlZiwgdGFyZ2V0UGF0aCwge1xyXG4gICAgICB0aW1lb3V0OiBBUFBfRE9XTkxPQURfVElNRU9VVF9NUyxcclxuICAgIH0pO1xyXG4gIH0gY2F0Y2ggKGVycikge1xyXG4gICAgdGhyb3cgbmV3IEVycm9yKGBVbmFibGUgdG8gZG93bmxvYWQgdGhlIGFwcDogJHtlcnIubWVzc2FnZX1gKTtcclxuICB9XHJcbiAgcmV0dXJuIHRhcmdldFBhdGg7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBFeHRyYWN0cyB0aGUgYnVuZGxlIGZyb20gYW4gYXJjaGl2ZSBpbnRvIHRoZSBnaXZlbiBmb2xkZXJcclxuICpcclxuICogQHBhcmFtIHtzdHJpbmd9IHppcFBhdGggRnVsbCBwYXRoIHRvIHRoZSBhcmNoaXZlIGNvbnRhaW5pbmcgdGhlIGJ1bmRsZVxyXG4gKiBAcGFyYW0ge3N0cmluZ30gZHN0Um9vdCBGdWxsIHBhdGggdG8gdGhlIGZvbGRlciB3aGVyZSB0aGUgZXh0cmFjdGVkIGJ1bmRsZVxyXG4gKiBzaG91bGQgYmUgcGxhY2VkXHJcbiAqIEBwYXJhbSB7QXJyYXk8c3RyaW5nPnxzdHJpbmd9IHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMgVGhlIGxpc3Qgb2YgZXh0ZW5zaW9uc1xyXG4gKiB0aGUgdGFyZ2V0IGFwcGxpY2F0aW9uIGJ1bmRsZSBzdXBwb3J0cywgZm9yIGV4YW1wbGUgWycuYXBrJywgJy5hcGtzJ10gZm9yXHJcbiAqIEFuZHJvaWQgcGFja2FnZXNcclxuICogQHJldHVybnMge3N0cmluZ30gRnVsbCBwYXRoIHRvIHRoZSBidW5kbGUgaW4gdGhlIGRlc3RpbmF0aW9uIGZvbGRlclxyXG4gKiBAdGhyb3dzIHtFcnJvcn0gSWYgdGhlIGdpdmVuIGFyY2hpdmUgaXMgaW52YWxpZCBvciBubyBhcHBsaWNhdGlvbiBidW5kbGVzXHJcbiAqIGhhdmUgYmVlbiBmb3VuZCBpbnNpZGVcclxuICovXHJcbmFzeW5jIGZ1bmN0aW9uIHVuemlwQXBwICh6aXBQYXRoLCBkc3RSb290LCBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zKSB7XHJcbiAgYXdhaXQgemlwLmFzc2VydFZhbGlkWmlwKHppcFBhdGgpO1xyXG5cclxuICBpZiAoIV8uaXNBcnJheShzdXBwb3J0ZWRBcHBFeHRlbnNpb25zKSkge1xyXG4gICAgc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucyA9IFtzdXBwb3J0ZWRBcHBFeHRlbnNpb25zXTtcclxuICB9XHJcblxyXG4gIGNvbnN0IHRtcFJvb3QgPSBhd2FpdCB0ZW1wRGlyLm9wZW5EaXIoKTtcclxuICB0cnkge1xyXG4gICAgbG9nZ2VyLmRlYnVnKGBVbnppcHBpbmcgJyR7emlwUGF0aH0nYCk7XHJcbiAgICBjb25zdCB0aW1lciA9IG5ldyB0aW1pbmcuVGltZXIoKS5zdGFydCgpO1xyXG4gICAgLyoqXHJcbiAgICAgKiBBdHRlbXB0IHRvIHVzZSB1c2UgdGhlIHN5c3RlbSBgdW56aXBgIChlLmcuLCBgL3Vzci9iaW4vdW56aXBgKSBkdWVcclxuICAgICAqIHRvIHRoZSBzaWduaWZpY2FudCBwZXJmb3JtYW5jZSBpbXByb3ZlbWVudCBpdCBwcm92aWRlcyBvdmVyIHRoZSBuYXRpdmVcclxuICAgICAqIEpTIFwidW56aXBcIiBpbXBsZW1lbnRhdGlvbi5cclxuICAgICAqIEB0eXBlIHtpbXBvcnQoJ2FwcGl1bS1zdXBwb3J0L2xpYi96aXAnKS5FeHRyYWN0QWxsT3B0aW9uc31cclxuICAgICAqL1xyXG4gICAgY29uc3QgZXh0cmFjdGlvbk9wdHMgPSB7XHJcbiAgICAgIHVzZVN5c3RlbVVuemlwOiB0cnVlLFxyXG4gICAgfTtcclxuICAgIC8vIGh0dHBzOi8vZ2l0aHViLmNvbS9hcHBpdW0vYXBwaXVtL2lzc3Vlcy8xNDEwMFxyXG4gICAgaWYgKHBhdGguZXh0bmFtZSh6aXBQYXRoKSA9PT0gSVBBX0VYVCkge1xyXG4gICAgICBsb2dnZXIuZGVidWcoYEVuZm9yY2luZyBVVEYtOCBlbmNvZGluZyBvbiB0aGUgZXh0cmFjdGVkIGZpbGUgbmFtZXMgZm9yICcke3BhdGguYmFzZW5hbWUoemlwUGF0aCl9J2ApO1xyXG4gICAgICBleHRyYWN0aW9uT3B0cy5maWxlTmFtZXNFbmNvZGluZyA9ICd1dGY4JztcclxuICAgIH1cclxuICAgIGF3YWl0IHppcC5leHRyYWN0QWxsVG8oemlwUGF0aCwgdG1wUm9vdCwgZXh0cmFjdGlvbk9wdHMpO1xyXG4gICAgY29uc3QgZ2xvYlBhdHRlcm4gPSBgKiovKi4rKCR7c3VwcG9ydGVkQXBwRXh0ZW5zaW9ucy5tYXAoKGV4dCkgPT4gZXh0LnJlcGxhY2UoL15cXC4vLCAnJykpLmpvaW4oJ3wnKX0pYDtcclxuICAgIGNvbnN0IHNvcnRlZEJ1bmRsZUl0ZW1zID0gKGF3YWl0IGZzLmdsb2IoZ2xvYlBhdHRlcm4sIHtcclxuICAgICAgY3dkOiB0bXBSb290LFxyXG4gICAgICBzdHJpY3Q6IGZhbHNlLFxyXG4gICAgLy8gR2V0IHRoZSB0b3AgbGV2ZWwgbWF0Y2hcclxuICAgIH0pKS5zb3J0KChhLCBiKSA9PiBhLnNwbGl0KHBhdGguc2VwKS5sZW5ndGggLSBiLnNwbGl0KHBhdGguc2VwKS5sZW5ndGgpO1xyXG4gICAgaWYgKF8uaXNFbXB0eShzb3J0ZWRCdW5kbGVJdGVtcykpIHtcclxuICAgICAgbG9nZ2VyLmVycm9yQW5kVGhyb3coYEFwcCB1bnppcHBlZCBPSywgYnV0IHdlIGNvdWxkIG5vdCBmaW5kIGFueSAnJHtzdXBwb3J0ZWRBcHBFeHRlbnNpb25zfScgYCArXHJcbiAgICAgICAgdXRpbC5wbHVyYWxpemUoJ2J1bmRsZScsIHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMubGVuZ3RoLCBmYWxzZSkgK1xyXG4gICAgICAgIGAgaW4gaXQuIE1ha2Ugc3VyZSB5b3VyIGFyY2hpdmUgY29udGFpbnMgYXQgbGVhc3Qgb25lIHBhY2thZ2UgaGF2aW5nIGAgK1xyXG4gICAgICAgIGAnJHtzdXBwb3J0ZWRBcHBFeHRlbnNpb25zfScgJHt1dGlsLnBsdXJhbGl6ZSgnZXh0ZW5zaW9uJywgc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucy5sZW5ndGgsIGZhbHNlKX1gKTtcclxuICAgIH1cclxuICAgIGxvZ2dlci5kZWJ1ZyhgRXh0cmFjdGVkICR7dXRpbC5wbHVyYWxpemUoJ2J1bmRsZSBpdGVtJywgc29ydGVkQnVuZGxlSXRlbXMubGVuZ3RoLCB0cnVlKX0gYCArXHJcbiAgICAgIGBmcm9tICcke3ppcFBhdGh9JyBpbiAke01hdGgucm91bmQodGltZXIuZ2V0RHVyYXRpb24oKS5hc01pbGxpU2Vjb25kcyl9bXM6ICR7c29ydGVkQnVuZGxlSXRlbXN9YCk7XHJcbiAgICBjb25zdCBtYXRjaGVkQnVuZGxlID0gXy5maXJzdChzb3J0ZWRCdW5kbGVJdGVtcyk7XHJcbiAgICBsb2dnZXIuaW5mbyhgQXNzdW1pbmcgJyR7bWF0Y2hlZEJ1bmRsZX0nIGlzIHRoZSBjb3JyZWN0IGJ1bmRsZWApO1xyXG4gICAgY29uc3QgZHN0UGF0aCA9IHBhdGgucmVzb2x2ZShkc3RSb290LCBwYXRoLmJhc2VuYW1lKG1hdGNoZWRCdW5kbGUpKTtcclxuICAgIGF3YWl0IGZzLm12KHBhdGgucmVzb2x2ZSh0bXBSb290LCBtYXRjaGVkQnVuZGxlKSwgZHN0UGF0aCwge21rZGlycDogdHJ1ZX0pO1xyXG4gICAgcmV0dXJuIGRzdFBhdGg7XHJcbiAgfSBmaW5hbGx5IHtcclxuICAgIGF3YWl0IGZzLnJpbXJhZih0bXBSb290KTtcclxuICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGlzUGFja2FnZU9yQnVuZGxlIChhcHApIHtcclxuICByZXR1cm4gKC9eKFthLXpBLVowLTlcXC1fXStcXC5bYS16QS1aMC05XFwtX10rKSskLykudGVzdChhcHApO1xyXG59XHJcblxyXG4vKipcclxuICogRmluZHMgYWxsIGluc3RhbmNlcyAnZmlyc3RLZXknIGFuZCBjcmVhdGUgYSBkdXBsaWNhdGUgd2l0aCB0aGUga2V5ICdzZWNvbmRLZXknLFxyXG4gKiBEbyB0aGUgc2FtZSB0aGluZyBpbiByZXZlcnNlLiBJZiB3ZSBmaW5kICdzZWNvbmRLZXknLCBjcmVhdGUgYSBkdXBsaWNhdGUgd2l0aCB0aGUga2V5ICdmaXJzdEtleScuXHJcbiAqXHJcbiAqIFRoaXMgd2lsbCBjYXVzZSBrZXlzIHRvIGJlIG92ZXJ3cml0dGVuIGlmIHRoZSBvYmplY3QgY29udGFpbnMgJ2ZpcnN0S2V5JyBhbmQgJ3NlY29uZEtleScuXHJcblxyXG4gKiBAcGFyYW0geyp9IGlucHV0IEFueSB0eXBlIG9mIGlucHV0XHJcbiAqIEBwYXJhbSB7U3RyaW5nfSBmaXJzdEtleSBUaGUgZmlyc3Qga2V5IHRvIGR1cGxpY2F0ZVxyXG4gKiBAcGFyYW0ge1N0cmluZ30gc2Vjb25kS2V5IFRoZSBzZWNvbmQga2V5IHRvIGR1cGxpY2F0ZVxyXG4gKi9cclxuZnVuY3Rpb24gZHVwbGljYXRlS2V5cyAoaW5wdXQsIGZpcnN0S2V5LCBzZWNvbmRLZXkpIHtcclxuICAvLyBJZiBhcnJheSBwcm92aWRlZCwgcmVjdXJzaXZlbHkgY2FsbCBvbiBhbGwgZWxlbWVudHNcclxuICBpZiAoXy5pc0FycmF5KGlucHV0KSkge1xyXG4gICAgcmV0dXJuIGlucHV0Lm1hcCgoaXRlbSkgPT4gZHVwbGljYXRlS2V5cyhpdGVtLCBmaXJzdEtleSwgc2Vjb25kS2V5KSk7XHJcbiAgfVxyXG5cclxuICAvLyBJZiBvYmplY3QsIGNyZWF0ZSBkdXBsaWNhdGVzIGZvciBrZXlzIGFuZCB0aGVuIHJlY3Vyc2l2ZWx5IGNhbGwgb24gdmFsdWVzXHJcbiAgaWYgKF8uaXNQbGFpbk9iamVjdChpbnB1dCkpIHtcclxuICAgIGNvbnN0IHJlc3VsdE9iaiA9IHt9O1xyXG4gICAgZm9yIChsZXQgW2tleSwgdmFsdWVdIG9mIF8udG9QYWlycyhpbnB1dCkpIHtcclxuICAgICAgY29uc3QgcmVjdXJzaXZlbHlDYWxsZWRWYWx1ZSA9IGR1cGxpY2F0ZUtleXModmFsdWUsIGZpcnN0S2V5LCBzZWNvbmRLZXkpO1xyXG4gICAgICBpZiAoa2V5ID09PSBmaXJzdEtleSkge1xyXG4gICAgICAgIHJlc3VsdE9ialtzZWNvbmRLZXldID0gcmVjdXJzaXZlbHlDYWxsZWRWYWx1ZTtcclxuICAgICAgfSBlbHNlIGlmIChrZXkgPT09IHNlY29uZEtleSkge1xyXG4gICAgICAgIHJlc3VsdE9ialtmaXJzdEtleV0gPSByZWN1cnNpdmVseUNhbGxlZFZhbHVlO1xyXG4gICAgICB9XHJcbiAgICAgIHJlc3VsdE9ialtrZXldID0gcmVjdXJzaXZlbHlDYWxsZWRWYWx1ZTtcclxuICAgIH1cclxuICAgIHJldHVybiByZXN1bHRPYmo7XHJcbiAgfVxyXG5cclxuICAvLyBCYXNlIGNhc2UuIFJldHVybiBwcmltaXRpdmVzIHdpdGhvdXQgZG9pbmcgYW55dGhpbmcuXHJcbiAgcmV0dXJuIGlucHV0O1xyXG59XHJcblxyXG4vKipcclxuICogVGFrZXMgYSBkZXNpcmVkIGNhcGFiaWxpdHkgYW5kIHRyaWVzIHRvIEpTT04ucGFyc2UgaXQgYXMgYW4gYXJyYXksXHJcbiAqIGFuZCBlaXRoZXIgcmV0dXJucyB0aGUgcGFyc2VkIGFycmF5IG9yIGEgc2luZ2xldG9uIGFycmF5LlxyXG4gKlxyXG4gKiBAcGFyYW0ge3N0cmluZ3xBcnJheTxTdHJpbmc+fSBjYXAgQSBkZXNpcmVkIGNhcGFiaWxpdHlcclxuICovXHJcbmZ1bmN0aW9uIHBhcnNlQ2Fwc0FycmF5IChjYXApIHtcclxuICBpZiAoXy5pc0FycmF5KGNhcCkpIHtcclxuICAgIHJldHVybiBjYXA7XHJcbiAgfVxyXG5cclxuICBsZXQgcGFyc2VkQ2FwcztcclxuICB0cnkge1xyXG4gICAgcGFyc2VkQ2FwcyA9IEpTT04ucGFyc2UoY2FwKTtcclxuICAgIGlmIChfLmlzQXJyYXkocGFyc2VkQ2FwcykpIHtcclxuICAgICAgcmV0dXJuIHBhcnNlZENhcHM7XHJcbiAgICB9XHJcbiAgfSBjYXRjaCAoaWduKSB7XHJcbiAgICBsb2dnZXIud2FybihgRmFpbGVkIHRvIHBhcnNlIGNhcGFiaWxpdHkgYXMgSlNPTiBhcnJheWApO1xyXG4gIH1cclxuICBpZiAoXy5pc1N0cmluZyhjYXApKSB7XHJcbiAgICByZXR1cm4gW2NhcF07XHJcbiAgfVxyXG4gIHRocm93IG5ldyBFcnJvcihgbXVzdCBwcm92aWRlIGEgc3RyaW5nIG9yIEpTT04gQXJyYXk7IHJlY2VpdmVkICR7Y2FwfWApO1xyXG59XHJcblxyXG5leHBvcnQge1xyXG4gIGNvbmZpZ3VyZUFwcCwgaXNQYWNrYWdlT3JCdW5kbGUsIGR1cGxpY2F0ZUtleXMsIHBhcnNlQ2Fwc0FycmF5XHJcbn07XHJcbiJdLCJmaWxlIjoibGliL2Jhc2Vkcml2ZXIvaGVscGVycy5qcyIsInNvdXJjZVJvb3QiOiIuLlxcLi5cXC4uIn0=
