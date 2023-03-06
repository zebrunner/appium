#!/bin/bash

# socat server to share usbmuxd socket via TCP
socat TCP-LISTEN:22,reuseaddr,fork UNIX-CONNECT:/var/run/usbmuxd &

ios list | grep $DEVICE_UDID
if [ $? == 1 ]; then
  echo "WARN! Unable to detect iOS device with udid: $DEVICE_UDID."
  export DEVICE_UDID=${DEVICE_UDID/-/}
fi

echo DEVICE_UDID: $DEVICE_UDID

# removing any existing env file with WDA settings...
rm -f ${WDA_ENV}

echo "[$(date +'%d/%m/%Y %H:%M:%S')] Pair device $DEVICE_UDID"
if [ -f ${P12FILE} ] && [ ! -z ${P12PASSWORD} ]; then
  # #280 pair supervised iOS device
  ios pair --p12file="${P12FILE}" --password="${P12PASSWORD}" --udid=$DEVICE_UDID
else
  # #256 pair iOS device in regular way
  ios pair --udid=$DEVICE_UDID
fi

if [ $? == 1 ]; then
  echo "ERROR! Unable to pair iOS device!"
  # Below exit completely destroy stf container as there is no sense to continue with unpaired device
  exit -1
fi

echo "[$(date +'%d/%m/%Y %H:%M:%S')] populating device info"
export PLATFORM_VERSION=$(ios info --udid=$DEVICE_UDID | jq -r ".ProductVersion")
deviceClass=$(ios info --udid=$DEVICE_UDID | jq -r ".DeviceClass")
export DEVICETYPE='Phone'
if [ "$deviceClass" = "iPad" ]; then
  export DEVICETYPE='Tablet'
fi
# TODO: detect tablet and TV for iOS, also review `ios info` output data like below
    #"DeviceClass":"iPhone",
    #"ProductName":"iPhone OS",
    #"ProductType":"iPhone10,5",
    #"ProductVersion":"14.7.1",
    #"SerialNumber":"C38V961BJCM2",
    #"TimeZone":"Europe/Minsk",
    #"TimeZoneOffsetFromUTC":10800,

echo "[$(date +'%d/%m/%Y %H:%M:%S')] Allow to download and mount DeveloperDiskImages automatically"
ios image auto --basedir /opt/zebrunner/DeveloperDiskImages --udid=$DEVICE_UDID

echo "[$(date +'%d/%m/%Y %H:%M:%S')] Installing WDA application on device"
ios install --path=/opt/WebDriverAgent.ipa --udid=$DEVICE_UDID
if [ $? == 1 ]; then
  echo "ERROR! Unable to install WebDriverAgent.ipa!"
  # return exit 0 to stop automatic restart of the appium container
  exit 0
fi


# install and launch WDA on device
. /opt/start-wda.sh
# start wda listener with ability to restart wda
/opt/check-wda.sh &

export AUTOMATION_NAME='XCUITest'

