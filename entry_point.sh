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

#TODO: investigate possibility to capture audio as well
  if [ ! -z $BUCKET ] && [ ! -z $TENANT ]; then
    #TODO: wait until application or browser started otherwise 5-10 sec of Appium Settings app is recorded as well. Limit waiting by 10 seconds and start with recording anyway!
    # potential line to track valid session startup: "Screen already unlocked, doing nothing"
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
  #TODO: put explicit comment  here why sleep is required
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
    aws s3 cp "${sessionId}.log" "${S3_KEY_PATTERN}/session.log"
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

