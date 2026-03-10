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

# Forward adb port
# Used to connect appium builtin adb and mcloud-android-connector adb
socat TCP-LISTEN:5037,fork TCP:connector:5037 &

# Forward appium-uiautomator2 port
# Used to connect appium-uiautomator2-server and appium-uiautomator2-driver
# https://github.com/appium/appium-uiautomator2-server/wiki
while true; do
  #TODO: experiment later with default command again. Current implementation could keep port open and redirect when needed only
  socat TCP:localhost:${CHROMEDRIVER_PORT},retry,interval=1,forever TCP:connector:${CHROMEDRIVER_PORT},retry,interval=1,forever
  sleep 1
done &

# Forward devtools port
# Used to control mobile chrome browser
if [[ -n $CHROME_OPTIONS ]]; then
  socat TCP-LISTEN:${ANDROID_DEVTOOLS_PORT},fork TCP:connector:${ANDROID_DEVTOOLS_PORT} &
fi
