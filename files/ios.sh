#!/bin/bash

echo DEVICE_UDID: $DEVICE_UDID

echo "[$(date +'%d/%m/%Y %H:%M:%S')] populating device info"
deviceInfo=$(ios info --udid=$DEVICE_UDID 2>&1)
echo "device info: $deviceInfo"

if [[ "${deviceInfo}" == *"failed getting info"* ]]; then
  echo "ERROR! failed getting info. No sense to proceed with services startup!"
  exit 0
fi

export PLATFORM_VERSION=$(echo $deviceInfo | jq -r ".ProductVersion | select( . != null )")
deviceClass=$(echo $deviceInfo | jq -r ".DeviceClass | select( . != null )")
export DEVICETYPE='Phone'
if [ "$deviceClass" = "iPad" ]; then
  export DEVICETYPE='Tablet'
fi
if [ "$deviceClass" = "AppleTV" ]; then
  export DEVICETYPE='tvOS'
fi

# Parse output to detect Timeoud out error.
# {"channel_id":"com.apple.instruments.server.services.deviceinfo","error":"Timed out waiting for response for message:5 channel:0","level":"error","msg":"failed requesting channel","time":"2023-09-05T15:19:27Z"}

if [[ "${deviceInfo}" == *"Timed out waiting for response for message"* ]]; then
  echo "ERROR! Timed out waiting for response detected."
  if [[ "${DEVICETYPE}" == "tvOS" ]]; then
    echo "ERROR! TV reboot is required! Exiting without restart..."
    exit 0
  else
    echo "WARN! device reboot is recommended!"
  fi
fi

if [[ "${PLATFORM_VERSION}" == "17."* ]] || [[ "${DEVICETYPE}" == "AppleTV" ]]; then
  echo "Mounting iOS via Linux container not supported! WDA should be compiled and started via xcode!"
  echo "wda install and startup steps will be skipped from appium container..."

  # start proxy forward to device
  ios forward $WDA_PORT $WDA_PORT --udid=$DEVICE_UDID > /dev/null 2>&1 &
  ios forward $MJPEG_PORT $MJPEG_PORT --udid=$DEVICE_UDID > /dev/null 2>&1 &
  return 0
fi

echo "[$(date +'%d/%m/%Y %H:%M:%S')] Allow to download and mount DeveloperDiskImages automatically"
res=$(ios image auto --basedir /tmp/DeveloperDiskImages --udid=$DEVICE_UDID 2>&1)
echo $res

# Parse error to detect anomaly with mounting and/or pairing. It might be use case when user cleared already trusted computer
# {"err":"failed connecting to image mounter: Could not start service:com.apple.mobile.mobile_image_mounter with reason:'SessionInactive'. Have you mounted the Developer Image?","image":"/tmp/DeveloperDiskImages/16.4.1/DeveloperDiskImage.dmg","level":"error","msg":"error mounting image","time":"2023-08-04T11:25:53Z","udid":"d6afc6b3a65584ca0813eb8957c6479b9b6ebb11"}

if [[ "${res}" == *"error mounting image"* ]]; then
  echo "ERROR! Mounting is broken due to the invalid paring. Please re pair again!"
  exit 1
else
  echo "Developer Image auto mount succeed."
  sleep 3
fi


# Check if WDA is already installed
ios apps --udid=$DEVICE_UDID | grep -v grep | grep $WDA_BUNDLEID > /dev/null 2>&1
if [[ ! $? -eq 0 ]]; then
  echo "$WDA_BUNDLEID app is not installed"

  if [ ! -f $WDA_FILE ]; then
    echo "ERROR! WebDriverAgent.ipa file is not valid!"
    # return exit 0 to stop automatic restart of the appium container
    exit 0
  fi

  echo "[$(date +'%d/%m/%Y %H:%M:%S')] Installing WDA application on device"
  ios install --path="$WDA_FILE" --udid=$DEVICE_UDID
  if [ $? == 1 ]; then
    echo "ERROR! Unable to install WebDriverAgent.ipa!"
    # return exit 0 to stop automatic restart of the appium container
    exit 0
  fi
else
  echo "$WDA_BUNDLEID app is already installed"
fi


# launch WDA on device
. /opt/start-wda.sh
# start wda listener with ability to restart wda
/opt/check-wda.sh &

export AUTOMATION_NAME='XCUITest'

