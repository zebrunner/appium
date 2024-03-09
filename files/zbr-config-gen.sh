#!/bin/bash

#IMPORTANT!!! Don't do any echo otherwise you corrupt generated nodeconfig.toml
# convert to lower case using Linux/Mac compatible syntax (bash v3.2)
PLATFORM_NAME=`echo "$PLATFORM_NAME" |  tr '[:upper:]' '[:lower:]'`
cat << EndOfMessage
[server]
external-url = "http://${STF_PROVIDER_HOST}:${APPIUM_PORT}"
bind-host = true

[node]
# Autodetect which drivers are available on the current system, and add them to the Node.
detect-drivers = false

# Maximum number of concurrent sessions. Default value is the number of available processors.
max-sessions = 1

# Full classname of non-default Node implementation. This is used to manage a session’s lifecycle.
implementation = "com.zebrunner.mcloud.grid.MobileRemoteProxy"

# The address of the Hub in a Hub-and-Node configuration.
hub = "http://${SELENIUM_HOST}:${SELENIUM_PORT}"

# How often, in seconds, the Node will try to register itself for the first time to the Distributor.
register-cycle = $REGISTER_CYCLE

# How long, in seconds, will the Node try to register to the Distributor for the first time.
# After this period is completed, the Node will not attempt to register again.
register-period = $REGISTER_PERIOD

# How often, in seconds, will the Node send heartbeat events to the Distributor to inform it that the Node is up.
heartbeat-period = $HEARTBEAT_PERIOD

# Let X be the session-timeout in seconds.
# The Node will automatically kill a session that has not had any activity in the last X seconds.
# This will release the slot for other tests.
session-timeout = $GRID_BROWSER_TIMEOUT

[relay]
# URL for connecting to the service that supports WebDriver commands like an Appium server or a cloud service.
url = "http://localhost:4723/wd/hub"

# Optional, endpoint to query the WebDriver service status, an HTTP 200 response is expected
status-endpoint = "/status"

# Stereotypes supported by the service. The initial number is "max-sessions", and will allocate
# that many test slots to that particular configuration
configs = [
  "1", "{\"platformName\": \"${PLATFORM_NAME}\", \"appium:platformVersion\": \"${PLATFORM_VERSION}\", \"appium:deviceName\": \"${DEVICE_NAME}\", \"appium:automationName\": \"${AUTOMATION_NAME}\", \"zebrunner:deviceType\": \"${DEVICETYPE}\", \"appium:udid\": \"${DEVICE_UDID}\", \"zebrunner:adb_port\": \"${ADB_PORT}\", \"zebrunner:proxy_port\": \"${PROXY_PORT}\" }"
]

[logging]
# Log level. Default logging level is INFO. Log levels are described here
# https://docs.oracle.com/javase/7/docs/api/java/util/logging/Level.html
log-level = "${NODE_LOG_LEVEL}"

# Enable http logging. Tracing should be enabled to log http logs.
http-logs = "${HTTP_LOGS}"

[events]
publish-events = "tcp://${SELENIUM_HOST}:${PUBLISH_EVENTS_PORT}"
subscribe-events = "tcp://${SELENIUM_HOST}:${SUBSCRIBE_EVENTS_PORT}"
EndOfMessage
