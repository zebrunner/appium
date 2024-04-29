#!/bin/bash

artifactId=$1
if [ -z ${artifactId} ]; then
  echo "[warn] [Stop Video] artifactId param is empty!"
  exit 0
fi

if [ -f /tmp/${artifactId}.mp4 ]; then
  ls -la /tmp/${artifactId}.mp4
  ffmpeg_pid=$(pgrep --full ffmpeg.*${artifactId}.mp4)
  kill -2 $ffmpeg_pid
  echo "kill output: $?"

  # wait until ffmpeg finished normally and file size is greater 48 byte! Time limit is 5 sec
  idleTimeout=30
  startTime=$(date +%s)
  while [ $((startTime + idleTimeout)) -gt "$(date +%s)" ]; do
    videoFileSize=$(wc -c /tmp/${artifactId}.mp4 | awk '{print $1}')
    echo videoFileSize: $videoFileSize
    echo -e "Running ffmpeg processes:\n $(pgrep --list-full --full ffmpeg) \n-------------------------"
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

  # send signal to stop streaming of the screens from device (applicable only for android so far)
  echo "trying to off: nc ${BROADCAST_HOST} ${BROADCAST_PORT}"
  echo -n "off" | nc ${BROADCAST_HOST} ${BROADCAST_PORT} -w 0

  #TODO: do we need pause here? we expect to see "Exiting normally, received signal 2."

  echo "Video recording file size:"
  ls -la /tmp/${artifactId}.mp4

  mv /tmp/${artifactId}.mp4 ${LOG_DIR}/${artifactId}/video.mp4
fi
