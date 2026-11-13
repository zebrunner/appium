#!/bin/bash

# shellcheck source=util/debug.sh
. /opt/debug.sh
# shellcheck source=util/logger.sh
. /opt/logger.sh
# shellcheck source=module/recording.sh
. /opt/recording.sh

NODE_CONFIG_JSON="$APPIUM_CONFIG_DIR/nodeconfig.json"
DEFAULT_CAPABILITIES_JSON="$APPIUM_CONFIG_DIR/defaultcapabilities.json"

# show list of plugins including installed ones
appium plugin list

# the Appium command as an array: the arguments keep their values as is
CMD=(appium --log-no-colors --log-timestamp -pa /wd/hub --port "$APPIUM_PORT" --log "$TASK_LOG" --log-level "$LOG_LEVEL")
# APPIUM_CLI holds several arguments
read -r -a appiumCliArgs <<< "$APPIUM_CLI"
CMD+=("${appiumCliArgs[@]}")
if [[ -n $APPIUM_PLUGINS ]]; then
  CMD+=(--use-plugins "$APPIUM_PLUGINS")
  logger "INFO" "plugins_cli: --use-plugins $APPIUM_PLUGINS"
fi

# convert to lower case using Linux/Mac compatible syntax (bash v3.2)
PLATFORM_NAME=$(echo "$PLATFORM_NAME" | tr '[:upper:]' '[:lower:]')
if [[ "${PLATFORM_NAME}" = "android" ]]; then
  # shellcheck source=module/android.sh
  . /opt/android.sh
elif [[ "${PLATFORM_NAME}" = "ios" ]]; then
  export AUTOMATION_NAME='XCUITest'
  # shellcheck source=module/ios.sh
  . /opt/ios.sh
fi

if [[ "$CONNECT_TO_GRID" = true ]]; then
  # the Zebrunner node config (MobileRemoteProxy) is the only one supported by mcloud-grid
  if [[ -n "$CUSTOM_NODE_CONFIG" ]] && [[ "$CUSTOM_NODE_CONFIG" != true ]]; then
    logger "WARN" "CUSTOM_NODE_CONFIG is ignored, the Zebrunner node config is always generated"
  fi
  missing=""
  for var in SELENIUM_HOST SELENIUM_PORT STF_PROVIDER_HOST; do
    [[ -n "$(printenv "$var")" ]] || missing+=" $var"
  done
  if [[ -n "$missing" ]]; then
    logger "ERROR" "CONNECT_TO_GRID=true needs:${missing}"
    exit 1
  fi
  # generate config json file
  if ! /opt/zbr-config-gen.sh > "$NODE_CONFIG_JSON"; then
    logger "ERROR" "cannot generate $NODE_CONFIG_JSON"
    exit 1
  fi
  # the node token is not logged
  jq 'if .configuration.custom.registrationToken then .configuration.custom.registrationToken = "*****" else . end' "$NODE_CONFIG_JSON"
  CMD+=(--nodeconfig "$NODE_CONFIG_JSON")
fi

if [[ "$DEFAULT_CAPABILITIES" = true ]]; then
  # the caps of the device for every session: udid, connector hosts and ports
  if ! /opt/zbr-default-caps-gen.sh > "$DEFAULT_CAPABILITIES_JSON"; then
    logger "ERROR" "cannot generate $DEFAULT_CAPABILITIES_JSON"
    exit 1
  fi
  if [[ -s "$DEFAULT_CAPABILITIES_JSON" ]]; then
    cat "$DEFAULT_CAPABILITIES_JSON"
    CMD+=(--default-capabilities "$DEFAULT_CAPABILITIES_JSON")
  else
    logger "WARN" "no default capabilities for PLATFORM_NAME=${PLATFORM_NAME}, Appium starts without them"
  fi
fi

if [[ "$RELAXED_SECURITY" = true ]]; then
  CMD+=(--relaxed-security)
fi

# the insecure features of Appium 3 are <driver>:<feature>, all of them in one --allow-insecure (the last one wins)
insecureFeatures=""
if [[ "$CHROMEDRIVER_AUTODOWNLOAD" = true ]]; then
  insecureFeatures+=",*:chromedriver_autodownload"
fi
if [[ "$ADB_SHELL" = true ]]; then
  insecureFeatures+=",*:adb_shell"
fi
if [[ -n "$insecureFeatures" ]]; then
  CMD+=(--allow-insecure "${insecureFeatures#,}")
fi

touch "${TASK_LOG}"
logger "INFO" "${CMD[*]}"
"${CMD[@]}" &
appiumPid=$!

trap 'finishRecordings' SIGTERM

# Background process to control video recording
# REPLY example: ./ DELETE .recording-artifact-123321123
inotifywait -e create,delete --monitor "${LOG_DIR}" |
  while read -r REPLY; do
    if [[ $REPLY == *.recording-artifact* ]]; then
      # Extract all text after '*recording-artifact-'
      inwRecordArtifactId="${REPLY//*recording-artifact-/}"
      logger "INFO" "inwRecordArtifactId=$inwRecordArtifactId"
    else
      continue
    fi

    if [[ $REPLY == *CREATE* ]]; then
      if [[ "${RECORD_ARTIFACTS}" == "true" ]]; then
        logger "INFO" "start recording artifact $inwRecordArtifactId"
        /opt/start-capture-artifacts.sh "$inwRecordArtifactId" > >(tee -a "${TASK_LOG}") 2>&1
      else
        logger "INFO" "recording artifacts was disabled with RECORD_ARTIFACTS: ${RECORD_ARTIFACTS}"
      fi
    elif [[ $REPLY == *DELETE* ]]; then
      recordingEnded "$inwRecordArtifactId"
    fi
  done &

if [[ "${RECORD_ARTIFACTS}" == "true" ]]; then
  recordingWatchdog &
fi

# wait for Appium only: the exit of a helper (socat, ...) must not stop the container
wait "$appiumPid"

exitCode=$?
logger "INFO" "Exit status: $exitCode"

# the sessions ended with Appium: their recordings are shared before the container ends, as on docker stop
finishRecordings

if [[ "$exitCode" -eq 101 ]]; then
  logger "WARN" "Hub down or not responding. Sleeping ${UNREGISTER_IF_STILL_DOWN_AFTER}ms and 15s..."
  sleep $((UNREGISTER_IF_STILL_DOWN_AFTER / 1000))
  sleep 15
fi

logger "INFO" "exit_code: $exitCode"

# forcibly exit with error code to initiate restart
exit 1
