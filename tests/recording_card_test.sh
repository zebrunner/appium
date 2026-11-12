#!/bin/bash
# Tests of module/recording-card.sh: the details of the session collected for its card, the lines of the card, the
# time stamp of the frames and the card put before a video (with ffmpeg and a monospace font, skipped without them).
source "$(dirname "$0")/lib.sh"
require_cmd jq
cd "$REPO" || exit 1

export LOG_DIR="$WORK/log" APPIUM_PORT=4723 APPIUM_HOME="$WORK/appium" STF_PROVIDER_HOST=10.0.0.5 CONNECT_TO_GRID=true \
  SELENIUM_HOST=hub SELENIUM_PORT=4444 DEVICE_LOCATION="farm 1, shelf 2" IMAGE_VERSION=3.2 RECORDING_CAPS_WAIT_SEC=2 \
  LOGGER_LEVEL=INFO RECORDING_INFO_DIR="$WORK"
mkdir -p "$LOG_DIR" "$APPIUM_HOME"
echo '{"name": "appium", "version": "3.1.1"}' > "${APPIUM_HOME}/package.json"
PATH="${WORK}/bin:${PATH}"
# shellcheck source=../files/util/logger.sh
source files/util/logger.sh
# shellcheck source=../files/module/recording.sh
source files/module/recording.sh

# sessions <json of the capabilities> <id>: the answer of Appium with the session
sessions() {
  stub curl "echo '{\"value\":[{\"id\":\"other\",\"capabilities\":{}},{\"id\":\"$2\",\"capabilities\":$1}]}'"
}
stub adb 'case "$*" in
  *ro.product.manufacturer*) printf "Google\r\n" ;;
  *ro.product.model*) printf "Pixel 9\r\n" ;;
  *ro.build.version.sdk*) printf "35\r\n" ;;
  *"dumpsys package com.example.app"*) printf "    versionCode=2604601 minSdk=26\r\n    versionName=26.46.0\r\n" ;;
esac'
stub ideviceinfo 'echo "iPhone14,4"'

# info <id> <key>: a value of the collected details
info() {
  infoValue "$(recordingInfoFile "$1")" "$2"
}

section "the details of an Android session"
export PLATFORM_NAME=android PLATFORM_VERSION=15 DEVICETYPE=Phone DEVICE_NAME=Pixel_9 DEVICE_UDID=51160DLAQ008LF
id="card-test-$$-a"
sessions '{"platformName":"Android","appium:appPackage":"com.example.app","appium:name":"Login smoke","zebrunner:name":"later"}' "$id"
touch "$LOG_DIR/.recording-artifact-$id"
collectSessionInfo "$id"
check "the device, the OS and the node" "Pixel_9|51160DLAQ008LF|android|15|10.0.0.5:4723|hub:4444" \
  "$(info "$id" deviceName)|$(info "$id" udid)|$(info "$id" platform)|$(info "$id" platformVersion)|$(info "$id" node)|$(info "$id" hub)"
check "the model and the API level from adb" "Google Pixel 9|35" "$(info "$id" model)|$(info "$id" api)"
check "the test is the first capability set of RECORDING_TEST_CAPS" "Login smoke" "$(info "$id" test)"
check "the app and its installed version" "com.example.app|26.46.0" "$(info "$id" appPackage)|$(info "$id" appVersion)"
check "the location and the image with the Appium version" "farm 1, shelf 2|3.2 (Appium 3.1.1)" "$(info "$id" location)|$(info "$id" image)"
check_contains "the start in UTC" "$(date -u +'%Y-%m-%d')" "$(info "$id" started)"

section "the details of an iOS session"
export PLATFORM_NAME=ios PLATFORM_VERSION=26.4 DEVICETYPE=Phone DEVICE_NAME=iPhone_13 DEVICE_UDID=00008110-000A
id="card-test-$$-i"
sessions '{"platformName":"iOS","appium:app":"https://s3.example.com/apps/mfp-ios-26.46.0-%5B83591%5D.ipa?X-Amz-Signature=abc","name":"com.example.DiaryTest.testAdd"}' "$id"
touch "$LOG_DIR/.recording-artifact-$id"
collectSessionInfo "$id"
check "the file of the app url without the query, decoded" "mfp-ios-26.46.0-[83591].ipa" "$(info "$id" app)"
check "the test of the capability name" "com.example.DiaryTest.testAdd" "$(info "$id" test)"
check "the model of a usbmuxd device from ideviceinfo" "iPhone14,4" "$(info "$id" model)"
check "no app version without adb" "" "$(info "$id" appVersion)"

section "a session unknown to Appium"
id="card-test-$$-u"
stub curl "echo '{\"value\":[]}'"
start=$SECONDS
collectSessionInfo "$id"
check "the details without the capabilities do not wait for the session once its recording ended" "yes|$id|" \
  "$([[ $((SECONDS - start)) -lt 2 ]] && echo yes || echo no)|$(info "$id" session)|$(info "$id" test)"

section "the lines of the card"
file="$WORK/lines.info"
cat > "$file" << 'EOF'
session=s-1
started=2026-11-12 16:43:10
platform=android
platformVersion=15
deviceName=Pixel_9
udid=51160DLAQ008LF
node=10.0.0.5:4723
image=3.2 (Appium 3.1.1)
model=Google Pixel 9
api=35
appPackage=com.example.app
appVersion=26.46.0
test=
EOF
check "the labels in order, the empty ones skipped" "Session|s-1
App|com.example.app 26.46.0
Device|Pixel_9 - Google Pixel 9
OS|Android 15 (API 35)
UDID|51160DLAQ008LF
Started|2026-11-12 16:43:10 UTC
Ended|2026-11-12 16:43:20 UTC (00:00:10)
Node|10.0.0.5:4723
Image|3.2 (Appium 3.1.1)" "$(cardLines "$file" "2026-11-12 16:43:20" "00:00:10")"
check "an iOS tablet and a tvOS device" "OS|iOS 18.6 OS|tvOS 26.0" \
  "$(printf 'platform=ios\nplatformVersion=18.6\ndeviceType=Tablet\n' > "$file" && cardLines "$file" | grep '^OS') $(printf 'platform=ios\nplatformVersion=26.0\ndeviceType=tvOS\n' > "$file" && cardLines "$file" | grep '^OS')"
check "a Java test name is wrapped after its dots, then before a capital letter" "com.example.tests.diary.DiaryTest.
testAddFoodToBreakfastAndVerify
Calories" "$(echo 'com.example.tests.diary.DiaryTest.testAddFoodToBreakfastAndVerifyCalories' | wrapText 34)"
check "a sentence is wrapped at its spaces, a word without breaks is cut" "Login smoke with a long
description
aaaaaaaaaaaaaaaaaaaaaaaa
aaaaaa" "$(printf 'Login smoke with a long description\naaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n' | wrapText 24)"

section "the time stamp"
filter="$(timestampFilter card-stamp-session-id)"
check "the stamp is the capture time in UTC and the short session id" '%{pts:gmtime:0:%Y-%m-%d %H\:%M\:%S} UTC  card-sta' \
  "$(cat "$(recordingStampFile card-stamp-session-id)")"
check_contains "the drawtext filter reads the stamp" "drawtext=fontfile='${RECORDING_FONT}':textfile='$(recordingStampFile card-stamp-session-id)':" "$filter"
rm -f "$(recordingStampFile card-stamp-session-id)"

section "the card before a video"
echo "not a video" > "$WORK/broken.mp4"
stub ffprobe 'exit 1'
out="$(addRecordingCard card-broken "$WORK/broken.mp4" 2>&1)"
check "an unreadable video stays as it is" "not a video" "$(cat "$WORK/broken.mp4")"
check_contains "an unreadable video is logged" "[Card] the video of card-broken is not readable" "$out"
rm -f "${WORK}/bin/ffprobe"

font=""
for candidate in "$RECORDING_FONT" /System/Library/Fonts/Supplemental/Courier\ New.ttf /usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf; do
  [[ -f "$candidate" ]] && font="$candidate" && break
done
if command -v ffmpeg > /dev/null && [[ -n "$font" ]] && ffmpeg -hide_banner -filters 2> /dev/null | grep -q ' drawtext '; then
  export RECORDING_FONT="$font" RECORDING_LOGO="$REPO/files/assets/zebrunner-logo.png" RECORDING_CARD_SEC=3
  # a video encoded as the recording: libx264 ultrafast of MJPEG frames (full range yuvj420p), a 1/12800 time base
  ffmpeg -nostdin -loglevel error -f lavfi -i testsrc=size=332x720:rate=25:duration=4 -pix_fmt yuvj420p -c:v libx264 \
    -preset:v ultrafast -crf 35 -movflags +empty_moov+frag_keyframe -y "$WORK/video.mp4"
  printf 'session=s-2\nstarted=2026-11-12 16:43:10\nplatform=ios\nplatformVersion=26.4\n' > "$(recordingInfoFile s-2)"
  out="$(addRecordingCard s-2 "$WORK/video.mp4" 2>&1)"
  check_contains "the card is logged" "[Card] the card of s-2 is put before its video" "$out"
  check "the video lasts RECORDING_CARD_SEC more" "7.0" "$(printf '%.1f' "$(videoDuration "$WORK/video.mp4")")"
  # the mean luma of a frame scaled to one pixel
  luma() {
    ffmpeg -nostdin -loglevel error -ss "$1" -i "$WORK/video.mp4" -frames:v 1 -vf scale=1:1,format=gray -f rawvideo - | od -An -tu1 | tr -d ' \n'
  }
  check "the card is white, then the video" "yes|yes" \
    "$([[ "$(luma 1)" -gt 230 ]] && echo yes || echo no)|$([[ "$(luma 5)" -lt 200 ]] && echo yes || echo no)"
  check "the joined video decodes without errors" "" "$(ffmpeg -nostdin -v error -i "$WORK/video.mp4" -f null - 2>&1)"
  rm -f "$(recordingInfoFile s-2)"
else
  skip_check "the card is put before a video" "no ffmpeg with drawtext or no monospace font"
fi

finish
