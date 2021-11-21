#!/bin/bash

sessionId=$1
echo sessionId: $sessionId

adb shell "su root chmod a+r ${sessionId}*.mp4"
adb shell "su root ls -la ${sessionId}*.mp4"

videoFiles=$sessionId.txt

# pull video artifacts until exist
declare -i part=0
while true; do
  adb pull "${sessionId}_${part}.mp4" "${sessionId}_${part}.mp4" > /dev/null 2>&1
  if [ ! -f "${sessionId}_${part}.mp4" ]; then
    echo "[info] [ConcatVideo] stop pulling ${sessionId} video artifacts!"
    break
  fi
  #TODO: in case of often mistakes with 0 size verification just comment it. it seems like ffmpeg can handle empty file during concantenation
  if [ ! -s "${sessionId}_${part}.mp4" ]; then
    echo "[info] [ConcatVideo] stop pulling ${sessionId} video artifacts as ${sessionId}_${part}.mp4 already empty!!"
    ls -la "${sessionId}_${part}.mp4"
    break
  fi
  echo "file ${sessionId}_${part}.mp4" >> $videoFiles
  part+=1
done

if [ $part -eq 1 ]; then
  echo "[debug] [ConcatVideo] #12: there is no sense to concatenate video as it is single file, just rename..."
  mv ${sessionId}_0.mp4 $sessionId.mp4
else
  if [ -f $videoFiles ]; then
    cat $videoFiles
    #TODO: #9 concat audio as well if appropriate artifact exists
    ffmpeg $FFMPEG_OPTS -y -f concat -safe 0 -i $videoFiles -c copy $sessionId.mp4
  else
    echo "[error] [ConcatVideo] unable to concat video as $videoFiles is absent!"
  fi

  # ffmpeg artifacts cleanup
  rm -f $videoFiles
fi

if [ -f $sessionId.mp4 ]; then
  echo "[info] [ConcatVideo] ${sessionId}.mp4 generated successfully."
else
  echo "[error] [ConcatVideo] unable to generate ${sessionId}.mp4!"
fi


