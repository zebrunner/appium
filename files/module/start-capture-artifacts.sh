#!/bin/bash

# shellcheck source=../util/logger.sh
. /opt/logger.sh
# shellcheck source=recording.sh
. /opt/recording.sh
sessionId=$1
if [[ -z "$sessionId" ]]; then
  logger "WARN" "[CaptureArtifacts] No sense to record artifacts as sessionId not detected!"
  exit 0
fi

logger "INFO" "[CaptureArtifacts] sessionId: $sessionId"

PLATFORM_NAME=$(echo "${PLATFORM_NAME}" | tr '[:upper:]' '[:lower:]')

# iOS reads the WDA MJPEG server directly; STF's screen broadcast deletes the WDA session on ws close, starving ffmpeg.
# WDA sends a frame only when the screen changes, so its frames go through mjpeg-relay.js that repeats the last one:
# ffmpeg finishes the video on SIGINT without waiting for a new frame of the device.
if [[ "${PLATFORM_NAME}" == "ios" ]]; then
  ffmpegInput="pipe:0"
  videoSource="http://${WDA_HOST}:${MJPEG_PORT}"
else
  # 'on' and the start of ffmpeg under the lock: the end of a previous recording then sees this one and keeps the
  # broadcast 'on' (recording.sh)
  broadcastLock
  logger "INFO" "[CaptureArtifacts] trying to send 'on': nc ${BROADCAST_HOST} ${BROADCAST_PORT}"
  echo -n "on" | nc "${BROADCAST_HOST}" "${BROADCAST_PORT}" -q 0 -v
  ffmpegInput="tcp://${BROADCAST_HOST}:${BROADCAST_PORT}"
  videoSource="$ffmpegInput"
fi

# the time stamp of the frames (recording-card.sh)
videoFilter="setpts=RTCTIME/1000000/TB,scale=-2:720"
if [[ "${RECORDING_TIMESTAMP}" == "true" ]]; then
  videoFilter+=",$(timestampFilter "$sessionId")"
fi

# you can add `-v trace` to enable verbose mode logs
# -probesize 32 -analyzeduration 0 - encode from the first frame instead of probing 5 s of the stream: a short session
#   ended during the probe had no video
# -use_wallclock_as_timestamps 1 - use system time for timestamps in stream, improve VFR (Variable Frame Rate) accuracy.
ffmpegArgs=(
  -hide_banner
  -loglevel info
  -nostats
  -f mjpeg
  -probesize 32
  -analyzeduration 0
  -fpsprobesize 0
  -use_wallclock_as_timestamps 1
  -fflags +genpts
  -i "$ffmpegInput"
  -vf "$videoFilter"
  -c:v libx264
  -preset:v ultrafast
  -crf 35
  -movflags +empty_moov+frag_keyframe
)

logger "INFO" "[CaptureArtifacts] generating video file ${sessionId}.mp4 from ${videoSource}..."
logger "INFO" "[CaptureArtifacts] video filter: ${videoFilter}"
# $! is the pid of ffmpeg in both cases, the last command of the pipeline
if [[ "${PLATFORM_NAME}" == "ios" ]]; then
  # FFMPEG_OPTS holds several options, it is split on purpose
  # shellcheck disable=SC2086
  node /opt/mjpeg-relay.js "$videoSource" "http://${WDA_HOST}:${WDA_PORT}/screenshot" "$sessionId" |
    ffmpeg "${ffmpegArgs[@]}" ${FFMPEG_OPTS} -y /tmp/"${sessionId}".mp4 &
else
  # FFMPEG_OPTS holds several options, it is split on purpose
  # shellcheck disable=SC2086
  ffmpeg "${ffmpegArgs[@]}" ${FFMPEG_OPTS} -y /tmp/"${sessionId}".mp4 &
fi
ffmpegPid=$!

if [[ "${PLATFORM_NAME}" != "ios" ]]; then
  # until the forked process is ffmpeg (or 2 s): its command line is the one of this script before
  tries=0
  while ! broadcastRecorders | grep -qx "$ffmpegPid" && [[ "$tries" -lt 20 ]]; do
    sleep 0.1
    tries=$((tries + 1))
  done
  broadcastUnlock
fi

# the details of the session for the card before its video (recording-card.sh)
if [[ "${RECORDING_CARD}" == "true" ]]; then
  collectSessionInfo "$sessionId" &
fi

exit 0
