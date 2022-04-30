#!/bin/sh

# infinite loop to restart WDA until container is alive
while true
do
  echo "telnet $1 $2"
  telnet $1 $2

  #TODO: analyze stdout/stderr and maybe kill appium if telnet failed on connect asap

  # as only connection corrupted start wda again
  /opt/start-wda.sh
done
