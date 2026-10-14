#!/bin/bash
# Prints the default capabilities of the device (Appium --default-capabilities) for PLATFORM_NAME android or ios,
# nothing for other platforms. jq builds the JSON: the strings are escaped, a wrong number fails the script.
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

if [[ "${PLATFORM_NAME}" == "android" ]]; then
  chromedriverPort="$(number CHROMEDRIVER_PORT "$CHROMEDRIVER_PORT")" || exit 1
  # CHROME_OPTIONS is a fragment of a JSON object: "androidDevToolsPort": 9222
  if ! chromeOptions="$(jq -c . <<< "{${CHROME_OPTIONS}}" 2> /dev/null)"; then
    logger "ERROR" "CHROME_OPTIONS must be the members of a JSON object, got '${CHROME_OPTIONS}'" >&2
    exit 1
  fi
  jq -n \
    --arg platformName "$PLATFORM_NAME" \
    --arg platformVersion "$PLATFORM_VERSION" \
    --arg deviceName "$DEVICE_NAME" \
    --arg udid "$DEVICE_UDID" \
    --arg automationName "$AUTOMATION_NAME" \
    --arg remoteAdbHost "$REMOTE_ADB_HOST" \
    --argjson chromedriverPort "$chromedriverPort" \
    --argjson chromeOptions "$chromeOptions" \
    '{
      "platformName": $platformName,
      "appium:platformVersion": $platformVersion,
      "appium:deviceName": $deviceName,
      "appium:udid": $udid,
      "appium:automationName": $automationName,
      "appium:remoteAdbHost": $remoteAdbHost,
      "appium:chromedriverPort": $chromedriverPort,
      "appium:chromeOptions": $chromeOptions
    }'
fi

#TODO: review extra default params we used in mcloud-ios
#'{"webkitDebugProxyPort": '${iwdp_port}'

if [[ "${PLATFORM_NAME}" == "ios" ]]; then
  mjpegServerPort="$(number MJPEG_PORT "$MJPEG_PORT")" || exit 1
  wdaPort="$(number WDA_PORT "$WDA_PORT")" || exit 1
  jq -n \
    --arg platformName "$PLATFORM_NAME" \
    --arg platformVersion "$PLATFORM_VERSION" \
    --arg deviceName "$DEVICE_NAME" \
    --arg udid "$DEVICE_UDID" \
    --arg automationName "$AUTOMATION_NAME" \
    --arg webDriverAgentUrl "http://${WDA_HOST}:${wdaPort}" \
    --argjson mjpegServerPort "$mjpegServerPort" \
    --argjson wdaLocalPort "$wdaPort" \
    '{
      "platformName": $platformName,
      "appium:platformVersion": $platformVersion,
      "appium:deviceName": $deviceName,
      "appium:udid": $udid,
      "appium:automationName": $automationName,
      "appium:mjpegServerPort": $mjpegServerPort,
      "appium:clearSystemFiles": false,
      "appium:webDriverAgentUrl": $webDriverAgentUrl,
      "appium:simpleIsVisibleCheck": true,
      "appium:wdaLocalPort": $wdaLocalPort
    }'
fi
