#!/bin/bash

#export

sessionId=$1
if [ -z $sessionId ]; then
  echo "[warn] [CaptureArtifacts] No sense to record artifacts as sessionId not detected!"
  exit 0
fi

echo sessionId:$sessionId

echo "[info] [CaptureArtifacts] videoFile: ${sessionId}.mp4"

# send signal to start streaming of the screens from device
echo -n on | nc ${BROADCAST_HOST} ${BROADCAST_PORT} -w 0

echo "[info] [CaptureArtifacts] generating video file ${sessionId}.mp4..."
ffmpeg -v trace -f mjpeg -r 10 -i tcp://${BROADCAST_HOST}:${BROADCAST_PORT} -vf scale="-2:720" -vcodec libx264 -y ${FFMPEG_OPTS} /tmp/${sessionId}.mp4 &

exit 0
