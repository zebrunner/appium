#!/bin/bash

# "${PLATFORM_NAME^^}" this convert var value into upper case.
if [[ "${PLATFORM_NAME^^}" == "ANDROID" ]]; then
  # device type
  isTablet=`adb shell getprop ro.build.characteristics | grep tablet`
  isTv=`adb shell getprop ro.build.characteristics | grep tv`

  # version
  PLATFORM_VERSION=`adb shell getprop | grep -m 1 ro.build.version.release |  sed 's/^.*:.*\[\(.*\)\].*$/\1/g'`

  if [[ $isTablet ]]
  then
    DEVICETYPE='Tablet'
  elif [[ $isTv ]]
  then
    DEVICETYPE='TV'
  else
    DEVICETYPE='Phone'
  fi

  if [[ ${PLATFORM_VERSION} == 4* ]] || [[ ${PLATFORM_VERSION} == 5* ]] || [[ ${PLATFORM_VERSION} == 6* ]]
  then
    export AUTOMATION_NAME='Appium'
  else
    export AUTOMATION_NAME='uiautomator2'
  fi
elif [[ "${PLATFORM_NAME^^}" == "IOS" ]]; then
  export AUTOMATION_NAME='XCUITest'
  # TODO: detect tablet and TV for iOS
  DEVICETYPE='Phone'
  #TODO: find valid iOS device version
  export PLATFORM_VERSION=14.7.1

  export WDA_PORT=8100
  export MJPEG_PORT=8101
  export deviceIP=192.168.88.155
else
  echo "Undefined platform $PLATFORM_NAME detected!"
  exit -1
fi

cat << EndOfMessage
{
  "capabilities":
      [
        {
          "maxInstances": 1,
          "deviceName": "${DEVICE_NAME}",
          "deviceType": "${DEVICETYPE}",
          "platformName":"${PLATFORM_NAME^^}",
          "platformVersion":"${PLATFORM_VERSION}",
	  "udid": "${DEVICE_UDID}",
	  "adb_port": ${ADB_PORT},
	  "proxy_port": ${PROXY_PORT},
          "automationName": "${AUTOMATION_NAME}"
        }
      ],
  "configuration":
  {
    "proxy": "com.zebrunner.mcloud.grid.MobileRemoteProxy",
    "url":"http://${STF_PROVIDER_HOST}:${STF_PROVIDER_APPIUM_PORT}/wd/hub",
    "host": "${STF_PROVIDER_HOST}",
    "port": ${STF_PROVIDER_APPIUM_PORT},
    "hubHost": "${SELENIUM_HOST}",
    "hubPort": ${SELENIUM_PORT},
    "maxSession": 1,
    "register": true,
    "registerCycle": 5000,
    "cleanUpCycle": 5000,
    "timeout": 180,
    "browserTimeout": 0,
    "nodeStatusCheckTimeout": 5000,
    "nodePolling": 5000,
    "role": "node",
    "unregisterIfStillDownAfter": 60000,
    "downPollingLimit": 2,
    "debug": false,
    "servlets" : [],
    "withoutServlets": [],
    "custom": {}
  }
}
EndOfMessage
