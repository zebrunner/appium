#!/bin/bash

function pairDevice() {
  echo "[$(date +'%d/%m/%Y %H:%M:%S')] Pair device $DEVICE_UDID"
  # Examples of the command output
  # {"err":"Please accept the PairingDialog on the device and run pairing again!","level":"fatal","msg":"Pairing failed","time":"2023-08-04T10:58:08Z"}
  # {"err":"Please accept the PairingDialog on the device and run pairing again!","level":"fatal","msg":"Pairing failed","time":"2023-08-04T10:58:19Z"}
  # {"err":"Lockdown error: UserDeniedPairing","level":"fatal","msg":"Pairing failed","time":"2023-08-04T10:58:41Z"}
  # {"level":"info","msg":"Successfully paired d6afc6b3a65584ca0813eb8957c6479b9b6ebb11","time":"2023-08-04T11:02:59Z"}

  while true; do
    local res=$(ios pair --udid=$DEVICE_UDID 2>&1)
    #echo res: $res

    local error=`echo $res | jq -r '.err'`
    local message=`echo $res | jq -r '.msg'`

    # check that message string starts with appropriate words...
    if [[ "${message}" =~ ^"Successfully paired" ]]; then
      echo message: $message
      break
    fi

    if [[ ! -z ${error} ]] && [[ "${error}" == "Lockdown error: UserDeniedPairing" ]]; then
      echo "Pairing is denied. Reset trusted computers in 'Settings ->Developer->Clear Trusted Computers' and reconnect device!"
      # exit with code 0 to stop appium container and don't restart it constantly until user clear and trsut again
      exit 0
    fi

    echo error: $error
    echo "waiting 10 seconds..."
    sleep 10
  done
}

# socat server to share usbmuxd socket via TCP
socat TCP-LISTEN:22,reuseaddr,fork UNIX-CONNECT:/var/run/usbmuxd &

ios list | grep $DEVICE_UDID
if [ $? == 1 ]; then
  echo "WARN! Unable to detect iOS device with udid: $DEVICE_UDID."
  export DEVICE_UDID=${DEVICE_UDID/-/}

  # verify that device withaout dash in udid is available
  ios list | grep $DEVICE_UDID
  if [ $? == 1 ]; then
    echo "Device $DEVICE_UDID is not available!"
    #TODO: test if "exit 0" exit containr without automatic restart
    exit 0
  fi
fi
echo DEVICE_UDID: $DEVICE_UDID

# pair iOS device if neccessary
if [ ! -f /var/lib/lockdown/${DEVICE_UDID}.plist ]; then
  echo "Device $DEVICE_UDID is not paired yet!"
  pairDevice
else
  # IMPORTANT! make sure not to execute pair again otherwise it regenerate host certificate/id and trust dialog appear!!!
  echo "Device $DEVICE_UDID is already paired."
fi

echo "[$(date +'%d/%m/%Y %H:%M:%S')] populating device info"
export PLATFORM_VERSION=$(ios info --udid=$DEVICE_UDID | jq -r ".ProductVersion")
deviceInfo=$(ios info --udid=$DEVICE_UDID 2>&1)
echo "device info: " $deviceInfo

deviceClass=$(echo $deviceInfo | jq -r ".DeviceClass")
export DEVICETYPE='Phone'
if [ "$deviceClass" = "iPad" ]; then
  export DEVICETYPE='Tablet'
fi
if [ "$deviceClass" = "AppleTV" ]; then
  export DEVICETYPE='tvOS'
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
res=$(ios image auto --basedir /tmp/DeveloperDiskImages --udid=$DEVICE_UDID 2>&1)
echo $res

# Parse error to detect anomaly with mounting and/or pairing. It might be use case when user cleared already trusted computer
# {"err":"failed connecting to image mounter: Could not start service:com.apple.mobile.mobile_image_mounter with reason:'SessionInactive'. Have you mounted the Developer Image?","image":"/tmp/DeveloperDiskImages/16.4.1/DeveloperDiskImage.dmg","level":"error","msg":"error mounting image","time":"2023-08-04T11:25:53Z","udid":"d6afc6b3a65584ca0813eb8957c6479b9b6ebb11"}

if [[ "${res}" == *"error mounting image"* ]]; then
  echo "ERROR! Mounting is broken due to the invalid paring. Please re pair again! Removing /var/lib/lockdown/${DEVICE_UDID}.plist"
  # remove pairing file and exit with error code 1 to init reconnect
  rm -f /var/lib/lockdown/${DEVICE_UDID}.plist
  exit 1
else
  echo "Developer Image auto mount succeed."
  sleep 3
fi


# Chekc if WDA is already installed
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

