#!/bin/bash

#TODO: investigate an option to organized effective but not time realistic screen capturing.
# Also it might be usde as vnc service to share data at run-time

set -e

# Usage:
# bash ./capture-screen.sh

SCREENRECORD_FLAGS="$@"

screenStream() {
  while true; do
#    adb exec-out screenrecord --output-format=h264 --size 1024x768 $SCREENRECORD_FLAGS -
    echo "screenrecord args: --output-format=h264 $SCREENRECORD_FLAGS"
    adb exec-out screenrecord --output-format=h264 $SCREENRECORD_FLAGS -
  done
}

# remove any existing video.mp4
rm -f video.mp4
echo "Starting video recording..."
#TODO: test if we need kill for existing screenrecord as seems like w just capture screen remotely without operating on device/emulator anymore!

#forcibly kill any existing screenrecord process to avoid recording of previous sessions
#adb shell "su root pkill -f screenrecord" &

#screenStream | ffmpeg -i - -s 1024x768 -framerate 30 -bufsize 16M video.mp4
screenStream | ffmpeg -i - -framerate 30 -bufsize 16M video.mp4
