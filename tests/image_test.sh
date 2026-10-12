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
check "Appium 3.1.1" "3.1.1" "$(in_image 'appium --version 2> /dev/null')"
drivers="$(in_image 'appium driver list --installed --json 2> /dev/null')"
check "uiautomator2 driver 6.7.15" "6.7.15" \
  "$(printf '%s' "$drivers" | python3 -c 'import json,sys; print(json.load(sys.stdin)["uiautomator2"]["version"])' 2>&1)"
check "xcuitest driver 10.18.2" "10.18.2" \
  "$(printf '%s' "$drivers" | python3 -c 'import json,sys; print(json.load(sys.stdin)["xcuitest"]["version"])' 2>&1)"
check_contains "go-ios v1.0.204" '"version":"v1.0.204"' "$(in_image 'ios --version')"
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
# files/entrypoint.sh: CONNECT_TO_GRID without CUSTOM_NODE_CONFIG and ATD=true
for file in /root/generate_config.sh /root/RemoteAppiumManager.jar; do
  check "${file} used by the entrypoint exists" "present" \
    "$(docker run --rm --platform "$PLATFORM" --user root --entrypoint bash "$IMAGE" -c "test -e ${file} && echo present || echo absent")"
done
check "the healthcheck is configured" '["CMD","healthcheck"]' \
  "$(docker image inspect "$IMAGE" --format '{{json .Config.Healthcheck.Test}}')"
check "the image is linux/amd64" "linux/amd64" "$(docker image inspect "$IMAGE" --format '{{.Os}}/{{.Architecture}}')"

section "startup"
# the env vars of the appium container in zebrunner/mcloud-agent (roles/devices/templates/zebrunner-farm)
MCLOUD_AGENT_ENV="PLATFORM_NAME=android DEVICE_UDID=udid-1 DEVICE_NAME=Pixel RETAIN_TASK=true CONNECT_TO_GRID=true CUSTOM_NODE_CONFIG=true"
MCLOUD_AGENT_ENV+=" STF_PROVIDER_HOST=10.0.0.5 SELENIUM_HOST=hub SELENIUM_PORT=4444 DEFAULT_CAPABILITIES=true RELAXED_SECURITY=true"
MCLOUD_AGENT_ENV+=" ADB_PORT=5037 PROXY_PORT=8080 SERVER_PROXY_PORT=0 APPIUM_PORT=4723 REMOTE_ADB_HOST=connector"
# the variants: <name>|<env vars>; all containers are started at once, they are slow under emulation
variants=(
  "the image defaults|"
  "CHROMEDRIVER_AUTODOWNLOAD=false|CHROMEDRIVER_AUTODOWNLOAD=false"
  "ADB_SHELL=true|CHROMEDRIVER_AUTODOWNLOAD=false ADB_SHELL=true"
  "RELAXED_SECURITY=true|CHROMEDRIVER_AUTODOWNLOAD=false RELAXED_SECURITY=true"
  "APPIUM_CLI|CHROMEDRIVER_AUTODOWNLOAD=false APPIUM_CLI=--session-override"
  "the mcloud-agent settings (android)|${MCLOUD_AGENT_ENV}"
  "the mcloud-agent settings (android) and CHROMEDRIVER_AUTODOWNLOAD=false|${MCLOUD_AGENT_ENV} CHROMEDRIVER_AUTODOWNLOAD=false"
)
i=0
for variant in "${variants[@]}"; do
  env_args=()
  for var in ${variant#*|}; do
    env_args+=(--env "$var")
  done
  docker run --detach --name "${PREFIX}-${i}" --platform "$PLATFORM" "${env_args[@]}" "$IMAGE" > /dev/null
  i=$((i + 1))
done

appium_status() {
  docker exec "$1" curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4723/wd/hub/status 2> /dev/null
}
i=0
for variant in "${variants[@]}"; do
  name="${variant%%|*}"
  container="${PREFIX}-${i}"
  i=$((i + 1))
  if wait_for 120 bash -c "[[ \$(docker exec ${container} curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4723/wd/hub/status) == 200 ]]"; then
    pass "Appium starts with ${name}"
  else
    fail "Appium starts with ${name}" "no Appium status" \
      "$(printf 'state: %s\n%s' "$(docker inspect "$container" --format '{{.State.Status}} {{.State.ExitCode}}')" "$(docker logs "$container" 2>&1 | tail -15)")"
  fi
done

container="${PREFIX}-1"
if [[ "$(appium_status "$container")" == "200" ]]; then
  cmdline="$(docker exec "$container" bash -c 'tr "\0" " " < /proc/$(pgrep -f "node.*appium" | head -1)/cmdline')"
  check_contains "Appium listens on APPIUM_PORT with the /wd/hub base path" "-pa /wd/hub --port 4723" "$cmdline"
  check_contains "Appium logs into TASK_LOG" "--log /tmp/log/appium.log" "$cmdline"
  check "the healthcheck passes" "0" "$(
    docker exec "$container" healthcheck > /dev/null 2>&1
    echo $?
  )"

  section "shutdown"
  start=$SECONDS
  docker stop --time 30 "$container" > /dev/null
  elapsed=$((SECONDS - start))
  if [[ "$elapsed" -lt 15 ]]; then
    pass "docker stop shuts the container down without the kill timeout"
  else
    fail "docker stop shuts the container down without the kill timeout" "took ${elapsed}s" "SIGTERM was not handled, docker stop waited ${elapsed}s"
  fi
  check_contains "the SIGTERM handler runs" "on finish end" "$(docker logs "$container" 2>&1 | tail -20)"
else
  fail "Appium starts for the runtime checks" "no Appium status" "$(docker logs "$container" 2>&1 | tail -15)"
fi

if [[ "${SKIP_PLUGIN_IMAGE:-false}" != "true" ]]; then
  section "appium-image stage"
  if docker build --progress=plain --platform "$PLATFORM" --provenance=false --tag "${IMAGE}-images" "$REPO" > "$WORK/docker-build-images.log" 2>&1; then
    pass "the appium-image stage builds (with the sharp check)"
    check "the images plugin 4.1.0 is installed" "4.1.0" \
      "$(docker run --rm --platform "$PLATFORM" --entrypoint appium "${IMAGE}-images" plugin list --installed --json 2> /dev/null |
        python3 -c 'import json,sys; print(json.load(sys.stdin)["images"]["version"])' 2>&1)"
  else
    fail "the appium-image stage builds (with the sharp check)" "docker build failed" "$(tail -60 "$WORK/docker-build-images.log")"
  fi
fi

finish
