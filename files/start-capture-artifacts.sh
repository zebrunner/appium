#!/bin/bash

sessionId=$1
if [ -z $sessionId ]; then
  echo "[warn] [CaptureArtifacts] No sense to record artifacts as sessionId not detected!"
  exit 0
fi

echo "[info] [CaptureArtifacts] sessionId: $sessionId"

# send signal to start streaming of the screens from device
echo "[info] [CaptureArtifacts] trying to send 'on': nc ${BROADCAST_HOST} ${BROADCAST_PORT}"
echo -n "on" | nc ${BROADCAST_HOST} ${BROADCAST_PORT} -w 0 -v

echo "[info] [CaptureArtifacts] generating video file ${sessionId}.mp4..."
# you can add `-v trace` to enable verbose mode logs
# -use_wallclock_as_timestamps 1 - use system time for timestamps in stream, improve VFR (Variable Frame Rate) accuracy.
ffmpeg -f mjpeg -use_wallclock_as_timestamps 1 -i tcp://${BROADCAST_HOST}:${BROADCAST_PORT} \
  -vf scale="-2:720" -r 10 -vcodec libx264 -crf 35 -movflags +frag_keyframe+separate_moof+omit_tfhd_offset+empty_moov \
  ${FFMPEG_OPTS} -preset:v ultrafast -y /tmp/${sessionId}.mp4 &

exit 0
