#!/bin/bash
# Checks of the docker image: build, contents, Appium startup with the env vars of the image and shutdown.
# The device modules are not used here (PLATFORM_NAME is empty), see tests/e2e_test.sh for them.
# the single quoted scripts are expanded in the containers
# shellcheck disable=SC2016
source "$(dirname "$0")/lib.sh"
source "$(dirname "$0")/docker_lib.sh"
cd "$REPO" || exit 1

PREFIX="zbr-appium-image-test-$$"

# called by the EXIT trap of lib.sh
# shellcheck disable=SC2329
cleanup() {
  docker ps --all --quiet --filter "name=${PREFIX}" | xargs docker rm -f > /dev/null 2>&1 || true
}

# in_image <script>: runs the bash script in a new container of the image
in_image() {
  docker run --rm --platform "$PLATFORM" --entrypoint bash "$IMAGE" -c "$1" 2>&1
}

section "image"
if [[ "${SKIP_BUILD:-false}" == "true" ]]; then
  ensure_image
else
  if ! build_image; then
    fail "image builds" "docker build failed" "$(tail -100 "$WORK/docker-build.log")"
    finish
  fi
fi
pass "image builds"
check "Appium runs as androidusr" "androidusr" "$(in_image 'id -un')"
# the versions of the Dockerfile are installed
appium_version="$(dockerfile_value 'FROM appium\/appium:v([0-9.]+)-[^ ]* AS appium')"
check "Appium ${appium_version} of the base image" "$appium_version" "$(in_image 'appium --version 2> /dev/null')"
drivers="$(in_image 'appium driver list --installed --json 2> /dev/null')"
for driver in uiautomator2 xcuitest; do
  version="$(dockerfile_value "appium driver install ${driver}@([0-9.]+)")"
  check "${driver} driver ${version}" "$version" \
    "$(printf '%s' "$drivers" | python3 -c "import json,sys; print(json.load(sys.stdin)['${driver}']['version'])" 2>&1)"
done
check "the tools of the scripts are installed" "" \
  "$(in_image 'for t in adb curl ffmpeg ffprobe idevice_id inotifywait jq nc pgrep socat usbreset healthcheck; do command -v $t > /dev/null || echo "missing $t"; done')"

# the patched files in the image are the files of the repo
sha256() {
  if command -v sha256sum > /dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi
}
expected="$(cd files/patch && find node_modules -type f -name '*.js' | sort | while read -r f; do sha256 "$f"; done)"
# the files of the repo over the installed ones in APPIUM_HOME
files="$(cd files/patch && find node_modules -type f -name '*.js' | sort | tr '\n' ' ')"
actual="$(in_image "cd \$APPIUM_HOME && sha256sum ${files}")"
check "the patched base-driver files are installed" "$expected" "$actual"

check "the scripts of the entrypoint are executable" "" \
  "$(in_image 'for f in /opt/entrypoint/entrypoint.sh /opt/debug.sh /opt/android.sh /opt/ios.sh /opt/start-capture-artifacts.sh /opt/zbr-config-gen.sh /opt/zbr-default-caps-gen.sh /usr/local/bin/healthcheck; do test -x $f || echo "not executable: $f"; done')"
check "the healthcheck is configured, with a start period for the startup" '["CMD","healthcheck"] 1m0s' \
  "$(docker image inspect "$IMAGE" --format '{{json .Config.Healthcheck.Test}} {{.Config.Healthcheck.StartPeriod}}')"
check "the image has the OCI labels" "https://github.com/zebrunner/appium dev" \
  "$(docker image inspect "$IMAGE" --format '{{index .Config.Labels "org.opencontainers.image.source"}} {{index .Config.Labels "org.opencontainers.image.version"}}')"
check "/var/run/usbmuxd links to a dir of androidusr" "/tmp/usbmuxd/usbmuxd androidusr" \
  "$(in_image 'echo "$(readlink /var/run/usbmuxd) $(stat -c %U /tmp/usbmuxd)"')"
check "the image is linux/amd64" "linux/amd64" "$(docker image inspect "$IMAGE" --format '{{.Os}}/{{.Architecture}}')"
if docker build --progress=plain --platform linux/arm64 --provenance=false --target appium "$REPO" > "$WORK/docker-build-arm64.log" 2>&1; then
  fail "a linux/arm64 build stops with the reason" "the build succeeded" "$(tail -20 "$WORK/docker-build-arm64.log")"
else
  check_contains "a linux/arm64 build stops with the reason" "the image is linux/amd64 only" "$(cat "$WORK/docker-build-arm64.log")"
fi

section "base image"
# the assumptions on the base image, Appium and the drivers that a new release may break silently;
# tests/image_checks.js runs the node based ones inside the image

# report_checks <output of tests/image_checks.js>: every line is a check
report_checks() {
  local result description details
  while IFS=$'\t' read -r result description details; do
    if [[ "$result" == "ok" ]]; then
      pass "$description"
    elif [[ "$result" == "fail" ]]; then
      fail "$description" "${details%%\\n*}" "$(printf '%b' "$details")"
    fi
  done <<< "$1"
}

base_image="$(dockerfile_value 'FROM ([^ ]+) AS appium')"
# A1: APPIUM_HOME is the Appium the image runs: the drivers and the patch are installed there
check "APPIUM_HOME is the Appium of the image" "$(in_image 'echo $APPIUM_HOME')" \
  "$(in_image 'dirname "$(readlink -f "$(command -v appium)")"')"
# A2: the entrypoint is PID 1 and gets SIGTERM, whatever the base image sets
check "no ENTRYPOINT runs the entrypoint (it is PID 1)" "null" "$(docker image inspect "$IMAGE" --format '{{json .Config.Entrypoint}}')"
check "the entrypoint is the command" '["/opt/entrypoint/entrypoint.sh"]' "$(docker image inspect "$IMAGE" --format '{{json .Config.Cmd}}')"
check "docker stop sends SIGTERM" "SIGTERM" "$(docker image inspect "$IMAGE" --format '{{or .Config.StopSignal "SIGTERM"}}')"
# A3: the volumes of the hosts (artifacts, app storage) are owned by this uid:gid
check "androidusr is 1300:1301 (the owner of the volumes of the hosts)" "androidusr 1300:1301" \
  "$(in_image 'echo "$(id -un) $(id -u):$(id -g)"')"
# A4: the patch is built for the Node of the image (scripts/build-patch.sh)
check "the patch is built with the Node major of the image" \
  "$(sed -n -E 's/^NODE_IMAGE="\$\{NODE_IMAGE:-node:([0-9]+)\}"$/\1/p' scripts/build-patch.sh)" \
  "$(in_image 'node -p "process.versions.node.split(\".\")[0]"')"

# B1: the patch is built from the sources of appium@<version>; its base driver must be the installed one
patched_version="$(curl -fsSL "https://raw.githubusercontent.com/appium/appium/appium@${appium_version}/packages/base-driver/package.json" |
  python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])' 2>&1)"
check "the installed @appium/base-driver is the one of the patch sources (appium@${appium_version})" "$patched_version" \
  "$(in_image 'node -p "require(process.env.APPIUM_HOME + \"/node_modules/@appium/base-driver/package.json\").version"')"
# B2: the patch replaces existing files of the base image, only the files new in the diff are added
diff_file="files/patch/appium-${appium_version//./_}.diff"
new_files="$(awk '/^diff --git/{new=0} /^new file mode/{new=1} new && /^\+\+\+ b\/packages\/base-driver\/lib\//{sub(/^\+\+\+ b\/packages\/base-driver\/lib\//,""); sub(/\.(ts|js)$/,".js"); print}' "$diff_file")"
replaced="$(cd files/patch/node_modules/@appium/base-driver/build/lib && find . -name '*.js' | sed 's|^\./||' | sort | grep -vxF "$new_files")"
docker pull --quiet --platform "$PLATFORM" "$base_image" > /dev/null 2>&1
missing="$(docker run --rm --platform "$PLATFORM" --entrypoint bash "$base_image" -c "
  cd \"\$(dirname \"\$(readlink -f \"\$(command -v appium)\")\")/node_modules/@appium/base-driver/build/lib\" &&
  for f in $(echo "$replaced" | tr '\n' ' '); do test -f \$f || echo \"\$f\"; done" 2>&1)"
check "the patched files replace existing files of ${base_image}" "" "$missing"

# in_checks_image <script> [image]: runs the script with tests/ as /checks and the installed drivers and plugins
# in /tmp/drivers.json and /tmp/plugins.json
in_checks_image() {
  docker run --rm --platform "$PLATFORM" --volume "$REPO/tests:/checks:ro" --entrypoint bash "${2:-$IMAGE}" -c "
    appium driver list --installed --json 2> /dev/null > /tmp/drivers.json
    appium plugin list --installed --json 2> /dev/null > /tmp/plugins.json
    $1" 2>&1
}
# B3, C1: the drivers (the plugin of the appium-image stage is checked with the stage below)
report_checks "$(in_checks_image 'node /checks/image_checks.js extensions /tmp/drivers.json /tmp/plugins.json')"
# C2: the generated default caps are known to the drivers and valid
for platform in android:uiautomator2 ios:xcuitest; do
  report_checks "$(in_checks_image "PLATFORM_NAME=${platform%%:*} DEVICE_UDID=udid-1 PLATFORM_VERSION=17.4 DEVICE_NAME=device \
    AUTOMATION_NAME=${platform#*:} /opt/zbr-default-caps-gen.sh > /tmp/caps.json &&
    node /checks/image_checks.js caps ${platform#*:} /tmp/caps.json < /tmp/drivers.json")"
done
# C3: the insecure features the entrypoint allows are used by a driver
features="$(grep -oE '\*:[a-z_]+' files/entrypoint.sh | sed 's/^\*://' | sort -u | tr '\n' ' ')"
report_checks "$(in_checks_image "node /checks/image_checks.js features ${features} < /tmp/drivers.json")"
# C4: the Android warning of android.sh matches the minimum Android of the UiAutomator2 driver
check "android.sh warns below the minimum Android of the UiAutomator2 driver" \
  "$(in_checks_image 'node /checks/image_checks.js min-android < /tmp/drivers.json')" \
  "$(sed -n -E 's/^MIN_ANDROID=([0-9]+)$/\1/p' files/module/android.sh)"

section "android module"
# android_module <release> <characteristics> <hardware>: AUTOMATION_NAME|DEVICETYPE|PLATFORM_VERSION|warning of
# files/module/android.sh with a fake adb (tests/fixtures/fake-adb); its background forwarding ends with the container
android_module() {
  docker run --rm --platform "$PLATFORM" --volume "$REPO/tests/fixtures/fake-adb:/tmp/fakebin/adb:ro" \
    --env FAKE_RELEASE="$1" --env FAKE_CHARACTERISTICS="$2" --env FAKE_HARDWARE="$3" --entrypoint bash "$IMAGE" -c '
    export PATH=/tmp/fakebin:$PATH
    . /opt/android.sh > /tmp/out 2>&1
    warning="$(grep -o "\[warn\] Android .* is not supported" /tmp/out)"
    echo "${AUTOMATION_NAME}|${DEVICETYPE}|${PLATFORM_VERSION}|${warning}"' 2>&1
}
check "Android 14 phone" "uiautomator2|Phone|14|" "$(android_module 14 phone generic)"
check "Android 13 tablet" "uiautomator2|Tablet|13|" "$(android_module 13 tablet generic)"
check "Android 12 tv" "uiautomator2|TV|12|" "$(android_module 12 tv generic)"
check "Android 11 default (a TV box)" "uiautomator2|TV|11|" "$(android_module 11 default generic)"
check "Android 11 redroid" "uiautomator2|Phone|11|" "$(android_module 11 default redroid)"
check "Android 8.1 is supported" "uiautomator2|Phone|8.1.0|" "$(android_module 8.1.0 phone generic)"
check "Android 7.1 is not supported by UiAutomator2" "uiautomator2|Phone|7.1.2|[warn] Android 7.1.2 is not supported" \
  "$(android_module 7.1.2 phone generic)"
check "Android 6 is not supported by UiAutomator2" "uiautomator2|Phone|6.0|[warn] Android 6.0 is not supported" \
  "$(android_module 6.0 phone generic)"

# chrome_warnings <WebView "package version"> <Chrome version> [docker args...]: the old Chrome / WebView warnings
# of files/module/android.sh with a fake adb
chrome_warnings() {
  docker run --rm --platform "$PLATFORM" --volume "$REPO/tests/fixtures/fake-adb:/tmp/fakebin/adb:ro" \
    --env FAKE_RELEASE=14 --env FAKE_CHARACTERISTICS=phone --env FAKE_WEBVIEW="$1" --env FAKE_CHROME="$2" "${@:3}" \
    --entrypoint bash "$IMAGE" -c '
    export PATH=/tmp/fakebin:$PATH
    . /opt/android.sh > /tmp/out 2>&1
    grep -o "\[warn\] .* is older than [0-9]*" /tmp/out | tr "\n" ";"' 2>&1
}
check "Chrome and WebView 120: no warning" "" "$(chrome_warnings "com.google.android.webview 120.0.6099.193" 120.0.6099.193)"
check "WebView 74: the Chrome and WebView sessions will fail" \
  "[warn] WebView com.google.android.webview 74 is older than 87;" "$(chrome_warnings "com.google.android.webview 74.0.3729.136" "")"
check "Chrome 74 with WebView 120: the Chrome sessions will fail" \
  "[warn] Chrome com.android.chrome 74 is older than 87;" "$(chrome_warnings "com.google.android.webview 120.0.6099.193" 74.0.3729.136)"
check "WebView 86 provided by Chrome 86 (Android 7-9): both warned" \
  "[warn] WebView com.android.chrome 86 is older than 87;[warn] Chrome com.android.chrome 86 is older than 87;" \
  "$(chrome_warnings "com.android.chrome 86.0.4240.198" 86.0.4240.198)"
check "no WebView provider and no Chrome: no warning" "" "$(chrome_warnings "" "")"
check "CHROME_OPTIONS without androidDevToolsPort: no warning" "" \
  "$(chrome_warnings "com.google.android.webview 74.0.3729.136" 74.0.3729.136 --env CHROME_OPTIONS=)"

section "ios module"
# ios_module <os name> <os version> [docker args...]: <exit status>|PLATFORM_VERSION|DEVICETYPE|<WDA error> of
# files/module/ios.sh with a fake WDA (tests/fixtures/fake-device.js) in the container
ios_module() {
  docker run --rm --platform "$PLATFORM" --volume "$REPO/tests/fixtures:/fixtures:ro" \
    --env FAKE_OS_NAME="$1" --env FAKE_OS_VERSION="$2" --env WDA_HOST=127.0.0.1 --env USBMUXD_SOCKET_ADDRESS= \
    "${@:3}" --entrypoint bash "$IMAGE" -c '
    node /fixtures/fake-device.js > /tmp/fake.log 2>&1 &
    for _ in $(seq 1 60); do curl -s -o /dev/null http://127.0.0.1:8100/status && break; sleep 0.5; done
    detected="$(. /opt/ios.sh > /tmp/out 2>&1; echo "${PLATFORM_VERSION}|${DEVICETYPE}")"
    status=$?
    echo "${status}|${detected:-|}|$(grep -o "No response from WDA" /tmp/out)"' 2>&1
}
check "iOS 17.4 iPhone" "0|17.4|Phone|" "$(ios_module iOS 17.4)"
check "iPadOS 17.4 is a tablet" "0|17.4|Tablet|" "$(ios_module iPadOS 17.4)"
check "tvOS 18.0" "0|18.0|tvOS|" "$(ios_module tvOS 18.0)"
check "no WDA in DEVICE_TIMEOUT: the startup stops" "1|||No response from WDA" \
  "$(ios_module iOS 17.4 --env WDA_PORT=9 --env DEVICE_TIMEOUT=3)"

section "healthcheck"
# healthcheck_with <appium up: yes|no> <device state> <state after adb reconnect>: <exit status>|<adb reconnects>
# of files/healthcheck with a fake adb (tests/fixtures/fake-adb) and a fake Appium status
healthcheck_with() {
  docker run --rm --platform "$PLATFORM" --volume "$REPO/tests/fixtures/fake-adb:/tmp/fakebin/adb:ro" \
    --env APPIUM_UP="$1" --env FAKE_STATE="$2" --env FAKE_RECONNECT_STATE="$3" --entrypoint bash "$IMAGE" -c '
    export PATH=/tmp/fakebin:$PATH
    if [[ "$APPIUM_UP" = yes ]]; then
      node -e "require(\"http\").createServer((req, res) => res.end(\"{}\")).listen(4723)" &
      for _ in $(seq 1 60); do curl -s -o /dev/null http://127.0.0.1:4723/ && break; sleep 0.5; done
    fi
    healthcheck > /dev/null 2>&1
    status=$?
    echo "${status}|$(cat /tmp/fake-adb.state.log 2> /dev/null | wc -l | tr -d " ")"' 2>&1
}
check "Appium does not answer: unhealthy" "1|0" "$(healthcheck_with no device device)"
check "the device is online: healthy" "0|0" "$(healthcheck_with yes device device)"
check "the device is offline and comes back on adb reconnect: healthy" "0|1" "$(healthcheck_with yes offline device)"
check "the device stays offline after adb reconnect: unhealthy" "1|1" "$(healthcheck_with yes offline offline)"

section "startup"
# the env vars of the appium container in zebrunner/mcloud-agent (roles/devices/templates/zebrunner-farm)
MCLOUD_AGENT_ENV="PLATFORM_NAME=android DEVICE_UDID=udid-1 DEVICE_NAME=Pixel RETAIN_TASK=true CONNECT_TO_GRID=true CUSTOM_NODE_CONFIG=true"
MCLOUD_AGENT_ENV+=" STF_PROVIDER_HOST=10.0.0.5 SELENIUM_HOST=hub SELENIUM_PORT=4444 DEFAULT_CAPABILITIES=true RELAXED_SECURITY=true"
MCLOUD_AGENT_ENV+=" ADB_PORT=5037 PROXY_PORT=8080 SERVER_PROXY_PORT=0 APPIUM_PORT=4723 REMOTE_ADB_HOST=connector"
# the variants: <id>|<name>|<env vars>, the container of a variant is ${PREFIX}-<id>;
# all containers are started at once, they are slow under emulation
variants=(
  "defaults|the image defaults|"
  "adb-shell|ADB_SHELL=true|CHROMEDRIVER_AUTODOWNLOAD=false ADB_SHELL=true"
  "features|CHROMEDRIVER_AUTODOWNLOAD=true and ADB_SHELL=true|CHROMEDRIVER_AUTODOWNLOAD=true ADB_SHELL=true"
  "relaxed|RELAXED_SECURITY=true|CHROMEDRIVER_AUTODOWNLOAD=false RELAXED_SECURITY=true"
  "mcloud|the mcloud-agent settings (android)|${MCLOUD_AGENT_ENV}"
  "caps|DEFAULT_CAPABILITIES=true without the grid (android)|DEFAULT_CAPABILITIES=true PLATFORM_NAME=android DEVICE_UDID=udid-1"
  "caps-no-platform|DEFAULT_CAPABILITIES=true without PLATFORM_NAME|DEFAULT_CAPABILITIES=true"
  "no-record|RECORD_ARTIFACTS=false|RECORD_ARTIFACTS=false"
  "grid|CONNECT_TO_GRID=true without CUSTOM_NODE_CONFIG|CONNECT_TO_GRID=true CUSTOM_NODE_CONFIG=false PLATFORM_NAME=android DEVICE_UDID=udid-1 SELENIUM_HOST=hub SELENIUM_PORT=4444 STF_PROVIDER_HOST=10.0.0.5"
)
for variant in "${variants[@]}"; do
  id="${variant%%|*}"
  env_args=()
  for var in ${variant##*|}; do
    env_args+=(--env "$var")
  done
  docker run --detach --name "${PREFIX}-${id}" --platform "$PLATFORM" "${env_args[@]}" "$IMAGE" > /dev/null
done
for variant in "${variants[@]}"; do
  id="${variant%%|*}"
  name="${variant#*|}"
  name="${name%%|*}"
  if wait_for 120 appium_up "${PREFIX}-${id}"; then
    pass "Appium starts with ${name}"
  else
    fail "Appium starts with ${name}" "no Appium status" \
      "$(printf 'state: %s\n%s' "$(docker inspect "${PREFIX}-${id}" --format '{{.State.Status}} {{.State.ExitCode}}')" "$(docker logs "${PREFIX}-${id}" 2>&1 | tail -15)")"
  fi
done

# use_variant <id>: sets VARIANT to the container of the variant when its Appium is up, an unknown id fails
use_variant() {
  VARIANT="${PREFIX}-$1"
  if [[ " ${variants[*]%%|*} " != *" $1 "* ]]; then
    fail "the variant $1 is declared" "unknown variant" "declared: ${variants[*]%%|*}"
    return 1
  fi
  appium_up "$VARIANT"
}

appium_cmdline() {
  docker exec "$1" bash -c 'tr "\0" " " < /proc/$(pgrep -f "node.*appium" | head -1)/cmdline'
}

if use_variant features; then
  enabled="$(docker exec "$VARIANT" grep -A2 'Explicitly enabling insecure features' /tmp/log/appium.log)"
  for feature in chromedriver_autodownload adb_shell; do
    check_contains "CHROMEDRIVER_AUTODOWNLOAD=true and ADB_SHELL=true: ${feature} is enabled" "[Appium]     *:${feature}" "$enabled"
  done
fi
if use_variant relaxed; then
  check_contains "RELAXED_SECURITY=true enables the relaxed security" "Enabling relaxed security" \
    "$(docker exec "$VARIANT" cat /tmp/log/appium.log)"
fi
if use_variant caps; then
  check_contains "DEFAULT_CAPABILITIES=true without the grid: the caps are passed" "--default-capabilities /opt/config/defaultcapabilities.json" \
    "$(appium_cmdline "$VARIANT")"
  check_contains "DEFAULT_CAPABILITIES=true without the grid: the caps of the device" '"appium:udid": "udid-1"' \
    "$(docker exec "$VARIANT" cat /opt/config/defaultcapabilities.json)"
fi
if use_variant caps-no-platform; then
  check_contains "DEFAULT_CAPABILITIES=true without PLATFORM_NAME: the missing caps are logged" \
    "no default capabilities for PLATFORM_NAME=" "$(docker logs "$VARIANT" 2>&1)"
fi
if use_variant grid; then
  check_contains "CONNECT_TO_GRID=true without CUSTOM_NODE_CONFIG: the Zebrunner node config" \
    '"proxy": "com.zebrunner.mcloud.grid.MobileRemoteProxy"' "$(docker exec "$VARIANT" cat /opt/config/nodeconfig.json)"
  check_contains "CONNECT_TO_GRID=true without CUSTOM_NODE_CONFIG: the ignored flag is logged" \
    "CUSTOM_NODE_CONFIG is ignored" "$(docker logs "$VARIANT" 2>&1)"
fi

# shellcheck disable=SC2329
artifact_shared() {
  docker exec "$1" test -f "/tmp/log/.artifact-$2"
}
if use_variant no-record; then
  # a session of the patched driver: its marker is created and deleted
  docker exec "$VARIANT" bash -c 'touch /tmp/log/.recording-artifact-s1; sleep 3; rm /tmp/log/.recording-artifact-s1'
  if wait_for 60 artifact_shared "$VARIANT" s1; then
    check "RECORD_ARTIFACTS=false: the session log is shared" "yes" \
      "$(docker exec "$VARIANT" bash -c 'test -s /tmp/log/s1/session.log && echo yes || echo no')"
    check "RECORD_ARTIFACTS=false: no video" "no" "$(docker exec "$VARIANT" bash -c 'test -e /tmp/log/s1/video.mp4 && echo yes || echo no')"
    check_contains "RECORD_ARTIFACTS=false: the recording is skipped" "recording artifacts was disabled" "$(docker logs "$VARIANT" 2>&1)"
  else
    fail "RECORD_ARTIFACTS=false: the artifacts are shared" "no /tmp/log/.artifact-s1" "$(docker logs "$VARIANT" 2>&1 | tail -15)"
  fi

  # without ffmpeg (RECORD_ARTIFACTS=false) the video files of the sessions are put by the test: an ffmpeg output
  # without frames (36 bytes) is not shared, a real video is
  docker exec "$VARIANT" bash -c 'head -c 36 /dev/zero > /tmp/s2.mp4; head -c 4096 /dev/zero > /tmp/s3.mp4
    touch /tmp/log/.recording-artifact-s2 /tmp/log/.recording-artifact-s3; sleep 2
    rm /tmp/log/.recording-artifact-s2 /tmp/log/.recording-artifact-s3'
  if wait_for 60 artifact_shared "$VARIANT" s2 && wait_for 60 artifact_shared "$VARIANT" s3; then
    check "a video without frames (36 bytes) is not shared and removed" "no|no" \
      "$(docker exec "$VARIANT" bash -c 'echo "$(test -e /tmp/log/s2/video.mp4 && echo yes || echo no)|$(test -e /tmp/s2.mp4 && echo yes || echo no)"')"
    check_contains "a video without frames is logged" "video for s2 is 36 bytes (no frames captured)" "$(docker logs "$VARIANT" 2>&1)"
    check "a video of 4 KB is shared" "4096" "$(docker exec "$VARIANT" bash -c 'wc -c < /tmp/log/s3/video.mp4' 2>&1 | tr -d ' ')"
  else
    fail "the video files of the sessions are handled" "no /tmp/log/.artifact-s2 or -s3" "$(docker logs "$VARIANT" 2>&1 | tail -15)"
  fi
fi

# APPIUM_CLI with several arguments reaches Appium as separate arguments
container="${PREFIX}-cli"
docker run --detach --name "$container" --platform "$PLATFORM" \
  --env "APPIUM_CLI=--session-override --keep-alive-timeout 700" "$IMAGE" > /dev/null
if wait_for 120 appium_up "$container"; then
  check_contains "APPIUM_CLI with several arguments reaches Appium" "--session-override --keep-alive-timeout 700" "$(appium_cmdline "$container")"
else
  fail "APPIUM_CLI with several arguments reaches Appium" "no Appium status" "$(docker logs "$container" 2>&1 | tail -15)"
fi

# a wrong config ends the container with the reason instead of a failing Appium
container="${PREFIX}-grid-without-hub"
docker run --detach --name "$container" --platform "$PLATFORM" --env CONNECT_TO_GRID=true --env PLATFORM_NAME=android \
  --env DEVICE_UDID=udid-1 "$IMAGE" > /dev/null
if wait_for 120 container_exited "$container"; then
  check "CONNECT_TO_GRID=true without the hub: the container exits with 1" "1" "$(docker inspect "$container" --format '{{.State.ExitCode}}')"
  check_contains "CONNECT_TO_GRID=true without the hub: the missing variables are logged" \
    "[error] CONNECT_TO_GRID=true needs: SELENIUM_HOST SELENIUM_PORT STF_PROVIDER_HOST" "$(docker logs "$container" 2>&1)"
else
  fail "CONNECT_TO_GRID=true without the hub: the container exits" "the container is still running" "$(docker logs "$container" 2>&1 | tail -15)"
fi

if use_variant defaults; then
  cmdline="$(appium_cmdline "$VARIANT")"
  check_contains "Appium listens on APPIUM_PORT with the /wd/hub base path" "-pa /wd/hub --port 4723" "$cmdline"
  check_contains "Appium logs into TASK_LOG" "--log /tmp/log/appium.log" "$cmdline"
  check "the healthcheck passes" "0" "$(
    docker exec "$VARIANT" healthcheck > /dev/null 2>&1
    echo $?
  )"

  section "shutdown"
  start=$SECONDS
  docker stop --time 30 "$VARIANT" > /dev/null
  elapsed=$((SECONDS - start))
  if [[ "$elapsed" -lt 15 ]]; then
    pass "docker stop shuts the container down without the kill timeout"
  else
    fail "docker stop shuts the container down without the kill timeout" "took ${elapsed}s" "SIGTERM was not handled, docker stop waited ${elapsed}s"
  fi
  check_contains "the SIGTERM handler runs" "on finish end" "$(docker logs "$VARIANT" 2>&1 | tail -20)"
  check_contains "docker stop without a session shares nothing" "no active recordings on finish" \
    "$(docker logs "$VARIANT" 2>&1 | tail -20)"
else
  fail "Appium starts for the runtime checks" "no Appium status" "$(docker logs "$VARIANT" 2>&1 | tail -15)"
fi

# the restart policy of mcloud-agent (on-failure) restarts the container when Appium exits
if use_variant features; then
  docker exec "$VARIANT" bash -c 'kill -9 $(pgrep -f "node.*appium" | head -1)'
  if wait_for 30 container_exited "$VARIANT"; then
    pass "the exit of Appium stops the container"
    check "the exit status of the container is non-zero" "1" "$(docker inspect "$VARIANT" --format '{{.State.ExitCode}}')"
  else
    fail "the exit of Appium stops the container" "the container is still running" "$(docker logs "$VARIANT" 2>&1 | tail -15)"
  fi
fi

if [[ "${SKIP_PLUGIN_IMAGE:-false}" != "true" ]]; then
  section "appium-image stage"
  if docker build --progress=plain --platform "$PLATFORM" --provenance=false --tag "${IMAGE}-images" "$REPO" > "$WORK/docker-build-images.log" 2>&1; then
    pass "the appium-image stage builds (with the sharp check)"
    images_version="$(dockerfile_value 'appium plugin install images@([0-9.]+)')"
    check "the images plugin ${images_version} is installed" "$images_version" \
      "$(docker run --rm --platform "$PLATFORM" --entrypoint appium "${IMAGE}-images" plugin list --installed --json 2> /dev/null |
        python3 -c 'import json,sys; print(json.load(sys.stdin)["images"]["version"])' 2>&1)"
    # C1: the plugin is installed in APPIUM_HOME and supports the Appium version
    report_checks "$(in_checks_image 'echo "{}" > /tmp/drivers.json && node /checks/image_checks.js extensions /tmp/drivers.json /tmp/plugins.json' "${IMAGE}-images")"
    # APPIUM_PLUGINS=images of the stage reaches Appium
    container="${PREFIX}-images"
    docker run --detach --name "$container" --platform "$PLATFORM" "${IMAGE}-images" > /dev/null
    if wait_for 120 appium_up "$container"; then
      check_contains "APPIUM_PLUGINS=images: the plugin is active" "images@${images_version} (ACTIVE)" \
        "$(docker exec "$container" cat /tmp/log/appium.log)"
    else
      fail "APPIUM_PLUGINS=images: the plugin is active" "no Appium status" "$(docker logs "$container" 2>&1 | tail -15)"
    fi
  else
    fail "the appium-image stage builds (with the sharp check)" "docker build failed" "$(tail -60 "$WORK/docker-build-images.log")"
  fi
fi

finish
