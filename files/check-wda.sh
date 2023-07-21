#!/bin/bash

# infinite loop to restart WDA until container is alive
while true
do
  echo ""

  echo "Connecting to ${WDA_HOST} ${MJPEG_PORT} using netcat..."
  nc ${WDA_HOST} ${MJPEG_PORT}
  echo "netcat connection is closed."

  # as only connection corrupted start wda again
  /opt/start-wda.sh
done
