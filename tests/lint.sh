#!/bin/bash
# Static checks of the project files, every linter run is a check (also in JUnit XML with JUNIT_DIR);
# the tools: pip install -r tests/requirements-lint.txt (hadolint on macOS: brew install hadolint)
source "$(dirname "$0")/lib.sh"
cd "$REPO" || exit 1

missing=""
for tool in actionlint hadolint pymarkdown shellcheck shfmt yamllint; do
  command -v "$tool" > /dev/null 2>&1 || missing="${missing} ${tool}"
done
if [[ -n "$missing" ]]; then
  fail "lint tools are installed" "missing:${missing}" \
    "missing tools:${missing} (pip install -r tests/requirements-lint.txt, hadolint on macOS: brew install hadolint)"
  finish
fi

section "yaml"
run_check "yamllint" yamllint --strict .

section "GitHub workflows"
run_check "actionlint" actionlint

section "Dockerfile"
run_check "hadolint" hadolint Dockerfile

section "markdown"
run_check "pymarkdown" pymarkdown scan README.md

section "README"
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
# every env var of the Dockerfile is documented
env_vars="$(sed -n -E 's/^(ENV)?[[:space:]]+([A-Z][A-Z0-9_]*)=.*/\2/p; s/^ENV ([A-Z][A-Z0-9_]*)=.*/\1/p' Dockerfile | sort -u)"
check "README documents every env var of the Dockerfile" "" \
  "$(for var in $env_vars; do grep -qF "\`${var}\`" README.md || echo "${var} is missing in README.md"; done)"

section "shell"
scripts=(build.sh scripts/*.sh tests/fixtures/fake-adb files/entrypoint.sh files/healthcheck files/config/*.sh files/module/*.sh files/util/debug.sh tests/*.sh)
for script in "${scripts[@]}"; do
  run_check "bash -n ${script}" bash -n "$script"
done
run_check "shellcheck" shellcheck --severity=info "${scripts[@]}"
# style of .editorconfig
run_check "shfmt" shfmt -d "${scripts[@]}"

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

[[ "$FAILED" -eq 0 ]] && echo "lint: ok"
finish
