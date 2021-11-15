#!/bin/bash

NODE_CONFIG_JSON="/root/nodeconfig.json"
DEFAULT_CAPABILITIES_JSON="/root/defaultcapabilities.json"
APPIUM_LOG="${APPIUM_LOG:-/var/log/appium.log}"
CMD="xvfb-run appium --log $APPIUM_LOG"

getSessionId() {
  export sessionId=
  while [ -z $sessionId ]; do
    sleep 0.1
    # 2021-10-22 14:34:46:878 [BaseDriver] Session created with session id: d11cbf4a-c269-4d0e-bc25-37cb93616781
    sessionId=`cat ${APPIUM_LOG} | grep "Session created with session id" | cut -d ":" -f 5`
  done
  export sessionId=$(echo $sessionId)
  echo "================================================================================================================="
  echo "sessionId: $sessionId"
  echo "================================================================================================================="

  #13: cut initial frames in video where appium app starting
  # Optimal line is below because it cut UIAutomator server stratup time and start video from the attempt to run application. So all kind of startup problems might be detected
  #   2021-11-13 12:45:49:210 [WD Proxy] Got response with status 200: {"sessionId":"None","value":{"message":"UiAutomator2 Server is ready to accept commands","ready":true}}
  # The latest possible line is below. The only problem it couldn't record unlocking/unpining etc where problems might occur. Moreover this video ~5s less then duration in reporting:)
  #   2021-11-13 12:45:55:233 [Appium] New AndroidUiautomator2Driver session created successfully, session 2045e7c6-b34d-44c6-8b72-2bd68489de82 added to master session list
  declare isReady=
  while [ -z $isReady ]; do
    sleep 0.1
    # 2021-11-13 12:45:49:210 [WD Proxy] Got response with status 200: {"sessionId":"None","value":{"message":"UiAutomator2 Server is ready to accept commands","ready":true}}
    isReady=`cat ${APPIUM_LOG} | grep "Got response with status" | grep "Server is ready to accept commands" | cut -d ":" -f 9 | cut -d "}" -f 1`
    #echo "isReady: $isReady"
  done
}

upload() {
  echo "Uploading artifacts on container SIGTERM for sessionId: $sessionId"
  stop_screen_recording
  upload_screen_recording
}

waitUntilSessionExists() {
  isExited=
  while [ -z $isExited ]; do
    sleep 0.1
    #2021-10-22 16:00:21:124 [BaseDriver] Event 'quitSessionFinished' logged at 1634918421124 (09:00:21 GMT-0700 (Pacific Daylight Time))
    isExited=`cat ${APPIUM_LOG} | grep quitSessionFinished | cut -d "'" -f 2`
#    echo isExited: $isExited
  done
  echo "session $sessionId finished."
}

restart_appium() {
  # kill and restart appium & xvfb-run asap to be ready for the next session
  pkill -x node
  mv "${APPIUM_LOG}" "${sessionId}.log"
  pkill -x xvfb-run
  pkill -x Xvfb
  rm -rf /tmp/.X99-lock
  adb disconnect
  if [ "$REMOTE_ADB" = true ]; then
    /root/wireless_connect.sh
  fi

  $CMD &
}

start_screen_recording() {
  echo "================================================================================================================="
  echo "ATTENTION!!! Starting video recording for ${sessionId}"
  echo "================================================================================================================="

  #TODO: #9 integrate audio capturing for android devices
  if [ ! -z $BUCKET ] && [ ! -z $TENANT ]; then
    /root/capture-screen.sh ${sessionId} &
  else
    echo "No sense to record video without S3 compatible storage!"
  fi
}

stop_screen_recording() {
  echo "================================================================================================================="
  echo "ATTENTION!!! session ${sessionId} finished."
  echo "================================================================================================================="
  #kill screenrecord on emulator/device
  adb shell "su root pkill -l 2 -f screenrecord"
  # sleep was required to finish kill process correctly so video file is closed and editable/visible later.
  # as of now `sleep 1` moved onto the concat-video.sh
  #sleep 1

  #kill capture-screen.sh parent shell script
  pkill -f capture-screen.sh
}

upload_screen_recording() {
  if [ ! -z $BUCKET ] && [ ! -z $TENANT ]; then
    /root/concat-video.sh ${sessionId}

    #upload session artifacts
    S3_KEY_PATTERN=s3://${BUCKET}/${TENANT}/artifacts/test-sessions/${sessionId}
    echo S3_KEY_PATTERN: ${S3_KEY_PATTERN}

    date
    if [ -f "${sessionId}.log" ]; then
      aws s3 cp "${sessionId}.log" "${S3_KEY_PATTERN}/session.log"
    else
      # use-case when RETAIN_TASK is off or when docker container stopped explicitly and forcibly by ESG/human
      aws s3 cp "${APPIUM_LOG}" "${S3_KEY_PATTERN}/session.log"
    fi
    aws s3 cp "${sessionId}.mp4" "${S3_KEY_PATTERN}/video.mp4"
    date

    #cleanup
    rm -f "${sessionId}*"

  else
    echo "No sense to upload video recording without S3 compatible storage!"
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

if [ "$REMOTE_ADB" = true ]; then
    /root/wireless_connect.sh
fi

if [ "$CONNECT_TO_GRID" = true ]; then
    if [ "$CUSTOM_NODE_CONFIG" != true ]; then
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

$CMD &

if [ "$RETAIN_TASK" = true ]; then
  declare -i index=0
  while true; do
    echo "starting session ${index} supervisor..."
    getSessionId
    echo sessionId: $sessionId

    start_screen_recording
    #TODO: think about replacing order i.e. stop_screen_recording and then restart_appium
    # to make it happen stop_screen_record should analye session quit but trap upload them should be re-tested carefully
    waitUntilSessionExists
    stop_screen_recording
    restart_appium
    upload_screen_recording
    #reset sessionId
    export sessionId=
    index+=1
    echo "finished session ${index} supervisor."
  done
else
  getSessionId
  echo sessionId: $sessionId
  trap 'upload' SIGTERM
  start_screen_recording
fi

echo "waiting until SIGTERM received"
while true; do :; done

