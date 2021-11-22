#!/bin/bash

pkill -f screenrecord

#kill screenrecord on emulator/device
#adb shell "pkill -l 2 -f screenrecord"
# sleep was required to finish kill process correctly so video file is closed and editable/visible later.
# as of now `sleep 1` moved onto the entry_point.sh to be controlled on high level, also testing sleep 0.5
#sleep 1

#kill capture-artifacts.sh parent shell script
#pkill -f capture-artifacts.sh
