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

      const localFile = await (0, _mcloudUtils.getLocalFileForAppUrl)(newApp);
      const lockFile = localFile + '.lock';
      let downloadIsNeaded;

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
        downloadIsNeaded = true;
      }

      if (downloadIsNeaded) {
        _logger.default.info(`Local version of app was not found. Hence using default Appium logic for downloading`);

        const sharedFolderPath = await (0, _mcloudUtils.getSharedFolderForAppUrl)(app);

        _logger.default.info(`Folder for local shared apps: ${sharedFolderPath}`);

        await _appiumSupport.fs.close(await _appiumSupport.fs.open(lockFile, 'w'));

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

          _logger.default.info(`New app path: ${newApp}`);

          await _appiumSupport.fs.copyFile(newApp, localFile);
        } finally {
          _logger.default.info(`Going to remove lock file ${lockFile}`);

          await _appiumSupport.fs.unlink(lockFile);
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
          if (archivePath !== app) {
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
        if (newApp !== archivePath && archivePath !== app) {
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


//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImxpYi9iYXNlZHJpdmVyL2hlbHBlcnMuanMiXSwibmFtZXMiOlsiSVBBX0VYVCIsIlpJUF9FWFRTIiwiWklQX01JTUVfVFlQRVMiLCJDQUNIRURfQVBQU19NQVhfQUdFIiwiQVBQTElDQVRJT05TX0NBQ0hFIiwiTFJVIiwibWF4QWdlIiwidXBkYXRlQWdlT25HZXQiLCJkaXNwb3NlIiwiYXBwIiwiZnVsbFBhdGgiLCJmcyIsImV4aXN0cyIsImxvZ2dlciIsImluZm8iLCJyaW1yYWYiLCJub0Rpc3Bvc2VPblNldCIsIkFQUExJQ0FUSU9OU19DQUNIRV9HVUFSRCIsIkFzeW5jTG9jayIsIlNBTklUSVpFX1JFUExBQ0VNRU5UIiwiREVGQVVMVF9CQVNFTkFNRSIsIkFQUF9ET1dOTE9BRF9USU1FT1VUX01TIiwicHJvY2VzcyIsIm9uIiwiaXRlbUNvdW50IiwiYXBwUGF0aHMiLCJ2YWx1ZXMiLCJtYXAiLCJkZWJ1ZyIsImxlbmd0aCIsInV0aWwiLCJwbHVyYWxpemUiLCJhcHBQYXRoIiwicmltcmFmU3luYyIsImUiLCJ3YXJuIiwibWVzc2FnZSIsInJldHJpZXZlSGVhZGVycyIsImxpbmsiLCJ1cmwiLCJtZXRob2QiLCJ0aW1lb3V0IiwiaGVhZGVycyIsImdldENhY2hlZEFwcGxpY2F0aW9uUGF0aCIsImN1cnJlbnRBcHBQcm9wcyIsInJlZnJlc2giLCJoYXMiLCJsYXN0TW9kaWZpZWQiLCJjdXJyZW50TW9kaWZpZWQiLCJpbW11dGFibGUiLCJjdXJyZW50SW1tdXRhYmxlIiwiY3VycmVudE1heEFnZSIsInRpbWVzdGFtcCIsImdldCIsImdldFRpbWUiLCJtc0xlZnQiLCJEYXRlIiwibm93IiwicGF0aCIsImJhc2VuYW1lIiwidmVyaWZ5QXBwRXh0ZW5zaW9uIiwic3VwcG9ydGVkQXBwRXh0ZW5zaW9ucyIsImluY2x1ZGVzIiwiZXh0bmFtZSIsIkVycm9yIiwiY29uZmlndXJlQXBwIiwiXyIsImlzU3RyaW5nIiwiaXNBcnJheSIsIm5ld0FwcCIsInNob3VsZFVuemlwQXBwIiwiYXJjaGl2ZUhhc2giLCJyZW1vdGVBcHBQcm9wcyIsInByb3RvY29sIiwicGF0aG5hbWUiLCJwYXJzZSIsImlzVXJsIiwiYWNxdWlyZSIsImlzRW1wdHkiLCJ0ZXN0IiwibWF4QWdlTWF0Y2giLCJleGVjIiwicGFyc2VJbnQiLCJsb2NhbEZpbGUiLCJsb2NrRmlsZSIsImRvd25sb2FkSXNOZWFkZWQiLCJyZW1vdGVGaWxlTGVuZ3RoIiwic3RhdHMiLCJzdGF0IiwibG9jYWxGaWxlTGVuZ3RoIiwic2l6ZSIsInVubGluayIsIndhaXRpbmdUaW1lIiwibWF4QXR0ZW1wdHNDb3VudCIsImF0dGVtcHRzQ291bnQiLCJQcm9taXNlIiwicmVzb2x2ZSIsInNldFRpbWVvdXQiLCJzaGFyZWRGb2xkZXJQYXRoIiwiY2xvc2UiLCJvcGVuIiwiY2FjaGVkUGF0aCIsImRlbCIsImZpbGVOYW1lIiwic2FuaXRpemVOYW1lIiwiZGVjb2RlVVJJQ29tcG9uZW50IiwicmVwbGFjZW1lbnQiLCJjdCIsInNvbWUiLCJtaW1lVHlwZSIsIlJlZ0V4cCIsImVzY2FwZVJlZ0V4cCIsIm1hdGNoIiwicmVzdWx0aW5nTmFtZSIsInN1YnN0cmluZyIsInJlc3VsdGluZ0V4dCIsImZpcnN0IiwidGFyZ2V0UGF0aCIsInRlbXBEaXIiLCJwcmVmaXgiLCJzdWZmaXgiLCJkb3dubG9hZEFwcCIsImNvcHlGaWxlIiwiZXJyb3JNZXNzYWdlIiwiYXJjaGl2ZVBhdGgiLCJoYXNoIiwidG1wUm9vdCIsIm9wZW5EaXIiLCJ1bnppcEFwcCIsImlzQWJzb2x1dGUiLCJjd2QiLCJCb29sZWFuIiwic2V0IiwiaHJlZiIsIm5ldCIsImRvd25sb2FkRmlsZSIsImVyciIsInppcFBhdGgiLCJkc3RSb290IiwiemlwIiwiYXNzZXJ0VmFsaWRaaXAiLCJ0aW1lciIsInRpbWluZyIsIlRpbWVyIiwic3RhcnQiLCJ1c2VTeXN0ZW1VbnppcEVudiIsImVudiIsIkFQUElVTV9QUkVGRVJfU1lTVEVNX1VOWklQIiwidXNlU3lzdGVtVW56aXAiLCJ0b0xvd2VyIiwiZXh0cmFjdGlvbk9wdHMiLCJmaWxlTmFtZXNFbmNvZGluZyIsImV4dHJhY3RBbGxUbyIsImdsb2JQYXR0ZXJuIiwiZXh0IiwicmVwbGFjZSIsImpvaW4iLCJzb3J0ZWRCdW5kbGVJdGVtcyIsImdsb2IiLCJzdHJpY3QiLCJzb3J0IiwiYSIsImIiLCJzcGxpdCIsInNlcCIsImVycm9yQW5kVGhyb3ciLCJNYXRoIiwicm91bmQiLCJnZXREdXJhdGlvbiIsImFzTWlsbGlTZWNvbmRzIiwibWF0Y2hlZEJ1bmRsZSIsImRzdFBhdGgiLCJtdiIsIm1rZGlycCIsImlzUGFja2FnZU9yQnVuZGxlIiwiZHVwbGljYXRlS2V5cyIsImlucHV0IiwiZmlyc3RLZXkiLCJzZWNvbmRLZXkiLCJpdGVtIiwiaXNQbGFpbk9iamVjdCIsInJlc3VsdE9iaiIsImtleSIsInZhbHVlIiwidG9QYWlycyIsInJlY3Vyc2l2ZWx5Q2FsbGVkVmFsdWUiLCJwYXJzZUNhcHNBcnJheSIsImNhcCIsInBhcnNlZENhcHMiLCJKU09OIiwiaWduIl0sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7OztBQUFBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUVBLE1BQU1BLE9BQU8sR0FBRyxNQUFoQjtBQUNBLE1BQU1DLFFBQVEsR0FBRyxDQUFDLE1BQUQsRUFBU0QsT0FBVCxDQUFqQjtBQUNBLE1BQU1FLGNBQWMsR0FBRyxDQUNyQixpQkFEcUIsRUFFckIsOEJBRnFCLEVBR3JCLGlCQUhxQixDQUF2QjtBQUtBLE1BQU1DLG1CQUFtQixHQUFHLE9BQU8sRUFBUCxHQUFZLEVBQVosR0FBaUIsRUFBN0M7QUFDQSxNQUFNQyxrQkFBa0IsR0FBRyxJQUFJQyxpQkFBSixDQUFRO0FBQ2pDQyxFQUFBQSxNQUFNLEVBQUVILG1CQUR5QjtBQUVqQ0ksRUFBQUEsY0FBYyxFQUFFLElBRmlCO0FBR2pDQyxFQUFBQSxPQUFPLEVBQUUsT0FBT0MsR0FBUCxFQUFZO0FBQUNDLElBQUFBO0FBQUQsR0FB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REFBZ0QySCxHQUFJLEVBQS9ELENBQU47QUFDRCIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBfIGZyb20gJ2xvZGFzaCc7XHJcbmltcG9ydCBwYXRoIGZyb20gJ3BhdGgnO1xyXG5pbXBvcnQgdXJsIGZyb20gJ3VybCc7XHJcbmltcG9ydCBsb2dnZXIgZnJvbSAnLi9sb2dnZXInO1xyXG5pbXBvcnQgeyB0ZW1wRGlyLCBmcywgdXRpbCwgemlwLCBuZXQsIHRpbWluZyB9IGZyb20gJ2FwcGl1bS1zdXBwb3J0JztcclxuaW1wb3J0IExSVSBmcm9tICdscnUtY2FjaGUnO1xyXG5pbXBvcnQgQXN5bmNMb2NrIGZyb20gJ2FzeW5jLWxvY2snO1xyXG5pbXBvcnQgYXhpb3MgZnJvbSAnYXhpb3MnO1xyXG5pbXBvcnQgeyBnZXRTaGFyZWRGb2xkZXJGb3JBcHBVcmwsIGdldExvY2FsRmlsZUZvckFwcFVybCwgZ2V0RmlsZUNvbnRlbnRMZW5ndGggfSBmcm9tICcuL21jbG91ZC11dGlscyc7XHJcblxyXG5jb25zdCBJUEFfRVhUID0gJy5pcGEnO1xyXG5jb25zdCBaSVBfRVhUUyA9IFsnLnppcCcsIElQQV9FWFRdO1xyXG5jb25zdCBaSVBfTUlNRV9UWVBFUyA9IFtcclxuICAnYXBwbGljYXRpb24vemlwJyxcclxuICAnYXBwbGljYXRpb24veC16aXAtY29tcHJlc3NlZCcsXHJcbiAgJ211bHRpcGFydC94LXppcCcsXHJcbl07XHJcbmNvbnN0IENBQ0hFRF9BUFBTX01BWF9BR0UgPSAxMDAwICogNjAgKiA2MCAqIDI0OyAvLyBtc1xyXG5jb25zdCBBUFBMSUNBVElPTlNfQ0FDSEUgPSBuZXcgTFJVKHtcclxuICBtYXhBZ2U6IENBQ0hFRF9BUFBTX01BWF9BR0UsIC8vIGV4cGlyZSBhZnRlciAyNCBob3Vyc1xyXG4gIHVwZGF0ZUFnZU9uR2V0OiB0cnVlLFxyXG4gIGRpc3Bvc2U6IGFzeW5jIChhcHAsIHtmdWxsUGF0aH0pID0+IHtcclxuICAgIGlmICghYXdhaXQgZnMuZXhpc3RzKGZ1bGxQYXRoKSkge1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgbG9nZ2VyLmluZm8oYFRoZSBhcHBsaWNhdGlvbiAnJHthcHB9JyBjYWNoZWQgYXQgJyR7ZnVsbFBhdGh9JyBoYXMgZXhwaXJlZGApO1xyXG4gICAgYXdhaXQgZnMucmltcmFmKGZ1bGxQYXRoKTtcclxuICB9LFxyXG4gIG5vRGlzcG9zZU9uU2V0OiB0cnVlLFxyXG59KTtcclxuY29uc3QgQVBQTElDQVRJT05TX0NBQ0hFX0dVQVJEID0gbmV3IEFzeW5jTG9jaygpO1xyXG5jb25zdCBTQU5JVElaRV9SRVBMQUNFTUVOVCA9ICctJztcclxuY29uc3QgREVGQVVMVF9CQVNFTkFNRSA9ICdhcHBpdW0tYXBwJztcclxuY29uc3QgQVBQX0RPV05MT0FEX1RJTUVPVVRfTVMgPSAxMjAgKiAxMDAwO1xyXG5cclxucHJvY2Vzcy5vbignZXhpdCcsICgpID0+IHtcclxuICBpZiAoQVBQTElDQVRJT05TX0NBQ0hFLml0ZW1Db3VudCA9PT0gMCkge1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuXHJcbiAgY29uc3QgYXBwUGF0aHMgPSBBUFBMSUNBVElPTlNfQ0FDSEUudmFsdWVzKClcclxuICAgIC5tYXAoKHtmdWxsUGF0aH0pID0+IGZ1bGxQYXRoKTtcclxuICBsb2dnZXIuZGVidWcoYFBlcmZvcm1pbmcgY2xlYW51cCBvZiAke2FwcFBhdGhzLmxlbmd0aH0gY2FjaGVkIGAgK1xyXG4gICAgdXRpbC5wbHVyYWxpemUoJ2FwcGxpY2F0aW9uJywgYXBwUGF0aHMubGVuZ3RoKSk7XHJcbiAgZm9yIChjb25zdCBhcHBQYXRoIG9mIGFwcFBhdGhzKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICAvLyBBc3luY2hyb25vdXMgY2FsbHMgYXJlIG5vdCBzdXBwb3J0ZWQgaW4gb25FeGl0IGhhbmRsZXJcclxuICAgICAgZnMucmltcmFmU3luYyhhcHBQYXRoKTtcclxuICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgbG9nZ2VyLndhcm4oZS5tZXNzYWdlKTtcclxuICAgIH1cclxuICB9XHJcbn0pO1xyXG5cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIHJldHJpZXZlSGVhZGVycyAobGluaykge1xyXG4gIHRyeSB7XHJcbiAgICByZXR1cm4gKGF3YWl0IGF4aW9zKHtcclxuICAgICAgdXJsOiBsaW5rLFxyXG4gICAgICBtZXRob2Q6ICdIRUFEJyxcclxuICAgICAgdGltZW91dDogNTAwMCxcclxuICAgIH0pKS5oZWFkZXJzO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGxvZ2dlci5pbmZvKGBDYW5ub3Qgc2VuZCBIRUFEIHJlcXVlc3QgdG8gJyR7bGlua30nLiBPcmlnaW5hbCBlcnJvcjogJHtlLm1lc3NhZ2V9YCk7XHJcbiAgfVxyXG4gIHJldHVybiB7fTtcclxufVxyXG5cclxuZnVuY3Rpb24gZ2V0Q2FjaGVkQXBwbGljYXRpb25QYXRoIChsaW5rLCBjdXJyZW50QXBwUHJvcHMgPSB7fSkge1xyXG4gIGNvbnN0IHJlZnJlc2ggPSAoKSA9PiB7XHJcbiAgICBsb2dnZXIuaW5mbyhgQ1VTVE9NIEhFTFBFUiFgKTtcclxuICAgIGxvZ2dlci5kZWJ1ZyhgQSBmcmVzaCBjb3B5IG9mIHRoZSBhcHBsaWNhdGlvbiBpcyBnb2luZyB0byBiZSBkb3dubG9hZGVkIGZyb20gJHtsaW5rfWApO1xyXG4gICAgcmV0dXJuIG51bGw7XHJcbiAgfTtcclxuXHJcbiAgaWYgKEFQUExJQ0FUSU9OU19DQUNIRS5oYXMobGluaykpIHtcclxuICAgIGNvbnN0IHtcclxuICAgICAgbGFzdE1vZGlmaWVkOiBjdXJyZW50TW9kaWZpZWQsXHJcbiAgICAgIGltbXV0YWJsZTogY3VycmVudEltbXV0YWJsZSxcclxuICAgICAgLy8gbWF4QWdlIGlzIGluIHNlY29uZHNcclxuICAgICAgbWF4QWdlOiBjdXJyZW50TWF4QWdlLFxyXG4gICAgfSA9IGN1cnJlbnRBcHBQcm9wcztcclxuICAgIGNvbnN0IHtcclxuICAgICAgLy8gRGF0ZSBpbnN0YW5jZVxyXG4gICAgICBsYXN0TW9kaWZpZWQsXHJcbiAgICAgIC8vIGJvb2xlYW5cclxuICAgICAgaW1tdXRhYmxlLFxyXG4gICAgICAvLyBVbml4IHRpbWUgaW4gbWlsbGlzZWNvbmRzXHJcbiAgICAgIHRpbWVzdGFtcCxcclxuICAgICAgZnVsbFBhdGgsXHJcbiAgICB9ID0gQVBQTElDQVRJT05TX0NBQ0hFLmdldChsaW5rKTtcclxuICAgIGlmIChsYXN0TW9kaWZpZWQgJiYgY3VycmVudE1vZGlmaWVkKSB7XHJcbiAgICAgIGlmIChjdXJyZW50TW9kaWZpZWQuZ2V0VGltZSgpIDw9IGxhc3RNb2RpZmllZC5nZXRUaW1lKCkpIHtcclxuICAgICAgICBsb2dnZXIuZGVidWcoYFRoZSBhcHBsaWNhdGlvbiBhdCAke2xpbmt9IGhhcyBub3QgYmVlbiBtb2RpZmllZCBzaW5jZSAke2xhc3RNb2RpZmllZH1gKTtcclxuICAgICAgICByZXR1cm4gZnVsbFBhdGg7XHJcbiAgICAgIH1cclxuICAgICAgbG9nZ2VyLmRlYnVnKGBUaGUgYXBwbGljYXRpb24gYXQgJHtsaW5rfSBoYXMgYmVlbiBtb2RpZmllZCBzaW5jZSAke2xhc3RNb2RpZmllZH1gKTtcclxuICAgICAgcmV0dXJuIHJlZnJlc2goKTtcclxuICAgIH1cclxuICAgIGlmIChpbW11dGFibGUgJiYgY3VycmVudEltbXV0YWJsZSkge1xyXG4gICAgICBsb2dnZXIuZGVidWcoYFRoZSBhcHBsaWNhdGlvbiBhdCAke2xpbmt9IGlzIGltbXV0YWJsZWApO1xyXG4gICAgICByZXR1cm4gZnVsbFBhdGg7XHJcbiAgICB9XHJcbiAgICBpZiAoY3VycmVudE1heEFnZSAmJiB0aW1lc3RhbXApIHtcclxuICAgICAgY29uc3QgbXNMZWZ0ID0gdGltZXN0YW1wICsgY3VycmVudE1heEFnZSAqIDEwMDAgLSBEYXRlLm5vdygpO1xyXG4gICAgICBpZiAobXNMZWZ0ID4gMCkge1xyXG4gICAgICAgIGxvZ2dlci5kZWJ1ZyhgVGhlIGNhY2hlZCBhcHBsaWNhdGlvbiAnJHtwYXRoLmJhc2VuYW1lKGZ1bGxQYXRoKX0nIHdpbGwgZXhwaXJlIGluICR7bXNMZWZ0IC8gMTAwMH1zYCk7XHJcbiAgICAgICAgcmV0dXJuIGZ1bGxQYXRoO1xyXG4gICAgICB9XHJcbiAgICAgIGxvZ2dlci5kZWJ1ZyhgVGhlIGNhY2hlZCBhcHBsaWNhdGlvbiAnJHtwYXRoLmJhc2VuYW1lKGZ1bGxQYXRoKX0nIGhhcyBleHBpcmVkYCk7XHJcbiAgICB9XHJcbiAgfVxyXG4gIHJldHVybiByZWZyZXNoKCk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHZlcmlmeUFwcEV4dGVuc2lvbiAoYXBwLCBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zKSB7XHJcbiAgaWYgKHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMuaW5jbHVkZXMocGF0aC5leHRuYW1lKGFwcCkpKSB7XHJcbiAgICByZXR1cm4gYXBwO1xyXG4gIH1cclxuICB0aHJvdyBuZXcgRXJyb3IoYE5ldyBhcHAgcGF0aCAnJHthcHB9JyBkaWQgbm90IGhhdmUgYCArXHJcbiAgICBgJHt1dGlsLnBsdXJhbGl6ZSgnZXh0ZW5zaW9uJywgc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucy5sZW5ndGgsIGZhbHNlKX06IGAgK1xyXG4gICAgc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucyk7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGNvbmZpZ3VyZUFwcCAoYXBwLCBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zKSB7XHJcbiAgaWYgKCFfLmlzU3RyaW5nKGFwcCkpIHtcclxuICAgIC8vIGltbWVkaWF0ZWx5IHNob3J0Y2lyY3VpdCBpZiBub3QgZ2l2ZW4gYW4gYXBwXHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGlmICghXy5pc0FycmF5KHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMpKSB7XHJcbiAgICBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zID0gW3N1cHBvcnRlZEFwcEV4dGVuc2lvbnNdO1xyXG4gIH1cclxuXHJcbiAgbGV0IG5ld0FwcCA9IGFwcDtcclxuICBsZXQgc2hvdWxkVW56aXBBcHAgPSBmYWxzZTtcclxuICBsZXQgYXJjaGl2ZUhhc2ggPSBudWxsO1xyXG4gIGNvbnN0IHJlbW90ZUFwcFByb3BzID0ge1xyXG4gICAgbGFzdE1vZGlmaWVkOiBudWxsLFxyXG4gICAgaW1tdXRhYmxlOiBmYWxzZSxcclxuICAgIG1heEFnZTogbnVsbCxcclxuICB9O1xyXG4gIGNvbnN0IHtwcm90b2NvbCwgcGF0aG5hbWV9ID0gdXJsLnBhcnNlKG5ld0FwcCk7XHJcbiAgY29uc3QgaXNVcmwgPSBbJ2h0dHA6JywgJ2h0dHBzOiddLmluY2x1ZGVzKHByb3RvY29sKTtcclxuXHJcbiAgcmV0dXJuIGF3YWl0IEFQUExJQ0FUSU9OU19DQUNIRV9HVUFSRC5hY3F1aXJlKGFwcCwgYXN5bmMgKCkgPT4ge1xyXG4gICAgaWYgKGlzVXJsKSB7XHJcbiAgICAgIC8vIFVzZSB0aGUgYXBwIGZyb20gcmVtb3RlIFVSTFxyXG4gICAgICBsb2dnZXIuaW5mbyhgVXNpbmcgZG93bmxvYWRhYmxlIGFwcCAnJHtuZXdBcHB9J2ApO1xyXG4gICAgICBjb25zdCBoZWFkZXJzID0gYXdhaXQgcmV0cmlldmVIZWFkZXJzKG5ld0FwcCk7XHJcbiAgICAgIGlmICghXy5pc0VtcHR5KGhlYWRlcnMpKSB7XHJcbiAgICAgICAgaWYgKGhlYWRlcnNbJ2xhc3QtbW9kaWZpZWQnXSkge1xyXG4gICAgICAgICAgcmVtb3RlQXBwUHJvcHMubGFzdE1vZGlmaWVkID0gbmV3IERhdGUoaGVhZGVyc1snbGFzdC1tb2RpZmllZCddKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgbG9nZ2VyLmRlYnVnKGBMYXN0LU1vZGlmaWVkOiAke2hlYWRlcnNbJ2xhc3QtbW9kaWZpZWQnXX1gKTtcclxuICAgICAgICBpZiAoaGVhZGVyc1snY2FjaGUtY29udHJvbCddKSB7XHJcbiAgICAgICAgICByZW1vdGVBcHBQcm9wcy5pbW11dGFibGUgPSAvXFxiaW1tdXRhYmxlXFxiL2kudGVzdChoZWFkZXJzWydjYWNoZS1jb250cm9sJ10pO1xyXG4gICAgICAgICAgY29uc3QgbWF4QWdlTWF0Y2ggPSAvXFxibWF4LWFnZT0oXFxkKylcXGIvaS5leGVjKGhlYWRlcnNbJ2NhY2hlLWNvbnRyb2wnXSk7XHJcbiAgICAgICAgICBpZiAobWF4QWdlTWF0Y2gpIHtcclxuICAgICAgICAgICAgcmVtb3RlQXBwUHJvcHMubWF4QWdlID0gcGFyc2VJbnQobWF4QWdlTWF0Y2hbMV0sIDEwKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgbG9nZ2VyLmRlYnVnKGBDYWNoZS1Db250cm9sOiAke2hlYWRlcnNbJ2NhY2hlLWNvbnRyb2wnXX1gKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gKioqKiogQ3VzdG9tIGxvZ2ljIGZvciB2ZXJpZmljYXRpb24gb2YgbG9jYWwgc3RhdGljIHBhdGggZm9yIEFQUHMgKioqKipcclxuICAgICAgY29uc3QgbG9jYWxGaWxlID0gYXdhaXQgZ2V0TG9jYWxGaWxlRm9yQXBwVXJsKG5ld0FwcCk7XHJcbiAgICAgIGNvbnN0IGxvY2tGaWxlID0gbG9jYWxGaWxlICsgJy5sb2NrJztcclxuICAgICAgbGV0IGRvd25sb2FkSXNOZWFkZWQ7XHJcbiAgICAgIGlmKGF3YWl0IGZzLmV4aXN0cyhsb2NhbEZpbGUpKSB7XHJcbiAgICAgICAgbG9nZ2VyLmluZm8oYExvY2FsIHZlcnNpb24gb2YgYXBwIHdhcyBmb3VuZC4gV2lsbCBjaGVjayBhY3R1YWxpdHkgb2YgdGhlIGZpbGVgKTtcclxuICAgICAgICAvLyBDaGVja2luZyBvZiBsb2NhbCBhcHBsaWNhdGlvbiBhY3R1YWxpdHlcclxuICAgICAgICBjb25zdCByZW1vdGVGaWxlTGVuZ3RoID0gYXdhaXQgZ2V0RmlsZUNvbnRlbnRMZW5ndGgoYXBwKTtcclxuICAgICAgICBjb25zdCBzdGF0cyA9IGF3YWl0IGZzLnN0YXQobG9jYWxGaWxlKTtcclxuICAgICAgICBjb25zdCBsb2NhbEZpbGVMZW5ndGggPSBzdGF0cy5zaXplO1xyXG4gICAgICAgIGxvZ2dlci5pbmZvKGBSZW1vdGUgZmlsZSBzaXplIGlzICR7cmVtb3RlRmlsZUxlbmd0aH0gYW5kIGxvY2FsIGZpbGUgc2l6ZSBpcyAke2xvY2FsRmlsZUxlbmd0aH1gKTtcclxuICAgICAgICBpZihyZW1vdGVGaWxlTGVuZ3RoICE9IGxvY2FsRmlsZUxlbmd0aCkge1xyXG4gICAgICAgICAgbG9nZ2VyLmluZm8oYFNpemVzIGRpZmZlci4gSGVuY2UgdGhhdCdzIG5lZWRlZCB0byBkb3dubG9hZCBmcmVzaCB2ZXJzaW9uIG9mIHRoZSBhcHBgKTtcclxuICAgICAgICAgIGF3YWl0IGZzLnVubGluayhsb2NhbEZpbGUpO1xyXG4gICAgICAgICAgZG93bmxvYWRJc05lYWRlZCA9IHRydWU7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgIGxvZ2dlci5pbmZvKGBTaXplcyBhcmUgdGhlIHNhbWUuIEhlbmNlIHdpbGwgdXNlIGFscmVhZHkgc3RvcmVkIGFwcGxpY2F0aW9uIGZvciB0aGUgc2Vzc2lvbmApO1xyXG4gICAgICAgICAgbmV3QXBwID0gbG9jYWxGaWxlO1xyXG4gICAgICAgICAgc2hvdWxkVW56aXBBcHAgPSBaSVBfRVhUUy5pbmNsdWRlcyhwYXRoLmV4dG5hbWUobmV3QXBwKSk7XHJcbiAgICAgICAgICBkb3dubG9hZElzTmVhZGVkID0gZmFsc2U7XHJcbiAgICAgICAgfVxyXG4gICAgICB9IGVsc2UgaWYgKGF3YWl0IGZzLmV4aXN0cyhsb2NrRmlsZSkpIHtcclxuICAgICAgICAvLyBXYWl0IGZvciBzb21lIHRpbWUgdGlsbCBBcHAgaXMgZG93bmxvYWRlZCBieSBzb21lIHBhcmFsbGVsIEFwcGl1bSBpbnN0YW5jZVxyXG4gICAgICAgIGNvbnN0IHdhaXRpbmdUaW1lID0gNTAwMDtcclxuICAgICAgICB2YXIgbWF4QXR0ZW1wdHNDb3VudCA9IDUgKiAxMjtcclxuICAgICAgICAvLyBjb25zdCB3YWl0aW5nVGltZSA9IDEwMDA7XHJcbiAgICAgICAgLy8gY29uc3QgbWF4QXR0ZW1wdHNDb3VudCA9IDU7XHJcbiAgICAgICAgdmFyIGF0dGVtcHRzQ291bnQgPSAwO1xyXG4gICAgICAgIHdoaWxlKGF3YWl0IGZzLmV4aXN0cyhsb2NrRmlsZSkgJiYgKGF0dGVtcHRzQ291bnQrKyA8IG1heEF0dGVtcHRzQ291bnQpKSB7XHJcbiAgICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xyXG4gICAgICAgICAgICBsb2dnZXIuaW5mbyhgQXR0ZW1wdCAjJHthdHRlbXB0c0NvdW50fSBmb3IgLmxvY2sgZmlsZSBjaGVja2luZ2ApO1xyXG4gICAgICAgICAgICBzZXRUaW1lb3V0KHJlc29sdmUsIHdhaXRpbmdUaW1lKTtcclxuICAgICAgICAgIH0pO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZihhd2FpdCBmcy5leGlzdHMobG9ja0ZpbGUpKSB7XHJcbiAgICAgICAgICB0aHJvdyBFcnJvcihgLmxvY2sgZmlsZSBmb3IgZG93bmxvYWRpbmcgYXBwbGljYXRpb24gaGFzIG5vdCBkaXNhcHBlYXJlZCBhZnRlciAke3dhaXRpbmdUaW1lICogbWF4QXR0ZW1wdHNDb3VudH1tc2ApO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZighYXdhaXQgZnMuZXhpc3RzKGxvY2FsRmlsZSkpIHtcclxuICAgICAgICAgIHRocm93IEVycm9yKGBMb2NhbCBhcHBsaWNhdGlvbiBmaWxlIGhhcyBub3QgYXBwZWFyZWQgYWZ0ZXIgLmxvY2sgZmlsZSByZW1vdmFsYCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGxvZ2dlci5pbmZvKGBMb2NhbCB2ZXJzaW9uIG9mIGFwcCB3YXMgZm91bmQgYWZ0ZXIgLmxvY2sgZmlsZSByZW1vdmFsLiBXaWxsIHVzZSBpdCBmb3IgbmV3IHNlc3Npb25gKTtcclxuICAgICAgICBuZXdBcHAgPSBsb2NhbEZpbGU7XHJcbiAgICAgICAgc2hvdWxkVW56aXBBcHAgPSBaSVBfRVhUUy5pbmNsdWRlcyhwYXRoLmV4dG5hbWUobmV3QXBwKSk7XHJcbiAgICAgICAgZG93bmxvYWRJc05lYWRlZCA9IGZhbHNlO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIGRvd25sb2FkSXNOZWFkZWQgPSB0cnVlO1xyXG4gICAgICB9XHJcbiAgICAgIGlmKGRvd25sb2FkSXNOZWFkZWQpIHtcclxuICAgICAgbG9nZ2VyLmluZm8oYExvY2FsIHZlcnNpb24gb2YgYXBwIHdhcyBub3QgZm91bmQuIEhlbmNlIHVzaW5nIGRlZmF1bHQgQXBwaXVtIGxvZ2ljIGZvciBkb3dubG9hZGluZ2ApO1xyXG4gICAgICBjb25zdCBzaGFyZWRGb2xkZXJQYXRoID0gYXdhaXQgZ2V0U2hhcmVkRm9sZGVyRm9yQXBwVXJsKGFwcCk7XHJcbiAgICAgIGxvZ2dlci5pbmZvKGBGb2xkZXIgZm9yIGxvY2FsIHNoYXJlZCBhcHBzOiAke3NoYXJlZEZvbGRlclBhdGh9YCk7XHJcbiAgICAgIGF3YWl0IGZzLmNsb3NlKGF3YWl0IGZzLm9wZW4obG9ja0ZpbGUsICd3JykpO1xyXG4gICAgICB0cnkge1xyXG5cclxuICAgICAgY29uc3QgY2FjaGVkUGF0aCA9IGdldENhY2hlZEFwcGxpY2F0aW9uUGF0aChhcHAsIHJlbW90ZUFwcFByb3BzKTtcclxuICAgICAgaWYgKGNhY2hlZFBhdGgpIHtcclxuICAgICAgICBpZiAoYXdhaXQgZnMuZXhpc3RzKGNhY2hlZFBhdGgpKSB7XHJcbiAgICAgICAgICBsb2dnZXIuaW5mbyhgUmV1c2luZyBwcmV2aW91c2x5IGRvd25sb2FkZWQgYXBwbGljYXRpb24gYXQgJyR7Y2FjaGVkUGF0aH0nYCk7XHJcbiAgICAgICAgICByZXR1cm4gdmVyaWZ5QXBwRXh0ZW5zaW9uKGNhY2hlZFBhdGgsIHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBsb2dnZXIuaW5mbyhgVGhlIGFwcGxpY2F0aW9uIGF0ICcke2NhY2hlZFBhdGh9JyBkb2VzIG5vdCBleGlzdCBhbnltb3JlLiBEZWxldGluZyBpdCBmcm9tIHRoZSBjYWNoZWApO1xyXG4gICAgICAgIEFQUExJQ0FUSU9OU19DQUNIRS5kZWwoYXBwKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgbGV0IGZpbGVOYW1lID0gbnVsbDtcclxuICAgICAgY29uc3QgYmFzZW5hbWUgPSBmcy5zYW5pdGl6ZU5hbWUocGF0aC5iYXNlbmFtZShkZWNvZGVVUklDb21wb25lbnQocGF0aG5hbWUpKSwge1xyXG4gICAgICAgIHJlcGxhY2VtZW50OiBTQU5JVElaRV9SRVBMQUNFTUVOVFxyXG4gICAgICB9KTtcclxuICAgICAgY29uc3QgZXh0bmFtZSA9IHBhdGguZXh0bmFtZShiYXNlbmFtZSk7XHJcbiAgICAgIC8vIHRvIGRldGVybWluZSBpZiB3ZSBuZWVkIHRvIHVuemlwIHRoZSBhcHAsIHdlIGhhdmUgYSBudW1iZXIgb2YgcGxhY2VzXHJcbiAgICAgIC8vIHRvIGxvb2s6IGNvbnRlbnQgdHlwZSwgY29udGVudCBkaXNwb3NpdGlvbiwgb3IgdGhlIGZpbGUgZXh0ZW5zaW9uXHJcbiAgICAgIGlmIChaSVBfRVhUUy5pbmNsdWRlcyhleHRuYW1lKSkge1xyXG4gICAgICAgIGZpbGVOYW1lID0gYmFzZW5hbWU7XHJcbiAgICAgICAgc2hvdWxkVW56aXBBcHAgPSB0cnVlO1xyXG4gICAgICB9XHJcbiAgICAgIGlmIChoZWFkZXJzWydjb250ZW50LXR5cGUnXSkge1xyXG4gICAgICAgIGNvbnN0IGN0ID0gaGVhZGVyc1snY29udGVudC10eXBlJ107XHJcbiAgICAgICAgbG9nZ2VyLmRlYnVnKGBDb250ZW50LVR5cGU6ICR7Y3R9YCk7XHJcbiAgICAgICAgLy8gdGhlIGZpbGV0eXBlIG1heSBub3QgYmUgb2J2aW91cyBmb3IgY2VydGFpbiB1cmxzLCBzbyBjaGVjayB0aGUgbWltZSB0eXBlIHRvb1xyXG4gICAgICAgIGlmIChaSVBfTUlNRV9UWVBFUy5zb21lKChtaW1lVHlwZSkgPT4gbmV3IFJlZ0V4cChgXFxcXGIke18uZXNjYXBlUmVnRXhwKG1pbWVUeXBlKX1cXFxcYmApLnRlc3QoY3QpKSkge1xyXG4gICAgICAgICAgaWYgKCFmaWxlTmFtZSkge1xyXG4gICAgICAgICAgICBmaWxlTmFtZSA9IGAke0RFRkFVTFRfQkFTRU5BTUV9LnppcGA7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBzaG91bGRVbnppcEFwcCA9IHRydWU7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIGlmIChoZWFkZXJzWydjb250ZW50LWRpc3Bvc2l0aW9uJ10gJiYgL15hdHRhY2htZW50L2kudGVzdChoZWFkZXJzWydjb250ZW50LWRpc3Bvc2l0aW9uJ10pKSB7XHJcbiAgICAgICAgbG9nZ2VyLmRlYnVnKGBDb250ZW50LURpc3Bvc2l0aW9uOiAke2hlYWRlcnNbJ2NvbnRlbnQtZGlzcG9zaXRpb24nXX1gKTtcclxuICAgICAgICBjb25zdCBtYXRjaCA9IC9maWxlbmFtZT1cIihbXlwiXSspL2kuZXhlYyhoZWFkZXJzWydjb250ZW50LWRpc3Bvc2l0aW9uJ10pO1xyXG4gICAgICAgIGlmIChtYXRjaCkge1xyXG4gICAgICAgICAgZmlsZU5hbWUgPSBmcy5zYW5pdGl6ZU5hbWUobWF0Y2hbMV0sIHtcclxuICAgICAgICAgICAgcmVwbGFjZW1lbnQ6IFNBTklUSVpFX1JFUExBQ0VNRU5UXHJcbiAgICAgICAgICB9KTtcclxuICAgICAgICAgIHNob3VsZFVuemlwQXBwID0gc2hvdWxkVW56aXBBcHAgfHwgWklQX0VYVFMuaW5jbHVkZXMocGF0aC5leHRuYW1lKGZpbGVOYW1lKSk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIGlmICghZmlsZU5hbWUpIHtcclxuICAgICAgICAvLyBhc3NpZ24gdGhlIGRlZmF1bHQgZmlsZSBuYW1lIGFuZCB0aGUgZXh0ZW5zaW9uIGlmIG5vbmUgaGFzIGJlZW4gZGV0ZWN0ZWRcclxuICAgICAgICBjb25zdCByZXN1bHRpbmdOYW1lID0gYmFzZW5hbWVcclxuICAgICAgICAgID8gYmFzZW5hbWUuc3Vic3RyaW5nKDAsIGJhc2VuYW1lLmxlbmd0aCAtIGV4dG5hbWUubGVuZ3RoKVxyXG4gICAgICAgICAgOiBERUZBVUxUX0JBU0VOQU1FO1xyXG4gICAgICAgIGxldCByZXN1bHRpbmdFeHQgPSBleHRuYW1lO1xyXG4gICAgICAgIGlmICghc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucy5pbmNsdWRlcyhyZXN1bHRpbmdFeHQpKSB7XHJcbiAgICAgICAgICBsb2dnZXIuaW5mbyhgVGhlIGN1cnJlbnQgZmlsZSBleHRlbnNpb24gJyR7cmVzdWx0aW5nRXh0fScgaXMgbm90IHN1cHBvcnRlZC4gYCArXHJcbiAgICAgICAgICAgIGBEZWZhdWx0aW5nIHRvICcke18uZmlyc3Qoc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucyl9J2ApO1xyXG4gICAgICAgICAgcmVzdWx0aW5nRXh0ID0gXy5maXJzdChzdXBwb3J0ZWRBcHBFeHRlbnNpb25zKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgZmlsZU5hbWUgPSBgJHtyZXN1bHRpbmdOYW1lfSR7cmVzdWx0aW5nRXh0fWA7XHJcbiAgICAgIH1cclxuICAgICAgY29uc3QgdGFyZ2V0UGF0aCA9IGF3YWl0IHRlbXBEaXIucGF0aCh7XHJcbiAgICAgICAgcHJlZml4OiBmaWxlTmFtZSxcclxuICAgICAgICBzdWZmaXg6ICcnLFxyXG4gICAgICB9KTtcclxuICAgICAgbmV3QXBwID0gYXdhaXQgZG93bmxvYWRBcHAobmV3QXBwLCB0YXJnZXRQYXRoKTtcclxuXHJcbiAgICAgIC8vICoqKioqIEN1c3RvbSBsb2dpYyBmb3IgY29weWluZyBvZiBkb3dubG9hZGVkIGFwcCB0byBzdGF0aWMgbG9jYXRpb24gKioqKipcclxuICAgICAgbG9nZ2VyLmluZm8oYE5ldyBhcHAgcGF0aDogJHtuZXdBcHB9YCk7XHJcbiAgICAgIGF3YWl0IGZzLmNvcHlGaWxlKG5ld0FwcCwgbG9jYWxGaWxlKTtcclxuICAgICAgfVxyXG4gICAgICBmaW5hbGx5IHtcclxuICAgICAgICBsb2dnZXIuaW5mbyhgR29pbmcgdG8gcmVtb3ZlIGxvY2sgZmlsZSAke2xvY2tGaWxlfWApXHJcbiAgICAgICAgYXdhaXQgZnMudW5saW5rKGxvY2tGaWxlKTtcclxuICAgICAgfVxyXG4gICAgICB9XHJcbiAgICB9IGVsc2UgaWYgKGF3YWl0IGZzLmV4aXN0cyhuZXdBcHApKSB7XHJcbiAgICAgIC8vIFVzZSB0aGUgbG9jYWwgYXBwXHJcbiAgICAgIGxvZ2dlci5pbmZvKGBVc2luZyBsb2NhbCBhcHAgJyR7bmV3QXBwfSdgKTtcclxuICAgICAgc2hvdWxkVW56aXBBcHAgPSBaSVBfRVhUUy5pbmNsdWRlcyhwYXRoLmV4dG5hbWUobmV3QXBwKSk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICBsZXQgZXJyb3JNZXNzYWdlID0gYFRoZSBhcHBsaWNhdGlvbiBhdCAnJHtuZXdBcHB9JyBkb2VzIG5vdCBleGlzdCBvciBpcyBub3QgYWNjZXNzaWJsZWA7XHJcbiAgICAgIC8vIHByb3RvY29sIHZhbHVlIGZvciAnQzpcXFxcdGVtcCcgaXMgJ2M6Jywgc28gd2UgY2hlY2sgdGhlIGxlbmd0aCBhcyB3ZWxsXHJcbiAgICAgIGlmIChfLmlzU3RyaW5nKHByb3RvY29sKSAmJiBwcm90b2NvbC5sZW5ndGggPiAyKSB7XHJcbiAgICAgICAgZXJyb3JNZXNzYWdlID0gYFRoZSBwcm90b2NvbCAnJHtwcm90b2NvbH0nIHVzZWQgaW4gJyR7bmV3QXBwfScgaXMgbm90IHN1cHBvcnRlZC4gYCArXHJcbiAgICAgICAgICBgT25seSBodHRwOiBhbmQgaHR0cHM6IHByb3RvY29scyBhcmUgc3VwcG9ydGVkYDtcclxuICAgICAgfVxyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoZXJyb3JNZXNzYWdlKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoc2hvdWxkVW56aXBBcHApIHtcclxuICAgICAgY29uc3QgYXJjaGl2ZVBhdGggPSBuZXdBcHA7XHJcbiAgICAgIGFyY2hpdmVIYXNoID0gYXdhaXQgZnMuaGFzaChhcmNoaXZlUGF0aCk7XHJcbiAgICAgIGlmIChBUFBMSUNBVElPTlNfQ0FDSEUuaGFzKGFwcCkgJiYgYXJjaGl2ZUhhc2ggPT09IEFQUExJQ0FUSU9OU19DQUNIRS5nZXQoYXBwKS5oYXNoKSB7XHJcbiAgICAgICAgY29uc3Qge2Z1bGxQYXRofSA9IEFQUExJQ0FUSU9OU19DQUNIRS5nZXQoYXBwKTtcclxuICAgICAgICBpZiAoYXdhaXQgZnMuZXhpc3RzKGZ1bGxQYXRoKSkge1xyXG4gICAgICAgICAgaWYgKGFyY2hpdmVQYXRoICE9PSBhcHApIHtcclxuICAgICAgICAgICAgYXdhaXQgZnMucmltcmFmKGFyY2hpdmVQYXRoKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIGxvZ2dlci5pbmZvKGBXaWxsIHJldXNlIHByZXZpb3VzbHkgY2FjaGVkIGFwcGxpY2F0aW9uIGF0ICcke2Z1bGxQYXRofSdgKTtcclxuICAgICAgICAgIHJldHVybiB2ZXJpZnlBcHBFeHRlbnNpb24oZnVsbFBhdGgsIHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBsb2dnZXIuaW5mbyhgVGhlIGFwcGxpY2F0aW9uIGF0ICcke2Z1bGxQYXRofScgZG9lcyBub3QgZXhpc3QgYW55bW9yZS4gRGVsZXRpbmcgaXQgZnJvbSB0aGUgY2FjaGVgKTtcclxuICAgICAgICBBUFBMSUNBVElPTlNfQ0FDSEUuZGVsKGFwcCk7XHJcbiAgICAgIH1cclxuICAgICAgY29uc3QgdG1wUm9vdCA9IGF3YWl0IHRlbXBEaXIub3BlbkRpcigpO1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIG5ld0FwcCA9IGF3YWl0IHVuemlwQXBwKGFyY2hpdmVQYXRoLCB0bXBSb290LCBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zKTtcclxuICAgICAgfSBmaW5hbGx5IHtcclxuICAgICAgICBpZiAobmV3QXBwICE9PSBhcmNoaXZlUGF0aCAmJiBhcmNoaXZlUGF0aCAhPT0gYXBwKSB7XHJcbiAgICAgICAgICBhd2FpdCBmcy5yaW1yYWYoYXJjaGl2ZVBhdGgpO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgICBsb2dnZXIuaW5mbyhgVW56aXBwZWQgbG9jYWwgYXBwIHRvICcke25ld0FwcH0nYCk7XHJcbiAgICB9IGVsc2UgaWYgKCFwYXRoLmlzQWJzb2x1dGUobmV3QXBwKSkge1xyXG4gICAgICBuZXdBcHAgPSBwYXRoLnJlc29sdmUocHJvY2Vzcy5jd2QoKSwgbmV3QXBwKTtcclxuICAgICAgbG9nZ2VyLndhcm4oYFRoZSBjdXJyZW50IGFwcGxpY2F0aW9uIHBhdGggJyR7YXBwfScgaXMgbm90IGFic29sdXRlIGAgK1xyXG4gICAgICAgIGBhbmQgaGFzIGJlZW4gcmV3cml0dGVuIHRvICcke25ld0FwcH0nLiBDb25zaWRlciB1c2luZyBhYnNvbHV0ZSBwYXRocyByYXRoZXIgdGhhbiByZWxhdGl2ZWApO1xyXG4gICAgICBhcHAgPSBuZXdBcHA7XHJcbiAgICB9XHJcblxyXG4gICAgdmVyaWZ5QXBwRXh0ZW5zaW9uKG5ld0FwcCwgc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucyk7XHJcblxyXG4gICAgaWYgKGFwcCAhPT0gbmV3QXBwICYmIChhcmNoaXZlSGFzaCB8fCBfLnZhbHVlcyhyZW1vdGVBcHBQcm9wcykuc29tZShCb29sZWFuKSkpIHtcclxuICAgICAgaWYgKEFQUExJQ0FUSU9OU19DQUNIRS5oYXMoYXBwKSkge1xyXG4gICAgICAgIGNvbnN0IHtmdWxsUGF0aH0gPSBBUFBMSUNBVElPTlNfQ0FDSEUuZ2V0KGFwcCk7XHJcbiAgICAgICAgLy8gQ2xlYW4gdXAgdGhlIG9ic29sZXRlIGVudHJ5IGZpcnN0IGlmIG5lZWRlZFxyXG4gICAgICAgIGlmIChmdWxsUGF0aCAhPT0gbmV3QXBwICYmIGF3YWl0IGZzLmV4aXN0cyhmdWxsUGF0aCkpIHtcclxuICAgICAgICAgIGF3YWl0IGZzLnJpbXJhZihmdWxsUGF0aCk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIEFQUExJQ0FUSU9OU19DQUNIRS5zZXQoYXBwLCB7XHJcbiAgICAgICAgLi4ucmVtb3RlQXBwUHJvcHMsXHJcbiAgICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxyXG4gICAgICAgIGhhc2g6IGFyY2hpdmVIYXNoLFxyXG4gICAgICAgIGZ1bGxQYXRoOiBuZXdBcHAsXHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIG5ld0FwcDtcclxuICB9KTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gZG93bmxvYWRBcHAgKGFwcCwgdGFyZ2V0UGF0aCkge1xyXG4gIGNvbnN0IHtocmVmfSA9IHVybC5wYXJzZShhcHApO1xyXG4gIHRyeSB7XHJcbiAgICBhd2FpdCBuZXQuZG93bmxvYWRGaWxlKGhyZWYsIHRhcmdldFBhdGgsIHtcclxuICAgICAgdGltZW91dDogQVBQX0RPV05MT0FEX1RJTUVPVVRfTVMsXHJcbiAgICB9KTtcclxuICB9IGNhdGNoIChlcnIpIHtcclxuICAgIHRocm93IG5ldyBFcnJvcihgVW5hYmxlIHRvIGRvd25sb2FkIHRoZSBhcHA6ICR7ZXJyLm1lc3NhZ2V9YCk7XHJcbiAgfVxyXG4gIHJldHVybiB0YXJnZXRQYXRoO1xyXG59XHJcblxyXG4vKipcclxuICogRXh0cmFjdHMgdGhlIGJ1bmRsZSBmcm9tIGFuIGFyY2hpdmUgaW50byB0aGUgZ2l2ZW4gZm9sZGVyXHJcbiAqXHJcbiAqIEBwYXJhbSB7c3RyaW5nfSB6aXBQYXRoIEZ1bGwgcGF0aCB0byB0aGUgYXJjaGl2ZSBjb250YWluaW5nIHRoZSBidW5kbGVcclxuICogQHBhcmFtIHtzdHJpbmd9IGRzdFJvb3QgRnVsbCBwYXRoIHRvIHRoZSBmb2xkZXIgd2hlcmUgdGhlIGV4dHJhY3RlZCBidW5kbGVcclxuICogc2hvdWxkIGJlIHBsYWNlZFxyXG4gKiBAcGFyYW0ge0FycmF5PHN0cmluZz58c3RyaW5nfSBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zIFRoZSBsaXN0IG9mIGV4dGVuc2lvbnNcclxuICogdGhlIHRhcmdldCBhcHBsaWNhdGlvbiBidW5kbGUgc3VwcG9ydHMsIGZvciBleGFtcGxlIFsnLmFwaycsICcuYXBrcyddIGZvclxyXG4gKiBBbmRyb2lkIHBhY2thZ2VzXHJcbiAqIEByZXR1cm5zIHtzdHJpbmd9IEZ1bGwgcGF0aCB0byB0aGUgYnVuZGxlIGluIHRoZSBkZXN0aW5hdGlvbiBmb2xkZXJcclxuICogQHRocm93cyB7RXJyb3J9IElmIHRoZSBnaXZlbiBhcmNoaXZlIGlzIGludmFsaWQgb3Igbm8gYXBwbGljYXRpb24gYnVuZGxlc1xyXG4gKiBoYXZlIGJlZW4gZm91bmQgaW5zaWRlXHJcbiAqL1xyXG5hc3luYyBmdW5jdGlvbiB1bnppcEFwcCAoemlwUGF0aCwgZHN0Um9vdCwgc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucykge1xyXG4gIGF3YWl0IHppcC5hc3NlcnRWYWxpZFppcCh6aXBQYXRoKTtcclxuXHJcbiAgaWYgKCFfLmlzQXJyYXkoc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucykpIHtcclxuICAgIHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMgPSBbc3VwcG9ydGVkQXBwRXh0ZW5zaW9uc107XHJcbiAgfVxyXG5cclxuICBjb25zdCB0bXBSb290ID0gYXdhaXQgdGVtcERpci5vcGVuRGlyKCk7XHJcbiAgdHJ5IHtcclxuICAgIGxvZ2dlci5kZWJ1ZyhgVW56aXBwaW5nICcke3ppcFBhdGh9J2ApO1xyXG4gICAgY29uc3QgdGltZXIgPSBuZXcgdGltaW5nLlRpbWVyKCkuc3RhcnQoKTtcclxuICAgIGNvbnN0IHVzZVN5c3RlbVVuemlwRW52ID0gcHJvY2Vzcy5lbnYuQVBQSVVNX1BSRUZFUl9TWVNURU1fVU5aSVA7XHJcbiAgICBjb25zdCB1c2VTeXN0ZW1VbnppcCA9IF8uaXNFbXB0eSh1c2VTeXN0ZW1VbnppcEVudilcclxuICAgICAgfHwgIVsnMCcsICdmYWxzZSddLmluY2x1ZGVzKF8udG9Mb3dlcih1c2VTeXN0ZW1VbnppcEVudikpO1xyXG4gICAgLyoqXHJcbiAgICAgKiBBdHRlbXB0IHRvIHVzZSB1c2UgdGhlIHN5c3RlbSBgdW56aXBgIChlLmcuLCBgL3Vzci9iaW4vdW56aXBgKSBkdWVcclxuICAgICAqIHRvIHRoZSBzaWduaWZpY2FudCBwZXJmb3JtYW5jZSBpbXByb3ZlbWVudCBpdCBwcm92aWRlcyBvdmVyIHRoZSBuYXRpdmVcclxuICAgICAqIEpTIFwidW56aXBcIiBpbXBsZW1lbnRhdGlvbi5cclxuICAgICAqIEB0eXBlIHtpbXBvcnQoJ2FwcGl1bS1zdXBwb3J0L2xpYi96aXAnKS5FeHRyYWN0QWxsT3B0aW9uc31cclxuICAgICAqL1xyXG4gICAgY29uc3QgZXh0cmFjdGlvbk9wdHMgPSB7dXNlU3lzdGVtVW56aXB9O1xyXG4gICAgLy8gaHR0cHM6Ly9naXRodWIuY29tL2FwcGl1bS9hcHBpdW0vaXNzdWVzLzE0MTAwXHJcbiAgICBpZiAocGF0aC5leHRuYW1lKHppcFBhdGgpID09PSBJUEFfRVhUKSB7XHJcbiAgICAgIGxvZ2dlci5kZWJ1ZyhgRW5mb3JjaW5nIFVURi04IGVuY29kaW5nIG9uIHRoZSBleHRyYWN0ZWQgZmlsZSBuYW1lcyBmb3IgJyR7cGF0aC5iYXNlbmFtZSh6aXBQYXRoKX0nYCk7XHJcbiAgICAgIGV4dHJhY3Rpb25PcHRzLmZpbGVOYW1lc0VuY29kaW5nID0gJ3V0ZjgnO1xyXG4gICAgfVxyXG4gICAgYXdhaXQgemlwLmV4dHJhY3RBbGxUbyh6aXBQYXRoLCB0bXBSb290LCBleHRyYWN0aW9uT3B0cyk7XHJcbiAgICBjb25zdCBnbG9iUGF0dGVybiA9IGAqKi8qLisoJHtzdXBwb3J0ZWRBcHBFeHRlbnNpb25zLm1hcCgoZXh0KSA9PiBleHQucmVwbGFjZSgvXlxcLi8sICcnKSkuam9pbignfCcpfSlgO1xyXG4gICAgY29uc3Qgc29ydGVkQnVuZGxlSXRlbXMgPSAoYXdhaXQgZnMuZ2xvYihnbG9iUGF0dGVybiwge1xyXG4gICAgICBjd2Q6IHRtcFJvb3QsXHJcbiAgICAgIHN0cmljdDogZmFsc2UsXHJcbiAgICAvLyBHZXQgdGhlIHRvcCBsZXZlbCBtYXRjaFxyXG4gICAgfSkpLnNvcnQoKGEsIGIpID0+IGEuc3BsaXQocGF0aC5zZXApLmxlbmd0aCAtIGIuc3BsaXQocGF0aC5zZXApLmxlbmd0aCk7XHJcbiAgICBpZiAoXy5pc0VtcHR5KHNvcnRlZEJ1bmRsZUl0ZW1zKSkge1xyXG4gICAgICBsb2dnZXIuZXJyb3JBbmRUaHJvdyhgQXBwIHVuemlwcGVkIE9LLCBidXQgd2UgY291bGQgbm90IGZpbmQgYW55ICcke3N1cHBvcnRlZEFwcEV4dGVuc2lvbnN9JyBgICtcclxuICAgICAgICB1dGlsLnBsdXJhbGl6ZSgnYnVuZGxlJywgc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucy5sZW5ndGgsIGZhbHNlKSArXHJcbiAgICAgICAgYCBpbiBpdC4gTWFrZSBzdXJlIHlvdXIgYXJjaGl2ZSBjb250YWlucyBhdCBsZWFzdCBvbmUgcGFja2FnZSBoYXZpbmcgYCArXHJcbiAgICAgICAgYCcke3N1cHBvcnRlZEFwcEV4dGVuc2lvbnN9JyAke3V0aWwucGx1cmFsaXplKCdleHRlbnNpb24nLCBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zLmxlbmd0aCwgZmFsc2UpfWApO1xyXG4gICAgfVxyXG4gICAgbG9nZ2VyLmRlYnVnKGBFeHRyYWN0ZWQgJHt1dGlsLnBsdXJhbGl6ZSgnYnVuZGxlIGl0ZW0nLCBzb3J0ZWRCdW5kbGVJdGVtcy5sZW5ndGgsIHRydWUpfSBgICtcclxuICAgICAgYGZyb20gJyR7emlwUGF0aH0nIGluICR7TWF0aC5yb3VuZCh0aW1lci5nZXREdXJhdGlvbigpLmFzTWlsbGlTZWNvbmRzKX1tczogJHtzb3J0ZWRCdW5kbGVJdGVtc31gKTtcclxuICAgIGNvbnN0IG1hdGNoZWRCdW5kbGUgPSBfLmZpcnN0KHNvcnRlZEJ1bmRsZUl0ZW1zKTtcclxuICAgIGxvZ2dlci5pbmZvKGBBc3N1bWluZyAnJHttYXRjaGVkQnVuZGxlfScgaXMgdGhlIGNvcnJlY3QgYnVuZGxlYCk7XHJcbiAgICBjb25zdCBkc3RQYXRoID0gcGF0aC5yZXNvbHZlKGRzdFJvb3QsIHBhdGguYmFzZW5hbWUobWF0Y2hlZEJ1bmRsZSkpO1xyXG4gICAgYXdhaXQgZnMubXYocGF0aC5yZXNvbHZlKHRtcFJvb3QsIG1hdGNoZWRCdW5kbGUpLCBkc3RQYXRoLCB7bWtkaXJwOiB0cnVlfSk7XHJcbiAgICByZXR1cm4gZHN0UGF0aDtcclxuICB9IGZpbmFsbHkge1xyXG4gICAgYXdhaXQgZnMucmltcmFmKHRtcFJvb3QpO1xyXG4gIH1cclxufVxyXG5cclxuZnVuY3Rpb24gaXNQYWNrYWdlT3JCdW5kbGUgKGFwcCkge1xyXG4gIHJldHVybiAoL14oW2EtekEtWjAtOVxcLV9dK1xcLlthLXpBLVowLTlcXC1fXSspKyQvKS50ZXN0KGFwcCk7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBGaW5kcyBhbGwgaW5zdGFuY2VzICdmaXJzdEtleScgYW5kIGNyZWF0ZSBhIGR1cGxpY2F0ZSB3aXRoIHRoZSBrZXkgJ3NlY29uZEtleScsXHJcbiAqIERvIHRoZSBzYW1lIHRoaW5nIGluIHJldmVyc2UuIElmIHdlIGZpbmQgJ3NlY29uZEtleScsIGNyZWF0ZSBhIGR1cGxpY2F0ZSB3aXRoIHRoZSBrZXkgJ2ZpcnN0S2V5Jy5cclxuICpcclxuICogVGhpcyB3aWxsIGNhdXNlIGtleXMgdG8gYmUgb3ZlcndyaXR0ZW4gaWYgdGhlIG9iamVjdCBjb250YWlucyAnZmlyc3RLZXknIGFuZCAnc2Vjb25kS2V5Jy5cclxuXHJcbiAqIEBwYXJhbSB7Kn0gaW5wdXQgQW55IHR5cGUgb2YgaW5wdXRcclxuICogQHBhcmFtIHtTdHJpbmd9IGZpcnN0S2V5IFRoZSBmaXJzdCBrZXkgdG8gZHVwbGljYXRlXHJcbiAqIEBwYXJhbSB7U3RyaW5nfSBzZWNvbmRLZXkgVGhlIHNlY29uZCBrZXkgdG8gZHVwbGljYXRlXHJcbiAqL1xyXG5mdW5jdGlvbiBkdXBsaWNhdGVLZXlzIChpbnB1dCwgZmlyc3RLZXksIHNlY29uZEtleSkge1xyXG4gIC8vIElmIGFycmF5IHByb3ZpZGVkLCByZWN1cnNpdmVseSBjYWxsIG9uIGFsbCBlbGVtZW50c1xyXG4gIGlmIChfLmlzQXJyYXkoaW5wdXQpKSB7XHJcbiAgICByZXR1cm4gaW5wdXQubWFwKChpdGVtKSA9PiBkdXBsaWNhdGVLZXlzKGl0ZW0sIGZpcnN0S2V5LCBzZWNvbmRLZXkpKTtcclxuICB9XHJcblxyXG4gIC8vIElmIG9iamVjdCwgY3JlYXRlIGR1cGxpY2F0ZXMgZm9yIGtleXMgYW5kIHRoZW4gcmVjdXJzaXZlbHkgY2FsbCBvbiB2YWx1ZXNcclxuICBpZiAoXy5pc1BsYWluT2JqZWN0KGlucHV0KSkge1xyXG4gICAgY29uc3QgcmVzdWx0T2JqID0ge307XHJcbiAgICBmb3IgKGxldCBba2V5LCB2YWx1ZV0gb2YgXy50b1BhaXJzKGlucHV0KSkge1xyXG4gICAgICBjb25zdCByZWN1cnNpdmVseUNhbGxlZFZhbHVlID0gZHVwbGljYXRlS2V5cyh2YWx1ZSwgZmlyc3RLZXksIHNlY29uZEtleSk7XHJcbiAgICAgIGlmIChrZXkgPT09IGZpcnN0S2V5KSB7XHJcbiAgICAgICAgcmVzdWx0T2JqW3NlY29uZEtleV0gPSByZWN1cnNpdmVseUNhbGxlZFZhbHVlO1xyXG4gICAgICB9IGVsc2UgaWYgKGtleSA9PT0gc2Vjb25kS2V5KSB7XHJcbiAgICAgICAgcmVzdWx0T2JqW2ZpcnN0S2V5XSA9IHJlY3Vyc2l2ZWx5Q2FsbGVkVmFsdWU7XHJcbiAgICAgIH1cclxuICAgICAgcmVzdWx0T2JqW2tleV0gPSByZWN1cnNpdmVseUNhbGxlZFZhbHVlO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHJlc3VsdE9iajtcclxuICB9XHJcblxyXG4gIC8vIEJhc2UgY2FzZS4gUmV0dXJuIHByaW1pdGl2ZXMgd2l0aG91dCBkb2luZyBhbnl0aGluZy5cclxuICByZXR1cm4gaW5wdXQ7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBUYWtlcyBhIGRlc2lyZWQgY2FwYWJpbGl0eSBhbmQgdHJpZXMgdG8gSlNPTi5wYXJzZSBpdCBhcyBhbiBhcnJheSxcclxuICogYW5kIGVpdGhlciByZXR1cm5zIHRoZSBwYXJzZWQgYXJyYXkgb3IgYSBzaW5nbGV0b24gYXJyYXkuXHJcbiAqXHJcbiAqIEBwYXJhbSB7c3RyaW5nfEFycmF5PFN0cmluZz59IGNhcCBBIGRlc2lyZWQgY2FwYWJpbGl0eVxyXG4gKi9cclxuZnVuY3Rpb24gcGFyc2VDYXBzQXJyYXkgKGNhcCkge1xyXG4gIGlmIChfLmlzQXJyYXkoY2FwKSkge1xyXG4gICAgcmV0dXJuIGNhcDtcclxuICB9XHJcblxyXG4gIGxldCBwYXJzZWRDYXBzO1xyXG4gIHRyeSB7XHJcbiAgICBwYXJzZWRDYXBzID0gSlNPTi5wYXJzZShjYXApO1xyXG4gICAgaWYgKF8uaXNBcnJheShwYXJzZWRDYXBzKSkge1xyXG4gICAgICByZXR1cm4gcGFyc2VkQ2FwcztcclxuICAgIH1cclxuICB9IGNhdGNoIChpZ24pIHtcclxuICAgIGxvZ2dlci53YXJuKGBGYWlsZWQgdG8gcGFyc2UgY2FwYWJpbGl0eSBhcyBKU09OIGFycmF5YCk7XHJcbiAgfVxyXG4gIGlmIChfLmlzU3RyaW5nKGNhcCkpIHtcclxuICAgIHJldHVybiBbY2FwXTtcclxuICB9XHJcbiAgdGhyb3cgbmV3IEVycm9yKGBtdXN0IHByb3ZpZGUgYSBzdHJpbmcgb3IgSlNPTiBBcnJheTsgcmVjZWl2ZWQgJHtjYXB9YCk7XHJcbn1cclxuXHJcbmV4cG9ydCB7XHJcbiAgY29uZmlndXJlQXBwLCBpc1BhY2thZ2VPckJ1bmRsZSwgZHVwbGljYXRlS2V5cywgcGFyc2VDYXBzQXJyYXlcclxufTtcclxuIl0sImZpbGUiOiJsaWIvYmFzZWRyaXZlci9oZWxwZXJzLmpzIiwic291cmNlUm9vdCI6Ii4uXFwuLlxcLi4ifQ==
