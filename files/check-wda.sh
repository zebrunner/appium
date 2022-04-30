#!/bin/bash

WDA_HOST=$1
WDA_PORT=$2

# infinite loop to restart WDA until container is alive
while true
do
  # connect to WDA mjpeg port
  telnet $WDA_HOST $MJPEG_PORT
  #TODO: analyze stdout/stderr and maybe kill appium if telnet failed on connect asap

  # as only connection corrupted start wda again
  /opt/start-wda.sh
done
