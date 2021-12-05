#!/bin/bash

#TODO: move device dta parsing into se[arate sh script. Kepp here only config json generation
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
  # TODO: detect tablet and TV for iOS, also review `ios info` output data like below
    #"DeviceClass":"iPhone",
    #"ProductName":"iPhone OS",
    #"ProductType":"iPhone10,5",
    #"ProductVersion":"14.7.1",
    #"SerialNumber":"C38V961BJCM2",
    #"TimeZone":"Europe/Minsk",
    #"TimeZoneOffsetFromUTC":10800,

  DEVICETYPE='Phone'
  export PLATFORM_VERSION=$(ios info --udid=$DEVICE_UDID | jq -r ".ProductVersion")
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
