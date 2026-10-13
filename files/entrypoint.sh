#!/bin/bash

# shellcheck source=util/debug.sh
. /opt/debug.sh

NODE_CONFIG_JSON="$APPIUM_CONFIG_DIR/nodeconfig.json"
DEFAULT_CAPABILITIES_JSON="$APPIUM_CONFIG_DIR/defaultcapabilities.json"

# show list of plugins including installed ones
appium plugin list

# the Appium command as an array: the arguments keep their values as is
CMD=(appium --log-no-colors --log-timestamp -pa /wd/hub --port "$APPIUM_PORT" --log "$TASK_LOG" --log-level "$LOG_LEVEL")
# APPIUM_CLI holds several arguments
read -r -a appium_cli_args <<< "$APPIUM_CLI"
CMD+=("${appium_cli_args[@]}")
if [[ -n $APPIUM_PLUGINS ]]; then
  CMD+=(--use-plugins "$APPIUM_PLUGINS")
  echo "plugins_cli: --use-plugins $APPIUM_PLUGINS"
fi

# ffmpeg_running <pids>: whether one of the space separated processes runs
ffmpeg_running() {
  local pid
  for pid in $1; do
    ps -p "$pid" > /dev/null 2>&1 && return 0
  done
  return 1
}

stop_ffmpeg() {
  local artifactId=$1
  if [ -z "${artifactId}" ]; then
    echo "[warn] [Stop Video] artifactId param is empty!"
    return 0
  fi

  ls -lah "/tmp/${artifactId}.mp4"
  # pgrep may find several ffmpeg processes, the list is split on purpose below
  local ffmpeg_pids pid
  ffmpeg_pids=$(pgrep --full "ffmpeg.*${artifactId}.mp4")
  echo "[info] [Stop Video] ffmpeg_pid=$ffmpeg_pids"
  for pid in $ffmpeg_pids; do
    kill -2 "$pid"
  done
  echo "[info] [Stop Video] kill output: $?"

  # wait until ffmpeg finished normally
  idleTimeout=30
  startTime=$(date +%s)
  while [ $((startTime + idleTimeout)) -gt "$(date +%s)" ]; do
    echo "[info] [Stop Video] videoFileSize: $(wc -c "/tmp/${artifactId}.mp4" | awk '{print $1}') bytes."
    echo -e "[info] [Stop Video] \n Running ffmpeg processes:\n $(pgrep --list-full --full ffmpeg) \n-------------------------"

    if ffmpeg_running "$ffmpeg_pids"; then
      echo "[info] [Stop Video] ffmpeg not finished yet"
      sleep 0.3
    else
      echo "[info] [Stop Video] ffmpeg finished correctly"
      break
    fi
  done

  # TODO: try to heal video file using https://video.stackexchange.com/a/18226
  if ffmpeg_running "$ffmpeg_pids"; then
    echo "[error] [Stop Video] ffmpeg not finished correctly, trying to kill it forcibly"
    for pid in $ffmpeg_pids; do
      kill -9 "$pid"
    done
  fi

  # It is important to stop streaming only after ffmpeg recording has completed,
  # since ffmpeg recording requires an image stream to complete normally.
  # Otherwise (if ffmpeg doesn't have any new frames) it will wait for a new
  # frame to properly finalize the video.

  # send signal to stop streaming of the screens from device (applicable only for android so far)
  # iOS records the WDA MJPEG server directly, so poking the STF broadcast here would only churn its ws/session.
  if [[ "$(echo "${PLATFORM_NAME}" | tr '[:upper:]' '[:lower:]')" != "ios" ]]; then
    echo "[info] [Stop Video] trying to send 'off': nc ${BROADCAST_HOST} ${BROADCAST_PORT}"
    echo -n "off" | nc "${BROADCAST_HOST}" "${BROADCAST_PORT}" -q 0 -v
  fi
}

share() {
  local artifactId=$1

  if [ -z "${artifactId}" ]; then
    echo "[warn] [Share] artifactId param is empty!"
    return 0
  fi

  idleTimeout=5
  # check if .share-artifact-* is beig moving by other thread
  if [ ! -f "${LOG_DIR}/.sharing-artifact-$artifactId" ]; then
    touch "${LOG_DIR}/.sharing-artifact-$artifactId"
  else
    echo "[info] [Share] waiting for other thread to share $artifactId files"
    # if we can't move this file -> other thread already moved it
    # wait until share is completed on other thread by deleting .recording-artifact-$artifactId file
    waitStartTime=$(date +%s)
    while [ $((waitStartTime + idleTimeout)) -gt "$(date +%s)" ]; do
      if [ ! -f "${LOG_DIR}/.recording-artifact-$artifactId" ]; then
        echo "[info] [Share] other thread shared artifacts for $artifactId"
        return 0
      fi
      sleep 0.1
    done
    echo "[warn] [Share] timeout waiting for other thread to share artifacts for $artifactId"
    return 0
  fi

  # unique folder to collect all artifacts for uploading
  mkdir "${LOG_DIR}/${artifactId}"

  stop_ffmpeg "$artifactId"

  echo "[info] [Share] Video recording file:"

  ls -lah "/tmp/${artifactId}.mp4"
  if [ -f "/tmp/${artifactId}.mp4" ]; then
    videoSize=$(wc -c < "/tmp/${artifactId}.mp4")
    if [ "${videoSize}" -gt 1024 ]; then
      mv "/tmp/${artifactId}.mp4" "${LOG_DIR}/${artifactId}/video.mp4"
    else
      echo "[warn] [Share] video for $artifactId is ${videoSize} bytes (no frames captured); skipping video upload"
      rm -f "/tmp/${artifactId}.mp4"
    fi
  fi

  cp "${TASK_LOG}" "${LOG_DIR}/${artifactId}/${LOG_FILE}"
  # do not move otherwise in global loop we should add extra verification on file presense
  : > "${TASK_LOG}"

  if [ -f "${WDA_LOG_FILE}" ] && [ "${SHARE_WDA_LOG}" == "true" ]; then
    echo "[info] [Share] Sharing file: ${WDA_LOG_FILE}"
    cp "${WDA_LOG_FILE}" "${LOG_DIR}/${artifactId}/wda.log"
    : > "${WDA_LOG_FILE}"
  fi

  # share all the rest custom reports from LOG_DIR into artifactId subfolder
  for file in "${LOG_DIR}"/*; do
    if [ -f "$file" ] && [ -s "$file" ] && [ "$file" != "${TASK_LOG}" ] && [ "$file" != "${WDA_LOG_FILE}" ]; then
      echo "[info] [Share] Sharing file: $file"
      # to avoid extra publishing as launch artifact for driver sessions
      mv "$file" "${LOG_DIR}/${artifactId}/"
    fi
  done

  # register artifactId info to be able to parse by uploader
  echo "artifactId=$artifactId" > "${LOG_DIR}/.artifact-$artifactId"

  # remove lock file (for other threads) when artifacts are shared for uploader
  rm -f "${LOG_DIR}/.sharing-artifact-$artifactId"
  # remove lock file (for uploader) when artifacts are shared for uploader
  rm -f "${LOG_DIR}/.recording-artifact-$artifactId"
}

# called by the SIGTERM trap below
# shellcheck disable=SC2329
finish() {
  echo "on finish begin"

  # every existing marker is an active session (created on session start, deleted on its end)
  local marker
  local found=false
  for marker in "${LOG_DIR}"/.recording-artifact-*; do
    [ -e "$marker" ] || continue
    found=true
    echo "detected active recording: ${marker##*/.recording-artifact-}"
    share "${marker##*/.recording-artifact-}"
  done
  if [ "$found" = false ]; then
    echo "[info] no active recordings on finish"
  fi

  echo "on finish end"
}

# convert to lower case using Linux/Mac compatible syntax (bash v3.2)
PLATFORM_NAME=$(echo "$PLATFORM_NAME" | tr '[:upper:]' '[:lower:]')
if [ "${PLATFORM_NAME}" = "android" ]; then
  # shellcheck source=module/android.sh
  . /opt/android.sh
elif [ "${PLATFORM_NAME}" = "ios" ]; then
  export AUTOMATION_NAME='XCUITest'
  # shellcheck source=module/ios.sh
  . /opt/ios.sh
fi

if [ "$CONNECT_TO_GRID" = true ]; then
  # the Zebrunner node config (MobileRemoteProxy) is the only one supported by mcloud-grid
  if [ -n "$CUSTOM_NODE_CONFIG" ] && [ "$CUSTOM_NODE_CONFIG" != true ]; then
    echo "[warn] CUSTOM_NODE_CONFIG is ignored, the Zebrunner node config is always generated"
  fi
  missing=""
  for var in SELENIUM_HOST SELENIUM_PORT STF_PROVIDER_HOST; do
    [ -n "$(printenv "$var")" ] || missing+=" $var"
  done
  if [ -n "$missing" ]; then
    echo "[error] CONNECT_TO_GRID=true needs:${missing}"
    exit 1
  fi
  # generate config json file
  if ! /opt/zbr-config-gen.sh > "$NODE_CONFIG_JSON"; then
    echo "[error] cannot generate $NODE_CONFIG_JSON"
    exit 1
  fi
  cat "$NODE_CONFIG_JSON"
  CMD+=(--nodeconfig "$NODE_CONFIG_JSON")
fi

if [ "$DEFAULT_CAPABILITIES" = true ]; then
  # the caps of the device for every session: udid, connector hosts and ports
  if ! /opt/zbr-default-caps-gen.sh > "$DEFAULT_CAPABILITIES_JSON"; then
    echo "[error] cannot generate $DEFAULT_CAPABILITIES_JSON"
    exit 1
  fi
  if [ -s "$DEFAULT_CAPABILITIES_JSON" ]; then
    cat "$DEFAULT_CAPABILITIES_JSON"
    CMD+=(--default-capabilities "$DEFAULT_CAPABILITIES_JSON")
  else
    echo "[warn] no default capabilities for PLATFORM_NAME=${PLATFORM_NAME}, Appium starts without them"
  fi
fi

if [ "$RELAXED_SECURITY" = true ]; then
  CMD+=(--relaxed-security)
fi

# the insecure features of Appium 3 are <driver>:<feature>, all of them in one --allow-insecure (the last one wins)
insecure_features=""
if [ "$CHROMEDRIVER_AUTODOWNLOAD" = true ]; then
  insecure_features+=",*:chromedriver_autodownload"
fi
if [ "$ADB_SHELL" = true ]; then
  insecure_features+=",*:adb_shell"
fi
if [ -n "$insecure_features" ]; then
  CMD+=(--allow-insecure "${insecure_features#,}")
fi

touch "${TASK_LOG}"
echo "${CMD[*]}"
"${CMD[@]}" &
appium_pid=$!

trap 'finish' SIGTERM

# Background process to control video recording
# REPLY example: ./ DELETE .recording-artifact-123321123
inotifywait -e create,delete --monitor "${LOG_DIR}" |
  while read -r REPLY; do
    if [[ $REPLY == *.recording-artifact* ]]; then
      # Extract all text after '*recording-artifact-'
      inwRecordArtifactId="${REPLY//*recording-artifact-/}"
      echo "inwRecordArtifactId=$inwRecordArtifactId"
    else
      continue
    fi

    if [[ $REPLY == *CREATE* ]]; then
      if [ "${RECORD_ARTIFACTS}" == "true" ]; then
        echo "start recording artifact $inwRecordArtifactId"
        /opt/start-capture-artifacts.sh "$inwRecordArtifactId" > >(tee -a "${TASK_LOG}") 2>&1
      else
        echo "recording artifacts was disabled with RECORD_ARTIFACTS: ${RECORD_ARTIFACTS}"
      fi
    elif [[ $REPLY == *DELETE* ]]; then
      echo "stop adb forwarding if any for mobile web testing"
      adb forward --remove-all
      echo "stop recording artifact $inwRecordArtifactId"
      if [[ "${PLATFORM_NAME}" == "ios" ]]; then
        # iOS reads WDA directly, so finalizing one recording cannot stop the next recording's source.
        share "$inwRecordArtifactId" &
      else
        # STF has shared on/off state. Finish 'off' before processing the next recording's 'on'.
        share "$inwRecordArtifactId"
      fi
    fi
  done &

# wait for Appium only: the exit of a helper (socat, ...) must not stop the container
wait "$appium_pid"

exit_code=$?
echo "Exit status: $exit_code"

# TODO: do we need explicit finish call to publish recorded artifacts when RETAIL_TASK is false?
#finish

if [ "$exit_code" -eq 101 ]; then
  echo "Hub down or not responding. Sleeping ${UNREGISTER_IF_STILL_DOWN_AFTER}ms and 15s..."
  sleep $((UNREGISTER_IF_STILL_DOWN_AFTER / 1000))
  sleep 15
fi

echo "exit_code: $exit_code"

# forcibly exit with error code to initiate restart
exit 1
