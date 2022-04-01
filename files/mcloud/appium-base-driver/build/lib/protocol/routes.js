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

const NO_SESSION_ID_COMMANDS = ['createSession', 'getStatus', 'getStatusWDA', 'getSessions'];
exports.NO_SESSION_ID_COMMANDS = NO_SESSION_ID_COMMANDS;require('source-map-support').install();


//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImxpYi9wcm90b2NvbC9yb3V0ZXMuanMiXSwibmFtZXMiOlsiU0VUX0FMRVJUX1RFWFRfUEFZTE9BRF9QQVJBTVMiLCJ2YWxpZGF0ZSIsImpzb25PYmoiLCJ1dGlsIiwiaGFzVmFsdWUiLCJ2YWx1ZSIsInRleHQiLCJvcHRpb25hbCIsIm1ha2VBcmdzIiwiTUVUSE9EX01BUCIsIkdFVCIsImNvbW1hbmQiLCJQT1NUIiwicGF5bG9hZFBhcmFtcyIsImNhcGFiaWxpdGllcyIsImRlc2lyZWRDYXBhYmlsaXRpZXMiLCJERUxFVEUiLCJwcm90b2NvbE5hbWUiLCJQUk9UT0NPTFMiLCJXM0MiLCJzY3JpcHQiLCJwYWdlTG9hZCIsImltcGxpY2l0IiwidHlwZSIsIm1zIiwicmVxdWlyZWQiLCJoYW5kbGUiLCJuYW1lIiwidW53cmFwIiwid3JhcCIsInNpZ25hbFN0cmVuZ3RoIiwic2lnbmFsU3RyZW5naCIsIkFMTF9DT01NQU5EUyIsInYiLCJfIiwidmFsdWVzIiwibSIsInB1c2giLCJSRV9FU0NBUEUiLCJSRV9QQVJBTSIsIlJvdXRlIiwiY29uc3RydWN0b3IiLCJyb3V0ZSIsInBhcmFtTmFtZXMiLCJyZVN0ciIsInJlcGxhY2UiLCJtb2RlIiwicm91dGVSZWdleHAiLCJSZWdFeHAiLCJwYXJzZSIsInVybCIsIm1hdGNoZXMiLCJtYXRjaCIsImkiLCJwYXJhbXMiLCJsZW5ndGgiLCJwYXJhbU5hbWUiLCJyb3V0ZVRvQ29tbWFuZE5hbWUiLCJlbmRwb2ludCIsIm1ldGhvZCIsImJhc2VQYXRoIiwiREVGQVVMVF9CQVNFX1BBVEgiLCJkc3RSb3V0ZSIsImluY2x1ZGVzIiwic2xpY2UiLCJpbmRleE9mIiwiYWN0dWFsRW5kcG9pbnQiLCJzdGFydHNXaXRoIiwiY3VycmVudFJvdXRlIiwia2V5cyIsIm1ldGhvZHMiLCJnZXQiLCJ0b1VwcGVyIiwiaGFzIiwiZHN0TWV0aG9kIiwiTk9fU0VTU0lPTl9JRF9DT01NQU5EUyJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7O0FB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dCBfIGZyb20gJ2xvZGFzaCc7XG5pbXBvcnQgeyB1dGlsIH0gZnJvbSAnYXBwaXVtLXN1cHBvcnQnO1xuaW1wb3J0IHsgUFJPVE9DT0xTLCBERUZBVUxUX0JBU0VfUEFUSCB9IGZyb20gJy4uL2NvbnN0YW50cyc7XG5cblxuY29uc3QgU0VUX0FMRVJUX1RFWFRfUEFZTE9BRF9QQVJBTVMgPSB7XG4gIHZhbGlkYXRlOiAoanNvbk9iaikgPT4gKCF1dGlsLmhhc1ZhbHVlKGpzb25PYmoudmFsdWUpICYmICF1dGlsLmhhc1ZhbHVlKGpzb25PYmoudGV4dCkpICYmXG4gICAgICAnZWl0aGVyIFwidGV4dFwiIG9yIFwidmFsdWVcIiBtdXN0IGJlIHNldCcsXG4gIG9wdGlvbmFsOiBbJ3ZhbHVlJywgJ3RleHQnXSxcbiAgLy8gUHJlZmVyICd2YWx1ZScgc2luY2UgaXQncyBtb3JlIGJhY2t3YXJkLWNvbXBhdGlibGUuXG4gIG1ha2VBcmdzOiAoanNvbk9iaikgPT4gW2pzb25PYmoudmFsdWUgfHwganNvbk9iai50ZXh0XSxcbn07XG5cbi8vIGRlZmluZSB0aGUgcm91dGVzLCBtYXBwaW5nIG9mIEhUVFAgbWV0aG9kcyB0byBwYXJ0aWN1bGFyIGRyaXZlciBjb21tYW5kcyxcbi8vIGFuZCBhbnkgcGFyYW1ldGVycyB0aGF0IGFyZSBleHBlY3RlZCBpbiBhIHJlcXVlc3Rcbi8vIHBhcmFtZXRlcnMgY2FuIGJlIGByZXF1aXJlZGAgb3IgYG9wdGlvbmFsYFxuY29uc3QgTUVUSE9EX01BUCA9IHtcbiAgJy9zdGF0dXMnOiB7XG4gICAgR0VUOiB7Y29tbWFuZDogJ2dldFN0YXR1cyd9XG4gIH0sXG4gICcvc3RhdHVzLXdkYSc6IHtcbiAgICBHRVQ6IHtjb21tYW5kOiAnZ2V0U3RhdHVzV0RBJ31cbiAgfSxcbiAgJy9zZXNzaW9uJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAnY3JlYXRlU2Vzc2lvbicsIHBheWxvYWRQYXJhbXM6IHtcbiAgICAgIHZhbGlkYXRlOiAoanNvbk9iaikgPT4gKCFqc29uT2JqLmNhcGFiaWxpdGllcyAmJiAhanNvbk9iai5kZXNpcmVkQ2FwYWJpbGl0aWVzKSAmJiAnd2UgcmVxdWlyZSBvbmUgb2YgXCJkZXNpcmVkQ2FwYWJpbGl0aWVzXCIgb3IgXCJjYXBhYmlsaXRpZXNcIiBvYmplY3QnLFxuICAgICAgb3B0aW9uYWw6IFsnZGVzaXJlZENhcGFiaWxpdGllcycsICdyZXF1aXJlZENhcGFiaWxpdGllcycsICdjYXBhYmlsaXRpZXMnXX19XG4gIH0sXG4gICcvc2Vzc2lvbnMnOiB7XG4gICAgR0VUOiB7Y29tbWFuZDogJ2dldFNlc3Npb25zJ31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQnOiB7XG4gICAgR0VUOiB7Y29tbWFuZDogJ2dldFNlc3Npb24nfSxcbiAgICBERUxFVEU6IHtjb21tYW5kOiAnZGVsZXRlU2Vzc2lvbid9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL3RpbWVvdXRzJzoge1xuICAgIEdFVDoge2NvbW1hbmQ6ICdnZXRUaW1lb3V0cyd9LCAvLyBXM0Mgcm91dGVcbiAgICBQT1NUOiB7Y29tbWFuZDogJ3RpbWVvdXRzJywgcGF5bG9hZFBhcmFtczoge1xuICAgICAgdmFsaWRhdGU6IChqc29uT2JqLCBwcm90b2NvbE5hbWUpID0+IHtcbiAgICAgICAgaWYgKHByb3RvY29sTmFtZSA9PT0gUFJPVE9DT0xTLlczQykge1xuICAgICAgICAgIGlmICghdXRpbC5oYXNWYWx1ZShqc29uT2JqLnNjcmlwdCkgJiYgIXV0aWwuaGFzVmFsdWUoanNvbk9iai5wYWdlTG9hZCkgJiYgIXV0aWwuaGFzVmFsdWUoanNvbk9iai5pbXBsaWNpdCkpIHtcbiAgICAgICAgICAgIHJldHVybiAnVzNDIHByb3RvY29sIGV4cGVjdHMgYW55IG9mIHNjcmlwdCwgcGFnZUxvYWQgb3IgaW1wbGljaXQgdG8gYmUgc2V0JztcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgaWYgKCF1dGlsLmhhc1ZhbHVlKGpzb25PYmoudHlwZSkgfHwgIXV0aWwuaGFzVmFsdWUoanNvbk9iai5tcykpIHtcbiAgICAgICAgICAgIHJldHVybiAnTUpTT05XUCBwcm90b2NvbCByZXF1aXJlcyB0eXBlIGFuZCBtcyc7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgb3B0aW9uYWw6IFsndHlwZScsICdtcycsICdzY3JpcHQnLCAncGFnZUxvYWQnLCAnaW1wbGljaXQnXSxcbiAgICB9fVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC90aW1lb3V0cy9hc3luY19zY3JpcHQnOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdhc3luY1NjcmlwdFRpbWVvdXQnLCBwYXlsb2FkUGFyYW1zOiB7cmVxdWlyZWQ6IFsnbXMnXX19XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL3RpbWVvdXRzL2ltcGxpY2l0X3dhaXQnOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdpbXBsaWNpdFdhaXQnLCBwYXlsb2FkUGFyYW1zOiB7cmVxdWlyZWQ6IFsnbXMnXX19XG4gIH0sXG4gIC8vIEpTT05XUFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC93aW5kb3dfaGFuZGxlJzoge1xuICAgIEdFVDoge2NvbW1hbmQ6ICdnZXRXaW5kb3dIYW5kbGUnfVxuICB9LFxuICAvLyBXM0NcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvd2luZG93L2hhbmRsZSc6IHtcbiAgICBHRVQ6IHtjb21tYW5kOiAnZ2V0V2luZG93SGFuZGxlJ31cbiAgfSxcbiAgLy8gSlNPTldQXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL3dpbmRvd19oYW5kbGVzJzoge1xuICAgIEdFVDoge2NvbW1hbmQ6ICdnZXRXaW5kb3dIYW5kbGVzJ31cbiAgfSxcbiAgLy8gVzNDXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL3dpbmRvdy9oYW5kbGVzJzoge1xuICAgIEdFVDoge2NvbW1hbmQ6ICdnZXRXaW5kb3dIYW5kbGVzJ31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvdXJsJzoge1xuICAgIEdFVDoge2NvbW1hbmQ6ICdnZXRVcmwnfSxcbiAgICBQT1NUOiB7Y29tbWFuZDogJ3NldFVybCcsIHBheWxvYWRQYXJhbXM6IHtyZXF1aXJlZDogWyd1cmwnXX19XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2ZvcndhcmQnOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdmb3J3YXJkJ31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYmFjayc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ2JhY2snfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9yZWZyZXNoJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAncmVmcmVzaCd9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2V4ZWN1dGUnOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdleGVjdXRlJywgcGF5bG9hZFBhcmFtczoge3JlcXVpcmVkOiBbJ3NjcmlwdCcsICdhcmdzJ119fVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9leGVjdXRlX2FzeW5jJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAnZXhlY3V0ZUFzeW5jJywgcGF5bG9hZFBhcmFtczoge3JlcXVpcmVkOiBbJ3NjcmlwdCcsICdhcmdzJ119fVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9zY3JlZW5zaG90Jzoge1xuICAgIEdFVDoge2NvbW1hbmQ6ICdnZXRTY3JlZW5zaG90J31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvaW1lL2F2YWlsYWJsZV9lbmdpbmVzJzoge1xuICAgIEdFVDoge2NvbW1hbmQ6ICdhdmFpbGFibGVJTUVFbmdpbmVzJ31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvaW1lL2FjdGl2ZV9lbmdpbmUnOiB7XG4gICAgR0VUOiB7Y29tbWFuZDogJ2dldEFjdGl2ZUlNRUVuZ2luZSd9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2ltZS9hY3RpdmF0ZWQnOiB7XG4gICAgR0VUOiB7Y29tbWFuZDogJ2lzSU1FQWN0aXZhdGVkJ31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvaW1lL2RlYWN0aXZhdGUnOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdkZWFjdGl2YXRlSU1FRW5naW5lJ31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvaW1lL2FjdGl2YXRlJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAnYWN0aXZhdGVJTUVFbmdpbmUnLCBwYXlsb2FkUGFyYW1zOiB7cmVxdWlyZWQ6IFsnZW5naW5lJ119fVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9mcmFtZSc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ3NldEZyYW1lJywgcGF5bG9hZFBhcmFtczoge3JlcXVpcmVkOiBbJ2lkJ119fVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9mcmFtZS9wYXJlbnQnOiB7XG4gICAgUE9TVDoge31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvd2luZG93Jzoge1xuICAgIEdFVDoge2NvbW1hbmQ6ICdnZXRXaW5kb3dIYW5kbGUnfSxcbiAgICBQT1NUOiB7Y29tbWFuZDogJ3NldFdpbmRvdycsIHBheWxvYWRQYXJhbXM6IHtcbiAgICAgIG9wdGlvbmFsOiBbJ25hbWUnLCAnaGFuZGxlJ10sXG4gICAgICAvLyBSZXR1cm4gYm90aCB2YWx1ZXMgdG8gbWF0Y2ggVzNDIGFuZCBKU09OV1AgcHJvdG9jb2xzXG4gICAgICBtYWtlQXJnczogKGpzb25PYmopID0+IHtcbiAgICAgICAgaWYgKHV0aWwuaGFzVmFsdWUoanNvbk9iai5oYW5kbGUpICYmICF1dGlsLmhhc1ZhbHVlKGpzb25PYmoubmFtZSkpIHtcbiAgICAgICAgICByZXR1cm4gW2pzb25PYmouaGFuZGxlLCBqc29uT2JqLmhhbmRsZV07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHV0aWwuaGFzVmFsdWUoanNvbk9iai5uYW1lKSAmJiAhdXRpbC5oYXNWYWx1ZShqc29uT2JqLmhhbmRsZSkpIHtcbiAgICAgICAgICByZXR1cm4gW2pzb25PYmoubmFtZSwganNvbk9iai5uYW1lXTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gW2pzb25PYmoubmFtZSwganNvbk9iai5oYW5kbGVdO1xuICAgICAgfSxcbiAgICAgIHZhbGlkYXRlOiAoanNvbk9iaikgPT4gKCF1dGlsLmhhc1ZhbHVlKGpzb25PYmoubmFtZSkgJiYgIXV0aWwuaGFzVmFsdWUoanNvbk9iai5oYW5kbGUpKVxuICAgICAgICAmJiAnd2UgcmVxdWlyZSBvbmUgb2YgXCJuYW1lXCIgb3IgXCJoYW5kbGVcIiB0byBiZSBzZXQnLFxuICAgIH19LFxuICAgIERFTEVURToge2NvbW1hbmQ6ICdjbG9zZVdpbmRvdyd9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL3dpbmRvdy86d2luZG93aGFuZGxlL3NpemUnOiB7XG4gICAgR0VUOiB7Y29tbWFuZDogJ2dldFdpbmRvd1NpemUnfSxcbiAgICBQT1NUOiB7fVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC93aW5kb3cvOndpbmRvd2hhbmRsZS9wb3NpdGlvbic6IHtcbiAgICBQT1NUOiB7fSxcbiAgICBHRVQ6IHt9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL3dpbmRvdy86d2luZG93aGFuZGxlL21heGltaXplJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAnbWF4aW1pemVXaW5kb3cnfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9jb29raWUnOiB7XG4gICAgR0VUOiB7Y29tbWFuZDogJ2dldENvb2tpZXMnfSxcbiAgICBQT1NUOiB7Y29tbWFuZDogJ3NldENvb2tpZScsIHBheWxvYWRQYXJhbXM6IHtyZXF1aXJlZDogWydjb29raWUnXX19LFxuICAgIERFTEVURToge2NvbW1hbmQ6ICdkZWxldGVDb29raWVzJ31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvY29va2llLzpuYW1lJzoge1xuICAgIEdFVDoge2NvbW1hbmQ6ICdnZXRDb29raWUnfSxcbiAgICBERUxFVEU6IHtjb21tYW5kOiAnZGVsZXRlQ29va2llJ31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvc291cmNlJzoge1xuICAgIEdFVDoge2NvbW1hbmQ6ICdnZXRQYWdlU291cmNlJ31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvdGl0bGUnOiB7XG4gICAgR0VUOiB7Y29tbWFuZDogJ3RpdGxlJ31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvZWxlbWVudCc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ2ZpbmRFbGVtZW50JywgcGF5bG9hZFBhcmFtczoge3JlcXVpcmVkOiBbJ3VzaW5nJywgJ3ZhbHVlJ119fVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9lbGVtZW50cyc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ2ZpbmRFbGVtZW50cycsIHBheWxvYWRQYXJhbXM6IHtyZXF1aXJlZDogWyd1c2luZycsICd2YWx1ZSddfX1cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvZWxlbWVudC9hY3RpdmUnOiB7XG4gICAgR0VUOiB7Y29tbWFuZDogJ2FjdGl2ZSd9LCAvLyBXM0M6IGh0dHBzOi8vdzNjLmdpdGh1Yi5pby93ZWJkcml2ZXIvd2ViZHJpdmVyLXNwZWMuaHRtbCNkZm4tZ2V0LWFjdGl2ZS1lbGVtZW50XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdhY3RpdmUnfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9lbGVtZW50LzplbGVtZW50SWQnOiB7XG4gICAgR0VUOiB7fVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9lbGVtZW50LzplbGVtZW50SWQvZWxlbWVudCc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ2ZpbmRFbGVtZW50RnJvbUVsZW1lbnQnLCBwYXlsb2FkUGFyYW1zOiB7cmVxdWlyZWQ6IFsndXNpbmcnLCAndmFsdWUnXX19XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2VsZW1lbnQvOmVsZW1lbnRJZC9lbGVtZW50cyc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ2ZpbmRFbGVtZW50c0Zyb21FbGVtZW50JywgcGF5bG9hZFBhcmFtczoge3JlcXVpcmVkOiBbJ3VzaW5nJywgJ3ZhbHVlJ119fVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9lbGVtZW50LzplbGVtZW50SWQvY2xpY2snOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdjbGljayd9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2VsZW1lbnQvOmVsZW1lbnRJZC9zdWJtaXQnOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdzdWJtaXQnfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9lbGVtZW50LzplbGVtZW50SWQvdGV4dCc6IHtcbiAgICBHRVQ6IHtjb21tYW5kOiAnZ2V0VGV4dCd9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2VsZW1lbnQvOmVsZW1lbnRJZC92YWx1ZSc6IHtcbiAgICBQT1NUOiB7XG4gICAgICBjb21tYW5kOiAnc2V0VmFsdWUnLFxuICAgICAgcGF5bG9hZFBhcmFtczoge1xuICAgICAgICB2YWxpZGF0ZTogKGpzb25PYmopID0+ICghdXRpbC5oYXNWYWx1ZShqc29uT2JqLnZhbHVlKSAmJiAhdXRpbC5oYXNWYWx1ZShqc29uT2JqLnRleHQpKSAmJlxuICAgICAgICAgICAgJ3dlIHJlcXVpcmUgb25lIG9mIFwidGV4dFwiIG9yIFwidmFsdWVcIiBwYXJhbXMnLFxuICAgICAgICBvcHRpb25hbDogWyd2YWx1ZScsICd0ZXh0J10sXG4gICAgICAgIC8vIG92ZXJyaWRlIHRoZSBkZWZhdWx0IGFyZ3VtZW50IGNvbnN0cnVjdG9yIGJlY2F1c2Ugb2YgdGhlIHNwZWNpYWxcbiAgICAgICAgLy8gbG9naWMgaGVyZS4gQmFzaWNhbGx5IHdlIHdhbnQgdG8gYWNjZXB0IGVpdGhlciBhIHZhbHVlIChvbGQgSlNPTldQKVxuICAgICAgICAvLyBvciBhIHRleHQgKG5ldyBXM0MpIHBhcmFtZXRlciwgYnV0IG9ubHkgc2VuZCBvbmUgb2YgdGhlbSB0byB0aGVcbiAgICAgICAgLy8gY29tbWFuZCAobm90IGJvdGgpLiBQcmVmZXIgJ3ZhbHVlJyBzaW5jZSBpdCdzIG1vcmVcbiAgICAgICAgLy8gYmFja3dhcmQtY29tcGF0aWJsZS5cbiAgICAgICAgbWFrZUFyZ3M6IChqc29uT2JqKSA9PiBbanNvbk9iai52YWx1ZSB8fCBqc29uT2JqLnRleHRdLFxuICAgICAgfVxuICAgIH1cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQva2V5cyc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ2tleXMnLCBwYXlsb2FkUGFyYW1zOiB7cmVxdWlyZWQ6IFsndmFsdWUnXX19XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2VsZW1lbnQvOmVsZW1lbnRJZC9uYW1lJzoge1xuICAgIEdFVDoge2NvbW1hbmQ6ICdnZXROYW1lJ31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvZWxlbWVudC86ZWxlbWVudElkL2NsZWFyJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAnY2xlYXInfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9lbGVtZW50LzplbGVtZW50SWQvc2VsZWN0ZWQnOiB7XG4gICAgR0VUOiB7Y29tbWFuZDogJ2VsZW1lbnRTZWxlY3RlZCd9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2VsZW1lbnQvOmVsZW1lbnRJZC9lbmFibGVkJzoge1xuICAgIEdFVDoge2NvbW1hbmQ6ICdlbGVtZW50RW5hYmxlZCd9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2VsZW1lbnQvOmVsZW1lbnRJZC9hdHRyaWJ1dGUvOm5hbWUnOiB7XG4gICAgR0VUOiB7Y29tbWFuZDogJ2dldEF0dHJpYnV0ZSd9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2VsZW1lbnQvOmVsZW1lbnRJZC9lcXVhbHMvOm90aGVySWQnOiB7XG4gICAgR0VUOiB7Y29tbWFuZDogJ2VxdWFsc0VsZW1lbnQnfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9lbGVtZW50LzplbGVtZW50SWQvZGlzcGxheWVkJzoge1xuICAgIEdFVDoge2NvbW1hbmQ6ICdlbGVtZW50RGlzcGxheWVkJ31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvZWxlbWVudC86ZWxlbWVudElkL2xvY2F0aW9uJzoge1xuICAgIEdFVDoge2NvbW1hbmQ6ICdnZXRMb2NhdGlvbid9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2VsZW1lbnQvOmVsZW1lbnRJZC9sb2NhdGlvbl9pbl92aWV3Jzoge1xuICAgIEdFVDoge2NvbW1hbmQ6ICdnZXRMb2NhdGlvbkluVmlldyd9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2VsZW1lbnQvOmVsZW1lbnRJZC9zaXplJzoge1xuICAgIEdFVDoge2NvbW1hbmQ6ICdnZXRTaXplJ31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvZWxlbWVudC86ZWxlbWVudElkL2Nzcy86cHJvcGVydHlOYW1lJzoge1xuICAgIEdFVDoge2NvbW1hbmQ6ICdnZXRDc3NQcm9wZXJ0eSd9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL29yaWVudGF0aW9uJzoge1xuICAgIEdFVDoge2NvbW1hbmQ6ICdnZXRPcmllbnRhdGlvbid9LFxuICAgIFBPU1Q6IHtjb21tYW5kOiAnc2V0T3JpZW50YXRpb24nLCBwYXlsb2FkUGFyYW1zOiB7cmVxdWlyZWQ6IFsnb3JpZW50YXRpb24nXX19XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL3JvdGF0aW9uJzoge1xuICAgIEdFVDoge2NvbW1hbmQ6ICdnZXRSb3RhdGlvbid9LFxuICAgIFBPU1Q6IHtjb21tYW5kOiAnc2V0Um90YXRpb24nLCBwYXlsb2FkUGFyYW1zOiB7cmVxdWlyZWQ6IFsneCcsICd5JywgJ3onXX19XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL21vdmV0byc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ21vdmVUbycsIHBheWxvYWRQYXJhbXM6IHtvcHRpb25hbDogWydlbGVtZW50JywgJ3hvZmZzZXQnLCAneW9mZnNldCddfX1cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvY2xpY2snOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdjbGlja0N1cnJlbnQnLCBwYXlsb2FkUGFyYW1zOiB7b3B0aW9uYWw6IFsnYnV0dG9uJ119fVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9idXR0b25kb3duJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAnYnV0dG9uRG93bicsIHBheWxvYWRQYXJhbXM6IHtvcHRpb25hbDogWydidXR0b24nXX19XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2J1dHRvbnVwJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAnYnV0dG9uVXAnLCBwYXlsb2FkUGFyYW1zOiB7b3B0aW9uYWw6IFsnYnV0dG9uJ119fVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9kb3VibGVjbGljayc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ2RvdWJsZUNsaWNrJ31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvdG91Y2gvY2xpY2snOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdjbGljaycsIHBheWxvYWRQYXJhbXM6IHtyZXF1aXJlZDogWydlbGVtZW50J119fVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC90b3VjaC9kb3duJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAndG91Y2hEb3duJywgcGF5bG9hZFBhcmFtczoge3JlcXVpcmVkOiBbJ3gnLCAneSddfX1cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvdG91Y2gvdXAnOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICd0b3VjaFVwJywgcGF5bG9hZFBhcmFtczoge3JlcXVpcmVkOiBbJ3gnLCAneSddfX1cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvdG91Y2gvbW92ZSc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ3RvdWNoTW92ZScsIHBheWxvYWRQYXJhbXM6IHtyZXF1aXJlZDogWyd4JywgJ3knXX19XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL3RvdWNoL3Njcm9sbCc6IHtcbiAgICBQT1NUOiB7fVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC90b3VjaC9kb3VibGVjbGljayc6IHtcbiAgICBQT1NUOiB7fVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9hY3Rpb25zJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAncGVyZm9ybUFjdGlvbnMnLCBwYXlsb2FkUGFyYW1zOiB7cmVxdWlyZWQ6IFsnYWN0aW9ucyddfX0sXG4gICAgREVMRVRFOiB7Y29tbWFuZDogJ3JlbGVhc2VBY3Rpb25zJ30sXG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL3RvdWNoL2xvbmdjbGljayc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ3RvdWNoTG9uZ0NsaWNrJywgcGF5bG9hZFBhcmFtczoge3JlcXVpcmVkOiBbJ2VsZW1lbnRzJ119fVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC90b3VjaC9mbGljayc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ2ZsaWNrJywgcGF5bG9hZFBhcmFtczoge29wdGlvbmFsOiBbJ2VsZW1lbnQnLCAneHNwZWVkJywgJ3lzcGVlZCcsICd4b2Zmc2V0JywgJ3lvZmZzZXQnLCAnc3BlZWQnXX19XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2xvY2F0aW9uJzoge1xuICAgIEdFVDoge2NvbW1hbmQ6ICdnZXRHZW9Mb2NhdGlvbid9LFxuICAgIFBPU1Q6IHtjb21tYW5kOiAnc2V0R2VvTG9jYXRpb24nLCBwYXlsb2FkUGFyYW1zOiB7cmVxdWlyZWQ6IFsnbG9jYXRpb24nXX19XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2xvY2FsX3N0b3JhZ2UnOiB7XG4gICAgR0VUOiB7fSxcbiAgICBQT1NUOiB7fSxcbiAgICBERUxFVEU6IHt9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2xvY2FsX3N0b3JhZ2Uva2V5LzprZXknOiB7XG4gICAgR0VUOiB7fSxcbiAgICBERUxFVEU6IHt9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2xvY2FsX3N0b3JhZ2Uvc2l6ZSc6IHtcbiAgICBHRVQ6IHt9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL3Nlc3Npb25fc3RvcmFnZSc6IHtcbiAgICBHRVQ6IHt9LFxuICAgIFBPU1Q6IHt9LFxuICAgIERFTEVURToge31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvc2Vzc2lvbl9zdG9yYWdlL2tleS86a2V5Jzoge1xuICAgIEdFVDoge30sXG4gICAgREVMRVRFOiB7fVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9zZXNzaW9uX3N0b3JhZ2Uvc2l6ZSc6IHtcbiAgICBHRVQ6IHt9XG4gIH0sXG4gIC8vIFNlbGVuaXVtIDQgY2xpZW50c1xuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9zZS9sb2cnOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdnZXRMb2cnLCBwYXlsb2FkUGFyYW1zOiB7cmVxdWlyZWQ6IFsndHlwZSddfX1cbiAgfSxcbiAgLy8gU2VsZW5pdW0gNCBjbGllbnRzXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL3NlL2xvZy90eXBlcyc6IHtcbiAgICBHRVQ6IHtjb21tYW5kOiAnZ2V0TG9nVHlwZXMnfVxuICB9LFxuICAvLyBtanNvbndpcmUsIGFwcGl1bSBjbGllbnRzXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2xvZyc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ2dldExvZycsIHBheWxvYWRQYXJhbXM6IHtyZXF1aXJlZDogWyd0eXBlJ119fVxuICB9LFxuICAvLyBtanNvbndpcmUsIGFwcGl1bSBjbGllbnRzXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2xvZy90eXBlcyc6IHtcbiAgICBHRVQ6IHtjb21tYW5kOiAnZ2V0TG9nVHlwZXMnfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9hcHBsaWNhdGlvbl9jYWNoZS9zdGF0dXMnOiB7XG4gICAgR0VUOiB7fVxuICB9LFxuXG4gIC8vXG4gIC8vIG1qc29ud2lyZVxuICAvL1xuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9jb250ZXh0Jzoge1xuICAgIEdFVDoge2NvbW1hbmQ6ICdnZXRDdXJyZW50Q29udGV4dCd9LFxuICAgIFBPU1Q6IHtjb21tYW5kOiAnc2V0Q29udGV4dCcsIHBheWxvYWRQYXJhbXM6IHtyZXF1aXJlZDogWyduYW1lJ119fVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9jb250ZXh0cyc6IHtcbiAgICBHRVQ6IHtjb21tYW5kOiAnZ2V0Q29udGV4dHMnfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9lbGVtZW50LzplbGVtZW50SWQvcGFnZUluZGV4Jzoge1xuICAgIEdFVDoge2NvbW1hbmQ6ICdnZXRQYWdlSW5kZXgnfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9uZXR3b3JrX2Nvbm5lY3Rpb24nOiB7XG4gICAgR0VUOiB7Y29tbWFuZDogJ2dldE5ldHdvcmtDb25uZWN0aW9uJ30sXG4gICAgUE9TVDoge2NvbW1hbmQ6ICdzZXROZXR3b3JrQ29ubmVjdGlvbicsIHBheWxvYWRQYXJhbXM6IHt1bndyYXA6ICdwYXJhbWV0ZXJzJywgcmVxdWlyZWQ6IFsndHlwZSddfX1cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvdG91Y2gvcGVyZm9ybSc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ3BlcmZvcm1Ub3VjaCcsIHBheWxvYWRQYXJhbXM6IHt3cmFwOiAnYWN0aW9ucycsIHJlcXVpcmVkOiBbJ2FjdGlvbnMnXX19XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL3RvdWNoL211bHRpL3BlcmZvcm0nOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdwZXJmb3JtTXVsdGlBY3Rpb24nLCBwYXlsb2FkUGFyYW1zOiB7cmVxdWlyZWQ6IFsnYWN0aW9ucyddLCBvcHRpb25hbDogWydlbGVtZW50SWQnXX19XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL3JlY2VpdmVfYXN5bmNfcmVzcG9uc2UnOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdyZWNlaXZlQXN5bmNSZXNwb25zZScsIHBheWxvYWRQYXJhbXM6IHtyZXF1aXJlZDogWydzdGF0dXMnLCAndmFsdWUnXX19XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2FwcGl1bS9kZXZpY2Uvc2hha2UnOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdtb2JpbGVTaGFrZSd9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2FwcGl1bS9kZXZpY2Uvc3lzdGVtX3RpbWUnOiB7XG4gICAgR0VUOiB7Y29tbWFuZDogJ2dldERldmljZVRpbWUnLCBwYXlsb2FkUGFyYW1zOiB7b3B0aW9uYWw6IFsnZm9ybWF0J119fSxcbiAgICBQT1NUOiB7Y29tbWFuZDogJ2dldERldmljZVRpbWUnLCBwYXlsb2FkUGFyYW1zOiB7b3B0aW9uYWw6IFsnZm9ybWF0J119fVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9hcHBpdW0vZGV2aWNlL2xvY2snOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdsb2NrJywgcGF5bG9hZFBhcmFtczoge29wdGlvbmFsOiBbJ3NlY29uZHMnXX19XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2FwcGl1bS9kZXZpY2UvdW5sb2NrJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAndW5sb2NrJ31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYXBwaXVtL2RldmljZS9pc19sb2NrZWQnOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdpc0xvY2tlZCd9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2FwcGl1bS9zdGFydF9yZWNvcmRpbmdfc2NyZWVuJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAnc3RhcnRSZWNvcmRpbmdTY3JlZW4nLCBwYXlsb2FkUGFyYW1zOiB7b3B0aW9uYWw6IFsnb3B0aW9ucyddfX1cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYXBwaXVtL3N0b3BfcmVjb3JkaW5nX3NjcmVlbic6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ3N0b3BSZWNvcmRpbmdTY3JlZW4nLCBwYXlsb2FkUGFyYW1zOiB7b3B0aW9uYWw6IFsnb3B0aW9ucyddfX1cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYXBwaXVtL3BlcmZvcm1hbmNlRGF0YS90eXBlcyc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ2dldFBlcmZvcm1hbmNlRGF0YVR5cGVzJ31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYXBwaXVtL2dldFBlcmZvcm1hbmNlRGF0YSc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ2dldFBlcmZvcm1hbmNlRGF0YScsIHBheWxvYWRQYXJhbXM6IHtyZXF1aXJlZDogWydwYWNrYWdlTmFtZScsICdkYXRhVHlwZSddLCBvcHRpb25hbDogWydkYXRhUmVhZFRpbWVvdXQnXX19XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2FwcGl1bS9kZXZpY2UvcHJlc3Nfa2V5Y29kZSc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ3ByZXNzS2V5Q29kZScsIHBheWxvYWRQYXJhbXM6IHtyZXF1aXJlZDogWydrZXljb2RlJ10sIG9wdGlvbmFsOiBbJ21ldGFzdGF0ZScsICdmbGFncyddfX1cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYXBwaXVtL2RldmljZS9sb25nX3ByZXNzX2tleWNvZGUnOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdsb25nUHJlc3NLZXlDb2RlJywgcGF5bG9hZFBhcmFtczoge3JlcXVpcmVkOiBbJ2tleWNvZGUnXSwgb3B0aW9uYWw6IFsnbWV0YXN0YXRlJywgJ2ZsYWdzJ119fVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9hcHBpdW0vZGV2aWNlL2Zpbmdlcl9wcmludCc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ2ZpbmdlcnByaW50JywgcGF5bG9hZFBhcmFtczoge3JlcXVpcmVkOiBbJ2ZpbmdlcnByaW50SWQnXX19XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2FwcGl1bS9kZXZpY2Uvc2VuZF9zbXMnOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdzZW5kU01TJywgcGF5bG9hZFBhcmFtczoge3JlcXVpcmVkOiBbJ3Bob25lTnVtYmVyJywgJ21lc3NhZ2UnXX19XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2FwcGl1bS9kZXZpY2UvZ3NtX2NhbGwnOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdnc21DYWxsJywgcGF5bG9hZFBhcmFtczoge3JlcXVpcmVkOiBbJ3Bob25lTnVtYmVyJywgJ2FjdGlvbiddfX1cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYXBwaXVtL2RldmljZS9nc21fc2lnbmFsJzoge1xuICAgIFBPU1Q6IHtcbiAgICAgIGNvbW1hbmQ6ICdnc21TaWduYWwnLFxuICAgICAgcGF5bG9hZFBhcmFtczoge1xuICAgICAgICB2YWxpZGF0ZTogKGpzb25PYmopID0+ICghdXRpbC5oYXNWYWx1ZShqc29uT2JqLnNpZ25hbFN0cmVuZ3RoKSAmJiAhdXRpbC5oYXNWYWx1ZShqc29uT2JqLnNpZ25hbFN0cmVuZ2gpKSAmJlxuICAgICAgICAgICAgJ3dlIHJlcXVpcmUgb25lIG9mIFwic2lnbmFsU3RyZW5ndGhcIiBvciBcInNpZ25hbFN0cmVuZ2hcIiBwYXJhbXMnLFxuICAgICAgICBvcHRpb25hbDogWydzaWduYWxTdHJlbmd0aCcsICdzaWduYWxTdHJlbmdoJ10sXG4gICAgICAgIC8vIGJhY2t3YXJkLWNvbXBhdGlibGUuIHNvbk9iai5zaWduYWxTdHJlbmd0aCBjYW4gYmUgMFxuICAgICAgICBtYWtlQXJnczogKGpzb25PYmopID0+IFt1dGlsLmhhc1ZhbHVlKGpzb25PYmouc2lnbmFsU3RyZW5ndGgpID8ganNvbk9iai5zaWduYWxTdHJlbmd0aCA6IGpzb25PYmouc2lnbmFsU3RyZW5naF1cbiAgICAgIH1cbiAgICB9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2FwcGl1bS9kZXZpY2UvZ3NtX3ZvaWNlJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAnZ3NtVm9pY2UnLCBwYXlsb2FkUGFyYW1zOiB7cmVxdWlyZWQ6IFsnc3RhdGUnXX19XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2FwcGl1bS9kZXZpY2UvcG93ZXJfY2FwYWNpdHknOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdwb3dlckNhcGFjaXR5JywgcGF5bG9hZFBhcmFtczoge3JlcXVpcmVkOiBbJ3BlcmNlbnQnXX19XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2FwcGl1bS9kZXZpY2UvcG93ZXJfYWMnOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdwb3dlckFDJywgcGF5bG9hZFBhcmFtczoge3JlcXVpcmVkOiBbJ3N0YXRlJ119fVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9hcHBpdW0vZGV2aWNlL25ldHdvcmtfc3BlZWQnOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICduZXR3b3JrU3BlZWQnLCBwYXlsb2FkUGFyYW1zOiB7cmVxdWlyZWQ6IFsnbmV0c3BlZWQnXX19XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2FwcGl1bS9kZXZpY2Uva2V5ZXZlbnQnOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdrZXlldmVudCcsIHBheWxvYWRQYXJhbXM6IHtyZXF1aXJlZDogWydrZXljb2RlJ10sIG9wdGlvbmFsOiBbJ21ldGFzdGF0ZSddfX1cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYXBwaXVtL2RldmljZS9yb3RhdGUnOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdtb2JpbGVSb3RhdGlvbicsIHBheWxvYWRQYXJhbXM6IHtcbiAgICAgIHJlcXVpcmVkOiBbJ3gnLCAneScsICdyYWRpdXMnLCAncm90YXRpb24nLCAndG91Y2hDb3VudCcsICdkdXJhdGlvbiddLFxuICAgICAgb3B0aW9uYWw6IFsnZWxlbWVudCddIH19XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2FwcGl1bS9kZXZpY2UvY3VycmVudF9hY3Rpdml0eSc6IHtcbiAgICBHRVQ6IHtjb21tYW5kOiAnZ2V0Q3VycmVudEFjdGl2aXR5J31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYXBwaXVtL2RldmljZS9jdXJyZW50X3BhY2thZ2UnOiB7XG4gICAgR0VUOiB7Y29tbWFuZDogJ2dldEN1cnJlbnRQYWNrYWdlJ31cbiAgfSxcbiAgLy9yZWdpb24gQXBwbGljYXRpb25zIE1hbmFnZW1lbnRcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYXBwaXVtL2RldmljZS9pbnN0YWxsX2FwcCc6IHtcbiAgICBQT1NUOiB7XG4gICAgICBjb21tYW5kOiAnaW5zdGFsbEFwcCcsXG4gICAgICBwYXlsb2FkUGFyYW1zOiB7XG4gICAgICAgIHJlcXVpcmVkOiBbJ2FwcFBhdGgnXSxcbiAgICAgICAgb3B0aW9uYWw6IFsnb3B0aW9ucyddXG4gICAgICB9XG4gICAgfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9hcHBpdW0vZGV2aWNlL2FjdGl2YXRlX2FwcCc6IHtcbiAgICBQT1NUOiB7XG4gICAgICBjb21tYW5kOiAnYWN0aXZhdGVBcHAnLFxuICAgICAgcGF5bG9hZFBhcmFtczoge1xuICAgICAgICByZXF1aXJlZDogW1snYXBwSWQnXSwgWydidW5kbGVJZCddXSxcbiAgICAgICAgb3B0aW9uYWw6IFsnb3B0aW9ucyddXG4gICAgICB9XG4gICAgfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9hcHBpdW0vZGV2aWNlL3JlbW92ZV9hcHAnOiB7XG4gICAgUE9TVDoge1xuICAgICAgY29tbWFuZDogJ3JlbW92ZUFwcCcsXG4gICAgICBwYXlsb2FkUGFyYW1zOiB7XG4gICAgICAgIHJlcXVpcmVkOiBbWydhcHBJZCddLCBbJ2J1bmRsZUlkJ11dLFxuICAgICAgICBvcHRpb25hbDogWydvcHRpb25zJ11cbiAgICAgIH1cbiAgICB9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2FwcGl1bS9kZXZpY2UvdGVybWluYXRlX2FwcCc6IHtcbiAgICBQT1NUOiB7XG4gICAgICBjb21tYW5kOiAndGVybWluYXRlQXBwJyxcbiAgICAgIHBheWxvYWRQYXJhbXM6IHtcbiAgICAgICAgcmVxdWlyZWQ6IFtbJ2FwcElkJ10sIFsnYnVuZGxlSWQnXV0sXG4gICAgICAgIG9wdGlvbmFsOiBbJ29wdGlvbnMnXVxuICAgICAgfVxuICAgIH1cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYXBwaXVtL2RldmljZS9hcHBfaW5zdGFsbGVkJzoge1xuICAgIFBPU1Q6IHtcbiAgICAgIGNvbW1hbmQ6ICdpc0FwcEluc3RhbGxlZCcsXG4gICAgICBwYXlsb2FkUGFyYW1zOiB7XG4gICAgICAgIHJlcXVpcmVkOiBbWydhcHBJZCddLCBbJ2J1bmRsZUlkJ11dXG4gICAgICB9XG4gICAgfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9hcHBpdW0vZGV2aWNlL2FwcF9zdGF0ZSc6IHtcbiAgICBHRVQ6IHtcbiAgICAgIGNvbW1hbmQ6ICdxdWVyeUFwcFN0YXRlJyxcbiAgICAgIHBheWxvYWRQYXJhbXM6IHtcbiAgICAgICAgcmVxdWlyZWQ6IFtbJ2FwcElkJ10sIFsnYnVuZGxlSWQnXV1cbiAgICAgIH1cbiAgICB9LFxuICAgIFBPU1Q6IHtcbiAgICAgIGNvbW1hbmQ6ICdxdWVyeUFwcFN0YXRlJyxcbiAgICAgIHBheWxvYWRQYXJhbXM6IHtcbiAgICAgICAgcmVxdWlyZWQ6IFtbJ2FwcElkJ10sIFsnYnVuZGxlSWQnXV1cbiAgICAgIH1cbiAgICB9XG4gIH0sXG4gIC8vZW5kcmVnaW9uXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2FwcGl1bS9kZXZpY2UvaGlkZV9rZXlib2FyZCc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ2hpZGVLZXlib2FyZCcsIHBheWxvYWRQYXJhbXM6IHtvcHRpb25hbDogWydzdHJhdGVneScsICdrZXknLCAna2V5Q29kZScsICdrZXlOYW1lJ119fVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9hcHBpdW0vZGV2aWNlL2lzX2tleWJvYXJkX3Nob3duJzoge1xuICAgIEdFVDoge2NvbW1hbmQ6ICdpc0tleWJvYXJkU2hvd24nfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9hcHBpdW0vZGV2aWNlL3B1c2hfZmlsZSc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ3B1c2hGaWxlJywgcGF5bG9hZFBhcmFtczoge3JlcXVpcmVkOiBbJ3BhdGgnLCAnZGF0YSddfX1cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYXBwaXVtL2RldmljZS9wdWxsX2ZpbGUnOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdwdWxsRmlsZScsIHBheWxvYWRQYXJhbXM6IHtyZXF1aXJlZDogWydwYXRoJ119fVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9hcHBpdW0vZGV2aWNlL3B1bGxfZm9sZGVyJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAncHVsbEZvbGRlcicsIHBheWxvYWRQYXJhbXM6IHtyZXF1aXJlZDogWydwYXRoJ119fVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9hcHBpdW0vZGV2aWNlL3RvZ2dsZV9haXJwbGFuZV9tb2RlJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAndG9nZ2xlRmxpZ2h0TW9kZSd9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2FwcGl1bS9kZXZpY2UvdG9nZ2xlX2RhdGEnOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICd0b2dnbGVEYXRhJ31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYXBwaXVtL2RldmljZS90b2dnbGVfd2lmaSc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ3RvZ2dsZVdpRmknfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9hcHBpdW0vZGV2aWNlL3RvZ2dsZV9sb2NhdGlvbl9zZXJ2aWNlcyc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ3RvZ2dsZUxvY2F0aW9uU2VydmljZXMnfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9hcHBpdW0vZGV2aWNlL29wZW5fbm90aWZpY2F0aW9ucyc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ29wZW5Ob3RpZmljYXRpb25zJ31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYXBwaXVtL2RldmljZS9zdGFydF9hY3Rpdml0eSc6IHtcbiAgICBQT1NUOiB7XG4gICAgICBjb21tYW5kOiAnc3RhcnRBY3Rpdml0eScsXG4gICAgICBwYXlsb2FkUGFyYW1zOiB7XG4gICAgICAgIHJlcXVpcmVkOiBbJ2FwcFBhY2thZ2UnLCAnYXBwQWN0aXZpdHknXSxcbiAgICAgICAgb3B0aW9uYWw6IFsnYXBwV2FpdFBhY2thZ2UnLCAnYXBwV2FpdEFjdGl2aXR5JywgJ2ludGVudEFjdGlvbicsXG4gICAgICAgICAgJ2ludGVudENhdGVnb3J5JywgJ2ludGVudEZsYWdzJywgJ29wdGlvbmFsSW50ZW50QXJndW1lbnRzJywgJ2RvbnRTdG9wQXBwT25SZXNldCddXG4gICAgICB9XG4gICAgfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9hcHBpdW0vZGV2aWNlL3N5c3RlbV9iYXJzJzoge1xuICAgIEdFVDoge2NvbW1hbmQ6ICdnZXRTeXN0ZW1CYXJzJ31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYXBwaXVtL2RldmljZS9kaXNwbGF5X2RlbnNpdHknOiB7XG4gICAgR0VUOiB7Y29tbWFuZDogJ2dldERpc3BsYXlEZW5zaXR5J31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYXBwaXVtL3NpbXVsYXRvci90b3VjaF9pZCc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ3RvdWNoSWQnLCBwYXlsb2FkUGFyYW1zOiB7cmVxdWlyZWQ6IFsnbWF0Y2gnXX19XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2FwcGl1bS9zaW11bGF0b3IvdG9nZ2xlX3RvdWNoX2lkX2Vucm9sbG1lbnQnOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICd0b2dnbGVFbnJvbGxUb3VjaElkJywgcGF5bG9hZFBhcmFtczoge29wdGlvbmFsOiBbJ2VuYWJsZWQnXX19XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2FwcGl1bS9hcHAvbGF1bmNoJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAnbGF1bmNoQXBwJ31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYXBwaXVtL2FwcC9jbG9zZSc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ2Nsb3NlQXBwJ31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYXBwaXVtL2FwcC9yZXNldCc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ3Jlc2V0J31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYXBwaXVtL2FwcC9iYWNrZ3JvdW5kJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAnYmFja2dyb3VuZCcsIHBheWxvYWRQYXJhbXM6IHtyZXF1aXJlZDogWydzZWNvbmRzJ119fVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9hcHBpdW0vYXBwL2VuZF90ZXN0X2NvdmVyYWdlJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAnZW5kQ292ZXJhZ2UnLCBwYXlsb2FkUGFyYW1zOiB7cmVxdWlyZWQ6IFsnaW50ZW50JywgJ3BhdGgnXX19XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2FwcGl1bS9hcHAvc3RyaW5ncyc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ2dldFN0cmluZ3MnLCBwYXlsb2FkUGFyYW1zOiB7b3B0aW9uYWw6IFsnbGFuZ3VhZ2UnLCAnc3RyaW5nRmlsZSddfX1cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYXBwaXVtL2VsZW1lbnQvOmVsZW1lbnRJZC92YWx1ZSc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ3NldFZhbHVlSW1tZWRpYXRlJywgcGF5bG9hZFBhcmFtczoge1xuICAgICAgdmFsaWRhdGU6IChqc29uT2JqKSA9PiAoIXV0aWwuaGFzVmFsdWUoanNvbk9iai52YWx1ZSkgJiYgIXV0aWwuaGFzVmFsdWUoanNvbk9iai50ZXh0KSkgJiZcbiAgICAgICAgICAnd2UgcmVxdWlyZSBvbmUgb2YgXCJ0ZXh0XCIgb3IgXCJ2YWx1ZVwiIHBhcmFtcycsXG4gICAgICBvcHRpb25hbDogWyd2YWx1ZScsICd0ZXh0J10sXG4gICAgICAvLyBXZSB3YW50IHRvIGVpdGhlciBhIHZhbHVlIChvbGQgSlNPTldQKSBvciBhIHRleHQgKG5ldyBXM0MpIHBhcmFtZXRlcixcbiAgICAgIC8vIGJ1dCBvbmx5IHNlbmQgb25lIG9mIHRoZW0gdG8gdGhlIGNvbW1hbmQgKG5vdCBib3RoKS5cbiAgICAgIC8vIFByZWZlciAndmFsdWUnIHNpbmNlIGl0J3MgbW9yZSBiYWNrd2FyZC1jb21wYXRpYmxlLlxuICAgICAgbWFrZUFyZ3M6IChqc29uT2JqKSA9PiBbanNvbk9iai52YWx1ZSB8fCBqc29uT2JqLnRleHRdLFxuICAgIH19XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2FwcGl1bS9lbGVtZW50LzplbGVtZW50SWQvcmVwbGFjZV92YWx1ZSc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ3JlcGxhY2VWYWx1ZScsIHBheWxvYWRQYXJhbXM6IHtcbiAgICAgIHZhbGlkYXRlOiAoanNvbk9iaikgPT4gKCF1dGlsLmhhc1ZhbHVlKGpzb25PYmoudmFsdWUpICYmICF1dGlsLmhhc1ZhbHVlKGpzb25PYmoudGV4dCkpICYmXG4gICAgICAgICAgJ3dlIHJlcXVpcmUgb25lIG9mIFwidGV4dFwiIG9yIFwidmFsdWVcIiBwYXJhbXMnLFxuICAgICAgb3B0aW9uYWw6IFsndmFsdWUnLCAndGV4dCddLFxuICAgICAgLy8gV2Ugd2FudCB0byBlaXRoZXIgYSB2YWx1ZSAob2xkIEpTT05XUCkgb3IgYSB0ZXh0IChuZXcgVzNDKSBwYXJhbWV0ZXIsXG4gICAgICAvLyBidXQgb25seSBzZW5kIG9uZSBvZiB0aGVtIHRvIHRoZSBjb21tYW5kIChub3QgYm90aCkuXG4gICAgICAvLyBQcmVmZXIgJ3ZhbHVlJyBzaW5jZSBpdCdzIG1vcmUgYmFja3dhcmQtY29tcGF0aWJsZS5cbiAgICAgIG1ha2VBcmdzOiAoanNvbk9iaikgPT4gW2pzb25PYmoudmFsdWUgPz8ganNvbk9iai50ZXh0ID8/ICcnXSxcbiAgICB9fVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9hcHBpdW0vc2V0dGluZ3MnOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICd1cGRhdGVTZXR0aW5ncycsIHBheWxvYWRQYXJhbXM6IHtyZXF1aXJlZDogWydzZXR0aW5ncyddfX0sXG4gICAgR0VUOiB7Y29tbWFuZDogJ2dldFNldHRpbmdzJ31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYXBwaXVtL3JlY2VpdmVfYXN5bmNfcmVzcG9uc2UnOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdyZWNlaXZlQXN5bmNSZXNwb25zZScsIHBheWxvYWRQYXJhbXM6IHtyZXF1aXJlZDogWydyZXNwb25zZSddfX1cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYXBwaXVtL2V4ZWN1dGVfZHJpdmVyJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAnZXhlY3V0ZURyaXZlclNjcmlwdCcsIHBheWxvYWRQYXJhbXM6IHtyZXF1aXJlZDogWydzY3JpcHQnXSwgb3B0aW9uYWw6IFsndHlwZScsICd0aW1lb3V0J119fVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9hcHBpdW0vZXZlbnRzJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAnZ2V0TG9nRXZlbnRzJywgcGF5bG9hZFBhcmFtczoge29wdGlvbmFsOiBbJ3R5cGUnXX19XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2FwcGl1bS9sb2dfZXZlbnQnOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdsb2dDdXN0b21FdmVudCcsIHBheWxvYWRQYXJhbXM6IHtyZXF1aXJlZDogWyd2ZW5kb3InLCAnZXZlbnQnXX19XG4gIH0sXG5cblxuICAvKlxuICAgKiBUaGUgVzNDIHNwZWMgaGFzIHNvbWUgY2hhbmdlcyB0byB0aGUgd2lyZSBwcm90b2NvbC5cbiAgICogaHR0cHM6Ly93M2MuZ2l0aHViLmlvL3dlYmRyaXZlci93ZWJkcml2ZXItc3BlYy5odG1sXG4gICAqIEJlZ2luIHRvIGFkZCB0aG9zZSBjaGFuZ2VzIGhlcmUsIGtlZXBpbmcgdGhlIG9sZCB2ZXJzaW9uXG4gICAqIHNpbmNlIGNsaWVudHMgc3RpbGwgaW1wbGVtZW50IHRoZW0uXG4gICAqL1xuICAvLyBvbGQgYWxlcnRzXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2FsZXJ0X3RleHQnOiB7XG4gICAgR0VUOiB7Y29tbWFuZDogJ2dldEFsZXJ0VGV4dCd9LFxuICAgIFBPU1Q6IHtcbiAgICAgIGNvbW1hbmQ6ICdzZXRBbGVydFRleHQnLFxuICAgICAgcGF5bG9hZFBhcmFtczogU0VUX0FMRVJUX1RFWFRfUEFZTE9BRF9QQVJBTVMsXG4gICAgfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9hY2NlcHRfYWxlcnQnOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdwb3N0QWNjZXB0QWxlcnQnfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9kaXNtaXNzX2FsZXJ0Jzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAncG9zdERpc21pc3NBbGVydCd9XG4gIH0sXG4gIC8vIGh0dHBzOi8vdzNjLmdpdGh1Yi5pby93ZWJkcml2ZXIvd2ViZHJpdmVyLXNwZWMuaHRtbCN1c2VyLXByb21wdHNcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYWxlcnQvdGV4dCc6IHtcbiAgICBHRVQ6IHtjb21tYW5kOiAnZ2V0QWxlcnRUZXh0J30sXG4gICAgUE9TVDoge1xuICAgICAgY29tbWFuZDogJ3NldEFsZXJ0VGV4dCcsXG4gICAgICBwYXlsb2FkUGFyYW1zOiBTRVRfQUxFUlRfVEVYVF9QQVlMT0FEX1BBUkFNUyxcbiAgICB9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2FsZXJ0L2FjY2VwdCc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ3Bvc3RBY2NlcHRBbGVydCd9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2FsZXJ0L2Rpc21pc3MnOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdwb3N0RGlzbWlzc0FsZXJ0J31cbiAgfSxcbiAgLy8gaHR0cHM6Ly93M2MuZ2l0aHViLmlvL3dlYmRyaXZlci93ZWJkcml2ZXItc3BlYy5odG1sI2dldC1lbGVtZW50LXJlY3RcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvZWxlbWVudC86ZWxlbWVudElkL3JlY3QnOiB7XG4gICAgR0VUOiB7Y29tbWFuZDogJ2dldEVsZW1lbnRSZWN0J31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvZXhlY3V0ZS9zeW5jJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAnZXhlY3V0ZScsIHBheWxvYWRQYXJhbXM6IHtyZXF1aXJlZDogWydzY3JpcHQnLCAnYXJncyddfX1cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvZXhlY3V0ZS9hc3luYyc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ2V4ZWN1dGVBc3luYycsIHBheWxvYWRQYXJhbXM6IHtyZXF1aXJlZDogWydzY3JpcHQnLCAnYXJncyddfX1cbiAgfSxcbiAgLy8gUHJlLVczQyBlbmRwb2ludCBmb3IgZWxlbWVudCBzY3JlZW5zaG90XG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL3NjcmVlbnNob3QvOmVsZW1lbnRJZCc6IHtcbiAgICBHRVQ6IHtjb21tYW5kOiAnZ2V0RWxlbWVudFNjcmVlbnNob3QnfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC9lbGVtZW50LzplbGVtZW50SWQvc2NyZWVuc2hvdCc6IHtcbiAgICBHRVQ6IHtjb21tYW5kOiAnZ2V0RWxlbWVudFNjcmVlbnNob3QnfVxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC93aW5kb3cvcmVjdCc6IHtcbiAgICBHRVQ6IHtjb21tYW5kOiAnZ2V0V2luZG93UmVjdCd9LFxuICAgIFBPU1Q6IHtjb21tYW5kOiAnc2V0V2luZG93UmVjdCd9LFxuICB9LFxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC93aW5kb3cvbWF4aW1pemUnOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdtYXhpbWl6ZVdpbmRvdyd9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL3dpbmRvdy9taW5pbWl6ZSc6IHtcbiAgICBQT1NUOiB7Y29tbWFuZDogJ21pbmltaXplV2luZG93J31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvd2luZG93L2Z1bGxzY3JlZW4nOiB7XG4gICAgUE9TVDoge2NvbW1hbmQ6ICdmdWxsU2NyZWVuV2luZG93J31cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvZWxlbWVudC86ZWxlbWVudElkL3Byb3BlcnR5LzpuYW1lJzoge1xuICAgIEdFVDoge2NvbW1hbmQ6ICdnZXRQcm9wZXJ0eSd9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2FwcGl1bS9kZXZpY2Uvc2V0X2NsaXBib2FyZCc6IHtcbiAgICBQT1NUOiB7XG4gICAgICBjb21tYW5kOiAnc2V0Q2xpcGJvYXJkJyxcbiAgICAgIHBheWxvYWRQYXJhbXM6IHtcbiAgICAgICAgcmVxdWlyZWQ6IFsnY29udGVudCddLFxuICAgICAgICBvcHRpb25hbDogW1xuICAgICAgICAgICdjb250ZW50VHlwZScsXG4gICAgICAgICAgJ2xhYmVsJyxcbiAgICAgICAgXVxuICAgICAgfSxcbiAgICB9XG4gIH0sXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL2FwcGl1bS9kZXZpY2UvZ2V0X2NsaXBib2FyZCc6IHtcbiAgICBQT1NUOiB7XG4gICAgICBjb21tYW5kOiAnZ2V0Q2xpcGJvYXJkJyxcbiAgICAgIHBheWxvYWRQYXJhbXM6IHtcbiAgICAgICAgb3B0aW9uYWw6IFtcbiAgICAgICAgICAnY29udGVudFR5cGUnLFxuICAgICAgICBdXG4gICAgICB9LFxuICAgIH1cbiAgfSxcbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvYXBwaXVtL2NvbXBhcmVfaW1hZ2VzJzoge1xuICAgIFBPU1Q6IHtcbiAgICAgIGNvbW1hbmQ6ICdjb21wYXJlSW1hZ2VzJyxcbiAgICAgIHBheWxvYWRQYXJhbXM6IHtcbiAgICAgICAgcmVxdWlyZWQ6IFsnbW9kZScsICdmaXJzdEltYWdlJywgJ3NlY29uZEltYWdlJ10sXG4gICAgICAgIG9wdGlvbmFsOiBbJ29wdGlvbnMnXVxuICAgICAgfSxcbiAgICB9XG4gIH0sXG5cbiAgLy8gY2hyb21pdW0gZGV2dG9vbHNcbiAgLy8gaHR0cHM6Ly9jaHJvbWl1bS5nb29nbGVzb3VyY2UuY29tL2Nocm9taXVtL3NyYy8rL21hc3Rlci9jaHJvbWUvdGVzdC9jaHJvbWVkcml2ZXIvc2VydmVyL2h0dHBfaGFuZGxlci5jY1xuICAnL3Nlc3Npb24vOnNlc3Npb25JZC86dmVuZG9yL2NkcC9leGVjdXRlJzoge1xuICAgIFBPU1Q6IHtjb21tYW5kOiAnZXhlY3V0ZUNkcCcsIHBheWxvYWRQYXJhbXM6IHtyZXF1aXJlZDogWydjbWQnLCAncGFyYW1zJ119fVxuICB9LFxuXG4gIC8vcmVnaW9uIFdlYmF1dGhuXG4gIC8vIGh0dHBzOi8vd3d3LnczLm9yZy9UUi93ZWJhdXRobi0yLyNzY3RuLWF1dG9tYXRpb24tYWRkLXZpcnR1YWwtYXV0aGVudGljYXRvclxuXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL3dlYmF1dGhuL2F1dGhlbnRpY2F0b3InOiB7XG4gICAgUE9TVDoge1xuICAgICAgY29tbWFuZDogJ2FkZFZpcnR1YWxBdXRoZW50aWNhdG9yJyxcbiAgICAgIHBheWxvYWRQYXJhbXM6IHtcbiAgICAgICAgcmVxdWlyZWQ6IFsncHJvdG9jb2wnLCAndHJhbnNwb3J0J10sXG4gICAgICAgIG9wdGlvbmFsOiBbJ2hhc1Jlc2lkZW50S2V5JywgJ2hhc1VzZXJWZXJpZmljYXRpb24nLCAnaXNVc2VyQ29uc2VudGluZycsICdpc1VzZXJWZXJpZmllZCddLFxuICAgICAgfVxuICAgIH1cbiAgfSxcblxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC93ZWJhdXRobi9hdXRoZW50aWNhdG9yLzphdXRoZW50aWNhdG9ySWQnOiB7XG4gICAgREVMRVRFOiB7XG4gICAgICBjb21tYW5kOiAncmVtb3ZlVmlydHVhbEF1dGhlbnRpY2F0b3InXG4gICAgfVxuICB9LFxuXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL3dlYmF1dGhuL2F1dGhlbnRpY2F0b3IvOmF1dGhlbnRpY2F0b3JJZC9jcmVkZW50aWFsJzoge1xuICAgIFBPU1Q6IHtcbiAgICAgIGNvbW1hbmQ6ICdhZGRBdXRoQ3JlZGVudGlhbCcsXG4gICAgICBwYXlsb2FkUGFyYW1zOiB7XG4gICAgICAgIHJlcXVpcmVkOiBbJ2NyZWRlbnRpYWxJZCcsICdpc1Jlc2lkZW50Q3JlZGVudGlhbCcsICdycElkJywgJ3ByaXZhdGVLZXknXSxcbiAgICAgICAgb3B0aW9uYWw6IFsndXNlckhhbmRsZScsICdzaWduQ291bnQnXSxcbiAgICAgIH1cbiAgICB9XG4gIH0sXG5cbiAgJy9zZXNzaW9uLzpzZXNzaW9uSWQvd2ViYXV0aG4vYXV0aGVudGljYXRvci86YXV0aGVudGljYXRvcklkL2NyZWRlbnRpYWxzJzoge1xuICAgIEdFVDoge2NvbW1hbmQ6ICdnZXRBdXRoQ3JlZGVudGlhbCd9LFxuICAgIERFTEVURToge2NvbW1hbmQ6ICdyZW1vdmVBbGxBdXRoQ3JlZGVudGlhbHMnfSxcbiAgfSxcblxuICAnL3Nlc3Npb24vOnNlc3Npb25JZC93ZWJhdXRobi9hdXRoZW50aWNhdG9yLzphdXRoZW50aWNhdG9ySWQvY3JlZGVudGlhbHMvOmNyZWRlbnRpYWxJZCc6IHtcbiAgICBERUxFVEU6IHtjb21tYW5kOiAncmVtb3ZlQXV0aENyZWRlbnRpYWwnfVxuICB9LFxuXG4gICcvc2Vzc2lvbi86c2Vzc2lvbklkL3dlYmF1dGhuL2F1dGhlbnRpY2F0b3IvOmF1dGhlbnRpY2F0b3JJZC91dic6IHtcbiAgICBQT1NUOiB7XG4gICAgICBjb21tYW5kOiAnc2V0VXNlckF1dGhWZXJpZmllZCcsXG4gICAgICBwYXlsb2FkUGFyYW1zOiB7XG4gICAgICAgIHJlcXVpcmVkOiBbJ2lzVXNlclZlcmlmaWVkJ11cbiAgICAgIH1cbiAgICB9XG4gIH0sXG5cbiAgLy9lbmRyZWdpb25cblxufTtcblxuLy8gZHJpdmVyIGNvbW1hbmQgbmFtZXNcbmxldCBBTExfQ09NTUFORFMgPSBbXTtcbmZvciAobGV0IHYgb2YgXy52YWx1ZXMoTUVUSE9EX01BUCkpIHtcbiAgZm9yIChsZXQgbSBvZiBfLnZhbHVlcyh2KSkge1xuICAgIGlmIChtLmNvbW1hbmQpIHtcbiAgICAgIEFMTF9DT01NQU5EUy5wdXNoKG0uY29tbWFuZCk7XG4gICAgfVxuICB9XG59XG5cbmNvbnN0IFJFX0VTQ0FQRSA9IC9bLVtcXF17fSgpKz8uLFxcXFxeJHwjXFxzXS9nO1xuY29uc3QgUkVfUEFSQU0gPSAvKFs6Kl0pKFxcdyspL2c7XG5cbmNsYXNzIFJvdXRlIHtcbiAgY29uc3RydWN0b3IgKHJvdXRlKSB7XG4gICAgdGhpcy5wYXJhbU5hbWVzID0gW107XG5cbiAgICBsZXQgcmVTdHIgPSByb3V0ZS5yZXBsYWNlKFJFX0VTQ0FQRSwgJ1xcXFwkJicpO1xuICAgIHJlU3RyID0gcmVTdHIucmVwbGFjZShSRV9QQVJBTSwgKF8sIG1vZGUsIG5hbWUpID0+IHtcbiAgICAgIHRoaXMucGFyYW1OYW1lcy5wdXNoKG5hbWUpO1xuICAgICAgcmV0dXJuIG1vZGUgPT09ICc6JyA/ICcoW14vXSopJyA6ICcoLiopJztcbiAgICB9KTtcbiAgICB0aGlzLnJvdXRlUmVnZXhwID0gbmV3IFJlZ0V4cChgXiR7cmVTdHJ9JGApO1xuICB9XG5cbiAgcGFyc2UgKHVybCkge1xuICAgIC8vaWYgKHVybC5pbmRleE9mKCd0aW1lb3V0cycpICE9PSAtMSAmJiB0aGlzLnJvdXRlUmVnZXhwLnRvU3RyaW5nKCkuaW5kZXhPZigndGltZW91dHMnKSAhPT0gLTEpIHtcbiAgICAvL2RlYnVnZ2VyO1xuICAgIC8vfVxuICAgIGxldCBtYXRjaGVzID0gdXJsLm1hdGNoKHRoaXMucm91dGVSZWdleHApO1xuICAgIGlmICghbWF0Y2hlcykgcmV0dXJuOyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIGN1cmx5XG4gICAgbGV0IGkgPSAwO1xuICAgIGxldCBwYXJhbXMgPSB7fTtcbiAgICB3aGlsZSAoaSA8IHRoaXMucGFyYW1OYW1lcy5sZW5ndGgpIHtcbiAgICAgIGNvbnN0IHBhcmFtTmFtZSA9IHRoaXMucGFyYW1OYW1lc1tpKytdO1xuICAgICAgcGFyYW1zW3BhcmFtTmFtZV0gPSBtYXRjaGVzW2ldO1xuICAgIH1cbiAgICByZXR1cm4gcGFyYW1zO1xuICB9XG59XG5cbmZ1bmN0aW9uIHJvdXRlVG9Db21tYW5kTmFtZSAoZW5kcG9pbnQsIG1ldGhvZCwgYmFzZVBhdGggPSBERUZBVUxUX0JBU0VfUEFUSCkge1xuICBsZXQgZHN0Um91dGUgPSBudWxsO1xuXG4gIC8vIHJlbW92ZSBhbnkgcXVlcnkgc3RyaW5nXG4gIGlmIChlbmRwb2ludC5pbmNsdWRlcygnPycpKSB7XG4gICAgZW5kcG9pbnQgPSBlbmRwb2ludC5zbGljZSgwLCBlbmRwb2ludC5pbmRleE9mKCc/JykpO1xuICB9XG5cbiAgY29uc3QgYWN0dWFsRW5kcG9pbnQgPSBlbmRwb2ludCA9PT0gJy8nID8gJycgOlxuICAgIChfLnN0YXJ0c1dpdGgoZW5kcG9pbnQsICcvJykgPyBlbmRwb2ludCA6IGAvJHtlbmRwb2ludH1gKTtcblxuICBmb3IgKGxldCBjdXJyZW50Um91dGUgb2YgXy5rZXlzKE1FVEhPRF9NQVApKSB7XG4gICAgY29uc3Qgcm91dGUgPSBuZXcgUm91dGUoYCR7YmFzZVBhdGh9JHtjdXJyZW50Um91dGV9YCk7XG4gICAgLy8gd2UgZG9uJ3QgY2FyZSBhYm91dCB0aGUgYWN0dWFsIHNlc3Npb24gaWQgZm9yIG1hdGNoaW5nXG4gICAgaWYgKHJvdXRlLnBhcnNlKGAke2Jhc2VQYXRofS9zZXNzaW9uL2lnbm9yZWQtc2Vzc2lvbi1pZCR7YWN0dWFsRW5kcG9pbnR9YCkgfHxcbiAgICAgICAgcm91dGUucGFyc2UoYCR7YmFzZVBhdGh9JHthY3R1YWxFbmRwb2ludH1gKSB8fCByb3V0ZS5wYXJzZShhY3R1YWxFbmRwb2ludCkpIHtcbiAgICAgIGRzdFJvdXRlID0gY3VycmVudFJvdXRlO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG4gIGlmICghZHN0Um91dGUpIHJldHVybjsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBjdXJseVxuXG4gIGNvbnN0IG1ldGhvZHMgPSBfLmdldChNRVRIT0RfTUFQLCBkc3RSb3V0ZSk7XG4gIG1ldGhvZCA9IF8udG9VcHBlcihtZXRob2QpO1xuICBpZiAoXy5oYXMobWV0aG9kcywgbWV0aG9kKSkge1xuICAgIGNvbnN0IGRzdE1ldGhvZCA9IF8uZ2V0KG1ldGhvZHMsIG1ldGhvZCk7XG4gICAgaWYgKGRzdE1ldGhvZC5jb21tYW5kKSB7XG4gICAgICByZXR1cm4gZHN0TWV0aG9kLmNvbW1hbmQ7XG4gICAgfVxuICB9XG59XG5cbi8vIGRyaXZlciBjb21tYW5kcyB0aGF0IGRvIG5vdCByZXF1aXJlIGEgc2Vzc2lvbiB0byBhbHJlYWR5IGV4aXN0XG5jb25zdCBOT19TRVNTSU9OX0lEX0NPTU1BTkRTID0gWydjcmVhdGVTZXNzaW9uJywgJ2dldFN0YXR1cycsICdnZXRTdGF0dXNXREEnLCAnZ2V0U2Vzc2lvbnMnXTtcblxuZXhwb3J0IHsgTUVUSE9EX01BUCwgQUxMX0NPTU1BTkRTLCBOT19TRVNTSU9OX0lEX0NPTU1BTkRTLCByb3V0ZVRvQ29tbWFuZE5hbWUgfTtcbiJdLCJmaWxlIjoibGliL3Byb3RvY29sL3JvdXRlcy5qcyIsInNvdXJjZVJvb3QiOiIuLi8uLi8uLiJ9
