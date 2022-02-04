#!/bin/bash

export

# set -e The set -e option instructs bash to immediately exit if any command [1] has a non-zero exit status.
# option required to exit asap after kill of any screenrecord operation
set -e

if [ -z $BUCKET ]; then
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


captureAndroidArtifacts() {
  declare -i part=0
  while true; do
     #TODO: #9 integrate audio capturing for android devices
     echo "[info] [CaptureArtifacts] generating video file ${videoFile}_${part}.mp4..."
     adb shell "screenrecord --verbose ${SCREENRECORD_OPTS} /sdcard/${videoFile}_${part}.mp4"
     part+=1
  done
}

captureIOSArtifacts() {
  # example of the video recording command is below where ip is iPhone address and 20022 is MJPEG port started by WDA
  # ffmpeg -f mjpeg -r 10 -i http://169.254.231.124:20022 -vf scale="-2:720" -vcodec libx264 -y video.mp4
  if [ -z ${WDA_HOST} ] || [ -z ${MJPEG_PORT} ]; then
    . ${WDA_ENV}
  fi
  echo "[info] [CaptureArtifacts] generating video file ${videoFile}.mp4..."
  ffmpeg -f mjpeg -r 10 -i http://${WDA_HOST}:${MJPEG_PORT} -vf scale="-2:720" -vcodec libx264 -y ${FFMPEG_OPTS} ${sessionId}.mp4 > /dev/null 2>&1
}

# convert to lower case using Linux/Mac compatible syntax (bash v3.2)
PLATFORM_NAME=`echo "$PLATFORM_NAME" |  tr '[:upper:]' '[:lower:]'`
if [[ "${PLATFORM_NAME}" == "android" ]]; then
  captureAndroidArtifacts
fi

if [[ "${PLATFORM_NAME}" == "ios" ]]; then
  captureIOSArtifacts
fi

exit 0
