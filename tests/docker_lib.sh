#!/bin/bash
# Shared helpers of the docker test scripts, sourced after lib.sh.
# IMAGE overrides the tag of the tested image, PLATFORM its platform (the image is amd64 only: go-ios ios-amd64).

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

# wait_for <seconds> <command...>: retries the command every second until it succeeds
wait_for() {
  local deadline=$((SECONDS + $1))
  while [[ $SECONDS -lt $deadline ]]; do
    "${@:2}" > /dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}
