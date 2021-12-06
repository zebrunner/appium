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
        var maxAttemptsCount = 12;
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
      }

      if (downloadIsNeaded) {
        _logger.default.info(`Local version of app was not found. Hence using default Appium logic for downloading`);

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
          const sharedFolderPath = await (0, _mcloudUtils.getSharedFolderForAppUrl)(app);

          _logger.default.info(`Folder for local shared apps: ${sharedFolderPath}`);

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


//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImxpYi9iYXNlZHJpdmVyL2hlbHBlcnMuanMiXSwibmFtZXMiOlsiSVBBX0VYVCIsIlpJUF9FWFRTIiwiWklQX01JTUVfVFlQRVMiLCJDQUNIRURfQVBQU19NQVhfQUdFIiwiQVBQTElDQVRJT05TX0NBQ0hFIiwiTFJVIiwibWF4QWdlIiwidXBkYXRlQWdlT25HZXQiLCJkaXNwb3NlIiwiYXBwIiwiZnVsbFBhdGgiLCJmcyIsImV4aXN0cyIsImxvZ2dlciIsImluZm8iLCJyaW1yYWYiLCJub0Rpc3Bvc2VPblNldCIsIkFQUExJQ0FUSU9OU19DQUNIRV9HVUFSRCIsIkFzeW5jTG9jayIsIlNBTklUSVpFX1JFUExBQ0VNRU5UIiwiREVGQVVMVF9CQVNFTkFNRSIsIkFQUF9ET1dOTE9BRF9USU1FT1VUX01TIiwicHJvY2VzcyIsIm9uIiwiaXRlbUNvdW50IiwiYXBwUGF0aHMiLCJ2YWx1ZXMiLCJtYXAiLCJkZWJ1ZyIsImxlbmd0aCIsInV0aWwiLCJwbHVyYWxpemUiLCJhcHBQYXRoIiwicmltcmFmU3luYyIsImUiLCJ3YXJuIiwibWVzc2FnZSIsInJldHJpZXZlSGVhZGVycyIsImxpbmsiLCJ1cmwiLCJtZXRob2QiLCJ0aW1lb3V0IiwiaGVhZGVycyIsImdldENhY2hlZEFwcGxpY2F0aW9uUGF0aCIsImN1cnJlbnRBcHBQcm9wcyIsInJlZnJlc2giLCJoYXMiLCJsYXN0TW9kaWZpZWQiLCJjdXJyZW50TW9kaWZpZWQiLCJpbW11dGFibGUiLCJjdXJyZW50SW1tdXRhYmxlIiwiY3VycmVudE1heEFnZSIsInRpbWVzdGFtcCIsImdldCIsImdldFRpbWUiLCJtc0xlZnQiLCJEYXRlIiwibm93IiwicGF0aCIsImJhc2VuYW1lIiwidmVyaWZ5QXBwRXh0ZW5zaW9uIiwic3VwcG9ydGVkQXBwRXh0ZW5zaW9ucyIsImluY2x1ZGVzIiwiZXh0bmFtZSIsIkVycm9yIiwiY29uZmlndXJlQXBwIiwiXyIsImlzU3RyaW5nIiwiaXNBcnJheSIsIm5ld0FwcCIsInNob3VsZFVuemlwQXBwIiwiYXJjaGl2ZUhhc2giLCJyZW1vdGVBcHBQcm9wcyIsInByb3RvY29sIiwicGF0aG5hbWUiLCJwYXJzZSIsImlzVXJsIiwiYWNxdWlyZSIsImlzRW1wdHkiLCJ0ZXN0IiwibWF4QWdlTWF0Y2giLCJleGVjIiwicGFyc2VJbnQiLCJsb2NhbEZpbGUiLCJsb2NrRmlsZSIsImRvd25sb2FkSXNOZWFkZWQiLCJyZW1vdGVGaWxlTGVuZ3RoIiwic3RhdHMiLCJzdGF0IiwibG9jYWxGaWxlTGVuZ3RoIiwic2l6ZSIsInVubGluayIsIndhaXRpbmdUaW1lIiwibWF4QXR0ZW1wdHNDb3VudCIsImF0dGVtcHRzQ291bnQiLCJQcm9taXNlIiwicmVzb2x2ZSIsInNldFRpbWVvdXQiLCJjbG9zZSIsIm9wZW4iLCJjYWNoZWRQYXRoIiwiZGVsIiwiZmlsZU5hbWUiLCJzYW5pdGl6ZU5hbWUiLCJkZWNvZGVVUklDb21wb25lbnQiLCJyZXBsYWNlbWVudCIsImN0Iiwic29tZSIsIm1pbWVUeXBlIiwiUmVnRXhwIiwiZXNjYXBlUmVnRXhwIiwibWF0Y2giLCJyZXN1bHRpbmdOYW1lIiwic3Vic3RyaW5nIiwicmVzdWx0aW5nRXh0IiwiZmlyc3QiLCJ0YXJnZXRQYXRoIiwidGVtcERpciIsInByZWZpeCIsInN1ZmZpeCIsImRvd25sb2FkQXBwIiwic2hhcmVkRm9sZGVyUGF0aCIsImNvcHlGaWxlIiwiZXJyb3JNZXNzYWdlIiwiYXJjaGl2ZVBhdGgiLCJoYXNoIiwidG1wUm9vdCIsIm9wZW5EaXIiLCJ1bnppcEFwcCIsImlzQWJzb2x1dGUiLCJjd2QiLCJCb29sZWFuIiwic2V0IiwiaHJlZiIsIm5ldCIsImRvd25sb2FkRmlsZSIsImVyciIsInppcFBhdGgiLCJkc3RSb290IiwiemlwIiwiYXNzZXJ0VmFsaWRaaXAiLCJ0aW1lciIsInRpbWluZyIsIlRpbWVyIiwic3RhcnQiLCJleHRyYWN0aW9uT3B0cyIsInVzZVN5c3RlbVVuemlwIiwiZmlsZU5hbWVzRW5jb2RpbmciLCJleHRyYWN0QWxsVG8iLCJnbG9iUGF0dGVybiIsImV4dCIsInJlcGxhY2UiLCJqb2luIiwic29ydGVkQnVuZGxlSXRlbXMiLCJnbG9iIiwic3RyaWN0Iiwic29ydCIsImEiLCJiIiwic3BsaXQiLCJzZXAiLCJlcnJvckFuZFRocm93IiwiTWF0aCIsInJvdW5kIiwiZ2V0RHVyYXRpb24iLCJhc01pbGxpU2Vjb25kcyIsIm1hdGNoZWRCdW5kbGUiLCJkc3RQYXRoIiwibXYiLCJta2RpcnAiLCJpc1BhY2thZ2VPckJ1bmRsZSIsImR1cGxpY2F0ZUtleXMiLCJpbnB1dCIsImZpcnN0S2V5Iiwic2Vjb25kS2V5IiwiaXRlbSIsImlzUGxhaW5PYmplY3QiLCJyZXN1bHRPYmoiLCJrZXkiLCJ2YWx1ZSIsInRvUGFpcnMiLCJyZWN1cnNpdmVseUNhbGxlZFZhbHVlIiwicGFyc2VDYXBzQXJyYXkiLCJjYXAiLCJwYXJzZWRDYXBzIiwiSlNPTiIsImlnbiJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7QUFBQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFFQSxNQUFNQSxPQUFPLEdBQUcsTUFBaEI7QUFDQSxNQUFNQyxRQUFRLEdBQUcsQ0FBQyxNQUFELEVBQVNELE9BQVQsQ0FBakI7QUFDQSxNQUFNRSxjQUFjLEdBQUcsQ0FDckIsaUJBRHFCLEVBRXJCLDhCQUZxQixFQUdyQixpQkFIcUIsQ0FBdkI7QUFLQSxNQUFNQyxtQkFBbUIsR0FBRyxPQUFPLEVBQVAsR0FBWSxFQUFaLEdBQWlCLEVBQTdDO0FBQ0EsTUFBTUMsa0JBQWtCLEdBQUcsSUFBSUMsaUJBQUosQ0FBUTtBQUNqQ0MsRUFBQUEsTUFBTSxFQUFFSCxtQkFEeUI7QUFFakNJLEVBQUFBLGNBQWMsRUFBRSxJQUZpQjtBQUdqQ0MsRUFBQUEsT0FBTyxFQUFFLE9BQU9DLEdBQVAsRUFBWTtBQUFDQyxJQUFBQTtBQUFELEdBQVosS0FBMkI7QUFDbEMsUUFBSSxFQUFDLE1BQU1DLGtCQUFHQyxNQUFILENBQVVGLFFBQVYsQ0FBUCxDQUFKLEVB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QUtKLFNBQVosRUFBdUI7QUFDNUJHLFFBQUFBLFNBQVMsQ0FBQ0osUUFBRCxDQUFULEdBQXNCUSxzQkFBdEI7QUFDRDs7QUFDREosTUFBQUEsU0FBUyxDQUFDQyxHQUFELENBQVQsR0FBaUJHLHNCQUFqQjtBQUNEOztBQUNELFdBQU9KLFNBQVA7QUFDRDs7QUFHRCxTQUFPTCxLQUFQO0FBQ0Q7O0FBUUQsU0FBU1UsY0FBVCxDQUF5QkMsR0FBekIsRUFBOEI7QUFDNUIsTUFBSXJILGdCQUFFRSxPQUFGLENBQVVtSCxHQUFWLENBQUosRUFBb0I7QUFDbEIsV0FBT0EsR0FBUDtBQUNEOztBQUVELE1BQUlDLFVBQUo7O0FBQ0EsTUFBSTtBQUNGQSxJQUFBQSxVQUFVLEdBQUdDLElBQUksQ0FBQzlHLEtBQUwsQ0FBVzRHLEdBQVgsQ0FBYjs7QUFDQSxRQUFJckgsZ0JBQUVFLE9BQUYsQ0FBVW9ILFVBQVYsQ0FBSixFQUEyQjtBQUN6QixhQUFPQSxVQUFQO0FBQ0Q7QUFDRixHQUxELENBS0UsT0FBT0UsR0FBUCxFQUFZO0FBQ1o3SyxvQkFBT3NCLElBQVAsQ0FBYSwwQ0FBYjtBQUNEOztBQUNELE1BQUkrQixnQkFBRUMsUUFBRixDQUFXb0gsR0FBWCxDQUFKLEVBQXFCO0FBQ25CLFdBQU8sQ0FBQ0EsR0FBRCxDQUFQO0FBQ0Q7O0FBQ0QsUUFBTSxJQUFJdkgsS0FBSixDQUFXLGlEQUFnRHVILEdBQUksRUFBL0QsQ0FBTjtBQUNEIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IF8gZnJvbSAnbG9kYXNoJztcclxuaW1wb3J0IHBhdGggZnJvbSAncGF0aCc7XHJcbmltcG9ydCB1cmwgZnJvbSAndXJsJztcclxuaW1wb3J0IGxvZ2dlciBmcm9tICcuL2xvZ2dlcic7XHJcbmltcG9ydCB7IHRlbXBEaXIsIGZzLCB1dGlsLCB6aXAsIG5ldCwgdGltaW5nIH0gZnJvbSAnYXBwaXVtLXN1cHBvcnQnO1xyXG5pbXBvcnQgTFJVIGZyb20gJ2xydS1jYWNoZSc7XHJcbmltcG9ydCBBc3luY0xvY2sgZnJvbSAnYXN5bmMtbG9jayc7XHJcbmltcG9ydCBheGlvcyBmcm9tICdheGlvcyc7XHJcbmltcG9ydCB7IGdldFNoYXJlZEZvbGRlckZvckFwcFVybCwgZ2V0TG9jYWxGaWxlRm9yQXBwVXJsLCBnZXRGaWxlQ29udGVudExlbmd0aCB9IGZyb20gJy4vbWNsb3VkLXV0aWxzJztcclxuXHJcbmNvbnN0IElQQV9FWFQgPSAnLmlwYSc7XHJcbmNvbnN0IFpJUF9FWFRTID0gWycuemlwJywgSVBBX0VYVF07XHJcbmNvbnN0IFpJUF9NSU1FX1RZUEVTID0gW1xyXG4gICdhcHBsaWNhdGlvbi96aXAnLFxyXG4gICdhcHBsaWNhdGlvbi94LXppcC1jb21wcmVzc2VkJyxcclxuICAnbXVsdGlwYXJ0L3gtemlwJyxcclxuXTtcclxuY29uc3QgQ0FDSEVEX0FQUFNfTUFYX0FHRSA9IDEwMDAgKiA2MCAqIDYwICogMjQ7IC8vIG1zXHJcbmNvbnN0IEFQUExJQ0FUSU9OU19DQUNIRSA9IG5ldyBMUlUoe1xyXG4gIG1heEFnZTogQ0FDSEVEX0FQUFNfTUFYX0FHRSwgLy8gZXhwaXJlIGFmdGVyIDI0IGhvdXJzXHJcbiAgdXBkYXRlQWdlT25HZXQ6IHRydWUsXHJcbiAgZGlzcG9zZTogYXN5bmMgKGFwcCwge2Z1bGxQYXRofSkgPT4ge1xyXG4gICAgaWYgKCFhd2FpdCBmcy5leGlzdHMoZnVsbFBhdGgpKSB7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICBsb2dnZXIuaW5mbyhgVGhlIGFwcGxpY2F0aW9uICcke2FwcH0nIGNhY2hlZCBhdCAnJHtmdWxsUGF0aH0nIGhhcyBleHBpcmVkYCk7XHJcbiAgICBhd2FpdCBmcy5yaW1yYWYoZnVsbFBhdGgpO1xyXG4gIH0sXHJcbiAgbm9EaXNwb3NlT25TZXQ6IHRydWUsXHJcbn0pO1xyXG5jb25zdCBBUFBMSUNBVElPTlNfQ0FDSEVfR1VBUkQgPSBuZXcgQXN5bmNMb2NrKCk7XHJcbmNvbnN0IFNBTklUSVpFX1JFUExBQ0VNRU5UID0gJy0nO1xyXG5jb25zdCBERUZBVUxUX0JBU0VOQU1FID0gJ2FwcGl1bS1hcHAnO1xyXG5jb25zdCBBUFBfRE9XTkxPQURfVElNRU9VVF9NUyA9IDEyMCAqIDEwMDA7XHJcblxyXG5wcm9jZXNzLm9uKCdleGl0JywgKCkgPT4ge1xyXG4gIGlmIChBUFBMSUNBVElPTlNfQ0FDSEUuaXRlbUNvdW50ID09PSAwKSB7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG5cclxuICBjb25zdCBhcHBQYXRocyA9IEFQUExJQ0FUSU9OU19DQUNIRS52YWx1ZXMoKVxyXG4gICAgLm1hcCgoe2Z1bGxQYXRofSkgPT4gZnVsbFBhdGgpO1xyXG4gIGxvZ2dlci5kZWJ1ZyhgUGVyZm9ybWluZyBjbGVhbnVwIG9mICR7YXBwUGF0aHMubGVuZ3RofSBjYWNoZWQgYCArXHJcbiAgICB1dGlsLnBsdXJhbGl6ZSgnYXBwbGljYXRpb24nLCBhcHBQYXRocy5sZW5ndGgpKTtcclxuICBmb3IgKGNvbnN0IGFwcFBhdGggb2YgYXBwUGF0aHMpIHtcclxuICAgIHRyeSB7XHJcbiAgICAgIC8vIEFzeW5jaHJvbm91cyBjYWxscyBhcmUgbm90IHN1cHBvcnRlZCBpbiBvbkV4aXQgaGFuZGxlclxyXG4gICAgICBmcy5yaW1yYWZTeW5jKGFwcFBhdGgpO1xyXG4gICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICBsb2dnZXIud2FybihlLm1lc3NhZ2UpO1xyXG4gICAgfVxyXG4gIH1cclxufSk7XHJcblxyXG5cclxuYXN5bmMgZnVuY3Rpb24gcmV0cmlldmVIZWFkZXJzIChsaW5rKSB7XHJcbiAgdHJ5IHtcclxuICAgIHJldHVybiAoYXdhaXQgYXhpb3Moe1xyXG4gICAgICB1cmw6IGxpbmssXHJcbiAgICAgIG1ldGhvZDogJ0hFQUQnLFxyXG4gICAgICB0aW1lb3V0OiA1MDAwLFxyXG4gICAgfSkpLmhlYWRlcnM7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgbG9nZ2VyLmluZm8oYENhbm5vdCBzZW5kIEhFQUQgcmVxdWVzdCB0byAnJHtsaW5rfScuIE9yaWdpbmFsIGVycm9yOiAke2UubWVzc2FnZX1gKTtcclxuICB9XHJcbiAgcmV0dXJuIHt9O1xyXG59XHJcblxyXG5mdW5jdGlvbiBnZXRDYWNoZWRBcHBsaWNhdGlvblBhdGggKGxpbmssIGN1cnJlbnRBcHBQcm9wcyA9IHt9KSB7XHJcbiAgY29uc3QgcmVmcmVzaCA9ICgpID0+IHtcclxuICAgIGxvZ2dlci5pbmZvKGBDVVNUT00gSEVMUEVSIWApO1xyXG4gICAgbG9nZ2VyLmRlYnVnKGBBIGZyZXNoIGNvcHkgb2YgdGhlIGFwcGxpY2F0aW9uIGlzIGdvaW5nIHRvIGJlIGRvd25sb2FkZWQgZnJvbSAke2xpbmt9YCk7XHJcbiAgICByZXR1cm4gbnVsbDtcclxuICB9O1xyXG5cclxuICBpZiAoQVBQTElDQVRJT05TX0NBQ0hFLmhhcyhsaW5rKSkge1xyXG4gICAgY29uc3Qge1xyXG4gICAgICBsYXN0TW9kaWZpZWQ6IGN1cnJlbnRNb2RpZmllZCxcclxuICAgICAgaW1tdXRhYmxlOiBjdXJyZW50SW1tdXRhYmxlLFxyXG4gICAgICAvLyBtYXhBZ2UgaXMgaW4gc2Vjb25kc1xyXG4gICAgICBtYXhBZ2U6IGN1cnJlbnRNYXhBZ2UsXHJcbiAgICB9ID0gY3VycmVudEFwcFByb3BzO1xyXG4gICAgY29uc3Qge1xyXG4gICAgICAvLyBEYXRlIGluc3RhbmNlXHJcbiAgICAgIGxhc3RNb2RpZmllZCxcclxuICAgICAgLy8gYm9vbGVhblxyXG4gICAgICBpbW11dGFibGUsXHJcbiAgICAgIC8vIFVuaXggdGltZSBpbiBtaWxsaXNlY29uZHNcclxuICAgICAgdGltZXN0YW1wLFxyXG4gICAgICBmdWxsUGF0aCxcclxuICAgIH0gPSBBUFBMSUNBVElPTlNfQ0FDSEUuZ2V0KGxpbmspO1xyXG4gICAgaWYgKGxhc3RNb2RpZmllZCAmJiBjdXJyZW50TW9kaWZpZWQpIHtcclxuICAgICAgaWYgKGN1cnJlbnRNb2RpZmllZC5nZXRUaW1lKCkgPD0gbGFzdE1vZGlmaWVkLmdldFRpbWUoKSkge1xyXG4gICAgICAgIGxvZ2dlci5kZWJ1ZyhgVGhlIGFwcGxpY2F0aW9uIGF0ICR7bGlua30gaGFzIG5vdCBiZWVuIG1vZGlmaWVkIHNpbmNlICR7bGFzdE1vZGlmaWVkfWApO1xyXG4gICAgICAgIHJldHVybiBmdWxsUGF0aDtcclxuICAgICAgfVxyXG4gICAgICBsb2dnZXIuZGVidWcoYFRoZSBhcHBsaWNhdGlvbiBhdCAke2xpbmt9IGhhcyBiZWVuIG1vZGlmaWVkIHNpbmNlICR7bGFzdE1vZGlmaWVkfWApO1xyXG4gICAgICByZXR1cm4gcmVmcmVzaCgpO1xyXG4gICAgfVxyXG4gICAgaWYgKGltbXV0YWJsZSAmJiBjdXJyZW50SW1tdXRhYmxlKSB7XHJcbiAgICAgIGxvZ2dlci5kZWJ1ZyhgVGhlIGFwcGxpY2F0aW9uIGF0ICR7bGlua30gaXMgaW1tdXRhYmxlYCk7XHJcbiAgICAgIHJldHVybiBmdWxsUGF0aDtcclxuICAgIH1cclxuICAgIGlmIChjdXJyZW50TWF4QWdlICYmIHRpbWVzdGFtcCkge1xyXG4gICAgICBjb25zdCBtc0xlZnQgPSB0aW1lc3RhbXAgKyBjdXJyZW50TWF4QWdlICogMTAwMCAtIERhdGUubm93KCk7XHJcbiAgICAgIGlmIChtc0xlZnQgPiAwKSB7XHJcbiAgICAgICAgbG9nZ2VyLmRlYnVnKGBUaGUgY2FjaGVkIGFwcGxpY2F0aW9uICcke3BhdGguYmFzZW5hbWUoZnVsbFBhdGgpfScgd2lsbCBleHBpcmUgaW4gJHttc0xlZnQgLyAxMDAwfXNgKTtcclxuICAgICAgICByZXR1cm4gZnVsbFBhdGg7XHJcbiAgICAgIH1cclxuICAgICAgbG9nZ2VyLmRlYnVnKGBUaGUgY2FjaGVkIGFwcGxpY2F0aW9uICcke3BhdGguYmFzZW5hbWUoZnVsbFBhdGgpfScgaGFzIGV4cGlyZWRgKTtcclxuICAgIH1cclxuICB9XHJcbiAgcmV0dXJuIHJlZnJlc2goKTtcclxufVxyXG5cclxuZnVuY3Rpb24gdmVyaWZ5QXBwRXh0ZW5zaW9uIChhcHAsIHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMpIHtcclxuICBpZiAoc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucy5pbmNsdWRlcyhwYXRoLmV4dG5hbWUoYXBwKSkpIHtcclxuICAgIHJldHVybiBhcHA7XHJcbiAgfVxyXG4gIHRocm93IG5ldyBFcnJvcihgTmV3IGFwcCBwYXRoICcke2FwcH0nIGRpZCBub3QgaGF2ZSBgICtcclxuICAgIGAke3V0aWwucGx1cmFsaXplKCdleHRlbnNpb24nLCBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zLmxlbmd0aCwgZmFsc2UpfTogYCArXHJcbiAgICBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zKTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gY29uZmlndXJlQXBwIChhcHAsIHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMpIHtcclxuICBpZiAoIV8uaXNTdHJpbmcoYXBwKSkge1xyXG4gICAgLy8gaW1tZWRpYXRlbHkgc2hvcnRjaXJjdWl0IGlmIG5vdCBnaXZlbiBhbiBhcHBcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgaWYgKCFfLmlzQXJyYXkoc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucykpIHtcclxuICAgIHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMgPSBbc3VwcG9ydGVkQXBwRXh0ZW5zaW9uc107XHJcbiAgfVxyXG5cclxuICBsZXQgbmV3QXBwID0gYXBwO1xyXG4gIGxldCBzaG91bGRVbnppcEFwcCA9IGZhbHNlO1xyXG4gIGxldCBhcmNoaXZlSGFzaCA9IG51bGw7XHJcbiAgY29uc3QgcmVtb3RlQXBwUHJvcHMgPSB7XHJcbiAgICBsYXN0TW9kaWZpZWQ6IG51bGwsXHJcbiAgICBpbW11dGFibGU6IGZhbHNlLFxyXG4gICAgbWF4QWdlOiBudWxsLFxyXG4gIH07XHJcbiAgY29uc3Qge3Byb3RvY29sLCBwYXRobmFtZX0gPSB1cmwucGFyc2UobmV3QXBwKTtcclxuICBjb25zdCBpc1VybCA9IFsnaHR0cDonLCAnaHR0cHM6J10uaW5jbHVkZXMocHJvdG9jb2wpO1xyXG5cclxuICByZXR1cm4gYXdhaXQgQVBQTElDQVRJT05TX0NBQ0hFX0dVQVJELmFjcXVpcmUoYXBwLCBhc3luYyAoKSA9PiB7XHJcbiAgICBpZiAoaXNVcmwpIHtcclxuICAgICAgLy8gVXNlIHRoZSBhcHAgZnJvbSByZW1vdGUgVVJMXHJcbiAgICAgIGxvZ2dlci5pbmZvKGBVc2luZyBkb3dubG9hZGFibGUgYXBwICcke25ld0FwcH0nYCk7XHJcbiAgICAgIGNvbnN0IGhlYWRlcnMgPSBhd2FpdCByZXRyaWV2ZUhlYWRlcnMobmV3QXBwKTtcclxuICAgICAgaWYgKCFfLmlzRW1wdHkoaGVhZGVycykpIHtcclxuICAgICAgICBpZiAoaGVhZGVyc1snbGFzdC1tb2RpZmllZCddKSB7XHJcbiAgICAgICAgICByZW1vdGVBcHBQcm9wcy5sYXN0TW9kaWZpZWQgPSBuZXcgRGF0ZShoZWFkZXJzWydsYXN0LW1vZGlmaWVkJ10pO1xyXG4gICAgICAgIH1cclxuICAgICAgICBsb2dnZXIuZGVidWcoYExhc3QtTW9kaWZpZWQ6ICR7aGVhZGVyc1snbGFzdC1tb2RpZmllZCddfWApO1xyXG4gICAgICAgIGlmIChoZWFkZXJzWydjYWNoZS1jb250cm9sJ10pIHtcclxuICAgICAgICAgIHJlbW90ZUFwcFByb3BzLmltbXV0YWJsZSA9IC9cXGJpbW11dGFibGVcXGIvaS50ZXN0KGhlYWRlcnNbJ2NhY2hlLWNvbnRyb2wnXSk7XHJcbiAgICAgICAgICBjb25zdCBtYXhBZ2VNYXRjaCA9IC9cXGJtYXgtYWdlPShcXGQrKVxcYi9pLmV4ZWMoaGVhZGVyc1snY2FjaGUtY29udHJvbCddKTtcclxuICAgICAgICAgIGlmIChtYXhBZ2VNYXRjaCkge1xyXG4gICAgICAgICAgICByZW1vdGVBcHBQcm9wcy5tYXhBZ2UgPSBwYXJzZUludChtYXhBZ2VNYXRjaFsxXSwgMTApO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICBsb2dnZXIuZGVidWcoYENhY2hlLUNvbnRyb2w6ICR7aGVhZGVyc1snY2FjaGUtY29udHJvbCddfWApO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyAqKioqKiBDdXN0b20gbG9naWMgZm9yIHZlcmlmaWNhdGlvbiBvZiBsb2NhbCBzdGF0aWMgcGF0aCBmb3IgQVBQcyAqKioqKlxyXG4gICAgICBjb25zdCBsb2NhbEZpbGUgPSBhd2FpdCBnZXRMb2NhbEZpbGVGb3JBcHBVcmwobmV3QXBwKTtcclxuICAgICAgY29uc3QgbG9ja0ZpbGUgPSBsb2NhbEZpbGUgKyAnLmxvY2snO1xyXG4gICAgICBsZXQgZG93bmxvYWRJc05lYWRlZDtcclxuICAgICAgaWYoYXdhaXQgZnMuZXhpc3RzKGxvY2FsRmlsZSkpIHtcclxuICAgICAgICBsb2dnZXIuaW5mbyhgTG9jYWwgdmVyc2lvbiBvZiBhcHAgd2FzIGZvdW5kLiBXaWxsIGNoZWNrIGFjdHVhbGl0eSBvZiB0aGUgZmlsZWApO1xyXG4gICAgICAgIC8vIENoZWNraW5nIG9mIGxvY2FsIGFwcGxpY2F0aW9uIGFjdHVhbGl0eVxyXG4gICAgICAgIGNvbnN0IHJlbW90ZUZpbGVMZW5ndGggPSBhd2FpdCBnZXRGaWxlQ29udGVudExlbmd0aChhcHApO1xyXG4gICAgICAgIGNvbnN0IHN0YXRzID0gYXdhaXQgZnMuc3RhdChsb2NhbEZpbGUpO1xyXG4gICAgICAgIGNvbnN0IGxvY2FsRmlsZUxlbmd0aCA9IHN0YXRzLnNpemU7XHJcbiAgICAgICAgbG9nZ2VyLmluZm8oYFJlbW90ZSBmaWxlIHNpemUgaXMgJHtyZW1vdGVGaWxlTGVuZ3RofSBhbmQgbG9jYWwgZmlsZSBzaXplIGlzICR7bG9jYWxGaWxlTGVuZ3RofWApO1xyXG4gICAgICAgIGlmKHJlbW90ZUZpbGVMZW5ndGggIT0gbG9jYWxGaWxlTGVuZ3RoKSB7XHJcbiAgICAgICAgICBsb2dnZXIuaW5mbyhgU2l6ZXMgZGlmZmVyLiBIZW5jZSB0aGF0J3MgbmVlZGVkIHRvIGRvd25sb2FkIGZyZXNoIHZlcnNpb24gb2YgdGhlIGFwcGApO1xyXG4gICAgICAgICAgYXdhaXQgZnMudW5saW5rKGxvY2FsRmlsZSk7XHJcbiAgICAgICAgICBkb3dubG9hZElzTmVhZGVkID0gdHJ1ZTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgbG9nZ2VyLmluZm8oYFNpemVzIGFyZSB0aGUgc2FtZS4gSGVuY2Ugd2lsbCB1c2UgYWxyZWFkeSBzdG9yZWQgYXBwbGljYXRpb24gZm9yIHRoZSBzZXNzaW9uYCk7XHJcbiAgICAgICAgICBuZXdBcHAgPSBsb2NhbEZpbGU7XHJcbiAgICAgICAgICBzaG91bGRVbnppcEFwcCA9IFpJUF9FWFRTLmluY2x1ZGVzKHBhdGguZXh0bmFtZShuZXdBcHApKTtcclxuICAgICAgICAgIGRvd25sb2FkSXNOZWFkZWQgPSBmYWxzZTtcclxuICAgICAgICB9XHJcbiAgICAgIH0gZWxzZSBpZiAoYXdhaXQgZnMuZXhpc3RzKGxvY2tGaWxlKSkge1xyXG4gICAgICAgIC8vIFdhaXQgZm9yIHNvbWUgdGltZSB0aWxsIEFwcCBpcyBkb3dubG9hZGVkIGJ5IHNvbWUgcGFyYWxsZWwgQXBwaXVtIGluc3RhbmNlXHJcbiAgICAgICAgY29uc3Qgd2FpdGluZ1RpbWUgPSA1MDAwO1xyXG4gICAgICAgIHZhciBtYXhBdHRlbXB0c0NvdW50ID0gMTI7XHJcbiAgICAgICAgLy8gY29uc3Qgd2FpdGluZ1RpbWUgPSAxMDAwO1xyXG4gICAgICAgIC8vIGNvbnN0IG1heEF0dGVtcHRzQ291bnQgPSA1O1xyXG4gICAgICAgIHZhciBhdHRlbXB0c0NvdW50ID0gMDtcclxuICAgICAgICB3aGlsZShhd2FpdCBmcy5leGlzdHMobG9ja0ZpbGUpICYmIChhdHRlbXB0c0NvdW50KysgPCBtYXhBdHRlbXB0c0NvdW50KSkge1xyXG4gICAgICAgICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcclxuICAgICAgICAgICAgbG9nZ2VyLmluZm8oYEF0dGVtcHQgIyR7YXR0ZW1wdHNDb3VudH0gZm9yIC5sb2NrIGZpbGUgY2hlY2tpbmdgKTtcclxuICAgICAgICAgICAgc2V0VGltZW91dChyZXNvbHZlLCB3YWl0aW5nVGltZSk7XHJcbiAgICAgICAgICB9KTtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYoYXdhaXQgZnMuZXhpc3RzKGxvY2tGaWxlKSkge1xyXG4gICAgICAgICAgdGhyb3cgRXJyb3IoYC5sb2NrIGZpbGUgZm9yIGRvd25sb2FkaW5nIGFwcGxpY2F0aW9uIGhhcyBub3QgZGlzYXBwZWFyZWQgYWZ0ZXIgJHt3YWl0aW5nVGltZSAqIG1heEF0dGVtcHRzQ291bnR9bXNgKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYoIWF3YWl0IGZzLmV4aXN0cyhsb2NhbEZpbGUpKSB7XHJcbiAgICAgICAgICB0aHJvdyBFcnJvcihgTG9jYWwgYXBwbGljYXRpb24gZmlsZSBoYXMgbm90IGFwcGVhcmVkIGFmdGVyIC5sb2NrIGZpbGUgcmVtb3ZhbGApO1xyXG4gICAgICAgIH1cclxuICAgICAgICBsb2dnZXIuaW5mbyhgTG9jYWwgdmVyc2lvbiBvZiBhcHAgd2FzIGZvdW5kIGFmdGVyIC5sb2NrIGZpbGUgcmVtb3ZhbC4gV2lsbCB1c2UgaXQgZm9yIG5ldyBzZXNzaW9uYCk7XHJcbiAgICAgICAgbmV3QXBwID0gbG9jYWxGaWxlO1xyXG4gICAgICAgIHNob3VsZFVuemlwQXBwID0gWklQX0VYVFMuaW5jbHVkZXMocGF0aC5leHRuYW1lKG5ld0FwcCkpO1xyXG4gICAgICAgIGRvd25sb2FkSXNOZWFkZWQgPSBmYWxzZTtcclxuICAgICAgfVxyXG4gICAgICBpZihkb3dubG9hZElzTmVhZGVkKSB7XHJcbiAgICAgIGxvZ2dlci5pbmZvKGBMb2NhbCB2ZXJzaW9uIG9mIGFwcCB3YXMgbm90IGZvdW5kLiBIZW5jZSB1c2luZyBkZWZhdWx0IEFwcGl1bSBsb2dpYyBmb3IgZG93bmxvYWRpbmdgKTtcclxuICAgICAgYXdhaXQgZnMuY2xvc2UoYXdhaXQgZnMub3Blbihsb2NrRmlsZSwgJ3cnKSk7XHJcbiAgICAgIHRyeSB7XHJcblxyXG4gICAgICBjb25zdCBjYWNoZWRQYXRoID0gZ2V0Q2FjaGVkQXBwbGljYXRpb25QYXRoKGFwcCwgcmVtb3RlQXBwUHJvcHMpO1xyXG4gICAgICBpZiAoY2FjaGVkUGF0aCkge1xyXG4gICAgICAgIGlmIChhd2FpdCBmcy5leGlzdHMoY2FjaGVkUGF0aCkpIHtcclxuICAgICAgICAgIGxvZ2dlci5pbmZvKGBSZXVzaW5nIHByZXZpb3VzbHkgZG93bmxvYWRlZCBhcHBsaWNhdGlvbiBhdCAnJHtjYWNoZWRQYXRofSdgKTtcclxuICAgICAgICAgIHJldHVybiB2ZXJpZnlBcHBFeHRlbnNpb24oY2FjaGVkUGF0aCwgc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGxvZ2dlci5pbmZvKGBUaGUgYXBwbGljYXRpb24gYXQgJyR7Y2FjaGVkUGF0aH0nIGRvZXMgbm90IGV4aXN0IGFueW1vcmUuIERlbGV0aW5nIGl0IGZyb20gdGhlIGNhY2hlYCk7XHJcbiAgICAgICAgQVBQTElDQVRJT05TX0NBQ0hFLmRlbChhcHApO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBsZXQgZmlsZU5hbWUgPSBudWxsO1xyXG4gICAgICBjb25zdCBiYXNlbmFtZSA9IGZzLnNhbml0aXplTmFtZShwYXRoLmJhc2VuYW1lKGRlY29kZVVSSUNvbXBvbmVudChwYXRobmFtZSkpLCB7XHJcbiAgICAgICAgcmVwbGFjZW1lbnQ6IFNBTklUSVpFX1JFUExBQ0VNRU5UXHJcbiAgICAgIH0pO1xyXG4gICAgICBjb25zdCBleHRuYW1lID0gcGF0aC5leHRuYW1lKGJhc2VuYW1lKTtcclxuICAgICAgLy8gdG8gZGV0ZXJtaW5lIGlmIHdlIG5lZWQgdG8gdW56aXAgdGhlIGFwcCwgd2UgaGF2ZSBhIG51bWJlciBvZiBwbGFjZXNcclxuICAgICAgLy8gdG8gbG9vazogY29udGVudCB0eXBlLCBjb250ZW50IGRpc3Bvc2l0aW9uLCBvciB0aGUgZmlsZSBleHRlbnNpb25cclxuICAgICAgaWYgKFpJUF9FWFRTLmluY2x1ZGVzKGV4dG5hbWUpKSB7XHJcbiAgICAgICAgZmlsZU5hbWUgPSBiYXNlbmFtZTtcclxuICAgICAgICBzaG91bGRVbnppcEFwcCA9IHRydWU7XHJcbiAgICAgIH1cclxuICAgICAgaWYgKGhlYWRlcnNbJ2NvbnRlbnQtdHlwZSddKSB7XHJcbiAgICAgICAgY29uc3QgY3QgPSBoZWFkZXJzWydjb250ZW50LXR5cGUnXTtcclxuICAgICAgICBsb2dnZXIuZGVidWcoYENvbnRlbnQtVHlwZTogJHtjdH1gKTtcclxuICAgICAgICAvLyB0aGUgZmlsZXR5cGUgbWF5IG5vdCBiZSBvYnZpb3VzIGZvciBjZXJ0YWluIHVybHMsIHNvIGNoZWNrIHRoZSBtaW1lIHR5cGUgdG9vXHJcbiAgICAgICAgaWYgKFpJUF9NSU1FX1RZUEVTLnNvbWUoKG1pbWVUeXBlKSA9PiBuZXcgUmVnRXhwKGBcXFxcYiR7Xy5lc2NhcGVSZWdFeHAobWltZVR5cGUpfVxcXFxiYCkudGVzdChjdCkpKSB7XHJcbiAgICAgICAgICBpZiAoIWZpbGVOYW1lKSB7XHJcbiAgICAgICAgICAgIGZpbGVOYW1lID0gYCR7REVGQVVMVF9CQVNFTkFNRX0uemlwYDtcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIHNob3VsZFVuemlwQXBwID0gdHJ1ZTtcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgICAgaWYgKGhlYWRlcnNbJ2NvbnRlbnQtZGlzcG9zaXRpb24nXSAmJiAvXmF0dGFjaG1lbnQvaS50ZXN0KGhlYWRlcnNbJ2NvbnRlbnQtZGlzcG9zaXRpb24nXSkpIHtcclxuICAgICAgICBsb2dnZXIuZGVidWcoYENvbnRlbnQtRGlzcG9zaXRpb246ICR7aGVhZGVyc1snY29udGVudC1kaXNwb3NpdGlvbiddfWApO1xyXG4gICAgICAgIGNvbnN0IG1hdGNoID0gL2ZpbGVuYW1lPVwiKFteXCJdKykvaS5leGVjKGhlYWRlcnNbJ2NvbnRlbnQtZGlzcG9zaXRpb24nXSk7XHJcbiAgICAgICAgaWYgKG1hdGNoKSB7XHJcbiAgICAgICAgICBmaWxlTmFtZSA9IGZzLnNhbml0aXplTmFtZShtYXRjaFsxXSwge1xyXG4gICAgICAgICAgICByZXBsYWNlbWVudDogU0FOSVRJWkVfUkVQTEFDRU1FTlRcclxuICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgc2hvdWxkVW56aXBBcHAgPSBzaG91bGRVbnppcEFwcCB8fCBaSVBfRVhUUy5pbmNsdWRlcyhwYXRoLmV4dG5hbWUoZmlsZU5hbWUpKTtcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgICAgaWYgKCFmaWxlTmFtZSkge1xyXG4gICAgICAgIC8vIGFzc2lnbiB0aGUgZGVmYXVsdCBmaWxlIG5hbWUgYW5kIHRoZSBleHRlbnNpb24gaWYgbm9uZSBoYXMgYmVlbiBkZXRlY3RlZFxyXG4gICAgICAgIGNvbnN0IHJlc3VsdGluZ05hbWUgPSBiYXNlbmFtZVxyXG4gICAgICAgICAgPyBiYXNlbmFtZS5zdWJzdHJpbmcoMCwgYmFzZW5hbWUubGVuZ3RoIC0gZXh0bmFtZS5sZW5ndGgpXHJcbiAgICAgICAgICA6IERFRkFVTFRfQkFTRU5BTUU7XHJcbiAgICAgICAgbGV0IHJlc3VsdGluZ0V4dCA9IGV4dG5hbWU7XHJcbiAgICAgICAgaWYgKCFzdXBwb3J0ZWRBcHBFeHRlbnNpb25zLmluY2x1ZGVzKHJlc3VsdGluZ0V4dCkpIHtcclxuICAgICAgICAgIGxvZ2dlci5pbmZvKGBUaGUgY3VycmVudCBmaWxlIGV4dGVuc2lvbiAnJHtyZXN1bHRpbmdFeHR9JyBpcyBub3Qgc3VwcG9ydGVkLiBgICtcclxuICAgICAgICAgICAgYERlZmF1bHRpbmcgdG8gJyR7Xy5maXJzdChzdXBwb3J0ZWRBcHBFeHRlbnNpb25zKX0nYCk7XHJcbiAgICAgICAgICByZXN1bHRpbmdFeHQgPSBfLmZpcnN0KHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBmaWxlTmFtZSA9IGAke3Jlc3VsdGluZ05hbWV9JHtyZXN1bHRpbmdFeHR9YDtcclxuICAgICAgfVxyXG4gICAgICBjb25zdCB0YXJnZXRQYXRoID0gYXdhaXQgdGVtcERpci5wYXRoKHtcclxuICAgICAgICBwcmVmaXg6IGZpbGVOYW1lLFxyXG4gICAgICAgIHN1ZmZpeDogJycsXHJcbiAgICAgIH0pO1xyXG4gICAgICBuZXdBcHAgPSBhd2FpdCBkb3dubG9hZEFwcChuZXdBcHAsIHRhcmdldFBhdGgpO1xyXG5cclxuICAgICAgLy8gKioqKiogQ3VzdG9tIGxvZ2ljIGZvciBjb3B5aW5nIG9mIGRvd25sb2FkZWQgYXBwIHRvIHN0YXRpYyBsb2NhdGlvbiAqKioqKlxyXG4gICAgICBjb25zdCBzaGFyZWRGb2xkZXJQYXRoID0gYXdhaXQgZ2V0U2hhcmVkRm9sZGVyRm9yQXBwVXJsKGFwcCk7XHJcbiAgICAgIGxvZ2dlci5pbmZvKGBGb2xkZXIgZm9yIGxvY2FsIHNoYXJlZCBhcHBzOiAke3NoYXJlZEZvbGRlclBhdGh9YCk7XHJcbiAgICAgIGxvZ2dlci5pbmZvKGBOZXcgYXBwIHBhdGg6ICR7bmV3QXBwfWApO1xyXG4gICAgICBhd2FpdCBmcy5jb3B5RmlsZShuZXdBcHAsIGxvY2FsRmlsZSk7XHJcbiAgICAgIH1cclxuICAgICAgZmluYWxseSB7XHJcbiAgICAgICAgbG9nZ2VyLmluZm8oYEdvaW5nIHRvIHJlbW92ZSBsb2NrIGZpbGUgJHtsb2NrRmlsZX1gKVxyXG4gICAgICAgIGF3YWl0IGZzLnVubGluayhsb2NrRmlsZSk7XHJcbiAgICAgIH1cclxuICAgICAgfVxyXG4gICAgfSBlbHNlIGlmIChhd2FpdCBmcy5leGlzdHMobmV3QXBwKSkge1xyXG4gICAgICAvLyBVc2UgdGhlIGxvY2FsIGFwcFxyXG4gICAgICBsb2dnZXIuaW5mbyhgVXNpbmcgbG9jYWwgYXBwICcke25ld0FwcH0nYCk7XHJcbiAgICAgIHNob3VsZFVuemlwQXBwID0gWklQX0VYVFMuaW5jbHVkZXMocGF0aC5leHRuYW1lKG5ld0FwcCkpO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgbGV0IGVycm9yTWVzc2FnZSA9IGBUaGUgYXBwbGljYXRpb24gYXQgJyR7bmV3QXBwfScgZG9lcyBub3QgZXhpc3Qgb3IgaXMgbm90IGFjY2Vzc2libGVgO1xyXG4gICAgICAvLyBwcm90b2NvbCB2YWx1ZSBmb3IgJ0M6XFxcXHRlbXAnIGlzICdjOicsIHNvIHdlIGNoZWNrIHRoZSBsZW5ndGggYXMgd2VsbFxyXG4gICAgICBpZiAoXy5pc1N0cmluZyhwcm90b2NvbCkgJiYgcHJvdG9jb2wubGVuZ3RoID4gMikge1xyXG4gICAgICAgIGVycm9yTWVzc2FnZSA9IGBUaGUgcHJvdG9jb2wgJyR7cHJvdG9jb2x9JyB1c2VkIGluICcke25ld0FwcH0nIGlzIG5vdCBzdXBwb3J0ZWQuIGAgK1xyXG4gICAgICAgICAgYE9ubHkgaHR0cDogYW5kIGh0dHBzOiBwcm90b2NvbHMgYXJlIHN1cHBvcnRlZGA7XHJcbiAgICAgIH1cclxuICAgICAgdGhyb3cgbmV3IEVycm9yKGVycm9yTWVzc2FnZSk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKHNob3VsZFVuemlwQXBwKSB7XHJcbiAgICAgIGNvbnN0IGFyY2hpdmVQYXRoID0gbmV3QXBwO1xyXG4gICAgICBhcmNoaXZlSGFzaCA9IGF3YWl0IGZzLmhhc2goYXJjaGl2ZVBhdGgpO1xyXG4gICAgICBpZiAoQVBQTElDQVRJT05TX0NBQ0hFLmhhcyhhcHApICYmIGFyY2hpdmVIYXNoID09PSBBUFBMSUNBVElPTlNfQ0FDSEUuZ2V0KGFwcCkuaGFzaCkge1xyXG4gICAgICAgIGNvbnN0IHtmdWxsUGF0aH0gPSBBUFBMSUNBVElPTlNfQ0FDSEUuZ2V0KGFwcCk7XHJcbiAgICAgICAgaWYgKGF3YWl0IGZzLmV4aXN0cyhmdWxsUGF0aCkpIHtcclxuICAgICAgICAgIGlmIChhcmNoaXZlUGF0aCAhPT0gYXBwKSB7XHJcbiAgICAgICAgICAgIGF3YWl0IGZzLnJpbXJhZihhcmNoaXZlUGF0aCk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBsb2dnZXIuaW5mbyhgV2lsbCByZXVzZSBwcmV2aW91c2x5IGNhY2hlZCBhcHBsaWNhdGlvbiBhdCAnJHtmdWxsUGF0aH0nYCk7XHJcbiAgICAgICAgICByZXR1cm4gdmVyaWZ5QXBwRXh0ZW5zaW9uKGZ1bGxQYXRoLCBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgbG9nZ2VyLmluZm8oYFRoZSBhcHBsaWNhdGlvbiBhdCAnJHtmdWxsUGF0aH0nIGRvZXMgbm90IGV4aXN0IGFueW1vcmUuIERlbGV0aW5nIGl0IGZyb20gdGhlIGNhY2hlYCk7XHJcbiAgICAgICAgQVBQTElDQVRJT05TX0NBQ0hFLmRlbChhcHApO1xyXG4gICAgICB9XHJcbiAgICAgIGNvbnN0IHRtcFJvb3QgPSBhd2FpdCB0ZW1wRGlyLm9wZW5EaXIoKTtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBuZXdBcHAgPSBhd2FpdCB1bnppcEFwcChhcmNoaXZlUGF0aCwgdG1wUm9vdCwgc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucyk7XHJcbiAgICAgIH0gZmluYWxseSB7XHJcbiAgICAgICAgaWYgKG5ld0FwcCAhPT0gYXJjaGl2ZVBhdGggJiYgYXJjaGl2ZVBhdGggIT09IGFwcCkge1xyXG4gICAgICAgICAgYXdhaXQgZnMucmltcmFmKGFyY2hpdmVQYXRoKTtcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgICAgbG9nZ2VyLmluZm8oYFVuemlwcGVkIGxvY2FsIGFwcCB0byAnJHtuZXdBcHB9J2ApO1xyXG4gICAgfSBlbHNlIGlmICghcGF0aC5pc0Fic29sdXRlKG5ld0FwcCkpIHtcclxuICAgICAgbmV3QXBwID0gcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksIG5ld0FwcCk7XHJcbiAgICAgIGxvZ2dlci53YXJuKGBUaGUgY3VycmVudCBhcHBsaWNhdGlvbiBwYXRoICcke2FwcH0nIGlzIG5vdCBhYnNvbHV0ZSBgICtcclxuICAgICAgICBgYW5kIGhhcyBiZWVuIHJld3JpdHRlbiB0byAnJHtuZXdBcHB9Jy4gQ29uc2lkZXIgdXNpbmcgYWJzb2x1dGUgcGF0aHMgcmF0aGVyIHRoYW4gcmVsYXRpdmVgKTtcclxuICAgICAgYXBwID0gbmV3QXBwO1xyXG4gICAgfVxyXG5cclxuICAgIHZlcmlmeUFwcEV4dGVuc2lvbihuZXdBcHAsIHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMpO1xyXG5cclxuICAgIGlmIChhcHAgIT09IG5ld0FwcCAmJiAoYXJjaGl2ZUhhc2ggfHwgXy52YWx1ZXMocmVtb3RlQXBwUHJvcHMpLnNvbWUoQm9vbGVhbikpKSB7XHJcbiAgICAgIGlmIChBUFBMSUNBVElPTlNfQ0FDSEUuaGFzKGFwcCkpIHtcclxuICAgICAgICBjb25zdCB7ZnVsbFBhdGh9ID0gQVBQTElDQVRJT05TX0NBQ0hFLmdldChhcHApO1xyXG4gICAgICAgIC8vIENsZWFuIHVwIHRoZSBvYnNvbGV0ZSBlbnRyeSBmaXJzdCBpZiBuZWVkZWRcclxuICAgICAgICBpZiAoZnVsbFBhdGggIT09IG5ld0FwcCAmJiBhd2FpdCBmcy5leGlzdHMoZnVsbFBhdGgpKSB7XHJcbiAgICAgICAgICBhd2FpdCBmcy5yaW1yYWYoZnVsbFBhdGgpO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgICBBUFBMSUNBVElPTlNfQ0FDSEUuc2V0KGFwcCwge1xyXG4gICAgICAgIC4uLnJlbW90ZUFwcFByb3BzLFxyXG4gICAgICAgIHRpbWVzdGFtcDogRGF0ZS5ub3coKSxcclxuICAgICAgICBoYXNoOiBhcmNoaXZlSGFzaCxcclxuICAgICAgICBmdWxsUGF0aDogbmV3QXBwLFxyXG4gICAgICB9KTtcclxuICAgIH1cclxuICAgIHJldHVybiBuZXdBcHA7XHJcbiAgfSk7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGRvd25sb2FkQXBwIChhcHAsIHRhcmdldFBhdGgpIHtcclxuICBjb25zdCB7aHJlZn0gPSB1cmwucGFyc2UoYXBwKTtcclxuICB0cnkge1xyXG4gICAgYXdhaXQgbmV0LmRvd25sb2FkRmlsZShocmVmLCB0YXJnZXRQYXRoLCB7XHJcbiAgICAgIHRpbWVvdXQ6IEFQUF9ET1dOTE9BRF9USU1FT1VUX01TLFxyXG4gICAgfSk7XHJcbiAgfSBjYXRjaCAoZXJyKSB7XHJcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFVuYWJsZSB0byBkb3dubG9hZCB0aGUgYXBwOiAke2Vyci5tZXNzYWdlfWApO1xyXG4gIH1cclxuICByZXR1cm4gdGFyZ2V0UGF0aDtcclxufVxyXG5cclxuLyoqXHJcbiAqIEV4dHJhY3RzIHRoZSBidW5kbGUgZnJvbSBhbiBhcmNoaXZlIGludG8gdGhlIGdpdmVuIGZvbGRlclxyXG4gKlxyXG4gKiBAcGFyYW0ge3N0cmluZ30gemlwUGF0aCBGdWxsIHBhdGggdG8gdGhlIGFyY2hpdmUgY29udGFpbmluZyB0aGUgYnVuZGxlXHJcbiAqIEBwYXJhbSB7c3RyaW5nfSBkc3RSb290IEZ1bGwgcGF0aCB0byB0aGUgZm9sZGVyIHdoZXJlIHRoZSBleHRyYWN0ZWQgYnVuZGxlXHJcbiAqIHNob3VsZCBiZSBwbGFjZWRcclxuICogQHBhcmFtIHtBcnJheTxzdHJpbmc+fHN0cmluZ30gc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucyBUaGUgbGlzdCBvZiBleHRlbnNpb25zXHJcbiAqIHRoZSB0YXJnZXQgYXBwbGljYXRpb24gYnVuZGxlIHN1cHBvcnRzLCBmb3IgZXhhbXBsZSBbJy5hcGsnLCAnLmFwa3MnXSBmb3JcclxuICogQW5kcm9pZCBwYWNrYWdlc1xyXG4gKiBAcmV0dXJucyB7c3RyaW5nfSBGdWxsIHBhdGggdG8gdGhlIGJ1bmRsZSBpbiB0aGUgZGVzdGluYXRpb24gZm9sZGVyXHJcbiAqIEB0aHJvd3Mge0Vycm9yfSBJZiB0aGUgZ2l2ZW4gYXJjaGl2ZSBpcyBpbnZhbGlkIG9yIG5vIGFwcGxpY2F0aW9uIGJ1bmRsZXNcclxuICogaGF2ZSBiZWVuIGZvdW5kIGluc2lkZVxyXG4gKi9cclxuYXN5bmMgZnVuY3Rpb24gdW56aXBBcHAgKHppcFBhdGgsIGRzdFJvb3QsIHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMpIHtcclxuICBhd2FpdCB6aXAuYXNzZXJ0VmFsaWRaaXAoemlwUGF0aCk7XHJcblxyXG4gIGlmICghXy5pc0FycmF5KHN1cHBvcnRlZEFwcEV4dGVuc2lvbnMpKSB7XHJcbiAgICBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zID0gW3N1cHBvcnRlZEFwcEV4dGVuc2lvbnNdO1xyXG4gIH1cclxuXHJcbiAgY29uc3QgdG1wUm9vdCA9IGF3YWl0IHRlbXBEaXIub3BlbkRpcigpO1xyXG4gIHRyeSB7XHJcbiAgICBsb2dnZXIuZGVidWcoYFVuemlwcGluZyAnJHt6aXBQYXRofSdgKTtcclxuICAgIGNvbnN0IHRpbWVyID0gbmV3IHRpbWluZy5UaW1lcigpLnN0YXJ0KCk7XHJcbiAgICAvKipcclxuICAgICAqIEF0dGVtcHQgdG8gdXNlIHVzZSB0aGUgc3lzdGVtIGB1bnppcGAgKGUuZy4sIGAvdXNyL2Jpbi91bnppcGApIGR1ZVxyXG4gICAgICogdG8gdGhlIHNpZ25pZmljYW50IHBlcmZvcm1hbmNlIGltcHJvdmVtZW50IGl0IHByb3ZpZGVzIG92ZXIgdGhlIG5hdGl2ZVxyXG4gICAgICogSlMgXCJ1bnppcFwiIGltcGxlbWVudGF0aW9uLlxyXG4gICAgICogQHR5cGUge2ltcG9ydCgnYXBwaXVtLXN1cHBvcnQvbGliL3ppcCcpLkV4dHJhY3RBbGxPcHRpb25zfVxyXG4gICAgICovXHJcbiAgICBjb25zdCBleHRyYWN0aW9uT3B0cyA9IHtcclxuICAgICAgdXNlU3lzdGVtVW56aXA6IHRydWUsXHJcbiAgICB9O1xyXG4gICAgLy8gaHR0cHM6Ly9naXRodWIuY29tL2FwcGl1bS9hcHBpdW0vaXNzdWVzLzE0MTAwXHJcbiAgICBpZiAocGF0aC5leHRuYW1lKHppcFBhdGgpID09PSBJUEFfRVhUKSB7XHJcbiAgICAgIGxvZ2dlci5kZWJ1ZyhgRW5mb3JjaW5nIFVURi04IGVuY29kaW5nIG9uIHRoZSBleHRyYWN0ZWQgZmlsZSBuYW1lcyBmb3IgJyR7cGF0aC5iYXNlbmFtZSh6aXBQYXRoKX0nYCk7XHJcbiAgICAgIGV4dHJhY3Rpb25PcHRzLmZpbGVOYW1lc0VuY29kaW5nID0gJ3V0ZjgnO1xyXG4gICAgfVxyXG4gICAgYXdhaXQgemlwLmV4dHJhY3RBbGxUbyh6aXBQYXRoLCB0bXBSb290LCBleHRyYWN0aW9uT3B0cyk7XHJcbiAgICBjb25zdCBnbG9iUGF0dGVybiA9IGAqKi8qLisoJHtzdXBwb3J0ZWRBcHBFeHRlbnNpb25zLm1hcCgoZXh0KSA9PiBleHQucmVwbGFjZSgvXlxcLi8sICcnKSkuam9pbignfCcpfSlgO1xyXG4gICAgY29uc3Qgc29ydGVkQnVuZGxlSXRlbXMgPSAoYXdhaXQgZnMuZ2xvYihnbG9iUGF0dGVybiwge1xyXG4gICAgICBjd2Q6IHRtcFJvb3QsXHJcbiAgICAgIHN0cmljdDogZmFsc2UsXHJcbiAgICAvLyBHZXQgdGhlIHRvcCBsZXZlbCBtYXRjaFxyXG4gICAgfSkpLnNvcnQoKGEsIGIpID0+IGEuc3BsaXQocGF0aC5zZXApLmxlbmd0aCAtIGIuc3BsaXQocGF0aC5zZXApLmxlbmd0aCk7XHJcbiAgICBpZiAoXy5pc0VtcHR5KHNvcnRlZEJ1bmRsZUl0ZW1zKSkge1xyXG4gICAgICBsb2dnZXIuZXJyb3JBbmRUaHJvdyhgQXBwIHVuemlwcGVkIE9LLCBidXQgd2UgY291bGQgbm90IGZpbmQgYW55ICcke3N1cHBvcnRlZEFwcEV4dGVuc2lvbnN9JyBgICtcclxuICAgICAgICB1dGlsLnBsdXJhbGl6ZSgnYnVuZGxlJywgc3VwcG9ydGVkQXBwRXh0ZW5zaW9ucy5sZW5ndGgsIGZhbHNlKSArXHJcbiAgICAgICAgYCBpbiBpdC4gTWFrZSBzdXJlIHlvdXIgYXJjaGl2ZSBjb250YWlucyBhdCBsZWFzdCBvbmUgcGFja2FnZSBoYXZpbmcgYCArXHJcbiAgICAgICAgYCcke3N1cHBvcnRlZEFwcEV4dGVuc2lvbnN9JyAke3V0aWwucGx1cmFsaXplKCdleHRlbnNpb24nLCBzdXBwb3J0ZWRBcHBFeHRlbnNpb25zLmxlbmd0aCwgZmFsc2UpfWApO1xyXG4gICAgfVxyXG4gICAgbG9nZ2VyLmRlYnVnKGBFeHRyYWN0ZWQgJHt1dGlsLnBsdXJhbGl6ZSgnYnVuZGxlIGl0ZW0nLCBzb3J0ZWRCdW5kbGVJdGVtcy5sZW5ndGgsIHRydWUpfSBgICtcclxuICAgICAgYGZyb20gJyR7emlwUGF0aH0nIGluICR7TWF0aC5yb3VuZCh0aW1lci5nZXREdXJhdGlvbigpLmFzTWlsbGlTZWNvbmRzKX1tczogJHtzb3J0ZWRCdW5kbGVJdGVtc31gKTtcclxuICAgIGNvbnN0IG1hdGNoZWRCdW5kbGUgPSBfLmZpcnN0KHNvcnRlZEJ1bmRsZUl0ZW1zKTtcclxuICAgIGxvZ2dlci5pbmZvKGBBc3N1bWluZyAnJHttYXRjaGVkQnVuZGxlfScgaXMgdGhlIGNvcnJlY3QgYnVuZGxlYCk7XHJcbiAgICBjb25zdCBkc3RQYXRoID0gcGF0aC5yZXNvbHZlKGRzdFJvb3QsIHBhdGguYmFzZW5hbWUobWF0Y2hlZEJ1bmRsZSkpO1xyXG4gICAgYXdhaXQgZnMubXYocGF0aC5yZXNvbHZlKHRtcFJvb3QsIG1hdGNoZWRCdW5kbGUpLCBkc3RQYXRoLCB7bWtkaXJwOiB0cnVlfSk7XHJcbiAgICByZXR1cm4gZHN0UGF0aDtcclxuICB9IGZpbmFsbHkge1xyXG4gICAgYXdhaXQgZnMucmltcmFmKHRtcFJvb3QpO1xyXG4gIH1cclxufVxyXG5cclxuZnVuY3Rpb24gaXNQYWNrYWdlT3JCdW5kbGUgKGFwcCkge1xyXG4gIHJldHVybiAoL14oW2EtekEtWjAtOVxcLV9dK1xcLlthLXpBLVowLTlcXC1fXSspKyQvKS50ZXN0KGFwcCk7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBGaW5kcyBhbGwgaW5zdGFuY2VzICdmaXJzdEtleScgYW5kIGNyZWF0ZSBhIGR1cGxpY2F0ZSB3aXRoIHRoZSBrZXkgJ3NlY29uZEtleScsXHJcbiAqIERvIHRoZSBzYW1lIHRoaW5nIGluIHJldmVyc2UuIElmIHdlIGZpbmQgJ3NlY29uZEtleScsIGNyZWF0ZSBhIGR1cGxpY2F0ZSB3aXRoIHRoZSBrZXkgJ2ZpcnN0S2V5Jy5cclxuICpcclxuICogVGhpcyB3aWxsIGNhdXNlIGtleXMgdG8gYmUgb3ZlcndyaXR0ZW4gaWYgdGhlIG9iamVjdCBjb250YWlucyAnZmlyc3RLZXknIGFuZCAnc2Vjb25kS2V5Jy5cclxuXHJcbiAqIEBwYXJhbSB7Kn0gaW5wdXQgQW55IHR5cGUgb2YgaW5wdXRcclxuICogQHBhcmFtIHtTdHJpbmd9IGZpcnN0S2V5IFRoZSBmaXJzdCBrZXkgdG8gZHVwbGljYXRlXHJcbiAqIEBwYXJhbSB7U3RyaW5nfSBzZWNvbmRLZXkgVGhlIHNlY29uZCBrZXkgdG8gZHVwbGljYXRlXHJcbiAqL1xyXG5mdW5jdGlvbiBkdXBsaWNhdGVLZXlzIChpbnB1dCwgZmlyc3RLZXksIHNlY29uZEtleSkge1xyXG4gIC8vIElmIGFycmF5IHByb3ZpZGVkLCByZWN1cnNpdmVseSBjYWxsIG9uIGFsbCBlbGVtZW50c1xyXG4gIGlmIChfLmlzQXJyYXkoaW5wdXQpKSB7XHJcbiAgICByZXR1cm4gaW5wdXQubWFwKChpdGVtKSA9PiBkdXBsaWNhdGVLZXlzKGl0ZW0sIGZpcnN0S2V5LCBzZWNvbmRLZXkpKTtcclxuICB9XHJcblxyXG4gIC8vIElmIG9iamVjdCwgY3JlYXRlIGR1cGxpY2F0ZXMgZm9yIGtleXMgYW5kIHRoZW4gcmVjdXJzaXZlbHkgY2FsbCBvbiB2YWx1ZXNcclxuICBpZiAoXy5pc1BsYWluT2JqZWN0KGlucHV0KSkge1xyXG4gICAgY29uc3QgcmVzdWx0T2JqID0ge307XHJcbiAgICBmb3IgKGxldCBba2V5LCB2YWx1ZV0gb2YgXy50b1BhaXJzKGlucHV0KSkge1xyXG4gICAgICBjb25zdCByZWN1cnNpdmVseUNhbGxlZFZhbHVlID0gZHVwbGljYXRlS2V5cyh2YWx1ZSwgZmlyc3RLZXksIHNlY29uZEtleSk7XHJcbiAgICAgIGlmIChrZXkgPT09IGZpcnN0S2V5KSB7XHJcbiAgICAgICAgcmVzdWx0T2JqW3NlY29uZEtleV0gPSByZWN1cnNpdmVseUNhbGxlZFZhbHVlO1xyXG4gICAgICB9IGVsc2UgaWYgKGtleSA9PT0gc2Vjb25kS2V5KSB7XHJcbiAgICAgICAgcmVzdWx0T2JqW2ZpcnN0S2V5XSA9IHJlY3Vyc2l2ZWx5Q2FsbGVkVmFsdWU7XHJcbiAgICAgIH1cclxuICAgICAgcmVzdWx0T2JqW2tleV0gPSByZWN1cnNpdmVseUNhbGxlZFZhbHVlO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHJlc3VsdE9iajtcclxuICB9XHJcblxyXG4gIC8vIEJhc2UgY2FzZS4gUmV0dXJuIHByaW1pdGl2ZXMgd2l0aG91dCBkb2luZyBhbnl0aGluZy5cclxuICByZXR1cm4gaW5wdXQ7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBUYWtlcyBhIGRlc2lyZWQgY2FwYWJpbGl0eSBhbmQgdHJpZXMgdG8gSlNPTi5wYXJzZSBpdCBhcyBhbiBhcnJheSxcclxuICogYW5kIGVpdGhlciByZXR1cm5zIHRoZSBwYXJzZWQgYXJyYXkgb3IgYSBzaW5nbGV0b24gYXJyYXkuXHJcbiAqXHJcbiAqIEBwYXJhbSB7c3RyaW5nfEFycmF5PFN0cmluZz59IGNhcCBBIGRlc2lyZWQgY2FwYWJpbGl0eVxyXG4gKi9cclxuZnVuY3Rpb24gcGFyc2VDYXBzQXJyYXkgKGNhcCkge1xyXG4gIGlmIChfLmlzQXJyYXkoY2FwKSkge1xyXG4gICAgcmV0dXJuIGNhcDtcclxuICB9XHJcblxyXG4gIGxldCBwYXJzZWRDYXBzO1xyXG4gIHRyeSB7XHJcbiAgICBwYXJzZWRDYXBzID0gSlNPTi5wYXJzZShjYXApO1xyXG4gICAgaWYgKF8uaXNBcnJheShwYXJzZWRDYXBzKSkge1xyXG4gICAgICByZXR1cm4gcGFyc2VkQ2FwcztcclxuICAgIH1cclxuICB9IGNhdGNoIChpZ24pIHtcclxuICAgIGxvZ2dlci53YXJuKGBGYWlsZWQgdG8gcGFyc2UgY2FwYWJpbGl0eSBhcyBKU09OIGFycmF5YCk7XHJcbiAgfVxyXG4gIGlmIChfLmlzU3RyaW5nKGNhcCkpIHtcclxuICAgIHJldHVybiBbY2FwXTtcclxuICB9XHJcbiAgdGhyb3cgbmV3IEVycm9yKGBtdXN0IHByb3ZpZGUgYSBzdHJpbmcgb3IgSlNPTiBBcnJheTsgcmVjZWl2ZWQgJHtjYXB9YCk7XHJcbn1cclxuXHJcbmV4cG9ydCB7XHJcbiAgY29uZmlndXJlQXBwLCBpc1BhY2thZ2VPckJ1bmRsZSwgZHVwbGljYXRlS2V5cywgcGFyc2VDYXBzQXJyYXlcclxufTtcclxuIl0sImZpbGUiOiJsaWIvYmFzZWRyaXZlci9oZWxwZXJzLmpzIiwic291cmNlUm9vdCI6Ii4uXFwuLlxcLi4ifQ==
