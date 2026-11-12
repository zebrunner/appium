#!/bin/bash
# The recording card: a video of RECORDING_CARD_SEC with the logo and the details of the session, put before the video
# of the session (RECORDING_CARD=true), and the time stamp of the frames on the video (RECORDING_TIMESTAMP=true).
# Sourced by recording.sh after util/logger.sh. The details are collected at the start of the recording
# (collectSessionInfo, in the background) into /tmp/<id>.info as key=value lines; the card is rendered at the end of
# the recording with the size of the video and joined to it without encoding the video again (addRecordingCard).
# Compatible with the macOS system bash 3.2 of the tests: no associative arrays (CONVENTIONS.md).

RECORDING_FONT="${RECORDING_FONT:-/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf}"
RECORDING_LOGO="${RECORDING_LOGO:-/opt/zebrunner-logo.png}"
# how long the start of the recording waits for the session in Appium for its capabilities
RECORDING_CAPS_WAIT_SEC="${RECORDING_CAPS_WAIT_SEC:-20}"
RECORDING_CARD_SEC="${RECORDING_CARD_SEC:-3}"
# the details and the time stamp of the recordings
RECORDING_INFO_DIR="${RECORDING_INFO_DIR:-/tmp}"
# the capabilities of the test name, the first one set is shown
RECORDING_TEST_CAPS='name appium:name zebrunner:name zebrunner:testName testName'

# recordingInfoFile <id>: the details of the session for its card
recordingInfoFile() {
  echo "${RECORDING_INFO_DIR}/${1}.info"
}

# recordingStampFile <id>: the drawtext text of the time stamp of the frames
recordingStampFile() {
  echo "${RECORDING_INFO_DIR}/${1}.stamp"
}

# infoValue <info file> <key>: the value of the key, the last one wins
infoValue() {
  sed -n "s/^${2}=//p" "$1" 2> /dev/null | tail -1
}

# timestampFilter <id>: the drawtext filter of the time stamp (the capture time of each frame in UTC and the session),
# with its text file written; the pts of a frame is its wall clock time (setpts=RTCTIME)
timestampFilter() {
  local stamp
  stamp="$(recordingStampFile "$1")"
  # drawtext expands %{pts:gmtime:0:<strftime>}, the colons of the format are escaped for it
  printf '%%{pts:gmtime:0:%%Y-%%m-%%d %%H\\:%%M\\:%%S} UTC  %s' "${1:0:8}" > "$stamp"
  echo "drawtext=fontfile='${RECORDING_FONT}':textfile='${stamp}':fontcolor=white:fontsize='min(h/50\\,w/20)':box=1:boxcolor=black@0.55:boxborderw=5:x=(w-tw)/2:y=h-th-12"
}

# sessionCaps <id>: test, app, appPackage and bundleId of the capabilities of the session, as key=value lines; waits for
# the session in Appium up to RECORDING_CAPS_WAIT_SEC while its recording runs
sessionCaps() {
  local id=$1 tries=0 caps="" cap value
  while [[ "$tries" -lt $((RECORDING_CAPS_WAIT_SEC * 2)) ]]; do
    caps="$(curl -fsS --max-time 5 "http://127.0.0.1:${APPIUM_PORT}/wd/hub/appium/sessions" 2> /dev/null |
      jq -c --arg id "$id" '.value[]? | select(.id == $id) | .capabilities' 2> /dev/null)"
    [[ -n "$caps" ]] && break
    [[ -e "${LOG_DIR}/.recording-artifact-${id}" ]] || return 0
    sleep 0.5
    tries=$((tries + 1))
  done
  [[ -n "$caps" ]] || return 0
  for cap in $RECORDING_TEST_CAPS; do
    value="$(jq -r --arg cap "$cap" '.[$cap] // empty | tostring' <<< "$caps" 2> /dev/null)"
    if [[ -n "$value" ]]; then
      echo "test=${value}"
      break
    fi
  done
  # the file name of the app url without its query (e.g. the signature of a presigned S3 url)
  value="$(jq -r '.["appium:app"] // .app // empty' <<< "$caps" 2> /dev/null)"
  value="${value%%\?*}"
  value="${value##*/}"
  # the file name decoded from the url, e.g. %5B -> [
  [[ -n "$value" ]] && echo "app=$(printf '%b' "${value//%/\\x}")"
  echo "appPackage=$(jq -r '.["appium:appPackage"] // empty' <<< "$caps" 2> /dev/null)"
  echo "bundleId=$(jq -r '.["appium:bundleId"] // empty' <<< "$caps" 2> /dev/null)"
}

# deviceDetails: the model and the API level of the device, as key=value lines
deviceDetails() {
  if [[ "$(recordingPlatform)" == "android" ]]; then
    local manufacturer model
    manufacturer="$(adb shell getprop ro.product.manufacturer 2> /dev/null | tr -d '\r')"
    model="$(adb shell getprop ro.product.model 2> /dev/null | tr -d '\r')"
    echo "model=$(echo "${manufacturer} ${model}" | xargs)"
    echo "api=$(adb shell getprop ro.build.version.sdk 2> /dev/null | tr -d '\r')"
  elif [[ "${WIRELESS}" != "true" && -z "${DEVICE_CONNECTION}" ]]; then
    # a device of usbmuxd: its product type, e.g. iPhone14,4
    echo "model=$(ideviceinfo -u "${DEVICE_UDID}" -k ProductType 2> /dev/null)"
  fi
}

# appVersion <package>: the versionName of the installed Android app
appVersion() {
  [[ -n "$1" && "$(recordingPlatform)" == "android" ]] || return 0
  adb shell dumpsys package "$1" 2> /dev/null | tr -d '\r' | sed -n 's/^ *versionName=//p' | head -1
}

# collectSessionInfo <id>: the details of the session for its card, run in the background at the start of the recording:
# the ones of the container at once, the ones of the device and of the session after them, unless the recording ended
# and its details are removed meanwhile
collectSessionInfo() {
  local id=$1 file appium details
  file="$(recordingInfoFile "$id")"
  appium="$(jq -r '.version // empty' "${APPIUM_HOME}/package.json" 2> /dev/null)"
  {
    echo "session=${id}"
    echo "started=$(date -u +'%Y-%m-%d %H:%M:%S')"
    echo "platform=$(recordingPlatform)"
    echo "platformVersion=${PLATFORM_VERSION}"
    echo "deviceType=${DEVICETYPE}"
    echo "deviceName=${DEVICE_NAME}"
    echo "udid=${DEVICE_UDID}"
    echo "node=${STF_PROVIDER_HOST:+${STF_PROVIDER_HOST}:${APPIUM_PORT}}"
    [[ "${CONNECT_TO_GRID}" == "true" ]] && echo "hub=${SELENIUM_HOST}:${SELENIUM_PORT}"
    echo "location=${DEVICE_LOCATION}"
    echo "image=${IMAGE_VERSION}${appium:+ (Appium ${appium})}"
  } > "$file"
  details="$(
    deviceDetails
    sessionCaps "$id"
  )"
  details+=$'\n'"appVersion=$(appVersion "$(sed -n 's/^appPackage=//p' <<< "$details")")"
  [[ -e "$file" ]] && echo "$details" >> "$file"
}

# osName: the OS of the device for the card
osName() {
  case "$(infoValue "$1" platform)|$(infoValue "$1" deviceType)" in
  ios\|tvOS) echo "tvOS" ;;
  ios\|*) echo "iOS" ;;
  android\|*) echo "Android" ;;
  *) infoValue "$1" platform ;;
  esac
}

# cardLines <info file> <ended> <duration>: the "<label>|<value>" lines of the card, the empty values are skipped
cardLines() {
  local info=$1 value app os started
  started="$(infoValue "$info" started)"
  app="$(infoValue "$info" app)"
  [[ -n "$app" ]] || app="$(infoValue "$info" bundleId)"
  [[ -n "$app" ]] || app="$(infoValue "$info" appPackage)"
  value="$(infoValue "$info" appVersion)"
  [[ -n "$app" && -n "$value" ]] && app="${app} ${value}"
  os="$(osName "$info") $(infoValue "$info" platformVersion)"
  value="$(infoValue "$info" api)"
  [[ -n "$value" ]] && os="${os} (API ${value})"
  value="$(infoValue "$info" model)"
  {
    echo "Session|$(infoValue "$info" session)"
    echo "Test|$(infoValue "$info" test)"
    echo "App|${app}"
    echo "Device|$(infoValue "$info" deviceName)${value:+ - ${value}}"
    echo "OS|$(echo "$os" | xargs)"
    echo "UDID|$(infoValue "$info" udid)"
    echo "Started|${started}${started:+ UTC}"
    echo "Ended|${2}${2:+ UTC}${3:+ (${3})}"
    echo "Node|$(infoValue "$info" node)"
    echo "Hub|$(infoValue "$info" hub)"
    echo "Location|$(infoValue "$info" location)"
    echo "Image|$(infoValue "$info" image)"
  } | grep -v '|$'
}

# wrapText <columns>: stdin wrapped at the columns, after the last space or one of ./_-, of a line (e.g. a test name of
# a Java class and method), else before a capital letter (camelCase), else cut
wrapText() {
  awk -v c="$1" '{
    s = $0
    while (length(s) > c) {
      cut = 0
      for (i = c; i > c / 3 && !cut; i--) {
        if (index(" ./_-,", substr(s, i, 1))) cut = i
      }
      for (i = c + 1; i > c / 3 && !cut; i--) {
        if (substr(s, i, 1) ~ /[A-Z]/ && substr(s, i - 1, 1) ~ /[a-z0-9]/) cut = i - 1
      }
      if (!cut) cut = c
      line = substr(s, 1, cut); sub(/ +$/, "", line); print line
      s = substr(s, cut + 1); sub(/^ +/, "", s)
    }
    print s
  }'
}

# cardFilter <lines file> <width> <height> <text dir>: the filter of the card over a white video of the size: the
# logo and the lines, the label grey and the value black, the font fitted to the width and the height
cardFilter() {
  local lines=$1 width=$2 height=$3 dir=$4
  local fontSize columns logoHeight textTop lineHeight left label value n=0 y entries=0 rows=0 line longest
  logoHeight=$((height * 17 / 100))
  textTop=$((height * 5 / 100 + logoHeight + height * 4 / 100))
  # a monospace character is 0.6 of the font size; the width fits 36 characters (a session id) at least
  fontSize="$(awk -v w="$width" -v h="$height" 'BEGIN { s = h / 40; if (w / 23 < s) s = w / 23; printf "%d", s }')"
  columns="$(awk -v w="$width" -v s="$fontSize" 'BEGIN { printf "%d", w * 0.92 / (s * 0.6) }')"
  # the rows of the wrapped values: the font is made smaller while they do not fit the height
  while IFS='|' read -r label value; do
    entries=$((entries + 1))
    rows=$((rows + 1 + $(echo "$value" | wrapText "$columns" | wc -l)))
  done < "$lines"
  fontSize="$(awk -v s="$fontSize" -v h="$height" -v t="$textTop" -v r="$rows" -v e="$entries" \
    'BEGIN { f = (h - t - h * 0.03) / (r * 1.3 + e * 0.5); if (f < s) s = f; printf "%d", s }')"
  columns="$(awk -v w="$width" -v s="$fontSize" 'BEGIN { printf "%d", w * 0.92 / (s * 0.6) }')"
  lineHeight="$(awk -v s="$fontSize" 'BEGIN { printf "%d", s * 1.3 }')"
  # the block of the lines is centered: the longest of them
  longest="$(while IFS='|' read -r label value; do
    echo "$label"
    echo "$value" | wrapText "$columns"
  done < "$lines" | awk '{ if (length($0) > m) m = length($0) } END { print m + 0 }')"
  left="$(awk -v w="$width" -v s="$fontSize" -v m="$longest" 'BEGIN { l = (w - m * s * 0.6) / 2; if (l < w * 0.04) l = w * 0.04; printf "%d", l }')"
  printf "movie='%s',scale=-1:%s[logo];[in][logo]overlay=x=(W-w)/2:y=%s" "$RECORDING_LOGO" "$logoHeight" "$((height * 5 / 100))"
  y=$textTop
  while IFS='|' read -r label value; do
    n=$((n + 1))
    printf '%s' "$label" > "${dir}/${n}.txt"
    printf ",drawtext=fontfile='%s':textfile='%s/%s.txt':expansion=none:fontsize=%s:fontcolor=0x808080:x=%s:y=%s" \
      "$RECORDING_FONT" "$dir" "$n" "$fontSize" "$left" "$y"
    y=$((y + lineHeight))
    while IFS= read -r line; do
      n=$((n + 1))
      printf '%s' "$line" > "${dir}/${n}.txt"
      printf ",drawtext=fontfile='%s':textfile='%s/%s.txt':expansion=none:fontsize=%s:fontcolor=black:x=%s:y=%s" \
        "$RECORDING_FONT" "$dir" "$n" "$fontSize" "$left" "$y"
      y=$((y + lineHeight))
    done < <(echo "$value" | wrapText "$columns")
    y=$((y + fontSize / 2))
  done < "$lines"
  echo '[out]'
}

# videoDuration <video>: the duration, s
videoDuration() {
  ffprobe -v error -show_entries format=duration -of csv=p=0 "$1" 2> /dev/null
}

# addRecordingCard <id> <video>: puts the card of the session before the video; the video stays as it is on a failure
addRecordingCard() {
  local id=$1 video=$2 info dir width height pixFmt timeBase duration ended stream
  info="$(recordingInfoFile "$id")"
  dir="$(mktemp -d)"
  stream="$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height,pix_fmt,time_base -of csv=p=0 "$video" 2> /dev/null)"
  IFS=',' read -r width height pixFmt timeBase <<< "$stream"
  duration="$(videoDuration "$video")"
  if [[ -z "$width" || -z "$height" || -z "$duration" ]]; then
    logger "WARN" "[Card] the video of ${id} is not readable (${stream}), it has no card"
    rm -rf "$dir"
    return 0
  fi
  [[ -s "$info" ]] || echo "session=${id}" > "$info"
  ended="$(date -u +'%Y-%m-%d %H:%M:%S')"
  cardLines "$info" "$ended" "$(awk -v d="$duration" 'BEGIN { d = int(d); printf "%02d:%02d:%02d", d / 3600, d % 3600 / 60, d % 60 }')" > "${dir}/lines"
  cardFilter "${dir}/lines" "$width" "$height" "$dir" > "${dir}/filter"
  printf "file '%s'\nfile '%s'\n" "${dir}/card.mp4" "$video" > "${dir}/list"
  # the card is encoded as the recording (libx264 ultrafast, the pixel format and the time base), so the concat
  # demuxer joins them without encoding the video again
  if ! ffmpeg -nostdin -hide_banner -loglevel error -f lavfi -i "color=c=white:s=${width}x${height}:r=25:d=${RECORDING_CARD_SEC}" \
    -filter_script:v "${dir}/filter" -c:v libx264 -preset:v ultrafast -crf 35 -pix_fmt "$pixFmt" \
    -video_track_timescale "${timeBase#*/}" -y "${dir}/card.mp4"; then
    logger "WARN" "[Card] the card of ${id} is not rendered, the video has no card"
  elif ! ffmpeg -nostdin -hide_banner -loglevel error -f concat -safe 0 -i "${dir}/list" -c copy -movflags +faststart \
    -y "${dir}/video.mp4"; then
    logger "WARN" "[Card] the card of ${id} is not joined to its video, the video has no card"
  elif awk -v j="$(videoDuration "${dir}/video.mp4")" -v d="$duration" -v c="$RECORDING_CARD_SEC" \
    'BEGIN { exit !(j - d - c < 1 && d + c - j < 1) }'; then
    # the joined video lasts as the card and the video
    mv "${dir}/video.mp4" "$video"
    logger "INFO" "[Card] the card of ${id} is put before its video"
  else
    logger "WARN" "[Card] the video of ${id} with its card does not last as both, the video has no card"
  fi
  rm -rf "$dir"
}
