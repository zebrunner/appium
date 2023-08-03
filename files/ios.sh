#!/bin/bash


function pairDevice() {

  # pair device based on parameters:
  #  supervised: true/false Boolean
  #  p12file: path String
  #  p12passwword: password String

  # Analyze pair response to raise exception, wait or proceed with services startup

  # Example of the invalid supervised device pairing
  #  curl -X POST -H "Supervision-Password: mypassword" -F p12file=@/opt/zebrunner/mcloud.p12  http://localhost:8080/api/v1/device/d6afc6b3a65584ca0813eb8957c6479b9b6ebb11/pair?supervised=true
  #  {"error":"received wrong error message 'UserDeniedPairing' error message should have been 'McChallengeRequired' : map[Error:UserDeniedPairing Request:Pair]"}

  # Example of the valid supervised device pairing

  # Example of the invalid non-supervised pairing (requies manual Trust dialog confirmation)
  #  curl -s -X POST http://localhost:8080/api/v1/device/d6afc6b3a65584ca0813eb8957c6479b9b6ebb11/pair?supervised=false'
  #  {"error":"Please accept the PairingDialog on the device and run pairing again!"}

  # Example of the invalid non-supervised pairing (already paired)
  #  curl -X POST http://localhost:8080/api/v1/device/d6afc6b3a65584ca0813eb8957c6479b9b6ebb11/pair?supervised=false
  #  {"error":"Lockdown error: UserDeniedPairing"}

  # Example of the valid non supervised device pairing
  #   curl -s -X POST http://localhost:8080/api/v1/device/d6afc6b3a65584ca0813eb8957c6479b9b6ebb11/pair?supervised=false
  #   {"message":"Device paired"}

  if [ "$SUPERVISED" == "false" ]; then
    while true; do
      echo "Executing pair request 'curl -s -X POST http://localhost:8080/api/v1/device/$DEVICE_UDID/pair?supervised=false'"
      local res=`curl -s -X POST http://localhost:8080/api/v1/device/$DEVICE_UDID/pair?supervised=false`
      #TODO: comment/remove echo res
      echo res: $res

      local error=`echo $res | jq -r '.error'`
      local message=`echo $res | jq -r '.message'`

      if [[ ! -z ${message} ]] && [[ "${message}" == "Device paired" ]]; then
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

  fi


#ENV SUPERVISED=false
#ENV P12FILE=/opt/zebrunner/mcloud.p12
#ENV P12PASSWORD=

}


# socat server to share usbmuxd socket via TCP
socat TCP-LISTEN:22,reuseaddr,fork UNIX-CONNECT:/var/run/usbmuxd &

ios list | grep $DEVICE_UDID
if [ $? == 1 ]; then
  echo "WARN! Unable to detect iOS device with udid: $DEVICE_UDID."
  export DEVICE_UDID=${DEVICE_UDID/-/}
fi

echo DEVICE_UDID: $DEVICE_UDID

# pair iOS device if neccessary
# if /valid/lockdown/uuid.plist
if [ ! -f /var/lib/lockdown/${DEVICE_UDID}.plist ]; then
  # start go-ios api
  go-ios &
  sleep 3

  echo "Device $DEVICE_UDID is not paired yet!"
  pairDevice
else
  echo "Device $DEVICE_UDID is already paired."
  # IMPORTANT! make sure not to execute pair again otherwise it regenerate host certificate/id and trust dialog appear!!!
fi

#echo "[$(date +'%d/%m/%Y %H:%M:%S')] Pair device $DEVICE_UDID"
#if [ -f ${P12FILE} ] && [ ! -z ${P12PASSWORD} ]; then
#  # #280 pair supervised iOS device
#  ios pair --p12file="${P12FILE}" --password="${P12PASSWORD}" --udid=$DEVICE_UDID
#else
#  # #256 pair iOS device in regular way
#  ios pair --udid=$DEVICE_UDID
#fi

#if [ $? == 1 ]; then
#  echo "ERROR! Unable to pair iOS device!"
#  # Below exit completely destroy stf container as there is no sense to continue with unpaired device
#  exit -1
#fi

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
ios image auto --basedir /tmp/DeveloperDiskImages --udid=$DEVICE_UDID

#TODO: let's rview how it is going with fully manual WDA ipa install step
#echo "[$(date +'%d/%m/%Y %H:%M:%S')] Installing WDA application on device"
#ios install --path=/opt/WebDriverAgent.ipa --udid=$DEVICE_UDID
#if [ $? == 1 ]; then
#  echo "ERROR! Unable to install WebDriverAgent.ipa!"
#  # return exit 0 to stop automatic restart of the appium container
#  exit 0
#fi

# install and launch WDA on device
. /opt/start-wda.sh
# start wda listener with ability to restart wda
/opt/check-wda.sh &

export AUTOMATION_NAME='XCUITest'

