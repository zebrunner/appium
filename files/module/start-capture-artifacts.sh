#!/bin/bash

sessionId=$1
if [[ -z "$sessionId" ]]; then
  echo "[warn] [CaptureArtifacts] No sense to record artifacts as sessionId not detected!"
  exit 0
fi

echo "[info] [CaptureArtifacts] sessionId: $sessionId"

PLATFORM_NAME=$(echo "${PLATFORM_NAME}" | tr '[:upper:]' '[:lower:]')

# iOS reads the WDA MJPEG server directly; STF's screen broadcast deletes the WDA session on ws close, starving ffmpeg.
if [[ "${PLATFORM_NAME}" == "ios" ]]; then
  ffmpegInput="http://${WDA_HOST}:${MJPEG_PORT}"
else
  echo "[info] [CaptureArtifacts] trying to send 'on': nc ${BROADCAST_HOST} ${BROADCAST_PORT}"
  echo -n "on" | nc "${BROADCAST_HOST}" "${BROADCAST_PORT}" -q 0 -v
  ffmpegInput="tcp://${BROADCAST_HOST}:${BROADCAST_PORT}"
fi

echo "[info] [CaptureArtifacts] generating video file ${sessionId}.mp4 from ${ffmpegInput}..."
# you can add `-v trace` to enable verbose mode logs
# -use_wallclock_as_timestamps 1 - use system time for timestamps in stream, improve VFR (Variable Frame Rate) accuracy.
# FFMPEG_OPTS holds several options, it is split on purpose
# shellcheck disable=SC2086
ffmpeg \
  -hide_banner \
  -loglevel info \
  -nostats \
  -f mjpeg \
  -use_wallclock_as_timestamps 1 \
  -fflags +genpts \
  -i "${ffmpegInput}" \
  -vf "setpts=RTCTIME/1000000/TB,scale=-2:720" \
  -c:v libx264 \
  -preset:v ultrafast \
  -crf 35 \
  -movflags +empty_moov+frag_keyframe \
  ${FFMPEG_OPTS} \
  -y /tmp/"${sessionId}".mp4 &

exit 0
