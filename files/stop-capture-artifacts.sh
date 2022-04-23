#!/bin/bash
APPIUM_LOG="${APPIUM_LOG:-/var/log/appium.log}"

sessionId=$1

if [ ! -z $sessionId ]; then
  # save existing appium log file by as sessionId.log
  cp "${APPIUM_LOG}" "$sessionId.log"
fi


# convert to lower case using Linux/Mac compatible syntax (bash v3.2)
PLATFORM_NAME=`echo "$PLATFORM_NAME" |  tr '[:upper:]' '[:lower:]'`
if [[ "${PLATFORM_NAME}" == "android" ]]; then
  # do not kill start-capture-artifacts.sh parent process!
  #pkill -e -f /opt/start-capture-artifacts.sh
  pkill -e -f screenrecord
fi

#TODO: don't do kill (ffmpeg) if sessionId is not detected
if [[ "${PLATFORM_NAME}" == "ios" ]]; then
  pkill -f $sessionId
fi


exit 0

