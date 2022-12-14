#!/bin/bash

# infinite loop to restart WDA until container is alive
while true
do
  echo ""

  echo "Connecting to ${WDA_HOST} ${MJPEG_PORT} using netcat..."
  nc ${WDA_HOST} ${MJPEG_PORT}
  echo "netcat connection is closed."

  #146 egister WDA_CRASHED=true env var inside WDA_ENV file 
  echo "export WDA_CRASHED=true" >> ${WDA_ENV}

  # as only connection corrupted start wda again
  /opt/start-wda.sh
done
