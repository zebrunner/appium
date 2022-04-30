#!/bin/bash

WDA_HOST=$1
MJPEG_PORT=$2

# infinite loop to restart WDA until container is alive
while true
do
  echo "Connecting to WDA mjpeg: $WDA_HOST:$MJPEG_PORT"
  telnet $WDA_HOST $MJPEG_PORT

  #TODO: analyze stdout/stderr and maybe kill appium if telnet failed on connect asap

  # as only connection corrupted start wda again
  /opt/start-wda.sh
done
