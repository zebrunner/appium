#!/bin/bash
# shellcheck disable=SC2034
# The settings and the checks of the project for tests/lint.sh (CONVENTIONS.md): appium.

scripts=(build.sh scripts/*.sh tests/fixtures/fake-adb files/entrypoint.sh files/healthcheck files/config/*.sh files/module/*.sh
  files/util/*.sh files/util/xcrun tests/*.sh)
generated=(files/patch)

# project_checks: the versions of the image in the README, the JavaScript of the tests and the Appium patch
project_checks() {
  section "image contents"
  # the versions of the Dockerfile are listed in the README (Image contents)
  for pattern in 'FROM (appium\/appium:v[^ ]+) AS appium' 'appium driver install uiautomator2@([0-9.]+)' \
    'appium driver install xcuitest@([0-9.]+)' 'appium plugin install images@([0-9.]+)' 'sharp@([0-9.]+)'; do
    version="$(sed -n -E "s/^.*${pattern}.*$/\1/p" Dockerfile | head -1)"
    if [[ -n "$version" ]] && grep -qF "$version" README.md; then
      pass "README lists ${version}"
    else
      fail "README lists the Dockerfile version of '${pattern}'" "'${version}' is missing in README.md" "update the Image contents of README.md"
    fi
  done
  # the Appium version of the base image is the only one mentioned
  base_image="$(sed -n -E 's/^FROM ([^ ]+) AS appium$/\1/p' Dockerfile)"
  appium_version="$(sed -n -E 's/^FROM appium\/appium:v([0-9.]+)-[^ ]* AS appium$/\1/p' Dockerfile)"
  docs=(README.md scripts/*.sh tests/*.sh tests/patch/*.mjs Makefile)
  check "README and the scripts mention only the base image ${base_image}" "" \
    "$(grep -noE 'appium/appium:v[0-9][^ `)]*' "${docs[@]}" | grep -vF ":${base_image}")"
  check "README and the scripts mention only Appium ${appium_version}" "" \
    "$(grep -noE '(Appium |appium@)[0-9]+\.[0-9]+\.[0-9]+' "${docs[@]}" | grep -vE "(Appium |appium@)${appium_version//./\\.}$")"
  check "README and the scripts mention only the patch diff of Appium ${appium_version}" "" \
    "$(grep -noE 'appium-[0-9]+_[0-9]+_[0-9]+\.diff' "${docs[@]}" | grep -vF "appium-${appium_version//./_}.diff")"

  section "javascript"
  for script in tests/image_checks.js tests/fixtures/fake-device.js tests/patch/*.mjs; do
    run_check "node --check ${script}" node --check "$script"
  done

  section "patch"
  # the .diff is the reviewable source of the patched build/lib/*.js files, both are kept in the repo
  # shellcheck disable=SC2016
  run_check "node --check of the patched js files" bash -c \
    'for f in files/patch/node_modules/@appium/base-driver/build/lib/*/*.js; do node --check "$f" || exit 1; done'
  # the diff of the Appium version of the base image is the only one
  diff_file="files/patch/appium-${appium_version//./_}.diff"
  check "the patch diff is the one of Appium ${appium_version} of the base image" "$diff_file" "$(ls files/patch/appium-*.diff)"
  run_check "the patch diff is well-formed" git apply --stat "$diff_file"
  check "no non-ASCII characters in the patched js code" "" \
    "$(LC_ALL=C grep -sn '[^[:print:][:space:]]' files/patch/node_modules/@appium/base-driver/build/lib/*/*.js "$diff_file")"
}
