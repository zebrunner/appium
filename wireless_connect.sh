#!/bin/bash

# convert to lower case using Linux/Mac compatible syntax (bash v3.2)
PLATFORM_NAME=`echo "$PLATFORM_NAME" |  tr '[:upper:]' '[:lower:]'`
if [[ "$PLATFORM_NAME" == "ios" ]]; then
  # exit for iOS devices
  exit 0
fi

if [ ! -z "$ANDROID_DEVICES" ]; then
    connected_devices=$(adb devices)
    IFS=',' read -r -a array <<< "$ANDROID_DEVICES"
    for i in "${!array[@]}"
    do
        array_device=$(echo ${array[$i]} | tr -d " ")
        #string contains check
        if [[ ${connected_devices} != *${array_device}* ]]; then
            ret=1
            while [[ $ret -eq 1 ]]; do
                echo "Connecting to: ${array_device}"
                adb connect ${array_device}
		adb devices | grep ${array_device} | grep "device"
                ret=$?
                if [[ $ret -eq 1 ]]; then
                    sleep ${REMOTE_ADB_POLLING_SEC}
                fi
            done
            echo "Connected to: ${array_device}."
        fi
    done

    if [ "$ANDROID_DEVICES" == "device:5555" ]; then
	# Moved sleep after reconnection to root where the problem occurs much more often
	#sleep 5
	#adb devices

	# download and install chrome apk from https://www.apkmirror.com/apk/google-inc/chrome/chrome-99-0-4844-73-release/
	# version: x86 + x86_64 
	# url: https://www.apkmirror.com/apk/google-inc/chrome/chrome-99-0-4844-73-release/google-chrome-fast-secure-99-0-4844-73-10-android-apk-download/

	# /tmp/zebrunner/chrome/latest.apk is default shared location for chrome browser apk
	adb install /tmp/zebrunner/chrome/latest.apk

	# install appium apk
	adb install /usr/lib/node_modules/appium/node_modules/io.appium.settings/apks/settings_apk-debug.apk

        # switch to root account for running adb
        adb root

        sleep 5
        ret=1
        redroidDevice="device:5555"
        while [[ $ret -eq 1 ]]; do
            echo "Connecting as root to: ${redroidDevice}"
            adb connect ${redroidDevice}
            adb devices | grep ${redroidDevice} | grep "device"
            ret=$?
            if [[ $ret -eq 1 ]]; then
                sleep ${REMOTE_ADB_POLLING_SEC}
            fi
        done
        echo "Connected as root to: ${redroidDevice}."

        adb devices
    fi
fi



