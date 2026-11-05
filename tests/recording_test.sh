#!/bin/bash
# Tests of module/recording.sh: the end of a session with another one active (adb forwards, the STF broadcast 'off'),
# the lock of the broadcast and the watchdog of the recordings without a session end.
source "$(dirname "$0")/lib.sh"
require_cmd jq
require_cmd python3
cd "$REPO" || exit 1

export LOG_DIR="$WORK/log" BROADCAST_HOST=device BROADCAST_PORT=2223 BROADCAST_LOCK="$WORK/broadcast.lock"
export PLATFORM_NAME=android APPIUM_PORT=4723 LOGGER_LEVEL=INFO
mkdir -p "$LOG_DIR"
PATH="${WORK}/bin:${PATH}"
# shellcheck source=../files/util/logger.sh
source files/util/logger.sh
# shellcheck source=../files/module/recording.sh
source files/module/recording.sh

# the tools of the module: nc and adb record their calls (nc with its input), no ffmpeg reads the broadcast
stub nc "echo \"nc|\$*|\$(cat)\" >> '${WORK}/calls.log'"
record_stub adb
stub pgrep 'exit 1'

reset_state() {
  reset_calls
  rm -rf "${LOG_DIR:?}"/.recording-artifact-* "$BROADCAST_LOCK"
  RECORDING_ORPHANS=""
}

section "the end of a session"
# the share itself is the subject of tests/e2e_test.sh
share() {
  echo "share|$1" >> "${WORK}/calls.log"
}
reset_state
recordingEnded s1 > /dev/null
wait
check "the adb forwards are removed without another session" "forward|--remove-all" "$(calls adb)"
check "the recording is shared" "s1" "$(calls share)"
reset_state
touch "$LOG_DIR/.recording-artifact-s2"
out="$(recordingEnded s1)"
wait
check "the adb forwards of another active session stay" "" "$(calls adb)"
check_contains "the kept forwards are logged" "another session is active, its adb forwarding stays" "$out"
check "the recording is shared with another session active" "s1" "$(calls share)"
check "the active recordings are the markers" "s2" "$(activeRecordings)"
rm -f "$LOG_DIR/.recording-artifact-s2"
run_check "no active recordings without markers" bash -c "! (source files/util/logger.sh; source files/module/recording.sh; LOG_DIR='$LOG_DIR' activeRecordings)"
unset -f share
# shellcheck source=../files/module/recording.sh
source files/module/recording.sh

section "the STF broadcast"
reset_state
broadcastOff > /dev/null
check "'off' is sent when no recording reads the broadcast" "device 2223 -q 0 -v|off" "$(calls nc)"
check "the lock is released" "no" "$(test -e "$BROADCAST_LOCK" && echo yes || echo no)"
reset_state
stub pgrep '[[ "$*" == "--full ffmpeg.*tcp://device:2223" ]] && echo 4242'
out="$(broadcastOff)"
check "'off' is not sent while another recording reads the broadcast" "" "$(calls nc)"
check_contains "the kept broadcast is logged" "another recording reads the STF broadcast, it stays 'on'" "$out"
stub pgrep 'exit 1'
reset_state
broadcastLock
(
  broadcastLock
  echo "second" >> "${WORK}/calls.log"
  broadcastUnlock
) &
sleep 0.5
check "the lock waits for its holder" "" "$(grep -x second "${WORK}/calls.log")"
broadcastUnlock
wait
check "the lock is taken after its release" "second" "$(grep -x second "${WORK}/calls.log")"
reset_state
mkdir "$BROADCAST_LOCK"
out="$(
  sleep() { :; }
  broadcastLock
)"
check_contains "the lock of a killed process is taken over" "the STF broadcast lock is held for 10 s, it is taken over" "$out"

section "the watchdog: stale markers"
# Appium knows the session "live"; "dead" and "live" are older than RECORDING_STALE_SEC, "fresh" is new
appium_sessions() {
  stub curl "echo '$1'"
}
stale_markers() {
  reset_state
  touch -t 202001010000 "$LOG_DIR/.recording-artifact-dead" "$LOG_DIR/.recording-artifact-live"
  touch "$LOG_DIR/.recording-artifact-fresh"
  removeStaleMarkers > "$WORK/watchdog.log" 2>&1
  activeRecordings | sort | tr '\n' ' ' | sed 's/ $//'
}
appium_sessions '{"value":[{"id":"live","created":1}]}'
check "the old marker of a session unknown to Appium is removed" "fresh live" "$(stale_markers)"
check_contains "the removal is logged" "the session dead is unknown to Appium" "$(cat "$WORK/watchdog.log")"
appium_sessions '{"value":[]}'
check "no session: every old marker is removed" "fresh" "$(stale_markers)"
stub curl 'exit 7'
check "Appium does not answer: no marker is removed" "dead fresh live" "$(stale_markers)"
appium_sessions '{"value":{"error":"unknown"}}'
check "an unexpected answer: no marker is removed" "dead fresh live" "$(stale_markers)"
appium_sessions '{"value":[]}'
check "ROUTER_UUID names the markers: no marker is removed" "dead fresh live" "$(ROUTER_UUID=router-1 stale_markers)"

section "the watchdog: ffmpeg without a session"
# a real process stands for the ffmpeg of the session "orphan", ps shows its command line; an async process of a
# script ignores SIGINT, so it is a python one that handles it like ffmpeg
python3 -c 'import signal, time; signal.signal(signal.SIGINT, signal.default_int_handler); time.sleep(60)' 2> /dev/null &
orphan=$!
stub pgrep "[[ \"\$*\" == '-x ffmpeg' ]] && echo $orphan; exit 0"
stub ps "if [[ \"\$1\" == -o ]]; then echo 'ffmpeg -f mjpeg -i tcp://device:2223 -y /tmp/orphan.mp4'; else exec /bin/ps \"\$@\"; fi"
reset_state
touch "$LOG_DIR/.recording-artifact-orphan"
RECORDING_ORPHAN_CHECKS=2 stopOrphanRecordings > /dev/null
check "an ffmpeg with the marker of its session is not counted" "" "$RECORDING_ORPHANS"
rm -f "$LOG_DIR/.recording-artifact-orphan"
touch "$LOG_DIR/.sharing-artifact-orphan"
RECORDING_ORPHAN_CHECKS=2 stopOrphanRecordings > /dev/null
check "an ffmpeg of a share in progress is not counted" "" "$RECORDING_ORPHANS"
rm -f "$LOG_DIR/.sharing-artifact-orphan"
RECORDING_ORPHAN_CHECKS=2 stopOrphanRecordings > /dev/null
check "an ffmpeg without a session is counted" "${orphan}:1" "$(echo "$RECORDING_ORPHANS" | xargs)"
check "it runs until RECORDING_ORPHAN_CHECKS" "yes" "$(kill -0 "$orphan" 2> /dev/null && echo yes || echo no)"
RECORDING_ORPHAN_CHECKS=2 stopOrphanRecordings > "$WORK/watchdog.log" 2>&1
wait "$orphan" 2> /dev/null
check "it is stopped after RECORDING_ORPHAN_CHECKS" "no" "$(kill -0 "$orphan" 2> /dev/null && echo yes || echo no)"
check_contains "the stop is logged" "records orphan without a session for 2 checks, it is stopped" "$(cat "$WORK/watchdog.log")"
check "the broadcast it read is switched off" "device 2223 -q 0 -v|off" "$(calls nc)"
check "the forgotten ffmpeg is not counted anymore" "" "$RECORDING_ORPHANS"

finish
