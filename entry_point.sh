#!/bin/bash

NODE_CONFIG_JSON="/root/nodeconfig.json"
DEFAULT_CAPABILITIES_JSON="/root/defaultcapabilities.json"
#export needed to be accessible in upload-artifacts.sh
export APPIUM_LOG="${APPIUM_LOG:-/var/log/appium.log}"
CMD="xvfb-run appium --log $APPIUM_LOG"

getFallbackSession() {
  declare fallbackSessionId=
  declare tempSessionId=
  while [ -z $fallbackSessionId ] && [ -z $tempSessionId ]; do
    sleep 0.1
    # [debug] [BaseDriver]       "fallbackSessionId": "e7349434-a405-4ef7-99ef-6ce4aa069912"
    fallbackSessionId=`cat ${APPIUM_LOG} | grep "BaseDriver" | grep "fallbackSessionId" | cut -d "\"" -f 4`

    # 2021-10-22 14:34:46:878 [BaseDriver] Session created with session id: d11cbf4a-c269-4d0e-bc25-37cb93616781
    tempSessionId=`cat ${APPIUM_LOG} | grep "Session created with session id" | cut -d ":" -f 5`
  done

  # if no custom fallbackSessionId id detected we should proceed with regular sessionId detection
  if [ ! -z $fallbackSessionId ]; then
    # in case of any problem with session startup it will be tracked as sessionId!
    export sessionId=$(echo $fallbackSessionId)
    echo "[info] [AppiumEntryPoint] fallbackSessionId: $fallbackSessionId"
  fi
}

getSession() {
  declare tempSessionId=
  while [ -z $tempSessionId ]; do
    sleep 0.1
    # 2021-10-22 14:34:46:878 [BaseDriver] Session created with session id: d11cbf4a-c269-4d0e-bc25-37cb93616781
    tempSessionId=`cat ${APPIUM_LOG} | grep "Session created with session id" | cut -d ":" -f 5`
  done

  #13: cut initial frames in video where appium app starting
  # Optimal line is below because it cut UIAutomator server stratup time and start video from the attempt to run application. So all kind of startup problems might be detected
  #   2021-11-13 12:45:49:210 [WD Proxy] Got response with status 200: {"sessionId":"None","value":{"message":"UiAutomator2 Server is ready to accept commands","ready":true}}
  # The latest possible line is below. The only problem it couldn't record unlocking/unpining etc where problems might occur. Moreover this video ~5s less then duration in reporting:)
  #   2021-11-13 12:45:55:233 [Appium] New AndroidUiautomator2Driver session created successfully, session 2045e7c6-b34d-44c6-8b72-2bd68489de82 added to master session list
  declare isStarted=
  declare isFailed=
  while [ -z $isStarted ] && [ -z $isFailed ]; do
    sleep 0.1
    # 2021-11-13 12:45:49:210 [WD Proxy] Got response with status 200: {"sessionId":"None","value":{"message":"UiAutomator2 Server is ready to accept commands","ready":true}}
    isStarted=`cat ${APPIUM_LOG} | grep "Got response with status" | grep "Server is ready to accept commands" | cut -d ":" -f 9 | cut -d "}" -f 1`
    echo "[debug] [AppiumEntryPoint] isStarted: $isStarted"

    #2021-11-21 14:34:30:565 [HTTP] <-- POST /wd/hub/session 500 213 ms - 651
    isFailed=`cat ${APPIUM_LOG} | grep "POST /wd/hub/session 500" | cut -d " " -f 7`
    echo "[debug] [AppiumEntryPoint] isFailed: $isFailed"
  done

  # export sessionId value only in case of Appium server startup success!
  export sessionId=$(echo $tempSessionId)
  echo "[info] [AppiumEntryPoint] sessionId: $sessionId"
}

waitUntilSessionExists() {
  declare isFinished=
  declare isFailed=
  while [ -z $isFinished ] && [ -z $isFailed ]; do
    sleep 0.1
    #2021-10-22 16:00:21:124 [BaseDriver] Event 'quitSessionFinished' logged at 1634918421124 (09:00:21 GMT-0700 (Pacific Daylight Time))
    # Important! do not wrap quitSessionFinished in quotes here otherwise it can't recognize session finish!
    isFinished=`cat ${APPIUM_LOG} | grep quitSessionFinished | cut -d "'" -f 2`
    echo "[debug] [AppiumEntryPoint] isFinished: $isFinished"

    #handler for negative scenarios when session can't be started
    #2021-11-21 14:34:30:565 [HTTP] <-- POST /wd/hub/session 500 213 ms - 651
    isFailed=`cat ${APPIUM_LOG} | grep "POST /wd/hub/session 500" | cut -d " " -f 7`
    echo "[debug] [AppiumEntryPoint] isFailed: $isFailed"
  done
  echo "[info] [AppiumEntryPoint] session $sessionId finished."
}

upload() {
  echo "[info] [AppiumEntryPoint] Uploading artifacts on container SIGTERM for sessionId: $sessionId"
  /opt/stop-capture-artifacts.sh
  # quotes required to keep order of params
  /opt/upload-artifacts.sh "${sessionId}"
}

# method not used but keep for future when we could operate without selenium grid
# https://github.com/zebrunner/esg-appium/issues/20
# retain_task shouldn't kill appium in between session
restart_appium() {
  # kill and restart appium & xvfb-run asap to be ready for the next session
  pkill -x node
  mv "${APPIUM_LOG}" "${sessionId}.log"
  pkill -x xvfb-run
  pkill -x Xvfb
  rm -rf /tmp/.X99-lock
  if [ "$REMOTE_ADB" = true ]; then
    adb disconnect
    /root/wireless_connect.sh
    # think about device reconnect for local as well
    #else
    #/root/local_connect.sh
  fi

  $CMD &
}

clear_appium() {
  # copy appium log for upload and clean to populate new in new requests
  ls -la "${APPIUM_LOG}"
  cp "${APPIUM_LOG}" "${sessionId}.log"
  > "${APPIUM_LOG}"
  ls -la "${APPIUM_LOG}"
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
else
    /root/local_connect.sh
fi

if [ "$CONNECT_TO_GRID" = true ]; then
    if [ "$CUSTOM_NODE_CONFIG" = true ]; then
        #execute to print info in stdout
        . /opt/configgen.sh
        # generate json file
        /opt/configgen.sh > $NODE_CONFIG_JSON
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

$CMD &

if [ "$RETAIN_TASK" = true ]; then
  declare -i index=0
  while true; do
    # don't start screen capture asap in retain mode otherwise between tests execution we will do huge recording operation...

    echo "[info] [AppiumEntryPoint] starting session ${index} supervisor..."
    getFallbackSession
    /opt/capture-artifacts.sh ${sessionId} &

    getSession
    /opt/stop-capture-artifacts.sh
    sleep 0.3
    /opt/capture-artifacts.sh ${sessionId} &

    #TODO: think about replacing order i.e. stop_screen_recording and then restart_appium
    # to make it happen stop_screen_record should analyze session quit but trap upload then should be re-tested carefully
    waitUntilSessionExists
    /opt/stop-capture-artifacts.sh
    sleep 0.3

    clear_appium
    #TODO: test if execution in background is fine because originally it was foreground call
    /opt/upload-artifacts.sh "${sessionId}" &
    #reset sessionId
    export sessionId=
    echo "[info] [AppiumEntryPoint] finished session ${index} supervisor."
    index+=1
  done
else
  trap 'upload' SIGTERM
  # start capturing artifacts explicitly to provide artifacts for fallbackSessionId
  getFallbackSession
  /opt/capture-artifacts.sh ${sessionId} &

  getSession
  /opt/stop-capture-artifacts.sh
  sleep 0.3
  /opt/capture-artifacts.sh ${sessionId} &
fi

echo "[info] [AppiumEntryPoint] waiting until SIGTERM received"
while true; do :; done

