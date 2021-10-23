#!/bin/bash

NODE_CONFIG_JSON="/root/nodeconfig.json"
DEFAULT_CAPABILITIES_JSON="/root/defaultcapabilities.json"
APPIUM_LOG="${APPIUM_LOG:-/var/log/appium.log}"
CMD="xvfb-run appium --log $APPIUM_LOG"

upload() {
  echo "TODO: verify if we need extra upload on container exit!"
#  stop_screen_recording $1 $2
}

restart_appium() {
  index=$1

  # kill and restart appium & xvfb-run asap to be ready for the next session
  pkill -x node
  mv "${APPIUM_LOG}" "${APPIUM_LOG}.$index"
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
  sessionId=$1
  if [ ! -z $BUCKET ] && [ ! -z $TENANT ] && [ ! -z $sessionId ]; then
   #TODO: wait until application or browser started otherwise 5-10 sec of Appium Settings app is recorded as well. Limit waiting by 10 seconds and start with recording anyway!
   # potential line to track valid session startup: "Screen already unlocked, doing nothing"
    echo "Start video recording for $sessionId"
    adb shell "su root screenrecord /video.mp4" &
  else 
    echo "No sense to start screen recording as sessionId not detected!"
  fi
}

stop_screen_recording() {
  sessionId=$1
  index=$2

  if [ ! -z $BUCKET ] && [ ! -z $TENANT ] && [ ! -z $sessionId ]; then
    echo "session finished. stopping recorder..."
    #kill screenrecord process
    adb shell "su root pkill -l 2 -f screenrecord"
    sleep 1
    adb shell "su root chmod a+r video.mp4"
    adb pull /video.mp4 "video_$index.mp4"

    #upload session artifacts
    S3_KEY_PATTERN=s3://${BUCKET}/${TENANT}/artifacts/test-sessions/${sessionId}
    echo S3_KEY_PATTERN: ${S3_KEY_PATTERN}

    date
    aws s3 cp "${APPIUM_LOG}.$index" "${S3_KEY_PATTERN}/session.log"
    aws s3 cp "video_$index.mp4" "${S3_KEY_PATTERN}/video.mp4"
    rm -f "${APPIUM_LOG}.$index"
    rm -f "video_$index.mp4"
    date
  else
    echo "No sense to stop screen recording as sessionId not detected!"
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

trap 'upload $sessionId' SIGTERM

$CMD &

declare -i index=0
while true; do
  echo "starting session $i supervisor..."
  #TODO: move sessionId detection into the embedded function
  sessionId=
  while [ -z $sessionId ]; do
    sleep 0.1
    # 2021-10-22 14:34:46:878 [BaseDriver] Session created with session id: d11cbf4a-c269-4d0e-bc25-37cb93616781
    sessionId=`cat ${APPIUM_LOG} | grep "Session created with session id" | cut -d ":" -f 5`
  done
  export sessionId=$(echo $sessionId)
  echo "sessionId inited: $sessionId"

  start_screen_recording $sessionId

  #TODO: mode driver quit/close into the embeded function
  isExited=
  while [ -z $isExited ]; do
    sleep 0.1
    #2021-10-22 16:00:21:124 [BaseDriver] Event 'quitSessionFinished' logged at 1634918421124 (09:00:21 GMT-0700 (Pacific Daylight Time))
    isExited=`cat ${APPIUM_LOG} | grep quitSessionFinished | cut -d "'" -f 2`
#    echo isExited: $isExited
  done

  restart_appium $index
  echo "session $sessionId finished. Collecting video and log artifacts..."
  stop_screen_recording $sessionId $index

  #reset sessionId
  sessionId=
  index+=1
  echo "finished session $i supervisor."
done

echo "waiting until SIGTERM received"
while true; do :; done
