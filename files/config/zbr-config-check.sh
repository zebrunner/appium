#!/bin/bash
# Checks the configuration of the container before anything starts (CONVENTIONS.md#exit-codes): every invalid variable
# is logged, the exit status is 1 when one of them is invalid. The entrypoint then ends the container with 0: a restart
# does not fix a configuration. The config generators zbr-*-gen.sh check the same values again.

# the logger of the image, files/util/logger.sh when the script runs from the repository (tests/config_test.sh)
loggerSh=/opt/logger.sh
[[ -f "$loggerSh" ]] || loggerSh="$(dirname "$0")/../util/logger.sh"
# shellcheck source=../util/logger.sh
. "$loggerSh"

status=0

# invalidVar <message>: logs an invalid variable
invalidVar() {
  logger "ERROR" "Invalid configuration: $1"
  status=1
}

# requireValue <name> <reason>: the variable is set and not empty
requireValue() {
  [[ -n "$(printenv "$1")" ]] || invalidVar "$1 is required $2"
}

# requireNumber <name> [<reason>]: the variable is a non-negative integer
requireNumber() {
  local value
  value="$(printenv "$1")"
  [[ "$value" =~ ^[0-9]+$ ]] || invalidVar "$1 must be a number${2:+ $2}, got '${value}'"
}

requireNumber APPIUM_PORT
requireNumber UNREGISTER_IF_STILL_DOWN_AFTER

if [[ "$CONNECT_TO_GRID" == "true" ]]; then
  requireValue SELENIUM_HOST "with CONNECT_TO_GRID=true"
  requireNumber SELENIUM_PORT "with CONNECT_TO_GRID=true"
  requireValue STF_PROVIDER_HOST "with CONNECT_TO_GRID=true"
  requireNumber ADB_PORT "with CONNECT_TO_GRID=true"
fi

if [[ "$DEFAULT_CAPABILITIES" == "true" ]]; then
  case "$(printf '%s' "$PLATFORM_NAME" | tr '[:upper:]' '[:lower:]')" in
  android)
    requireNumber CHROMEDRIVER_PORT "with DEFAULT_CAPABILITIES=true"
    # CHROME_OPTIONS is a fragment of a JSON object: "androidDevToolsPort": 9222
    jq . <<< "{${CHROME_OPTIONS}}" > /dev/null 2>&1 ||
      invalidVar "CHROME_OPTIONS must be the members of a JSON object, got '${CHROME_OPTIONS}'"
    ;;
  ios)
    requireNumber WDA_PORT "with DEFAULT_CAPABILITIES=true"
    requireNumber MJPEG_PORT "with DEFAULT_CAPABILITIES=true"
    ;;
  esac
fi

exit "$status"
