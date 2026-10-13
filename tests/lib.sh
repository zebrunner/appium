#!/bin/bash
# Shared helpers of the test scripts: workspace, assertions and JUnit XML.
# A test script sources it first: source "$(dirname "$0")/lib.sh"
# With JUNIT_DIR set, the results are also written into ${JUNIT_DIR}/<test script name>.xml (JUnit XML).
# Keep it compatible with the macOS system bash 3.2.

# REPO, WORK and the helpers below are used by the scripts sourcing this file
# shellcheck disable=SC2034
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
SUITE="$(basename "$0" .sh)"
SECTION=""
FAILED=0
trap 'junit_write $?; cleanup; rm -rf "$WORK"' EXIT

# cleanup: redefined by a test script to free its resources (containers, ...) on exit
cleanup() {
  :
}

# xml_escape: stdin escaped for XML text and attributes, control characters (e.g. colors) dropped
xml_escape() {
  LC_ALL=C sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g' -e "s/'/\&apos;/g" |
    LC_ALL=C tr -d '\000-\010\013\014\016-\037'
}

# junit_case <name> [<failure message> <failure details> | skipped <message>]: records a JUnit test case
junit_case() {
  local name
  name="$(printf '%s' "${SECTION:+${SECTION}: }$1" | xml_escape)"
  {
    if [[ $# -eq 1 ]]; then
      printf '  <testcase classname="%s" name="%s"/>\n' "$SUITE" "$name"
    elif [[ "$2" == "skipped" ]]; then
      printf '  <testcase classname="%s" name="%s"><skipped message="%s"/></testcase>\n' \
        "$SUITE" "$name" "$(printf '%s' "$3" | xml_escape)"
    else
      printf '  <testcase classname="%s" name="%s"><failure message="%s">%s</failure></testcase>\n' \
        "$SUITE" "$name" "$(printf '%s' "$2" | xml_escape)" "$(printf '%s' "$3" | xml_escape)"
    fi
  } >> "${WORK}/junit-cases.xml"
}

# junit_write <exit status>: writes ${JUNIT_DIR}/<suite>.xml, a failed exit without failed checks is a failure too
junit_write() {
  [[ -n "${JUNIT_DIR:-}" ]] || return 0
  if [[ "$1" -ne 0 && "$FAILED" -eq 0 ]]; then
    SECTION=""
    junit_case "${SUITE} finished" "exit status $1" "The test script exited with status $1 before finishing its checks"
  fi
  local cases="${WORK}/junit-cases.xml"
  touch "$cases"
  mkdir -p "$JUNIT_DIR"
  {
    echo '<?xml version="1.0" encoding="UTF-8"?>'
    printf '<testsuite name="%s" tests="%s" failures="%s" skipped="%s" time="%s">\n' "$SUITE" \
      "$(grep -c '<testcase' "$cases")" "$(grep -c '<failure' "$cases")" "$(grep -c '<skipped' "$cases")" "$SECONDS"
    cat "$cases"
    echo '</testsuite>'
  } > "${JUNIT_DIR}/${SUITE}.xml"
}

# section <name>: starts a group of checks
section() {
  SECTION="$1"
  echo "# $1"
}

# pass <description>
pass() {
  echo "ok   - $1"
  junit_case "$1"
}

# fail <description> <message> <details>: details are printed indented
fail() {
  echo "FAIL - $1"
  echo "$3" | sed 's/^/       /'
  junit_case "$1" "$2" "$3"
  FAILED=1
}

# skip <reason>: skips the whole test script
skip() {
  echo "skip - $1"
  junit_case "$SUITE" skipped "$1"
  exit 0
}

# check <description> <expected> <actual>
check() {
  if [[ "$2" == "$3" ]]; then
    pass "$1"
  else
    fail "$1" "expected '$2', actual '$3'" "$(printf "expected: '%s'\nactual:   '%s'" "$2" "$3")"
  fi
}

# check_contains <description> <expected part> <text>
check_contains() {
  if [[ "$3" == *"$2"* ]]; then
    pass "$1"
  else
    fail "$1" "'$2' is missing" "$(printf "'%s' is missing in:\n%s" "$2" "$3")"
  fi
}

# run_check <description> <command...>: runs a command as a check, its output is shown when it fails
run_check() {
  local output
  output="$("${@:2}" 2>&1)"
  local status=$?
  if [[ "$status" -eq 0 ]]; then
    pass "$1"
  else
    fail "$1" "exit status ${status}" "$output"
  fi
}

require_cmd() {
  command -v "$1" > /dev/null 2>&1 || skip "requires $1"
}

finish() {
  exit "$FAILED"
}
