#!/bin/bash

# convert to lower case using Linux/Mac compatible syntax (bash v3.2)
PLATFORM_NAME=`echo "$PLATFORM_NAME" |  tr '[:upper:]' '[:lower:]'`
if [[ "$PLATFORM_NAME" == "ios" ]]; then
  if [[ -z $USBMUXD_SOCKET_ADDRESS ]]; then
    echo "start containerized usbmuxd service/process"
    usbmuxd -f &
    sleep 2
    # socat server to share usbmuxd socket via TCP to STF (mcloud-device)
    socat TCP-LISTEN:22,reuseaddr,fork UNIX-CONNECT:/var/run/usbmuxd &
  else
    # rm /var/run/usbmuxd in advance to be able to start socat and join it to $USBMUXD_SOCKET_ADDRESS
    rm -f /var/run/usbmuxd
    socat UNIX-LISTEN:/var/run/usbmuxd,fork,reuseaddr,mode=777 TCP:$USBMUXD_SOCKET_ADDRESS &
  fi

  declare -i index=0
  available=0
  # as default ADB_POLLING_SEC is 5s then we wait for authorizing ~50 sec only
  while [[ $available -eq 0 ]] && [[ $index -lt 10 ]]
  do
    #87 ios: define exit strategy from container on exit
    available=`ios list | grep -c $DEVICE_UDID`
    if [[ $available -eq 1 ]]; then
      break
    fi
    sleep ${ADB_POLLING_SEC}
    index+=1
  done

  if [[ $available -eq 1 ]]; then
    echo "Device is fully available."
  else
    echo "Device is not available!"
    exit 1
  fi

  # exit 0 means all good
  exit 0
fi

# start adb allowing remote access by "-a" arg

# https://github.com/sorccu/docker-adb
# 2016-07-02 Due to internal ADB changes our previous start command no longer works in the latest version.
# The command has been updated, but if you were specifying it yourself, make sure you're using adb -a -P 5037 server nodaemon.
# Do NOT use the fork-server argument anymore.
# make sure to use hardcoded 5037 as ADB_PORT only for sharing outside!
adb -a -P 5037 server nodaemon &
sleep 1

# ADB connect (via wireless network or via tcp for redroid emulator)
if [ ! -z "$ANDROID_DEVICE" ]; then
  isConnected=0
  declare -i index=0
  while [[ $index -lt 10 ]]; do
    echo "Connecting to: ${ANDROID_DEVICE}"
    adb connect ${ANDROID_DEVICE}
    adb devices | grep ${ANDROID_DEVICE} | grep "device"
    if [[ $? -eq 0 ]]; then
      isConnected=1
      echo "Connected: ${ANDROID_DEVICE}"
      break
    fi

    sleep ${ADB_POLLING_SEC}
    index+=1
  done

  if [[ $isConnected -eq 0 ]]; then
    echo "Device ${ANDROID_DEVICE} is not connected!"
    exit 1
  fi
fi

isAvailable=0
declare -i index=0
# as default ADB_POLLING_SEC is 5s then we wait for authorizing ~50 sec only
while [[ $index -lt 10 ]]
do
  # Possible adb statuses - https://android.googlesource.com/platform/packages/modules/adb/+/refs/heads/main/adb.cpp#118
  # Possible adb statuses2 - https://android.googlesource.com/platform/packages/modules/adb/+/refs/heads/main/proto/devices.proto#25
  # UsbNoPermissionsShortHelpText https://android.googlesource.com/platform/system/core/+/refs/heads/main/diagnose_usb/diagnose_usb.cpp#83
  state=$(adb get-state 2>&1)
  echo state: $state
  echo

  # exit with code 1 make container quit without restarting
  # exit with code 2 init device reconnect using usbreset

  #TODO: let's test release completely without usbreset binary usage
  case $state in
    "device")
      echo "Device connected successfully."
      isAvailable=1
      break
    ;;
    *"authorizing"* | *"connecting"* | *"unknown"* | *"bootloader"*)
      # do not break to repeit verificatin until device in temporary state
      echo "Waiting for valid device state..."
    ;;
    *"unauthorized"*)
      echo "Authorize device manually!"
      exit 1
    ;;
    *"offline"*)
      echo "Device is offline, performing adb reconnect."
      adb reconnect
    ;;
    *"no devices/emulators found"*)
      echo "Device not found, performing usb port reset."
      exit 2
    ;;
    *)
      # it should cover such state as: host, recovery, rescue, sideload, no permissions
      echo "Troubleshoot device manually to define the best strategy."
      exit 1
    ;;
  esac

  echo "sleeping ${ADB_POLLING_SEC} seonds..."
  sleep ${ADB_POLLING_SEC}
  index+=1
done


if [[ $isAvailable -eq 0 ]]; then
  # device is in the state we can't fix so exit without restart
  exit 1
fi


declare -i index=0
info=""
# to support device reboot as device is available by adb but not functioning correctly.
# this extra dumpsys display call guarantees that android is fully booted (wait up to 5min)
while [[ "$info" == "" ]] && [[ $index -lt 60 ]]
do
  info=`adb shell dumpsys display | grep -A 20 DisplayDeviceInfo`
  echo "sleeping ${ADB_POLLING_SEC} seonds..."
  sleep ${ADB_POLLING_SEC}
  index+=1
done


if [[ "$info" == "" ]]; then
  echo "Device dumpsys display is not available yet. Potentially device is not fully booted yet!"
  exit 1
else
  echo "info: $info"
fi

# add extra steps for Zebrunner Redroid Emulator
if [ "$ANDROID_DEVICE" == "device:5555" ]; then
  # Moved sleep after reconnection to root where the problem occurs much more often
  #sleep 5
  #adb devices

  # install appium apk
  if [ -f /usr/lib/node_modules/appium/node_modules/appium-uiautomator2-driver/node_modules/io.appium.settings/apks/settings_apk-debug.apk ]; then
    adb install /usr/lib/node_modules/appium/node_modules/appium-uiautomator2-driver/node_modules/io.appium.settings/apks/settings_apk-debug.apk
  fi

  # download and install chrome apk from https://www.apkmirror.com/apk/google-inc/chrome/chrome-99-0-4844-73-release/
  # version: x86 + x86_64
  # url: https://www.apkmirror.com/apk/google-inc/chrome/chrome-99-0-4844-73-release/google-chrome-fast-secure-99-0-4844-73-10-android-apk-download/
  # /tmp/zebrunner/chrome/latest.apk is default shared location for chrome browser apk
  if [ -f /tmp/zebrunner/chrome/latest.apk ]; then
    adb install /tmp/zebrunner/chrome/latest.apk
  fi
fi

echo "Device is fully available."
