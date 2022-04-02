"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault");

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.NO_SESSION_ID_COMMANDS = exports.METHOD_MAP = exports.ALL_COMMANDS = void 0;
exports.routeToCommandName = routeToCommandName;

require("source-map-support/register");

var _lodash = _interopRequireDefault(require("lodash"));

var _appiumSupport = require("appium-support");

var _constants = require("../constants");

const SET_ALERT_TEXT_PAYLOAD_PARAMS = {
  validate: jsonObj => !_appiumSupport.util.hasValue(jsonObj.value) && !_appiumSupport.util.hasValue(jsonObj.text) && 'either "text" or "value" must be set',
  optional: ['value', 'text'],
  makeArgs: jsonObj => [jsonObj.value || jsonObj.text]
};
const METHOD_MAP = {
  '/status': {
    GET: {
      command: 'getStatus'
    }
  },
  '/status-wda': {
    GET: {
      command: 'getStatusWDA'
    }
  },
  '/status-adb': {
    GET: {
      command: 'getStatusADB'
    }
  },
  '/session': {
    POST: {
      command: 'createSession',
      payloadParams: {
        validate: jsonObj => !jsonObj.capabilities && !jsonObj.desiredCapabilities && 'we require one of "desiredCapabilities" or "capabilities" object',
        optional: ['desiredCapabilities', 'requiredCapabilities', 'capabilities']
      }
    }
  },
  '/sessions': {
    GET: {
      command: 'getSessions'
    }
  },
  '/session/:sessionId': {
    GET: {
      command: 'getSession'
    },
    DELETE: {
      command: 'deleteSession'
    }
  },
  '/session/:sessionId/timeouts': {
    GET: {
      command: 'getTimeouts'
    },
    POST: {
      command: 'timeouts',
      payloadParams: {
        validate: (jsonObj, protocolName) => {
          if (protocolName === _constants.PROTOCOLS.W3C) {
            if (!_appiumSupport.util.hasValue(jsonObj.script) && !_appiumSupport.util.hasValue(jsonObj.pageLoad) && !_appiumSupport.util.hasValue(jsonObj.implicit)) {
              return 'W3C protocol expects any of script, pageLoad or implicit to be set';
            }
          } else {
            if (!_appiumSupport.util.hasValue(jsonObj.type) || !_appiumSupport.util.hasValue(jsonObj.ms)) {
              return 'MJSONWP protocol requires type and ms';
            }
          }
        },
        optional: ['type', 'ms', 'script', 'pageLoad', 'implicit']
      }
    }
  },
  '/session/:sessionId/timeouts/async_script': {
    POST: {
      command: 'asyncScriptTimeout',
      payloadParams: {
        required: ['ms']
      }
    }
  },
  '/session/:sessionId/timeouts/implicit_wait': {
    POST: {
      command: 'implicitWait',
      payloadParams: {
        required: ['ms']
      }
    }
  },
  '/session/:sessionId/window_handle': {
    GET: {
      command: 'getWindowHandle'
    }
  },
  '/session/:sessionId/window/handle': {
    GET: {
      command: 'getWindowHandle'
    }
  },
  '/session/:sessionId/window_handles': {
    GET: {
      command: 'getWindowHandles'
    }
  },
  '/session/:sessionId/window/handles': {
    GET: {
      command: 'getWindowHandles'
    }
  },
  '/session/:sessionId/url': {
    GET: {
      command: 'getUrl'
    },
    POST: {
      command: 'setUrl',
      payloadParams: {
        required: ['url']
      }
    }
  },
  '/session/:sessionId/forward': {
    POST: {
      command: 'forward'
    }
  },
  '/session/:sessionId/back': {
    POST: {
      command: 'back'
    }
  },
  '/session/:sessionId/refresh': {
    POST: {
      command: 'refresh'
    }
  },
  '/session/:sessionId/execute': {
    POST: {
      command: 'execute',
      payloadParams: {
        required: ['script', 'args']
      }
    }
  },
  '/session/:sessionId/execute_async': {
    POST: {
      command: 'executeAsync',
      payloadParams: {
        required: ['script', 'args']
      }
    }
  },
  '/session/:sessionId/screenshot': {
    GET: {
      command: 'getScreenshot'
    }
  },
  '/session/:sessionId/ime/available_engines': {
    GET: {
      command: 'availableIMEEngines'
    }
  },
  '/session/:sessionId/ime/active_engine': {
    GET: {
      command: 'getActiveIMEEngine'
    }
  },
  '/session/:sessionId/ime/activated': {
    GET: {
      command: 'isIMEActivated'
    }
  },
  '/session/:sessionId/ime/deactivate': {
    POST: {
      command: 'deactivateIMEEngine'
    }
  },
  '/session/:sessionId/ime/activate': {
    POST: {
      command: 'activateIMEEngine',
      payloadParams: {
        required: ['engine']
      }
    }
  },
  '/session/:sessionId/frame': {
    POST: {
      command: 'setFrame',
      payloadParams: {
        required: ['id']
      }
    }
  },
  '/session/:sessionId/frame/parent': {
    POST: {}
  },
  '/session/:sessionId/window': {
    GET: {
      command: 'getWindowHandle'
    },
    POST: {
      command: 'setWindow',
      payloadParams: {
        optional: ['name', 'handle'],
        makeArgs: jsonObj => {
          if (_appiumSupport.util.hasValue(jsonObj.handle) && !_appiumSupport.util.hasValue(jsonObj.name)) {
            return [jsonObj.handle, jsonObj.handle];
          }

          if (_appiumSupport.util.hasValue(jsonObj.name) && !_appiumSupport.util.hasValue(jsonObj.handle)) {
            return [jsonObj.name, jsonObj.name];
          }

          return [jsonObj.name, jsonObj.handle];
        },
        validate: jsonObj => !_appiumSupport.util.hasValue(jsonObj.name) && !_appiumSupport.util.hasValue(jsonObj.handle) && 'we require one of "name" or "handle" to be set'
      }
    },
    DELETE: {
      command: 'closeWindow'
    }
  },
  '/session/:sessionId/window/:windowhandle/size': {
    GET: {
      command: 'getWindowSize'
    },
    POST: {}
  },
  '/session/:sessionId/window/:windowhandle/position': {
    POST: {},
    GET: {}
  },
  '/session/:sessionId/window/:windowhandle/maximize': {
    POST: {
      command: 'maximizeWindow'
    }
  },
  '/session/:sessionId/cookie': {
    GET: {
      command: 'getCookies'
    },
    POST: {
      command: 'setCookie',
      payloadParams: {
        required: ['cookie']
      }
    },
    DELETE: {
      command: 'deleteCookies'
    }
  },
  '/session/:sessionId/cookie/:name': {
    GET: {
      command: 'getCookie'
    },
    DELETE: {
      command: 'deleteCookie'
    }
  },
  '/session/:sessionId/source': {
    GET: {
      command: 'getPageSource'
    }
  },
  '/session/:sessionId/title': {
    GET: {
      command: 'title'
    }
  },
  '/session/:sessionId/element': {
    POST: {
      command: 'findElement',
      payloadParams: {
        required: ['using', 'value']
      }
    }
  },
  '/session/:sessionId/elements': {
    POST: {
      command: 'findElements',
      payloadParams: {
        required: ['using', 'value']
      }
    }
  },
  '/session/:sessionId/element/active': {
    GET: {
      command: 'active'
    },
    POST: {
      command: 'active'
    }
  },
  '/session/:sessionId/element/:elementId': {
    GET: {}
  },
  '/session/:sessionId/element/:elementId/element': {
    POST: {
      command: 'findElementFromElement',
      payloadParams: {
        required: ['using', 'value']
      }
    }
  },
  '/session/:sessionId/element/:elementId/elements': {
    POST: {
      command: 'findElementsFromElement',
      payloadParams: {
        required: ['using', 'value']
      }
    }
  },
  '/session/:sessionId/element/:elementId/click': {
    POST: {
      command: 'click'
    }
  },
  '/session/:sessionId/element/:elementId/submit': {
    POST: {
      command: 'submit'
    }
  },
  '/session/:sessionId/element/:elementId/text': {
    GET: {
      command: 'getText'
    }
  },
  '/session/:sessionId/element/:elementId/value': {
    POST: {
      command: 'setValue',
      payloadParams: {
        validate: jsonObj => !_appiumSupport.util.hasValue(jsonObj.value) && !_appiumSupport.util.hasValue(jsonObj.text) && 'we require one of "text" or "value" params',
        optional: ['value', 'text'],
        makeArgs: jsonObj => [jsonObj.value || jsonObj.text]
      }
    }
  },
  '/session/:sessionId/keys': {
    POST: {
      command: 'keys',
      payloadParams: {
        required: ['value']
      }
    }
  },
  '/session/:sessionId/element/:elementId/name': {
    GET: {
      command: 'getName'
    }
  },
  '/session/:sessionId/element/:elementId/clear': {
    POST: {
      command: 'clear'
    }
  },
  '/session/:sessionId/element/:elementId/selected': {
    GET: {
      command: 'elementSelected'
    }
  },
  '/session/:sessionId/element/:elementId/enabled': {
    GET: {
      command: 'elementEnabled'
    }
  },
  '/session/:sessionId/element/:elementId/attribute/:name': {
    GET: {
      command: 'getAttribute'
    }
  },
  '/session/:sessionId/element/:elementId/equals/:otherId': {
    GET: {
      command: 'equalsElement'
    }
  },
  '/session/:sessionId/element/:elementId/displayed': {
    GET: {
      command: 'elementDisplayed'
    }
  },
  '/session/:sessionId/element/:elementId/location': {
    GET: {
      command: 'getLocation'
    }
  },
  '/session/:sessionId/element/:elementId/location_in_view': {
    GET: {
      command: 'getLocationInView'
    }
  },
  '/session/:sessionId/element/:elementId/size': {
    GET: {
      command: 'getSize'
    }
  },
  '/session/:sessionId/element/:elementId/css/:propertyName': {
    GET: {
      command: 'getCssProperty'
    }
  },
  '/session/:sessionId/orientation': {
    GET: {
      command: 'getOrientation'
    },
    POST: {
      command: 'setOrientation',
      payloadParams: {
        required: ['orientation']
      }
    }
  },
  '/session/:sessionId/rotation': {
    GET: {
      command: 'getRotation'
    },
    POST: {
      command: 'setRotation',
      payloadParams: {
        required: ['x', 'y', 'z']
      }
    }
  },
  '/session/:sessionId/moveto': {
    POST: {
      command: 'moveTo',
      payloadParams: {
        optional: ['element', 'xoffset', 'yoffset']
      }
    }
  },
  '/session/:sessionId/click': {
    POST: {
      command: 'clickCurrent',
      payloadParams: {
        optional: ['button']
      }
    }
  },
  '/session/:sessionId/buttondown': {
    POST: {
      command: 'buttonDown',
      payloadParams: {
        optional: ['button']
      }
    }
  },
  '/session/:sessionId/buttonup': {
    POST: {
      command: 'buttonUp',
      payloadParams: {
        optional: ['button']
      }
    }
  },
  '/session/:sessionId/doubleclick': {
    POST: {
      command: 'doubleClick'
    }
  },
  '/session/:sessionId/touch/click': {
    POST: {
      command: 'click',
      payloadParams: {
        required: ['element']
      }
    }
  },
  '/session/:sessionId/touch/down': {
    POST: {
      command: 'touchDown',
      payloadParams: {
        required: ['x', 'y']
      }
    }
  },
  '/session/:sessionId/touch/up': {
    POST: {
      command: 'touchUp',
      payloadParams: {
        required: ['x', 'y']
      }
    }
  },
  '/session/:sessionId/touch/move': {
    POST: {
      command: 'touchMove',
      payloadParams: {
        required: ['x', 'y']
      }
    }
  },
  '/session/:sessionId/touch/scroll': {
    POST: {}
  },
  '/session/:sessionId/touch/doubleclick': {
    POST: {}
  },
  '/session/:sessionId/actions': {
    POST: {
      command: 'performActions',
      payloadParams: {
        required: ['actions']
      }
    },
    DELETE: {
      command: 'releaseActions'
    }
  },
  '/session/:sessionId/touch/longclick': {
    POST: {
      command: 'touchLongClick',
      payloadParams: {
        required: ['elements']
      }
    }
  },
  '/session/:sessionId/touch/flick': {
    POST: {
      command: 'flick',
      payloadParams: {
        optional: ['element', 'xspeed', 'yspeed', 'xoffset', 'yoffset', 'speed']
      }
    }
  },
  '/session/:sessionId/location': {
    GET: {
      command: 'getGeoLocation'
    },
    POST: {
      command: 'setGeoLocation',
      payloadParams: {
        required: ['location']
      }
    }
  },
  '/session/:sessionId/local_storage': {
    GET: {},
    POST: {},
    DELETE: {}
  },
  '/session/:sessionId/local_storage/key/:key': {
    GET: {},
    DELETE: {}
  },
  '/session/:sessionId/local_storage/size': {
    GET: {}
  },
  '/session/:sessionId/session_storage': {
    GET: {},
    POST: {},
    DELETE: {}
  },
  '/session/:sessionId/session_storage/key/:key': {
    GET: {},
    DELETE: {}
  },
  '/session/:sessionId/session_storage/size': {
    GET: {}
  },
  '/session/:sessionId/se/log': {
    POST: {
      command: 'getLog',
      payloadParams: {
        required: ['type']
      }
    }
  },
  '/session/:sessionId/se/log/types': {
    GET: {
      command: 'getLogTypes'
    }
  },
  '/session/:sessionId/log': {
    POST: {
      command: 'getLog',
      payloadParams: {
        required: ['type']
      }
    }
  },
  '/session/:sessionId/log/types': {
    GET: {
      command: 'getLogTypes'
    }
  },
  '/session/:sessionId/application_cache/status': {
    GET: {}
  },
  '/session/:sessionId/context': {
    GET: {
      command: 'getCurrentContext'
    },
    POST: {
      command: 'setContext',
      payloadParams: {
        required: ['name']
      }
    }
  },
  '/session/:sessionId/contexts': {
    GET: {
      command: 'getContexts'
    }
  },
  '/session/:sessionId/element/:elementId/pageIndex': {
    GET: {
      command: 'getPageIndex'
    }
  },
  '/session/:sessionId/network_connection': {
    GET: {
      command: 'getNetworkConnection'
    },
    POST: {
      command: 'setNetworkConnection',
      payloadParams: {
        unwrap: 'parameters',
        required: ['type']
      }
    }
  },
  '/session/:sessionId/touch/perform': {
    POST: {
      command: 'performTouch',
      payloadParams: {
        wrap: 'actions',
        required: ['actions']
      }
    }
  },
  '/session/:sessionId/touch/multi/perform': {
    POST: {
      command: 'performMultiAction',
      payloadParams: {
        required: ['actions'],
        optional: ['elementId']
      }
    }
  },
  '/session/:sessionId/receive_async_response': {
    POST: {
      command: 'receiveAsyncResponse',
      payloadParams: {
        required: ['status', 'value']
      }
    }
  },
  '/session/:sessionId/appium/device/shake': {
    POST: {
      command: 'mobileShake'
    }
  },
  '/session/:sessionId/appium/device/system_time': {
    GET: {
      command: 'getDeviceTime',
      payloadParams: {
        optional: ['format']
      }
    },
    POST: {
      command: 'getDeviceTime',
      payloadParams: {
        optional: ['format']
      }
    }
  },
  '/session/:sessionId/appium/device/lock': {
    POST: {
      command: 'lock',
      payloadParams: {
        optional: ['seconds']
      }
    }
  },
  '/session/:sessionId/appium/device/unlock': {
    POST: {
      command: 'unlock'
    }
  },
  '/session/:sessionId/appium/device/is_locked': {
    POST: {
      command: 'isLocked'
    }
  },
  '/session/:sessionId/appium/start_recording_screen': {
    POST: {
      command: 'startRecordingScreen',
      payloadParams: {
        optional: ['options']
      }
    }
  },
  '/session/:sessionId/appium/stop_recording_screen': {
    POST: {
      command: 'stopRecordingScreen',
      payloadParams: {
        optional: ['options']
      }
    }
  },
  '/session/:sessionId/appium/performanceData/types': {
    POST: {
      command: 'getPerformanceDataTypes'
    }
  },
  '/session/:sessionId/appium/getPerformanceData': {
    POST: {
      command: 'getPerformanceData',
      payloadParams: {
        required: ['packageName', 'dataType'],
        optional: ['dataReadTimeout']
      }
    }
  },
  '/session/:sessionId/appium/device/press_keycode': {
    POST: {
      command: 'pressKeyCode',
      payloadParams: {
        required: ['keycode'],
        optional: ['metastate', 'flags']
      }
    }
  },
  '/session/:sessionId/appium/device/long_press_keycode': {
    POST: {
      command: 'longPressKeyCode',
      payloadParams: {
        required: ['keycode'],
        optional: ['metastate', 'flags']
      }
    }
  },
  '/session/:sessionId/appium/device/finger_print': {
    POST: {
      command: 'fingerprint',
      payloadParams: {
        required: ['fingerprintId']
      }
    }
  },
  '/session/:sessionId/appium/device/send_sms': {
    POST: {
      command: 'sendSMS',
      payloadParams: {
        required: ['phoneNumber', 'message']
      }
    }
  },
  '/session/:sessionId/appium/device/gsm_call': {
    POST: {
      command: 'gsmCall',
      payloadParams: {
        required: ['phoneNumber', 'action']
      }
    }
  },
  '/session/:sessionId/appium/device/gsm_signal': {
    POST: {
      command: 'gsmSignal',
      payloadParams: {
        validate: jsonObj => !_appiumSupport.util.hasValue(jsonObj.signalStrength) && !_appiumSupport.util.hasValue(jsonObj.signalStrengh) && 'we require one of "signalStrength" or "signalStrengh" params',
        optional: ['signalStrength', 'signalStrengh'],
        makeArgs: jsonObj => [_appiumSupport.util.hasValue(jsonObj.signalStrength) ? jsonObj.signalStrength : jsonObj.signalStrengh]
      }
    }
  },
  '/session/:sessionId/appium/device/gsm_voice': {
    POST: {
      command: 'gsmVoice',
      payloadParams: {
        required: ['state']
      }
    }
  },
  '/session/:sessionId/appium/device/power_capacity': {
    POST: {
      command: 'powerCapacity',
      payloadParams: {
        required: ['percent']
      }
    }
  },
  '/session/:sessionId/appium/device/power_ac': {
    POST: {
      command: 'powerAC',
      payloadParams: {
        required: ['state']
      }
    }
  },
  '/session/:sessionId/appium/device/network_speed': {
    POST: {
      command: 'networkSpeed',
      payloadParams: {
        required: ['netspeed']
      }
    }
  },
  '/session/:sessionId/appium/device/keyevent': {
    POST: {
      command: 'keyevent',
      payloadParams: {
        required: ['keycode'],
        optional: ['metastate']
      }
    }
  },
  '/session/:sessionId/appium/device/rotate': {
    POST: {
      command: 'mobileRotation',
      payloadParams: {
        required: ['x', 'y', 'radius', 'rotation', 'touchCount', 'duration'],
        optional: ['element']
      }
    }
  },
  '/session/:sessionId/appium/device/current_activity': {
    GET: {
      command: 'getCurrentActivity'
    }
  },
  '/session/:sessionId/appium/device/current_package': {
    GET: {
      command: 'getCurrentPackage'
    }
  },
  '/session/:sessionId/appium/device/install_app': {
    POST: {
      command: 'installApp',
      payloadParams: {
        required: ['appPath'],
        optional: ['options']
      }
    }
  },
  '/session/:sessionId/appium/device/activate_app': {
    POST: {
      command: 'activateApp',
      payloadParams: {
        required: [['appId'], ['bundleId']],
        optional: ['options']
      }
    }
  },
  '/session/:sessionId/appium/device/remove_app': {
    POST: {
      command: 'removeApp',
      payloadParams: {
        required: [['appId'], ['bundleId']],
        optional: ['options']
      }
    }
  },
  '/session/:sessionId/appium/device/terminate_app': {
    POST: {
      command: 'terminateApp',
      payloadParams: {
        required: [['appId'], ['bundleId']],
        optional: ['options']
      }
    }
  },
  '/session/:sessionId/appium/device/app_installed': {
    POST: {
      command: 'isAppInstalled',
      payloadParams: {
        required: [['appId'], ['bundleId']]
      }
    }
  },
  '/session/:sessionId/appium/device/app_state': {
    GET: {
      command: 'queryAppState',
      payloadParams: {
        required: [['appId'], ['bundleId']]
      }
    },
    POST: {
      command: 'queryAppState',
      payloadParams: {
        required: [['appId'], ['bundleId']]
      }
    }
  },
  '/session/:sessionId/appium/device/hide_keyboard': {
    POST: {
      command: 'hideKeyboard',
      payloadParams: {
        optional: ['strategy', 'key', 'keyCode', 'keyName']
      }
    }
  },
  '/session/:sessionId/appium/device/is_keyboard_shown': {
    GET: {
      command: 'isKeyboardShown'
    }
  },
  '/session/:sessionId/appium/device/push_file': {
    POST: {
      command: 'pushFile',
      payloadParams: {
        required: ['path', 'data']
      }
    }
  },
  '/session/:sessionId/appium/device/pull_file': {
    POST: {
      command: 'pullFile',
      payloadParams: {
        required: ['path']
      }
    }
  },
  '/session/:sessionId/appium/device/pull_folder': {
    POST: {
      command: 'pullFolder',
      payloadParams: {
        required: ['path']
      }
    }
  },
  '/session/:sessionId/appium/device/toggle_airplane_mode': {
    POST: {
      command: 'toggleFlightMode'
    }
  },
  '/session/:sessionId/appium/device/toggle_data': {
    POST: {
      command: 'toggleData'
    }
  },
  '/session/:sessionId/appium/device/toggle_wifi': {
    POST: {
      command: 'toggleWiFi'
    }
  },
  '/session/:sessionId/appium/device/toggle_location_services': {
    POST: {
      command: 'toggleLocationServices'
    }
  },
  '/session/:sessionId/appium/device/open_notifications': {
    POST: {
      command: 'openNotifications'
    }
  },
  '/session/:sessionId/appium/device/start_activity': {
    POST: {
      command: 'startActivity',
      payloadParams: {
        required: ['appPackage', 'appActivity'],
        optional: ['appWaitPackage', 'appWaitActivity', 'intentAction', 'intentCategory', 'intentFlags', 'optionalIntentArguments', 'dontStopAppOnReset']
      }
    }
  },
  '/session/:sessionId/appium/device/system_bars': {
    GET: {
      command: 'getSystemBars'
    }
  },
  '/session/:sessionId/appium/device/display_density': {
    GET: {
      command: 'getDisplayDensity'
    }
  },
  '/session/:sessionId/appium/simulator/touch_id': {
    POST: {
      command: 'touchId',
      payloadParams: {
        required: ['match']
      }
    }
  },
  '/session/:sessionId/appium/simulator/toggle_touch_id_enrollment': {
    POST: {
      command: 'toggleEnrollTouchId',
      payloadParams: {
        optional: ['enabled']
      }
    }
  },
  '/session/:sessionId/appium/app/launch': {
    POST: {
      command: 'launchApp'
    }
  },
  '/session/:sessionId/appium/app/close': {
    POST: {
      command: 'closeApp'
    }
  },
  '/session/:sessionId/appium/app/reset': {
    POST: {
      command: 'reset'
    }
  },
  '/session/:sessionId/appium/app/background': {
    POST: {
      command: 'background',
      payloadParams: {
        required: ['seconds']
      }
    }
  },
  '/session/:sessionId/appium/app/end_test_coverage': {
    POST: {
      command: 'endCoverage',
      payloadParams: {
        required: ['intent', 'path']
      }
    }
  },
  '/session/:sessionId/appium/app/strings': {
    POST: {
      command: 'getStrings',
      payloadParams: {
        optional: ['language', 'stringFile']
      }
    }
  },
  '/session/:sessionId/appium/element/:elementId/value': {
    POST: {
      command: 'setValueImmediate',
      payloadParams: {
        validate: jsonObj => !_appiumSupport.util.hasValue(jsonObj.value) && !_appiumSupport.util.hasValue(jsonObj.text) && 'we require one of "text" or "value" params',
        optional: ['value', 'text'],
        makeArgs: jsonObj => [jsonObj.value || jsonObj.text]
      }
    }
  },
  '/session/:sessionId/appium/element/:elementId/replace_value': {
    POST: {
      command: 'replaceValue',
      payloadParams: {
        validate: jsonObj => !_appiumSupport.util.hasValue(jsonObj.value) && !_appiumSupport.util.hasValue(jsonObj.text) && 'we require one of "text" or "value" params',
        optional: ['value', 'text'],
        makeArgs: jsonObj => {
          var _ref, _jsonObj$value;

          return [(_ref = (_jsonObj$value = jsonObj.value) !== null && _jsonObj$value !== void 0 ? _jsonObj$value : jsonObj.text) !== null && _ref !== void 0 ? _ref : ''];
        }
      }
    }
  },
  '/session/:sessionId/appium/settings': {
    POST: {
      command: 'updateSettings',
      payloadParams: {
        required: ['settings']
      }
    },
    GET: {
      command: 'getSettings'
    }
  },
  '/session/:sessionId/appium/receive_async_response': {
    POST: {
      command: 'receiveAsyncResponse',
      payloadParams: {
        required: ['response']
      }
    }
  },
  '/session/:sessionId/appium/execute_driver': {
    POST: {
      command: 'executeDriverScript',
      payloadParams: {
        required: ['script'],
        optional: ['type', 'timeout']
      }
    }
  },
  '/session/:sessionId/appium/events': {
    POST: {
      command: 'getLogEvents',
      payloadParams: {
        optional: ['type']
      }
    }
  },
  '/session/:sessionId/appium/log_event': {
    POST: {
      command: 'logCustomEvent',
      payloadParams: {
        required: ['vendor', 'event']
      }
    }
  },
  '/session/:sessionId/alert_text': {
    GET: {
      command: 'getAlertText'
    },
    POST: {
      command: 'setAlertText',
      payloadParams: SET_ALERT_TEXT_PAYLOAD_PARAMS
    }
  },
  '/session/:sessionId/accept_alert': {
    POST: {
      command: 'postAcceptAlert'
    }
  },
  '/session/:sessionId/dismiss_alert': {
    POST: {
      command: 'postDismissAlert'
    }
  },
  '/session/:sessionId/alert/text': {
    GET: {
      command: 'getAlertText'
    },
    POST: {
      command: 'setAlertText',
      payloadParams: SET_ALERT_TEXT_PAYLOAD_PARAMS
    }
  },
  '/session/:sessionId/alert/accept': {
    POST: {
      command: 'postAcceptAlert'
    }
  },
  '/session/:sessionId/alert/dismiss': {
    POST: {
      command: 'postDismissAlert'
    }
  },
  '/session/:sessionId/element/:elementId/rect': {
    GET: {
      command: 'getElementRect'
    }
  },
  '/session/:sessionId/execute/sync': {
    POST: {
      command: 'execute',
      payloadParams: {
        required: ['script', 'args']
      }
    }
  },
  '/session/:sessionId/execute/async': {
    POST: {
      command: 'executeAsync',
      payloadParams: {
        required: ['script', 'args']
      }
    }
  },
  '/session/:sessionId/screenshot/:elementId': {
    GET: {
      command: 'getElementScreenshot'
    }
  },
  '/session/:sessionId/element/:elementId/screenshot': {
    GET: {
      command: 'getElementScreenshot'
    }
  },
  '/session/:sessionId/window/rect': {
    GET: {
      command: 'getWindowRect'
    },
    POST: {
      command: 'setWindowRect'
    }
  },
  '/session/:sessionId/window/maximize': {
    POST: {
      command: 'maximizeWindow'
    }
  },
  '/session/:sessionId/window/minimize': {
    POST: {
      command: 'minimizeWindow'
    }
  },
  '/session/:sessionId/window/fullscreen': {
    POST: {
      command: 'fullScreenWindow'
    }
  },
  '/session/:sessionId/element/:elementId/property/:name': {
    GET: {
      command: 'getProperty'
    }
  },
  '/session/:sessionId/appium/device/set_clipboard': {
    POST: {
      command: 'setClipboard',
      payloadParams: {
        required: ['content'],
        optional: ['contentType', 'label']
      }
    }
  },
  '/session/:sessionId/appium/device/get_clipboard': {
    POST: {
      command: 'getClipboard',
      payloadParams: {
        optional: ['contentType']
      }
    }
  },
  '/session/:sessionId/appium/compare_images': {
    POST: {
      command: 'compareImages',
      payloadParams: {
        required: ['mode', 'firstImage', 'secondImage'],
        optional: ['options']
      }
    }
  },
  '/session/:sessionId/:vendor/cdp/execute': {
    POST: {
      command: 'executeCdp',
      payloadParams: {
        required: ['cmd', 'params']
      }
    }
  },
  '/session/:sessionId/webauthn/authenticator': {
    POST: {
      command: 'addVirtualAuthenticator',
      payloadParams: {
        required: ['protocol', 'transport'],
        optional: ['hasResidentKey', 'hasUserVerification', 'isUserConsenting', 'isUserVerified']
      }
    }
  },
  '/session/:sessionId/webauthn/authenticator/:authenticatorId': {
    DELETE: {
      command: 'removeVirtualAuthenticator'
    }
  },
  '/session/:sessionId/webauthn/authenticator/:authenticatorId/credential': {
    POST: {
      command: 'addAuthCredential',
      payloadParams: {
        required: ['credentialId', 'isResidentCredential', 'rpId', 'privateKey'],
        optional: ['userHandle', 'signCount']
      }
    }
  },
  '/session/:sessionId/webauthn/authenticator/:authenticatorId/credentials': {
    GET: {
      command: 'getAuthCredential'
    },
    DELETE: {
      command: 'removeAllAuthCredentials'
    }
  },
  '/session/:sessionId/webauthn/authenticator/:authenticatorId/credentials/:credentialId': {
    DELETE: {
      command: 'removeAuthCredential'
    }
  },
  '/session/:sessionId/webauthn/authenticator/:authenticatorId/uv': {
    POST: {
      command: 'setUserAuthVerified',
      payloadParams: {
        required: ['isUserVerified']
      }
    }
  }
};
exports.METHOD_MAP = METHOD_MAP;
let ALL_COMMANDS = [];
exports.ALL_COMMANDS = ALL_COMMANDS;

for (let v of _lodash.default.values(METHOD_MAP)) {
  for (let m of _lodash.default.values(v)) {
    if (m.command) {
      ALL_COMMANDS.push(m.command);
    }
  }
}

const RE_ESCAPE = /[-[\]{}()+?.,\\^$|#\s]/g;
const RE_PARAM = /([:*])(\w+)/g;

class Route {
  constructor(route) {
    this.paramNames = [];
    let reStr = route.replace(RE_ESCAPE, '\\$&');
    reStr = reStr.replace(RE_PARAM, (_, mode, name) => {
      this.paramNames.push(name);
      return mode === ':' ? '([^/]*)' : '(.*)';
    });
    this.routeRegexp = new RegExp(`^${reStr}$`);
  }

  parse(url) {
    let matches = url.match(this.routeRegexp);
    if (!matches) return;
    let i = 0;
    let params = {};

    while (i < this.paramNames.length) {
      const paramName = this.paramNames[i++];
      params[paramName] = matches[i];
    }

    return params;
  }

}

function routeToCommandName(endpoint, method, basePath = _constants.DEFAULT_BASE_PATH) {
  let dstRoute = null;

  if (endpoint.includes('?')) {
    endpoint = endpoint.slice(0, endpoint.indexOf('?'));
  }

  const actualEndpoint = endpoint === '/' ? '' : _lodash.default.startsWith(endpoint, '/') ? endpoint : `/${endpoint}`;

  for (let currentRoute of _lodash.default.keys(METHOD_MAP)) {
    const route = new Route(`${basePath}${currentRoute}`);

    if (route.parse(`${basePath}/session/ignored-session-id${actualEndpoint}`) || route.parse(`${basePath}${actualEndpoint}`) || route.parse(actualEndpoint)) {
      dstRoute = currentRoute;
      break;
    }
  }

  if (!dstRoute) return;

  const methods = _lodash.default.get(METHOD_MAP, dstRoute);

  method = _lodash.default.toUpper(method);

  if (_lodash.default.has(methods, method)) {
    const dstMethod = _lodash.default.get(methods, method);

    if (dstMethod.command) {
      return dstMethod.command;
    }
  }
}

const NO_SESSION_ID_COMMANDS = ['createSession', 'getStatus', 'getStatusWDA', 'getStatusADB', 'getSessions'];
exports.NO_SESSION_ID_COMMANDS = NO_SESSION_ID_COMMANDS;require('source-map-support').install();


//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImxpYi9wcm90b2NvbC9yb3V0ZXMuanMiXSwibmFtZXMiOlsiU0VUX0FMRVJUX1RFWFRfUEFZTE9BRF9QQVJBTVMiLCJ2YWxpZGF0ZSIsImpzb25PYmoiLCJ1dGlsIiwiaGFzVmFsdWUiLCJ2YWx1ZSIsInRleHQiLCJvcHRpb25hbCIsIm1ha2VBcmdzIiwiTUVUSE9EX01BUCIsIkdFVCIsImNvbW1hbmQiLCJQT1NUIiwicGF5bG9hZFBhcmFtcyIsImNhcGFiaWxpdGllcyIsImRlc2lyZWRDYXBhYmlsaXRpZXMiLCJERUxFVEUiLCJwcm90b2NvbE5hbWUiLCJQUk9UT0NPTFMiLCJXM0MiLCJzY3JpcHQiLCJwYWdlTG9hZCIsImltcGxpY2l0IiwidHlwZSIsIm1zIiwicmVxdWlyZWQiLCJoYW5kbGUiLCJuYW1lIiwidW53cmFwIiwid3JhcCIsInNpZ25hbFN0cmVuZ3RoIiwic2lnbmFsU3RyZW5naCIsIkFMTF9DT01NQU5EUyIsInYiLCJfIiwidmFsdWVzIiwibSIsInB1c2giLCJSRV9FU0NBUEUiLCJSRV9QQVJBTSIsIlJvdXRlIiwiY29uc3RydWN0b3IiLCJyb3V0ZSIsInBhcmFtTmFtZXMiLCJyZVN0ciIsInJlcGxhY2UiLCJtb2RlIiwicm91dGVSZWdleHAiLCJSZWdFeHAiLCJwYXJzZSIsInVybCIsIm1hdGNoZXMiLCJtYXRjaCIsImkiLCJwYXJhbXMiLCJsZW5ndGgiLCJwYXJhbU5hbWUiLCJyb3V0ZVRvQ29tbWFuZE5hbWUiLCJlbmRwb2ludCIsIm1ldGhvZCIsImJhc2VQYXRoIiwiREVGQVVMVF9CQVNFX1BBVEgiLCJkc3RSb3V0ZSIsImluY2x1ZGVzIiwic2xpY2UiLCJpbmRleE9mIiwiYWN0dWFsRW5kcG9pbnQiLCJzdGFydHNXaXRoIiwiY3VycmVudFJvdXRlIiwia2V5cyIsIm1ldGhvZHMiLCJnZXQiLCJ0b1VwcGVyIiwiaGFzIiwiZHN0TWV0aG9kIiwiTk9fU0VTU0lPTl9JRF9DT01NQU5EUyJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7O0FB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QUMsZUFBRCxFQUFrQixXQUFsQixFQUErQixjQUEvQixFQUErQyxjQUEvQyxFQUErRCxhQUEvRCxDQUEvQiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBfIGZyb20gJ2xvZGFzaCc7XG5pbXBvcnQgeyB1dGlsIH0gZnJvbSAnYXBwaXVtLXN1cHBvcnQnO1xuaW1wb3J0IHsgUFJPVE9DT0xTLCBERUZBVUxUX0JBU0VfUEFUSCB9IGZyb20gJy4uL2NvbnN0YW50cyc7XG5cblxuY29uc3QgU0VUX0FMRVJUX1RFWFRfUEFZTE9BRF9QQVJBTVMgPSB7XG4gIHZhbGlkYXRlOiAoanNvbk9iaikgPT4gKCF1dGlsLmhhc1ZhbHVlKGpzb25PYmoudmFsdWUpICYmICF1dGlsLmhhc1ZhbHVlKGpzb25PYmoudGV4dCkpICYmXG4gICAgICAnZWl0aGVyIFwidGV4dFwiIG9yIFwidmFsdWVcIiBtdXN0IGJlIHNldCcsXG4gIG9wdGlvbmFsOiBbJ3ZhbHVlJywgJ3RleHQnXSxcbiAgLy8gUHJlZmVyICd2YWx1ZScgc2luY2UgaXQncyBtb3JlIGJhY2t3YXJkLWNvbXBhdGlibGUuXG4gIG1ha2VBcmdzOiAoanNvbk9iaikgPT4gW2pzb25PYmoudmFsdWUgfHwganNvbk9iai50ZXh0XSxcbn07XG5cbi8vIGRlZmluZSB0aGUgcm91dGVzLCBtYXBwaW5nIG9mIEhUVFAgbWV0aG9kcyB0byBwYXJ0aWN1bGFyIGRyaXZlciBjb21tYW5kcyxcbi8vIGFuZCBhbnkgcGFyYW1ldGVycyB0aGF0IGFyZSBleHBlY3RlZCBpbiBhIHJlcXVlc3Rcbi8vIHBhcmFtZXRlcnMgY2FuIGJlIGByZXF1aXJlZGAgb3IgYG9wdGlvbmFsYFxuY29uc3QgTUVUSE9EX01BUCA9IHtcbiAgJy9zdGF0dXMnOiB7XG4gICAgR0VUOiB7Y29tbWFuZDogJ2dldFN0YXR1cyd9XG4gIH0sXG4gICcvc3RhdHVzLXdkYSc6IHtcbiAgICBHRVQ6IHtjb21tYW5kOiAnZ2V0U3RhdHVzV0RBJ31cbiAgfSxcbiAgJy9zdGF0dXMtYWRiJzoge1xuICAgIEdFVDoge2NvbW1hbmQ6ICdnZXRTdGF0dXNBREInfVxuICB9LFxuICAnL3Nlc3Npb24nOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdjcmVhdGVTZXNzaW9uJywgcGF5bG9hZFBhcmFtczoge1xuICAgICAgdmFsaWRhdGU6IChqc29uT2JqKSA9PiAoIWpzb25PYmouY2FwYWJpbGl0aWVzICYmICFqc29uT2JqLmRlc2lyZWRDYXBhYmlsaXRpZXMpICYmICd3ZSByZXF1aXJlIG9uZSBvZiBcImRlc2lyZWRDYXBhYmlsaXRpZXNcIiBvciBcImNhcGFiaWxpdGllc1wiIG9iamVjdCcsXG4gICAgICBvcHRpb25hbDogWydkZXNpcmVkQ2FwYWJpbGl0aWVzJywgJ3JlcXVpcmVkQ2FwYWJpbGl0aWVzJywgJ2NhcGFiaWxpdGllcyddfX1cbiAgfSxcbiAgJy9zZXNzaW9ucyc6IHtcbiAgICBHRVQ6IHtjb21tYW5kOiAnZ2V0U2Vzc2lvbnMnfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZCc6IHtcbiAgICBHRVQ6IHtjb21tYW5kOiAnZ2V0U2Vzc2lvbid9LFxuICAgIERFTEVURToge2NvbW1hbmQ6ICdkZWxldGVTZXNzaW9uJ31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvdGltZW91dHMnOiB7XG4gICAgR0VUOiB7Y29tbWFuZDogJ2dldFRpbWVvdXRzJ30sIC8vIFczQyByb3V0ZVxuICAgIFBPU1Q6IHtjb21tYW5kOiAndGltZW91dHMnLCBwYXlsb2FkUGFyYW1zOiB7XG4gICAgICB2YWxpZGF0ZTogKGpzb25PYmosIHByb3RvY29sTmFtZSkgPT4ge1xuICAgICAgICBpZiAocHJvdG9jb2xOYW1lID09PSBQUk9UT0NPTFMuVzNDKSB7XG4gICAgICAgICAgaWYgKCF1dGlsLmhhc1ZhbHVlKGpzb25PYmouc2NyaXB0KSAmJiAhdXRpbC5oYXNWYWx1ZShqc29uT2JqLnBhZ2VMb2FkKSAmJiAhdXRpbC5oYXNWYWx1ZShqc29uT2JqLmltcGxpY2l0KSkge1xuICAgICAgICAgICAgcmV0dXJuICdXM0MgcHJvdG9jb2wgZXhwZWN0cyBhbnkgb2Ygc2NyaXB0LCBwYWdlTG9hZCBvciBpbXBsaWNpdCB0byBiZSBzZXQnO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBpZiAoIXV0aWwuaGFzVmFsdWUoanNvbk9iai50eXBlKSB8fCAhdXRpbC5oYXNWYWx1ZShqc29uT2JqLm1zKSkge1xuICAgICAgICAgICAgcmV0dXJuICdNSlNPTldQIHByb3RvY29sIHJlcXVpcmVzIHR5cGUgYW5kIG1zJztcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICBvcHRpb25hbDogWyd0eXBlJywgJ21zJywgJ3NjcmlwdCcsICdwYWdlTG9hZCcsICdpbXBsaWNpdCddLFxuICAgIH19XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL3RpbWVvdXRzL2FzeW5jX3NjcmlwdCc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ2FzeW5jU2NyaXB0VGltZW91dCcsIHBheWxvYWRQYXJhbXM6IHtyZXF1aXJlZDogWydtcyddfX1cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvdGltZW91dHMvaW1wbGljaXRfd2FpdCc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ2ltcGxpY2l0V2FpdCcsIHBheWxvYWRQYXJhbXM6IHtyZXF1aXJlZDogWydtcyddfX1cbiAgfSxcbiAgLy8gSlNPTldQXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL3dpbmRvd19oYW5kbGUnOiB7XG4gICAgR0VUOiB7Y29tbWFuZDogJ2dldFdpbmRvd0hhbmRsZSd9XG4gIH0sXG4gIC8vIFczQ1xuICAnL3Nlc3Npb24vOnNlc3Npb25JZC93aW5kb3cvaGFuZGxlJzoge1xuICAgIEdFVDoge2NvbW1hbmQ6ICdnZXRXaW5kb3dIYW5kbGUnfVxuICB9LFxuICAvLyBKU09OV1BcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvd2luZG93X2hhbmRsZXMnOiB7XG4gICAgR0VUOiB7Y29tbWFuZDogJ2dldFdpbmRvd0hhbmRsZXMnfVxuICB9LFxuICAvLyBXM0NcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvd2luZG93L2hhbmRsZXMnOiB7XG4gICAgR0VUOiB7Y29tbWFuZDogJ2dldFdpbmRvd0hhbmRsZXMnfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC91cmwnOiB7XG4gICAgR0VUOiB7Y29tbWFuZDogJ2dldFVybCd9LFxuICAgIFBPU1Q6IHtjb21tYW5kOiAnc2V0VXJsJywgcGF5bG9hZFBhcmFtczoge3JlcXVpcmVkOiBbJ3VybCddfX1cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvZm9yd2FyZCc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ2ZvcndhcmQnfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9iYWNrJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAnYmFjayd9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL3JlZnJlc2gnOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdyZWZyZXNoJ31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvZXhlY3V0ZSc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ2V4ZWN1dGUnLCBwYXlsb2FkUGFyYW1zOiB7cmVxdWlyZWQ6IFsnc2NyaXB0JywgJ2FyZ3MnXX19XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2V4ZWN1dGVfYXN5bmMnOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdleGVjdXRlQXN5bmMnLCBwYXlsb2FkUGFyYW1zOiB7cmVxdWlyZWQ6IFsnc2NyaXB0JywgJ2FyZ3MnXX19XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL3NjcmVlbnNob3QnOiB7XG4gICAgR0VUOiB7Y29tbWFuZDogJ2dldFNjcmVlbnNob3QnfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9pbWUvYXZhaWxhYmxlX2VuZ2luZXMnOiB7XG4gICAgR0VUOiB7Y29tbWFuZDogJ2F2YWlsYWJsZUlNRUVuZ2luZXMnfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9pbWUvYWN0aXZlX2VuZ2luZSc6IHtcbiAgICBHRVQ6IHtjb21tYW5kOiAnZ2V0QWN0aXZlSU1FRW5naW5lJ31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvaW1lL2FjdGl2YXRlZCc6IHtcbiAgICBHRVQ6IHtjb21tYW5kOiAnaXNJTUVBY3RpdmF0ZWQnfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9pbWUvZGVhY3RpdmF0ZSc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ2RlYWN0aXZhdGVJTUVFbmdpbmUnfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9pbWUvYWN0aXZhdGUnOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdhY3RpdmF0ZUlNRUVuZ2luZScsIHBheWxvYWRQYXJhbXM6IHtyZXF1aXJlZDogWydlbmdpbmUnXX19XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2ZyYW1lJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAnc2V0RnJhbWUnLCBwYXlsb2FkUGFyYW1zOiB7cmVxdWlyZWQ6IFsnaWQnXX19XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2ZyYW1lL3BhcmVudCc6IHtcbiAgICBQT1NUOiB7fVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC93aW5kb3cnOiB7XG4gICAgR0VUOiB7Y29tbWFuZDogJ2dldFdpbmRvd0hhbmRsZSd9LFxuICAgIFBPU1Q6IHtjb21tYW5kOiAnc2V0V2luZG93JywgcGF5bG9hZFBhcmFtczoge1xuICAgICAgb3B0aW9uYWw6IFsnbmFtZScsICdoYW5kbGUnXSxcbiAgICAgIC8vIFJldHVybiBib3RoIHZhbHVlcyB0byBtYXRjaCBXM0MgYW5kIEpTT05XUCBwcm90b2NvbHNcbiAgICAgIG1ha2VBcmdzOiAoanNvbk9iaikgPT4ge1xuICAgICAgICBpZiAodXRpbC5oYXNWYWx1ZShqc29uT2JqLmhhbmRsZSkgJiYgIXV0aWwuaGFzVmFsdWUoanNvbk9iai5uYW1lKSkge1xuICAgICAgICAgIHJldHVybiBbanNvbk9iai5oYW5kbGUsIGpzb25PYmouaGFuZGxlXTtcbiAgICAgICAgfVxuICAgICAgICBpZiAodXRpbC5oYXNWYWx1ZShqc29uT2JqLm5hbWUpICYmICF1dGlsLmhhc1ZhbHVlKGpzb25PYmouaGFuZGxlKSkge1xuICAgICAgICAgIHJldHVybiBbanNvbk9iai5uYW1lLCBqc29uT2JqLm5hbWVdO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBbanNvbk9iai5uYW1lLCBqc29uT2JqLmhhbmRsZV07XG4gICAgICB9LFxuICAgICAgdmFsaWRhdGU6IChqc29uT2JqKSA9PiAoIXV0aWwuaGFzVmFsdWUoanNvbk9iai5uYW1lKSAmJiAhdXRpbC5oYXNWYWx1ZShqc29uT2JqLmhhbmRsZSkpXG4gICAgICAgICYmICd3ZSByZXF1aXJlIG9uZSBvZiBcIm5hbWVcIiBvciBcImhhbmRsZVwiIHRvIGJlIHNldCcsXG4gICAgfX0sXG4gICAgREVMRVRFOiB7Y29tbWFuZDogJ2Nsb3NlV2luZG93J31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvd2luZG93Lzp3aW5kb3doYW5kbGUvc2l6ZSc6IHtcbiAgICBHRVQ6IHtjb21tYW5kOiAnZ2V0V2luZG93U2l6ZSd9LFxuICAgIFBPU1Q6IHt9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL3dpbmRvdy86d2luZG93aGFuZGxlL3Bvc2l0aW9uJzoge1xuICAgIFBPU1Q6IHt9LFxuICAgIEdFVDoge31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvd2luZG93Lzp3aW5kb3doYW5kbGUvbWF4aW1pemUnOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdtYXhpbWl6ZVdpbmRvdyd9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2Nvb2tpZSc6IHtcbiAgICBHRVQ6IHtjb21tYW5kOiAnZ2V0Q29va2llcyd9LFxuICAgIFBPU1Q6IHtjb21tYW5kOiAnc2V0Q29va2llJywgcGF5bG9hZFBhcmFtczoge3JlcXVpcmVkOiBbJ2Nvb2tpZSddfX0sXG4gICAgREVMRVRFOiB7Y29tbWFuZDogJ2RlbGV0ZUNvb2tpZXMnfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9jb29raWUvOm5hbWUnOiB7XG4gICAgR0VUOiB7Y29tbWFuZDogJ2dldENvb2tpZSd9LFxuICAgIERFTEVURToge2NvbW1hbmQ6ICdkZWxldGVDb29raWUnfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9zb3VyY2UnOiB7XG4gICAgR0VUOiB7Y29tbWFuZDogJ2dldFBhZ2VTb3VyY2UnfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC90aXRsZSc6IHtcbiAgICBHRVQ6IHtjb21tYW5kOiAndGl0bGUnfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9lbGVtZW50Jzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAnZmluZEVsZW1lbnQnLCBwYXlsb2FkUGFyYW1zOiB7cmVxdWlyZWQ6IFsndXNpbmcnLCAndmFsdWUnXX19XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2VsZW1lbnRzJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAnZmluZEVsZW1lbnRzJywgcGF5bG9hZFBhcmFtczoge3JlcXVpcmVkOiBbJ3VzaW5nJywgJ3ZhbHVlJ119fVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9lbGVtZW50L2FjdGl2ZSc6IHtcbiAgICBHRVQ6IHtjb21tYW5kOiAnYWN0aXZlJ30sIC8vIFczQzogaHR0cHM6Ly93M2MuZ2l0aHViLmlvL3dlYmRyaXZlci93ZWJkcml2ZXItc3BlYy5odG1sI2Rmbi1nZXQtYWN0aXZlLWVsZW1lbnRcbiAgICBQT1NUOiB7Y29tbWFuZDogJ2FjdGl2ZSd9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2VsZW1lbnQvOmVsZW1lbnRJZCc6IHtcbiAgICBHRVQ6IHt9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2VsZW1lbnQvOmVsZW1lbnRJZC9lbGVtZW50Jzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAnZmluZEVsZW1lbnRGcm9tRWxlbWVudCcsIHBheWxvYWRQYXJhbXM6IHtyZXF1aXJlZDogWyd1c2luZycsICd2YWx1ZSddfX1cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvZWxlbWVudC86ZWxlbWVudElkL2VsZW1lbnRzJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAnZmluZEVsZW1lbnRzRnJvbUVsZW1lbnQnLCBwYXlsb2FkUGFyYW1zOiB7cmVxdWlyZWQ6IFsndXNpbmcnLCAndmFsdWUnXX19XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2VsZW1lbnQvOmVsZW1lbnRJZC9jbGljayc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ2NsaWNrJ31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvZWxlbWVudC86ZWxlbWVudElkL3N1Ym1pdCc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ3N1Ym1pdCd9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2VsZW1lbnQvOmVsZW1lbnRJZC90ZXh0Jzoge1xuICAgIEdFVDoge2NvbW1hbmQ6ICdnZXRUZXh0J31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvZWxlbWVudC86ZWxlbWVudElkL3ZhbHVlJzoge1xuICAgIFBPU1Q6IHtcbiAgICAgIGNvbW1hbmQ6ICdzZXRWYWx1ZScsXG4gICAgICBwYXlsb2FkUGFyYW1zOiB7XG4gICAgICAgIHZhbGlkYXRlOiAoanNvbk9iaikgPT4gKCF1dGlsLmhhc1ZhbHVlKGpzb25PYmoudmFsdWUpICYmICF1dGlsLmhhc1ZhbHVlKGpzb25PYmoudGV4dCkpICYmXG4gICAgICAgICAgICAnd2UgcmVxdWlyZSBvbmUgb2YgXCJ0ZXh0XCIgb3IgXCJ2YWx1ZVwiIHBhcmFtcycsXG4gICAgICAgIG9wdGlvbmFsOiBbJ3ZhbHVlJywgJ3RleHQnXSxcbiAgICAgICAgLy8gb3ZlcnJpZGUgdGhlIGRlZmF1bHQgYXJndW1lbnQgY29uc3RydWN0b3IgYmVjYXVzZSBvZiB0aGUgc3BlY2lhbFxuICAgICAgICAvLyBsb2dpYyBoZXJlLiBCYXNpY2FsbHkgd2Ugd2FudCB0byBhY2NlcHQgZWl0aGVyIGEgdmFsdWUgKG9sZCBKU09OV1ApXG4gICAgICAgIC8vIG9yIGEgdGV4dCAobmV3IFczQykgcGFyYW1ldGVyLCBidXQgb25seSBzZW5kIG9uZSBvZiB0aGVtIHRvIHRoZVxuICAgICAgICAvLyBjb21tYW5kIChub3QgYm90aCkuIFByZWZlciAndmFsdWUnIHNpbmNlIGl0J3MgbW9yZVxuICAgICAgICAvLyBiYWNrd2FyZC1jb21wYXRpYmxlLlxuICAgICAgICBtYWtlQXJnczogKGpzb25PYmopID0+IFtqc29uT2JqLnZhbHVlIHx8IGpzb25PYmoudGV4dF0sXG4gICAgICB9XG4gICAgfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9rZXlzJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAna2V5cycsIHBheWxvYWRQYXJhbXM6IHtyZXF1aXJlZDogWyd2YWx1ZSddfX1cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvZWxlbWVudC86ZWxlbWVudElkL25hbWUnOiB7XG4gICAgR0VUOiB7Y29tbWFuZDogJ2dldE5hbWUnfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9lbGVtZW50LzplbGVtZW50SWQvY2xlYXInOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdjbGVhcid9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2VsZW1lbnQvOmVsZW1lbnRJZC9zZWxlY3RlZCc6IHtcbiAgICBHRVQ6IHtjb21tYW5kOiAnZWxlbWVudFNlbGVjdGVkJ31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvZWxlbWVudC86ZWxlbWVudElkL2VuYWJsZWQnOiB7XG4gICAgR0VUOiB7Y29tbWFuZDogJ2VsZW1lbnRFbmFibGVkJ31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvZWxlbWVudC86ZWxlbWVudElkL2F0dHJpYnV0ZS86bmFtZSc6IHtcbiAgICBHRVQ6IHtjb21tYW5kOiAnZ2V0QXR0cmlidXRlJ31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvZWxlbWVudC86ZWxlbWVudElkL2VxdWFscy86b3RoZXJJZCc6IHtcbiAgICBHRVQ6IHtjb21tYW5kOiAnZXF1YWxzRWxlbWVudCd9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2VsZW1lbnQvOmVsZW1lbnRJZC9kaXNwbGF5ZWQnOiB7XG4gICAgR0VUOiB7Y29tbWFuZDogJ2VsZW1lbnREaXNwbGF5ZWQnfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9lbGVtZW50LzplbGVtZW50SWQvbG9jYXRpb24nOiB7XG4gICAgR0VUOiB7Y29tbWFuZDogJ2dldExvY2F0aW9uJ31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvZWxlbWVudC86ZWxlbWVudElkL2xvY2F0aW9uX2luX3ZpZXcnOiB7XG4gICAgR0VUOiB7Y29tbWFuZDogJ2dldExvY2F0aW9uSW5WaWV3J31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvZWxlbWVudC86ZWxlbWVudElkL3NpemUnOiB7XG4gICAgR0VUOiB7Y29tbWFuZDogJ2dldFNpemUnfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9lbGVtZW50LzplbGVtZW50SWQvY3NzLzpwcm9wZXJ0eU5hbWUnOiB7XG4gICAgR0VUOiB7Y29tbWFuZDogJ2dldENzc1Byb3BlcnR5J31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvb3JpZW50YXRpb24nOiB7XG4gICAgR0VUOiB7Y29tbWFuZDogJ2dldE9yaWVudGF0aW9uJ30sXG4gICAgUE9TVDoge2NvbW1hbmQ6ICdzZXRPcmllbnRhdGlvbicsIHBheWxvYWRQYXJhbXM6IHtyZXF1aXJlZDogWydvcmllbnRhdGlvbiddfX1cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvcm90YXRpb24nOiB7XG4gICAgR0VUOiB7Y29tbWFuZDogJ2dldFJvdGF0aW9uJ30sXG4gICAgUE9TVDoge2NvbW1hbmQ6ICdzZXRSb3RhdGlvbicsIHBheWxvYWRQYXJhbXM6IHtyZXF1aXJlZDogWyd4JywgJ3knLCAneiddfX1cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvbW92ZXRvJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAnbW92ZVRvJywgcGF5bG9hZFBhcmFtczoge29wdGlvbmFsOiBbJ2VsZW1lbnQnLCAneG9mZnNldCcsICd5b2Zmc2V0J119fVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9jbGljayc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ2NsaWNrQ3VycmVudCcsIHBheWxvYWRQYXJhbXM6IHtvcHRpb25hbDogWydidXR0b24nXX19XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2J1dHRvbmRvd24nOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdidXR0b25Eb3duJywgcGF5bG9hZFBhcmFtczoge29wdGlvbmFsOiBbJ2J1dHRvbiddfX1cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYnV0dG9udXAnOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdidXR0b25VcCcsIHBheWxvYWRQYXJhbXM6IHtvcHRpb25hbDogWydidXR0b24nXX19XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2RvdWJsZWNsaWNrJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAnZG91YmxlQ2xpY2snfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC90b3VjaC9jbGljayc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ2NsaWNrJywgcGF5bG9hZFBhcmFtczoge3JlcXVpcmVkOiBbJ2VsZW1lbnQnXX19XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL3RvdWNoL2Rvd24nOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICd0b3VjaERvd24nLCBwYXlsb2FkUGFyYW1zOiB7cmVxdWlyZWQ6IFsneCcsICd5J119fVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC90b3VjaC91cCc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ3RvdWNoVXAnLCBwYXlsb2FkUGFyYW1zOiB7cmVxdWlyZWQ6IFsneCcsICd5J119fVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC90b3VjaC9tb3ZlJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAndG91Y2hNb3ZlJywgcGF5bG9hZFBhcmFtczoge3JlcXVpcmVkOiBbJ3gnLCAneSddfX1cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvdG91Y2gvc2Nyb2xsJzoge1xuICAgIFBPU1Q6IHt9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL3RvdWNoL2RvdWJsZWNsaWNrJzoge1xuICAgIFBPU1Q6IHt9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2FjdGlvbnMnOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdwZXJmb3JtQWN0aW9ucycsIHBheWxvYWRQYXJhbXM6IHtyZXF1aXJlZDogWydhY3Rpb25zJ119fSxcbiAgICBERUxFVEU6IHtjb21tYW5kOiAncmVsZWFzZUFjdGlvbnMnfSxcbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvdG91Y2gvbG9uZ2NsaWNrJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAndG91Y2hMb25nQ2xpY2snLCBwYXlsb2FkUGFyYW1zOiB7cmVxdWlyZWQ6IFsnZWxlbWVudHMnXX19XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL3RvdWNoL2ZsaWNrJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAnZmxpY2snLCBwYXlsb2FkUGFyYW1zOiB7b3B0aW9uYWw6IFsnZWxlbWVudCcsICd4c3BlZWQnLCAneXNwZWVkJywgJ3hvZmZzZXQnLCAneW9mZnNldCcsICdzcGVlZCddfX1cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvbG9jYXRpb24nOiB7XG4gICAgR0VUOiB7Y29tbWFuZDogJ2dldEdlb0xvY2F0aW9uJ30sXG4gICAgUE9TVDoge2NvbW1hbmQ6ICdzZXRHZW9Mb2NhdGlvbicsIHBheWxvYWRQYXJhbXM6IHtyZXF1aXJlZDogWydsb2NhdGlvbiddfX1cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvbG9jYWxfc3RvcmFnZSc6IHtcbiAgICBHRVQ6IHt9LFxuICAgIFBPU1Q6IHt9LFxuICAgIERFTEVURToge31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvbG9jYWxfc3RvcmFnZS9rZXkvOmtleSc6IHtcbiAgICBHRVQ6IHt9LFxuICAgIERFTEVURToge31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvbG9jYWxfc3RvcmFnZS9zaXplJzoge1xuICAgIEdFVDoge31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvc2Vzc2lvbl9zdG9yYWdlJzoge1xuICAgIEdFVDoge30sXG4gICAgUE9TVDoge30sXG4gICAgREVMRVRFOiB7fVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9zZXNzaW9uX3N0b3JhZ2Uva2V5LzprZXknOiB7XG4gICAgR0VUOiB7fSxcbiAgICBERUxFVEU6IHt9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL3Nlc3Npb25fc3RvcmFnZS9zaXplJzoge1xuICAgIEdFVDoge31cbiAgfSxcbiAgLy8gU2VsZW5pdW0gNCBjbGllbnRzXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL3NlL2xvZyc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ2dldExvZycsIHBheWxvYWRQYXJhbXM6IHtyZXF1aXJlZDogWyd0eXBlJ119fVxuICB9LFxuICAvLyBTZWxlbml1bSA0IGNsaWVudHNcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvc2UvbG9nL3R5cGVzJzoge1xuICAgIEdFVDoge2NvbW1hbmQ6ICdnZXRMb2dUeXBlcyd9XG4gIH0sXG4gIC8vIG1qc29ud2lyZSwgYXBwaXVtIGNsaWVudHNcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvbG9nJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAnZ2V0TG9nJywgcGF5bG9hZFBhcmFtczoge3JlcXVpcmVkOiBbJ3R5cGUnXX19XG4gIH0sXG4gIC8vIG1qc29ud2lyZSwgYXBwaXVtIGNsaWVudHNcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvbG9nL3R5cGVzJzoge1xuICAgIEdFVDoge2NvbW1hbmQ6ICdnZXRMb2dUeXBlcyd9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2FwcGxpY2F0aW9uX2NhY2hlL3N0YXR1cyc6IHtcbiAgICBHRVQ6IHt9XG4gIH0sXG5cbiAgLy9cbiAgLy8gbWpzb253aXJlXG4gIC8vXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2NvbnRleHQnOiB7XG4gICAgR0VUOiB7Y29tbWFuZDogJ2dldEN1cnJlbnRDb250ZXh0J30sXG4gICAgUE9TVDoge2NvbW1hbmQ6ICdzZXRDb250ZXh0JywgcGF5bG9hZFBhcmFtczoge3JlcXVpcmVkOiBbJ25hbWUnXX19XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2NvbnRleHRzJzoge1xuICAgIEdFVDoge2NvbW1hbmQ6ICdnZXRDb250ZXh0cyd9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2VsZW1lbnQvOmVsZW1lbnRJZC9wYWdlSW5kZXgnOiB7XG4gICAgR0VUOiB7Y29tbWFuZDogJ2dldFBhZ2VJbmRleCd9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL25ldHdvcmtfY29ubmVjdGlvbic6IHtcbiAgICBHRVQ6IHtjb21tYW5kOiAnZ2V0TmV0d29ya0Nvbm5lY3Rpb24nfSxcbiAgICBQT1NUOiB7Y29tbWFuZDogJ3NldE5ldHdvcmtDb25uZWN0aW9uJywgcGF5bG9hZFBhcmFtczoge3Vud3JhcDogJ3BhcmFtZXRlcnMnLCByZXF1aXJlZDogWyd0eXBlJ119fVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC90b3VjaC9wZXJmb3JtJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAncGVyZm9ybVRvdWNoJywgcGF5bG9hZFBhcmFtczoge3dyYXA6ICdhY3Rpb25zJywgcmVxdWlyZWQ6IFsnYWN0aW9ucyddfX1cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvdG91Y2gvbXVsdGkvcGVyZm9ybSc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ3BlcmZvcm1NdWx0aUFjdGlvbicsIHBheWxvYWRQYXJhbXM6IHtyZXF1aXJlZDogWydhY3Rpb25zJ10sIG9wdGlvbmFsOiBbJ2VsZW1lbnRJZCddfX1cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvcmVjZWl2ZV9hc3luY19yZXNwb25zZSc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ3JlY2VpdmVBc3luY1Jlc3BvbnNlJywgcGF5bG9hZFBhcmFtczoge3JlcXVpcmVkOiBbJ3N0YXR1cycsICd2YWx1ZSddfX1cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYXBwaXVtL2RldmljZS9zaGFrZSc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ21vYmlsZVNoYWtlJ31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYXBwaXVtL2RldmljZS9zeXN0ZW1fdGltZSc6IHtcbiAgICBHRVQ6IHtjb21tYW5kOiAnZ2V0RGV2aWNlVGltZScsIHBheWxvYWRQYXJhbXM6IHtvcHRpb25hbDogWydmb3JtYXQnXX19LFxuICAgIFBPU1Q6IHtjb21tYW5kOiAnZ2V0RGV2aWNlVGltZScsIHBheWxvYWRQYXJhbXM6IHtvcHRpb25hbDogWydmb3JtYXQnXX19XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2FwcGl1bS9kZXZpY2UvbG9jayc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ2xvY2snLCBwYXlsb2FkUGFyYW1zOiB7b3B0aW9uYWw6IFsnc2Vjb25kcyddfX1cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYXBwaXVtL2RldmljZS91bmxvY2snOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICd1bmxvY2snfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9hcHBpdW0vZGV2aWNlL2lzX2xvY2tlZCc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ2lzTG9ja2VkJ31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYXBwaXVtL3N0YXJ0X3JlY29yZGluZ19zY3JlZW4nOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdzdGFydFJlY29yZGluZ1NjcmVlbicsIHBheWxvYWRQYXJhbXM6IHtvcHRpb25hbDogWydvcHRpb25zJ119fVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9hcHBpdW0vc3RvcF9yZWNvcmRpbmdfc2NyZWVuJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAnc3RvcFJlY29yZGluZ1NjcmVlbicsIHBheWxvYWRQYXJhbXM6IHtvcHRpb25hbDogWydvcHRpb25zJ119fVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9hcHBpdW0vcGVyZm9ybWFuY2VEYXRhL3R5cGVzJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAnZ2V0UGVyZm9ybWFuY2VEYXRhVHlwZXMnfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9hcHBpdW0vZ2V0UGVyZm9ybWFuY2VEYXRhJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAnZ2V0UGVyZm9ybWFuY2VEYXRhJywgcGF5bG9hZFBhcmFtczoge3JlcXVpcmVkOiBbJ3BhY2thZ2VOYW1lJywgJ2RhdGFUeXBlJ10sIG9wdGlvbmFsOiBbJ2RhdGFSZWFkVGltZW91dCddfX1cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYXBwaXVtL2RldmljZS9wcmVzc19rZXljb2RlJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAncHJlc3NLZXlDb2RlJywgcGF5bG9hZFBhcmFtczoge3JlcXVpcmVkOiBbJ2tleWNvZGUnXSwgb3B0aW9uYWw6IFsnbWV0YXN0YXRlJywgJ2ZsYWdzJ119fVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9hcHBpdW0vZGV2aWNlL2xvbmdfcHJlc3Nfa2V5Y29kZSc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ2xvbmdQcmVzc0tleUNvZGUnLCBwYXlsb2FkUGFyYW1zOiB7cmVxdWlyZWQ6IFsna2V5Y29kZSddLCBvcHRpb25hbDogWydtZXRhc3RhdGUnLCAnZmxhZ3MnXX19XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2FwcGl1bS9kZXZpY2UvZmluZ2VyX3ByaW50Jzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAnZmluZ2VycHJpbnQnLCBwYXlsb2FkUGFyYW1zOiB7cmVxdWlyZWQ6IFsnZmluZ2VycHJpbnRJZCddfX1cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYXBwaXVtL2RldmljZS9zZW5kX3Ntcyc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ3NlbmRTTVMnLCBwYXlsb2FkUGFyYW1zOiB7cmVxdWlyZWQ6IFsncGhvbmVOdW1iZXInLCAnbWVzc2FnZSddfX1cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYXBwaXVtL2RldmljZS9nc21fY2FsbCc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ2dzbUNhbGwnLCBwYXlsb2FkUGFyYW1zOiB7cmVxdWlyZWQ6IFsncGhvbmVOdW1iZXInLCAnYWN0aW9uJ119fVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9hcHBpdW0vZGV2aWNlL2dzbV9zaWduYWwnOiB7XG4gICAgUE9TVDoge1xuICAgICAgY29tbWFuZDogJ2dzbVNpZ25hbCcsXG4gICAgICBwYXlsb2FkUGFyYW1zOiB7XG4gICAgICAgIHZhbGlkYXRlOiAoanNvbk9iaikgPT4gKCF1dGlsLmhhc1ZhbHVlKGpzb25PYmouc2lnbmFsU3RyZW5ndGgpICYmICF1dGlsLmhhc1ZhbHVlKGpzb25PYmouc2lnbmFsU3RyZW5naCkpICYmXG4gICAgICAgICAgICAnd2UgcmVxdWlyZSBvbmUgb2YgXCJzaWduYWxTdHJlbmd0aFwiIG9yIFwic2lnbmFsU3RyZW5naFwiIHBhcmFtcycsXG4gICAgICAgIG9wdGlvbmFsOiBbJ3NpZ25hbFN0cmVuZ3RoJywgJ3NpZ25hbFN0cmVuZ2gnXSxcbiAgICAgICAgLy8gYmFja3dhcmQtY29tcGF0aWJsZS4gc29uT2JqLnNpZ25hbFN0cmVuZ3RoIGNhbiBiZSAwXG4gICAgICAgIG1ha2VBcmdzOiAoanNvbk9iaikgPT4gW3V0aWwuaGFzVmFsdWUoanNvbk9iai5zaWduYWxTdHJlbmd0aCkgPyBqc29uT2JqLnNpZ25hbFN0cmVuZ3RoIDoganNvbk9iai5zaWduYWxTdHJlbmdoXVxuICAgICAgfVxuICAgIH1cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYXBwaXVtL2RldmljZS9nc21fdm9pY2UnOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdnc21Wb2ljZScsIHBheWxvYWRQYXJhbXM6IHtyZXF1aXJlZDogWydzdGF0ZSddfX1cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYXBwaXVtL2RldmljZS9wb3dlcl9jYXBhY2l0eSc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ3Bvd2VyQ2FwYWNpdHknLCBwYXlsb2FkUGFyYW1zOiB7cmVxdWlyZWQ6IFsncGVyY2VudCddfX1cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYXBwaXVtL2RldmljZS9wb3dlcl9hYyc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ3Bvd2VyQUMnLCBwYXlsb2FkUGFyYW1zOiB7cmVxdWlyZWQ6IFsnc3RhdGUnXX19XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2FwcGl1bS9kZXZpY2UvbmV0d29ya19zcGVlZCc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ25ldHdvcmtTcGVlZCcsIHBheWxvYWRQYXJhbXM6IHtyZXF1aXJlZDogWyduZXRzcGVlZCddfX1cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYXBwaXVtL2RldmljZS9rZXlldmVudCc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ2tleWV2ZW50JywgcGF5bG9hZFBhcmFtczoge3JlcXVpcmVkOiBbJ2tleWNvZGUnXSwgb3B0aW9uYWw6IFsnbWV0YXN0YXRlJ119fVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9hcHBpdW0vZGV2aWNlL3JvdGF0ZSc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ21vYmlsZVJvdGF0aW9uJywgcGF5bG9hZFBhcmFtczoge1xuICAgICAgcmVxdWlyZWQ6IFsneCcsICd5JywgJ3JhZGl1cycsICdyb3RhdGlvbicsICd0b3VjaENvdW50JywgJ2R1cmF0aW9uJ10sXG4gICAgICBvcHRpb25hbDogWydlbGVtZW50J10gfX1cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYXBwaXVtL2RldmljZS9jdXJyZW50X2FjdGl2aXR5Jzoge1xuICAgIEdFVDoge2NvbW1hbmQ6ICdnZXRDdXJyZW50QWN0aXZpdHknfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9hcHBpdW0vZGV2aWNlL2N1cnJlbnRfcGFja2FnZSc6IHtcbiAgICBHRVQ6IHtjb21tYW5kOiAnZ2V0Q3VycmVudFBhY2thZ2UnfVxuICB9LFxuICAvL3JlZ2lvbiBBcHBsaWNhdGlvbnMgTWFuYWdlbWVudFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9hcHBpdW0vZGV2aWNlL2luc3RhbGxfYXBwJzoge1xuICAgIFBPU1Q6IHtcbiAgICAgIGNvbW1hbmQ6ICdpbnN0YWxsQXBwJyxcbiAgICAgIHBheWxvYWRQYXJhbXM6IHtcbiAgICAgICAgcmVxdWlyZWQ6IFsnYXBwUGF0aCddLFxuICAgICAgICBvcHRpb25hbDogWydvcHRpb25zJ11cbiAgICAgIH1cbiAgICB9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2FwcGl1bS9kZXZpY2UvYWN0aXZhdGVfYXBwJzoge1xuICAgIFBPU1Q6IHtcbiAgICAgIGNvbW1hbmQ6ICdhY3RpdmF0ZUFwcCcsXG4gICAgICBwYXlsb2FkUGFyYW1zOiB7XG4gICAgICAgIHJlcXVpcmVkOiBbWydhcHBJZCddLCBbJ2J1bmRsZUlkJ11dLFxuICAgICAgICBvcHRpb25hbDogWydvcHRpb25zJ11cbiAgICAgIH1cbiAgICB9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2FwcGl1bS9kZXZpY2UvcmVtb3ZlX2FwcCc6IHtcbiAgICBQT1NUOiB7XG4gICAgICBjb21tYW5kOiAncmVtb3ZlQXBwJyxcbiAgICAgIHBheWxvYWRQYXJhbXM6IHtcbiAgICAgICAgcmVxdWlyZWQ6IFtbJ2FwcElkJ10sIFsnYnVuZGxlSWQnXV0sXG4gICAgICAgIG9wdGlvbmFsOiBbJ29wdGlvbnMnXVxuICAgICAgfVxuICAgIH1cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYXBwaXVtL2RldmljZS90ZXJtaW5hdGVfYXBwJzoge1xuICAgIFBPU1Q6IHtcbiAgICAgIGNvbW1hbmQ6ICd0ZXJtaW5hdGVBcHAnLFxuICAgICAgcGF5bG9hZFBhcmFtczoge1xuICAgICAgICByZXF1aXJlZDogW1snYXBwSWQnXSwgWydidW5kbGVJZCddXSxcbiAgICAgICAgb3B0aW9uYWw6IFsnb3B0aW9ucyddXG4gICAgICB9XG4gICAgfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9hcHBpdW0vZGV2aWNlL2FwcF9pbnN0YWxsZWQnOiB7XG4gICAgUE9TVDoge1xuICAgICAgY29tbWFuZDogJ2lzQXBwSW5zdGFsbGVkJyxcbiAgICAgIHBheWxvYWRQYXJhbXM6IHtcbiAgICAgICAgcmVxdWlyZWQ6IFtbJ2FwcElkJ10sIFsnYnVuZGxlSWQnXV1cbiAgICAgIH1cbiAgICB9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2FwcGl1bS9kZXZpY2UvYXBwX3N0YXRlJzoge1xuICAgIEdFVDoge1xuICAgICAgY29tbWFuZDogJ3F1ZXJ5QXBwU3RhdGUnLFxuICAgICAgcGF5bG9hZFBhcmFtczoge1xuICAgICAgICByZXF1aXJlZDogW1snYXBwSWQnXSwgWydidW5kbGVJZCddXVxuICAgICAgfVxuICAgIH0sXG4gICAgUE9TVDoge1xuICAgICAgY29tbWFuZDogJ3F1ZXJ5QXBwU3RhdGUnLFxuICAgICAgcGF5bG9hZFBhcmFtczoge1xuICAgICAgICByZXF1aXJlZDogW1snYXBwSWQnXSwgWydidW5kbGVJZCddXVxuICAgICAgfVxuICAgIH1cbiAgfSxcbiAgLy9lbmRyZWdpb25cbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYXBwaXVtL2RldmljZS9oaWRlX2tleWJvYXJkJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAnaGlkZUtleWJvYXJkJywgcGF5bG9hZFBhcmFtczoge29wdGlvbmFsOiBbJ3N0cmF0ZWd5JywgJ2tleScsICdrZXlDb2RlJywgJ2tleU5hbWUnXX19XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2FwcGl1bS9kZXZpY2UvaXNfa2V5Ym9hcmRfc2hvd24nOiB7XG4gICAgR0VUOiB7Y29tbWFuZDogJ2lzS2V5Ym9hcmRTaG93bid9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2FwcGl1bS9kZXZpY2UvcHVzaF9maWxlJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAncHVzaEZpbGUnLCBwYXlsb2FkUGFyYW1zOiB7cmVxdWlyZWQ6IFsncGF0aCcsICdkYXRhJ119fVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9hcHBpdW0vZGV2aWNlL3B1bGxfZmlsZSc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ3B1bGxGaWxlJywgcGF5bG9hZFBhcmFtczoge3JlcXVpcmVkOiBbJ3BhdGgnXX19XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2FwcGl1bS9kZXZpY2UvcHVsbF9mb2xkZXInOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdwdWxsRm9sZGVyJywgcGF5bG9hZFBhcmFtczoge3JlcXVpcmVkOiBbJ3BhdGgnXX19XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2FwcGl1bS9kZXZpY2UvdG9nZ2xlX2FpcnBsYW5lX21vZGUnOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICd0b2dnbGVGbGlnaHRNb2RlJ31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYXBwaXVtL2RldmljZS90b2dnbGVfZGF0YSc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ3RvZ2dsZURhdGEnfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9hcHBpdW0vZGV2aWNlL3RvZ2dsZV93aWZpJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAndG9nZ2xlV2lGaSd9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2FwcGl1bS9kZXZpY2UvdG9nZ2xlX2xvY2F0aW9uX3NlcnZpY2VzJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAndG9nZ2xlTG9jYXRpb25TZXJ2aWNlcyd9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2FwcGl1bS9kZXZpY2Uvb3Blbl9ub3RpZmljYXRpb25zJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAnb3Blbk5vdGlmaWNhdGlvbnMnfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9hcHBpdW0vZGV2aWNlL3N0YXJ0X2FjdGl2aXR5Jzoge1xuICAgIFBPU1Q6IHtcbiAgICAgIGNvbW1hbmQ6ICdzdGFydEFjdGl2aXR5JyxcbiAgICAgIHBheWxvYWRQYXJhbXM6IHtcbiAgICAgICAgcmVxdWlyZWQ6IFsnYXBwUGFja2FnZScsICdhcHBBY3Rpdml0eSddLFxuICAgICAgICBvcHRpb25hbDogWydhcHBXYWl0UGFja2FnZScsICdhcHBXYWl0QWN0aXZpdHknLCAnaW50ZW50QWN0aW9uJyxcbiAgICAgICAgICAnaW50ZW50Q2F0ZWdvcnknLCAnaW50ZW50RmxhZ3MnLCAnb3B0aW9uYWxJbnRlbnRBcmd1bWVudHMnLCAnZG9udFN0b3BBcHBPblJlc2V0J11cbiAgICAgIH1cbiAgICB9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2FwcGl1bS9kZXZpY2Uvc3lzdGVtX2JhcnMnOiB7XG4gICAgR0VUOiB7Y29tbWFuZDogJ2dldFN5c3RlbUJhcnMnfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9hcHBpdW0vZGV2aWNlL2Rpc3BsYXlfZGVuc2l0eSc6IHtcbiAgICBHRVQ6IHtjb21tYW5kOiAnZ2V0RGlzcGxheURlbnNpdHknfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9hcHBpdW0vc2ltdWxhdG9yL3RvdWNoX2lkJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAndG91Y2hJZCcsIHBheWxvYWRQYXJhbXM6IHtyZXF1aXJlZDogWydtYXRjaCddfX1cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYXBwaXVtL3NpbXVsYXRvci90b2dnbGVfdG91Y2hfaWRfZW5yb2xsbWVudCc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ3RvZ2dsZUVucm9sbFRvdWNoSWQnLCBwYXlsb2FkUGFyYW1zOiB7b3B0aW9uYWw6IFsnZW5hYmxlZCddfX1cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYXBwaXVtL2FwcC9sYXVuY2gnOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdsYXVuY2hBcHAnfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9hcHBpdW0vYXBwL2Nsb3NlJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAnY2xvc2VBcHAnfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9hcHBpdW0vYXBwL3Jlc2V0Jzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAncmVzZXQnfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9hcHBpdW0vYXBwL2JhY2tncm91bmQnOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdiYWNrZ3JvdW5kJywgcGF5bG9hZFBhcmFtczoge3JlcXVpcmVkOiBbJ3NlY29uZHMnXX19XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2FwcGl1bS9hcHAvZW5kX3Rlc3RfY292ZXJhZ2UnOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdlbmRDb3ZlcmFnZScsIHBheWxvYWRQYXJhbXM6IHtyZXF1aXJlZDogWydpbnRlbnQnLCAncGF0aCddfX1cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYXBwaXVtL2FwcC9zdHJpbmdzJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAnZ2V0U3RyaW5ncycsIHBheWxvYWRQYXJhbXM6IHtvcHRpb25hbDogWydsYW5ndWFnZScsICdzdHJpbmdGaWxlJ119fVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9hcHBpdW0vZWxlbWVudC86ZWxlbWVudElkL3ZhbHVlJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAnc2V0VmFsdWVJbW1lZGlhdGUnLCBwYXlsb2FkUGFyYW1zOiB7XG4gICAgICB2YWxpZGF0ZTogKGpzb25PYmopID0+ICghdXRpbC5oYXNWYWx1ZShqc29uT2JqLnZhbHVlKSAmJiAhdXRpbC5oYXNWYWx1ZShqc29uT2JqLnRleHQpKSAmJlxuICAgICAgICAgICd3ZSByZXF1aXJlIG9uZSBvZiBcInRleHRcIiBvciBcInZhbHVlXCIgcGFyYW1zJyxcbiAgICAgIG9wdGlvbmFsOiBbJ3ZhbHVlJywgJ3RleHQnXSxcbiAgICAgIC8vIFdlIHdhbnQgdG8gZWl0aGVyIGEgdmFsdWUgKG9sZCBKU09OV1ApIG9yIGEgdGV4dCAobmV3IFczQykgcGFyYW1ldGVyLFxuICAgICAgLy8gYnV0IG9ubHkgc2VuZCBvbmUgb2YgdGhlbSB0byB0aGUgY29tbWFuZCAobm90IGJvdGgpLlxuICAgICAgLy8gUHJlZmVyICd2YWx1ZScgc2luY2UgaXQncyBtb3JlIGJhY2t3YXJkLWNvbXBhdGlibGUuXG4gICAgICBtYWtlQXJnczogKGpzb25PYmopID0+IFtqc29uT2JqLnZhbHVlIHx8IGpzb25PYmoudGV4dF0sXG4gICAgfX1cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYXBwaXVtL2VsZW1lbnQvOmVsZW1lbnRJZC9yZXBsYWNlX3ZhbHVlJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAncmVwbGFjZVZhbHVlJywgcGF5bG9hZFBhcmFtczoge1xuICAgICAgdmFsaWRhdGU6IChqc29uT2JqKSA9PiAoIXV0aWwuaGFzVmFsdWUoanNvbk9iai52YWx1ZSkgJiYgIXV0aWwuaGFzVmFsdWUoanNvbk9iai50ZXh0KSkgJiZcbiAgICAgICAgICAnd2UgcmVxdWlyZSBvbmUgb2YgXCJ0ZXh0XCIgb3IgXCJ2YWx1ZVwiIHBhcmFtcycsXG4gICAgICBvcHRpb25hbDogWyd2YWx1ZScsICd0ZXh0J10sXG4gICAgICAvLyBXZSB3YW50IHRvIGVpdGhlciBhIHZhbHVlIChvbGQgSlNPTldQKSBvciBhIHRleHQgKG5ldyBXM0MpIHBhcmFtZXRlcixcbiAgICAgIC8vIGJ1dCBvbmx5IHNlbmQgb25lIG9mIHRoZW0gdG8gdGhlIGNvbW1hbmQgKG5vdCBib3RoKS5cbiAgICAgIC8vIFByZWZlciAndmFsdWUnIHNpbmNlIGl0J3MgbW9yZSBiYWNrd2FyZC1jb21wYXRpYmxlLlxuICAgICAgbWFrZUFyZ3M6IChqc29uT2JqKSA9PiBbanNvbk9iai52YWx1ZSA/PyBqc29uT2JqLnRleHQgPz8gJyddLFxuICAgIH19XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2FwcGl1bS9zZXR0aW5ncyc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ3VwZGF0ZVNldHRpbmdzJywgcGF5bG9hZFBhcmFtczoge3JlcXVpcmVkOiBbJ3NldHRpbmdzJ119fSxcbiAgICBHRVQ6IHtjb21tYW5kOiAnZ2V0U2V0dGluZ3MnfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9hcHBpdW0vcmVjZWl2ZV9hc3luY19yZXNwb25zZSc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ3JlY2VpdmVBc3luY1Jlc3BvbnNlJywgcGF5bG9hZFBhcmFtczoge3JlcXVpcmVkOiBbJ3Jlc3BvbnNlJ119fVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9hcHBpdW0vZXhlY3V0ZV9kcml2ZXInOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdleGVjdXRlRHJpdmVyU2NyaXB0JywgcGF5bG9hZFBhcmFtczoge3JlcXVpcmVkOiBbJ3NjcmlwdCddLCBvcHRpb25hbDogWyd0eXBlJywgJ3RpbWVvdXQnXX19XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2FwcGl1bS9ldmVudHMnOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdnZXRMb2dFdmVudHMnLCBwYXlsb2FkUGFyYW1zOiB7b3B0aW9uYWw6IFsndHlwZSddfX1cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYXBwaXVtL2xvZ19ldmVudCc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ2xvZ0N1c3RvbUV2ZW50JywgcGF5bG9hZFBhcmFtczoge3JlcXVpcmVkOiBbJ3ZlbmRvcicsICdldmVudCddfX1cbiAgfSxcblxuXG4gIC8qXG4gICAqIFRoZSBXM0Mgc3BlYyBoYXMgc29tZSBjaGFuZ2VzIHRvIHRoZSB3aXJlIHByb3RvY29sLlxuICAgKiBodHRwczovL3czYy5naXRodWIuaW8vd2ViZHJpdmVyL3dlYmRyaXZlci1zcGVjLmh0bWxcbiAgICogQmVnaW4gdG8gYWRkIHRob3NlIGNoYW5nZXMgaGVyZSwga2VlcGluZyB0aGUgb2xkIHZlcnNpb25cbiAgICogc2luY2UgY2xpZW50cyBzdGlsbCBpbXBsZW1lbnQgdGhlbS5cbiAgICovXG4gIC8vIG9sZCBhbGVydHNcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYWxlcnRfdGV4dCc6IHtcbiAgICBHRVQ6IHtjb21tYW5kOiAnZ2V0QWxlcnRUZXh0J30sXG4gICAgUE9TVDoge1xuICAgICAgY29tbWFuZDogJ3NldEFsZXJ0VGV4dCcsXG4gICAgICBwYXlsb2FkUGFyYW1zOiBTRVRfQUxFUlRfVEVYVF9QQVlMT0FEX1BBUkFNUyxcbiAgICB9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2FjY2VwdF9hbGVydCc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ3Bvc3RBY2NlcHRBbGVydCd9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2Rpc21pc3NfYWxlcnQnOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdwb3N0RGlzbWlzc0FsZXJ0J31cbiAgfSxcbiAgLy8gaHR0cHM6Ly93M2MuZ2l0aHViLmlvL3dlYmRyaXZlci93ZWJkcml2ZXItc3BlYy5odG1sI3VzZXItcHJvbXB0c1xuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9hbGVydC90ZXh0Jzoge1xuICAgIEdFVDoge2NvbW1hbmQ6ICdnZXRBbGVydFRleHQnfSxcbiAgICBQT1NUOiB7XG4gICAgICBjb21tYW5kOiAnc2V0QWxlcnRUZXh0JyxcbiAgICAgIHBheWxvYWRQYXJhbXM6IFNFVF9BTEVSVF9URVhUX1BBWUxPQURfUEFSQU1TLFxuICAgIH1cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYWxlcnQvYWNjZXB0Jzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAncG9zdEFjY2VwdEFsZXJ0J31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYWxlcnQvZGlzbWlzcyc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ3Bvc3REaXNtaXNzQWxlcnQnfVxuICB9LFxuICAvLyBodHRwczovL3czYy5naXRodWIuaW8vd2ViZHJpdmVyL3dlYmRyaXZlci1zcGVjLmh0bWwjZ2V0LWVsZW1lbnQtcmVjdFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9lbGVtZW50LzplbGVtZW50SWQvcmVjdCc6IHtcbiAgICBHRVQ6IHtjb21tYW5kOiAnZ2V0RWxlbWVudFJlY3QnfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9leGVjdXRlL3N5bmMnOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdleGVjdXRlJywgcGF5bG9hZFBhcmFtczoge3JlcXVpcmVkOiBbJ3NjcmlwdCcsICdhcmdzJ119fVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9leGVjdXRlL2FzeW5jJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAnZXhlY3V0ZUFzeW5jJywgcGF5bG9hZFBhcmFtczoge3JlcXVpcmVkOiBbJ3NjcmlwdCcsICdhcmdzJ119fVxuICB9LFxuICAvLyBQcmUtVzNDIGVuZHBvaW50IGZvciBlbGVtZW50IHNjcmVlbnNob3RcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvc2NyZWVuc2hvdC86ZWxlbWVudElkJzoge1xuICAgIEdFVDoge2NvbW1hbmQ6ICdnZXRFbGVtZW50U2NyZWVuc2hvdCd9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2VsZW1lbnQvOmVsZW1lbnRJZC9zY3JlZW5zaG90Jzoge1xuICAgIEdFVDoge2NvbW1hbmQ6ICdnZXRFbGVtZW50U2NyZWVuc2hvdCd9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL3dpbmRvdy9yZWN0Jzoge1xuICAgIEdFVDoge2NvbW1hbmQ6ICdnZXRXaW5kb3dSZWN0J30sXG4gICAgUE9TVDoge2NvbW1hbmQ6ICdzZXRXaW5kb3dSZWN0J30sXG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL3dpbmRvdy9tYXhpbWl6ZSc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ21heGltaXplV2luZG93J31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvd2luZG93L21pbmltaXplJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAnbWluaW1pemVXaW5kb3cnfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC93aW5kb3cvZnVsbHNjcmVlbic6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ2Z1bGxTY3JlZW5XaW5kb3cnfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9lbGVtZW50LzplbGVtZW50SWQvcHJvcGVydHkvOm5hbWUnOiB7XG4gICAgR0VUOiB7Y29tbWFuZDogJ2dldFByb3BlcnR5J31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYXBwaXVtL2RldmljZS9zZXRfY2xpcGJvYXJkJzoge1xuICAgIFBPU1Q6IHtcbiAgICAgIGNvbW1hbmQ6ICdzZXRDbGlwYm9hcmQnLFxuICAgICAgcGF5bG9hZFBhcmFtczoge1xuICAgICAgICByZXF1aXJlZDogWydjb250ZW50J10sXG4gICAgICAgIG9wdGlvbmFsOiBbXG4gICAgICAgICAgJ2NvbnRlbnRUeXBlJyxcbiAgICAgICAgICAnbGFiZWwnLFxuICAgICAgICBdXG4gICAgICB9LFxuICAgIH1cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYXBwaXVtL2RldmljZS9nZXRfY2xpcGJvYXJkJzoge1xuICAgIFBPU1Q6IHtcbiAgICAgIGNvbW1hbmQ6ICdnZXRDbGlwYm9hcmQnLFxuICAgICAgcGF5bG9hZFBhcmFtczoge1xuICAgICAgICBvcHRpb25hbDogW1xuICAgICAgICAgICdjb250ZW50VHlwZScsXG4gICAgICAgIF1cbiAgICAgIH0sXG4gICAgfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9hcHBpdW0vY29tcGFyZV9pbWFnZXMnOiB7XG4gICAgUE9TVDoge1xuICAgICAgY29tbWFuZDogJ2NvbXBhcmVJbWFnZXMnLFxuICAgICAgcGF5bG9hZFBhcmFtczoge1xuICAgICAgICByZXF1aXJlZDogWydtb2RlJywgJ2ZpcnN0SW1hZ2UnLCAnc2Vjb25kSW1hZ2UnXSxcbiAgICAgICAgb3B0aW9uYWw6IFsnb3B0aW9ucyddXG4gICAgICB9LFxuICAgIH1cbiAgfSxcblxuICAvLyBjaHJvbWl1bSBkZXZ0b29sc1xuICAvLyBodHRwczovL2Nocm9taXVtLmdvb2dsZXNvdXJjZS5jb20vY2hyb21pdW0vc3JjLysvbWFzdGVyL2Nocm9tZS90ZXN0L2Nocm9tZWRyaXZlci9zZXJ2ZXIvaHR0cF9oYW5kbGVyLmNjXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkLzp2ZW5kb3IvY2RwL2V4ZWN1dGUnOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdleGVjdXRlQ2RwJywgcGF5bG9hZFBhcmFtczoge3JlcXVpcmVkOiBbJ2NtZCcsICdwYXJhbXMnXX19XG4gIH0sXG5cbiAgLy9yZWdpb24gV2ViYXV0aG5cbiAgLy8gaHR0cHM6Ly93d3cudzMub3JnL1RSL3dlYmF1dGhuLTIvI3NjdG4tYXV0b21hdGlvbi1hZGQtdmlydHVhbC1hdXRoZW50aWNhdG9yXG5cbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvd2ViYXV0aG4vYXV0aGVudGljYXRvcic6IHtcbiAgICBQT1NUOiB7XG4gICAgICBjb21tYW5kOiAnYWRkVmlydHVhbEF1dGhlbnRpY2F0b3InLFxuICAgICAgcGF5bG9hZFBhcmFtczoge1xuICAgICAgICByZXF1aXJlZDogWydwcm90b2NvbCcsICd0cmFuc3BvcnQnXSxcbiAgICAgICAgb3B0aW9uYWw6IFsnaGFzUmVzaWRlbnRLZXknLCAnaGFzVXNlclZlcmlmaWNhdGlvbicsICdpc1VzZXJDb25zZW50aW5nJywgJ2lzVXNlclZlcmlmaWVkJ10sXG4gICAgICB9XG4gICAgfVxuICB9LFxuXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL3dlYmF1dGhuL2F1dGhlbnRpY2F0b3IvOmF1dGhlbnRpY2F0b3JJZCc6IHtcbiAgICBERUxFVEU6IHtcbiAgICAgIGNvbW1hbmQ6ICdyZW1vdmVWaXJ0dWFsQXV0aGVudGljYXRvcidcbiAgICB9XG4gIH0sXG5cbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvd2ViYXV0aG4vYXV0aGVudGljYXRvci86YXV0aGVudGljYXRvcklkL2NyZWRlbnRpYWwnOiB7XG4gICAgUE9TVDoge1xuICAgICAgY29tbWFuZDogJ2FkZEF1dGhDcmVkZW50aWFsJyxcbiAgICAgIHBheWxvYWRQYXJhbXM6IHtcbiAgICAgICAgcmVxdWlyZWQ6IFsnY3JlZGVudGlhbElkJywgJ2lzUmVzaWRlbnRDcmVkZW50aWFsJywgJ3JwSWQnLCAncHJpdmF0ZUtleSddLFxuICAgICAgICBvcHRpb25hbDogWyd1c2VySGFuZGxlJywgJ3NpZ25Db3VudCddLFxuICAgICAgfVxuICAgIH1cbiAgfSxcblxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC93ZWJhdXRobi9hdXRoZW50aWNhdG9yLzphdXRoZW50aWNhdG9ySWQvY3JlZGVudGlhbHMnOiB7XG4gICAgR0VUOiB7Y29tbWFuZDogJ2dldEF1dGhDcmVkZW50aWFsJ30sXG4gICAgREVMRVRFOiB7Y29tbWFuZDogJ3JlbW92ZUFsbEF1dGhDcmVkZW50aWFscyd9LFxuICB9LFxuXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL3dlYmF1dGhuL2F1dGhlbnRpY2F0b3IvOmF1dGhlbnRpY2F0b3JJZC9jcmVkZW50aWFscy86Y3JlZGVudGlhbElkJzoge1xuICAgIERFTEVURToge2NvbW1hbmQ6ICdyZW1vdmVBdXRoQ3JlZGVudGlhbCd9XG4gIH0sXG5cbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvd2ViYXV0aG4vYXV0aGVudGljYXRvci86YXV0aGVudGljYXRvcklkL3V2Jzoge1xuICAgIFBPU1Q6IHtcbiAgICAgIGNvbW1hbmQ6ICdzZXRVc2VyQXV0aFZlcmlmaWVkJyxcbiAgICAgIHBheWxvYWRQYXJhbXM6IHtcbiAgICAgICAgcmVxdWlyZWQ6IFsnaXNVc2VyVmVyaWZpZWQnXVxuICAgICAgfVxuICAgIH1cbiAgfSxcblxuICAvL2VuZHJlZ2lvblxuXG59O1xuXG4vLyBkcml2ZXIgY29tbWFuZCBuYW1lc1xubGV0IEFMTF9DT01NQU5EUyA9IFtdO1xuZm9yIChsZXQgdiBvZiBfLnZhbHVlcyhNRVRIT0RfTUFQKSkge1xuICBmb3IgKGxldCBtIG9mIF8udmFsdWVzKHYpKSB7XG4gICAgaWYgKG0uY29tbWFuZCkge1xuICAgICAgQUxMX0NPTU1BTkRTLnB1c2gobS5jb21tYW5kKTtcbiAgICB9XG4gIH1cbn1cblxuY29uc3QgUkVfRVNDQVBFID0gL1stW1xcXXt9KCkrPy4sXFxcXF4kfCNcXHNdL2c7XG5jb25zdCBSRV9QQVJBTSA9IC8oWzoqXSkoXFx3KykvZztcblxuY2xhc3MgUm91dGUge1xuICBjb25zdHJ1Y3RvciAocm91dGUpIHtcbiAgICB0aGlzLnBhcmFtTmFtZXMgPSBbXTtcblxuICAgIGxldCByZVN0ciA9IHJvdXRlLnJlcGxhY2UoUkVfRVNDQVBFLCAnXFxcXCQmJyk7XG4gICAgcmVTdHIgPSByZVN0ci5yZXBsYWNlKFJFX1BBUkFNLCAoXywgbW9kZSwgbmFtZSkgPT4ge1xuICAgICAgdGhpcy5wYXJhbU5hbWVzLnB1c2gobmFtZSk7XG4gICAgICByZXR1cm4gbW9kZSA9PT0gJzonID8gJyhbXi9dKiknIDogJyguKiknO1xuICAgIH0pO1xuICAgIHRoaXMucm91dGVSZWdleHAgPSBuZXcgUmVnRXhwKGBeJHtyZVN0cn0kYCk7XG4gIH1cblxuICBwYXJzZSAodXJsKSB7XG4gICAgLy9pZiAodXJsLmluZGV4T2YoJ3RpbWVvdXRzJykgIT09IC0xICYmIHRoaXMucm91dGVSZWdleHAudG9TdHJpbmcoKS5pbmRleE9mKCd0aW1lb3V0cycpICE9PSAtMSkge1xuICAgIC8vZGVidWdnZXI7XG4gICAgLy99XG4gICAgbGV0IG1hdGNoZXMgPSB1cmwubWF0Y2godGhpcy5yb3V0ZVJlZ2V4cCk7XG4gICAgaWYgKCFtYXRjaGVzKSByZXR1cm47IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgY3VybHlcbiAgICBsZXQgaSA9IDA7XG4gICAgbGV0IHBhcmFtcyA9IHt9O1xuICAgIHdoaWxlIChpIDwgdGhpcy5wYXJhbU5hbWVzLmxlbmd0aCkge1xuICAgICAgY29uc3QgcGFyYW1OYW1lID0gdGhpcy5wYXJhbU5hbWVzW2krK107XG4gICAgICBwYXJhbXNbcGFyYW1OYW1lXSA9IG1hdGNoZXNbaV07XG4gICAgfVxuICAgIHJldHVybiBwYXJhbXM7XG4gIH1cbn1cblxuZnVuY3Rpb24gcm91dGVUb0NvbW1hbmROYW1lIChlbmRwb2ludCwgbWV0aG9kLCBiYXNlUGF0aCA9IERFRkFVTFRfQkFTRV9QQVRIKSB7XG4gIGxldCBkc3RSb3V0ZSA9IG51bGw7XG5cbiAgLy8gcmVtb3ZlIGFueSBxdWVyeSBzdHJpbmdcbiAgaWYgKGVuZHBvaW50LmluY2x1ZGVzKCc/JykpIHtcbiAgICBlbmRwb2ludCA9IGVuZHBvaW50LnNsaWNlKDAsIGVuZHBvaW50LmluZGV4T2YoJz8nKSk7XG4gIH1cblxuICBjb25zdCBhY3R1YWxFbmRwb2ludCA9IGVuZHBvaW50ID09PSAnLycgPyAnJyA6XG4gICAgKF8uc3RhcnRzV2l0aChlbmRwb2ludCwgJy8nKSA/IGVuZHBvaW50IDogYC8ke2VuZHBvaW50fWApO1xuXG4gIGZvciAobGV0IGN1cnJlbnRSb3V0ZSBvZiBfLmtleXMoTUVUSE9EX01BUCkpIHtcbiAgICBjb25zdCByb3V0ZSA9IG5ldyBSb3V0ZShgJHtiYXNlUGF0aH0ke2N1cnJlbnRSb3V0ZX1gKTtcbiAgICAvLyB3ZSBkb24ndCBjYXJlIGFib3V0IHRoZSBhY3R1YWwgc2Vzc2lvbiBpZCBmb3IgbWF0Y2hpbmdcbiAgICBpZiAocm91dGUucGFyc2UoYCR7YmFzZVBhdGh9L3Nlc3Npb24vaWdub3JlZC1zZXNzaW9uLWlkJHthY3R1YWxFbmRwb2ludH1gKSB8fFxuICAgICAgICByb3V0ZS5wYXJzZShgJHtiYXNlUGF0aH0ke2FjdHVhbEVuZHBvaW50fWApIHx8IHJvdXRlLnBhcnNlKGFjdHVhbEVuZHBvaW50KSkge1xuICAgICAgZHN0Um91dGUgPSBjdXJyZW50Um91dGU7XG4gICAgICBicmVhaztcbiAgICB9XG4gIH1cbiAgaWYgKCFkc3RSb3V0ZSkgcmV0dXJuOyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIGN1cmx5XG5cbiAgY29uc3QgbWV0aG9kcyA9IF8uZ2V0KE1FVEhPRF9NQVAsIGRzdFJvdXRlKTtcbiAgbWV0aG9kID0gXy50b1VwcGVyKG1ldGhvZCk7XG4gIGlmIChfLmhhcyhtZXRob2RzLCBtZXRob2QpKSB7XG4gICAgY29uc3QgZHN0TWV0aG9kID0gXy5nZXQobWV0aG9kcywgbWV0aG9kKTtcbiAgICBpZiAoZHN0TWV0aG9kLmNvbW1hbmQpIHtcbiAgICAgIHJldHVybiBkc3RNZXRob2QuY29tbWFuZDtcbiAgICB9XG4gIH1cbn1cblxuLy8gZHJpdmVyIGNvbW1hbmRzIHRoYXQgZG8gbm90IHJlcXVpcmUgYSBzZXNzaW9uIHRvIGFscmVhZHkgZXhpc3RcbmNvbnN0IE5PX1NFU1NJT05fSURfQ09NTUFORFMgPSBbJ2NyZWF0ZVNlc3Npb24nLCAnZ2V0U3RhdHVzJywgJ2dldFN0YXR1c1dEQScsICdnZXRTdGF0dXNBREInLCAnZ2V0U2Vzc2lvbnMnXTtcblxuZXhwb3J0IHsgTUVUSE9EX01BUCwgQUxMX0NPTU1BTkRTLCBOT19TRVNTSU9OX0lEX0NPTU1BTkRTLCByb3V0ZVRvQ29tbWFuZE5hbWUgfTtcbiJdLCJmaWxlIjoibGliL3Byb3RvY29sL3JvdXRlcy5qcyIsInNvdXJjZVJvb3QiOiIuLi8uLi8uLiJ9
