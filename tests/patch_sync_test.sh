#!/bin/bash
# Checks that the js files of the image (files/patch/node_modules) are the build of the patch diff
# (files/patch/appium-<version>.diff): scripts/build-patch.sh builds them anew and they are compared file by file.
# After a change of the diff, `make patch-build` updates the js files.
source "$(dirname "$0")/lib.sh"
require_cmd docker
docker info > /dev/null 2>&1 || skip "requires a running docker daemon"
cd "$REPO" || exit 1

TARGET="files/patch/node_modules/@appium/base-driver/build/lib"

section "build"
if ! scripts/build-patch.sh --out "$WORK/built" > "$WORK/build.log" 2>&1; then
  fail "the patch diff applies to the Appium sources and builds" "scripts/build-patch.sh failed" "$(tail -40 "$WORK/build.log")"
  finish
fi
pass "the patch diff applies to the Appium sources and builds"

section "files"
expected="$(cd "$WORK/built" && find . -name '*.js' -type f | sed 's|^\./||' | sort)"
actual="$(cd "$TARGET" && find . -name '*.js' -type f | sed 's|^\./||' | sort)"
check "a js file for every patched source and nothing else" "$expected" "$actual"
for file in $expected; do
  if [[ -f "$TARGET/$file" ]] && cmp -s "$WORK/built/$file" "$TARGET/$file"; then
    pass "${file} is the build of the diff"
  else
    fail "${file} is the build of the diff" "differs from the build" \
      "$(
        diff "$WORK/built/$file" "$TARGET/$file" 2>&1 | head -30
        echo "run 'make patch-build' after a change of the diff"
      )"
  fi
done

finish
