#!/bin/bash

APPIUM_LOG="${APPIUM_LOG:-/var/log/appium.log}"

if [ -z $BUCKET ]; then
  echo "[warn] [UploadArtifacts] No sense to upload artifacts without S3 compatible storage!"
  exit 0
fi

sessionId=$1
if [ -z $sessionId ]; then
  echo "[warn] [CaptureArtifacts] No sense to record artifacts as sessionId not detected!"
  exit 0
fi

OVERIDDEN_ENTRYPOINT=""
if [ $BUCKET = "zebrunner" ] && [ ! -z $S3_ENDPOINT ] && [ -z $TENANT ]; then
  OVERIDDEN_ENTRYPOINT="--endpoint-url ${S3_ENDPOINT}"
fi

#upload session artifacts
S3_KEY_PATTERN=s3://${BUCKET}/${TENANT}/artifacts/test-sessions/${sessionId}
if [ -z $TENANT ]; then
  # use-case with embedded minio storage
  S3_KEY_PATTERN=s3://${BUCKET}/artifacts/test-sessions/${sessionId}
fi

echo "[info] [UploadArtifacts] S3_KEY_PATTERN: ${S3_KEY_PATTERN}"
if [ -f "${sessionId}.log" ]; then
  aws ${OVERIDDEN_ENTRYPOINT} s3 cp "${sessionId}.log" "${S3_KEY_PATTERN}/session.log"
else
  # Use-case when appium container received SIGTERM signal from outside. Upload current apppium log file in this case.
  aws ${OVERIDDEN_ENTRYPOINT} s3 cp "${APPIUM_LOG}" "${S3_KEY_PATTERN}/session.log"
fi

# convert to lower case using Linux/Mac compatible syntax (bash v3.2)
PLATFORM_NAME=`echo "$PLATFORM_NAME" |  tr '[:upper:]' '[:lower:]'`
if [ "${PLATFORM_NAME}" == "android" ]; then
  # concat required only for android where screenrecord utility has 180s limitation for recording!
  /opt/concat-video-recordings.sh "${sessionId}"
fi

aws ${OVERIDDEN_ENTRYPOINT} s3 cp "${sessionId}.mp4" "${S3_KEY_PATTERN}/video.mp4"

#cleanup
rm -fv "${sessionId}.log"
rm -fv "${sessionId}.mp4"

exit 0
