#!/bin/bash

# infinite loop to restart WDA until container is alive
while true
do
  #TODO: analyze stdout/stderr to detect if wda is listening at all and kill appium
  echo ""
  echo "Connecting to $1 $2 using netcat..."
  nc $1 $2
  echo "netcat connection is closed."

  # as only connection corrupted start wda again
  /opt/start-wda.sh
done
