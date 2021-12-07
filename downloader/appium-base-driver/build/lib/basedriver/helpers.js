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


//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImxpYi9iYXNlZHJpdmVyL2hlbHBlcnMuanMiXSwibmFtZXMiOlsiSVBBX0VYVCIsIlpJUF9FWFRTIiwiWklQX01JTUVfVFlQRVMiLCJDQUNIRURfQVBQU19NQVhfQUdFIiwiQVBQTElDQVRJT05TX0NBQ0hFIiwiTFJVIiwibWF4QWdlIiwidXBkYXRlQWdlT25HZXQiLCJkaXNwb3NlIiwiYXBwIiwiZnVsbFBhdGgiLCJmcyIsImV4aXN0cyIsImxvZ2dlciIsImluZm8iLCJyaW1yYWYiLCJub0Rpc3Bvc2VPblNldCIsIkFQUExJQ0FUSU9OU19DQUNIRV9HVUFSRCIsIkFzeW5jTG9jayIsIlNBTklUSVpFX1JFUExBQ0VNRU5UIiwiREVGQVVMVF9CQVNFTkFNRSIsIkFQUF9ET1dOTE9BRF9USU1FT1VUX01TIiwicHJvY2VzcyIsIm9uIiwiaXRlbUNvdW50IiwiYXBwUGF0aHMiLCJ2YWx1ZXMiLCJtYXAiLCJkZWJ1ZyIsImxlbmd0aCIsInV0aWwiLCJwbHVyYWxpemUiLCJhcHBQYXRoIiwicmltcmFmU3luYyIsImUiLCJ3YXJuIiwibWVzc2FnZSIsInJldHJpZXZlSGVhZGVycyIsImxpbmsiLCJ1cmwiLCJtZXRob2QiLCJ0aW1lb3V0IiwiaGVhZGVycyIsImdldENhY2hlZEFwcGxpY2F0aW9uUGF0aCIsImN1cnJlbnRBcHBQcm9wcyIsInJlZnJlc2giLCJoYXMiLCJsYXN0TW9kaWZpZWQiLCJjdXJyZW50TW9kaWZpZWQiLCJpbW11dGFibGUiLCJjdXJyZW50SW1tdXRhYmxlIiwiY3VycmVudE1heEFnZSIsInRpbWVzdGFtcCIsImdldCIsImdldFRpbWUiLCJtc0xlZnQiLCJEYXRlIiwibm93IiwicGF0aCIsImJhc2VuYW1lIiwidmVyaWZ5QXBwRXh0ZW5zaW9uIiwic3VwcG9ydGVkQXBwRXh0ZW5zaW9ucyIsImluY2x1ZGVzIiwiZXh0bmFtZSIsIkVycm9yIiwiY29uZmlndXJlQXBwIiwiXyIsImlzU3RyaW5nIiwiaXNBcnJheSIsIm5ld0FwcCIsInNob3VsZFVuemlwQXBwIiwiYXJjaGl2ZUhhc2giLCJyZW1vdGVBcHBQcm9wcyIsInByb3RvY29sIiwicGF0aG5hbWUiLCJwYXJzZSIsImlzVXJsIiwiYWNxdWlyZSIsImlzRW1wdHkiLCJ0ZXN0IiwibWF4QWdlTWF0Y2giLCJleGVjIiwicGFyc2VJbnQiLCJsb2NhbEZpbGUiLCJsb2NrRmlsZSIsImRvd25sb2FkSXNOZWFkZWQiLCJyZW1vdGVGaWxlTGVuZ3RoIiwic3RhdHMiLCJzdGF0IiwibG9jYWxGaWxlTGVuZ3RoIiwic2l6ZSIsInVubGluayIsIndhaXRpbmdUaW1lIiwibWF4QXR0ZW1wdHNDb3VudCIsImF0dGVtcHRzQ291bnQiLCJQcm9taXNlIiwicmVzb2x2ZSIsInNldFRpbWVvdXQiLCJzaGFyZWRGb2xkZXJQYXRoIiwiY2xvc2UiLCJvcGVuIiwiY2FjaGVkUGF0aCIsImRlbCIsImZpbGVOYW1lIiwic2FuaXRpemVOYW1lIiwiZGVjb2RlVVJJQ29tcG9uZW50IiwicmVwbGFjZW1lbnQiLCJjdCIsInNvbWUiLCJtaW1lVHlwZSIsIlJlZ0V4cCIsImVzY2FwZVJlZ0V4cCIsIm1hdGNoIiwicmVzdWx0aW5nTmFtZSIsInN1YnN0cmluZyIsInJlc3VsdGluZ0V4dCIsImZpcnN0IiwidGFyZ2V0UGF0aCIsInRlbXBEaXIiLCJwcmVmaXgiLCJzdWZmaXgiLCJkb3dubG9hZEFwcCIsImNvcHlGaWxlIiwiZXJyb3JNZXNzYWdlIiwiYXJjaGl2ZVBhdGgiLCJoYXNoIiwidG1wUm9vdCIsIm9wZW5EaXIiLCJ1bnppcEFwcCIsImlzQWJzb2x1dGUiLCJjd2QiLCJCb29sZWFuIiwic2V0IiwiaHJlZiIsIm5ldCIsImRvd25sb2FkRmlsZSIsImVyciIsInppcFBhdGgiLCJkc3RSb290IiwiemlwIiwiYXNzZXJ0VmFsaWRaaXAiLCJ0aW1lciIsInRpbWluZyIsIlRpbWVyIiwic3RhcnQiLCJleHRyYWN0aW9uT3B0cyIsInVzZVN5c3RlbVVuemlwIiwiZmlsZU5hbWVzRW5jb2RpbmciLCJleHRyYWN0QWxsVG8iLCJnbG9iUGF0dGVybiIsImV4dCIsInJlcGxhY2UiLCJqb2luIiwic29ydGVkQnVuZGxlSXRlbXMiLCJnbG9iIiwic3RyaWN0Iiwic29ydCIsImEiLCJiIiwic3BsaXQiLCJzZXAiLCJlcnJvckFuZFRocm93IiwiTWF0aCIsInJvdW5kIiwiZ2V0RHVyYXRpb24iLCJhc01pbGxpU2Vjb25kcyIsIm1hdGNoZWRCdW5kbGUiLCJkc3RQYXRoIiwibXYiLCJta2RpcnAiLCJpc1BhY2thZ2VPckJ1bmRsZSIsImR1cGxpY2F0ZUtleXMiLCJpbnB1dCIsImZpcnN0S2V5Iiwic2Vjb25kS2V5IiwiaXRlbSIsImlzUGxhaW5PYmplY3QiLCJyZXN1bHRPYmoiLCJrZXkiLCJ2YWx1ZSIsInRvUGFpcnMiLCJyZWN1cnNpdmVseUNhbGxlZFZhbHVlIiwicGFyc2VDYXBzQXJyYXkiLCJjYXAiLCJwYXJzZWRDYXBzIiwiSlNPTiIsImlnbiJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7QUFBQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFFQSxNQUFNQSxPQUFPLEdBQUcsTUFBaEI7QUFDQSxNQUFNQyxRQUFRLEdBQUcsQ0FBQyxNQUFELEVBQVNELE9BQVQsQ0FBakI7QUFDQSxNQUFNRSxjQUFjLEdBQUcsQ0FDckIsaUJBRHFCLEVBRXJCLDhCQUZxQixFQUdyQixpQkFIcUIsQ0FBdkI7QUFLQSxNQUFNQyxtQkFBbUIsR0FBRyxPQUFPLEVBQVAsR0FBWSxFQUFaLEdBQWlCLEVBQTdDO0FBQ0EsTUFBTUMsa0JBQWtCLEdBQUcsSUFBSUMsaUJBQUosQ0FBUTtBQUNqQ0MsRUFBQUEsTUFBTSxFQUFFSCxtQkFEeUI7QUFFakNJLEVBQUFBLGNBQWMsRUFBRSxJQUZpQjtBQUdqQ0MsRUFBQUEsT0FBTyxFQUFFLE9BQU9DLEdBQVAsRUFBWTtBQUFDQyxJQUFBQTtBQUFELEdBQVosS0FBMkI7QUFDbEMsUUFBSSxFQUFDLE1BQU1DLGtCQUFHQyxNQUFILENBQVVGLFFBQVYsQ0FBUCxDQUFKLEVB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Q0gsU0FBRCxDQUFULEdBQXVCTyxzQkFBdkI7QUFDRCxPQUZELE1BRU8sSUFBSUgsR0FBRyxLQUFLSixTQUFaLEVBQXVCO0FBQzVCRyxRQUFBQSxTQUFTLENBQUNKLFFBQUQsQ0FBVCxHQUFzQlEsc0JBQXRCO0FBQ0Q7O0FBQ0RKLE1BQUFBLFNBQVMsQ0FBQ0MsR0FBRCxDQUFULEdBQWlCRyxzQkFBakI7QUFDRDs7QUFDRCxXQUFPSixTQUFQO0FBQ0Q7O0FBR0QsU0FBT0wsS0FBUDtBQUNEOztBQVFELFNBQVNVLGNBQVQsQ0FBeUJDLEdBQXpCLEVBQThCO0FBQzVCLE1BQUlySCxnQkFBRUUsT0FBRixDQUFVbUgsR0FBVixDQUFKLEVBQW9CO0FBQ2xCLFdBQU9BLEdBQVA7QUFDRDs7QUFFRCxNQUFJQyxVQUFKOztBQUNBLE1BQUk7QUFDRkEsSUFBQUEsVUFBVSxHQUFHQyxJQUFJLENBQUM5RyxLQUFMLENBQVc0RyxHQUFYLENBQWI7O0FBQ0EsUUFBSXJILGdCQUFFRSxPQUFGLENBQVVvSCxVQUFWLENBQUosRUFBMkI7QUFDekIsYUFBT0EsVUFBUDtBQUNEO0FBQ0YsR0FMRCxDQUtFLE9BQU9FLEdBQVAsRUFBWTtBQUNaN0ssb0JBQU9zQixJQUFQLENBQWEsMENBQWI7QUFDRDs7QUFDRCxNQUFJK0IsZ0JBQUVDLFFBQUYsQ0FBV29ILEdBQVgsQ0FBSixFQUFxQjtBQUNuQixXQUFPLENBQUNBLEdBQUQsQ0FBUDtBQUNEOztBQUNELFFBQU0sSUFBSXZILEtBQUosQ0FBVyxpREFBZ0R1SCxHQUFJLEVBQS9ELENBQU47QUFDRCIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBfIGZyb20gJ2xvZGFzaCc7XHJcbmltcG9ydCBwYXRoIGZyb20gJ3BhdGgnO1xyXG5pbXBvcnQgdXJsIGZyb20gJ3VybCc7XHJcbmltcG9ydCBsb2dnZXIgZnJvbSAnLi9sb2dnZXInO1xyXG5pbXBvcnQgeyB0ZW1wRGlyLCBmcywgdXRpbCwgemlwLCBuZXQsIHRpbWluZyB9IGZyb20gJ2FwcGl1bS1zdXBwb3J0JztcclxuaW1wb3J0IExSVSBmcm9tICdscnUtY2FjaGUnO1xyXG5pbXBvcnQgQXN5bmNMb2NrIGZyb20gJ2FzeW5jLWxvY2snO1xyXG5pbXBvcnQgYXhpb3MgZnJvbSAnYXhpb3MnO1xyXG5pbXBvcnQgeyBnZXRTaGFyZWRGb2xkZXJGb3JBcHBVcmwsIGdldExvY2FsRmlsZUZvckFwcFVybCwgZ2V0RmlsZUNvbnRlbnRMZW5ndGggfSBmcm9tICcuL21jbG91ZC11dGlscyc7XHJcblxyXG5jb25zdCBJUEFfRVhUID0gJy5pcGEnO1xyXG5jb25zdCBaSVBfRVhUUyA9IFsnLnppcCcsIElQQV9FWFRdO1xyXG5jb25zdCBaSVBfTUlNRV9UWVBFUyA9IFtcclxuICAnYXBwbGljYXRpb24vemlwJyxcclxuICAnYXBwbGljYXRpb24veC16aXAtY29tcHJlc3NlZCcsXHJcbiAgJ211bHRpcGFydC94LXppcCcsXHJcbl07XHJcbmNvbnN0IENBQ0hFRF9BUFBTX01BWF9BR0UgPSAxMDAwICogNjAgKiA2MCAqIDI0OyAvLyBtc1xyXG5jb25zdCBBUFBMSUNBVElPTlNfQ0FDSEUgPSBuZXcgTFJVKHtcclxuICBtYXhBZ2U6IENBQ0hFRF9BUFBTX01BWF9BR0UsIC8vIGV4cGlyZSBhZnRlciAyNCBob3Vyc1xyXG4gIHVwZGF0ZUFnZU9uR2V0OiB0cnVlLFxyXG4gIGRpc3Bvc2U6IGFzeW5jIChhcHAsIHtmdWxsUGF0aH0pID0+IHtcclxuICAgIGlmICghYXdhaXQgZnMuZXhpc3RzKGZ1bGxQYXRoKSkge1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgbG9nZ2VyLmluZm8oYFRoZSBhcHBsaWNhdGlvbiAnJHthcHB9JyBjYWNoZWQgYXQgJyR7ZnVsbFBhdGh9JyBoYXMgZXhwaXJlZGApO1xyXG4gICAgYXdhaXQgZnMucmltcmFmKGZ1bGxQYXRoKTtcclxuICB9LFxyXG4gIG5vRGlzcG9zZU9uU2V0OiB0cnVlLFxyXG59KTtcclxuY29uc3QgQVBQTElDQVRJT05TX0NBQ0hFX0dVQVJEID0gbmV3IEFzeW5jTG9jaygpO1xyXG5jb25zdCBTQU5JVElaRV9SRVBMQUNFTUVOVCA9ICctJztcclxuY29uc3QgREVGQVVMVF9CQVNFTkFNRSA9ICdhcHBpdW0tYXBwJztcclxuY29uc3QgQVBQX0RPV05MT0FEX1RJTUVPVVRfTVMgPSAxMjAgKiAxMDAwO1xyXG5cclxucHJvY2Vzcy5vbignZXhpdCcsICgpID0+IHtcclxuICBpZiAoQVBQTElDQVRJT05TX0NBQ0hFLml0ZW1Db3VudCA9PT0gMCkge1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuXHJcbiAgY29uc3QgYXBwUGF0aHMgPSBBUFBMSUNBVElPTlNfQ0FDSEUudmFsdWVzKClcclxuICAgIC5tYXAoKHtmdWxsUGF0aH0pID0+IGZ1bGxQYXRoKTtcclxuICBsb2dnZXIuZGVidWcoYFBlcmZvcm1pbmcgY2xlYW51cCBvZiAke2FwcFBhdGhzLmxlbmd0aH0gY2FjaGVkIGAgK1xyXG4gICAgdXRpbC5wbHVyYWxpemUoJ2FwcGxpY2F0aW9uJywgYXBwUGF0aHMubGVuZ3RoKSk7XHJcbiAgZm9yIChjb25zdCBhcHBQYXRoIG9mIGFwcFBhdGhzKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICAvLyBBc3luY2hyb25vdXMgY2FsbHMgYXJlIG5vdCBzdXBwb3J0ZWQgaW4gb25FeGl0IGhhbmRsZXJcclxuICAgICAgZnMucmltcmFmU3luYyhhcHBQYXRoKTtcclxuICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgbG9nZ2VyLndhcm4oZS5tZXNzYWdlKTtcclxuICAgIH1cclxuICB9XHJcbn0pO1xyXG5cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIHJldHJpZXZlSGVhZGVycyAobGluaykge1xyXG4gIHRyeSB7XHJcbiAgICByZXR1cm4gKGF3YWl0IGF4aW9zKHtcclxuICAgICAgdXJsOiBsaW5rLFxyXG4gICAgICBtZXRob2Q6ICdIRUFEJyxcclxuICAgICAgdGltZW91dDogNTAwMCxcclxuICAgIH0pKS5oZWFkZXJzO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGxvZ2dlci5pbmZvKGBDYW5ub3Qgc2VuZCBIRUFEIHJlcXVlc3QgdG8gJyR7bGlua30nLiBPcmlnaW5hbCBlcnJvcjogJHtlLm1lc3NhZ2V9YCk7XHJcbiAgfVxyXG4gIHJldHVybiB7fTtcclxufVxyXG5cclxuZnVuY3Rpb24gZ2V0Q2FjaGVkQXBwbGljYXRpb25QYXRoIChsaW5rLCBjdXJyZW50QXBwUHJvcHMgPSB7fSkge1xyXG4gIGNvbnN0IHJlZnJlc2ggPSAoKSA9PiB7XHJcbiAgICBsb2dnZXIuaW5mbyhgQ1VTVE9NIEhFTFBFUiFgKTtcclxuICAgIGxvZ2dlci5kZWJ1ZyhgQSBmcmVzaCBjb3B5IG9mIHRoZSBhcHBsaWNhdGlvbiBpcyBnb2luZyB0byBiZSBkb3dubG9hZGVkIGZyb20gJHtsaW5rfWApO1xyXG4gICAgcmV0dXJuIG51bGw7XHJcbiAgfTtcclxuXHJcbiAgaWYgKEFQUExJQ0FUSU9OU19DQUNIRS5oYXMobGluaykpIHtcclxuICAgIGNvbnN0IHtcclxuICAgICAgbGFzdE1vZGlmaWVkOiBjdXJyZW50TW9kaWZpZWQsXHJcbiAgICAgIGltbXV0YWJsZTogY3VycmVudEltbXV0YWJsZSxcclxuICAgICAgLy8gbWF4QWdlIGlzIGluIHNlY29uZHNcclxuICAgICAgbWF4QWdlOiBjdXJyZW50TWF4QWdlLFxyXG4gICAgfSA9IGN1cnJlbnRBcHBQcm9wcztcclxuICAgIGNvbnN0IHtcclxuICAgICAgLy8gRGF0ZSBpbnN0YW5jZVxyXG4gICAgICBsYXN0TW9kaWZpZWQsXHJcbiAgICAgIC8vIGJvb2xlYW5cclxuICAgICAgaW1tdXRhYmxlLFxyXG4gICAgICAvLyBVbml4IHRpbWUgaW4gbWlsbGlzZWNvbmRzXHJcbiAgICAgIHRpbWVzdGFtcCxcclxuICAgICAgZnVsbFBhdGgsXHJcbiAgICB9ID0gQVBQTElDQVRJT05TX0NBQ0hFLmdldChsaW5rKTtcclxuICAgIGlmIChsYXN0TW9kaWZpZWQgJiYgY3VycmVudE1vZGlmaWVkKSB7XHJcbiAgICAgIGlmIChjdXJyZW50TW9kaWZpZWQuZ2V0VGltZSgpIDw9IGxhc3RNb2RpZmllZC5nZXRUaW1lKCkpIHtcclxuICAgICAgICBsb2dnZXIuZGVidWcoYFRoZSBhcHBsaWNhdGlvbiBhdCAke2xpbmt9IGhhcyBub3QgYmVlbiBtb2RpZmllZCBzaW5jZSAke2xhc3RNb2RpZmllZH1gKTtcclxuICAgICAgICByZXR1cm4gZnVsbFBhdGg7XHJcbiAgICAgIH1cclxuICAgICAgbG9nZ2VyLmRlYnVnKGBUaGUgYXBwbGljYXRpb24gYXQgJHtsaW5rfSBoYXMgYmVlbiBtb2RpZmllZCBzaW5jZSAke2xhc3RNb2RpZmllZH1gKTtcclxuICAgICAgcmV0dXJuIHJlZnJlc2goKTtcclxuICAgIH1cclxuICAgIGlmIChpbW11dGFibGUgJiYgY3VycmVudEltbXV0YWJsZSkge1xyXG4gICAgICBsb2dnZXIuZGVidWcoYFRoZSBhcHBsaWNhdGlvbiBhdCAke2xpbmt9IGlzIGltbXV0YWJsZWApO1xyXG4gICAgICByZXR1cm4gZnVsbFBhdGg7XHJcbiAgICB9XHJcbiAgICBpZiAoY3VycmVudE1heEFnZSAmJiB0aW1lc3RhbXApIHtcclxuICAgICAgY29uc3QgbXNMZWZ0ID0gdGltZXN0YW1wICsgY3VycmVudE1heEFnZSAqIDEwMDAgLSBEYXRlLm5vdygpO1xyXG4gICAgICBpZiAobXNMZWZ0ID4gMCkge1xyXG4gICAgICAgIGxvZ2dlci5kZWJ1ZyhgVGhlIGNhY2hlZCBhcHBsaWNhdGlvbiAnJHtwYXRoLmJhc2VuYW1lKGZ1bGxQYXRoKX0nIHdpbGwgZXhwaXJlIGluICR7bXNMZWZ0IC8gMTAwMH1zYCk7XHJcbiAgICAgICAgcmV0dXJuIGZ1bGxQYXRoO1xyXG4gICAgICB9XHJcbiAgICAgIGxvZ2dlci5kZWJ1ZyhgVGhlIGNhY2hlZCBhcHBsaWNhdGlvbiAnJHtwYXRoLmJhc2VuYW1lKGZ1bGxQYXRoKX0nIGhhcyBleHBpcmVkYCk7XHJcbiAgICB9XHJcbiAgfVxyXG4gIHJldHVybiByZWZyZXNoKCk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHZlcmlmeUFwcEV4dGVuc2lvbiAoYXBwLCBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zKSB7XHJcbiAgaWYgKHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMuaW5jbHVkZXMocGF0aC5leHRuYW1lKGFwcCkpKSB7XHJcbiAgICByZXR1cm4gYXBwO1xyXG4gIH1cclxuICB0aHJvdyBuZXcgRXJyb3IoYE5ldyBhcHAgcGF0aCAnJHthcHB9JyBkaWQgbm90IGhhdmUgYCArXHJcbiAgICBgJHt1dGlsLnBsdXJhbGl6ZSgnZXh0ZW5zaW9uJywgc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucy5sZW5ndGgsIGZhbHNlKX06IGAgK1xyXG4gICAgc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucyk7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGNvbmZpZ3VyZUFwcCAoYXBwLCBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zKSB7XHJcbiAgaWYgKCFfLmlzU3RyaW5nKGFwcCkpIHtcclxuICAgIC8vIGltbWVkaWF0ZWx5IHNob3J0Y2lyY3VpdCBpZiBub3QgZ2l2ZW4gYW4gYXBwXHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGlmICghXy5pc0FycmF5KHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMpKSB7XHJcbiAgICBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zID0gW3N1cHBvcnRlZEFwcEV4dGVuc2lvbnNdO1xyXG4gIH1cclxuXHJcbiAgbGV0IG5ld0FwcCA9IGFwcDtcclxuICBsZXQgc2hvdWxkVW56aXBBcHAgPSBmYWxzZTtcclxuICBsZXQgYXJjaGl2ZUhhc2ggPSBudWxsO1xyXG4gIGNvbnN0IHJlbW90ZUFwcFByb3BzID0ge1xyXG4gICAgbGFzdE1vZGlmaWVkOiBudWxsLFxyXG4gICAgaW1tdXRhYmxlOiBmYWxzZSxcclxuICAgIG1heEFnZTogbnVsbCxcclxuICB9O1xyXG4gIGNvbnN0IHtwcm90b2NvbCwgcGF0aG5hbWV9ID0gdXJsLnBhcnNlKG5ld0FwcCk7XHJcbiAgY29uc3QgaXNVcmwgPSBbJ2h0dHA6JywgJ2h0dHBzOiddLmluY2x1ZGVzKHByb3RvY29sKTtcclxuXHJcbiAgcmV0dXJuIGF3YWl0IEFQUExJQ0FUSU9OU19DQUNIRV9HVUFSRC5hY3F1aXJlKGFwcCwgYXN5bmMgKCkgPT4ge1xyXG4gICAgaWYgKGlzVXJsKSB7XHJcbiAgICAgIC8vIFVzZSB0aGUgYXBwIGZyb20gcmVtb3RlIFVSTFxyXG4gICAgICBsb2dnZXIuaW5mbyhgVXNpbmcgZG93bmxvYWRhYmxlIGFwcCAnJHtuZXdBcHB9J2ApO1xyXG4gICAgICBjb25zdCBoZWFkZXJzID0gYXdhaXQgcmV0cmlldmVIZWFkZXJzKG5ld0FwcCk7XHJcbiAgICAgIGlmICghXy5pc0VtcHR5KGhlYWRlcnMpKSB7XHJcbiAgICAgICAgaWYgKGhlYWRlcnNbJ2xhc3QtbW9kaWZpZWQnXSkge1xyXG4gICAgICAgICAgcmVtb3RlQXBwUHJvcHMubGFzdE1vZGlmaWVkID0gbmV3IERhdGUoaGVhZGVyc1snbGFzdC1tb2RpZmllZCddKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgbG9nZ2VyLmRlYnVnKGBMYXN0LU1vZGlmaWVkOiAke2hlYWRlcnNbJ2xhc3QtbW9kaWZpZWQnXX1gKTtcclxuICAgICAgICBpZiAoaGVhZGVyc1snY2FjaGUtY29udHJvbCddKSB7XHJcbiAgICAgICAgICByZW1vdGVBcHBQcm9wcy5pbW11dGFibGUgPSAvXFxiaW1tdXRhYmxlXFxiL2kudGVzdChoZWFkZXJzWydjYWNoZS1jb250cm9sJ10pO1xyXG4gICAgICAgICAgY29uc3QgbWF4QWdlTWF0Y2ggPSAvXFxibWF4LWFnZT0oXFxkKylcXGIvaS5leGVjKGhlYWRlcnNbJ2NhY2hlLWNvbnRyb2wnXSk7XHJcbiAgICAgICAgICBpZiAobWF4QWdlTWF0Y2gpIHtcclxuICAgICAgICAgICAgcmVtb3RlQXBwUHJvcHMubWF4QWdlID0gcGFyc2VJbnQobWF4QWdlTWF0Y2hbMV0sIDEwKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgbG9nZ2VyLmRlYnVnKGBDYWNoZS1Db250cm9sOiAke2hlYWRlcnNbJ2NhY2hlLWNvbnRyb2wnXX1gKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gKioqKiogQ3VzdG9tIGxvZ2ljIGZvciB2ZXJpZmljYXRpb24gb2YgbG9jYWwgc3RhdGljIHBhdGggZm9yIEFQUHMgKioqKipcclxuICAgICAgY29uc3QgbG9jYWxGaWxlID0gYXdhaXQgZ2V0TG9jYWxGaWxlRm9yQXBwVXJsKG5ld0FwcCk7XHJcbiAgICAgIGNvbnN0IGxvY2tGaWxlID0gbG9jYWxGaWxlICsgJy5sb2NrJztcclxuICAgICAgbGV0IGRvd25sb2FkSXNOZWFkZWQ7XHJcbiAgICAgIGlmKGF3YWl0IGZzLmV4aXN0cyhsb2NhbEZpbGUpKSB7XHJcbiAgICAgICAgbG9nZ2VyLmluZm8oYExvY2FsIHZlcnNpb24gb2YgYXBwIHdhcyBmb3VuZC4gV2lsbCBjaGVjayBhY3R1YWxpdHkgb2YgdGhlIGZpbGVgKTtcclxuICAgICAgICAvLyBDaGVja2luZyBvZiBsb2NhbCBhcHBsaWNhdGlvbiBhY3R1YWxpdHlcclxuICAgICAgICBjb25zdCByZW1vdGVGaWxlTGVuZ3RoID0gYXdhaXQgZ2V0RmlsZUNvbnRlbnRMZW5ndGgoYXBwKTtcclxuICAgICAgICBjb25zdCBzdGF0cyA9IGF3YWl0IGZzLnN0YXQobG9jYWxGaWxlKTtcclxuICAgICAgICBjb25zdCBsb2NhbEZpbGVMZW5ndGggPSBzdGF0cy5zaXplO1xyXG4gICAgICAgIGxvZ2dlci5pbmZvKGBSZW1vdGUgZmlsZSBzaXplIGlzICR7cmVtb3RlRmlsZUxlbmd0aH0gYW5kIGxvY2FsIGZpbGUgc2l6ZSBpcyAke2xvY2FsRmlsZUxlbmd0aH1gKTtcclxuICAgICAgICBpZihyZW1vdGVGaWxlTGVuZ3RoICE9IGxvY2FsRmlsZUxlbmd0aCkge1xyXG4gICAgICAgICAgbG9nZ2VyLmluZm8oYFNpemVzIGRpZmZlci4gSGVuY2UgdGhhdCdzIG5lZWRlZCB0byBkb3dubG9hZCBmcmVzaCB2ZXJzaW9uIG9mIHRoZSBhcHBgKTtcclxuICAgICAgICAgIGF3YWl0IGZzLnVubGluayhsb2NhbEZpbGUpO1xyXG4gICAgICAgICAgZG93bmxvYWRJc05lYWRlZCA9IHRydWU7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgIGxvZ2dlci5pbmZvKGBTaXplcyBhcmUgdGhlIHNhbWUuIEhlbmNlIHdpbGwgdXNlIGFscmVhZHkgc3RvcmVkIGFwcGxpY2F0aW9uIGZvciB0aGUgc2Vzc2lvbmApO1xyXG4gICAgICAgICAgbmV3QXBwID0gbG9jYWxGaWxlO1xyXG4gICAgICAgICAgc2hvdWxkVW56aXBBcHAgPSBaSVBfRVhUUy5pbmNsdWRlcyhwYXRoLmV4dG5hbWUobmV3QXBwKSk7XHJcbiAgICAgICAgICBkb3dubG9hZElzTmVhZGVkID0gZmFsc2U7XHJcbiAgICAgICAgfVxyXG4gICAgICB9IGVsc2UgaWYgKGF3YWl0IGZzLmV4aXN0cyhsb2NrRmlsZSkpIHtcclxuICAgICAgICAvLyBXYWl0IGZvciBzb21lIHRpbWUgdGlsbCBBcHAgaXMgZG93bmxvYWRlZCBieSBzb21lIHBhcmFsbGVsIEFwcGl1bSBpbnN0YW5jZVxyXG4gICAgICAgIGNvbnN0IHdhaXRpbmdUaW1lID0gNTAwMDtcclxuICAgICAgICB2YXIgbWF4QXR0ZW1wdHNDb3VudCA9IDUgKiAxMjtcclxuICAgICAgICAvLyBjb25zdCB3YWl0aW5nVGltZSA9IDEwMDA7XHJcbiAgICAgICAgLy8gY29uc3QgbWF4QXR0ZW1wdHNDb3VudCA9IDU7XHJcbiAgICAgICAgdmFyIGF0dGVtcHRzQ291bnQgPSAwO1xyXG4gICAgICAgIHdoaWxlKGF3YWl0IGZzLmV4aXN0cyhsb2NrRmlsZSkgJiYgKGF0dGVtcHRzQ291bnQrKyA8IG1heEF0dGVtcHRzQ291bnQpKSB7XHJcbiAgICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xyXG4gICAgICAgICAgICBsb2dnZXIuaW5mbyhgQXR0ZW1wdCAjJHthdHRlbXB0c0NvdW50fSBmb3IgLmxvY2sgZmlsZSBjaGVja2luZ2ApO1xyXG4gICAgICAgICAgICBzZXRUaW1lb3V0KHJlc29sdmUsIHdhaXRpbmdUaW1lKTtcclxuICAgICAgICAgIH0pO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZihhd2FpdCBmcy5leGlzdHMobG9ja0ZpbGUpKSB7XHJcbiAgICAgICAgICB0aHJvdyBFcnJvcihgLmxvY2sgZmlsZSBmb3IgZG93bmxvYWRpbmcgYXBwbGljYXRpb24gaGFzIG5vdCBkaXNhcHBlYXJlZCBhZnRlciAke3dhaXRpbmdUaW1lICogbWF4QXR0ZW1wdHNDb3VudH1tc2ApO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZighYXdhaXQgZnMuZXhpc3RzKGxvY2FsRmlsZSkpIHtcclxuICAgICAgICAgIHRocm93IEVycm9yKGBMb2NhbCBhcHBsaWNhdGlvbiBmaWxlIGhhcyBub3QgYXBwZWFyZWQgYWZ0ZXIgLmxvY2sgZmlsZSByZW1vdmFsYCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGxvZ2dlci5pbmZvKGBMb2NhbCB2ZXJzaW9uIG9mIGFwcCB3YXMgZm91bmQgYWZ0ZXIgLmxvY2sgZmlsZSByZW1vdmFsLiBXaWxsIHVzZSBpdCBmb3IgbmV3IHNlc3Npb25gKTtcclxuICAgICAgICBuZXdBcHAgPSBsb2NhbEZpbGU7XHJcbiAgICAgICAgc2hvdWxkVW56aXBBcHAgPSBaSVBfRVhUUy5pbmNsdWRlcyhwYXRoLmV4dG5hbWUobmV3QXBwKSk7XHJcbiAgICAgICAgZG93bmxvYWRJc05lYWRlZCA9IGZhbHNlO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIGRvd25sb2FkSXNOZWFkZWQgPSB0cnVlO1xyXG4gICAgICB9XHJcbiAgICAgIGlmKGRvd25sb2FkSXNOZWFkZWQpIHtcclxuICAgICAgbG9nZ2VyLmluZm8oYExvY2FsIHZlcnNpb24gb2YgYXBwIHdhcyBub3QgZm91bmQuIEhlbmNlIHVzaW5nIGRlZmF1bHQgQXBwaXVtIGxvZ2ljIGZvciBkb3dubG9hZGluZ2ApO1xyXG4gICAgICBjb25zdCBzaGFyZWRGb2xkZXJQYXRoID0gYXdhaXQgZ2V0U2hhcmVkRm9sZGVyRm9yQXBwVXJsKGFwcCk7XHJcbiAgICAgIGxvZ2dlci5pbmZvKGBGb2xkZXIgZm9yIGxvY2FsIHNoYXJlZCBhcHBzOiAke3NoYXJlZEZvbGRlclBhdGh9YCk7XHJcbiAgICAgIGF3YWl0IGZzLmNsb3NlKGF3YWl0IGZzLm9wZW4obG9ja0ZpbGUsICd3JykpO1xyXG4gICAgICB0cnkge1xyXG5cclxuICAgICAgY29uc3QgY2FjaGVkUGF0aCA9IGdldENhY2hlZEFwcGxpY2F0aW9uUGF0aChhcHAsIHJlbW90ZUFwcFByb3BzKTtcclxuICAgICAgaWYgKGNhY2hlZFBhdGgpIHtcclxuICAgICAgICBpZiAoYXdhaXQgZnMuZXhpc3RzKGNhY2hlZFBhdGgpKSB7XHJcbiAgICAgICAgICBsb2dnZXIuaW5mbyhgUmV1c2luZyBwcmV2aW91c2x5IGRvd25sb2FkZWQgYXBwbGljYXRpb24gYXQgJyR7Y2FjaGVkUGF0aH0nYCk7XHJcbiAgICAgICAgICByZXR1cm4gdmVyaWZ5QXBwRXh0ZW5zaW9uKGNhY2hlZFBhdGgsIHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBsb2dnZXIuaW5mbyhgVGhlIGFwcGxpY2F0aW9uIGF0ICcke2NhY2hlZFBhdGh9JyBkb2VzIG5vdCBleGlzdCBhbnltb3JlLiBEZWxldGluZyBpdCBmcm9tIHRoZSBjYWNoZWApO1xyXG4gICAgICAgIEFQUExJQ0FUSU9OU19DQUNIRS5kZWwoYXBwKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgbGV0IGZpbGVOYW1lID0gbnVsbDtcclxuICAgICAgY29uc3QgYmFzZW5hbWUgPSBmcy5zYW5pdGl6ZU5hbWUocGF0aC5iYXNlbmFtZShkZWNvZGVVUklDb21wb25lbnQocGF0aG5hbWUpKSwge1xyXG4gICAgICAgIHJlcGxhY2VtZW50OiBTQU5JVElaRV9SRVBMQUNFTUVOVFxyXG4gICAgICB9KTtcclxuICAgICAgY29uc3QgZXh0bmFtZSA9IHBhdGguZXh0bmFtZShiYXNlbmFtZSk7XHJcbiAgICAgIC8vIHRvIGRldGVybWluZSBpZiB3ZSBuZWVkIHRvIHVuemlwIHRoZSBhcHAsIHdlIGhhdmUgYSBudW1iZXIgb2YgcGxhY2VzXHJcbiAgICAgIC8vIHRvIGxvb2s6IGNvbnRlbnQgdHlwZSwgY29udGVudCBkaXNwb3NpdGlvbiwgb3IgdGhlIGZpbGUgZXh0ZW5zaW9uXHJcbiAgICAgIGlmIChaSVBfRVhUUy5pbmNsdWRlcyhleHRuYW1lKSkge1xyXG4gICAgICAgIGZpbGVOYW1lID0gYmFzZW5hbWU7XHJcbiAgICAgICAgc2hvdWxkVW56aXBBcHAgPSB0cnVlO1xyXG4gICAgICB9XHJcbiAgICAgIGlmIChoZWFkZXJzWydjb250ZW50LXR5cGUnXSkge1xyXG4gICAgICAgIGNvbnN0IGN0ID0gaGVhZGVyc1snY29udGVudC10eXBlJ107XHJcbiAgICAgICAgbG9nZ2VyLmRlYnVnKGBDb250ZW50LVR5cGU6ICR7Y3R9YCk7XHJcbiAgICAgICAgLy8gdGhlIGZpbGV0eXBlIG1heSBub3QgYmUgb2J2aW91cyBmb3IgY2VydGFpbiB1cmxzLCBzbyBjaGVjayB0aGUgbWltZSB0eXBlIHRvb1xyXG4gICAgICAgIGlmIChaSVBfTUlNRV9UWVBFUy5zb21lKChtaW1lVHlwZSkgPT4gbmV3IFJlZ0V4cChgXFxcXGIke18uZXNjYXBlUmVnRXhwKG1pbWVUeXBlKX1cXFxcYmApLnRlc3QoY3QpKSkge1xyXG4gICAgICAgICAgaWYgKCFmaWxlTmFtZSkge1xyXG4gICAgICAgICAgICBmaWxlTmFtZSA9IGAke0RFRkFVTFRfQkFTRU5BTUV9LnppcGA7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBzaG91bGRVbnppcEFwcCA9IHRydWU7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIGlmIChoZWFkZXJzWydjb250ZW50LWRpc3Bvc2l0aW9uJ10gJiYgL15hdHRhY2htZW50L2kudGVzdChoZWFkZXJzWydjb250ZW50LWRpc3Bvc2l0aW9uJ10pKSB7XHJcbiAgICAgICAgbG9nZ2VyLmRlYnVnKGBDb250ZW50LURpc3Bvc2l0aW9uOiAke2hlYWRlcnNbJ2NvbnRlbnQtZGlzcG9zaXRpb24nXX1gKTtcclxuICAgICAgICBjb25zdCBtYXRjaCA9IC9maWxlbmFtZT1cIihbXlwiXSspL2kuZXhlYyhoZWFkZXJzWydjb250ZW50LWRpc3Bvc2l0aW9uJ10pO1xyXG4gICAgICAgIGlmIChtYXRjaCkge1xyXG4gICAgICAgICAgZmlsZU5hbWUgPSBmcy5zYW5pdGl6ZU5hbWUobWF0Y2hbMV0sIHtcclxuICAgICAgICAgICAgcmVwbGFjZW1lbnQ6IFNBTklUSVpFX1JFUExBQ0VNRU5UXHJcbiAgICAgICAgICB9KTtcclxuICAgICAgICAgIHNob3VsZFVuemlwQXBwID0gc2hvdWxkVW56aXBBcHAgfHwgWklQX0VYVFMuaW5jbHVkZXMocGF0aC5leHRuYW1lKGZpbGVOYW1lKSk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIGlmICghZmlsZU5hbWUpIHtcclxuICAgICAgICAvLyBhc3NpZ24gdGhlIGRlZmF1bHQgZmlsZSBuYW1lIGFuZCB0aGUgZXh0ZW5zaW9uIGlmIG5vbmUgaGFzIGJlZW4gZGV0ZWN0ZWRcclxuICAgICAgICBjb25zdCByZXN1bHRpbmdOYW1lID0gYmFzZW5hbWVcclxuICAgICAgICAgID8gYmFzZW5hbWUuc3Vic3RyaW5nKDAsIGJhc2VuYW1lLmxlbmd0aCAtIGV4dG5hbWUubGVuZ3RoKVxyXG4gICAgICAgICAgOiBERUZBVUxUX0JBU0VOQU1FO1xyXG4gICAgICAgIGxldCByZXN1bHRpbmdFeHQgPSBleHRuYW1lO1xyXG4gICAgICAgIGlmICghc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucy5pbmNsdWRlcyhyZXN1bHRpbmdFeHQpKSB7XHJcbiAgICAgICAgICBsb2dnZXIuaW5mbyhgVGhlIGN1cnJlbnQgZmlsZSBleHRlbnNpb24gJyR7cmVzdWx0aW5nRXh0fScgaXMgbm90IHN1cHBvcnRlZC4gYCArXHJcbiAgICAgICAgICAgIGBEZWZhdWx0aW5nIHRvICcke18uZmlyc3Qoc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucyl9J2ApO1xyXG4gICAgICAgICAgcmVzdWx0aW5nRXh0ID0gXy5maXJzdChzdXBwb3J0ZWRBcHBFeHRlbnNpb25zKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgZmlsZU5hbWUgPSBgJHtyZXN1bHRpbmdOYW1lfSR7cmVzdWx0aW5nRXh0fWA7XHJcbiAgICAgIH1cclxuICAgICAgY29uc3QgdGFyZ2V0UGF0aCA9IGF3YWl0IHRlbXBEaXIucGF0aCh7XHJcbiAgICAgICAgcHJlZml4OiBmaWxlTmFtZSxcclxuICAgICAgICBzdWZmaXg6ICcnLFxyXG4gICAgICB9KTtcclxuICAgICAgbmV3QXBwID0gYXdhaXQgZG93bmxvYWRBcHAobmV3QXBwLCB0YXJnZXRQYXRoKTtcclxuXHJcbiAgICAgIC8vICoqKioqIEN1c3RvbSBsb2dpYyBmb3IgY29weWluZyBvZiBkb3dubG9hZGVkIGFwcCB0byBzdGF0aWMgbG9jYXRpb24gKioqKipcclxuICAgICAgbG9nZ2VyLmluZm8oYE5ldyBhcHAgcGF0aDogJHtuZXdBcHB9YCk7XHJcbiAgICAgIGF3YWl0IGZzLmNvcHlGaWxlKG5ld0FwcCwgbG9jYWxGaWxlKTtcclxuICAgICAgfVxyXG4gICAgICBmaW5hbGx5IHtcclxuICAgICAgICBsb2dnZXIuaW5mbyhgR29pbmcgdG8gcmVtb3ZlIGxvY2sgZmlsZSAke2xvY2tGaWxlfWApXHJcbiAgICAgICAgYXdhaXQgZnMudW5saW5rKGxvY2tGaWxlKTtcclxuICAgICAgfVxyXG4gICAgICB9XHJcbiAgICB9IGVsc2UgaWYgKGF3YWl0IGZzLmV4aXN0cyhuZXdBcHApKSB7XHJcbiAgICAgIC8vIFVzZSB0aGUgbG9jYWwgYXBwXHJcbiAgICAgIGxvZ2dlci5pbmZvKGBVc2luZyBsb2NhbCBhcHAgJyR7bmV3QXBwfSdgKTtcclxuICAgICAgc2hvdWxkVW56aXBBcHAgPSBaSVBfRVhUUy5pbmNsdWRlcyhwYXRoLmV4dG5hbWUobmV3QXBwKSk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICBsZXQgZXJyb3JNZXNzYWdlID0gYFRoZSBhcHBsaWNhdGlvbiBhdCAnJHtuZXdBcHB9JyBkb2VzIG5vdCBleGlzdCBvciBpcyBub3QgYWNjZXNzaWJsZWA7XHJcbiAgICAgIC8vIHByb3RvY29sIHZhbHVlIGZvciAnQzpcXFxcdGVtcCcgaXMgJ2M6Jywgc28gd2UgY2hlY2sgdGhlIGxlbmd0aCBhcyB3ZWxsXHJcbiAgICAgIGlmIChfLmlzU3RyaW5nKHByb3RvY29sKSAmJiBwcm90b2NvbC5sZW5ndGggPiAyKSB7XHJcbiAgICAgICAgZXJyb3JNZXNzYWdlID0gYFRoZSBwcm90b2NvbCAnJHtwcm90b2NvbH0nIHVzZWQgaW4gJyR7bmV3QXBwfScgaXMgbm90IHN1cHBvcnRlZC4gYCArXHJcbiAgICAgICAgICBgT25seSBodHRwOiBhbmQgaHR0cHM6IHByb3RvY29scyBhcmUgc3VwcG9ydGVkYDtcclxuICAgICAgfVxyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoZXJyb3JNZXNzYWdlKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoc2hvdWxkVW56aXBBcHApIHtcclxuICAgICAgY29uc3QgYXJjaGl2ZVBhdGggPSBuZXdBcHA7XHJcbiAgICAgIGFyY2hpdmVIYXNoID0gYXdhaXQgZnMuaGFzaChhcmNoaXZlUGF0aCk7XHJcbiAgICAgIGlmIChBUFBMSUNBVElPTlNfQ0FDSEUuaGFzKGFwcCkgJiYgYXJjaGl2ZUhhc2ggPT09IEFQUExJQ0FUSU9OU19DQUNIRS5nZXQoYXBwKS5oYXNoKSB7XHJcbiAgICAgICAgY29uc3Qge2Z1bGxQYXRofSA9IEFQUExJQ0FUSU9OU19DQUNIRS5nZXQoYXBwKTtcclxuICAgICAgICBpZiAoYXdhaXQgZnMuZXhpc3RzKGZ1bGxQYXRoKSkge1xyXG4gICAgICAgICAgaWYgKGFyY2hpdmVQYXRoICE9PSBhcHApIHtcclxuICAgICAgICAgICAgYXdhaXQgZnMucmltcmFmKGFyY2hpdmVQYXRoKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIGxvZ2dlci5pbmZvKGBXaWxsIHJldXNlIHByZXZpb3VzbHkgY2FjaGVkIGFwcGxpY2F0aW9uIGF0ICcke2Z1bGxQYXRofSdgKTtcclxuICAgICAgICAgIHJldHVybiB2ZXJpZnlBcHBFeHRlbnNpb24oZnVsbFBhdGgsIHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBsb2dnZXIuaW5mbyhgVGhlIGFwcGxpY2F0aW9uIGF0ICcke2Z1bGxQYXRofScgZG9lcyBub3QgZXhpc3QgYW55bW9yZS4gRGVsZXRpbmcgaXQgZnJvbSB0aGUgY2FjaGVgKTtcclxuICAgICAgICBBUFBMSUNBVElPTlNfQ0FDSEUuZGVsKGFwcCk7XHJcbiAgICAgIH1cclxuICAgICAgY29uc3QgdG1wUm9vdCA9IGF3YWl0IHRlbXBEaXIub3BlbkRpcigpO1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIG5ld0FwcCA9IGF3YWl0IHVuemlwQXBwKGFyY2hpdmVQYXRoLCB0bXBSb290LCBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zKTtcclxuICAgICAgfSBmaW5hbGx5IHtcclxuICAgICAgICBpZiAobmV3QXBwICE9PSBhcmNoaXZlUGF0aCAmJiBhcmNoaXZlUGF0aCAhPT0gYXBwKSB7XHJcbiAgICAgICAgICBhd2FpdCBmcy5yaW1yYWYoYXJjaGl2ZVBhdGgpO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgICBsb2dnZXIuaW5mbyhgVW56aXBwZWQgbG9jYWwgYXBwIHRvICcke25ld0FwcH0nYCk7XHJcbiAgICB9IGVsc2UgaWYgKCFwYXRoLmlzQWJzb2x1dGUobmV3QXBwKSkge1xyXG4gICAgICBuZXdBcHAgPSBwYXRoLnJlc29sdmUocHJvY2Vzcy5jd2QoKSwgbmV3QXBwKTtcclxuICAgICAgbG9nZ2VyLndhcm4oYFRoZSBjdXJyZW50IGFwcGxpY2F0aW9uIHBhdGggJyR7YXBwfScgaXMgbm90IGFic29sdXRlIGAgK1xyXG4gICAgICAgIGBhbmQgaGFzIGJlZW4gcmV3cml0dGVuIHRvICcke25ld0FwcH0nLiBDb25zaWRlciB1c2luZyBhYnNvbHV0ZSBwYXRocyByYXRoZXIgdGhhbiByZWxhdGl2ZWApO1xyXG4gICAgICBhcHAgPSBuZXdBcHA7XHJcbiAgICB9XHJcblxyXG4gICAgdmVyaWZ5QXBwRXh0ZW5zaW9uKG5ld0FwcCwgc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucyk7XHJcblxyXG4gICAgaWYgKGFwcCAhPT0gbmV3QXBwICYmIChhcmNoaXZlSGFzaCB8fCBfLnZhbHVlcyhyZW1vdGVBcHBQcm9wcykuc29tZShCb29sZWFuKSkpIHtcclxuICAgICAgaWYgKEFQUExJQ0FUSU9OU19DQUNIRS5oYXMoYXBwKSkge1xyXG4gICAgICAgIGNvbnN0IHtmdWxsUGF0aH0gPSBBUFBMSUNBVElPTlNfQ0FDSEUuZ2V0KGFwcCk7XHJcbiAgICAgICAgLy8gQ2xlYW4gdXAgdGhlIG9ic29sZXRlIGVudHJ5IGZpcnN0IGlmIG5lZWRlZFxyXG4gICAgICAgIGlmIChmdWxsUGF0aCAhPT0gbmV3QXBwICYmIGF3YWl0IGZzLmV4aXN0cyhmdWxsUGF0aCkpIHtcclxuICAgICAgICAgIGF3YWl0IGZzLnJpbXJhZihmdWxsUGF0aCk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIEFQUExJQ0FUSU9OU19DQUNIRS5zZXQoYXBwLCB7XHJcbiAgICAgICAgLi4ucmVtb3RlQXBwUHJvcHMsXHJcbiAgICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxyXG4gICAgICAgIGhhc2g6IGFyY2hpdmVIYXNoLFxyXG4gICAgICAgIGZ1bGxQYXRoOiBuZXdBcHAsXHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIG5ld0FwcDtcclxuICB9KTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gZG93bmxvYWRBcHAgKGFwcCwgdGFyZ2V0UGF0aCkge1xyXG4gIGNvbnN0IHtocmVmfSA9IHVybC5wYXJzZShhcHApO1xyXG4gIHRyeSB7XHJcbiAgICBhd2FpdCBuZXQuZG93bmxvYWRGaWxlKGhyZWYsIHRhcmdldFBhdGgsIHtcclxuICAgICAgdGltZW91dDogQVBQX0RPV05MT0FEX1RJTUVPVVRfTVMsXHJcbiAgICB9KTtcclxuICB9IGNhdGNoIChlcnIpIHtcclxuICAgIHRocm93IG5ldyBFcnJvcihgVW5hYmxlIHRvIGRvd25sb2FkIHRoZSBhcHA6ICR7ZXJyLm1lc3NhZ2V9YCk7XHJcbiAgfVxyXG4gIHJldHVybiB0YXJnZXRQYXRoO1xyXG59XHJcblxyXG4vKipcclxuICogRXh0cmFjdHMgdGhlIGJ1bmRsZSBmcm9tIGFuIGFyY2hpdmUgaW50byB0aGUgZ2l2ZW4gZm9sZGVyXHJcbiAqXHJcbiAqIEBwYXJhbSB7c3RyaW5nfSB6aXBQYXRoIEZ1bGwgcGF0aCB0byB0aGUgYXJjaGl2ZSBjb250YWluaW5nIHRoZSBidW5kbGVcclxuICogQHBhcmFtIHtzdHJpbmd9IGRzdFJvb3QgRnVsbCBwYXRoIHRvIHRoZSBmb2xkZXIgd2hlcmUgdGhlIGV4dHJhY3RlZCBidW5kbGVcclxuICogc2hvdWxkIGJlIHBsYWNlZFxyXG4gKiBAcGFyYW0ge0FycmF5PHN0cmluZz58c3RyaW5nfSBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zIFRoZSBsaXN0IG9mIGV4dGVuc2lvbnNcclxuICogdGhlIHRhcmdldCBhcHBsaWNhdGlvbiBidW5kbGUgc3VwcG9ydHMsIGZvciBleGFtcGxlIFsnLmFwaycsICcuYXBrcyddIGZvclxyXG4gKiBBbmRyb2lkIHBhY2thZ2VzXHJcbiAqIEByZXR1cm5zIHtzdHJpbmd9IEZ1bGwgcGF0aCB0byB0aGUgYnVuZGxlIGluIHRoZSBkZXN0aW5hdGlvbiBmb2xkZXJcclxuICogQHRocm93cyB7RXJyb3J9IElmIHRoZSBnaXZlbiBhcmNoaXZlIGlzIGludmFsaWQgb3Igbm8gYXBwbGljYXRpb24gYnVuZGxlc1xyXG4gKiBoYXZlIGJlZW4gZm91bmQgaW5zaWRlXHJcbiAqL1xyXG5hc3luYyBmdW5jdGlvbiB1bnppcEFwcCAoemlwUGF0aCwgZHN0Um9vdCwgc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucykge1xyXG4gIGF3YWl0IHppcC5hc3NlcnRWYWxpZFppcCh6aXBQYXRoKTtcclxuXHJcbiAgaWYgKCFfLmlzQXJyYXkoc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucykpIHtcclxuICAgIHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMgPSBbc3VwcG9ydGVkQXBwRXh0ZW5zaW9uc107XHJcbiAgfVxyXG5cclxuICBjb25zdCB0bXBSb290ID0gYXdhaXQgdGVtcERpci5vcGVuRGlyKCk7XHJcbiAgdHJ5IHtcclxuICAgIGxvZ2dlci5kZWJ1ZyhgVW56aXBwaW5nICcke3ppcFBhdGh9J2ApO1xyXG4gICAgY29uc3QgdGltZXIgPSBuZXcgdGltaW5nLlRpbWVyKCkuc3RhcnQoKTtcclxuICAgIC8qKlxyXG4gICAgICogQXR0ZW1wdCB0byB1c2UgdXNlIHRoZSBzeXN0ZW0gYHVuemlwYCAoZS5nLiwgYC91c3IvYmluL3VuemlwYCkgZHVlXHJcbiAgICAgKiB0byB0aGUgc2lnbmlmaWNhbnQgcGVyZm9ybWFuY2UgaW1wcm92ZW1lbnQgaXQgcHJvdmlkZXMgb3ZlciB0aGUgbmF0aXZlXHJcbiAgICAgKiBKUyBcInVuemlwXCIgaW1wbGVtZW50YXRpb24uXHJcbiAgICAgKiBAdHlwZSB7aW1wb3J0KCdhcHBpdW0tc3VwcG9ydC9saWIvemlwJykuRXh0cmFjdEFsbE9wdGlvbnN9XHJcbiAgICAgKi9cclxuICAgIGNvbnN0IGV4dHJhY3Rpb25PcHRzID0ge1xyXG4gICAgICB1c2VTeXN0ZW1VbnppcDogdHJ1ZSxcclxuICAgIH07XHJcbiAgICAvLyBodHRwczovL2dpdGh1Yi5jb20vYXBwaXVtL2FwcGl1bS9pc3N1ZXMvMTQxMDBcclxuICAgIGlmIChwYXRoLmV4dG5hbWUoemlwUGF0aCkgPT09IElQQV9FWFQpIHtcclxuICAgICAgbG9nZ2VyLmRlYnVnKGBFbmZvcmNpbmcgVVRGLTggZW5jb2Rpbmcgb24gdGhlIGV4dHJhY3RlZCBmaWxlIG5hbWVzIGZvciAnJHtwYXRoLmJhc2VuYW1lKHppcFBhdGgpfSdgKTtcclxuICAgICAgZXh0cmFjdGlvbk9wdHMuZmlsZU5hbWVzRW5jb2RpbmcgPSAndXRmOCc7XHJcbiAgICB9XHJcbiAgICBhd2FpdCB6aXAuZXh0cmFjdEFsbFRvKHppcFBhdGgsIHRtcFJvb3QsIGV4dHJhY3Rpb25PcHRzKTtcclxuICAgIGNvbnN0IGdsb2JQYXR0ZXJuID0gYCoqLyouKygke3N1cHBvcnRlZEFwcEV4dGVuc2lvbnMubWFwKChleHQpID0+IGV4dC5yZXBsYWNlKC9eXFwuLywgJycpKS5qb2luKCd8Jyl9KWA7XHJcbiAgICBjb25zdCBzb3J0ZWRCdW5kbGVJdGVtcyA9IChhd2FpdCBmcy5nbG9iKGdsb2JQYXR0ZXJuLCB7XHJcbiAgICAgIGN3ZDogdG1wUm9vdCxcclxuICAgICAgc3RyaWN0OiBmYWxzZSxcclxuICAgIC8vIEdldCB0aGUgdG9wIGxldmVsIG1hdGNoXHJcbiAgICB9KSkuc29ydCgoYSwgYikgPT4gYS5zcGxpdChwYXRoLnNlcCkubGVuZ3RoIC0gYi5zcGxpdChwYXRoLnNlcCkubGVuZ3RoKTtcclxuICAgIGlmIChfLmlzRW1wdHkoc29ydGVkQnVuZGxlSXRlbXMpKSB7XHJcbiAgICAgIGxvZ2dlci5lcnJvckFuZFRocm93KGBBcHAgdW56aXBwZWQgT0ssIGJ1dCB3ZSBjb3VsZCBub3QgZmluZCBhbnkgJyR7c3VwcG9ydGVkQXBwRXh0ZW5zaW9uc30nIGAgK1xyXG4gICAgICAgIHV0aWwucGx1cmFsaXplKCdidW5kbGUnLCBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zLmxlbmd0aCwgZmFsc2UpICtcclxuICAgICAgICBgIGluIGl0LiBNYWtlIHN1cmUgeW91ciBhcmNoaXZlIGNvbnRhaW5zIGF0IGxlYXN0IG9uZSBwYWNrYWdlIGhhdmluZyBgICtcclxuICAgICAgICBgJyR7c3VwcG9ydGVkQXBwRXh0ZW5zaW9uc30nICR7dXRpbC5wbHVyYWxpemUoJ2V4dGVuc2lvbicsIHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMubGVuZ3RoLCBmYWxzZSl9YCk7XHJcbiAgICB9XHJcbiAgICBsb2dnZXIuZGVidWcoYEV4dHJhY3RlZCAke3V0aWwucGx1cmFsaXplKCdidW5kbGUgaXRlbScsIHNvcnRlZEJ1bmRsZUl0ZW1zLmxlbmd0aCwgdHJ1ZSl9IGAgK1xyXG4gICAgICBgZnJvbSAnJHt6aXBQYXRofScgaW4gJHtNYXRoLnJvdW5kKHRpbWVyLmdldER1cmF0aW9uKCkuYXNNaWxsaVNlY29uZHMpfW1zOiAke3NvcnRlZEJ1bmRsZUl0ZW1zfWApO1xyXG4gICAgY29uc3QgbWF0Y2hlZEJ1bmRsZSA9IF8uZmlyc3Qoc29ydGVkQnVuZGxlSXRlbXMpO1xyXG4gICAgbG9nZ2VyLmluZm8oYEFzc3VtaW5nICcke21hdGNoZWRCdW5kbGV9JyBpcyB0aGUgY29ycmVjdCBidW5kbGVgKTtcclxuICAgIGNvbnN0IGRzdFBhdGggPSBwYXRoLnJlc29sdmUoZHN0Um9vdCwgcGF0aC5iYXNlbmFtZShtYXRjaGVkQnVuZGxlKSk7XHJcbiAgICBhd2FpdCBmcy5tdihwYXRoLnJlc29sdmUodG1wUm9vdCwgbWF0Y2hlZEJ1bmRsZSksIGRzdFBhdGgsIHtta2RpcnA6IHRydWV9KTtcclxuICAgIHJldHVybiBkc3RQYXRoO1xyXG4gIH0gZmluYWxseSB7XHJcbiAgICBhd2FpdCBmcy5yaW1yYWYodG1wUm9vdCk7XHJcbiAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiBpc1BhY2thZ2VPckJ1bmRsZSAoYXBwKSB7XHJcbiAgcmV0dXJuICgvXihbYS16QS1aMC05XFwtX10rXFwuW2EtekEtWjAtOVxcLV9dKykrJC8pLnRlc3QoYXBwKTtcclxufVxyXG5cclxuLyoqXHJcbiAqIEZpbmRzIGFsbCBpbnN0YW5jZXMgJ2ZpcnN0S2V5JyBhbmQgY3JlYXRlIGEgZHVwbGljYXRlIHdpdGggdGhlIGtleSAnc2Vjb25kS2V5JyxcclxuICogRG8gdGhlIHNhbWUgdGhpbmcgaW4gcmV2ZXJzZS4gSWYgd2UgZmluZCAnc2Vjb25kS2V5JywgY3JlYXRlIGEgZHVwbGljYXRlIHdpdGggdGhlIGtleSAnZmlyc3RLZXknLlxyXG4gKlxyXG4gKiBUaGlzIHdpbGwgY2F1c2Uga2V5cyB0byBiZSBvdmVyd3JpdHRlbiBpZiB0aGUgb2JqZWN0IGNvbnRhaW5zICdmaXJzdEtleScgYW5kICdzZWNvbmRLZXknLlxyXG5cclxuICogQHBhcmFtIHsqfSBpbnB1dCBBbnkgdHlwZSBvZiBpbnB1dFxyXG4gKiBAcGFyYW0ge1N0cmluZ30gZmlyc3RLZXkgVGhlIGZpcnN0IGtleSB0byBkdXBsaWNhdGVcclxuICogQHBhcmFtIHtTdHJpbmd9IHNlY29uZEtleSBUaGUgc2Vjb25kIGtleSB0byBkdXBsaWNhdGVcclxuICovXHJcbmZ1bmN0aW9uIGR1cGxpY2F0ZUtleXMgKGlucHV0LCBmaXJzdEtleSwgc2Vjb25kS2V5KSB7XHJcbiAgLy8gSWYgYXJyYXkgcHJvdmlkZWQsIHJlY3Vyc2l2ZWx5IGNhbGwgb24gYWxsIGVsZW1lbnRzXHJcbiAgaWYgKF8uaXNBcnJheShpbnB1dCkpIHtcclxuICAgIHJldHVybiBpbnB1dC5tYXAoKGl0ZW0pID0+IGR1cGxpY2F0ZUtleXMoaXRlbSwgZmlyc3RLZXksIHNlY29uZEtleSkpO1xyXG4gIH1cclxuXHJcbiAgLy8gSWYgb2JqZWN0LCBjcmVhdGUgZHVwbGljYXRlcyBmb3Iga2V5cyBhbmQgdGhlbiByZWN1cnNpdmVseSBjYWxsIG9uIHZhbHVlc1xyXG4gIGlmIChfLmlzUGxhaW5PYmplY3QoaW5wdXQpKSB7XHJcbiAgICBjb25zdCByZXN1bHRPYmogPSB7fTtcclxuICAgIGZvciAobGV0IFtrZXksIHZhbHVlXSBvZiBfLnRvUGFpcnMoaW5wdXQpKSB7XHJcbiAgICAgIGNvbnN0IHJlY3Vyc2l2ZWx5Q2FsbGVkVmFsdWUgPSBkdXBsaWNhdGVLZXlzKHZhbHVlLCBmaXJzdEtleSwgc2Vjb25kS2V5KTtcclxuICAgICAgaWYgKGtleSA9PT0gZmlyc3RLZXkpIHtcclxuICAgICAgICByZXN1bHRPYmpbc2Vjb25kS2V5XSA9IHJlY3Vyc2l2ZWx5Q2FsbGVkVmFsdWU7XHJcbiAgICAgIH0gZWxzZSBpZiAoa2V5ID09PSBzZWNvbmRLZXkpIHtcclxuICAgICAgICByZXN1bHRPYmpbZmlyc3RLZXldID0gcmVjdXJzaXZlbHlDYWxsZWRWYWx1ZTtcclxuICAgICAgfVxyXG4gICAgICByZXN1bHRPYmpba2V5XSA9IHJlY3Vyc2l2ZWx5Q2FsbGVkVmFsdWU7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gcmVzdWx0T2JqO1xyXG4gIH1cclxuXHJcbiAgLy8gQmFzZSBjYXNlLiBSZXR1cm4gcHJpbWl0aXZlcyB3aXRob3V0IGRvaW5nIGFueXRoaW5nLlxyXG4gIHJldHVybiBpbnB1dDtcclxufVxyXG5cclxuLyoqXHJcbiAqIFRha2VzIGEgZGVzaXJlZCBjYXBhYmlsaXR5IGFuZCB0cmllcyB0byBKU09OLnBhcnNlIGl0IGFzIGFuIGFycmF5LFxyXG4gKiBhbmQgZWl0aGVyIHJldHVybnMgdGhlIHBhcnNlZCBhcnJheSBvciBhIHNpbmdsZXRvbiBhcnJheS5cclxuICpcclxuICogQHBhcmFtIHtzdHJpbmd8QXJyYXk8U3RyaW5nPn0gY2FwIEEgZGVzaXJlZCBjYXBhYmlsaXR5XHJcbiAqL1xyXG5mdW5jdGlvbiBwYXJzZUNhcHNBcnJheSAoY2FwKSB7XHJcbiAgaWYgKF8uaXNBcnJheShjYXApKSB7XHJcbiAgICByZXR1cm4gY2FwO1xyXG4gIH1cclxuXHJcbiAgbGV0IHBhcnNlZENhcHM7XHJcbiAgdHJ5IHtcclxuICAgIHBhcnNlZENhcHMgPSBKU09OLnBhcnNlKGNhcCk7XHJcbiAgICBpZiAoXy5pc0FycmF5KHBhcnNlZENhcHMpKSB7XHJcbiAgICAgIHJldHVybiBwYXJzZWRDYXBzO1xyXG4gICAgfVxyXG4gIH0gY2F0Y2ggKGlnbikge1xyXG4gICAgbG9nZ2VyLndhcm4oYEZhaWxlZCB0byBwYXJzZSBjYXBhYmlsaXR5IGFzIEpTT04gYXJyYXlgKTtcclxuICB9XHJcbiAgaWYgKF8uaXNTdHJpbmcoY2FwKSkge1xyXG4gICAgcmV0dXJuIFtjYXBdO1xyXG4gIH1cclxuICB0aHJvdyBuZXcgRXJyb3IoYG11c3QgcHJvdmlkZSBhIHN0cmluZyBvciBKU09OIEFycmF5OyByZWNlaXZlZCAke2NhcH1gKTtcclxufVxyXG5cclxuZXhwb3J0IHtcclxuICBjb25maWd1cmVBcHAsIGlzUGFja2FnZU9yQnVuZGxlLCBkdXBsaWNhdGVLZXlzLCBwYXJzZUNhcHNBcnJheVxyXG59O1xyXG4iXSwiZmlsZSI6ImxpYi9iYXNlZHJpdmVyL2hlbHBlcnMuanMiLCJzb3VyY2VSb290IjoiLi5cXC4uXFwuLiJ9
