#!/bin/bash

if [ -z $BUCKET ] || [ -z $TENANT ]; then
  echo "[warn] [UploadArtifacts] No sense to upload artifacts without S3 compatible storage!"
  exit 0
fi

sessionId=$1
if [ -z $sessionId ]; then
  echo "[warn] [CaptureArtifacts] No sense to record artifacts as sessionId not detected!"
  exit 0
fi

/opt/concat-artifacts.sh "${sessionId}"

#upload session artifacts
S3_KEY_PATTERN=s3://${BUCKET}/${TENANT}/artifacts/test-sessions/${sessionId}
echo "[info] [UploadArtifacts] S3_KEY_PATTERN: ${S3_KEY_PATTERN}"

if [ -f "${sessionId}.log" ]; then
  aws s3 cp "${sessionId}.log" "${S3_KEY_PATTERN}/session.log"
else
  # use-case when RETAIN_TASK is off or when docker container stopped explicitly and forcibly by ESG/human
  aws s3 cp "${APPIUM_LOG}" "${S3_KEY_PATTERN}/session.log"
fi
aws s3 cp "${sessionId}.mp4" "${S3_KEY_PATTERN}/video.mp4"

#cleanup
rm -f "${sessionId}*"
