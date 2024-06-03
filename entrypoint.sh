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

  if [ -f /tmp/${artifactId}.mp4 ]; then
    ls -lah /tmp/${artifactId}.mp4
    ffmpeg_pid=$(pgrep --full ffmpeg.*${artifactId}.mp4)
    echo "[info] [Stop Video] ffmpeg_pid=$ffmpeg_pid"
    kill -2 $ffmpeg_pid
    echo "[info] [Stop Video] kill output: $?"

    # wait until ffmpeg finished normally
    idleTimeout=30
    startTime=$(date +%s)
    while [ $((startTime + idleTimeout)) -gt "$(date +%s)" ]; do
      echo "[info] [Stop Video] videoFileSize: $(wc -c /tmp/${artifactId}.mp4 | awk '{print $1}') bytes."
      echo -e "[info] [Stop Video] \n Running ffmpeg processes:\n $(pgrep --list-full --full ffmpeg) \n-------------------------"

      if ps -p $ffmpeg_pid > /dev/null 2>&1; then
        echo "[info] [Stop Video] ffmpeg not finished yet"
        sleep 0.3
      else
        echo "[info] [Stop Video] ffmpeg finished correctly"
        break
      fi
    done

    # TODO: try to heal video file using https://video.stackexchange.com/a/18226
    if ps -p $ffmpeg_pid > /dev/null 2>&1; then
      echo "[error] [Stop Video] ffmpeg not finished correctly, trying to kill it forcibly"
      kill -9 $ffmpeg_pid
    fi

    # It is important to stop streaming only after ffmpeg recording has completed,
    # since ffmpeg recording requires an image stream to complete normally.
    # Otherwise (if ffmpeg doesn't have any new frames) it will wait for a new
    # frame to properly finalize the video.

    # send signal to stop streaming of the screens from device (applicable only for android so far)
    echo "[info] [Stop Video] trying to send 'off': nc ${BROADCAST_HOST} ${BROADCAST_PORT}"
    echo -n "off" | nc ${BROADCAST_HOST} ${BROADCAST_PORT} -w 0 -v
  fi
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

  cp ${TASK_LOG} ${LOG_DIR}/${artifactId}/${LOG_FILE}
  # do not move otherwise in global loop we should add extra verification on file presense
  > ${TASK_LOG}

  if [[ -f ${WDA_LOG_FILE} ]]; then
    echo "[info] [Share] Sharing file: ${WDA_LOG_FILE}"
    cp ${WDA_LOG_FILE} ${LOG_DIR}/${artifactId}/wda.log
    > ${WDA_LOG_FILE}
  fi

  stop_ffmpeg $artifactId
  echo "[info] [Share] Video recording file:"
  ls -lah /tmp/${artifactId}.mp4

  mv /tmp/${artifactId}.mp4 ${LOG_DIR}/${artifactId}/video.mp4

  # share all the rest custom reports from LOG_DIR into artifactId subfolder
  for file in ${LOG_DIR}/*; do
    if [ -f "$file" ] && [ -s "$file" ] && [ "$file" != "${TASK_LOG}" ] && [ "$file" != "${VIDEO_LOG}" ] && [ "$file" != "${WDA_LOG_FILE}" ]; then
      echo "[info] [Share] Sharing file: $file"
      # to avoid extra publishing as launch artifact for driver sessions
      mv $file ${LOG_DIR}/${artifactId}/
    fi
  done

  # register artifactId info to be able to parse by uploader
  echo "artifactId=$artifactId" > ${LOG_DIR}/.artifact-$artifactId

  # share video log file
  cp ${VIDEO_LOG} ${LOG_DIR}/${artifactId}/${VIDEO_LOG_FILE}
  > ${VIDEO_LOG}

  # remove lock file (for other threads) when artifacts are shared for uploader
  rm -f ${LOG_DIR}/.sharing-artifact-$artifactId
  # remove lock file (for uploader) when artifacts are shared for uploader
  rm -f ${LOG_DIR}/.recording-artifact-$artifactId
}

finish() {
  echo "on finish begin"

  if [[ "${PLATFORM_NAME}" == "ios" ]]; then
    #detect sessionId by existing ffmpeg process
    sessionId=`ps -ef | grep ffmpeg | grep -v grep | cut -d "/" -f 3 | cut -d "." -f 1` > /dev/null 2>&1
  elif [[ "${PLATFORM_NAME}" == "android" ]]; then
    # detect sessionId by start-capture-artifacts.sh
    # /bin/bash /opt/start-capture-artifacts.sh 31d625c4-2810-426d-a40f-9fe14cf3260a
    sessionId=`ps -ef | grep start-capture-artifacts.sh | grep -v grep | cut -d "/" -f 5 | cut -d " " -f 2` > /dev/null 2>&1
  fi

  if [ ! -z ${sessionId} ]; then
    echo "detected existing video recording: $sessionId"
    share ${sessionId}
  else
    echo "[warn] sessionId is empty on finish!"
  fi

  echo "on finish end"
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

touch ${TASK_LOG}
echo $CMD
$CMD &

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
    echo "start recording artifact $inwRecordArtifactId"
    /opt/start-capture-artifacts.sh $inwRecordArtifactId
  elif [[ $REPLY == *DELETE* ]]; then
    echo "stop recording artifact $inwRecordArtifactId"
    share $inwRecordArtifactId
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

