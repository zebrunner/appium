#!/bin/bash

APPIUM_LOG="${APPIUM_LOG:-/var/log/appium.log}"

if [ -z $BUCKET ] || [ -z $TENANT ]; then
  echo "[warn] [UploadArtifacts] No sense to upload artifacts without S3 compatible storage!"
  exit 0
fi

sessionId=$1
if [ -z $sessionId ]; then
  echo "[warn] [CaptureArtifacts] No sense to record artifacts as sessionId not detected!"
  exit 0
fi

#upload session artifacts
S3_KEY_PATTERN=s3://${BUCKET}/${TENANT}/artifacts/test-sessions/${sessionId}
echo "[info] [UploadArtifacts] S3_KEY_PATTERN: ${S3_KEY_PATTERN}"
if [ -f "${sessionId}.log" ]; then
  aws s3 cp "${sessionId}.log" "${S3_KEY_PATTERN}/session.log"
else
  # Use-case when appium container received SIGTERM signal from outside. Upload current apppium log file in this case.
  aws s3 cp "${APPIUM_LOG}" "${S3_KEY_PATTERN}/session.log"
fi

/opt/concat-video-recordings.sh "${sessionId}"
aws s3 cp "${sessionId}.mp4" "${S3_KEY_PATTERN}/video.mp4"

#cleanup
rm -f "${sessionId}*"

exit 0
