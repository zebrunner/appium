#!/bin/bash
APPIUM_LOG="${APPIUM_LOG:-/var/log/appium.log}"

sessionId=$1

if [ ! -z $sessionId ]; then
  # save existing appium log file by as sessionId.log
  cp "${APPIUM_LOG}" "$sessionId.log"
fi

# do not kill start-capture-artifacts.sh parent process!
#pkill -e -f /opt/start-capture-artifacts.sh
pkill -e -f screenrecord

exit 0

#kill screenrecord on emulator/device
#adb shell "pkill -l 2 -f screenrecord"
# sleep was required to finish kill process correctly so video file is closed and editable/visible later.
# as of now `sleep 1` moved onto the entry_point.sh to be controlled on high level, also testing sleep 0.5
#sleep 1

#kill start-capture-artifacts.sh parent shell script
#pkill -f start-capture-artifacts.sh
