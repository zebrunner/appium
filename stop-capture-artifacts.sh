#!/bin/bash

#kill screenrecord on emulator/device
adb shell "su root pkill -l 2 -f screenrecord"
# sleep was required to finish kill process correctly so video file is closed and editable/visible later.
# as of now `sleep 1` moved onto the concat-artifacts.sh
#sleep 1

#kill capture-artifacts.sh parent shell script
pkill -f capture-artifacts.sh
