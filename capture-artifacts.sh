#!/bin/bash

#set -e The set -e option instructs bash to immediately exit if any command [1] has a non-zero exit status.
set -e

if [ -z $BUCKET ] || [ -z $TENANT ]; then
  echo "[warn] [CaptureArtifacts] No sense to record video without S3 compatible storage!"
  exit 0
fi

sessionId=$1
if [ -z $sessionId ]; then
  echo "[warn] [CaptureArtifacts] No sense to record video as sessionId not detected!"
  exit 0
fi

# use sessionId value if non empty sessionId otherwise init as "video" string
videoFile=${sessionId}
echo "[info] [CaptureArtifacts] videoFile: $videoFile"

startScreenStream() {
  declare -i part=0
  while true; do
     #TODO: #9 integrate audio capturing for android devices
     echo "[info] [CaptureArtifacts] generating video file ${videoFile}_${part}.mp4..."
     adb shell "su root screenrecord --verbose ${SCREENRECORD_OPTS} ${videoFile}_${part}.mp4"
     part+=1
  done
}

startScreenStream
