#!/bin/bash

# shellcheck source=../util/logger.sh
. /opt/logger.sh
logger "INFO" "DEVICE_UDID: $DEVICE_UDID"

#### Establish usbmuxd communication
# The tools of the image (idevice*, go-ios, XCUITest) read USBMUXD_SOCKET_ADDRESS themselves, the unix socket
# /var/run/usbmuxd (a symlink to USBMUXD_SOCKET, see Dockerfile) is forwarded for the tools that don't
#
# WIRELESS=true marks a device without usbmuxd: a simulator of the macOS host or a device whose WebDriverAgent is
# started by another tool (e.g. an Apple TV 4K over a network tunnel), the connector only relays WebDriverAgent there.
# The socat below is skipped. The WebDriverAgent readiness check and the PLATFORM_VERSION / DEVICETYPE detection below
# are HTTP against WDA_HOST/WDA_PORT and still run.
#
# Set by zebrunner/mcloud-agent for the simulator and proxy connections.
USBMUXD_SOCKET=/tmp/usbmuxd/usbmuxd
if [[ "${WIRELESS:-false}" == "true" ]]; then
  logger "INFO" "WIRELESS=true: skipping usbmuxd setup, this device has no usbmuxd."
  logger "INFO" "WebDriverAgent is expected at http://${WDA_HOST}:${WDA_PORT} (relayed by the connector)."
elif [[ -z $USBMUXD_SOCKET_ADDRESS ]]; then
  logger "WARN" "USBMUXD_SOCKET_ADDRESS is not defined, /var/run/usbmuxd is not forwarded."
else
  logger "INFO" "USBMUXD_SOCKET_ADDRESS was defined as: $USBMUXD_SOCKET_ADDRESS"
  rm -f "$USBMUXD_SOCKET"
  socat UNIX-LISTEN:"$USBMUXD_SOCKET",fork,reuseaddr,mode=777 TCP:"$USBMUXD_SOCKET_ADDRESS" &
  for _ in $(seq 1 50); do
    [[ -S "$USBMUXD_SOCKET" ]] && break
    sleep 0.1
  done
  if [[ -S "$USBMUXD_SOCKET" ]]; then
    logger "INFO" "/var/run/usbmuxd is forwarded to $USBMUXD_SOCKET_ADDRESS"
  else
    logger "ERROR" "/var/run/usbmuxd is not forwarded: socat did not create $USBMUXD_SOCKET"
  fi
fi

#### Simulator of a macOS host
# DEVICE_CONNECTION=ios-sim: XCUITest runs xcrun of the host (/usr/local/bin/xcrun, ssh through the connector) and
# reads the Xcode version from Info.plist of DEVELOPER_DIR, a copy of the one of the host. The simulator has no usbmuxd
# (WIRELESS=true), the connector relays its WebDriverAgent.
if [[ "$(echo "${DEVICE_CONNECTION}" | tr '[:upper:]' '[:lower:]')" == "ios-sim" ]]; then
  mkdir -p /tmp/zebrunner
  # ssh refuses a private key readable by others, the mounted one is copied
  if cp "${HOST_SSH_KEY:-/opt/zebrunner/ssh/id_ed25519}" /tmp/zebrunner/ssh_key 2> /dev/null; then
    chmod 600 /tmp/zebrunner/ssh_key
  else
    logger "ERROR" "The ssh key '${HOST_SSH_KEY:-/opt/zebrunner/ssh/id_ed25519}' of the macOS host is not found."
  fi
  export DEVELOPER_DIR=/tmp/zebrunner/Xcode.app/Contents/Developer
  mkdir -p "$DEVELOPER_DIR"
  # the remote command is expanded by the shell of the host
  # shellcheck disable=SC2016
  if ssh -i /tmp/zebrunner/ssh_key -p "${HOST_SSH_PORT:-22}" -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
    -o UserKnownHostsFile=/tmp/zebrunner/known_hosts -o LogLevel=ERROR "${HOST_SSH_USER}@${HOST_SSH_HOST:-connector}" \
    'cat "$(xcode-select -p)/../Info.plist"' > /tmp/zebrunner/Xcode.app/Contents/Info.plist; then
    logger "INFO" "Xcode of the macOS host is reachable for the simulator: DEVELOPER_DIR=${DEVELOPER_DIR}"
  else
    logger "ERROR" "Xcode of the macOS host is not reachable over ssh ${HOST_SSH_USER}@${HOST_SSH_HOST:-connector}."
  fi
fi

#### Detect device type and platform version
startTime=$(date +%s)
wdaStarted=0
while [[ $((startTime + ${DEVICE_TIMEOUT:-30})) -gt "$(date +%s)" ]]; do
  # GET: the newer WDA builds answer 404 to HEAD
  if curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://${WDA_HOST}:${WDA_PORT}/status" | grep -q '^200$'; then
    logger "INFO" "Wda started successfully!"
    wdaStarted=1
    break
  fi
  logger "WARN" "Bad or no response from http://${WDA_HOST}:${WDA_PORT}/status.\nOne more attempt."
  sleep 2
done

if [[ $wdaStarted -eq 0 ]]; then
  logger "ERROR" "No response from WDA, or WDA is unhealthy! Exiting!"
  # temp exit 1 to support iOS 17+ wda startup via independent service...
  exit 1
fi

deviceInfo=$(curl -s "http://${WDA_HOST}:${WDA_PORT}/status")

PLATFORM_VERSION=$(echo "$deviceInfo" | jq -r '.value.os.version')
export PLATFORM_VERSION

deviceClass=$(echo "$deviceInfo" | jq -r '.value.os.name')
export DEVICETYPE='Phone'
if [[ "$deviceClass" = "iPadOS" ]]; then
  export DEVICETYPE='Tablet'
fi
if [[ "$deviceClass" = "tvOS" ]]; then
  export DEVICETYPE='tvOS'
fi
