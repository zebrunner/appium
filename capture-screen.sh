#!/bin/bash

set -e

sessionId=$1
echo sessionId: $sessionId

startScreenStream() {
  declare -i file=0
  while true; do
     echo "================================================================================================================="
     echo "generating video file #${file}..."
     echo "================================================================================================================="
     adb shell "su root screenrecord --verbose ${SCREENRECORD_OPTS} ${sessionId}_${file}.mp4";
     file+=1
  done
}

echo "Starting screen capturing for sessionId: $sessionId..."
startScreenStream
