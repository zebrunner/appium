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

  if [ "${WDA_HOST}" == "localhost" ]; then
    echo "ERROR! WDA started using localhost! Verify device Wi-Fi connection!"
    echo "Sleeping ${UNREGISTER_IF_STILL_DOWN_AFTER}ms..."
    sleep $((UNREGISTER_IF_STILL_DOWN_AFTER/1000))
  fi

  echo "Connecting to ${WDA_HOST} ${MJPEG_PORT} using netcat..."
  nc ${WDA_HOST} ${MJPEG_PORT}
  echo "netcat connection is closed."

  # as only connection corrupted start wda again
  /opt/start-wda.sh
done
