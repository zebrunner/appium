#!/bin/bash

. /opt/debug.sh

NODE_CONFIG_JSON="/root/nodeconfig.json"
DEFAULT_CAPABILITIES_JSON="/root/defaultcapabilities.json"

# show list of plugins including installed ones
appium plugin list

plugins_cli=
if [[ -n $APPIUM_PLUGINS ]]; then
  plugins_cli="--use-plugins $APPIUM_PLUGINS"
  echo "plugins_cli: $plugins_cli"
fi

CMD="appium --log-no-colors --log-timestamp -pa /wd/hub --port $APPIUM_PORT --log $TASK_LOG --log-level $LOG_LEVEL $APPIUM_CLI $plugins_cli"
#--use-plugins=relaxed-caps

stop_ffmpeg() {
  local artifactId=$1
  if [ -z ${artifactId} ]; then
    echo "[warn] [Stop Video] artifactId param is empty!"
    return 0
  fi

  ls -lah /tmp/${artifactId}.mp4
  local ffmpeg_pids
  ffmpeg_pids=$(pgrep --full "ffmpeg.*/tmp/${artifactId}.mp4" | xargs)
  echo "[info] [Stop Video] ffmpeg_pid=$ffmpeg_pids"
  if [ -n "$ffmpeg_pids" ]; then
    kill -2 $ffmpeg_pids
    echo "[info] [Stop Video] kill output: $?"

    # wait until ffmpeg finished normally
    local idleTimeout=30
    local startTime
    startTime=$(date +%s)
    while [ $((startTime + idleTimeout)) -gt "$(date +%s)" ]; do
      echo "[info] [Stop Video] videoFileSize: $(wc -c /tmp/${artifactId}.mp4 | awk '{print $1}') bytes."
      echo -e "[info] [Stop Video] \n Running ffmpeg processes:\n $(pgrep --list-full --full ffmpeg) \n-------------------------"

      if ps -p ${ffmpeg_pids// /,} > /dev/null 2>&1; then
        echo "[info] [Stop Video] ffmpeg not finished yet"
        sleep 0.3
      else
        echo "[info] [Stop Video] ffmpeg finished correctly"
        break
      fi
    done

    # TODO: try to heal video file using https://video.stackexchange.com/a/18226
    if ps -p ${ffmpeg_pids// /,} > /dev/null 2>&1; then
      echo "[error] [Stop Video] ffmpeg not finished correctly, trying to kill it forcibly"
      kill -9 $ffmpeg_pids
    fi
  else
    echo "[warn] [Stop Video] no ffmpeg process for ${artifactId}"
  fi

  # It is important to stop streaming only after ffmpeg recording has completed,
  # since ffmpeg recording requires an image stream to complete normally.
  # Otherwise (if ffmpeg doesn't have any new frames) it will wait for a new
  # frame to properly finalize the video.

  # the next session may already record from the same stream: 'off' would freeze its video
  if pgrep --full "ffmpeg.*${BROADCAST_HOST}:${BROADCAST_PORT}" > /dev/null 2>&1; then
    echo "[info] [Stop Video] another recording is in progress, streaming stays 'on'"
    return 0
  fi

  # send signal to stop streaming of the screens from device (applicable only for android so far)
  echo "[info] [Stop Video] trying to send 'off': nc ${BROADCAST_HOST} ${BROADCAST_PORT}"
  echo -n "off" | nc ${BROADCAST_HOST} ${BROADCAST_PORT} -w 0 -v
}

share() {
  local artifactId=$1

  if [ -z ${artifactId} ]; then
    echo "[warn] [Share] artifactId param is empty!"
    return 0
  fi

  idleTimeout=5
  # check if .share-artifact-* is beig moving by other thread
  if [ ! -f ${LOG_DIR}/.sharing-artifact-$artifactId ]; then
    touch ${LOG_DIR}/.sharing-artifact-$artifactId
  else
    echo "[info] [Share] waiting for other thread to share $artifactId files"
    # if we can't move this file -> other thread already moved it
    # wait until share is completed on other thread by deleting .recording-artifact-$artifactId file
    waitStartTime=$(date +%s)
    while [ $((waitStartTime + idleTimeout)) -gt "$(date +%s)" ]; do
      if [ ! -f ${LOG_DIR}/.recording-artifact-$artifactId ]; then
        echo "[info] [Share] other thread shared artifacts for $artifactId"
        return 0
      fi
      sleep 0.1
    done
    echo "[warn] [Share] timeout waiting for other thread to share artifacts for $artifactId"
    return 0
  fi

  # unique folder to collect all artifacts for uploading
  mkdir ${LOG_DIR}/${artifactId}

  stop_ffmpeg $artifactId

  echo "[info] [Share] Video recording file:"

  ls -lah /tmp/${artifactId}.mp4
  if [ -f /tmp/${artifactId}.mp4 ]; then
    mv /tmp/${artifactId}.mp4 ${LOG_DIR}/${artifactId}/video.mp4
  fi

  cp ${TASK_LOG} ${LOG_DIR}/${artifactId}/${LOG_FILE}
  # do not move otherwise in global loop we should add extra verification on file presense
  > ${TASK_LOG}

  if [ -f "${WDA_LOG_FILE}" ] && [ "${SHARE_WDA_LOG}" == "true" ]; then
    echo "[info] [Share] Sharing file: ${WDA_LOG_FILE}"
    cp ${WDA_LOG_FILE} ${LOG_DIR}/${artifactId}/wda.log
    > ${WDA_LOG_FILE}
  fi

  # share all the rest custom reports from LOG_DIR into artifactId subfolder
  for file in ${LOG_DIR}/*; do
    if [ -f "$file" ] && [ -s "$file" ] && [ "$file" != "${TASK_LOG}" ] && [ "$file" != "${WDA_LOG_FILE}" ]; then
      echo "[info] [Share] Sharing file: $file"
      # to avoid extra publishing as launch artifact for driver sessions
      mv $file ${LOG_DIR}/${artifactId}/
    fi
  done

  # register artifactId info to be able to parse by uploader
  echo "artifactId=$artifactId" > ${LOG_DIR}/.artifact-$artifactId

  # remove lock file (for other threads) when artifacts are shared for uploader
  rm -f ${LOG_DIR}/.sharing-artifact-$artifactId
  # remove lock file (for uploader) when artifacts are shared for uploader
  rm -f ${LOG_DIR}/.recording-artifact-$artifactId
}

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

# Safety net for leaked recordings: a marker of a session unknown to Appium is removed
# (the regular DELETE handler then shares it) and an ffmpeg without marker and share in
# progress is stopped after several checks, so a finishing video is never cut.
recording_watchdog() {
  local interval=${RECORDING_WATCHDOG_SEC:-60}
  local staleSec=${RECORDING_STALE_SEC:-600}
  local orphanChecks=${RECORDING_ORPHAN_CHECKS:-5}
  declare -A orphanSeen

  while sleep "$interval"; do
    local sessions
    sessions=$(curl -s --max-time 10 "http://localhost:${APPIUM_PORT}/wd/hub/sessions") || continue
    sessions=$(echo "$sessions" | jq -r '.value[]?.id' 2>/dev/null) || continue

    local marker id age pid args seen=()
    # with ROUTER_UUID the marker is not named by a session id
    if [[ -z "${ROUTER_UUID// /}" ]]; then
      for marker in "${LOG_DIR}"/.recording-artifact-*; do
        [ -e "$marker" ] || continue
        id=${marker##*/.recording-artifact-}
        age=$(( $(date +%s) - $(stat -c %Y "$marker" 2>/dev/null || date +%s) ))
        if [ "$age" -gt "$staleSec" ] && ! grep -qxF "$id" <<< "$sessions"; then
          echo "[warn] [Watchdog] session $id is not active for ${age}s, removing its marker to share the recording"
          rm -f "$marker"
        fi
      done
    fi

    for pid in $(pgrep -x ffmpeg); do
      args=$(tr '\0' ' ' < /proc/$pid/cmdline 2>/dev/null) || continue
      [[ "$args" =~ /tmp/([^/ ]+)\.mp4 ]] || continue
      id=${BASH_REMATCH[1]}
      if [ -e "${LOG_DIR}/.recording-artifact-$id" ] || [ -e "${LOG_DIR}/.sharing-artifact-$id" ]; then
        continue
      fi
      seen+=("$pid")
      orphanSeen[$pid]=$(( ${orphanSeen[$pid]:-0} + 1 ))
      if [ "${orphanSeen[$pid]}" -ge "$orphanChecks" ]; then
        echo "[warn] [Watchdog] ffmpeg $pid records $id without session for ${orphanChecks} checks, stopping it"
        kill -2 "$pid"
        sleep 30
        kill -9 "$pid" > /dev/null 2>&1
        rm -f "/tmp/$id.mp4"
        unset "orphanSeen[$pid]"
      fi
    done
    # forget pids that are not orphans anymore
    for pid in "${!orphanSeen[@]}"; do
      [[ " ${seen[*]} " == *" $pid "* ]] || unset "orphanSeen[$pid]"
    done
  done
}

if [ ! -z "${SALT_MASTER}" ]; then
    echo "[INIT] ENV SALT_MASTER it not empty, salt-minion will be prepared"
    echo "master: ${SALT_MASTER}" >> /etc/salt/minion
    salt-minion &
    echo "[INIT] salt-minion is running..."
fi

if [ "$ATD" = true ]; then
    echo "[INIT] Starting ATD..."
    java -jar /root/RemoteAppiumManager.jar -DPort=4567 &
    echo "[INIT] ATD is running..."
fi

# convert to lower case using Linux/Mac compatible syntax (bash v3.2)
PLATFORM_NAME=`echo "$PLATFORM_NAME" |  tr '[:upper:]' '[:lower:]'`
if [ "${PLATFORM_NAME}" = "android" ]; then
    . /opt/android.sh
elif [ "${PLATFORM_NAME}" = "ios" ]; then
    export AUTOMATION_NAME='XCUITest'
    . /opt/ios.sh
fi

if [ "$CONNECT_TO_GRID" = true ]; then
    if [ "$CUSTOM_NODE_CONFIG" = true ]; then
        # generate config json file
        /opt/zbr-config-gen.sh > $NODE_CONFIG_JSON
        cat $NODE_CONFIG_JSON

        # generate default capabilities json file for iOS device if needed
        /opt/zbr-default-caps-gen.sh > $DEFAULT_CAPABILITIES_JSON
        cat $DEFAULT_CAPABILITIES_JSON
    else
        /root/generate_config.sh $NODE_CONFIG_JSON
    fi
    CMD+=" --nodeconfig $NODE_CONFIG_JSON"
fi

if [ "$DEFAULT_CAPABILITIES" = true ]; then
    CMD+=" --default-capabilities $DEFAULT_CAPABILITIES_JSON"
fi

if [ "$RELAXED_SECURITY" = true ]; then
    CMD+=" --relaxed-security"
fi

if [ "$CHROMEDRIVER_AUTODOWNLOAD" = true ]; then
    CMD+=" --allow-insecure chromedriver_autodownload"
fi

if [ "$ADB_SHELL" = true ]; then
    CMD+=" --allow-insecure adb_shell"
fi

# one session per device: a new session ends the previous ones instead of running in parallel
if [ "${SESSION_OVERRIDE}" != false ] && [[ " ${APPIUM_CLI} " != *" --session-override "* ]]; then
    CMD+=" --session-override"
fi

touch ${TASK_LOG}
echo $CMD
$CMD &

trap 'finish' SIGTERM

if [ "${RECORD_ARTIFACTS}" == "true" ]; then
  recording_watchdog &
fi

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
      /opt/start-capture-artifacts.sh $inwRecordArtifactId > >(tee -a "${TASK_LOG}") 2>&1
    else
      echo "recording artifacts was disabled with RECORD_ARTIFACTS: ${RECORD_ARTIFACTS}"
    fi
  elif [[ $REPLY == *DELETE* ]]; then
    # the forwards of a session that is already starting (e.g. UiAutomator2 system port) must stay
    if compgen -G "${LOG_DIR}/.recording-artifact-*" > /dev/null; then
      echo "another session is active, adb forwarding stays"
    else
      echo "stop adb forwarding if any for mobile web testing"
      adb forward --remove-all
    fi
    echo "stop recording artifact $inwRecordArtifactId"
    # in background: the next session starts its recording while this video is being finalized
    share $inwRecordArtifactId &
  fi
done &

# wait until background processes exists for node (appium)
node_pids=`pidof node`
wait -n $node_pids

exit_code=$?
echo "Exit status: $exit_code"

# TODO: do we need explicit finish call to publish recorded artifacts when RETAIL_TASK is false?
#finish

if [ $exit_code -eq 101 ]; then
  echo "Hub down or not responding. Sleeping ${UNREGISTER_IF_STILL_DOWN_AFTER}ms and 15s..."
  sleep $((UNREGISTER_IF_STILL_DOWN_AFTER/1000))
  sleep 15
fi

echo exit_code: $exit_code

# forcibly exit with error code to initiate restart
exit 1

