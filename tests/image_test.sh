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
go_ios_version="$(dockerfile_value 'ARG GO_IOS_VERSION=([^ ]+)')"
check_contains "go-ios ${go_ios_version}" "\"version\":\"${go_ios_version}\"" "$(in_image 'ios --version')"
check "the tools of the scripts are installed" "" \
  "$(in_image 'for t in adb curl ffmpeg ffprobe idevice_id inotifywait jq nc pgrep socat usbreset healthcheck; do command -v $t > /dev/null || echo "missing $t"; done')"

# the patched files in the image are the files of the repo
sha256() {
  if command -v sha256sum > /dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi
}
expected="$(cd files/patch && find node_modules -type f -name '*.js' | sort | while read -r f; do sha256 "$f"; done)"
actual="$(in_image 'cd /usr/lib/node_modules/appium && find /opt/mcloud/node_modules -type f -name "*.js" | sed "s|/opt/mcloud/||" | sort | xargs sha256sum')"
check "the patched base-driver files are installed" "$expected" "$actual"

check "the scripts of the entrypoint are executable" "" \
  "$(in_image 'for f in /opt/entrypoint/entrypoint.sh /opt/debug.sh /opt/android.sh /opt/ios.sh /opt/start-capture-artifacts.sh /opt/zbr-config-gen.sh /opt/zbr-default-caps-gen.sh /usr/local/bin/healthcheck; do test -x $f || echo "not executable: $f"; done')"
check "the healthcheck is configured" '["CMD","healthcheck"]' \
  "$(docker image inspect "$IMAGE" --format '{{json .Config.Healthcheck.Test}}')"
check "/var/run/usbmuxd links to a dir of androidusr" "/tmp/usbmuxd/usbmuxd androidusr" \
  "$(in_image 'echo "$(readlink /var/run/usbmuxd) $(stat -c %U /tmp/usbmuxd)"')"
check "the image is linux/amd64" "linux/amd64" "$(docker image inspect "$IMAGE" --format '{{.Os}}/{{.Architecture}}')"
if docker build --progress=plain --platform linux/arm64 --provenance=false --target appium "$REPO" > "$WORK/docker-build-arm64.log" 2>&1; then
  fail "a linux/arm64 build stops with the reason" "the build succeeded" "$(tail -20 "$WORK/docker-build-arm64.log")"
else
  check_contains "a linux/arm64 build stops with the reason" "the image is linux/amd64 only" "$(cat "$WORK/docker-build-arm64.log")"
fi

# the generated default caps pass the validation of the installed drivers without type warnings
# validate_caps <platform> <automation> <driver package> <driver class>: "valid" or the warnings and errors
validate_caps() {
  docker run --rm --platform "$PLATFORM" --env PLATFORM_NAME="$1" --env AUTOMATION_NAME="$2" --env DEVICE_UDID=udid-1 \
    --env PLATFORM_VERSION=17.4 --env DEVICE_NAME=device --entrypoint bash "$IMAGE" -c "
    /opt/zbr-default-caps-gen.sh > /tmp/caps.json
    cd /usr/lib/node_modules/appium/node_modules/$3 && node -e '
      const caps = require(\"/tmp/caps.json\");
      const plain = Object.fromEntries(Object.entries(caps).map(([k, v]) => [k.replace(/^appium:/, \"\"), v]));
      new (require(\".\").$4)({}).validateDesiredCaps(plain);
    '" 2>&1 | grep -E "as string|Error" || echo "valid"
}
check "the default caps of iOS are valid for XCUITest" "valid" \
  "$(validate_caps ios XCUITest appium-xcuitest-driver XCUITestDriver)"
check "the default caps of Android are valid for UiAutomator2" "valid" \
  "$(validate_caps android uiautomator2 appium-uiautomator2-driver AndroidUiautomator2Driver)"

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
  else
    fail "the appium-image stage builds (with the sharp check)" "docker build failed" "$(tail -60 "$WORK/docker-build-images.log")"
  fi
fi

finish
