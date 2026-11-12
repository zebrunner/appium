#!/bin/bash
# The video recording of the sessions, sourced by entrypoint.sh and start-capture-artifacts.sh after util/logger.sh:
# the patched Appium creates ${LOG_DIR}/.recording-artifact-<id> on a new session and deletes it on the session end,
# the recording starts on the creation of the marker and is stopped and shared on its deletion.
# Compatible with the macOS system bash 3.2 of the tests: no associative arrays (CONVENTIONS.md).

# The STF screen broadcast (Android) is one for the device and the recording of the next session may start before the
# previous one is finished: 'on' and 'off' are sent under a lock, 'off' only when no other recording reads it.
BROADCAST_LOCK="${BROADCAST_LOCK:-/tmp/.broadcast.lock}"

# "<pid>:<checks> ..." of the ffmpeg processes without a session at the previous check of the watchdog
RECORDING_ORPHANS=""

recordingPlatform() {
  echo "${PLATFORM_NAME}" | tr '[:upper:]' '[:lower:]'
}

# broadcastLock: mkdir is atomic; the lock of a killed process is taken over after 10 s
broadcastLock() {
  local tries=0
  until mkdir "$BROADCAST_LOCK" 2> /dev/null; do
    if [[ "$tries" -ge 100 ]]; then
      logger "WARN" "[Recording] the STF broadcast lock is held for 10 s, it is taken over"
      return 0
    fi
    sleep 0.1
    tries=$((tries + 1))
  done
}

broadcastUnlock() {
  rmdir "$BROADCAST_LOCK" 2> /dev/null
}

# broadcastRecorders: the pids of the ffmpeg processes reading the STF broadcast
broadcastRecorders() {
  pgrep --full "ffmpeg.*tcp://${BROADCAST_HOST}:${BROADCAST_PORT}"
}

# broadcastOff: 'off' stops the frames of every reader, so it is not sent while another recording reads the broadcast
broadcastOff() {
  broadcastLock
  if [[ -n "$(broadcastRecorders)" ]]; then
    logger "INFO" "[Stop Video] another recording reads the STF broadcast, it stays 'on'"
  else
    logger "INFO" "[Stop Video] trying to send 'off': nc ${BROADCAST_HOST} ${BROADCAST_PORT}"
    echo -n "off" | nc "${BROADCAST_HOST}" "${BROADCAST_PORT}" -q 0 -v
  fi
  broadcastUnlock
}

# activeRecordings: the ids of the existing markers, fails without any
activeRecordings() {
  local marker status=1
  for marker in "${LOG_DIR}"/.recording-artifact-*; do
    [[ -e "$marker" ]] || continue
    echo "${marker##*/.recording-artifact-}"
    status=0
  done
  return "$status"
}

# ffmpegRunning <pids>: whether one of the space separated processes runs
ffmpegRunning() {
  local pid
  for pid in $1; do
    ps -p "$pid" > /dev/null 2>&1 && return 0
  done
  return 1
}

# stopRelay <id>: stops the MJPEG relay of the recording (iOS), it exits with ffmpeg by itself only when it has a frame
# to write
stopRelay() {
  pkill --full "mjpeg-relay\.js .* ${1}\$" > /dev/null 2>&1
}

stopFfmpeg() {
  local artifactId=$1
  if [[ -z "${artifactId}" ]]; then
    logger "WARN" "[Stop Video] artifactId param is empty!"
    return 0
  fi

  ls -lah "/tmp/${artifactId}.mp4"
  # pgrep may find several ffmpeg processes, the list is split on purpose below
  local ffmpegPids pid
  ffmpegPids=$(pgrep --full "ffmpeg.*${artifactId}.mp4")
  logger "INFO" "[Stop Video] ffmpeg_pid=$ffmpegPids"
  for pid in $ffmpegPids; do
    kill -2 "$pid"
  done
  logger "INFO" "[Stop Video] kill output: $?"

  # wait until ffmpeg finished normally
  local idleTimeout=30 startTime
  startTime=$(date +%s)
  while [[ $((startTime + idleTimeout)) -gt "$(date +%s)" ]]; do
    logger "INFO" "[Stop Video] videoFileSize: $(wc -c "/tmp/${artifactId}.mp4" | awk '{print $1}') bytes."
    logger "INFO" "[Stop Video] \n Running ffmpeg processes:\n $(pgrep --list-full --full ffmpeg) \n-------------------------"

    if ffmpegRunning "$ffmpegPids"; then
      logger "INFO" "[Stop Video] ffmpeg not finished yet"
      sleep 0.3
    else
      logger "INFO" "[Stop Video] ffmpeg finished correctly"
      break
    fi
  done

  # TODO: try to heal video file using https://video.stackexchange.com/a/18226
  if ffmpegRunning "$ffmpegPids"; then
    logger "ERROR" "[Stop Video] ffmpeg not finished correctly, trying to kill it forcibly"
    for pid in $ffmpegPids; do
      kill -9 "$pid"
    done
  fi
  stopRelay "$artifactId"

  # It is important to stop streaming only after ffmpeg recording has completed,
  # since ffmpeg recording requires an image stream to complete normally.
  # Otherwise (if ffmpeg doesn't have any new frames) it will wait for a new
  # frame to properly finalize the video.

  # iOS records the WDA MJPEG server directly, so poking the STF broadcast here would only churn its ws/session.
  if [[ "$(recordingPlatform)" != "ios" ]]; then
    broadcastOff
  fi
}

share() {
  local artifactId=$1

  if [[ -z "${artifactId}" ]]; then
    logger "WARN" "[Share] artifactId param is empty!"
    return 0
  fi

  local idleTimeout=5 waitStartTime
  # check if .share-artifact-* is beig moving by other thread
  if [[ ! -f "${LOG_DIR}/.sharing-artifact-$artifactId" ]]; then
    touch "${LOG_DIR}/.sharing-artifact-$artifactId"
  else
    logger "INFO" "[Share] waiting for other thread to share $artifactId files"
    # if we can't move this file -> other thread already moved it
    # wait until share is completed on other thread by deleting .recording-artifact-$artifactId file
    waitStartTime=$(date +%s)
    while [[ $((waitStartTime + idleTimeout)) -gt "$(date +%s)" ]]; do
      if [[ ! -f "${LOG_DIR}/.recording-artifact-$artifactId" ]]; then
        logger "INFO" "[Share] other thread shared artifacts for $artifactId"
        return 0
      fi
      sleep 0.1
    done
    logger "WARN" "[Share] timeout waiting for other thread to share artifacts for $artifactId"
    return 0
  fi

  # unique folder to collect all artifacts for uploading
  mkdir "${LOG_DIR}/${artifactId}"

  stopFfmpeg "$artifactId"

  logger "INFO" "[Share] Video recording file:"

  ls -lah "/tmp/${artifactId}.mp4"
  local videoSize file
  if [[ -f "/tmp/${artifactId}.mp4" ]]; then
    videoSize=$(wc -c < "/tmp/${artifactId}.mp4")
    if [[ "${videoSize}" -gt 1024 ]]; then
      mv "/tmp/${artifactId}.mp4" "${LOG_DIR}/${artifactId}/video.mp4"
    else
      logger "WARN" "[Share] video for $artifactId is ${videoSize} bytes (no frames captured); skipping video upload"
      rm -f "/tmp/${artifactId}.mp4"
    fi
  fi

  cp "${TASK_LOG}" "${LOG_DIR}/${artifactId}/${LOG_FILE}"
  # do not move otherwise in global loop we should add extra verification on file presense
  : > "${TASK_LOG}"

  if [[ -f "${WDA_LOG_FILE}" ]] && [[ "${SHARE_WDA_LOG}" == "true" ]]; then
    logger "INFO" "[Share] Sharing file: ${WDA_LOG_FILE}"
    cp "${WDA_LOG_FILE}" "${LOG_DIR}/${artifactId}/wda.log"
    : > "${WDA_LOG_FILE}"
  fi

  # share all the rest custom reports from LOG_DIR into artifactId subfolder
  for file in "${LOG_DIR}"/*; do
    if [[ -f "$file" ]] && [[ -s "$file" ]] && [[ "$file" != "${TASK_LOG}" ]] && [[ "$file" != "${WDA_LOG_FILE}" ]]; then
      logger "INFO" "[Share] Sharing file: $file"
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

# recordingEnded <id>: the marker of the session is deleted
recordingEnded() {
  # the forwards of another session (the system port of UiAutomator2, the chromedriver of a web session) must stay
  if activeRecordings > /dev/null; then
    logger "INFO" "another session is active, its adb forwarding stays"
  else
    logger "INFO" "stop adb forwarding if any for mobile web testing"
    adb forward --remove-all
  fi
  logger "INFO" "stop recording artifact $1"
  # in the background: the recording of the next session starts while this video is finalized
  share "$1" &
}

# called by the SIGTERM trap of the entrypoint
# shellcheck disable=SC2329
finishRecordings() {
  logger "INFO" "on finish begin"

  # every existing marker is an active session (created on session start, deleted on its end)
  local id ids
  if ids=$(activeRecordings); then
    for id in $ids; do
      logger "INFO" "detected active recording: $id"
      share "$id"
    done
  else
    logger "INFO" "no active recordings on finish"
  fi

  logger "INFO" "on finish end"
}

# The safety net of a recording whose session end is lost (e.g. Appium restarted): the marker of a session Appium does
# not know for RECORDING_STALE_SEC is removed (its deletion shares the recording), an ffmpeg without a marker and
# without a share in progress is stopped after RECORDING_ORPHAN_CHECKS checks.
recordingWatchdog() {
  while sleep "${RECORDING_WATCHDOG_SEC:-60}"; do
    removeStaleMarkers
    stopOrphanRecordings
  done
}

removeStaleMarkers() {
  # with ROUTER_UUID the marker is not named by a session id
  [[ -z "${ROUTER_UUID// /}" ]] || return 0
  local response sessions marker id age now
  # Appium answers the container itself without the node token; no answer, no decision
  response=$(curl -fsS --max-time 10 "http://127.0.0.1:${APPIUM_PORT}/wd/hub/appium/sessions" 2> /dev/null) || return 0
  sessions=$(jq -r 'if (.value | type) == "array" then .value[].id else error("no sessions") end' <<< "$response" 2> /dev/null) || return 0
  now=$(date +%s)
  for marker in "${LOG_DIR}"/.recording-artifact-*; do
    [[ -e "$marker" ]] || continue
    id=${marker##*/.recording-artifact-}
    age=$((now - $(date -r "$marker" +%s 2> /dev/null || echo "$now")))
    if [[ "$age" -gt "${RECORDING_STALE_SEC:-600}" ]] && ! grep -qxF "$id" <<< "$sessions"; then
      logger "WARN" "[Watchdog] the session $id is unknown to Appium for ${age}s, its marker is removed to share the recording"
      rm -f "$marker"
    fi
  done
}

# orphanChecks <pid>: the checks the ffmpeg process is already without a session
orphanChecks() {
  local entry
  for entry in $RECORDING_ORPHANS; do
    if [[ "${entry%%:*}" == "$1" ]]; then
      echo "${entry#*:}"
      return
    fi
  done
  echo 0
}

stopOrphanRecordings() {
  local pid args id checks tries orphans=""
  for pid in $(pgrep -x ffmpeg); do
    args=$(ps -o args= -p "$pid" 2> /dev/null) || continue
    [[ "$args" =~ /tmp/([^/ ]+)\.mp4 ]] || continue
    id=${BASH_REMATCH[1]}
    # a share in progress stops the ffmpeg itself
    if [[ -e "${LOG_DIR}/.recording-artifact-$id" || -e "${LOG_DIR}/.sharing-artifact-$id" ]]; then
      continue
    fi
    checks=$(($(orphanChecks "$pid") + 1))
    if [[ "$checks" -lt "${RECORDING_ORPHAN_CHECKS:-5}" ]]; then
      orphans+="$pid:$checks "
      continue
    fi
    logger "WARN" "[Watchdog] ffmpeg $pid records $id without a session for $checks checks, it is stopped"
    kill -2 "$pid" 2> /dev/null
    tries=0
    while ps -p "$pid" > /dev/null 2>&1 && [[ "$tries" -lt 100 ]]; do
      sleep 0.1
      tries=$((tries + 1))
    done
    kill -9 "$pid" 2> /dev/null
    stopRelay "$id"
    rm -f "/tmp/$id.mp4"
    if [[ "$args" == *"tcp://${BROADCAST_HOST}:${BROADCAST_PORT}"* ]]; then
      broadcastOff
    fi
  done
  RECORDING_ORPHANS=$orphans
}
