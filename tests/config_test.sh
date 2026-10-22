#!/bin/bash
# Checks of the config generators files/config/zbr-*.sh: valid JSON from the env vars of the image.
source "$(dirname "$0")/lib.sh"
require_cmd python3
require_cmd jq
cd "$REPO" || exit 1

# json_get <json> <python expression on j> [args...]: prints the value as JSON, "INVALID JSON: ..." when the json
# doesn't parse; the extra args are sys.argv[3:]
json_get() {
  python3 -c '
import json, sys
try:
    j = json.loads(sys.argv[1])
except ValueError as exc:
    print(f"INVALID JSON: {exc}")
    sys.exit(0)
print(json.dumps(eval(sys.argv[2])))
' "$@"
}

common_env=(
  DEVICE_NAME="Pixel 7" DEVICE_UDID=udid-1 DEVICETYPE=Phone PLATFORM_VERSION=14 AUTOMATION_NAME=uiautomator2
  ADB_PORT=5037 PROXY_PORT=8080 SERVER_PROXY_PORT=0 APPIUM_PORT=4723 UNREGISTER_IF_STILL_DOWN_AFTER=3000
  STF_PROVIDER_HOST=10.0.0.5 SELENIUM_HOST=hub SELENIUM_PORT=4444
  REMOTE_ADB_HOST=connector CHROMEDRIVER_PORT=8200 CHROME_OPTIONS='"androidDevToolsPort": 9222'
  WDA_HOST=connector WDA_PORT=8100 MJPEG_PORT=8101
)

section "nodeconfig (zbr-config-gen.sh)"
config="$(env "${common_env[@]}" PLATFORM_NAME=Android files/config/zbr-config-gen.sh)"
check "nodeconfig is valid JSON" '"ok"' "$(json_get "$config" '"ok"')"
check "platformName is lower case" '"android"' "$(json_get "$config" 'j["capabilities"][0]["platformName"]')"
check "udid" '"udid-1"' "$(json_get "$config" 'j["capabilities"][0]["udid"]')"
check "deviceType" '"Phone"' "$(json_get "$config" 'j["capabilities"][0]["deviceType"]')"
check "automationName" '"uiautomator2"' "$(json_get "$config" 'j["capabilities"][0]["automationName"]')"
check "adb_port is a number" '5037' "$(json_get "$config" 'j["capabilities"][0]["adb_port"]')"
check "maxInstances is 1" '1' "$(json_get "$config" 'j["capabilities"][0]["maxInstances"]')"
check "the mcloud proxy" '"com.zebrunner.mcloud.grid.MobileRemoteProxy"' "$(json_get "$config" 'j["configuration"]["proxy"]')"
check "node url" '"http://10.0.0.5:4723/wd/hub"' "$(json_get "$config" 'j["configuration"]["url"]')"
check "hub host and port" '["hub", 4444]' "$(json_get "$config" '[j["configuration"]["hubHost"], j["configuration"]["hubPort"]]')"
check "unregisterIfStillDownAfter" '3000' "$(json_get "$config" 'j["configuration"]["unregisterIfStillDownAfter"]')"

section "default capabilities: android (zbr-default-caps-gen.sh)"
caps="$(env "${common_env[@]}" PLATFORM_NAME=ANDROID files/config/zbr-default-caps-gen.sh)"
check "android caps are valid JSON" '"ok"' "$(json_get "$caps" '"ok"')"
check "platformName is lower case" '"android"' "$(json_get "$caps" 'j["platformName"]')"
check "all non-standard caps have the appium: prefix" '[]' \
  "$(json_get "$caps" '[k for k in j if k != "platformName" and not k.startswith("appium:")]')"
check "udid" '"udid-1"' "$(json_get "$caps" 'j["appium:udid"]')"
check "remoteAdbHost" '"connector"' "$(json_get "$caps" 'j["appium:remoteAdbHost"]')"
check "chromedriverPort is a number" '8200' "$(json_get "$caps" 'j["appium:chromedriverPort"]')"
check "chromeOptions take CHROME_OPTIONS" '{"androidDevToolsPort": 9222}' "$(json_get "$caps" 'j["appium:chromeOptions"]')"

section "default capabilities: ios (zbr-default-caps-gen.sh)"
caps="$(env "${common_env[@]}" PLATFORM_NAME=iOS AUTOMATION_NAME=XCUITest DEVICE_UDID=00008110-000A files/config/zbr-default-caps-gen.sh)"
check "ios caps are valid JSON" '"ok"' "$(json_get "$caps" '"ok"')"
check "platformName is lower case" '"ios"' "$(json_get "$caps" 'j["platformName"]')"
check "all non-standard caps have the appium: prefix" '[]' \
  "$(json_get "$caps" '[k for k in j if k != "platformName" and not k.startswith("appium:")]')"
check "udid" '"00008110-000A"' "$(json_get "$caps" 'j["appium:udid"]')"
check "webDriverAgentUrl" '"http://connector:8100"' "$(json_get "$caps" 'j["appium:webDriverAgentUrl"]')"
check "mjpegServerPort is a number" '8101' "$(json_get "$caps" 'j["appium:mjpegServerPort"]')"
# XCUITest accepts "false" strings but doesn't convert them: `if (opts.clearSystemFiles)` is then true
check "clearSystemFiles is the JSON boolean false" 'false' "$(json_get "$caps" 'j["appium:clearSystemFiles"]')"
check "simpleIsVisibleCheck is the JSON boolean true" 'true' "$(json_get "$caps" 'j["appium:simpleIsVisibleCheck"]')"
check "wdaLocalPort is a number" '8100' "$(json_get "$caps" 'j["appium:wdaLocalPort"]')"
check "no preventWDAAttachments (unused by XCUITest)" 'false' "$(json_get "$caps" '"appium:preventWDAAttachments" in j')"
check "a real device is not headless" 'false' "$(json_get "$caps" '"appium:isHeadless" in j')"
caps="$(env "${common_env[@]}" PLATFORM_NAME=iOS AUTOMATION_NAME=XCUITest DEVICE_UDID=B1B07E76 DEVICE_CONNECTION=Simulator \
  files/config/zbr-default-caps-gen.sh)"
check "a simulator is headless" 'true' "$(json_get "$caps" 'j["appium:isHeadless"]')"
check "a simulator uses the relayed WebDriverAgent" '"http://connector:8100"' "$(json_get "$caps" 'j["appium:webDriverAgentUrl"]')"

section "wrong values"
# run_gen <script> <env vars...>: sets OUT (stdout), ERR (stderr) and STATUS of the generator
run_gen() {
  OUT="$(env "${common_env[@]}" "${@:2}" "files/config/$1" 2> "$WORK/stderr")"
  STATUS=$?
  ERR="$(cat "$WORK/stderr")"
}
run_gen zbr-config-gen.sh PLATFORM_NAME=android SELENIUM_PORT=
check "nodeconfig without SELENIUM_PORT: exit status 1" "1" "$STATUS"
check "nodeconfig without SELENIUM_PORT: no output" "" "$OUT"
check_contains "nodeconfig without SELENIUM_PORT: the variable is named" "SELENIUM_PORT must be a number, got ''" "$ERR"
run_gen zbr-config-gen.sh PLATFORM_NAME=android ADB_PORT=abc
check "nodeconfig with ADB_PORT=abc: exit status 1" "1" "$STATUS"
check_contains "nodeconfig with ADB_PORT=abc: the variable is named" "ADB_PORT must be a number, got 'abc'" "$ERR"
run_gen zbr-default-caps-gen.sh PLATFORM_NAME=ios WDA_PORT=
check "ios caps without WDA_PORT: exit status 1" "1" "$STATUS"
check_contains "ios caps without WDA_PORT: the variable is named" "WDA_PORT must be a number" "$ERR"
run_gen zbr-default-caps-gen.sh PLATFORM_NAME=android CHROMEDRIVER_PORT=x
check "android caps with CHROMEDRIVER_PORT=x: exit status 1" "1" "$STATUS"
run_gen zbr-default-caps-gen.sh PLATFORM_NAME=android 'CHROME_OPTIONS="a":'
check "android caps with a wrong CHROME_OPTIONS: exit status 1" "1" "$STATUS"
check_contains "android caps with a wrong CHROME_OPTIONS: the variable is named" "CHROME_OPTIONS must be" "$ERR"
run_gen zbr-default-caps-gen.sh PLATFORM_NAME=android CHROME_OPTIONS=
check "android caps with an empty CHROME_OPTIONS: an empty object" '{}' "$(json_get "$OUT" 'j["appium:chromeOptions"]')"

name='Pixel "7" \ Pro'
run_gen zbr-config-gen.sh PLATFORM_NAME=android DEVICE_NAME="$name"
check "nodeconfig: quotes and backslashes are escaped" "$(json_get '"x"' 'sys.argv[3]' "$name")" "$(json_get "$OUT" 'j["capabilities"][0]["deviceName"]')"
run_gen zbr-default-caps-gen.sh PLATFORM_NAME=ios DEVICE_NAME="$name"
check "ios caps: quotes and backslashes are escaped" "$(json_get '"x"' 'sys.argv[3]' "$name")" "$(json_get "$OUT" 'j["appium:deviceName"]')"

section "default capabilities: other platforms"
check "no caps without PLATFORM_NAME" "" "$(env "${common_env[@]}" PLATFORM_NAME= files/config/zbr-default-caps-gen.sh)"

finish
