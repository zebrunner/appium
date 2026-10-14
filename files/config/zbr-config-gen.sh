#!/bin/bash
# Prints the Selenium Grid 3 node config of the device for mcloud-grid (Appium --nodeconfig).
# jq builds the JSON: the strings are escaped, a wrong number fails the script.
#IMPORTANT!!! Don't print anything else to stdout otherwise you corrupt the generated json

# the logger of the image, files/util/logger.sh when the script runs from the repository (tests/config_test.sh)
loggerSh=/opt/logger.sh
[[ -f "$loggerSh" ]] || loggerSh="$(dirname "$0")/../util/logger.sh"
# shellcheck source=../util/logger.sh
. "$loggerSh"

# number <name> <value>: prints the value if it is a non-negative integer, otherwise an error and exit 1
number() {
  if [[ ! "$2" =~ ^[0-9]+$ ]]; then
    logger "ERROR" "$1 must be a number, got '$2'" >&2
    exit 1
  fi
  echo "$2"
}

# convert to lower case using Linux/Mac compatible syntax (bash v3.2)
PLATFORM_NAME="$(printf '%s' "$PLATFORM_NAME" | tr '[:upper:]' '[:lower:]')"

adbPort="$(number ADB_PORT "$ADB_PORT")" || exit 1
proxyPort="$(number PROXY_PORT "$PROXY_PORT")" || exit 1
serverProxyPort="$(number SERVER_PROXY_PORT "$SERVER_PROXY_PORT")" || exit 1
appiumPort="$(number APPIUM_PORT "$APPIUM_PORT")" || exit 1
hubPort="$(number SELENIUM_PORT "$SELENIUM_PORT")" || exit 1
unregisterIfStillDownAfter="$(number UNREGISTER_IF_STILL_DOWN_AFTER "$UNREGISTER_IF_STILL_DOWN_AFTER")" || exit 1

jq -n \
  --arg deviceName "$DEVICE_NAME" \
  --arg deviceType "$DEVICETYPE" \
  --arg platformName "$PLATFORM_NAME" \
  --arg platformVersion "$PLATFORM_VERSION" \
  --arg udid "$DEVICE_UDID" \
  --arg automationName "$AUTOMATION_NAME" \
  --arg host "$STF_PROVIDER_HOST" \
  --arg hubHost "$SELENIUM_HOST" \
  --argjson adbPort "$adbPort" \
  --argjson proxyPort "$proxyPort" \
  --argjson serverProxyPort "$serverProxyPort" \
  --argjson port "$appiumPort" \
  --argjson hubPort "$hubPort" \
  --argjson unregisterIfStillDownAfter "$unregisterIfStillDownAfter" \
  '{
    "capabilities": [
      {
        "maxInstances": 1,
        "deviceName": $deviceName,
        "deviceType": $deviceType,
        "platformName": $platformName,
        "platformVersion": $platformVersion,
        "udid": $udid,
        "adb_port": $adbPort,
        "proxy_port": $proxyPort,
        "automationName": $automationName,
        "server_proxy_port": $serverProxyPort
      }
    ],
    "configuration": {
      "proxy": "com.zebrunner.mcloud.grid.MobileRemoteProxy",
      "url": "http://\($host):\($port)/wd/hub",
      "host": $host,
      "port": $port,
      "hubHost": $hubHost,
      "hubPort": $hubPort,
      "maxSession": 1,
      "register": true,
      "registerCycle": 5000,
      "cleanUpCycle": 5000,
      "timeout": 150,
      "browserTimeout": 0,
      "nodeStatusCheckTimeout": 5000,
      "nodePolling": 5000,
      "role": "node",
      "unregisterIfStillDownAfter": $unregisterIfStillDownAfter,
      "downPollingLimit": 3,
      "debug": false,
      "servlets": [],
      "withoutServlets": [],
      "custom": {}
    }
  }'
