#!/bin/bash

if [[ -z $USBMUXD_SOCKET_ADDRESS ]]; then
  logger "Start containerized usbmuxd service/process"
  usbmuxd -f &
  sleep 2
  # socat server to share usbmuxd socket via TCP
  socat TCP-LISTEN:2222,reuseaddr,fork UNIX-CONNECT:/var/run/usbmuxd &
else
  # rm /var/run/usbmuxd in advance to be able to start socat and join it to $USBMUXD_SOCKET_ADDRESS
  rm -f /var/run/usbmuxd
  socat UNIX-LISTEN:/var/run/usbmuxd,fork,reuseaddr,mode=777 TCP:"$USBMUXD_SOCKET_ADDRESS" &
fi
