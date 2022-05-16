#!/bin/bash

# infinite loop to restart WDA until container is alive
while true
do
  echo ""

  if [ -f ${WDA_ENV} ] && [ -s ${WDA_ENV} ]; then
    # source only if exists and non-empty
    source ${WDA_ENV}
  else
    echo "waiting for valid ${WDA_ENV} file content"
    sleep 1
    continue
  fi

  echo "Connecting to ${WDA_HOST} ${MJPEG_PORT} using netcat..."
  nc ${WDA_HOST} ${MJPEG_PORT}
  echo "netcat connection is closed."

  # as only connection corrupted start wda again
  /opt/start-wda.sh
done
