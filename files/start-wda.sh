#!/bin/bash

# no need to launch springboard as it is already started. below command doesn't activate it!
#echo "[$(date +'%d/%m/%Y %H:%M:%S')] Activating default com.apple.springboard during WDA startup"
#ios launch com.apple.springboard

touch ${WDA_LOG_FILE}
# verify if wda is already started and reuse this session
curl -Is "http://${WDA_HOST}:${WDA_PORT}/status" | head -1 | grep -q '200 OK'
if [ $? -eq 1 ]; then
  echo "existing WDA not detected"

  schema=WebDriverAgentRunner
  if [ "$DEVICETYPE" == "tvOS" ]; then
    schema=WebDriverAgentRunner_tvOS
  fi

  #Start the WDA service on the device using the WDA bundleId
  echo "[$(date +'%d/%m/%Y %H:%M:%S')] Starting WebDriverAgent application on port $WDA_PORT"
  ios runwda --bundleid=$WDA_BUNDLEID --testrunnerbundleid=$WDA_BUNDLEID --xctestconfig=${schema}.xctest --env USE_PORT=$WDA_PORT --env MJPEG_SERVER_PORT=$MJPEG_PORT --env UITEST_DISABLE_ANIMATIONS=YES --udid=$DEVICE_UDID > ${WDA_LOG_FILE} 2>&1 &

  # #148: ios: reuse proxy for redirecting wda requests through appium container
  ios forward $WDA_PORT $WDA_PORT --udid=$DEVICE_UDID > /dev/null 2>&1 &
  ios forward $MJPEG_PORT $MJPEG_PORT --udid=$DEVICE_UDID > /dev/null 2>&1 &
fi

tail -f ${WDA_LOG_FILE} &

# wait until WDA starts
startTime=$(date +%s)
idleTimeout=$WDA_WAIT_TIMEOUT
wdaStarted=0
while [ $(( startTime + idleTimeout )) -gt "$(date +%s)" ]; do
  curl -Is "http://${WDA_HOST}:${WDA_PORT}/status" | head -1 | grep -q '200 OK'
  if [ $? -eq 0 ]; then
    echo "wda status is ok."
    wdaStarted=1
    break
  fi
  sleep 1
done

if [ $wdaStarted -eq 0 ]; then
  echo "WDA is unhealthy!"
  # Destroy appium process as there is no sense to continue with undefined WDA_HOST ip!
  pkill node
  exit 1
fi

#TODO: to  improve better 1st super slow session startup we have to investigate extra xcuitest caps: https://github.com/appium/appium-xcuitest-driver
#customSnapshotTimeout, waitForIdleTimeout, animationCoolOffTimeout etc

#TODO: also find a way to override default snapshot generation 60 sec timeout building WebDriverAgent.ipa



