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

# the env vars of the appium containers in zebrunner/mcloud-agent (roles/*devices/templates/zebrunner-farm)
COMMON_ENV=(
  TASK_LOG=/tmp/log/appium.log RETAIN_TASK=true CONNECT_TO_GRID=true CUSTOM_NODE_CONFIG=true
  STF_PROVIDER_HOST=10.0.0.5 SELENIUM_HOST=hub SELENIUM_PORT=4444 DEFAULT_CAPABILITIES=true
  ADB_PORT=5037 PROXY_PORT=8080 SERVER_PROXY_PORT=0 APPIUM_PORT=4723 RELAXED_SECURITY=true
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

# the predicates below are called through wait_for
# shellcheck disable=SC2329
appium_up() {
  [[ "$(docker exec "$1" curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4723/wd/hub/status 2> /dev/null)" == "200" ]]
}

# shellcheck disable=SC2329
running() {
  [[ "$(docker inspect "$1" --format '{{.State.Running}}' 2> /dev/null)" == "true" ]]
}

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
  if wait_for 180 appium_up "$1" && sleep 15 && running "$1" && appium_up "$1"; then
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
if running "$IOS" && appium_up "$IOS"; then
  pass "the exit of the usbmuxd forwarding does not stop the container"
else
  fail "the exit of the usbmuxd forwarding does not stop the container" "the container is not running" "$(state_and_logs "$IOS")"
fi

section "ios recording"
line="$(fake_log_lines)"
session "$IOS" ios-1 8
check_shared "$IOS" ios-1 "a session"
check_contains "the video is read from the WDA MJPEG server" "[MJPEG] client connected" \
  "$(docker logs "$FAKE" 2>&1 | tail -n +"$((line + 1))")"
check "the STF broadcast is not used" "" "$(stf_events_since "$line")"

docker exec "$IOS" touch /tmp/log/.recording-artifact-ios-2
sleep 6
docker exec "$IOS" bash -c 'rm /tmp/log/.recording-artifact-ios-2; touch /tmp/log/.recording-artifact-ios-3'
sleep 6
docker exec "$IOS" rm /tmp/log/.recording-artifact-ios-3
check_shared "$IOS" ios-2 "back-to-back sessions, the first"
check_shared "$IOS" ios-3 "back-to-back sessions, the second"

check_shared_on_stop "$IOS" ios-4

section "android"
ANDROID="${NET}-android"
start_device "$ANDROID" "" "${ANDROID_ENV[@]}"
if ! check_starts "$ANDROID"; then
  finish
fi
if wait_for 90 healthy "$ANDROID"; then pass "the container is healthy"; else fail "the container is healthy" "not healthy" "$(state_and_logs "$ANDROID")"; fi
check "the adb server port is forwarded" "yes" \
  "$(docker exec "$ANDROID" bash -c 'echo > /dev/tcp/127.0.0.1/5037 && echo yes || echo no' 2>&1)"

section "android recording"
line="$(fake_log_lines)"
session "$ANDROID" and-1 8
check_shared "$ANDROID" and-1 "a session"
# the broadcast is switched on before ffmpeg connects and off only after ffmpeg finished the video
check "the STF broadcast is switched on and off around the recording" "on connected closed off" "$(stf_events_since "$line")"

line="$(fake_log_lines)"
docker exec "$ANDROID" touch /tmp/log/.recording-artifact-and-2
sleep 6
docker exec "$ANDROID" bash -c 'rm /tmp/log/.recording-artifact-and-2; touch /tmp/log/.recording-artifact-and-3'
sleep 6
docker exec "$ANDROID" rm /tmp/log/.recording-artifact-and-3
check_shared "$ANDROID" and-2 "back-to-back sessions, the first"
check_shared "$ANDROID" and-3 "back-to-back sessions, the second"
check "back-to-back sessions: the first recording is finished before the second starts" \
  "on connected closed off on connected closed off" "$(stf_events_since "$line")"

check_shared_on_stop "$ANDROID" and-4

finish
