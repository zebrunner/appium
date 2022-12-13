#!/bin/bash

# no need to launch springboard as it is already started. below command doesn't activate it!
#echo "[$(date +'%d/%m/%Y %H:%M:%S')] Activating default com.apple.springboard during WDA startup"
#ios launch com.apple.springboard

echo "[$(date +'%d/%m/%Y %H:%M:%S')] Killing existing WebDriverAgent application if any"
ios kill $WDA_BUNDLEID --udid=$DEVICE_UDID

echo "[$(date +'%d/%m/%Y %H:%M:%S')] Starting WebDriverAgent application on port $WDA_PORT"
ios runwda --bundleid=$WDA_BUNDLEID --testrunnerbundleid=$WDA_BUNDLEID --xctestconfig=WebDriverAgentRunner.xctest --env USE_PORT=$WDA_PORT --env MJPEG_SERVER_PORT=$MJPEG_PORT --env UITEST_DISABLE_ANIMATIONS=YES --udid $DEVICE_UDID > ${WDA_LOG_FILE} 2>&1 &

#Start the WDA service on the device using the WDA bundleId
ip=""
#Parse the device IP address from the WebDriverAgent logs using the ServerURL
#We are trying several times because it takes a few seconds to start the WDA but we want to avoid hardcoding specific seconds wait

echo detecting WDA_HOST ip address...
for ((i=1; i<=$WDA_WAIT_TIMEOUT; i++))
do
 if [ -z "$ip" ]
  then
   # WebDriverAgent v4.1.4
   #{"level":"info","msg":"2021-12-08 19:26:18.502735+0300 WebDriverAgentRunner-Runner[8680:8374823] ServerURLHere-\u003ehttp://192.168.88.155:8100\u003c-ServerURLHere\n","time":"2021-12-08T16:26:18Z"}

   # WebDriverAgent 4.10.12
   # {"fields.msg":"2022-12-13 16:56:20.796411+0300 WebDriverAgentRunner-Runner[27575:4609350] ServerURLHere-\u003ehttp://192.168.89.19:8100\u003c-ServerURLHere\n","fields.time":28890969122592,"level":"info","msg":"outputReceived:fromProcess:atTime:","pid":27575,"time":"2022-12-13T05:56:20-08:00"}
   ip=`grep -o -P '(?<=ServerURLHere).*(?=ServerURLHere)' ${WDA_LOG_FILE} | cut -d ':' -f 2`
   # make sure to remove \\ to get clear ip from //192.168.89.19

   echo "attempt $i"
   sleep 1
  else
   break
 fi
done

if [[ -z $ip ]]; then
  echo "ERROR! Unable to parse WDA_HOST ip from log file!"
  cat $WDA_LOG_FILE
  # Destroy appium process as there is no sense to continue with undefined WDA_HOST ip!
  pkill node
fi

export WDA_HOST="${ip//\//}"
echo "Detected WDA_HOST ip: ${WDA_HOST}"
echo "WDA_PORT=${WDA_PORT}"


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

# #67 start stf services only when 1st WDA session was successfully registered
echo "export WDA_HOST=${WDA_HOST}" > ${WDA_ENV}
echo "export WDA_PORT=${WDA_PORT}" >> ${WDA_ENV}
echo "export MJPEG_PORT=${MJPEG_PORT}" >> ${WDA_ENV}
echo "export PLATFORM_VERSION=${PLATFORM_VERSION}" >> ${WDA_ENV}

#TODO: to  improve better 1st super slow session startup we have to investigate extra xcuitest caps: https://github.com/appium/appium-xcuitest-driver
#customSnapshotTimeout, waitForIdleTimeout, animationCoolOffTimeout etc

#TODO: also find a way to override default snapshot generation 60 sec timeout building WebDriverAgent.ipa



