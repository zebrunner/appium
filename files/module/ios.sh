#!/bin/bash

echo DEVICE_UDID: "$DEVICE_UDID"


#### Establish usbmuxd communication
#
# WIRELESS=true marks a device with no usb path -- an Apple TV 4K, for example, which
# has no diagnostic port and is reached over a network tunnel. There is no connector
# container for such a device and therefore no usbmuxd socket to join, so the socat
# below is skipped.
#
# Note this cannot be expressed by simply leaving USBMUXD_SOCKET_ADDRESS empty: that
# takes the branch below, which exits 0 and skips the whole remainder of this script
# -- including the WebDriverAgent readiness check and the PLATFORM_VERSION /
# DEVICETYPE detection that capability generation depends on. Those steps are all
# HTTP against WDA_HOST/WDA_PORT and work perfectly well for a wireless device, so
# they must still run.
#
# Set by zebrunner/mcloud-agent for device-list rows with wireless=true.
if [[ "${WIRELESS:-false}" == "true" ]]; then
  echo "WIRELESS=true: skipping usbmuxd setup, this device has no usb path."
  echo "WebDriverAgent is expected at http://${WDA_HOST}:${WDA_PORT} (published outside this container)."
elif [[ -z $USBMUXD_SOCKET_ADDRESS ]]; then
  echo "USBMUXD_SOCKET_ADDRESS in not defined. Exiting."
  exit 0
else
  # rm /var/run/usbmuxd in advance to be able to start socat and join it to $USBMUXD_SOCKET_ADDRESS
  echo "USBMUXD_SOCKET_ADDRESS was defined as: $USBMUXD_SOCKET_ADDRESS"
  rm -f /var/run/usbmuxd
  socat UNIX-LISTEN:/var/run/usbmuxd,fork,reuseaddr,mode=777 TCP:"$USBMUXD_SOCKET_ADDRESS" &
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

deviceInfo=$(curl -s http://${WDA_HOST}:${WDA_PORT}/status)

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
