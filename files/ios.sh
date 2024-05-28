#!/bin/bash

echo DEVICE_UDID: "$DEVICE_UDID"


#### Establish usbmuxd communication
if [[ -z $USBMUXD_SOCKET_ADDRESS ]]; then
  echo "Start containerized usbmuxd service/process"
  usbmuxd -f &
  sleep 2
  # socat server to share usbmuxd socket via TCP
  socat TCP-LISTEN:2222,reuseaddr,fork UNIX-CONNECT:/var/run/usbmuxd &
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
  curl -Is "http://${WDA_HOST}:${WDA_PORT}/status" | head -1 | grep -q '200 OK'
  if [[ $? -eq 0 ]]; then
    echo "Wda started successfully!"
    wdaStarted=1
    break
  fi
  echo -e "Bad or no response from http://${WDA_HOST}:${WDA_PORT}/status.\nOne more attempt."
  sleep 2
done

if [[ $wdaStarted -eq 0 ]]; then
  echo "No response from WDA, or WDA is unhealthy!. Exiting!"
  exit 0
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
