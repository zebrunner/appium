#!/bin/bash

#TODO: investigate if we can just source from device info env file and completely move adb command outside to stf

# device type
isTablet=`adb shell getprop ro.build.characteristics | grep tablet`
isTv=`adb shell getprop ro.build.characteristics | grep tv`

# version
PLATFORM_VERSION=`adb shell getprop | grep -m 1 ro.build.version.release |  sed 's/^.*:.*\[\(.*\)\].*$/\1/g'`

if [[ $isTablet ]]
then
  export DEVICETYPE='Tablet'
elif [[ $isTv ]]
then
  export DEVICETYPE='TV'
else
  export DEVICETYPE='Phone'
fi

if [[ ${PLATFORM_VERSION} == 4* ]] || [[ ${PLATFORM_VERSION} == 5* ]] || [[ ${PLATFORM_VERSION} == 6* ]]
then
  export AUTOMATION_NAME='Appium'
else
  export AUTOMATION_NAME='uiautomator2'
fi
