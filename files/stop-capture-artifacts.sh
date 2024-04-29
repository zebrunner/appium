#!/bin/bash

artifactId=$1
if [ -z ${artifactId} ]; then
  echo "[warn] [Stop Video] artifactId param is empty!"
  return 0
fi

# send signal to stop streaming of the screens from device (applicable only for android so far)
echo -n off | nc ${BROADCAST_HOST} ${BROADCAST_PORT} -w 0

if [ -f /tmp/${artifactId}.mp4 ]; then
  ls -la /tmp/${artifactId}.mp4
  pkill -e -f ffmpeg
  echo "kill output: $?"
  #ps -ef | grep ffmpeg

  # wait until ffmpeg finished normally and file size is greater 48 byte! Time limit is 5 sec
  idleTimeout=30
  startTime=$(date +%s)
  while [ $((startTime + idleTimeout)) -gt "$(date +%s)" ]; do
    videoFileSize=$(wc -c /tmp/${artifactId}.mp4 | awk '{print $1}')
    echo videoFileSize: $videoFileSize
    ps -ef | grep ffmpeg
    #echo videoFileSize: $videoFileSize
    #TODO: remove comparison with 48 bytes after finishing with valid verification
    if [ $videoFileSize -le 48 ] || [ -z $videoFileSize ]; then
      #echo "ffmpeg flush is not finished yet"
      sleep 0.1
      continue
    fi

    #echo "detecting ffmpeg process pid..."
    pidof ffmpeg > /dev/null 2>&1
    if [ $? -eq 1 ]; then
      echo "no more ffmpeg commands..."
      break
    else
      echo "WARN ffmpeg still exists!"
      sleep 0.1
    fi
  done

  #TODO: do we need pause here? we expect to see "Exiting normally, received signal 2."

  echo "Video recording file size:"
  ls -la /tmp/${artifactId}.mp4

  mv /tmp/${artifactId}.mp4 ${LOG_DIR}/${artifactId}/video.mp4
fi
