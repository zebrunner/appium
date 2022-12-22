#!/bin/bash

#IMPORTANT!!! Don't do any echo otherwise you corrupt generated nodeconfig.json
# convert to lower case using Linux/Mac compatible syntax (bash v3.2)
PLATFORM_NAME=`echo "$PLATFORM_NAME" |  tr '[:upper:]' '[:lower:]'`
cat << EndOfMessage
{
  "capabilities":
      [
        {
          "maxInstances": 1,
          "deviceName": "${DEVICE_NAME}",
          "deviceType": "${DEVICETYPE}",
          "platformName":"${PLATFORM_NAME}",
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
    "url":"http://${STF_PROVIDER_HOST}:${APPIUM_PORT}/wd/hub",
    "host": "${STF_PROVIDER_HOST}",
    "port": ${APPIUM_PORT},
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
    "unregisterIfStillDownAfter": ${UNREGISTER_IF_STILL_DOWN_AFTER},
    "downPollingLimit": 2,
    "debug": false,
    "servlets" : [],
    "withoutServlets": [],
    "custom": {}
  }
}
EndOfMessage
