#!/bin/bash

NODE_CONFIG_JSON="/root/nodeconfig.json"
DEFAULT_CAPABILITIES_JSON="/root/defaultcapabilities.json"
APPIUM_LOG="${APPIUM_LOG:-/var/log/appium.log}"

CMD="xvfb-run appium --log-no-colors --log-timestamp -pa /wd/hub --port $APPIUM_PORT --log $APPIUM_LOG $APPIUM_CLI"
#--use-plugins=relaxed-caps

upload() {
  /opt/stop-capture-artifacts.sh
  sleep 0.3
  # parse current sessionId from /tmp/video.log
  if [ -f /tmp/video.log ]; then
    sessionId=`cat /tmp/video.log | grep "sessionId:"  | tail -1 | cut -d ":" -f 2`
    if [ ! -z "${sessionId}" ]; then
      # sessionId detected
      echo sessionId: "$sessionId"
      /opt/upload-artifacts.sh "${sessionId}"
    fi
  fi
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
    echo "Restarting..."
    exit 1
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

echo "TODO: uncomment and apply patch if needed"
#if [ "$MCLOUD" = true ]; then
#    /opt/mcloud/appium-patch.sh
#fi

pkill -x xvfb-run
rm -rf /tmp/.X99-lock

#sleep infinity

echo $CMD
$CMD &

echo "[info] [AppiumEntryPoint] registering upload method on SIGTERM"
trap 'upload' SIGTERM
echo "[info] [AppiumEntryPoint] waiting until SIGTERM received"

# wait until backgroud processes exists for node (appium)
node_pids=`pidof node`
wait -n $node_pids


exit_code=$?
echo "Exit status: $exit_code"

# seems like healthcheck is broken after removal
# remove WDA_ENV if any
#rm -f ${WDA_ENV}


if [ $exit_code -eq 101 ]; then
  echo "Hub down or not responding. Sleeping ${UNREGISTER_IF_STILL_DOWN_AFTER}ms and 15s..."
  sleep $((UNREGISTER_IF_STILL_DOWN_AFTER/1000))
  sleep 15
fi

echo exit_code: $exit_code

# forcibly exit with error code to initiate restart
exit 1

