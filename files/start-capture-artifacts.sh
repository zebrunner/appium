#!/bin/bash

#export

# set -e The set -e option instructs bash to immediately exit if any command [1] has a non-zero exit status.
# option required to exit asap after kill of any screenrecord operation
set -e

sessionId=$1
if [ -z $sessionId ]; then
  echo "[warn] [CaptureArtifacts] No sense to record artifacts as sessionId not detected!"
  exit 0
fi

echo sessionId:$sessionId

# use sessionId value if non empty sessionId otherwise init as "video" string
videoFile=${sessionId}
echo "[info] [CaptureArtifacts] videoFile: $videoFile"

# send signal to start streaming of the screens from device
echo -n on | nc ${BROADCAST_HOST} ${BROADCAST_PORT} -w 0

echo "[info] [CaptureArtifacts] generating video file ${videoFile}.mp4..."
ffmpeg -v trace -i tcp://${BROADCAST_HOST}:${BROADCAST_PORT} -vf scale="-2:720" -vcodec libx264 -y ${FFMPEG_OPTS} /tmp/${sessionId}.mp4 > /dev/null 2>&1

exit 0
