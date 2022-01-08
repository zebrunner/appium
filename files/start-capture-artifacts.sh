#!/bin/bash

# set -e The set -e option instructs bash to immediately exit if any command [1] has a non-zero exit status.
# option required to exit asap after kill of any screenrecord operation
set -e

if [ -z $BUCKET ] || [ -z $TENANT ]; then
  echo "[warn] [CaptureArtifacts] No sense to record artifacts without S3 compatible storage!"
  exit 0
fi

sessionId=$1
if [ -z $sessionId ]; then
  echo "[warn] [CaptureArtifacts] No sense to record artifacts as sessionId not detected!"
  exit 0
fi

echo sessionId:$sessionId

# use sessionId value if non empty sessionId otherwise init as "video" string
videoFile=${sessionId}
echo "[info] [CaptureArtifacts] videoFile: $videoFile"


# 17: implement capture artifacts on iOS/AppleTV devices
# example of the video recording command is below where ip is iPhone address and 20022 is MJPEG port started by WDA
# ffmpeg -f mjpeg -r 10 -i http://169.254.231.124:20022 -vf scale="-2:720" -vcodec libx264 -y video.mp4

startArtifactsStream() {
  declare -i part=0
  while true; do
     #TODO: #9 integrate audio capturing for android devices
     echo "[info] [CaptureArtifacts] generating video file ${videoFile}_${part}.mp4..."
     adb shell "screenrecord --verbose ${SCREENRECORD_OPTS} /sdcard/${videoFile}_${part}.mp4"
     part+=1
  done
}

startArtifactsStream

exit 0
