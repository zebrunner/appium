#!/bin/bash
# Checks of build.sh with a fake docker command: arguments of the build and its result reporting.
source "$(dirname "$0")/lib.sh"
cd "$REPO" || exit 1

mkdir -p "$WORK/bin"
# the fake docker logs its arguments and exits with FAKE_DOCKER_STATUS
cat > "$WORK/bin/docker" << 'EOF'
#!/bin/bash
echo "$*" > "$FAKE_DOCKER_ARGS"
exit "${FAKE_DOCKER_STATUS:-0}"
EOF
chmod +x "$WORK/bin/docker"
export FAKE_DOCKER_ARGS="$WORK/docker-args"

# run_build <docker status> <build.sh args...>: sets OUT, STATUS and ARGS; the prompt is confirmed via stdin
run_build() {
  rm -f "$FAKE_DOCKER_ARGS"
  OUT="$(echo | FAKE_DOCKER_STATUS="$1" PATH="$WORK/bin:$PATH" ./build.sh "${@:2}" 2>&1)"
  STATUS=$?
  ARGS="$(cat "$FAKE_DOCKER_ARGS" 2> /dev/null)"
}

section "usage"
run_build 0
check "no tag: exit status 1" "1" "$STATUS"
check_contains "no tag: usage is printed" "Usage:" "$OUT"
check "no tag: docker is not called" "" "$ARGS"

section "arguments"
run_build 0 1.2.3
check_contains "the tag is passed" "--tag public.ecr.aws/zebrunner/appium:1.2.3" "$ARGS"
check_contains "the tag is the version label of the image" "--build-arg VERSION=1.2.3" "$ARGS"
check_contains "the appium stage is built by default" "--target appium" "$ARGS"
check_contains "linux/amd64 is the default platform" "--platform linux/amd64" "$ARGS"
check_contains "no provenance manifest, the image stays pullable" "--provenance=false" "$ARGS"

run_build 0 -i 1.2.3-img
check_contains "-i: the tag is passed" "--tag public.ecr.aws/zebrunner/appium:1.2.3-img" "$ARGS"
if [[ "$ARGS" == *"--target"* ]]; then
  fail "-i: the last (appium-image) stage is built" "--target is set" "$ARGS"
else
  pass "-i: the last (appium-image) stage is built"
fi

OUT="$(echo | BUILD_PLATFORM=linux/arm64 PATH="$WORK/bin:$PATH" ./build.sh 1.2.3 2>&1)"
STATUS=$?
rm -f "$FAKE_DOCKER_ARGS"
check "BUILD_PLATFORM=linux/arm64: exit status 1" "1" "$STATUS"
check_contains "BUILD_PLATFORM=linux/arm64: the reason is printed" "the image is linux/amd64 only" "$OUT"
check "BUILD_PLATFORM=linux/arm64: docker is not called" "" "$(cat "$FAKE_DOCKER_ARGS" 2> /dev/null)"
ARGS_PLATFORM="$(
  rm -f "$FAKE_DOCKER_ARGS"
  echo | BUILD_PLATFORM=linux/amd64 PATH="$WORK/bin:$PATH" ./build.sh 1.2.3 > /dev/null 2>&1
  cat "$FAKE_DOCKER_ARGS"
)"
check_contains "BUILD_PLATFORM=linux/amd64 is accepted" "--platform linux/amd64" "$ARGS_PLATFORM"

rm -f "$FAKE_DOCKER_ARGS"
OUT="$(echo | IMAGE_REPO=registry.example.com/appium PATH="$WORK/bin:$PATH" ./build.sh 1.2.3 2>&1)"
check_contains "IMAGE_REPO: another repository of the image" "--tag registry.example.com/appium:1.2.3" "$(cat "$FAKE_DOCKER_ARGS")"

section "make build and push"
# make_args <make args...>: the arguments of the last docker call of the make target, the docker of the stub
make_args() {
  rm -f "$FAKE_DOCKER_ARGS"
  PATH="$WORK/bin:$PATH" make --no-print-directory "$@" > "$WORK/make.out" 2>&1
  cat "$FAKE_DOCKER_ARGS" 2> /dev/null
}
ARGS="$(make_args build VERSION=1.2.3)"
check_contains "make build: build.sh builds the appium stage" "--target appium --tag public.ecr.aws/zebrunner/appium:1.2.3" "$ARGS"
ARGS="$(make_args build VERSION=1.2.3-img TARGET=appium-image)"
check_contains "make build TARGET=appium-image: the last stage" "--tag public.ecr.aws/zebrunner/appium:1.2.3-img" "$ARGS"
check_not_contains "make build TARGET=appium-image: no target" "--target" "$ARGS"
ARGS="$(make_args build VERSION=1.2.3 IMAGE_REPO=registry.example.com/appium)"
check_contains "make build IMAGE_REPO: another repository" "--tag registry.example.com/appium:1.2.3" "$ARGS"
ARGS="$(make_args push)"
check "make push without VERSION: no docker call" "" "$ARGS"
check_contains "make push without VERSION: the tag is asked" "make push VERSION=<tag>" "$(cat "$WORK/make.out")"
ARGS="$(make_args push VERSION=1.2.3)"
check "make push: buildx builds linux/amd64 and pushes" \
  "buildx build --builder mcloud --progress=plain --provenance=false --platform linux/amd64 --target appium --build-arg VERSION=1.2.3 --tag public.ecr.aws/zebrunner/appium:1.2.3 --push ." \
  "$ARGS"
ARGS="$(make_args build VERSION=1.2.3 TARGET=other)"
check "make build of an unknown TARGET: no docker call" "" "$ARGS"

section "result"
run_build 0 1.2.3
check "successful build: exit status 0" "0" "$STATUS"
check_contains "successful build is reported" "Successfully built" "$OUT"

run_build 1 1.2.3
check_contains "failed build is reported" "Build failed" "$OUT"
if [[ "$OUT" == *"Successfully built"* ]]; then
  fail "failed build is not reported as successful" "'Successfully built' is printed" "$OUT"
else
  pass "failed build is not reported as successful"
fi
if [[ "$STATUS" -ne 0 ]]; then
  pass "failed build: non-zero exit status"
else
  fail "failed build: non-zero exit status" "exit status 0" "$OUT"
fi

finish
