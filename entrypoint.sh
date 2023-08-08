#!/bin/bash

NODE_CONFIG_JSON="/root/nodeconfig.json"
DEFAULT_CAPABILITIES_JSON="/root/defaultcapabilities.json"

CMD="xvfb-run appium --log-no-colors --log-timestamp -pa /wd/hub --port $APPIUM_PORT --log $TASK_LOG $APPIUM_CLI"
#--use-plugins=relaxed-caps

share() {
  local artifactId=$1

  if [ -z ${artifactId} ]; then
    echo "[warn] artifactId param is empty!"
    return 0
  fi

  # unique folder to collect all artifacts for uploading
  mkdir ${LOG_DIR}/${artifactId}

  cp ${TASK_LOG} ${LOG_DIR}/${artifactId}/${LOG_FILE}
  # do not move otherwise in global loop we should add extra verification on file presense
  > ${TASK_LOG}

  if [ "${PLATFORM_NAME}" == "ios" ] && [ -f /tmp/${artifactId}.mp4 ]; then
    ls -la /tmp/${artifactId}.mp4
    # kill ffmpeg process
    pkill -f ffmpeg
    #echo "kill output: $?"

    # wait until ffmpeg finished normally and file size is greater 48 byte!
    startTime=$(date +%s)
    idleTimeout=5
    while [ $(( startTime + idleTimeout )) -gt "$(date +%s)" ]; do
      videoFileSize=$(wc -c /tmp/${artifactId}.mp4  | awk '{print $1}')
      #echo videoFileSize: $videoFileSize
      if [ $videoFileSize -le 48 ]; then
        #echo "ffmpeg flush is not finished yet"
        continue
      fi

      #echo "detecting ffmpeg process pid..."
      pidof ffmpeg > /dev/null 2>&1
      if [ $? -eq 1 ]; then
        # no more ffmpeg commands
        break
      fi
    done


    echo "Video recording file size:"
    ls -la /tmp/${artifactId}.mp4

    # move local video recording under the session folder for publishing
    mv /tmp/${artifactId}.mp4 ${LOG_DIR}/${artifactId}/video.mp4
  fi

  if [[ "${PLATFORM_NAME}" == "android" ]]; then
    pkill -e -f screenrecord
    # magic pause to stop recording correctly
    sleep 0.3

    concatAndroidRecording $artifactId
    if [ -f /tmp/${artifactId}.mp4 ]; then
      # move local video recording under the session folder for publishing
      mv /tmp/${artifactId}.mp4 ${LOG_DIR}/${artifactId}/video.mp4
    fi
  fi

  # share all the rest custom reports from LOG_DIR into artifactId subfolder
  for file in ${LOG_DIR}/*; do
    if [ -f "$file" ] && [ -s "$file" ] && [ "$file" != "${TASK_LOG}" ]; then
      echo "Sharing file: $file"
      # to avoid extra publishing as launch artifact for driver sessions
      mv $file ${LOG_DIR}/${artifactId}/
    fi
  done

  # register artifactId info to be able to parse by uploader
  echo "artifactId=$artifactId" > ${LOG_DIR}/.artifact-$artifactId
}

finish() {
  echo "on finish begin"

  startTime=$(date +%s)
  local taskId=$1

  if [ -z ${taskId} ]; then
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
      # seems like abort for up and running ffmpeg which should be killed and shared
      taskId=${sessionId}
    fi
  fi

  if [ ! -z ${taskId} ]; then
    share ${taskId}
  else
    echo "[warn] taskId is empty!"
  fi

  echo "on finish end"
}


concatAndroidRecording() {
  sessionId=$1
  echo sessionId:$sessionId

  #adb shell "su root chmod a+r ${sessionId}*.mp4"
  #adb shell "su root ls -la ${sessionId}*.mp4"

  videoFiles=$sessionId.txt

  # pull video artifacts until exist
  declare -i part=0
  while true; do
    adb pull "/sdcard/${sessionId}_${part}.mp4" "${sessionId}_${part}.mp4" > /dev/null 2>&1
    if [ ! -f "${sessionId}_${part}.mp4" ]; then
      echo "[info] [ConcatVideo] stop pulling ${sessionId} video artifacts!"
      break
    fi

    # cleanup device from generated video file in bg
    adb shell "rm -f /sdcard/${sessionId}_${part}.mp4" &

    #TODO: in case of often mistakes with 0 size verification just comment it. it seems like ffmpeg can handle empty file during concantenation
    if [ ! -s "${sessionId}_${part}.mp4" ]; then
      echo "[info] [ConcatVideo] stop pulling ${sessionId} video artifacts as ${sessionId}_${part}.mp4 already empty!!"
      ls -la "${sessionId}_${part}.mp4"
      break
    fi
    echo "file ${sessionId}_${part}.mp4" >> $videoFiles
    part+=1
  done

  if [ $part -eq 1 ]; then
    echo "[debug] [ConcatVideo] #12: there is no sense to concatenate video as it is single file, just rename..."
    mv ${sessionId}_0.mp4 /tmp/$sessionId.mp4
  else
    if [ -f $videoFiles ]; then
      cat $videoFiles
      #TODO: #9 concat audio as well if appropriate artifact exists
      ffmpeg $FFMPEG_OPTS -y -f concat -safe 0 -i $videoFiles -c copy /tmp/$sessionId.mp4
    else
      echo "[error] [ConcatVideo] unable to concat video as $videoFiles is absent!"
    fi

    # ffmpeg artifacts cleanup
    rm -f $videoFiles
  fi

  if [ -f /tmp/$sessionId.mp4 ]; then
    echo "[info] [ConcatVideo] /tmp/${sessionId}.mp4 generated successfully."
  else
    echo "[error] [ConcatVideo] unable to generate /tmp/${sessionId}.mp4!"
  fi

}



capture_video() {
  # use short sleep operations otherwise abort can't be handled via trap/share
  while true; do
    echo "waiting for Appium start..."
    while [ ! -f ${TASK_LOG} ]; do
      sleep 0.1
    done

    echo "waiting for the session start..."
    while [ -z $startedSessionId ]; do
      #capture mobile session startup for iOS and Android (appium)
      #2023-07-04 00:31:07:624 [Appium] New AndroidUiautomator2Driver session created successfully, session 07b5f246-cc7e-4c1b-97d6-5405f461eb86 added to master session list
      #2023-07-04 02:50:42:543 [Appium] New XCUITestDriver session created successfully, session 6e11b4b7-2dfd-46d9-b52d-e3ea33835704 added to master session list
      startedSessionId=`grep -E -m 1 " session created successfully, session " ${TASK_LOG} | cut -d " " -f 11 | cut -d " " -f 1`
    done
    echo "session started: $startedSessionId"

    /opt/start-capture-artifacts.sh $startedSessionId &

    # from time to time browser container exited before we able to detect finishedSessionId.
    # make sure to have workable functionality on trap finish (abort use-case as well)

    echo "waiting for the session finish..."
    while [ -z $finishedSessionId ]; do
      #capture mobile session finish for iOS and Android (appium)
      #2023-07-04 00:36:30:538 [Appium] Removing session 07b5f246-cc7e-4c1b-97d6-5405f461eb86 from our master session list
      #finishedSessionId=`grep -E -m 1 " from our master session list" ${TASK_LOG} | cut -d " " -f 7 | cut -d " " -f 1`

      # including support of the aborted session
      #2023-07-19 14:37:25:009 - [HTTP] [HTTP] --> DELETE /wd/hub/session/9da044cc-a96b-4052-8055-857900c6bbe8/window
      # or
      #2023-07-20 19:29:56:534 - [HTTP] [HTTP] <-- DELETE /wd/hub/session/3682ea1d-be66-49ad-af0d-792fc3f7e91a 200 1053 ms - 14
      finishedSessionId=`grep -E -m 1 " DELETE /wd/hub/session/" ${TASK_LOG} | cut -d "/" -f 5 | cut -d " " -f 1`
    done

    echo "session finished: $finishedSessionId"
    share $finishedSessionId

    startedSessionId=
    finishedSessionId=
  done

}


reconnect() {
  #let's try to do forcibly usbreset on exit when node is crashed/exited/killed
  if [ "${PLATFORM_NAME}" == "android" ]; then
    echo "Doing usbreset forcibly on attached device"
    usbreset ${DEVICE_BUS}
  fi
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

#TODO: remove later
echo ENTRYPOINT_DIR: $ENTRYPOINT_DIR
if [ "$REMOTE_ADB" = true ]; then
    ${ENTRYPOINT_DIR}/wireless_connect.sh
else
    ${ENTRYPOINT_DIR}/local_connect.sh
fi

ret=$?
if [ $ret -eq 3 ]; then
    # unauthorized state
    echo "Reconnecting..."
    reconnect
    exit 0
fi

if [  $ret -eq 2 ]; then
    # offline state
    echo "Restarting..."
    reconnect
    exit 1
fi

if [ $ret -eq 1 ]; then
    # is not available state due to the unknown reason
    echo "Exiting without restarting..."
    exit 0
fi

# convert to lower case using Linux/Mac compatible syntax (bash v3.2)
PLATFORM_NAME=`echo "$PLATFORM_NAME" |  tr '[:upper:]' '[:lower:]'`
if [ "${PLATFORM_NAME}" = "android" ]; then
    . /opt/android.sh
elif [ "${PLATFORM_NAME}" = "ios" ]; then
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

pkill -x xvfb-run
rm -rf /tmp/.X99-lock

#sleep infinity

echo $CMD
$CMD &

trap 'finish' SIGTERM

# start in background video artifacts capturing
capture_video &

# wait until backgroud processes exists for node (appium)
node_pids=`pidof node`
wait -n $node_pids


exit_code=$?
echo "Exit status: $exit_code"

if [ $exit_code -eq 101 ]; then
  echo "Hub down or not responding. Sleeping ${UNREGISTER_IF_STILL_DOWN_AFTER}ms and 15s..."
  sleep $((UNREGISTER_IF_STILL_DOWN_AFTER/1000))
  sleep 15
fi

echo exit_code: $exit_code

# forcibly exit with error code to initiate restart
exit 1

