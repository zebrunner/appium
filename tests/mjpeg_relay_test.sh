#!/bin/bash
# Tests of util/mjpeg-relay.js with a fake WDA (tests/fixtures/fake-mjpeg.js): the frames of a sparse MJPEG stream for
# ffmpeg - the repeated last frame, the new frames at once, the reconnect, the screenshot as the first frame and the
# exit with the reader.
source "$(dirname "$0")/lib.sh"
require_cmd node
cd "$REPO" || exit 1

FIXTURE=tests/fixtures/fake-mjpeg.js
SERVER_PID=""
RELAY_PID=""

# called by the EXIT trap of lib.sh
# shellcheck disable=SC2329
cleanup() {
  stop_process "$SERVER_PID"
  stop_process "$RELAY_PID"
}

# stop_process <pid>: stops a background process of the script, without the job message of bash
stop_process() {
  [[ -n "$1" ]] || return 0
  kill "$1" > /dev/null 2>&1
  wait "$1" 2> /dev/null
}

# start_server <mode> [screenshot file]: the fake WDA, its port in PORT
start_server() {
  stop_process "$SERVER_PID"
  : > "$WORK/server.out"
  node "$FIXTURE" server "$@" > "$WORK/server.out" 2>&1 &
  SERVER_PID=$!
  local tries=0
  until grep -q '^port ' "$WORK/server.out" || [[ "$tries" -ge 50 ]]; do
    sleep 0.1
    tries=$((tries + 1))
  done
  PORT="$(sed -n 's/^port //p' "$WORK/server.out")"
}

# relay <read ms> <env...>: the relay of the fake WDA read for the given time, the summary of the reader in SUMMARY,
# the log of the relay in RELAY_LOG and whether it exited within 2 s after the reader in RELAY_EXITED
relay() {
  local read_ms=$1
  rm -f "$WORK/pipe"
  mkfifo "$WORK/pipe"
  env "${@:2}" node files/util/mjpeg-relay.js "http://127.0.0.1:${PORT}/" "http://127.0.0.1:${PORT}/screenshot" \
    > "$WORK/pipe" 2> "$WORK/relay.log" &
  RELAY_PID=$!
  SUMMARY="$(node "$FIXTURE" read "$read_ms" < "$WORK/pipe")"
  local tries=0
  while kill -0 "$RELAY_PID" 2> /dev/null && [[ "$tries" -lt 20 ]]; do
    sleep 0.1
    tries=$((tries + 1))
  done
  if kill -0 "$RELAY_PID" 2> /dev/null; then
    RELAY_EXITED=no
  else
    RELAY_EXITED=yes
  fi
  stop_process "$RELAY_PID"
  RELAY_LOG="$(cat "$WORK/relay.log")"
}

# summary <field>: a field of the summary of the reader
summary() {
  node -e 'console.log(JSON.parse(process.argv[1])[process.argv[2]])' "$SUMMARY" "$1"
}

# in_range <value> <min> <max>: "yes" when min <= value <= max, the value otherwise
in_range() {
  if [[ "$1" -ge "$2" && "$1" -le "$3" ]]; then echo yes; else echo "$1"; fi
}

section "a static screen"
start_server static
relay 2000 MJPEG_RELAY_HEARTBEAT_MS=200
check "the frame of the stream is repeated after MJPEG_RELAY_HEARTBEAT_MS" "A" "$(summary labels)"
# ~10 frames in 2 s; a fast reader got the same frame again on every 'drain' before: thousands of them
check "the frame is repeated about every MJPEG_RELAY_HEARTBEAT_MS, not as fast as the reader reads" "yes" \
  "$(in_range "$(summary frames)" 6 14)"
check "the relay exits when its reader is gone" "yes" "$RELAY_EXITED"
check_contains "the connection is logged in the format of the logger" "] [INFO] [MjpegRelay] Connected to http://127.0.0.1:${PORT}/: 200" "$RELAY_LOG"

section "a changing screen"
start_server changing
relay 2000 MJPEG_RELAY_HEARTBEAT_MS=500
check "every new frame is passed in the order of the stream" "B01 B02 B03 B04 B05 B06 B07 B08 B09 B10" "$(summary labels)"

section "the end of the stream"
start_server drop
relay 2500 MJPEG_RELAY_HEARTBEAT_MS=200
check "the last frame is repeated while reconnecting, then the frames of the new connection" "C1 C2" "$(summary labels)"
check_contains "the reconnect is logged" "The stream ended" "$RELAY_LOG"

section "no frame of the stream"
start_server none
relay 1500 MJPEG_RELAY_HEARTBEAT_MS=200 MJPEG_RELAY_FIRST_FRAME_MS=300
check "the first frame is the screenshot after MJPEG_RELAY_FIRST_FRAME_MS" "S1" "$(summary labels)"
check_contains "the screenshot as the first frame is logged" "the first frame is the screenshot" "$RELAY_LOG"

if command -v ffmpeg > /dev/null; then
  ffmpeg -loglevel error -f lavfi -i testsrc=size=64x128 -frames:v 1 -y "$WORK/screenshot.png"
  start_server none "$WORK/screenshot.png"
  relay 2500 MJPEG_RELAY_HEARTBEAT_MS=200 MJPEG_RELAY_FIRST_FRAME_MS=300
  check "a PNG screenshot of WDA is converted to a JPEG frame" "true|yes" \
    "$(summary jpeg)|$(in_range "$(summary frames)" 1 100)"
else
  skip_check "a PNG screenshot of WDA is converted to a JPEG frame" "no ffmpeg"
fi

start_server broken
relay 1500 MJPEG_RELAY_FIRST_FRAME_MS=300
check "no frame without an image of the screenshot" "0" "$(summary frames)"
check_contains "the unusable screenshot is logged" "is not the first frame" "$RELAY_LOG"
# nothing to write, so the gone reader is not seen: the end of the recording stops it (stopRelay of recording.sh)
check "the relay keeps running without a frame to write" "no" "$RELAY_EXITED"

finish
