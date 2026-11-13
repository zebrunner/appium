#!/bin/bash
# End-to-end checks of the device containers with the settings of zebrunner/mcloud-agent and a fake device side
# (tests/fixtures/fake-device.js as the `connector` and `device` hosts): startup, healthcheck, device status
# and the video recording of sessions driven by the .recording-artifact-<id> markers, including docker stop.
source "$(dirname "$0")/lib.sh"
source "$(dirname "$0")/docker_lib.sh"
require_cmd python3
cd "$REPO" || exit 1

ensure_image

NET="zbr-appium-e2e-$$"
FAKE="${NET}-fake"

# called by the EXIT trap of lib.sh
# shellcheck disable=SC2329
cleanup() {
  docker ps --all --quiet --filter "name=${NET}" | xargs docker rm -f > /dev/null 2>&1 || true
  docker network rm "$NET" > /dev/null 2>&1 || true
}

# the env vars of the appium containers in zebrunner/mcloud-agent (roles/common/files/zebrunner-farm)
COMMON_ENV=(
  TASK_LOG=/tmp/log/appium.log RETAIN_TASK=true CONNECT_TO_GRID=true CUSTOM_NODE_CONFIG=true
  STF_PROVIDER_HOST=10.0.0.5 SELENIUM_HOST=hub SELENIUM_PORT=4444 DEFAULT_CAPABILITIES=true
  ADB_PORT=5037 APPIUM_PORT=4723 RELAXED_SECURITY=true
)
IOS_ENV=("${COMMON_ENV[@]}" PLATFORM_NAME=ios WDA_HOST=connector APPIUM_CLI=--session-override
  DEVICE_NAME=iPhone DEVICE_UDID=00008110-000A)
ANDROID_ENV=("${COMMON_ENV[@]}" PLATFORM_NAME=android DEVICE_NAME=Pixel DEVICE_UDID=udid-1
  ADB_SERVER_SOCKET=tcp:connector:5037 REMOTE_ADB_HOST=connector)

# start_device <container> <user, empty for the image user> <env vars...>
start_device() {
  local env_args=()
  local var
  for var in "${@:3}"; do
    env_args+=(--env "$var")
  done
  docker run --detach --name "$1" --platform "$PLATFORM" --network "$NET" ${2:+--user "$2"} "${env_args[@]}" "$IMAGE" > /dev/null
}

# called through wait_for
# shellcheck disable=SC2329
healthy() {
  [[ "$(docker inspect "$1" --format '{{.State.Health.Status}}' 2> /dev/null)" == "healthy" ]]
}

state_and_logs() {
  printf 'state: %s\nerrors:\n%s\nlast lines:\n%s' "$(docker inspect "$1" --format '{{.State.Status}} exit={{.State.ExitCode}}')" \
    "$(docker logs "$1" 2>&1 | grep -E 'socat\[[0-9]+\] E|Fatal Error|error:|Exit status' | head -10)" "$(docker logs "$1" 2>&1 | tail -8)"
}

# check_starts <container>: Appium is up and the container keeps running
check_starts() {
  if wait_for 180 appium_up "$1" && sleep 15 && container_running "$1" && appium_up "$1"; then
    pass "Appium starts and the container keeps running"
    return 0
  fi
  fail "Appium starts and the container keeps running" "the container is not running" "$(state_and_logs "$1")"
  return 1
}

# session <container> <id> <seconds>: a session of the patched driver, its marker exists for the given time
session() {
  docker exec "$1" touch "/tmp/log/.recording-artifact-$2"
  sleep "$3"
  docker exec "$1" rm -f "/tmp/log/.recording-artifact-$2"
}

# shellcheck disable=SC2329
shared() {
  docker exec "$1" test -f "/tmp/log/.artifact-$2"
}

# check_shared <container> <id> <description>: the artifacts of the session are shared for the uploader
check_shared() {
  if ! wait_for 60 shared "$1" "$2"; then
    fail "$3: the artifacts are shared" "no /tmp/log/.artifact-$2" \
      "$(
        docker exec "$1" ls -la /tmp/log /tmp 2>&1
        docker logs "$1" 2>&1 | grep -E 'Share|Stop Video|CaptureArtifacts' | tail -20
      )"
    return
  fi
  pass "$3: the artifacts are shared"
  check "$3: the session log is shared" "yes" \
    "$(docker exec "$1" bash -c "test -s /tmp/log/$2/session.log && echo yes || echo no")"
  local duration
  duration="$(docker exec "$1" ffprobe -v error -show_entries format=duration -of csv=p=0 "/tmp/log/$2/video.mp4" 2>&1)"
  if python3 -c "import sys; sys.exit(0 if float(sys.argv[1]) >= 2 else 1)" "$duration" 2> /dev/null; then
    pass "$3: the video is recorded"
  else
    fail "$3: the video is recorded" "video duration: ${duration}" "$(docker exec "$1" ls -la "/tmp/log/$2" 2>&1)"
  fi
}

# video_duration <container> <id>: the duration of the shared video of the session, s
video_duration() {
  docker exec "$1" ffprobe -v error -show_entries format=duration -of csv=p=0 "/tmp/log/$2/video.mp4" 2>&1
}

# at_least <value> <min>: whether the number is at least the minimum
at_least() {
  python3 -c "import sys; sys.exit(0 if float(sys.argv[1]) >= float(sys.argv[2]) else 1)" "$1" "$2" 2> /dev/null
}

# frame_luma <container> <id> <seconds>: the mean luma (0-255) of the frame of the shared video at the time
frame_luma() {
  docker exec "$1" bash -c "ffmpeg -nostdin -loglevel error -ss $3 -i /tmp/log/$2/video.mp4 -frames:v 1 -vf scale=1:1,format=gray -f rawvideo - | od -An -tu1 | tr -d ' \n'"
}

# check_shared_on_stop <container> <id>: docker stop during a session shares its artifacts
check_shared_on_stop() {
  docker exec "$1" touch "/tmp/log/.recording-artifact-$2"
  sleep 6
  docker stop --time 30 "$1" > /dev/null
  rm -rf "$WORK/stopped"
  docker cp "$1:/tmp/log" "$WORK/stopped" > /dev/null 2>&1
  local size
  size="$(wc -c < "$WORK/stopped/$2/video.mp4" 2> /dev/null | tr -d ' ')"
  if [[ -f "$WORK/stopped/.artifact-$2" && "${size:-0}" -gt 1024 ]]; then
    pass "docker stop during a session shares its video"
  else
    fail "docker stop during a session shares its video" "no shared video of $2" \
      "$(
        docker logs "$1" 2>&1 | grep -A4 'on finish begin'
        ls -la "$WORK/stopped" 2>&1
      )"
  fi
}

fake_log_lines() {
  docker logs "$FAKE" 2>&1 | wc -l | tr -d ' '
}

# stf_events_since <line>: the STF events of the fake device after the given log line, space separated
stf_events_since() {
  docker logs "$FAKE" 2>&1 | tail -n +"$(($1 + 1))" | sed -n -E 's/.*\[STF\] (control: (on|off)|video client (connected|closed)).*/\2\3/p' | tr '\n' ' ' | sed 's/ $//'
}

section "fake device"
docker network create "$NET" > /dev/null
mkdir -p "$WORK/frames"
chmod 777 "$WORK/frames"
docker run --rm --platform "$PLATFORM" --volume "$WORK/frames:/frames" --entrypoint ffmpeg "$IMAGE" \
  -loglevel error -f lavfi -i testsrc=size=640x360:rate=10 -frames:v 20 -q:v 5 /frames/f%03d.jpg
# the screenshots of WDA are PNG
docker run --rm --platform "$PLATFORM" --volume "$WORK/frames:/frames" --entrypoint ffmpeg "$IMAGE" \
  -loglevel error -f lavfi -i testsrc=size=640x360 -frames:v 1 /frames/screenshot.png
docker run --detach --name "$FAKE" --platform "$PLATFORM" --network "$NET" --network-alias connector --network-alias device \
  --volume "$REPO/tests/fixtures:/fixtures:ro" --volume "$WORK/frames:/frames:ro" \
  --entrypoint node "$IMAGE" /fixtures/fake-device.js > /dev/null
if wait_for 60 bash -c "docker logs ${FAKE} 2>&1 | grep -q 'fake servers up, frames: 20'"; then
  pass "the fake device is up"
else
  fail "the fake device is up" "no startup line" "$(docker logs "$FAKE" 2>&1 | tail -20)"
  finish
fi

section "ios"
IOS="${NET}-ios"
start_device "$IOS" "" "${IOS_ENV[@]}"
if ! check_starts "$IOS"; then
  finish
fi
check "/var/run/usbmuxd is a socket" "yes" "$(docker exec "$IOS" bash -c 'test -S /var/run/usbmuxd && echo yes || echo no')"
line="$(fake_log_lines)"
docker exec "$IOS" socat -u OPEN:/dev/null UNIX-CONNECT:/var/run/usbmuxd > /dev/null 2>&1
check_contains "/var/run/usbmuxd is forwarded to USBMUXD_SOCKET_ADDRESS" "[USBMUXD] client connected" \
  "$(docker logs "$FAKE" 2>&1 | tail -n +"$((line + 1))")"
line="$(fake_log_lines)"
docker exec "$IOS" timeout 10 idevice_id -l > /dev/null 2>&1
check_contains "the iOS tools reach usbmuxd at USBMUXD_SOCKET_ADDRESS" "[USBMUXD] client connected" \
  "$(docker logs "$FAKE" 2>&1 | tail -n +"$((line + 1))")"
if wait_for 90 healthy "$IOS"; then pass "the container is healthy"; else fail "the container is healthy" "not healthy" "$(state_and_logs "$IOS")"; fi
check "GET /status-wda reports WDA" "200" \
  "$(docker exec "$IOS" curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4723/wd/hub/status-wda)"

# the exit of a helper process must not stop the container (the entrypoint waits for Appium only)
docker exec "$IOS" bash -c 'kill $(pgrep -f "socat UNIX-LISTEN")'
sleep 5
if container_running "$IOS" && appium_up "$IOS"; then
  pass "the exit of the usbmuxd forwarding does not stop the container"
else
  fail "the exit of the usbmuxd forwarding does not stop the container" "the container is not running" "$(state_and_logs "$IOS")"
fi

section "ios recording"
line="$(fake_log_lines)"
# the other files of LOG_DIR are reports of the session, the WDA log is shared only with SHARE_WDA_LOG=true
docker exec "$IOS" bash -c 'touch /tmp/log/.recording-artifact-ios-1; echo report > /tmp/log/custom-report.txt; echo wda > /tmp/log/wda.log'
sleep 8
docker exec "$IOS" rm -f /tmp/log/.recording-artifact-ios-1
check_shared "$IOS" ios-1 "a session"
check "a session: the other files of LOG_DIR are moved to the session" "report|no" \
  "$(docker exec "$IOS" bash -c 'echo "$(cat /tmp/log/ios-1/custom-report.txt)|$(test -e /tmp/log/custom-report.txt && echo yes || echo no)"')"
check "a session: the WDA log is not shared by default" "no|wda" \
  "$(docker exec "$IOS" bash -c 'echo "$(test -e /tmp/log/ios-1/wda.log && echo yes || echo no)|$(cat /tmp/log/wda.log)"')"
check_contains "the video is read from the WDA MJPEG server" "[MJPEG] client connected" \
  "$(docker logs "$FAKE" 2>&1 | tail -n +"$((line + 1))")"
check "the STF broadcast is not used" "" "$(stf_events_since "$line")"
check_not_contains "no recording card by default" "[Card]" "$(docker logs "$IOS" 2>&1)"

docker exec "$IOS" touch /tmp/log/.recording-artifact-ios-2
sleep 6
docker exec "$IOS" bash -c 'rm /tmp/log/.recording-artifact-ios-2; touch /tmp/log/.recording-artifact-ios-3'
sleep 6
docker exec "$IOS" rm /tmp/log/.recording-artifact-ios-3
check_shared "$IOS" ios-2 "back-to-back sessions, the first"
check_shared "$IOS" ios-3 "back-to-back sessions, the second"

check_shared_on_stop "$IOS" ios-4

section "ios wireless"
# a device without usb (WIRELESS=true): no usbmuxd forwarding, the WDA based detection still runs;
# also SHARE_WDA_LOG=true and a MJPEG server without frames: the first frame is the screenshot of WDA
WIRELESS_IOS="${NET}-ios-wireless"
start_device "$WIRELESS_IOS" "" "${IOS_ENV[@]}" WIRELESS=true SHARE_WDA_LOG=true MJPEG_PORT=8102
if check_starts "$WIRELESS_IOS"; then
  check_contains "the usbmuxd setup is skipped" "WIRELESS=true: skipping usbmuxd setup" "$(docker logs "$WIRELESS_IOS" 2>&1)"
  check "/var/run/usbmuxd is not forwarded" "no" "$(docker exec "$WIRELESS_IOS" bash -c 'test -S /var/run/usbmuxd && echo yes || echo no')"
  check_contains "the platform version is detected from WDA" '"appium:platformVersion": "17.4"' \
    "$(docker exec "$WIRELESS_IOS" cat /opt/config/defaultcapabilities.json)"
  docker exec "$WIRELESS_IOS" bash -c 'echo wda > /tmp/log/wda.log; touch /tmp/log/.recording-artifact-w1'
  sleep 6
  docker exec "$WIRELESS_IOS" rm -f /tmp/log/.recording-artifact-w1
  if wait_for 60 shared "$WIRELESS_IOS" w1; then
    check "SHARE_WDA_LOG=true: the WDA log is moved to the session" "wda|" \
      "$(docker exec "$WIRELESS_IOS" bash -c 'echo "$(cat /tmp/log/w1/wda.log)|$(cat /tmp/log/wda.log)"')"
    duration="$(video_duration "$WIRELESS_IOS" w1)"
    if at_least "$duration" 2; then
      pass "a MJPEG server without frames: the video is the PNG screenshot of WDA"
    else
      fail "a MJPEG server without frames: the video is the PNG screenshot of WDA" "video duration: ${duration}" \
        "$(docker logs "$WIRELESS_IOS" 2>&1 | grep -E 'MjpegRelay|CaptureArtifacts|Stop Video' | tail -10)"
    fi
    check_contains "a MJPEG server without frames: the screenshot as the first frame is logged" \
      "[MjpegRelay] [w1] No frame of the stream in 1000 ms, the first frame is the screenshot" "$(docker logs "$WIRELESS_IOS" 2>&1)"
  else
    fail "SHARE_WDA_LOG=true: the artifacts are shared" "no /tmp/log/.artifact-w1" "$(state_and_logs "$WIRELESS_IOS")"
  fi
fi
docker rm -f "$WIRELESS_IOS" > /dev/null

section "ios static screen"
# the zebrunner fork of WDA sends a frame only when the screen changes and repeats it every 20 s: ffmpeg read it
# directly, waited 5 s to probe the stream and on SIGINT for the next frame (killed after 30 s), so a short session
# had no video
STATIC_IOS="${NET}-ios-static"
start_device "$STATIC_IOS" "" "${IOS_ENV[@]}" MJPEG_PORT=8103
if check_starts "$STATIC_IOS"; then
  session "$STATIC_IOS" static-1 4
  start=$SECONDS
  check_shared "$STATIC_IOS" static-1 "a short session on a static screen"
  elapsed=$((SECONDS - start))
  if [[ "$elapsed" -le 10 ]]; then
    pass "a static screen: the video is finished at once on the session end"
  else
    fail "a static screen: the video is finished at once on the session end" "shared after ${elapsed}s" \
      "$(docker logs "$STATIC_IOS" 2>&1 | grep -E 'Stop Video' | tail -10)"
  fi
  check_not_contains "a static screen: ffmpeg is not killed" "not finished correctly" "$(docker logs "$STATIC_IOS" 2>&1)"
  check "a static screen: no MJPEG relay is left after the session" "" "$(docker exec "$STATIC_IOS" pgrep --full mjpeg-relay.js)"
  # the repeated frames keep the timeline: the video lasts as the session, over the 20 s gap of the frames of WDA
  session "$STATIC_IOS" static-2 25
  check_shared "$STATIC_IOS" static-2 "a long session on a static screen"
  duration="$(video_duration "$STATIC_IOS" static-2)"
  if at_least "$duration" 22 && ! at_least "$duration" 28; then
    pass "a static screen: the video lasts as the session"
  else
    fail "a static screen: the video lasts as the session" "video duration: ${duration}, the session: 25 s" \
      "$(docker exec "$STATIC_IOS" ffprobe -v error -show_entries stream=nb_frames,duration:format=duration /tmp/log/static-2/video.mp4 2>&1)"
  fi
fi
docker rm -f "$STATIC_IOS" > /dev/null

section "android"
ANDROID="${NET}-android"
# a quick watchdog of the recordings for its checks below; the markers of the other checks are newer than its RECORDING_STALE_SEC;
# the recording card and the time stamp
start_device "$ANDROID" "" "${ANDROID_ENV[@]}" RECORDING_WATCHDOG_SEC=2 RECORDING_ORPHAN_CHECKS=2 RECORDING_CARD=true \
  RECORDING_TIMESTAMP=true DEVICE_LOCATION="farm 1"
if ! check_starts "$ANDROID"; then
  finish
fi
if wait_for 90 healthy "$ANDROID"; then pass "the container is healthy"; else fail "the container is healthy" "not healthy" "$(state_and_logs "$ANDROID")"; fi
line="$(fake_log_lines)"
docker exec "$ANDROID" bash -c 'echo > /dev/tcp/127.0.0.1/5037' > /dev/null 2>&1
check_contains "the adb server port is forwarded to the connector" "[ADB] client connected" \
  "$(docker logs "$FAKE" 2>&1 | tail -n +"$((line + 1))")"

section "android recording"
line="$(fake_log_lines)"
session "$ANDROID" and-1 8
check_shared "$ANDROID" and-1 "a session"
# the broadcast is switched on before ffmpeg connects and off only after ffmpeg finished the video
check "the STF broadcast is switched on and off around the recording" "on connected closed off" "$(stf_events_since "$line")"

section "android recording card and time stamp"
check_contains "RECORDING_CARD=true: the card is put before the video" "[Card] the card of and-1 is put before its video" \
  "$(docker logs "$ANDROID" 2>&1)"
duration="$(video_duration "$ANDROID" and-1)"
# the session lasts 8 s, its video ~7 s (the start of ffmpeg), the card 3 s
if at_least "$duration" 9 && ! at_least "$duration" 13; then
  pass "RECORDING_CARD=true: the video lasts the card and the session"
else
  fail "RECORDING_CARD=true: the video lasts the card and the session" "video duration: ${duration}, the session: 8 s" \
    "$(docker logs "$ANDROID" 2>&1 | grep -E '\[Card\]|Stop Video' | tail -10)"
fi
check "RECORDING_CARD=true: the card is white, then the frames of the device" "yes|yes" \
  "$([[ "$(frame_luma "$ANDROID" and-1 1)" -gt 230 ]] && echo yes || echo no)|$([[ "$(frame_luma "$ANDROID" and-1 6)" -lt 200 ]] && echo yes || echo no)"
check "RECORDING_CARD=true: the video with the card decodes without errors" "" \
  "$(docker exec "$ANDROID" ffmpeg -nostdin -v error -i /tmp/log/and-1/video.mp4 -f null - 2>&1)"
check "RECORDING_CARD=true: the details of the session are removed with its recording" "" \
  "$(docker exec "$ANDROID" bash -c 'ls /tmp/and-1.info /tmp/and-1.stamp 2> /dev/null')"
check_contains "RECORDING_TIMESTAMP=true: the frames are stamped with their time in UTC" "video filter: setpts=RTCTIME/1000000/TB,scale=-2:720,drawtext=fontfile='/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf':textfile='/tmp/and-1.stamp'" \
  "$(docker exec "$ANDROID" cat /tmp/log/and-1/session.log)"

line="$(fake_log_lines)"
docker exec "$ANDROID" touch /tmp/log/.recording-artifact-and-2
sleep 6
docker exec "$ANDROID" bash -c 'rm /tmp/log/.recording-artifact-and-2; touch /tmp/log/.recording-artifact-and-3'
sleep 6
docker exec "$ANDROID" rm /tmp/log/.recording-artifact-and-3
check_shared "$ANDROID" and-2 "back-to-back sessions, the first"
check_shared "$ANDROID" and-3 "back-to-back sessions, the second"
# the second recording starts at once, the end of the first one does not switch the broadcast off under it
check "back-to-back sessions: the broadcast is switched off once, after the last recording" "1 off" \
  "$(events="$(stf_events_since "$line")" && echo "$(grep -o off <<< "$events" | wc -l | tr -d ' ') ${events##* }")"

line="$(fake_log_lines)"
docker exec "$ANDROID" touch /tmp/log/.recording-artifact-and-5
sleep 4
docker exec "$ANDROID" touch /tmp/log/.recording-artifact-and-6
sleep 3
docker exec "$ANDROID" rm /tmp/log/.recording-artifact-and-5
sleep 8
docker exec "$ANDROID" rm /tmp/log/.recording-artifact-and-6
check_shared "$ANDROID" and-5 "overlapping sessions, the first"
check_shared "$ANDROID" and-6 "overlapping sessions, the second"
check "overlapping sessions: the broadcast is switched off once, after the last recording" "1 off" \
  "$(events="$(stf_events_since "$line")" && echo "$(grep -o off <<< "$events" | wc -l | tr -d ' ') ${events##* }")"
# the second session lasts 11 s, its video ~9 s (the start of ffmpeg); 'off' at the end of the first session would stop
# its frames after ~3 s
duration="$(docker exec "$ANDROID" ffprobe -v error -show_entries format=duration -of csv=p=0 /tmp/log/and-6/video.mp4 2>&1)"
if python3 -c "import sys; sys.exit(0 if float(sys.argv[1]) >= 6 else 1)" "$duration" 2> /dev/null; then
  pass "overlapping sessions: the second video goes on after the end of the first session"
else
  fail "overlapping sessions: the second video goes on after the end of the first session" "video duration: ${duration}" \
    "$(
      echo "video duration: ${duration}"
      docker exec "$ANDROID" ffprobe -v error -show_entries stream=nb_frames,duration:format=duration /tmp/log/and-6/video.mp4 2>&1
    )"
fi

section "android recording watchdog"
# an ffmpeg without a session (its marker is lost) is stopped after RECORDING_ORPHAN_CHECKS checks
docker exec --detach "$ANDROID" ffmpeg -nostdin -loglevel error -f lavfi -i testsrc=size=320x240:rate=5 -y /tmp/orphan-1.mp4
# shellcheck disable=SC2329
orphan_stopped() {
  ! docker exec "$ANDROID" pgrep --full 'ffmpeg.*orphan-1.mp4' && ! docker exec "$ANDROID" test -e /tmp/orphan-1.mp4
}
if wait_for 30 orphan_stopped; then
  pass "an ffmpeg without a session is stopped and its video removed"
else
  fail "an ffmpeg without a session is stopped and its video removed" "ffmpeg of orphan-1 runs" \
    "$(docker logs "$ANDROID" 2>&1 | grep Watchdog | tail -5)"
fi
# the old marker of a session Appium does not know is removed, its recording is shared
docker exec "$ANDROID" touch -d '-20 minutes' /tmp/log/.recording-artifact-stale-1
if wait_for 30 shared "$ANDROID" stale-1; then
  pass "the old marker of a session unknown to Appium is removed and its recording shared"
else
  fail "the old marker of a session unknown to Appium is removed and its recording shared" "no /tmp/log/.artifact-stale-1" \
    "$(docker logs "$ANDROID" 2>&1 | grep -E 'Watchdog|stale-1' | tail -10)"
fi
check "the marker of a session Appium does not know is kept while it is new" "yes" \
  "$(docker exec "$ANDROID" bash -c 'touch /tmp/log/.recording-artifact-new-1; sleep 5; test -e /tmp/log/.recording-artifact-new-1 && echo yes; rm -f /tmp/log/.recording-artifact-new-1')"
check_shared "$ANDROID" new-1 "a new session after the watchdog checks"

check_shared_on_stop "$ANDROID" and-4

section "hub down"
# mcloud-grid checks the device with GET /status-adb {"exitCode": 101}: a missing device exits Appium with 101,
# the container waits UNREGISTER_IF_STILL_DOWN_AFTER and 15 s for the hub to unregister the node, then exits with 1
HUB_DOWN="${NET}-hub-down"
start_device "$HUB_DOWN" "" "${ANDROID_ENV[@]}" UNREGISTER_IF_STILL_DOWN_AFTER=1000
if wait_for 180 appium_up "$HUB_DOWN"; then
  docker exec "$HUB_DOWN" curl -s -o /dev/null -X GET -H 'Content-Type: application/json' -d '{"exitCode": 101}' \
    http://127.0.0.1:4723/wd/hub/status-adb
  start=$SECONDS
  if wait_for 90 container_exited "$HUB_DOWN"; then
    elapsed=$((SECONDS - start))
    check "/status-adb with exitCode 101 for a missing device: the container exits with 1" "1" \
      "$(docker inspect "$HUB_DOWN" --format '{{.State.ExitCode}}')"
    check_contains "/status-adb with exitCode 101 for a missing device: Appium exits with 101" "Exit status: 101" "$(docker logs "$HUB_DOWN" 2>&1)"
    if [[ "$elapsed" -ge 15 ]]; then
      pass "/status-adb with exitCode 101: the container waits for the hub before the exit"
    else
      fail "/status-adb with exitCode 101: the container waits for the hub before the exit" "exited after ${elapsed}s" \
        "$(docker logs "$HUB_DOWN" 2>&1 | tail -10)"
    fi
  else
    fail "/status-adb with exitCode 101 for a missing device: the container exits" "still running" "$(state_and_logs "$HUB_DOWN")"
  fi
else
  fail "/status-adb with exitCode 101: Appium starts" "no Appium status" "$(state_and_logs "$HUB_DOWN")"
fi

finish
