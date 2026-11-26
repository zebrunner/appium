#!/bin/bash

echo DEVICE_UDID: "$DEVICE_UDID"

#### Establish usbmuxd communication
# The tools of the image (idevice*, go-ios, XCUITest) read USBMUXD_SOCKET_ADDRESS themselves, the unix socket
# /var/run/usbmuxd (a symlink to USBMUXD_SOCKET, see Dockerfile) is forwarded for the tools that don't
#
# WIRELESS=true marks a device with no usb path -- an Apple TV 4K, for example, which
# has no diagnostic port and is reached over a network tunnel. There is no connector
# container for such a device and therefore no usbmuxd socket to join, so the socat
# below is skipped. The WebDriverAgent readiness check and the PLATFORM_VERSION /
# DEVICETYPE detection below are HTTP against WDA_HOST/WDA_PORT and still run.
# USBMUXD_SOCKET_ADDRESS (connector:2222 by default) is unset for Appium: the driver reads it
# itself and would otherwise fail on the missing connector host. Without usbmuxd the driver has
# no channel to the device, only WDA: app, bundleId and fullReset fail the session.
#
# Set by zebrunner/mcloud-agent for device-list rows with wireless=true.
USBMUXD_SOCKET=/tmp/usbmuxd/usbmuxd
if [[ "${WIRELESS:-false}" == "true" ]]; then
  unset USBMUXD_SOCKET_ADDRESS
  echo "WIRELESS=true: skipping usbmuxd setup, this device has no usb path."
  echo "WebDriverAgent is expected at http://${WDA_HOST}:${WDA_PORT} (published outside this container)."
  echo "[warn] WIRELESS=true: no usbmuxd channel to the device, only WDA. Sessions with app, bundleId or" \
    "fullReset fail; use a preinstalled app and start it with 'mobile: launchApp'."
elif [[ -z $USBMUXD_SOCKET_ADDRESS ]]; then
  echo "[warn] USBMUXD_SOCKET_ADDRESS is not defined, /var/run/usbmuxd is not forwarded."
else
  echo "USBMUXD_SOCKET_ADDRESS was defined as: $USBMUXD_SOCKET_ADDRESS"
  rm -f "$USBMUXD_SOCKET"
  socat UNIX-LISTEN:"$USBMUXD_SOCKET",fork,reuseaddr,mode=777 TCP:"$USBMUXD_SOCKET_ADDRESS" &
  for _ in $(seq 1 50); do
    [[ -S "$USBMUXD_SOCKET" ]] && break
    sleep 0.1
  done
  if [[ -S "$USBMUXD_SOCKET" ]]; then
    echo "/var/run/usbmuxd is forwarded to $USBMUXD_SOCKET_ADDRESS"
  else
    echo "[error] /var/run/usbmuxd is not forwarded: socat did not create $USBMUXD_SOCKET"
  fi
fi

#### Detect device type and platform version
startTime=$(date +%s)
wdaStarted=0
while [[ $((startTime + ${DEVICE_TIMEOUT:-30})) -gt "$(date +%s)" ]]; do
  curl -Is "http://${WDA_HOST}:${WDA_PORT}/status" | head -1 | grep -q '200'
  if [[ $? -eq 0 ]]; then
    echo "Wda started successfully!"
    wdaStarted=1
    break
  fi
  echo -e "Bad or no response from http://${WDA_HOST}:${WDA_PORT}/status.\nOne more attempt."
  sleep 2
done

if [[ $wdaStarted -eq 0 ]]; then
  echo "No response from WDA, or WDA is unhealthy! Exiting!"
  # temp exit 1 to support iOS 17+ wda startup via independent service...
  exit 1
fi

deviceInfo=$(curl -s "http://${WDA_HOST}:${WDA_PORT}/status")

PLATFORM_VERSION=$(echo "$deviceInfo" | jq -r '.value.os.version')
export PLATFORM_VERSION

deviceClass=$(echo "$deviceInfo" | jq -r '.value.os.name')
export DEVICETYPE='Phone'
if [ "$deviceClass" = "iPadOS" ]; then
  export DEVICETYPE='Tablet'
fi
if [ "$deviceClass" = "tvOS" ]; then
  export DEVICETYPE='tvOS'
fi
