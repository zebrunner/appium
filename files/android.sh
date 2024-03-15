#!/bin/bash

# print all settings 
adb shell getprop ro.build.characteristics

# device type
isTablet=`adb shell getprop ro.build.characteristics | grep tablet`
isTv=`adb shell getprop ro.build.characteristics | grep tv`
#157: Incorrect deviceType set for devices that do not return tv for ro.build.characteristics property
isDefault=`adb shell getprop ro.build.characteristics | grep default`
isPhone=`adb shell getprop ro.build.characteristics | grep phone`

# version
export PLATFORM_VERSION=`adb shell getprop | grep -m 1 ro.build.version.release |  sed 's/^.*:.*\[\(.*\)\].*$/\1/g'`

if [[ $isTablet ]]; then
  export DEVICETYPE='Tablet'
elif [[ $isTv ]]; then
  export DEVICETYPE='TV'
elif [[ $isDefault ]]; then
  if [[ $(adb shell getprop ro.hardware) = "redroid" ]]; then
    export DEVICETYPE='Phone'
  else
    export DEVICETYPE='TV'
  fi
elif [[ $isPhone ]]; then
  export DEVICETYPE='Phone'
else
  #TODO: how about echoing warn message here?
  export DEVICETYPE='Phone'
fi

if [[ ${PLATFORM_VERSION} == 4* ]] || [[ ${PLATFORM_VERSION} == 5* ]] || [[ ${PLATFORM_VERSION} == 6* ]]
then
  export AUTOMATION_NAME='Appium'
else
  export AUTOMATION_NAME='uiautomator2'
fi

# there is no sense to clean something for scalable one-time redroid container
if [ "$ANDROID_DEVICE" != "device:5555" ]; then
  #365: skip io.appium.* apps uninstall on restart
#  # uninstall appium specific applications
#  adb uninstall io.appium.uiautomator2.server.test
#  adb uninstall io.appium.uiautomator2.server
#  adb uninstall io.appium.settings
#  adb uninstall io.appium.unlock

  #127: android: clear /sdcard/*.mp4
  adb shell "rm -rf /sdcard/*.mp4"
fi
