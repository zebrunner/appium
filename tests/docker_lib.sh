#!/bin/bash
# Shared helpers of the docker test scripts, sourced after lib.sh.
# IMAGE overrides the tag of the tested image, PLATFORM its platform (the image is amd64 only, as its base image).

# used by the scripts sourcing this file
# shellcheck disable=SC2034
IMAGE="${IMAGE:-zbr-appium:test}"
PLATFORM="${PLATFORM:-linux/amd64}"

require_cmd docker
docker info > /dev/null 2>&1 || skip "requires a running docker daemon"

# build_image: builds the appium stage of the Dockerfile as IMAGE, the log is in $WORK/docker-build.log
build_image() {
  docker build --progress=plain --platform "$PLATFORM" --provenance=false --target appium --tag "$IMAGE" "$REPO" \
    > "$WORK/docker-build.log" 2>&1
}

# ensure_image: builds IMAGE when it is missing or REBUILD=true, a failed build ends the script
ensure_image() {
  if [[ "${REBUILD:-false}" != "true" ]] && docker image inspect "$IMAGE" > /dev/null 2>&1; then
    return 0
  fi
  if ! build_image; then
    fail "image builds" "docker build failed" "$(tail -100 "$WORK/docker-build.log")"
    finish
  fi
}

# the helpers below are used by the scripts sourcing this file, also through wait_for
# shellcheck disable=SC2329
# appium_up <container>: Appium of the container answers its status
appium_up() {
  [[ "$(docker exec "$1" curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4723/wd/hub/status 2> /dev/null)" == "200" ]]
}

# shellcheck disable=SC2329
container_running() {
  [[ "$(docker inspect "$1" --format '{{.State.Running}}' 2> /dev/null)" == "true" ]]
}

# shellcheck disable=SC2329
container_exited() {
  [[ "$(docker inspect "$1" --format '{{.State.Running}}' 2> /dev/null)" == "false" ]]
}

# dockerfile_value <sed -E regex with one group>: the group of the first Dockerfile line matching the regex
dockerfile_value() {
  sed -n -E "s/^.*$1.*$/\1/p" "$REPO/Dockerfile" | head -1
}

# wait_for <seconds> <command...>: retries the command every second until it succeeds
wait_for() {
  local deadline=$((SECONDS + $1))
  while [[ $SECONDS -lt $deadline ]]; do
    "${@:2}" > /dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}
