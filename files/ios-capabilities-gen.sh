#!/bin/bash
if [[ "${PLATFORM_NAME^^}" != "IOS" ]]; then
  return 0
fi

export DEFAULT_CAPABILITIES=true

#TODO: review extra default params we used in mcloud-ios
#'{"webkitDebugProxyPort": '${iwdp_port}', "derivedDataPath":"'${BASEDIR}/tmp/DerivedData/${udid}'", remove -> "usePrebuiltWDA": "true", ??? "useNewWDA": "'$newWDA'"

cat << EndOfMessage
{
  "udid":"$DEVICE_UDID",
  "mjpegServerPort": ${MJPEG_PORT},
  "clearSystemFiles": "false",
  "webDriverAgentUrl":"http://${WDA_HOST}:${WDA_PORT}",
  "preventWDAAttachments": "true",
  "simpleIsVisibleCheck": "true",
  "wdaLocalPort": "${WDA_PORT}",
  "platformVersion": "${PLATFORM_VERSION}",
  "automationName":"${AUTOMATION_NAME}",
  "platformName": "${PLATFORM_NAME}",
  "deviceName": "${DEVICE_NAME}"
}
EndOfMessage
