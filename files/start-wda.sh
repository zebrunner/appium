#!/bin/bash

LOG_FILE=/opt/logs/wda.log

echo "[$(date +'%d/%m/%Y %H:%M:%S')] Installing WDA application on device"
ios install --path=/opt/WebDriverAgent.ipa --udid=$DEVICE_UDID

echo "[$(date +'%d/%m/%Y %H:%M:%S')] Starting WebDriverAgent application on port $WDA_PORT"
ios runwda --bundleid=$WDA_BUNDLEID --testrunnerbundleid=$WDA_BUNDLEID --xctestconfig=WebDriverAgentRunner.xctest --env USE_PORT=$WDA_PORT --env MJPEG_SERVER_PORT=$MJPEG_PORT --udid $DEVICE_UDID > ${LOG_FILE} 2>&1 &

#Start the WDA service on the device using the WDA bundleId
ip=""
#Parse the device IP address from the WebDriverAgent logs using the ServerURL
#We are trying several times because it takes a few seconds to start the WDA but we want to avoid hardcoding specific seconds wait

echo detecting WDA_HOST ip address...
for ((i=1; i<=$WDA_WAIT_TIMEOUT; i++))
do
 if [ -z "$ip" ]
  then
   ip=`grep "ServerURLHere-" ${LOG_FILE} | cut -d ':' -f 7`
   echo "attempt $i"
   sleep 1
  else
   break
 fi
done

if [[ -z $ip ]]; then
  echo "ERROR! Unable to parse WDA_HOST ip from log file!"
  cat $LOG_FILE
  # Below exit completely destroy appium container as there is no sense to continue with undefined WDA_HOST ip!
  exit -1
fi

export WDA_HOST="${ip//\//}"
echo "Detected WDA_HOST ip: ${WDA_HOST}"

