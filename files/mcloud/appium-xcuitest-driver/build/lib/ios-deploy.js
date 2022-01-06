"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault");

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

require("source-map-support/register");

var _appiumSupport = require("appium-support");

var _path = _interopRequireDefault(require("path"));

var _appiumIosDevice = require("appium-ios-device");

var _bluebird = _interopRequireDefault(require("bluebird"));

var _logger = _interopRequireDefault(require("./logger"));

var _lodash = _interopRequireDefault(require("lodash"));

var _teen_process = require("teen_process");

const APPLICATION_INSTALLED_NOTIFICATION = 'com.apple.mobile.application_installed';
const INSTALLATION_STAGING_DIR = 'PublicStaging';
const DEFAULT_ITEM_PUSH_TIMEOUT = 30 * 1000;
const APPLICATION_NOTIFICATION_TIMEOUT = 30 * 1000;
const IOS_DEPLOY = 'ios';

class IOSDeploy {
  constructor(udid) {
    this.udid = udid;
  }

  async remove(bundleid) {
    try {
      await (0, _teen_process.exec)(IOS_DEPLOY, ['uninstall', bundleid, '--udid=' + this.udid]);
    } catch (err1) {
      throw new Error(`App is not uninstalled '${bundleid}':\n` + `  - ${err1.message}\n` + `  - ${err1.stderr || err1.stdout || err1.message}`);
    }
  }

  async removeApp(bundleId) {
    await this.remove(bundleId);
  }

  async install(app, timeout) {
    const timer = new _appiumSupport.timing.Timer().start();

    try {
      const bundlePathOnPhone = await this.pushAppBundle(app, timeout);
      await this.installApplication(bundlePathOnPhone);
    } catch (err) {
      _logger.default.warn(`Error installing app: ${err.message}`);

      _logger.default.warn(`Falling back to '${IOS_DEPLOY}' usage`);

      try {
        await _appiumSupport.fs.which(IOS_DEPLOY);
      } catch (err1) {
        throw new Error(`Could not install '${app}':\n` + `  - ${err.message}\n` + `  - '${IOS_DEPLOY}' utility has not been found in PATH. Is it installed?`);
      }

      try {
        await (0, _teen_process.exec)(IOS_DEPLOY, ['install', '--path=' + app, '--udid=' + this.udid]);
      } catch (err1) {
        throw new Error(`Could not install '${app}':\n` + `  - ${err.message}\n` + `  - ${err1.stderr || err1.stdout || err1.message}`);
      }
    }

    _logger.default.info(`App installation succeeded after ${timer.getDuration().asMilliSeconds.toFixed(0)}ms`);
  }

  async installApplication(bundlePathOnPhone) {
    const notificationService = await _appiumIosDevice.services.startNotificationProxyService(this.udid);
    const installationService = await _appiumIosDevice.services.startInstallationProxyService(this.udid);
    const appInstalledNotification = new _bluebird.default(resolve => {
      notificationService.observeNotification(APPLICATION_INSTALLED_NOTIFICATION, {
        notification: resolve
      });
    });

    try {
      await installationService.installApplication(bundlePathOnPhone, {
        PackageType: 'Developer'
      });

      try {
        await appInstalledNotification.timeout(APPLICATION_NOTIFICATION_TIMEOUT, `Could not get the application installed notification within ${APPLICATION_NOTIFICATION_TIMEOUT}ms but we will continue`);
      } catch (e) {
        _logger.default.warn(`Failed to receive the notification. Error: ${e.message}`);
      }
    } finally {
      installationService.close();
      notificationService.close();
    }
  }

  async pushAppBundle(app, timeout = DEFAULT_ITEM_PUSH_TIMEOUT) {
    const timer = new _appiumSupport.timing.Timer().start();
    const afcService = await _appiumIosDevice.services.startAfcService(this.udid);

    try {
      const bundlePathOnPhone = await this.createAppPath(afcService, app);
      await _appiumSupport.fs.walkDir(app, true, async (itemPath, isDir) => {
        const pathOnPhone = _path.default.join(bundlePathOnPhone, _path.default.relative(app, itemPath));

        if (isDir) {
          await afcService.createDirectory(pathOnPhone);
        } else {
          const readStream = _appiumSupport.fs.createReadStream(itemPath, {
            autoClose: true
          });

          const writeStream = await afcService.createWriteStream(pathOnPhone, {
            autoDestroy: true
          });
          writeStream.on('finish', writeStream.destroy);
          let pushError = null;
          const itemPushWait = new _bluebird.default((resolve, reject) => {
            writeStream.on('close', () => {
              if (pushError) {
                reject(pushError);
              } else {
                resolve();
              }
            });

            const onStreamError = e => {
              readStream.unpipe(writeStream);

              _logger.default.debug(e);

              pushError = e;
            };

            writeStream.on('error', onStreamError);
            readStream.on('error', onStreamError);
          });
          readStream.pipe(writeStream);
          await itemPushWait.timeout(timeout, `Could not push '${itemPath}' within the timeout of ${timeout}ms. ` + `Consider increasing the value of 'appPushTimeout' capability.`);
        }
      });

      _logger.default.debug(`Pushed the app files successfully after ${timer.getDuration().asMilliSeconds.toFixed(0)}ms`);

      return bundlePathOnPhone;
    } finally {
      afcService.close();
    }
  }

  async createAppPath(afcService, localAppPath) {
    const basename = _path.default.basename(localAppPath);

    const relativePath = _path.default.join(INSTALLATION_STAGING_DIR, basename);

    try {
      await afcService.deleteDirectory(relativePath);
    } catch (ign) {}

    await afcService.createDirectory(relativePath);
    return relativePath;
  }

  async installApp(app, timeout) {
    await this.install(app, timeout);
  }

  async isAppInstalled(bundleid) {
    try {
      // verify if app installed among system first!
      let {stdout, stderr, code} = await _teen_process.exec(IOS_DEPLOY, ['apps', '--system', '--udid=' + this.udid]);
      _logger.default.debug(stdout);
      _logger.default.debug(stderr);              // ''
      _logger.default.debug(code);                // 0
      if (stdout != null && stdout.indexOf(bundleid) !== -1) {
        _logger.default.debug(bundleid + ' is found among system apps.')
        return true;
      } else {
       _logger.default.debug(bundleid + ' is NOT found among system apps.')
      }
    } catch (err1) {
      throw new Error(`App is no installed among system apps '${bundleid}':\n` + `  - ${err1.message}\n` + `  - ${err1.stderr || err1.stdout || err1.message}`);
    }

    try {
      // verify if app installed among system first!
      let {stdout, stderr, code} = await _teen_process.exec(IOS_DEPLOY, ['apps', '--udid=' + this.udid]);
      _logger.default.debug(stdout);
      _logger.default.debug(stderr);              // ''
      _logger.default.debug(code);                // 0
      if (stdout != null && stdout.indexOf(bundleid) !== -1) {
        _logger.default.debug(bundleid + ' is found among non system apps.')
        return true;
      } else {
       _logger.default.debug(bundleid + ' is NOT found among non system apps.')
      }
    } catch (err1) {
      throw new Error(`App is no installed among non system apps '${bundleid}':\n` + `  - ${err1.message}\n` + `  - ${err1.stderr || err1.stdout || err1.message}`);
    }

    return false;
  }

  async getUserInstalledBundleIdsByBundleName(bundleName) {
    const service = await _appiumIosDevice.services.startInstallationProxyService(this.udid);

    try {
      const applications = await service.listApplications({
        applicationType: 'User'
      });
      return _lodash.default.reduce(applications, (acc, {
        CFBundleName
      }, key) => {
        if (CFBundleName === bundleName) {
          acc.push(key);
        }

        return acc;
      }, []);
    } finally {
      service.close();
    }
  }

  async getPlatformVersion() {
    return await _appiumIosDevice.utilities.getOSVersion(this.udid);
  }

}

var _default = IOSDeploy;
exports.default = _default;require('source-map-support').install();


//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImxpYi9pb3MtZGVwbG95LmpzIl0sIm5hbWVzIjpbIkFQUExJQ0FUSU9OX0lOU1RBTExFRF9OT1RJRklDQVRJT04iLCJJTlNUQUxMQVRJT05fU1RBR0lOR19ESVIiLCJERUZBVUxUX0lURU1fUFVTSF9USU1FT1VUIiwiQVBQTElDQVRJT05fTk9USUZJQ0FUSU9OX1RJTUVPVVQiLCJJT1NfREVQTE9ZIiwiSU9TRGVwbG95IiwiY29uc3RydWN0b3IiLCJ1ZGlkIiwicmVtb3ZlIiwiYnVuZGxlaWQiLCJzZXJ2aWNlIiwic2VydmljZXMiLCJzdGFydEluc3RhbGxhdGlvblByb3h5U2VydmljZSIsInVuaW5zdGFsbEFwcGxpY2F0aW9uIiwiY2xvc2UiLCJyZW1vdmVBcHAiLCJidW5kbGVJZCIsImluc3RhbGwiLCJhcHAiLCJ0aW1lb3V0IiwidGltZXIiLCJ0aW1pbmciLCJUaW1lciIsInN0YXJ0IiwiYnVuZGxlUGF0aE9uUGhvbmUiLCJwdXNoQXBwQnVuZGxlIiwiaW5zdGFsbEFwcGxpY2F0aW9uIiwiZXJyIiwibG9nIiwid2FybiIsIm1lc3NhZ2UiLCJmcyIsIndoaWNoIiwiZXJyMSIsIkVycm9yIiwic3RkZXJyIiwic3Rkb3V0IiwiaW5mbyIsImdldER1cmF0aW9uIiwiYXNNaWxsaVNlY29uZHMiLCJ0b0ZpeGVkIiwibm90aWZpY2F0aW9uU2VydmljZSIsInN0YXJ0Tm90aWZpY2F0aW9uUHJveHlTZXJ2aWNlIiwiaW5zdGFsbGF0aW9uU2VydmljZSIsImFwcEluc3RhbGxlZE5vdGlmaWNhdGlvbiIsIkIiLCJyZXNvbHZlIiwib2JzZXJ2ZU5vdGlmaWNhdGlvbiIsIm5vdGlmaWNhdGlvbiIsIlBhY2thZ2VUeXBlIiwiZSIsImFmY1NlcnZpY2UiLCJzdGFydEFmY1NlcnZpY2UiLCJjcmVhdGVBcHBQYXRoIiwid2Fsa0RpciIsIml0ZW1QYXRoIiwiaXNEaXIiLCJwYXRoT25QaG9uZSIsInBhdGgiLCJqb2luIiwicmVsYXRpdmUiLCJjcmVhdGVEaXJlY3RvcnkiLCJyZWFkU3RyZWFtIiwiY3JlYXRlUmVhZFN0cmVhbSIsImF1dG9DbG9zZSIsIndyaXRlU3RyZWFtIiwiY3JlYXRlV3JpdGVTdHJlYW0iLCJhdXRvRGVzdHJveSIsIm9uIiwiZGVzdHJveSIsInB1c2hFcnJvciIsIml0ZW1QdXNoV2FpdCIsInJlamVjdCIsIm9uU3RyZWFtRXJyb3IiLCJ1bnBpcGUiLCJkZWJ1ZyIsInBpcGUiLCJsb2NhbEFwcFBhdGgiLCJiYXNlbmFtZSIsInJlbGF0aXZlUGF0aCIsImRlbGV0ZURpcmVjdG9yeSIsImlnbiIsImluc3RhbGxBcHAiLCJpc0FwcEluc3RhbGxlZCIsImFwcGxpY2F0aW9ucyIsImxvb2t1cEFwcGxpY2F0aW9ucyIsImJ1bmRsZUlkcyIsImdldFVzZXJJbnN0YWxsZWRCdW5kbGVJZHNCeUJ1bmRsZU5hbWUiLCJidW5kbGVOYW1lIiwibGlzdEFwcGxpY2F0aW9ucyIsImFwcGxpY2F0aW9uVHlwZSIsIl8iLCJyZWR1Y2UiLCJhY2MiLCJDRkJ1bmRsZU5hbWUiLCJrZXkiLCJwdXNoIiwiZ2V0UGxhdGZvcm1WZXJzaW9uIiwidXRpbGl0aWVzIiwiZ2V0T1NWZXJzaW9uIl0sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7OztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUVBLE1BQU1BLGtDQUFrQyxHQUFHLHdDQUEzQztBQUNBLE1BQU1DLHdCQUF3QixHQUFHLGVBQWpDO0FBQ0EsTUFBTUMseUJBQXlCLEdBQUcsS0FBSyxJQUF2QztBQUNBLE1BQU1DLGdDQUFnQyxHQUFHLEtBQUssSUFBOUM7QUFDQSxNQUFNQyxVQUFVLEdBQUcsWUFBbkI7O0FBRUEsTUFBTUMsU0FBTixDQUFnQjtBQUVkQyxFQUFBQSxXQUFXLENBQUVDLElBQUYsRUFBUTtBQUNqQixTQUFLQSxJQUFMLEdBQVlBLElBQVo7QUFDRDs7QUFFVyxRQUFOQyxNQUFNLENBQUVDLFFBQUYsRUFBWTtBQUN0QixVQUFNQyxPQUFPLEdBQUcsTUFBTUMsMEJBQVNDLDZCQUFULENBQXVDLEtB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RUMsTUFBRixDQUFTUixZQUFULEVBQXVCLENBQUNTLEdBQUQsRUFBTTtBQUFDQyxRQUFBQTtBQUFELE9BQU4sRUFBc0JDLEdBQXRCLEtBQThCO0FBQzFELFlBQUlELFlBQVksS0FBS04sVUFBckIsRUFBaUM7QUFDL0JLLFVBQUFBLEdBQUcsQ0FBQ0csSUFBSixDQUFTRCxHQUFUO0FBQ0Q7O0FBQ0QsZUFBT0YsR0FBUDtBQUNELE9BTE0sRUFLSixFQUxJLENBQVA7QUFNRCxLQVJELFNBUVU7QUFDUm5GLE1BQUFBLE9BQU8sQ0FBQ0ksS0FBUjtBQUNEO0FBQ0Y7O0FBRXVCLFFBQWxCbUYsa0JBQWtCLEdBQUk7QUFDMUIsV0FBTyxNQUFNQywyQkFBVUMsWUFBVixDQUF1QixLQUFLNUYsSUFBNUIsQ0FBYjtBQUNEOztBQTFLYTs7ZUE2S0RGLFMiLCJzb3VyY2VzQ29udGVudCI6WyIvKiBlc2xpbnQtZGlzYWJsZSBwcm9taXNlL3ByZWZlci1hd2FpdC10by1jYWxsYmFja3MgKi9cbmltcG9ydCB7IGZzLCB0aW1pbmcgfSBmcm9tICdhcHBpdW0tc3VwcG9ydCc7XG5pbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCB7IHNlcnZpY2VzLCB1dGlsaXRpZXMgfSBmcm9tICdhcHBpdW0taW9zLWRldmljZSc7XG5pbXBvcnQgQiBmcm9tICdibHVlYmlyZCc7XG5pbXBvcnQgbG9nIGZyb20gJy4vbG9nZ2VyJztcbmltcG9ydCBfIGZyb20gJ2xvZGFzaCc7XG5pbXBvcnQgeyBleGVjIH0gZnJvbSAndGVlbl9wcm9jZXNzJztcblxuY29uc3QgQVBQTElDQVRJT05fSU5TVEFMTEVEX05PVElGSUNBVElPTiA9ICdjb20uYXBwbGUubW9iaWxlLmFwcGxpY2F0aW9uX2luc3RhbGxlZCc7XG5jb25zdCBJTlNUQUxMQVRJT05fU1RBR0lOR19ESVIgPSAnUHVibGljU3RhZ2luZyc7XG5jb25zdCBERUZBVUxUX0lURU1fUFVTSF9USU1FT1VUID0gMzAgKiAxMDAwO1xuY29uc3QgQVBQTElDQVRJT05fTk9USUZJQ0FUSU9OX1RJTUVPVVQgPSAzMCAqIDEwMDA7XG5jb25zdCBJT1NfREVQTE9ZID0gJ2lvcy1kZXBsb3knO1xuXG5jbGFzcyBJT1NEZXBsb3kge1xuXG4gIGNvbnN0cnVjdG9yICh1ZGlkKSB7XG4gICAgdGhpcy51ZGlkID0gdWRpZDtcbiAgfVxuXG4gIGFzeW5jIHJlbW92ZSAoYnVuZGxlaWQpIHtcbiAgICBjb25zdCBzZXJ2aWNlID0gYXdhaXQgc2VydmljZXMuc3RhcnRJbnN0YWxsYXRpb25Qcm94eVNlcnZpY2UodGhpcy51ZGlkKTtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgc2VydmljZS51bmluc3RhbGxBcHBsaWNhdGlvbihidW5kbGVpZCk7XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHNlcnZpY2UuY2xvc2UoKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyByZW1vdmVBcHAgKGJ1bmRsZUlkKSB7XG4gICAgYXdhaXQgdGhpcy5yZW1vdmUoYnVuZGxlSWQpO1xuICB9XG5cbiAgYXN5bmMgaW5zdGFsbCAoYXBwLCB0aW1lb3V0KSB7XG4gICAgY29uc3QgdGltZXIgPSBuZXcgdGltaW5nLlRpbWVyKCkuc3RhcnQoKTtcbiAgICB0cnkge1xuICAgICAgY29uc3QgYnVuZGxlUGF0aE9uUGhvbmUgPSBhd2FpdCB0aGlzLnB1c2hBcHBCdW5kbGUoYXBwLCB0aW1lb3V0KTtcbiAgICAgIGF3YWl0IHRoaXMuaW5zdGFsbEFwcGxpY2F0aW9uKGJ1bmRsZVBhdGhPblBob25lKTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGxvZy53YXJuKGBFcnJvciBpbnN0YWxsaW5nIGFwcDogJHtlcnIubWVzc2FnZX1gKTtcbiAgICAgIGxvZy53YXJuKGBGYWxsaW5nIGJhY2sgdG8gJyR7SU9TX0RFUExPWX0nIHVzYWdlYCk7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBmcy53aGljaChJT1NfREVQTE9ZKTtcbiAgICAgIH0gY2F0Y2ggKGVycjEpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBDb3VsZCBub3QgaW5zdGFsbCAnJHthcHB9JzpcXG5gICtcbiAgICAgICAgICBgICAtICR7ZXJyLm1lc3NhZ2V9XFxuYCArXG4gICAgICAgICAgYCAgLSAnJHtJT1NfREVQTE9ZfScgdXRpbGl0eSBoYXMgbm90IGJlZW4gZm91bmQgaW4gUEFUSC4gSXMgaXQgaW5zdGFsbGVkP2ApO1xuICAgICAgfVxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgZXhlYyhJT1NfREVQTE9ZLCBbXG4gICAgICAgICAgJy0taWQnLCB0aGlzLnVkaWQsXG4gICAgICAgICAgJy0tYnVuZGxlJywgYXBwLFxuICAgICAgICBdKTtcbiAgICAgIH0gY2F0Y2ggKGVycjEpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBDb3VsZCBub3QgaW5zdGFsbCAnJHthcHB9JzpcXG5gICtcbiAgICAgICAgICBgICAtICR7ZXJyLm1lc3NhZ2V9XFxuYCArXG4gICAgICAgICAgYCAgLSAke2VycjEuc3RkZXJyIHx8IGVycjEuc3Rkb3V0IHx8IGVycjEubWVzc2FnZX1gKTtcbiAgICAgIH1cbiAgICB9XG4gICAgbG9nLmluZm8oYEFwcCBpbnN0YWxsYXRpb24gc3VjY2VlZGVkIGFmdGVyICR7dGltZXIuZ2V0RHVyYXRpb24oKS5hc01pbGxpU2Vjb25kcy50b0ZpeGVkKDApfW1zYCk7XG4gIH1cblxuICBhc3luYyBpbnN0YWxsQXBwbGljYXRpb24gKGJ1bmRsZVBhdGhPblBob25lKSB7XG4gICAgY29uc3Qgbm90aWZpY2F0aW9uU2VydmljZSA9IGF3YWl0IHNlcnZpY2VzLnN0YXJ0Tm90aWZpY2F0aW9uUHJveHlTZXJ2aWNlKHRoaXMudWRpZCk7XG4gICAgY29uc3QgaW5zdGFsbGF0aW9uU2VydmljZSA9IGF3YWl0IHNlcnZpY2VzLnN0YXJ0SW5zdGFsbGF0aW9uUHJveHlTZXJ2aWNlKHRoaXMudWRpZCk7XG4gICAgY29uc3QgYXBwSW5zdGFsbGVkTm90aWZpY2F0aW9uID0gbmV3IEIoKHJlc29sdmUpID0+IHtcbiAgICAgIG5vdGlmaWNhdGlvblNlcnZpY2Uub2JzZXJ2ZU5vdGlmaWNhdGlvbihBUFBMSUNBVElPTl9JTlNUQUxMRURfTk9USUZJQ0FUSU9OLCB7bm90aWZpY2F0aW9uOiByZXNvbHZlfSk7XG4gICAgfSk7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGluc3RhbGxhdGlvblNlcnZpY2UuaW5zdGFsbEFwcGxpY2F0aW9uKGJ1bmRsZVBhdGhPblBob25lLCB7UGFja2FnZVR5cGU6ICdEZXZlbG9wZXInfSk7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBhcHBJbnN0YWxsZWROb3RpZmljYXRpb24udGltZW91dChBUFBMSUNBVElPTl9OT1RJRklDQVRJT05fVElNRU9VVCwgYENvdWxkIG5vdCBnZXQgdGhlIGFwcGxpY2F0aW9uIGluc3RhbGxlZCBub3RpZmljYXRpb24gd2l0aGluICR7QVBQTElDQVRJT05fTk9USUZJQ0FUSU9OX1RJTUVPVVR9bXMgYnV0IHdlIHdpbGwgY29udGludWVgKTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgbG9nLndhcm4oYEZhaWxlZCB0byByZWNlaXZlIHRoZSBub3RpZmljYXRpb24uIEVycm9yOiAke2UubWVzc2FnZX1gKTtcbiAgICAgIH1cbiAgICB9IGZpbmFsbHkge1xuICAgICAgaW5zdGFsbGF0aW9uU2VydmljZS5jbG9zZSgpO1xuICAgICAgbm90aWZpY2F0aW9uU2VydmljZS5jbG9zZSgpO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIHB1c2hBcHBCdW5kbGUgKGFwcCwgdGltZW91dCA9IERFRkFVTFRfSVRFTV9QVVNIX1RJTUVPVVQpIHtcbiAgICBjb25zdCB0aW1lciA9IG5ldyB0aW1pbmcuVGltZXIoKS5zdGFydCgpO1xuICAgIGNvbnN0IGFmY1NlcnZpY2UgPSBhd2FpdCBzZXJ2aWNlcy5zdGFydEFmY1NlcnZpY2UodGhpcy51ZGlkKTtcbiAgICAvLyBXZSBhcmUgcHVzaGluZyBzZXJpYWxseSBkdWUgdG8gdGhpcyBodHRwczovL2dpdGh1Yi5jb20vYXBwaXVtL2FwcGl1bS9pc3N1ZXMvMTMxMTUuIFRoZXJlIGlzIG5vdGhpbmcgZWxzZSB3ZSBjYW4gZG8gYmVzaWRlcyB0aGlzXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGJ1bmRsZVBhdGhPblBob25lID0gYXdhaXQgdGhpcy5jcmVhdGVBcHBQYXRoKGFmY1NlcnZpY2UsIGFwcCk7XG4gICAgICBhd2FpdCBmcy53YWxrRGlyKGFwcCwgdHJ1ZSwgYXN5bmMgKGl0ZW1QYXRoLCBpc0RpcikgPT4ge1xuICAgICAgICBjb25zdCBwYXRoT25QaG9uZSA9IHBhdGguam9pbihidW5kbGVQYXRoT25QaG9uZSwgcGF0aC5yZWxhdGl2ZShhcHAsIGl0ZW1QYXRoKSk7XG4gICAgICAgIGlmIChpc0Rpcikge1xuICAgICAgICAgIGF3YWl0IGFmY1NlcnZpY2UuY3JlYXRlRGlyZWN0b3J5KHBhdGhPblBob25lKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjb25zdCByZWFkU3RyZWFtID0gZnMuY3JlYXRlUmVhZFN0cmVhbShpdGVtUGF0aCwge2F1dG9DbG9zZTogdHJ1ZX0pO1xuICAgICAgICAgIGNvbnN0IHdyaXRlU3RyZWFtID0gYXdhaXQgYWZjU2VydmljZS5jcmVhdGVXcml0ZVN0cmVhbShwYXRoT25QaG9uZSwge2F1dG9EZXN0cm95OiB0cnVlfSk7XG4gICAgICAgICAgd3JpdGVTdHJlYW0ub24oJ2ZpbmlzaCcsIHdyaXRlU3RyZWFtLmRlc3Ryb3kpO1xuICAgICAgICAgIGxldCBwdXNoRXJyb3IgPSBudWxsO1xuICAgICAgICAgIGNvbnN0IGl0ZW1QdXNoV2FpdCA9IG5ldyBCKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgICAgIHdyaXRlU3RyZWFtLm9uKCdjbG9zZScsICgpID0+IHtcbiAgICAgICAgICAgICAgaWYgKHB1c2hFcnJvcikge1xuICAgICAgICAgICAgICAgIHJlamVjdChwdXNoRXJyb3IpO1xuICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHJlc29sdmUoKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBjb25zdCBvblN0cmVhbUVycm9yID0gKGUpID0+IHtcbiAgICAgICAgICAgICAgcmVhZFN0cmVhbS51bnBpcGUod3JpdGVTdHJlYW0pO1xuICAgICAgICAgICAgICBsb2cuZGVidWcoZSk7XG4gICAgICAgICAgICAgIHB1c2hFcnJvciA9IGU7XG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgd3JpdGVTdHJlYW0ub24oJ2Vycm9yJywgb25TdHJlYW1FcnJvcik7XG4gICAgICAgICAgICByZWFkU3RyZWFtLm9uKCdlcnJvcicsIG9uU3RyZWFtRXJyb3IpO1xuICAgICAgICAgIH0pO1xuICAgICAgICAgIHJlYWRTdHJlYW0ucGlwZSh3cml0ZVN0cmVhbSk7XG4gICAgICAgICAgYXdhaXQgaXRlbVB1c2hXYWl0LnRpbWVvdXQodGltZW91dCxcbiAgICAgICAgICAgIGBDb3VsZCBub3QgcHVzaCAnJHtpdGVtUGF0aH0nIHdpdGhpbiB0aGUgdGltZW91dCBvZiAke3RpbWVvdXR9bXMuIGAgK1xuICAgICAgICAgICAgYENvbnNpZGVyIGluY3JlYXNpbmcgdGhlIHZhbHVlIG9mICdhcHBQdXNoVGltZW91dCcgY2FwYWJpbGl0eS5gKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICBsb2cuZGVidWcoYFB1c2hlZCB0aGUgYXBwIGZpbGVzIHN1Y2Nlc3NmdWxseSBhZnRlciAke3RpbWVyLmdldER1cmF0aW9uKCkuYXNNaWxsaVNlY29uZHMudG9GaXhlZCgwKX1tc2ApO1xuICAgICAgcmV0dXJuIGJ1bmRsZVBhdGhPblBob25lO1xuICAgIH0gZmluYWxseSB7XG4gICAgICBhZmNTZXJ2aWNlLmNsb3NlKCk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgY3JlYXRlQXBwUGF0aCAoYWZjU2VydmljZSwgbG9jYWxBcHBQYXRoKSB7XG4gICAgY29uc3QgYmFzZW5hbWUgPSBwYXRoLmJhc2VuYW1lKGxvY2FsQXBwUGF0aCk7XG4gICAgY29uc3QgcmVsYXRpdmVQYXRoID0gcGF0aC5qb2luKElOU1RBTExBVElPTl9TVEFHSU5HX0RJUiwgYmFzZW5hbWUpO1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCBhZmNTZXJ2aWNlLmRlbGV0ZURpcmVjdG9yeShyZWxhdGl2ZVBhdGgpO1xuICAgIH0gY2F0Y2ggKGlnbikge31cbiAgICBhd2FpdCBhZmNTZXJ2aWNlLmNyZWF0ZURpcmVjdG9yeShyZWxhdGl2ZVBhdGgpO1xuICAgIHJldHVybiByZWxhdGl2ZVBhdGg7XG4gIH1cblxuICBhc3luYyBpbnN0YWxsQXBwIChhcHAsIHRpbWVvdXQpIHtcbiAgICBhd2FpdCB0aGlzLmluc3RhbGwoYXBwLCB0aW1lb3V0KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm4gYW4gYXBwbGljYXRpb24gb2JqZWN0IGlmIHRlc3QgYXBwIGhhcyAnYnVuZGxlaWQnLlxuICAgKiBUaGUgdGFyZ2V0IGJ1bmRsZWlkIGNhbiBiZSBVc2VyIGFuZCBTeXN0ZW0gYXBwcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGJ1bmRsZWlkIFRoZSBidW5kbGVJZCB0byBlbnN1cmUgaXQgaXMgaW5zdGFsbGVkXG4gICAqIEByZXR1cm4ge2Jvb2xlYW59IFJldHVybnMgVHJ1ZSBpZiB0aGUgYnVuZGxlaWQgZXhpc3RzIGluIHRoZSByZXN1bHQgb2YgJ2xpc3RBcHBsaWNhdGlvbnMnIGxpa2U6XG4gICAqIHsgXCJjb20uYXBwbGUuUHJlZmVyZW5jZXNcIjp7XG4gICAqICAgXCJVSVJlcXVpcmVkRGV2aWNlQ2FwYWJpbGl0aWVzXCI6W1wiYXJtNjRcIl0sXG4gICAqICAgXCJVSVJlcXVpcmVzRnVsbFNjcmVlblwiOnRydWUsXG4gICAqICAgXCJDRkJ1bmRsZUluZm9EaWN0aW9uYXJ5VmVyc2lvblwiOlwiNi4wXCIsXG4gICAqICAgXCJFbnRpdGxlbWVudHNcIjpcbiAgICogICAgIHtcImNvbS5hcHBsZS5mcm9udGJvYXJkLmRlbGV0ZS1hcHBsaWNhdGlvbi1zbmFwc2hvdHNcIjp0cnVlLC4uXG4gICAqL1xuICBhc3luYyBpc0FwcEluc3RhbGxlZCAoYnVuZGxlaWQpIHtcbiAgICBjb25zdCBzZXJ2aWNlID0gYXdhaXQgc2VydmljZXMuc3RhcnRJbnN0YWxsYXRpb25Qcm94eVNlcnZpY2UodGhpcy51ZGlkKTtcbiAgICB0cnkge1xuICAgICAgY29uc3QgYXBwbGljYXRpb25zID0gYXdhaXQgc2VydmljZS5sb29rdXBBcHBsaWNhdGlvbnMoeyBidW5kbGVJZHM6IGJ1bmRsZWlkIH0pO1xuICAgICAgcmV0dXJuICEhYXBwbGljYXRpb25zW2J1bmRsZWlkXTtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgc2VydmljZS5jbG9zZSgpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYnVuZGxlTmFtZSBUaGUgbmFtZSBvZiBDRkJ1bmRsZU5hbWUgaW4gSW5mby5wbGlzdFxuICAgKlxuICAgKiBAcmV0dXJucyB7QXJyYXk8c3RyaW5nPn0gQSBsaXN0IG9mIFVzZXIgbGV2ZWwgYXBwcycgYnVuZGxlIGlkcyB3aGljaCBoYXNcbiAgICogICAgICAgICAgICAgICAgICAgICAgICAgICdDRkJ1bmRsZU5hbWUnIGF0dHJpYnV0ZSBhcyAnYnVuZGxlTmFtZScuXG4gICAqL1xuICBhc3luYyBnZXRVc2VySW5zdGFsbGVkQnVuZGxlSWRzQnlCdW5kbGVOYW1lIChidW5kbGVOYW1lKSB7XG4gICAgY29uc3Qgc2VydmljZSA9IGF3YWl0IHNlcnZpY2VzLnN0YXJ0SW5zdGFsbGF0aW9uUHJveHlTZXJ2aWNlKHRoaXMudWRpZCk7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGFwcGxpY2F0aW9ucyA9IGF3YWl0IHNlcnZpY2UubGlzdEFwcGxpY2F0aW9ucyh7YXBwbGljYXRpb25UeXBlOiAnVXNlcid9KTtcbiAgICAgIHJldHVybiBfLnJlZHVjZShhcHBsaWNhdGlvbnMsIChhY2MsIHtDRkJ1bmRsZU5hbWV9LCBrZXkpID0+IHtcbiAgICAgICAgaWYgKENGQnVuZGxlTmFtZSA9PT0gYnVuZGxlTmFtZSkge1xuICAgICAgICAgIGFjYy5wdXNoKGtleSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGFjYztcbiAgICAgIH0sIFtdKTtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgc2VydmljZS5jbG9zZSgpO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGdldFBsYXRmb3JtVmVyc2lvbiAoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHV0aWxpdGllcy5nZXRPU1ZlcnNpb24odGhpcy51ZGlkKTtcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBJT1NEZXBsb3k7XG4iXSwiZmlsZSI6ImxpYi9pb3MtZGVwbG95LmpzIiwic291cmNlUm9vdCI6Ii4uLy4uIn0=
