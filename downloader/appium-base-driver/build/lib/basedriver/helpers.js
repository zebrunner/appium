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

      let downloadIsNeaded = true;
      const localAppsFolder = await (0, _mcloudUtils.getLocalAppsFolder)();
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


//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImxpYi9iYXNlZHJpdmVyL2hlbHBlcnMuanMiXSwibmFtZXMiOlsiSVBBX0VYVCIsIlpJUF9FWFRTIiwiWklQX01JTUVfVFlQRVMiLCJDQUNIRURfQVBQU19NQVhfQUdFIiwiQVBQTElDQVRJT05TX0NBQ0hFIiwiTFJVIiwibWF4QWdlIiwidXBkYXRlQWdlT25HZXQiLCJkaXNwb3NlIiwiYXBwIiwiZnVsbFBhdGgiLCJmcyIsImV4aXN0cyIsImxvZ2dlciIsImluZm8iLCJyaW1yYWYiLCJub0Rpc3Bvc2VPblNldCIsIkFQUExJQ0FUSU9OU19DQUNIRV9HVUFSRCIsIkFzeW5jTG9jayIsIlNBTklUSVpFX1JFUExBQ0VNRU5UIiwiREVGQVVMVF9CQVNFTkFNRSIsIkFQUF9ET1dOTE9BRF9USU1FT1VUX01TIiwicHJvY2VzcyIsIm9uIiwiaXRlbUNvdW50IiwiYXBwUGF0aHMiLCJ2YWx1ZXMiLCJtYXAiLCJkZWJ1ZyIsImxlbmd0aCIsInV0aWwiLCJwbHVyYWxpemUiLCJhcHBQYXRoIiwicmltcmFmU3luYyIsImUiLCJ3YXJuIiwibWVzc2FnZSIsInJldHJpZXZlSGVhZGVycyIsImxpbmsiLCJ1cmwiLCJtZXRob2QiLCJ0aW1lb3V0IiwiaGVhZGVycyIsImdldENhY2hlZEFwcGxpY2F0aW9uUGF0aCIsImN1cnJlbnRBcHBQcm9wcyIsInJlZnJlc2giLCJoYXMiLCJsYXN0TW9kaWZpZWQiLCJjdXJyZW50TW9kaWZpZWQiLCJpbW11dGFibGUiLCJjdXJyZW50SW1tdXRhYmxlIiwiY3VycmVudE1heEFnZSIsInRpbWVzdGFtcCIsImdldCIsImdldFRpbWUiLCJtc0xlZnQiLCJEYXRlIiwibm93IiwicGF0aCIsImJhc2VuYW1lIiwidmVyaWZ5QXBwRXh0ZW5zaW9uIiwic3VwcG9ydGVkQXBwRXh0ZW5zaW9ucyIsImluY2x1ZGVzIiwiZXh0bmFtZSIsIkVycm9yIiwiY29uZmlndXJlQXBwIiwiXyIsImlzU3RyaW5nIiwiaXNBcnJheSIsIm5ld0FwcCIsInNob3VsZFVuemlwQXBwIiwiYXJjaGl2ZUhhc2giLCJyZW1vdGVBcHBQcm9wcyIsInByb3RvY29sIiwicGF0aG5hbWUiLCJwYXJzZSIsImlzVXJsIiwiYWNxdWlyZSIsImlzRW1wdHkiLCJ0ZXN0IiwibWF4QWdlTWF0Y2giLCJleGVjIiwicGFyc2VJbnQiLCJkb3dubG9hZElzTmVhZGVkIiwibG9jYWxBcHBzRm9sZGVyIiwibG9jYWxGaWxlIiwibG9ja0ZpbGUiLCJ1bmRlZmluZWQiLCJyZW1vdGVGaWxlTGVuZ3RoIiwic3RhdHMiLCJzdGF0IiwibG9jYWxGaWxlTGVuZ3RoIiwic2l6ZSIsInVubGluayIsIndhaXRpbmdUaW1lIiwibWF4QXR0ZW1wdHNDb3VudCIsImF0dGVtcHRzQ291bnQiLCJQcm9taXNlIiwicmVzb2x2ZSIsInNldFRpbWVvdXQiLCJzaGFyZWRGb2xkZXJQYXRoIiwiY2xvc2UiLCJvcGVuIiwiY2FjaGVkUGF0aCIsImRlbCIsImZpbGVOYW1lIiwic2FuaXRpemVOYW1lIiwiZGVjb2RlVVJJQ29tcG9uZW50IiwicmVwbGFjZW1lbnQiLCJjdCIsInNvbWUiLCJtaW1lVHlwZSIsIlJlZ0V4cCIsImVzY2FwZVJlZ0V4cCIsIm1hdGNoIiwicmVzdWx0aW5nTmFtZSIsInN1YnN0cmluZyIsInJlc3VsdGluZ0V4dCIsImZpcnN0IiwidGFyZ2V0UGF0aCIsInRlbXBEaXIiLCJwcmVmaXgiLCJzdWZmaXgiLCJkb3dubG9hZEFwcCIsImNvcHlGaWxlIiwiZXJyb3JNZXNzYWdlIiwiYXJjaGl2ZVBhdGgiLCJoYXNoIiwidG1wUm9vdCIsIm9wZW5EaXIiLCJ1bnppcEFwcCIsImlzQWJzb2x1dGUiLCJjd2QiLCJCb29sZWFuIiwic2V0IiwiaHJlZiIsIm5ldCIsImRvd25sb2FkRmlsZSIsImVyciIsInppcFBhdGgiLCJkc3RSb290IiwiemlwIiwiYXNzZXJ0VmFsaWRaaXAiLCJ0aW1lciIsInRpbWluZyIsIlRpbWVyIiwic3RhcnQiLCJ1c2VTeXN0ZW1VbnppcEVudiIsImVudiIsIkFQUElVTV9QUkVGRVJfU1lTVEVNX1VOWklQIiwidXNlU3lzdGVtVW56aXAiLCJ0b0xvd2VyIiwiZXh0cmFjdGlvbk9wdHMiLCJmaWxlTmFtZXNFbmNvZGluZyIsImV4dHJhY3RBbGxUbyIsImdsb2JQYXR0ZXJuIiwiZXh0IiwicmVwbGFjZSIsImpvaW4iLCJzb3J0ZWRCdW5kbGVJdGVtcyIsImdsb2IiLCJzdHJpY3QiLCJzb3J0IiwiYSIsImIiLCJzcGxpdCIsInNlcCIsImVycm9yQW5kVGhyb3ciLCJNYXRoIiwicm91bmQiLCJnZXREdXJhdGlvbiIsImFzTWlsbGlTZWNvbmRzIiwibWF0Y2hlZEJ1bmRsZSIsImRzdFBhdGgiLCJtdiIsIm1rZGlycCIsImlzUGFja2FnZU9yQnVuZGxlIiwiZHVwbGljYXRlS2V5cyIsImlucHV0IiwiZmlyc3RLZXkiLCJzZWNvbmRLZXkiLCJpdGVtIiwiaXNQbGFpbk9iamVjdCIsInJlc3VsdE9iaiIsImtleSIsInZhbHVlIiwidG9QYWlycyIsInJlY3Vyc2l2ZWx5Q2FsbGVkVmFsdWUiLCJwYXJzZUNhcHNBcnJheSIsImNhcCIsInBhcnNlZENhcHMiLCJKU09OIiwiaWduIl0sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7OztBQUFBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUVBLE1BQU1BLE9BQU8sR0FBRyxNQUFoQjtBQUNBLE1BQU1DLFFBQVEsR0FBRyxDQUFDLE1BQUQsRUFBU0QsT0FBVCxDQUFqQjtBQUNBLE1BQU1FLGNBQWMsR0FBRyxDQUNyQixpQkFEcUIsRUFFckIsOEJBRnFCLEVBR3JCLGlCQUhxQixDQUF2QjtBQUtBLE1BQU1DLG1CQUFtQixHQUFHLE9BQU8sRUFBUCxHQUFZLEVBQVosR0FBaUIsRUFBN0M7QUFDQSxNQUFNQyxrQkFBa0IsR0FBRyxJQUFJQyxpQkFBSixDQUFRO0FBQ2pDQyxFQUFBQSxNQUFNLEVBQUVILG1CQUR5QjtBQUVqQ0ksRUFBQUEsY0FBYyxFQUFFLElBRmlCO0FBR2pDQyxFQUFBQSxPQUFPLEVBQUUsT0FBT0Ms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QUF5QkMsR0FBekIsRUFBOEI7QUFDNUIsTUFBSTNILGdCQUFFRSxPQUFGLENBQVV5SCxHQUFWLENBQUosRUFBb0I7QUFDbEIsV0FBT0EsR0FBUDtBQUNEOztBQUVELE1BQUlDLFVBQUo7O0FBQ0EsTUFBSTtBQUNGQSxJQUFBQSxVQUFVLEdBQUdDLElBQUksQ0FBQ3BILEtBQUwsQ0FBV2tILEdBQVgsQ0FBYjs7QUFDQSxRQUFJM0gsZ0JBQUVFLE9BQUYsQ0FBVTBILFVBQVYsQ0FBSixFQUEyQjtBQUN6QixhQUFPQSxVQUFQO0FBQ0Q7QUFDRixHQUxELENBS0UsT0FBT0UsR0FBUCxFQUFZO0FBQ1puTCxvQkFBT3NCLElBQVAsQ0FBYSwwQ0FBYjtBQUNEOztBQUNELE1BQUkrQixnQkFBRUMsUUFBRixDQUFXMEgsR0FBWCxDQUFKLEVBQXFCO0FBQ25CLFdBQU8sQ0FBQ0EsR0FBRCxDQUFQO0FBQ0Q7O0FBQ0QsUUFBTSxJQUFJN0gsS0FBSixDQUFXLGlEQUFnRDZILEdBQUksRUFBL0QsQ0FBTjtBQUNEIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IF8gZnJvbSAnbG9kYXNoJztcclxuaW1wb3J0IHBhdGggZnJvbSAncGF0aCc7XHJcbmltcG9ydCB1cmwgZnJvbSAndXJsJztcclxuaW1wb3J0IGxvZ2dlciBmcm9tICcuL2xvZ2dlcic7XHJcbmltcG9ydCB7IHRlbXBEaXIsIGZzLCB1dGlsLCB6aXAsIG5ldCwgdGltaW5nIH0gZnJvbSAnYXBwaXVtLXN1cHBvcnQnO1xyXG5pbXBvcnQgTFJVIGZyb20gJ2xydS1jYWNoZSc7XHJcbmltcG9ydCBBc3luY0xvY2sgZnJvbSAnYXN5bmMtbG9jayc7XHJcbmltcG9ydCBheGlvcyBmcm9tICdheGlvcyc7XHJcbmltcG9ydCB7IGdldExvY2FsQXBwc0ZvbGRlciwgZ2V0U2hhcmVkRm9sZGVyRm9yQXBwVXJsLCBnZXRMb2NhbEZpbGVGb3JBcHBVcmwsIGdldEZpbGVDb250ZW50TGVuZ3RoIH0gZnJvbSAnLi9tY2xvdWQtdXRpbHMnO1xyXG5cclxuY29uc3QgSVBBX0VYVCA9ICcuaXBhJztcclxuY29uc3QgWklQX0VYVFMgPSBbJy56aXAnLCBJUEFfRVhUXTtcclxuY29uc3QgWklQX01JTUVfVFlQRVMgPSBbXHJcbiAgJ2FwcGxpY2F0aW9uL3ppcCcsXHJcbiAgJ2FwcGxpY2F0aW9uL3gtemlwLWNvbXByZXNzZWQnLFxyXG4gICdtdWx0aXBhcnQveC16aXAnLFxyXG5dO1xyXG5jb25zdCBDQUNIRURfQVBQU19NQVhfQUdFID0gMTAwMCAqIDYwICogNjAgKiAyNDsgLy8gbXNcclxuY29uc3QgQVBQTElDQVRJT05TX0NBQ0hFID0gbmV3IExSVSh7XHJcbiAgbWF4QWdlOiBDQUNIRURfQVBQU19NQVhfQUdFLCAvLyBleHBpcmUgYWZ0ZXIgMjQgaG91cnNcclxuICB1cGRhdGVBZ2VPbkdldDogdHJ1ZSxcclxuICBkaXNwb3NlOiBhc3luYyAoYXBwLCB7ZnVsbFBhdGh9KSA9PiB7XHJcbiAgICBpZiAoIWF3YWl0IGZzLmV4aXN0cyhmdWxsUGF0aCkpIHtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIGxvZ2dlci5pbmZvKGBUaGUgYXBwbGljYXRpb24gJyR7YXBwfScgY2FjaGVkIGF0ICcke2Z1bGxQYXRofScgaGFzIGV4cGlyZWRgKTtcclxuICAgIGF3YWl0IGZzLnJpbXJhZihmdWxsUGF0aCk7XHJcbiAgfSxcclxuICBub0Rpc3Bvc2VPblNldDogdHJ1ZSxcclxufSk7XHJcbmNvbnN0IEFQUExJQ0FUSU9OU19DQUNIRV9HVUFSRCA9IG5ldyBBc3luY0xvY2soKTtcclxuY29uc3QgU0FOSVRJWkVfUkVQTEFDRU1FTlQgPSAnLSc7XHJcbmNvbnN0IERFRkFVTFRfQkFTRU5BTUUgPSAnYXBwaXVtLWFwcCc7XHJcbmNvbnN0IEFQUF9ET1dOTE9BRF9USU1FT1VUX01TID0gMTIwICogMTAwMDtcclxuXHJcbnByb2Nlc3Mub24oJ2V4aXQnLCAoKSA9PiB7XHJcbiAgaWYgKEFQUExJQ0FUSU9OU19DQUNIRS5pdGVtQ291bnQgPT09IDApIHtcclxuICAgIHJldHVybjtcclxuICB9XHJcblxyXG4gIGNvbnN0IGFwcFBhdGhzID0gQVBQTElDQVRJT05TX0NBQ0hFLnZhbHVlcygpXHJcbiAgICAubWFwKCh7ZnVsbFBhdGh9KSA9PiBmdWxsUGF0aCk7XHJcbiAgbG9nZ2VyLmRlYnVnKGBQZXJmb3JtaW5nIGNsZWFudXAgb2YgJHthcHBQYXRocy5sZW5ndGh9IGNhY2hlZCBgICtcclxuICAgIHV0aWwucGx1cmFsaXplKCdhcHBsaWNhdGlvbicsIGFwcFBhdGhzLmxlbmd0aCkpO1xyXG4gIGZvciAoY29uc3QgYXBwUGF0aCBvZiBhcHBQYXRocykge1xyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gQXN5bmNocm9ub3VzIGNhbGxzIGFyZSBub3Qgc3VwcG9ydGVkIGluIG9uRXhpdCBoYW5kbGVyXHJcbiAgICAgIGZzLnJpbXJhZlN5bmMoYXBwUGF0aCk7XHJcbiAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgIGxvZ2dlci53YXJuKGUubWVzc2FnZSk7XHJcbiAgICB9XHJcbiAgfVxyXG59KTtcclxuXHJcblxyXG5hc3luYyBmdW5jdGlvbiByZXRyaWV2ZUhlYWRlcnMgKGxpbmspIHtcclxuICB0cnkge1xyXG4gICAgcmV0dXJuIChhd2FpdCBheGlvcyh7XHJcbiAgICAgIHVybDogbGluayxcclxuICAgICAgbWV0aG9kOiAnSEVBRCcsXHJcbiAgICAgIHRpbWVvdXQ6IDUwMDAsXHJcbiAgICB9KSkuaGVhZGVycztcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBsb2dnZXIuaW5mbyhgQ2Fubm90IHNlbmQgSEVBRCByZXF1ZXN0IHRvICcke2xpbmt9Jy4gT3JpZ2luYWwgZXJyb3I6ICR7ZS5tZXNzYWdlfWApO1xyXG4gIH1cclxuICByZXR1cm4ge307XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGdldENhY2hlZEFwcGxpY2F0aW9uUGF0aCAobGluaywgY3VycmVudEFwcFByb3BzID0ge30pIHtcclxuICBjb25zdCByZWZyZXNoID0gKCkgPT4ge1xyXG4gICAgbG9nZ2VyLmluZm8oYENVU1RPTSBIRUxQRVIhYCk7XHJcbiAgICBsb2dnZXIuZGVidWcoYEEgZnJlc2ggY29weSBvZiB0aGUgYXBwbGljYXRpb24gaXMgZ29pbmcgdG8gYmUgZG93bmxvYWRlZCBmcm9tICR7bGlua31gKTtcclxuICAgIHJldHVybiBudWxsO1xyXG4gIH07XHJcblxyXG4gIGlmIChBUFBMSUNBVElPTlNfQ0FDSEUuaGFzKGxpbmspKSB7XHJcbiAgICBjb25zdCB7XHJcbiAgICAgIGxhc3RNb2RpZmllZDogY3VycmVudE1vZGlmaWVkLFxyXG4gICAgICBpbW11dGFibGU6IGN1cnJlbnRJbW11dGFibGUsXHJcbiAgICAgIC8vIG1heEFnZSBpcyBpbiBzZWNvbmRzXHJcbiAgICAgIG1heEFnZTogY3VycmVudE1heEFnZSxcclxuICAgIH0gPSBjdXJyZW50QXBwUHJvcHM7XHJcbiAgICBjb25zdCB7XHJcbiAgICAgIC8vIERhdGUgaW5zdGFuY2VcclxuICAgICAgbGFzdE1vZGlmaWVkLFxyXG4gICAgICAvLyBib29sZWFuXHJcbiAgICAgIGltbXV0YWJsZSxcclxuICAgICAgLy8gVW5peCB0aW1lIGluIG1pbGxpc2Vjb25kc1xyXG4gICAgICB0aW1lc3RhbXAsXHJcbiAgICAgIGZ1bGxQYXRoLFxyXG4gICAgfSA9IEFQUExJQ0FUSU9OU19DQUNIRS5nZXQobGluayk7XHJcbiAgICBpZiAobGFzdE1vZGlmaWVkICYmIGN1cnJlbnRNb2RpZmllZCkge1xyXG4gICAgICBpZiAoY3VycmVudE1vZGlmaWVkLmdldFRpbWUoKSA8PSBsYXN0TW9kaWZpZWQuZ2V0VGltZSgpKSB7XHJcbiAgICAgICAgbG9nZ2VyLmRlYnVnKGBUaGUgYXBwbGljYXRpb24gYXQgJHtsaW5rfSBoYXMgbm90IGJlZW4gbW9kaWZpZWQgc2luY2UgJHtsYXN0TW9kaWZpZWR9YCk7XHJcbiAgICAgICAgcmV0dXJuIGZ1bGxQYXRoO1xyXG4gICAgICB9XHJcbiAgICAgIGxvZ2dlci5kZWJ1ZyhgVGhlIGFwcGxpY2F0aW9uIGF0ICR7bGlua30gaGFzIGJlZW4gbW9kaWZpZWQgc2luY2UgJHtsYXN0TW9kaWZpZWR9YCk7XHJcbiAgICAgIHJldHVybiByZWZyZXNoKCk7XHJcbiAgICB9XHJcbiAgICBpZiAoaW1tdXRhYmxlICYmIGN1cnJlbnRJbW11dGFibGUpIHtcclxuICAgICAgbG9nZ2VyLmRlYnVnKGBUaGUgYXBwbGljYXRpb24gYXQgJHtsaW5rfSBpcyBpbW11dGFibGVgKTtcclxuICAgICAgcmV0dXJuIGZ1bGxQYXRoO1xyXG4gICAgfVxyXG4gICAgaWYgKGN1cnJlbnRNYXhBZ2UgJiYgdGltZXN0YW1wKSB7XHJcbiAgICAgIGNvbnN0IG1zTGVmdCA9IHRpbWVzdGFtcCArIGN1cnJlbnRNYXhBZ2UgKiAxMDAwIC0gRGF0ZS5ub3coKTtcclxuICAgICAgaWYgKG1zTGVmdCA+IDApIHtcclxuICAgICAgICBsb2dnZXIuZGVidWcoYFRoZSBjYWNoZWQgYXBwbGljYXRpb24gJyR7cGF0aC5iYXNlbmFtZShmdWxsUGF0aCl9JyB3aWxsIGV4cGlyZSBpbiAke21zTGVmdCAvIDEwMDB9c2ApO1xyXG4gICAgICAgIHJldHVybiBmdWxsUGF0aDtcclxuICAgICAgfVxyXG4gICAgICBsb2dnZXIuZGVidWcoYFRoZSBjYWNoZWQgYXBwbGljYXRpb24gJyR7cGF0aC5iYXNlbmFtZShmdWxsUGF0aCl9JyBoYXMgZXhwaXJlZGApO1xyXG4gICAgfVxyXG4gIH1cclxuICByZXR1cm4gcmVmcmVzaCgpO1xyXG59XHJcblxyXG5mdW5jdGlvbiB2ZXJpZnlBcHBFeHRlbnNpb24gKGFwcCwgc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucykge1xyXG4gIGlmIChzdXBwb3J0ZWRBcHBFeHRlbnNpb25zLmluY2x1ZGVzKHBhdGguZXh0bmFtZShhcHApKSkge1xyXG4gICAgcmV0dXJuIGFwcDtcclxuICB9XHJcbiAgdGhyb3cgbmV3IEVycm9yKGBOZXcgYXBwIHBhdGggJyR7YXBwfScgZGlkIG5vdCBoYXZlIGAgK1xyXG4gICAgYCR7dXRpbC5wbHVyYWxpemUoJ2V4dGVuc2lvbicsIHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMubGVuZ3RoLCBmYWxzZSl9OiBgICtcclxuICAgIHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMpO1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBjb25maWd1cmVBcHAgKGFwcCwgc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucykge1xyXG4gIGlmICghXy5pc1N0cmluZyhhcHApKSB7XHJcbiAgICAvLyBpbW1lZGlhdGVseSBzaG9ydGNpcmN1aXQgaWYgbm90IGdpdmVuIGFuIGFwcFxyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBpZiAoIV8uaXNBcnJheShzdXBwb3J0ZWRBcHBFeHRlbnNpb25zKSkge1xyXG4gICAgc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucyA9IFtzdXBwb3J0ZWRBcHBFeHRlbnNpb25zXTtcclxuICB9XHJcblxyXG4gIGxldCBuZXdBcHAgPSBhcHA7XHJcbiAgbGV0IHNob3VsZFVuemlwQXBwID0gZmFsc2U7XHJcbiAgbGV0IGFyY2hpdmVIYXNoID0gbnVsbDtcclxuICBjb25zdCByZW1vdGVBcHBQcm9wcyA9IHtcclxuICAgIGxhc3RNb2RpZmllZDogbnVsbCxcclxuICAgIGltbXV0YWJsZTogZmFsc2UsXHJcbiAgICBtYXhBZ2U6IG51bGwsXHJcbiAgfTtcclxuICBjb25zdCB7cHJvdG9jb2wsIHBhdGhuYW1lfSA9IHVybC5wYXJzZShuZXdBcHApO1xyXG4gIGNvbnN0IGlzVXJsID0gWydodHRwOicsICdodHRwczonXS5pbmNsdWRlcyhwcm90b2NvbCk7XHJcblxyXG4gIHJldHVybiBhd2FpdCBBUFBMSUNBVElPTlNfQ0FDSEVfR1VBUkQuYWNxdWlyZShhcHAsIGFzeW5jICgpID0+IHtcclxuICAgIGlmIChpc1VybCkge1xyXG4gICAgICAvLyBVc2UgdGhlIGFwcCBmcm9tIHJlbW90ZSBVUkxcclxuICAgICAgbG9nZ2VyLmluZm8oYFVzaW5nIGRvd25sb2FkYWJsZSBhcHAgJyR7bmV3QXBwfSdgKTtcclxuICAgICAgY29uc3QgaGVhZGVycyA9IGF3YWl0IHJldHJpZXZlSGVhZGVycyhuZXdBcHApO1xyXG4gICAgICBpZiAoIV8uaXNFbXB0eShoZWFkZXJzKSkge1xyXG4gICAgICAgIGlmIChoZWFkZXJzWydsYXN0LW1vZGlmaWVkJ10pIHtcclxuICAgICAgICAgIHJlbW90ZUFwcFByb3BzLmxhc3RNb2RpZmllZCA9IG5ldyBEYXRlKGhlYWRlcnNbJ2xhc3QtbW9kaWZpZWQnXSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGxvZ2dlci5kZWJ1ZyhgTGFzdC1Nb2RpZmllZDogJHtoZWFkZXJzWydsYXN0LW1vZGlmaWVkJ119YCk7XHJcbiAgICAgICAgaWYgKGhlYWRlcnNbJ2NhY2hlLWNvbnRyb2wnXSkge1xyXG4gICAgICAgICAgcmVtb3RlQXBwUHJvcHMuaW1tdXRhYmxlID0gL1xcYmltbXV0YWJsZVxcYi9pLnRlc3QoaGVhZGVyc1snY2FjaGUtY29udHJvbCddKTtcclxuICAgICAgICAgIGNvbnN0IG1heEFnZU1hdGNoID0gL1xcYm1heC1hZ2U9KFxcZCspXFxiL2kuZXhlYyhoZWFkZXJzWydjYWNoZS1jb250cm9sJ10pO1xyXG4gICAgICAgICAgaWYgKG1heEFnZU1hdGNoKSB7XHJcbiAgICAgICAgICAgIHJlbW90ZUFwcFByb3BzLm1heEFnZSA9IHBhcnNlSW50KG1heEFnZU1hdGNoWzFdLCAxMCk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGxvZ2dlci5kZWJ1ZyhgQ2FjaGUtQ29udHJvbDogJHtoZWFkZXJzWydjYWNoZS1jb250cm9sJ119YCk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vICoqKioqIEN1c3RvbSBsb2dpYyBmb3IgdmVyaWZpY2F0aW9uIG9mIGxvY2FsIHN0YXRpYyBwYXRoIGZvciBBUFBzICoqKioqXHJcbiAgICAgIGxldCBkb3dubG9hZElzTmVhZGVkID0gdHJ1ZTtcclxuICAgICAgY29uc3QgbG9jYWxBcHBzRm9sZGVyID0gYXdhaXQgZ2V0TG9jYWxBcHBzRm9sZGVyKCk7XHJcbiAgICAgIGxldCBsb2NhbEZpbGU7XHJcbiAgICAgIGxldCBsb2NrRmlsZTtcclxuICAgICAgaWYobG9jYWxBcHBzRm9sZGVyICE9IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIGxvY2FsRmlsZSA9IGF3YWl0IGdldExvY2FsRmlsZUZvckFwcFVybChuZXdBcHApO1xyXG4gICAgICAgIGxvY2tGaWxlID0gbG9jYWxGaWxlICsgJy5sb2NrJztcclxuXHJcbiAgICAgICAgaWYoYXdhaXQgZnMuZXhpc3RzKGxvY2FsRmlsZSkpIHtcclxuICAgICAgICAgIGxvZ2dlci5pbmZvKGBMb2NhbCB2ZXJzaW9uIG9mIGFwcCB3YXMgZm91bmQuIFdpbGwgY2hlY2sgYWN0dWFsaXR5IG9mIHRoZSBmaWxlYCk7XHJcbiAgICAgICAgICAvLyBDaGVja2luZyBvZiBsb2NhbCBhcHBsaWNhdGlvbiBhY3R1YWxpdHlcclxuICAgICAgICAgIGNvbnN0IHJlbW90ZUZpbGVMZW5ndGggPSBhd2FpdCBnZXRGaWxlQ29udGVudExlbmd0aChhcHApO1xyXG4gICAgICAgICAgY29uc3Qgc3RhdHMgPSBhd2FpdCBmcy5zdGF0KGxvY2FsRmlsZSk7XHJcbiAgICAgICAgICBjb25zdCBsb2NhbEZpbGVMZW5ndGggPSBzdGF0cy5zaXplO1xyXG4gICAgICAgICAgbG9nZ2VyLmluZm8oYFJlbW90ZSBmaWxlIHNpemUgaXMgJHtyZW1vdGVGaWxlTGVuZ3RofSBhbmQgbG9jYWwgZmlsZSBzaXplIGlzICR7bG9jYWxGaWxlTGVuZ3RofWApO1xyXG4gICAgICAgICAgaWYocmVtb3RlRmlsZUxlbmd0aCAhPSBsb2NhbEZpbGVMZW5ndGgpIHtcclxuICAgICAgICAgICAgbG9nZ2VyLmluZm8oYFNpemVzIGRpZmZlci4gSGVuY2UgdGhhdCdzIG5lZWRlZCB0byBkb3dubG9hZCBmcmVzaCB2ZXJzaW9uIG9mIHRoZSBhcHBgKTtcclxuICAgICAgICAgICAgYXdhaXQgZnMudW5saW5rKGxvY2FsRmlsZSk7XHJcbiAgICAgICAgICAgIGRvd25sb2FkSXNOZWFkZWQgPSB0cnVlO1xyXG4gICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgbG9nZ2VyLmluZm8oYFNpemVzIGFyZSB0aGUgc2FtZS4gSGVuY2Ugd2lsbCB1c2UgYWxyZWFkeSBzdG9yZWQgYXBwbGljYXRpb24gZm9yIHRoZSBzZXNzaW9uYCk7XHJcbiAgICAgICAgICAgIG5ld0FwcCA9IGxvY2FsRmlsZTtcclxuICAgICAgICAgICAgc2hvdWxkVW56aXBBcHAgPSBaSVBfRVhUUy5pbmNsdWRlcyhwYXRoLmV4dG5hbWUobmV3QXBwKSk7XHJcbiAgICAgICAgICAgIGRvd25sb2FkSXNOZWFkZWQgPSBmYWxzZTtcclxuICAgICAgICAgIH1cclxuICAgICAgICB9IGVsc2UgaWYgKGF3YWl0IGZzLmV4aXN0cyhsb2NrRmlsZSkpIHtcclxuICAgICAgICAgIGxvZ2dlci5pbmZvKGBMb2NhbCB2ZXJzaW9uIG9mIGFwcCBub3QgZm91bmQgYnV0IC5sb2NrIGZpbGUgZXhpc3RzLiBXYWl0aW5nIGZvciAubG9jayB0byBkaXNhcHBlYXJgKTtcclxuICAgICAgICAgIC8vIFdhaXQgZm9yIHNvbWUgdGltZSB0aWxsIEFwcCBpcyBkb3dubG9hZGVkIGJ5IHNvbWUgcGFyYWxsZWwgQXBwaXVtIGluc3RhbmNlXHJcbiAgICAgICAgICBjb25zdCB3YWl0aW5nVGltZSA9IDUwMDA7XHJcbiAgICAgICAgICB2YXIgbWF4QXR0ZW1wdHNDb3VudCA9IDUgKiAxMjtcclxuICAgICAgICAgIC8vIGNvbnN0IHdhaXRpbmdUaW1lID0gMTAwMDtcclxuICAgICAgICAgIC8vIGNvbnN0IG1heEF0dGVtcHRzQ291bnQgPSA1O1xyXG4gICAgICAgICAgdmFyIGF0dGVtcHRzQ291bnQgPSAwO1xyXG4gICAgICAgICAgd2hpbGUoYXdhaXQgZnMuZXhpc3RzKGxvY2tGaWxlKSAmJiAoYXR0ZW1wdHNDb3VudCsrIDwgbWF4QXR0ZW1wdHNDb3VudCkpIHtcclxuICAgICAgICAgICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcclxuICAgICAgICAgICAgICBsb2dnZXIuaW5mbyhgQXR0ZW1wdCAjJHthdHRlbXB0c0NvdW50fSBmb3IgLmxvY2sgZmlsZSBjaGVja2luZ2ApO1xyXG4gICAgICAgICAgICAgIHNldFRpbWVvdXQocmVzb2x2ZSwgd2FpdGluZ1RpbWUpO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIGlmKGF3YWl0IGZzLmV4aXN0cyhsb2NrRmlsZSkpIHtcclxuICAgICAgICAgICAgdGhyb3cgRXJyb3IoYC5sb2NrIGZpbGUgZm9yIGRvd25sb2FkaW5nIGFwcGxpY2F0aW9uIGhhcyBub3QgZGlzYXBwZWFyZWQgYWZ0ZXIgJHt3YWl0aW5nVGltZSAqIG1heEF0dGVtcHRzQ291bnR9bXNgKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIGlmKCFhd2FpdCBmcy5leGlzdHMobG9jYWxGaWxlKSkge1xyXG4gICAgICAgICAgICB0aHJvdyBFcnJvcihgTG9jYWwgYXBwbGljYXRpb24gZmlsZSBoYXMgbm90IGFwcGVhcmVkIGFmdGVyIC5sb2NrIGZpbGUgcmVtb3ZhbGApO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgbG9nZ2VyLmluZm8oYExvY2FsIHZlcnNpb24gb2YgYXBwIHdhcyBmb3VuZCBhZnRlciAubG9jayBmaWxlIHJlbW92YWwuIFdpbGwgdXNlIGl0IGZvciBuZXcgc2Vzc2lvbmApO1xyXG4gICAgICAgICAgbmV3QXBwID0gbG9jYWxGaWxlO1xyXG4gICAgICAgICAgc2hvdWxkVW56aXBBcHAgPSBaSVBfRVhUUy5pbmNsdWRlcyhwYXRoLmV4dG5hbWUobmV3QXBwKSk7XHJcbiAgICAgICAgICBkb3dubG9hZElzTmVhZGVkID0gZmFsc2U7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgIGxvZ2dlci5pbmZvKGBOZWl0aGVyIGxvY2FsIHZlcnNpb24gb2YgYXBwIG5vciAubG9jayBmaWxlIHdhcyBmb3VuZC4gV2lsbCBkb3dubG9hZCBhcHAgZnJvbSByZW1vdGUgVVJMLmApO1xyXG4gICAgICAgICAgZG93bmxvYWRJc05lYWRlZCA9IHRydWU7XHJcbiAgICAgICAgfVxyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIGxvZ2dlci5pbmZvKGBMb2NhbCBhcHBzIGZvbGRlciBpcyBub3QgZGVmaW5lZCB2aWEgZW52aXJvbm1lbnQgcHJvcGVydGllcywgaGVuY2Ugc2tpcHBpbmcgdGhpcyBsb2dpY2ApO1xyXG4gICAgICB9XHJcbiAgICAgIGlmKGRvd25sb2FkSXNOZWFkZWQpIHtcclxuICAgICAgXHJcbiAgICAgICAgaWYobG9jYWxBcHBzRm9sZGVyICE9IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgbG9nZ2VyLmluZm8oYExvY2FsIHZlcnNpb24gb2YgYXBwIHdhcyBub3QgZm91bmQuIEhlbmNlIHVzaW5nIGRlZmF1bHQgQXBwaXVtIGxvZ2ljIGZvciBkb3dubG9hZGluZ2ApO1xyXG4gICAgICAgICAgY29uc3Qgc2hhcmVkRm9sZGVyUGF0aCA9IGF3YWl0IGdldFNoYXJlZEZvbGRlckZvckFwcFVybChhcHApO1xyXG4gICAgICAgICAgbG9nZ2VyLmluZm8oYEZvbGRlciBmb3IgbG9jYWwgc2hhcmVkIGFwcHM6ICR7c2hhcmVkRm9sZGVyUGF0aH1gKTtcclxuICAgICAgICAgIGF3YWl0IGZzLmNsb3NlKGF3YWl0IGZzLm9wZW4obG9ja0ZpbGUsICd3JykpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgY29uc3QgY2FjaGVkUGF0aCA9IGdldENhY2hlZEFwcGxpY2F0aW9uUGF0aChhcHAsIHJlbW90ZUFwcFByb3BzKTtcclxuICAgICAgaWYgKGNhY2hlZFBhdGgpIHtcclxuICAgICAgICBpZiAoYXdhaXQgZnMuZXhpc3RzKGNhY2hlZFBhdGgpKSB7XHJcbiAgICAgICAgICBsb2dnZXIuaW5mbyhgUmV1c2luZyBwcmV2aW91c2x5IGRvd25sb2FkZWQgYXBwbGljYXRpb24gYXQgJyR7Y2FjaGVkUGF0aH0nYCk7XHJcbiAgICAgICAgICByZXR1cm4gdmVyaWZ5QXBwRXh0ZW5zaW9uKGNhY2hlZFBhdGgsIHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBsb2dnZXIuaW5mbyhgVGhlIGFwcGxpY2F0aW9uIGF0ICcke2NhY2hlZFBhdGh9JyBkb2VzIG5vdCBleGlzdCBhbnltb3JlLiBEZWxldGluZyBpdCBmcm9tIHRoZSBjYWNoZWApO1xyXG4gICAgICAgIEFQUExJQ0FUSU9OU19DQUNIRS5kZWwoYXBwKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgbGV0IGZpbGVOYW1lID0gbnVsbDtcclxuICAgICAgY29uc3QgYmFzZW5hbWUgPSBmcy5zYW5pdGl6ZU5hbWUocGF0aC5iYXNlbmFtZShkZWNvZGVVUklDb21wb25lbnQocGF0aG5hbWUpKSwge1xyXG4gICAgICAgIHJlcGxhY2VtZW50OiBTQU5JVElaRV9SRVBMQUNFTUVOVFxyXG4gICAgICB9KTtcclxuICAgICAgY29uc3QgZXh0bmFtZSA9IHBhdGguZXh0bmFtZShiYXNlbmFtZSk7XHJcbiAgICAgIC8vIHRvIGRldGVybWluZSBpZiB3ZSBuZWVkIHRvIHVuemlwIHRoZSBhcHAsIHdlIGhhdmUgYSBudW1iZXIgb2YgcGxhY2VzXHJcbiAgICAgIC8vIHRvIGxvb2s6IGNvbnRlbnQgdHlwZSwgY29udGVudCBkaXNwb3NpdGlvbiwgb3IgdGhlIGZpbGUgZXh0ZW5zaW9uXHJcbiAgICAgIGlmIChaSVBfRVhUUy5pbmNsdWRlcyhleHRuYW1lKSkge1xyXG4gICAgICAgIGZpbGVOYW1lID0gYmFzZW5hbWU7XHJcbiAgICAgICAgc2hvdWxkVW56aXBBcHAgPSB0cnVlO1xyXG4gICAgICB9XHJcbiAgICAgIGlmIChoZWFkZXJzWydjb250ZW50LXR5cGUnXSkge1xyXG4gICAgICAgIGNvbnN0IGN0ID0gaGVhZGVyc1snY29udGVudC10eXBlJ107XHJcbiAgICAgICAgbG9nZ2VyLmRlYnVnKGBDb250ZW50LVR5cGU6ICR7Y3R9YCk7XHJcbiAgICAgICAgLy8gdGhlIGZpbGV0eXBlIG1heSBub3QgYmUgb2J2aW91cyBmb3IgY2VydGFpbiB1cmxzLCBzbyBjaGVjayB0aGUgbWltZSB0eXBlIHRvb1xyXG4gICAgICAgIGlmIChaSVBfTUlNRV9UWVBFUy5zb21lKChtaW1lVHlwZSkgPT4gbmV3IFJlZ0V4cChgXFxcXGIke18uZXNjYXBlUmVnRXhwKG1pbWVUeXBlKX1cXFxcYmApLnRlc3QoY3QpKSkge1xyXG4gICAgICAgICAgaWYgKCFmaWxlTmFtZSkge1xyXG4gICAgICAgICAgICBmaWxlTmFtZSA9IGAke0RFRkFVTFRfQkFTRU5BTUV9LnppcGA7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBzaG91bGRVbnppcEFwcCA9IHRydWU7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIGlmIChoZWFkZXJzWydjb250ZW50LWRpc3Bvc2l0aW9uJ10gJiYgL15hdHRhY2htZW50L2kudGVzdChoZWFkZXJzWydjb250ZW50LWRpc3Bvc2l0aW9uJ10pKSB7XHJcbiAgICAgICAgbG9nZ2VyLmRlYnVnKGBDb250ZW50LURpc3Bvc2l0aW9uOiAke2hlYWRlcnNbJ2NvbnRlbnQtZGlzcG9zaXRpb24nXX1gKTtcclxuICAgICAgICBjb25zdCBtYXRjaCA9IC9maWxlbmFtZT1cIihbXlwiXSspL2kuZXhlYyhoZWFkZXJzWydjb250ZW50LWRpc3Bvc2l0aW9uJ10pO1xyXG4gICAgICAgIGlmIChtYXRjaCkge1xyXG4gICAgICAgICAgZmlsZU5hbWUgPSBmcy5zYW5pdGl6ZU5hbWUobWF0Y2hbMV0sIHtcclxuICAgICAgICAgICAgcmVwbGFjZW1lbnQ6IFNBTklUSVpFX1JFUExBQ0VNRU5UXHJcbiAgICAgICAgICB9KTtcclxuICAgICAgICAgIHNob3VsZFVuemlwQXBwID0gc2hvdWxkVW56aXBBcHAgfHwgWklQX0VYVFMuaW5jbHVkZXMocGF0aC5leHRuYW1lKGZpbGVOYW1lKSk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIGlmICghZmlsZU5hbWUpIHtcclxuICAgICAgICAvLyBhc3NpZ24gdGhlIGRlZmF1bHQgZmlsZSBuYW1lIGFuZCB0aGUgZXh0ZW5zaW9uIGlmIG5vbmUgaGFzIGJlZW4gZGV0ZWN0ZWRcclxuICAgICAgICBjb25zdCByZXN1bHRpbmdOYW1lID0gYmFzZW5hbWVcclxuICAgICAgICAgID8gYmFzZW5hbWUuc3Vic3RyaW5nKDAsIGJhc2VuYW1lLmxlbmd0aCAtIGV4dG5hbWUubGVuZ3RoKVxyXG4gICAgICAgICAgOiBERUZBVUxUX0JBU0VOQU1FO1xyXG4gICAgICAgIGxldCByZXN1bHRpbmdFeHQgPSBleHRuYW1lO1xyXG4gICAgICAgIGlmICghc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucy5pbmNsdWRlcyhyZXN1bHRpbmdFeHQpKSB7XHJcbiAgICAgICAgICBsb2dnZXIuaW5mbyhgVGhlIGN1cnJlbnQgZmlsZSBleHRlbnNpb24gJyR7cmVzdWx0aW5nRXh0fScgaXMgbm90IHN1cHBvcnRlZC4gYCArXHJcbiAgICAgICAgICAgIGBEZWZhdWx0aW5nIHRvICcke18uZmlyc3Qoc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucyl9J2ApO1xyXG4gICAgICAgICAgcmVzdWx0aW5nRXh0ID0gXy5maXJzdChzdXBwb3J0ZWRBcHBFeHRlbnNpb25zKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgZmlsZU5hbWUgPSBgJHtyZXN1bHRpbmdOYW1lfSR7cmVzdWx0aW5nRXh0fWA7XHJcbiAgICAgIH1cclxuICAgICAgY29uc3QgdGFyZ2V0UGF0aCA9IGF3YWl0IHRlbXBEaXIucGF0aCh7XHJcbiAgICAgICAgcHJlZml4OiBmaWxlTmFtZSxcclxuICAgICAgICBzdWZmaXg6ICcnLFxyXG4gICAgICB9KTtcclxuICAgICAgbmV3QXBwID0gYXdhaXQgZG93bmxvYWRBcHAobmV3QXBwLCB0YXJnZXRQYXRoKTtcclxuXHJcbiAgICAgIC8vICoqKioqIEN1c3RvbSBsb2dpYyBmb3IgY29weWluZyBvZiBkb3dubG9hZGVkIGFwcCB0byBzdGF0aWMgbG9jYXRpb24gKioqKipcclxuICAgICAgaWYobG9jYWxBcHBzRm9sZGVyICE9IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIGxvZ2dlci5pbmZvKGBOZXcgYXBwIHBhdGg6ICR7bmV3QXBwfWApO1xyXG4gICAgICAgIGF3YWl0IGZzLmNvcHlGaWxlKG5ld0FwcCwgbG9jYWxGaWxlKTtcclxuICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIGZpbmFsbHkge1xyXG4gICAgICAgIGlmKGxvY2FsQXBwc0ZvbGRlciAhPSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgIGxvZ2dlci5pbmZvKGBHb2luZyB0byByZW1vdmUgbG9jayBmaWxlICR7bG9ja0ZpbGV9YClcclxuICAgICAgICAgIGF3YWl0IGZzLnVubGluayhsb2NrRmlsZSk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIH1cclxuICAgIH0gZWxzZSBpZiAoYXdhaXQgZnMuZXhpc3RzKG5ld0FwcCkpIHtcclxuICAgICAgLy8gVXNlIHRoZSBsb2NhbCBhcHBcclxuICAgICAgbG9nZ2VyLmluZm8oYFVzaW5nIGxvY2FsIGFwcCAnJHtuZXdBcHB9J2ApO1xyXG4gICAgICBzaG91bGRVbnppcEFwcCA9IFpJUF9FWFRTLmluY2x1ZGVzKHBhdGguZXh0bmFtZShuZXdBcHApKTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIGxldCBlcnJvck1lc3NhZ2UgPSBgVGhlIGFwcGxpY2F0aW9uIGF0ICcke25ld0FwcH0nIGRvZXMgbm90IGV4aXN0IG9yIGlzIG5vdCBhY2Nlc3NpYmxlYDtcclxuICAgICAgLy8gcHJvdG9jb2wgdmFsdWUgZm9yICdDOlxcXFx0ZW1wJyBpcyAnYzonLCBzbyB3ZSBjaGVjayB0aGUgbGVuZ3RoIGFzIHdlbGxcclxuICAgICAgaWYgKF8uaXNTdHJpbmcocHJvdG9jb2wpICYmIHByb3RvY29sLmxlbmd0aCA+IDIpIHtcclxuICAgICAgICBlcnJvck1lc3NhZ2UgPSBgVGhlIHByb3RvY29sICcke3Byb3RvY29sfScgdXNlZCBpbiAnJHtuZXdBcHB9JyBpcyBub3Qgc3VwcG9ydGVkLiBgICtcclxuICAgICAgICAgIGBPbmx5IGh0dHA6IGFuZCBodHRwczogcHJvdG9jb2xzIGFyZSBzdXBwb3J0ZWRgO1xyXG4gICAgICB9XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcihlcnJvck1lc3NhZ2UpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChzaG91bGRVbnppcEFwcCkge1xyXG4gICAgICBjb25zdCBhcmNoaXZlUGF0aCA9IG5ld0FwcDtcclxuICAgICAgYXJjaGl2ZUhhc2ggPSBhd2FpdCBmcy5oYXNoKGFyY2hpdmVQYXRoKTtcclxuICAgICAgaWYgKEFQUExJQ0FUSU9OU19DQUNIRS5oYXMoYXBwKSAmJiBhcmNoaXZlSGFzaCA9PT0gQVBQTElDQVRJT05TX0NBQ0hFLmdldChhcHApLmhhc2gpIHtcclxuICAgICAgICBjb25zdCB7ZnVsbFBhdGh9ID0gQVBQTElDQVRJT05TX0NBQ0hFLmdldChhcHApO1xyXG4gICAgICAgIGlmIChhd2FpdCBmcy5leGlzdHMoZnVsbFBhdGgpKSB7XHJcbiAgICAgICAgICBpZiAoYXJjaGl2ZVBhdGggIT09IGFwcCkge1xyXG4gICAgICAgICAgICBhd2FpdCBmcy5yaW1yYWYoYXJjaGl2ZVBhdGgpO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgbG9nZ2VyLmluZm8oYFdpbGwgcmV1c2UgcHJldmlvdXNseSBjYWNoZWQgYXBwbGljYXRpb24gYXQgJyR7ZnVsbFBhdGh9J2ApO1xyXG4gICAgICAgICAgcmV0dXJuIHZlcmlmeUFwcEV4dGVuc2lvbihmdWxsUGF0aCwgc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGxvZ2dlci5pbmZvKGBUaGUgYXBwbGljYXRpb24gYXQgJyR7ZnVsbFBhdGh9JyBkb2VzIG5vdCBleGlzdCBhbnltb3JlLiBEZWxldGluZyBpdCBmcm9tIHRoZSBjYWNoZWApO1xyXG4gICAgICAgIEFQUExJQ0FUSU9OU19DQUNIRS5kZWwoYXBwKTtcclxuICAgICAgfVxyXG4gICAgICBjb25zdCB0bXBSb290ID0gYXdhaXQgdGVtcERpci5vcGVuRGlyKCk7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgbmV3QXBwID0gYXdhaXQgdW56aXBBcHAoYXJjaGl2ZVBhdGgsIHRtcFJvb3QsIHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMpO1xyXG4gICAgICB9IGZpbmFsbHkge1xyXG4gICAgICAgIGlmIChuZXdBcHAgIT09IGFyY2hpdmVQYXRoICYmIGFyY2hpdmVQYXRoICE9PSBhcHAgJiYgbG9jYWxBcHBzRm9sZGVyID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgIGF3YWl0IGZzLnJpbXJhZihhcmNoaXZlUGF0aCk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIGxvZ2dlci5pbmZvKGBVbnppcHBlZCBsb2NhbCBhcHAgdG8gJyR7bmV3QXBwfSdgKTtcclxuICAgIH0gZWxzZSBpZiAoIXBhdGguaXNBYnNvbHV0ZShuZXdBcHApKSB7XHJcbiAgICAgIG5ld0FwcCA9IHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpLCBuZXdBcHApO1xyXG4gICAgICBsb2dnZXIud2FybihgVGhlIGN1cnJlbnQgYXBwbGljYXRpb24gcGF0aCAnJHthcHB9JyBpcyBub3QgYWJzb2x1dGUgYCArXHJcbiAgICAgICAgYGFuZCBoYXMgYmVlbiByZXdyaXR0ZW4gdG8gJyR7bmV3QXBwfScuIENvbnNpZGVyIHVzaW5nIGFic29sdXRlIHBhdGhzIHJhdGhlciB0aGFuIHJlbGF0aXZlYCk7XHJcbiAgICAgIGFwcCA9IG5ld0FwcDtcclxuICAgIH1cclxuXHJcbiAgICB2ZXJpZnlBcHBFeHRlbnNpb24obmV3QXBwLCBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zKTtcclxuXHJcbiAgICBpZiAoYXBwICE9PSBuZXdBcHAgJiYgKGFyY2hpdmVIYXNoIHx8IF8udmFsdWVzKHJlbW90ZUFwcFByb3BzKS5zb21lKEJvb2xlYW4pKSkge1xyXG4gICAgICBpZiAoQVBQTElDQVRJT05TX0NBQ0hFLmhhcyhhcHApKSB7XHJcbiAgICAgICAgY29uc3Qge2Z1bGxQYXRofSA9IEFQUExJQ0FUSU9OU19DQUNIRS5nZXQoYXBwKTtcclxuICAgICAgICAvLyBDbGVhbiB1cCB0aGUgb2Jzb2xldGUgZW50cnkgZmlyc3QgaWYgbmVlZGVkXHJcbiAgICAgICAgaWYgKGZ1bGxQYXRoICE9PSBuZXdBcHAgJiYgYXdhaXQgZnMuZXhpc3RzKGZ1bGxQYXRoKSkge1xyXG4gICAgICAgICAgYXdhaXQgZnMucmltcmFmKGZ1bGxQYXRoKTtcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgICAgQVBQTElDQVRJT05TX0NBQ0hFLnNldChhcHAsIHtcclxuICAgICAgICAuLi5yZW1vdGVBcHBQcm9wcyxcclxuICAgICAgICB0aW1lc3RhbXA6IERhdGUubm93KCksXHJcbiAgICAgICAgaGFzaDogYXJjaGl2ZUhhc2gsXHJcbiAgICAgICAgZnVsbFBhdGg6IG5ld0FwcCxcclxuICAgICAgfSk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gbmV3QXBwO1xyXG4gIH0pO1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBkb3dubG9hZEFwcCAoYXBwLCB0YXJnZXRQYXRoKSB7XHJcbiAgY29uc3Qge2hyZWZ9ID0gdXJsLnBhcnNlKGFwcCk7XHJcbiAgdHJ5IHtcclxuICAgIGF3YWl0IG5ldC5kb3dubG9hZEZpbGUoaHJlZiwgdGFyZ2V0UGF0aCwge1xyXG4gICAgICB0aW1lb3V0OiBBUFBfRE9XTkxPQURfVElNRU9VVF9NUyxcclxuICAgIH0pO1xyXG4gIH0gY2F0Y2ggKGVycikge1xyXG4gICAgdGhyb3cgbmV3IEVycm9yKGBVbmFibGUgdG8gZG93bmxvYWQgdGhlIGFwcDogJHtlcnIubWVzc2FnZX1gKTtcclxuICB9XHJcbiAgcmV0dXJuIHRhcmdldFBhdGg7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBFeHRyYWN0cyB0aGUgYnVuZGxlIGZyb20gYW4gYXJjaGl2ZSBpbnRvIHRoZSBnaXZlbiBmb2xkZXJcclxuICpcclxuICogQHBhcmFtIHtzdHJpbmd9IHppcFBhdGggRnVsbCBwYXRoIHRvIHRoZSBhcmNoaXZlIGNvbnRhaW5pbmcgdGhlIGJ1bmRsZVxyXG4gKiBAcGFyYW0ge3N0cmluZ30gZHN0Um9vdCBGdWxsIHBhdGggdG8gdGhlIGZvbGRlciB3aGVyZSB0aGUgZXh0cmFjdGVkIGJ1bmRsZVxyXG4gKiBzaG91bGQgYmUgcGxhY2VkXHJcbiAqIEBwYXJhbSB7QXJyYXk8c3RyaW5nPnxzdHJpbmd9IHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMgVGhlIGxpc3Qgb2YgZXh0ZW5zaW9uc1xyXG4gKiB0aGUgdGFyZ2V0IGFwcGxpY2F0aW9uIGJ1bmRsZSBzdXBwb3J0cywgZm9yIGV4YW1wbGUgWycuYXBrJywgJy5hcGtzJ10gZm9yXHJcbiAqIEFuZHJvaWQgcGFja2FnZXNcclxuICogQHJldHVybnMge3N0cmluZ30gRnVsbCBwYXRoIHRvIHRoZSBidW5kbGUgaW4gdGhlIGRlc3RpbmF0aW9uIGZvbGRlclxyXG4gKiBAdGhyb3dzIHtFcnJvcn0gSWYgdGhlIGdpdmVuIGFyY2hpdmUgaXMgaW52YWxpZCBvciBubyBhcHBsaWNhdGlvbiBidW5kbGVzXHJcbiAqIGhhdmUgYmVlbiBmb3VuZCBpbnNpZGVcclxuICovXHJcbmFzeW5jIGZ1bmN0aW9uIHVuemlwQXBwICh6aXBQYXRoLCBkc3RSb290LCBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zKSB7XHJcbiAgYXdhaXQgemlwLmFzc2VydFZhbGlkWmlwKHppcFBhdGgpO1xyXG5cclxuICBpZiAoIV8uaXNBcnJheShzdXBwb3J0ZWRBcHBFeHRlbnNpb25zKSkge1xyXG4gICAgc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucyA9IFtzdXBwb3J0ZWRBcHBFeHRlbnNpb25zXTtcclxuICB9XHJcblxyXG4gIGNvbnN0IHRtcFJvb3QgPSBhd2FpdCB0ZW1wRGlyLm9wZW5EaXIoKTtcclxuICB0cnkge1xyXG4gICAgbG9nZ2VyLmRlYnVnKGBVbnppcHBpbmcgJyR7emlwUGF0aH0nYCk7XHJcbiAgICBjb25zdCB0aW1lciA9IG5ldyB0aW1pbmcuVGltZXIoKS5zdGFydCgpO1xyXG4gICAgY29uc3QgdXNlU3lzdGVtVW56aXBFbnYgPSBwcm9jZXNzLmVudi5BUFBJVU1fUFJFRkVSX1NZU1RFTV9VTlpJUDtcclxuICAgIGNvbnN0IHVzZVN5c3RlbVVuemlwID0gXy5pc0VtcHR5KHVzZVN5c3RlbVVuemlwRW52KVxyXG4gICAgICB8fCAhWycwJywgJ2ZhbHNlJ10uaW5jbHVkZXMoXy50b0xvd2VyKHVzZVN5c3RlbVVuemlwRW52KSk7XHJcbiAgICAvKipcclxuICAgICAqIEF0dGVtcHQgdG8gdXNlIHVzZSB0aGUgc3lzdGVtIGB1bnppcGAgKGUuZy4sIGAvdXNyL2Jpbi91bnppcGApIGR1ZVxyXG4gICAgICogdG8gdGhlIHNpZ25pZmljYW50IHBlcmZvcm1hbmNlIGltcHJvdmVtZW50IGl0IHByb3ZpZGVzIG92ZXIgdGhlIG5hdGl2ZVxyXG4gICAgICogSlMgXCJ1bnppcFwiIGltcGxlbWVudGF0aW9uLlxyXG4gICAgICogQHR5cGUge2ltcG9ydCgnYXBwaXVtLXN1cHBvcnQvbGliL3ppcCcpLkV4dHJhY3RBbGxPcHRpb25zfVxyXG4gICAgICovXHJcbiAgICBjb25zdCBleHRyYWN0aW9uT3B0cyA9IHt1c2VTeXN0ZW1VbnppcH07XHJcbiAgICAvLyBodHRwczovL2dpdGh1Yi5jb20vYXBwaXVtL2FwcGl1bS9pc3N1ZXMvMTQxMDBcclxuICAgIGlmIChwYXRoLmV4dG5hbWUoemlwUGF0aCkgPT09IElQQV9FWFQpIHtcclxuICAgICAgbG9nZ2VyLmRlYnVnKGBFbmZvcmNpbmcgVVRGLTggZW5jb2Rpbmcgb24gdGhlIGV4dHJhY3RlZCBmaWxlIG5hbWVzIGZvciAnJHtwYXRoLmJhc2VuYW1lKHppcFBhdGgpfSdgKTtcclxuICAgICAgZXh0cmFjdGlvbk9wdHMuZmlsZU5hbWVzRW5jb2RpbmcgPSAndXRmOCc7XHJcbiAgICB9XHJcbiAgICBhd2FpdCB6aXAuZXh0cmFjdEFsbFRvKHppcFBhdGgsIHRtcFJvb3QsIGV4dHJhY3Rpb25PcHRzKTtcclxuICAgIGNvbnN0IGdsb2JQYXR0ZXJuID0gYCoqLyouKygke3N1cHBvcnRlZEFwcEV4dGVuc2lvbnMubWFwKChleHQpID0+IGV4dC5yZXBsYWNlKC9eXFwuLywgJycpKS5qb2luKCd8Jyl9KWA7XHJcbiAgICBjb25zdCBzb3J0ZWRCdW5kbGVJdGVtcyA9IChhd2FpdCBmcy5nbG9iKGdsb2JQYXR0ZXJuLCB7XHJcbiAgICAgIGN3ZDogdG1wUm9vdCxcclxuICAgICAgc3RyaWN0OiBmYWxzZSxcclxuICAgIC8vIEdldCB0aGUgdG9wIGxldmVsIG1hdGNoXHJcbiAgICB9KSkuc29ydCgoYSwgYikgPT4gYS5zcGxpdChwYXRoLnNlcCkubGVuZ3RoIC0gYi5zcGxpdChwYXRoLnNlcCkubGVuZ3RoKTtcclxuICAgIGlmIChfLmlzRW1wdHkoc29ydGVkQnVuZGxlSXRlbXMpKSB7XHJcbiAgICAgIGxvZ2dlci5lcnJvckFuZFRocm93KGBBcHAgdW56aXBwZWQgT0ssIGJ1dCB3ZSBjb3VsZCBub3QgZmluZCBhbnkgJyR7c3VwcG9ydGVkQXBwRXh0ZW5zaW9uc30nIGAgK1xyXG4gICAgICAgIHV0aWwucGx1cmFsaXplKCdidW5kbGUnLCBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zLmxlbmd0aCwgZmFsc2UpICtcclxuICAgICAgICBgIGluIGl0LiBNYWtlIHN1cmUgeW91ciBhcmNoaXZlIGNvbnRhaW5zIGF0IGxlYXN0IG9uZSBwYWNrYWdlIGhhdmluZyBgICtcclxuICAgICAgICBgJyR7c3VwcG9ydGVkQXBwRXh0ZW5zaW9uc30nICR7dXRpbC5wbHVyYWxpemUoJ2V4dGVuc2lvbicsIHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMubGVuZ3RoLCBmYWxzZSl9YCk7XHJcbiAgICB9XHJcbiAgICBsb2dnZXIuZGVidWcoYEV4dHJhY3RlZCAke3V0aWwucGx1cmFsaXplKCdidW5kbGUgaXRlbScsIHNvcnRlZEJ1bmRsZUl0ZW1zLmxlbmd0aCwgdHJ1ZSl9IGAgK1xyXG4gICAgICBgZnJvbSAnJHt6aXBQYXRofScgaW4gJHtNYXRoLnJvdW5kKHRpbWVyLmdldER1cmF0aW9uKCkuYXNNaWxsaVNlY29uZHMpfW1zOiAke3NvcnRlZEJ1bmRsZUl0ZW1zfWApO1xyXG4gICAgY29uc3QgbWF0Y2hlZEJ1bmRsZSA9IF8uZmlyc3Qoc29ydGVkQnVuZGxlSXRlbXMpO1xyXG4gICAgbG9nZ2VyLmluZm8oYEFzc3VtaW5nICcke21hdGNoZWRCdW5kbGV9JyBpcyB0aGUgY29ycmVjdCBidW5kbGVgKTtcclxuICAgIGNvbnN0IGRzdFBhdGggPSBwYXRoLnJlc29sdmUoZHN0Um9vdCwgcGF0aC5iYXNlbmFtZShtYXRjaGVkQnVuZGxlKSk7XHJcbiAgICBhd2FpdCBmcy5tdihwYXRoLnJlc29sdmUodG1wUm9vdCwgbWF0Y2hlZEJ1bmRsZSksIGRzdFBhdGgsIHtta2RpcnA6IHRydWV9KTtcclxuICAgIHJldHVybiBkc3RQYXRoO1xyXG4gIH0gZmluYWxseSB7XHJcbiAgICBhd2FpdCBmcy5yaW1yYWYodG1wUm9vdCk7XHJcbiAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiBpc1BhY2thZ2VPckJ1bmRsZSAoYXBwKSB7XHJcbiAgcmV0dXJuICgvXihbYS16QS1aMC05XFwtX10rXFwuW2EtekEtWjAtOVxcLV9dKykrJC8pLnRlc3QoYXBwKTtcclxufVxyXG5cclxuLyoqXHJcbiAqIEZpbmRzIGFsbCBpbnN0YW5jZXMgJ2ZpcnN0S2V5JyBhbmQgY3JlYXRlIGEgZHVwbGljYXRlIHdpdGggdGhlIGtleSAnc2Vjb25kS2V5JyxcclxuICogRG8gdGhlIHNhbWUgdGhpbmcgaW4gcmV2ZXJzZS4gSWYgd2UgZmluZCAnc2Vjb25kS2V5JywgY3JlYXRlIGEgZHVwbGljYXRlIHdpdGggdGhlIGtleSAnZmlyc3RLZXknLlxyXG4gKlxyXG4gKiBUaGlzIHdpbGwgY2F1c2Uga2V5cyB0byBiZSBvdmVyd3JpdHRlbiBpZiB0aGUgb2JqZWN0IGNvbnRhaW5zICdmaXJzdEtleScgYW5kICdzZWNvbmRLZXknLlxyXG5cclxuICogQHBhcmFtIHsqfSBpbnB1dCBBbnkgdHlwZSBvZiBpbnB1dFxyXG4gKiBAcGFyYW0ge1N0cmluZ30gZmlyc3RLZXkgVGhlIGZpcnN0IGtleSB0byBkdXBsaWNhdGVcclxuICogQHBhcmFtIHtTdHJpbmd9IHNlY29uZEtleSBUaGUgc2Vjb25kIGtleSB0byBkdXBsaWNhdGVcclxuICovXHJcbmZ1bmN0aW9uIGR1cGxpY2F0ZUtleXMgKGlucHV0LCBmaXJzdEtleSwgc2Vjb25kS2V5KSB7XHJcbiAgLy8gSWYgYXJyYXkgcHJvdmlkZWQsIHJlY3Vyc2l2ZWx5IGNhbGwgb24gYWxsIGVsZW1lbnRzXHJcbiAgaWYgKF8uaXNBcnJheShpbnB1dCkpIHtcclxuICAgIHJldHVybiBpbnB1dC5tYXAoKGl0ZW0pID0+IGR1cGxpY2F0ZUtleXMoaXRlbSwgZmlyc3RLZXksIHNlY29uZEtleSkpO1xyXG4gIH1cclxuXHJcbiAgLy8gSWYgb2JqZWN0LCBjcmVhdGUgZHVwbGljYXRlcyBmb3Iga2V5cyBhbmQgdGhlbiByZWN1cnNpdmVseSBjYWxsIG9uIHZhbHVlc1xyXG4gIGlmIChfLmlzUGxhaW5PYmplY3QoaW5wdXQpKSB7XHJcbiAgICBjb25zdCByZXN1bHRPYmogPSB7fTtcclxuICAgIGZvciAobGV0IFtrZXksIHZhbHVlXSBvZiBfLnRvUGFpcnMoaW5wdXQpKSB7XHJcbiAgICAgIGNvbnN0IHJlY3Vyc2l2ZWx5Q2FsbGVkVmFsdWUgPSBkdXBsaWNhdGVLZXlzKHZhbHVlLCBmaXJzdEtleSwgc2Vjb25kS2V5KTtcclxuICAgICAgaWYgKGtleSA9PT0gZmlyc3RLZXkpIHtcclxuICAgICAgICByZXN1bHRPYmpbc2Vjb25kS2V5XSA9IHJlY3Vyc2l2ZWx5Q2FsbGVkVmFsdWU7XHJcbiAgICAgIH0gZWxzZSBpZiAoa2V5ID09PSBzZWNvbmRLZXkpIHtcclxuICAgICAgICByZXN1bHRPYmpbZmlyc3RLZXldID0gcmVjdXJzaXZlbHlDYWxsZWRWYWx1ZTtcclxuICAgICAgfVxyXG4gICAgICByZXN1bHRPYmpba2V5XSA9IHJlY3Vyc2l2ZWx5Q2FsbGVkVmFsdWU7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gcmVzdWx0T2JqO1xyXG4gIH1cclxuXHJcbiAgLy8gQmFzZSBjYXNlLiBSZXR1cm4gcHJpbWl0aXZlcyB3aXRob3V0IGRvaW5nIGFueXRoaW5nLlxyXG4gIHJldHVybiBpbnB1dDtcclxufVxyXG5cclxuLyoqXHJcbiAqIFRha2VzIGEgZGVzaXJlZCBjYXBhYmlsaXR5IGFuZCB0cmllcyB0byBKU09OLnBhcnNlIGl0IGFzIGFuIGFycmF5LFxyXG4gKiBhbmQgZWl0aGVyIHJldHVybnMgdGhlIHBhcnNlZCBhcnJheSBvciBhIHNpbmdsZXRvbiBhcnJheS5cclxuICpcclxuICogQHBhcmFtIHtzdHJpbmd8QXJyYXk8U3RyaW5nPn0gY2FwIEEgZGVzaXJlZCBjYXBhYmlsaXR5XHJcbiAqL1xyXG5mdW5jdGlvbiBwYXJzZUNhcHNBcnJheSAoY2FwKSB7XHJcbiAgaWYgKF8uaXNBcnJheShjYXApKSB7XHJcbiAgICByZXR1cm4gY2FwO1xyXG4gIH1cclxuXHJcbiAgbGV0IHBhcnNlZENhcHM7XHJcbiAgdHJ5IHtcclxuICAgIHBhcnNlZENhcHMgPSBKU09OLnBhcnNlKGNhcCk7XHJcbiAgICBpZiAoXy5pc0FycmF5KHBhcnNlZENhcHMpKSB7XHJcbiAgICAgIHJldHVybiBwYXJzZWRDYXBzO1xyXG4gICAgfVxyXG4gIH0gY2F0Y2ggKGlnbikge1xyXG4gICAgbG9nZ2VyLndhcm4oYEZhaWxlZCB0byBwYXJzZSBjYXBhYmlsaXR5IGFzIEpTT04gYXJyYXlgKTtcclxuICB9XHJcbiAgaWYgKF8uaXNTdHJpbmcoY2FwKSkge1xyXG4gICAgcmV0dXJuIFtjYXBdO1xyXG4gIH1cclxuICB0aHJvdyBuZXcgRXJyb3IoYG11c3QgcHJvdmlkZSBhIHN0cmluZyBvciBKU09OIEFycmF5OyByZWNlaXZlZCAke2NhcH1gKTtcclxufVxyXG5cclxuZXhwb3J0IHtcclxuICBjb25maWd1cmVBcHAsIGlzUGFja2FnZU9yQnVuZGxlLCBkdXBsaWNhdGVLZXlzLCBwYXJzZUNhcHNBcnJheVxyXG59O1xyXG4iXSwiZmlsZSI6ImxpYi9iYXNlZHJpdmVyL2hlbHBlcnMuanMiLCJzb3VyY2VSb290IjoiLi5cXC4uXFwuLiJ9
