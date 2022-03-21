#!/bin/bash

NODE_CONFIG_JSON="/root/nodeconfig.json"
DEFAULT_CAPABILITIES_JSON="/root/defaultcapabilities.json"
APPIUM_LOG="${APPIUM_LOG:-/var/log/appium.log}"

CMD="xvfb-run appium --log-no-colors --log-timestamp --log $APPIUM_LOG $APPIUM_CLI"

upload() {
  /opt/stop-capture-artifacts.sh
  sleep 0.3
  # parse current sessionId from /tmp/video.log
  sessionId=`cat /tmp/video.log | grep sessionId | cut -d ":" -f 2`
  if [ -z $sessionId ]; then
    exit 0
  fi
  echo sessionId: "$sessionId"
  # quotes required to keep order of params
  /opt/upload-artifacts.sh "${sessionId}"
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

if [ "$MCLOUD" = true ]; then
    /opt/mcloud/appium-patch.sh
fi

pkill -x xvfb-run
rm -rf /tmp/.X99-lock

echo $CMD
$CMD &

echo "[info] [AppiumEntryPoint] registering upload method on SIGTERM"
trap 'upload' SIGTERM
echo "[info] [AppiumEntryPoint] waiting until SIGTERM received"

echo "---------------------------------------------------------"
echo "processes RIGHT AFTER START:"
ps -ef
echo "---------------------------------------------------------"

# wait until backgroud processes exists for node (appium)
node_pids=`pidof node`
wait -n $node_pids


echo "Exit status: $?"
echo "---------------------------------------------------------"
echo "processes BEFORE EXIT:"
ps -ef
echo "---------------------------------------------------------"

# rmove WDA_ENV if any
rm -f ${WDA_ENV}
