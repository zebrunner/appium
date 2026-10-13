#!/bin/bash
# Tests of the Appium patch (files/patch) inside the image: node --test runs tests/patch/*.test.mjs
# against the patched @appium/base-driver, every node test is reported as a check.
source "$(dirname "$0")/lib.sh"
source "$(dirname "$0")/docker_lib.sh"
require_cmd python3
cd "$REPO" || exit 1

ensure_image

mkdir -p "$WORK/report"
# the container user (androidusr) writes the report
chmod 777 "$WORK/report"
docker run --rm --platform "$PLATFORM" \
  --volume "$REPO/tests/patch:/tests/patch:ro" \
  --volume "$WORK/report:/report" \
  --entrypoint node "$IMAGE" \
  --test --test-concurrency=1 --test-timeout=120000 \
  --test-reporter=spec --test-reporter-destination=/report/spec.log \
  --test-reporter=junit --test-reporter-destination=/report/junit.xml \
  '/tests/patch/*.test.mjs' > "$WORK/report/stdout.log" 2>&1
status=$?

if [[ ! -s "$WORK/report/junit.xml" ]]; then
  fail "node tests run" "exit status ${status}, no report" "$(tail -50 "$WORK/report/stdout.log")"
  finish
fi

# the test cases of the node JUnit report: <status>\t<suite>\t<name>\t<message>
while IFS=$'\t' read -r result suite name message; do
  SECTION="$suite"
  if [[ "$result" == "pass" ]]; then
    pass "$name"
  else
    fail "$name" "$message" "$(printf '%b' "$message")"
  fi
done < <(
  python3 - "$WORK/report/junit.xml" << 'PY'
import html
import sys
import xml.etree.ElementTree as ET

def walk(node, suite):
    for child in node:
        if child.tag == "testsuite":
            walk(child, child.get("name") or suite)
        elif child.tag == "testcase":
            failure = child.find("failure")
            if failure is None:
                print(f"pass\t{suite}\t{html.unescape(child.get('name'))}\t")
            else:
                # node escapes the message twice; the assertion diff is the head of the failure text
                text = html.unescape(failure.text or failure.get("message") or "")
                lines = []
                for line in text.splitlines():
                    if line.startswith("]"):
                        break
                    if line.strip() and not line.startswith("[Error"):
                        lines.append(line)
                details = "\n".join(lines[:12])
                print(f"fail\t{suite}\t{html.unescape(child.get('name'))}\t" + details.replace("\\", "\\\\").replace("\t", " ").replace("\n", "\\n"))

walk(ET.parse(sys.argv[1]).getroot(), "patch")
PY
)
SECTION=""
[[ "$status" -ne 0 && "$FAILED" -eq 0 ]] && fail "node tests pass" "exit status ${status}" "$(tail -50 "$WORK/report/stdout.log")"

finish
