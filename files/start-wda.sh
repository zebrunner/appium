#!/bin/bash

# no need to launch springboard as it is already started. below command doesn't activate it!
#echo "[$(date +'%d/%m/%Y %H:%M:%S')] Activating default com.apple.springboard during WDA startup"
#ios launch com.apple.springboard

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
  #TODO: find better way to tail
  #tail -n 100 -f ${WDA_LOG_FILE} &

  # #148: ios: reuse proxy for redirecting wda requests through appium container
  ios forward $WDA_PORT $WDA_PORT --udid=$DEVICE_UDID > /dev/null 2>&1 &
  ios forward $MJPEG_PORT $MJPEG_PORT --udid=$DEVICE_UDID > /dev/null 2>&1 &
fi

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
  cat $WDA_LOG_FILE
  # Destroy appium process as there is no sense to continue with undefined WDA_HOST ip!
  pkill node
  exit 1
fi

# #247: right after the WDA startup it should load SNAPSHOT of com.apple.springboard default screen and default timeout is 60 sec for 1st start.
# We have to start this session at once and till next restart WDA sessions might be stopped/started asap.
echo "[$(date +'%d/%m/%Y %H:%M:%S')] Starting WebDriverAgent 1st session"
# start new WDA session with default 60 sec snapshot timeout
sessionFile=/tmp/${DEVICE_UDID}.txt
curl --silent --location --request POST "http://${WDA_HOST}:${WDA_PORT}/session" --header 'Content-Type: application/json' --data-raw '{"capabilities": {"waitForQuiescence": false}}' > ${sessionFile}

echo "WDA session response:"
cat ${sessionFile}

bundleId=`cat $sessionFile | grep "CFBundleIdentifier" | cut -d '"' -f 4`
echo bundleId: $bundleId

sessionId=`cat $sessionFile | grep -m 1 "sessionId" | cut -d '"' -f 4`
echo sessionId: $sessionId

#TODO: test default bundleId for AppleTV
if [[ "$bundleId" != "com.apple.springboard" ]]; then
  echo "[$(date +'%d/%m/%Y %H:%M:%S')] Activating springboard app forcibly"
  curl --silent --location --request POST "http://${WDA_HOST}:${WDA_PORT}/session/$sessionId/wda/apps/launch" --header 'Content-Type: application/json' --data-raw '{"bundleId": "com.apple.springboard"}'
  sleep 1
  curl --silent --location --request POST "http://${WDA_HOST}:${WDA_PORT}/session" --header 'Content-Type: application/json' --data-raw '{"capabilities": {"waitForQuiescence": false}}'
fi

# #285 do stop for default wda session to improve homescreen activation during usage in STF
echo "[$(date +'%d/%m/%Y %H:%M:%S')] Stopping 1st default WebDriverAgent session"
curl --silent --location --request GET "http://${WDA_HOST}:${WDA_PORT}/status"  > ${sessionFile}
sessionId=`cat $sessionFile | grep -m 1 "sessionId" | cut -d '"' -f 4`
echo sessionId: $sessionId
curl --silent --location --request DELETE "http://${WDA_HOST}:${WDA_PORT}/session/${sessionId}"

rm -f ${sessionFile}

#TODO: to  improve better 1st super slow session startup we have to investigate extra xcuitest caps: https://github.com/appium/appium-xcuitest-driver
#customSnapshotTimeout, waitForIdleTimeout, animationCoolOffTimeout etc

#TODO: also find a way to override default snapshot generation 60 sec timeout building WebDriverAgent.ipa



