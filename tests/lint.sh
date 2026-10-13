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

section "shell"
scripts=(build.sh scripts/*.sh tests/fixtures/fake-adb files/entrypoint.sh files/healthcheck files/config/*.sh files/module/*.sh files/util/debug.sh tests/*.sh)
for script in "${scripts[@]}"; do
  run_check "bash -n ${script}" bash -n "$script"
done
run_check "shellcheck" shellcheck --severity=info "${scripts[@]}"
# style of .editorconfig
run_check "shfmt" shfmt -d "${scripts[@]}"

section "patch"
# the .diff is the reviewable source of the patched build/lib/*.js files, both are kept in the repo
# shellcheck disable=SC2016
run_check "node --check of the patched js files" bash -c \
  'for f in files/patch/node_modules/@appium/base-driver/build/lib/*/*.js; do node --check "$f" || exit 1; done'
run_check "the patch diff is well-formed" git apply --stat files/patch/appium-3_1_1.diff
check "no non-ASCII characters in the patched js code" "" \
  "$(LC_ALL=C grep -n '[^[:print:][:space:]]' files/patch/node_modules/@appium/base-driver/build/lib/*/*.js files/patch/appium-3_1_1.diff)"

[[ "$FAILED" -eq 0 ]] && echo "lint: ok"
finish
