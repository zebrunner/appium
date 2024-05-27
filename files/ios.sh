#!/bin/bash

echo DEVICE_UDID: "$DEVICE_UDID"


#### Establish usbmuxd communication
if [[ -z $USBMUXD_SOCKET_ADDRESS ]]; then
  logger "Start containerized usbmuxd service/process"
  usbmuxd -f &
  sleep 2
  # socat server to share usbmuxd socket via TCP
  socat TCP-LISTEN:${USBMUXD_SOCKET_ADDRESS},reuseaddr,fork UNIX-CONNECT:/var/run/usbmuxd &
else
  # rm /var/run/usbmuxd in advance to be able to start socat and join it to $USBMUXD_SOCKET_ADDRESS
  rm -f /var/run/usbmuxd
  socat UNIX-LISTEN:/var/run/usbmuxd,fork,reuseaddr,mode=777 TCP:"$USBMUXD_SOCKET_ADDRESS" &
fi


#### Detect device type and platform version
# TODO: handle negative cases when we can't recognize device type and version
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
