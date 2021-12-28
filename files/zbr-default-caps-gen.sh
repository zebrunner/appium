#!/bin/bash

#IMPORTANT!!! Don't do any echo otherwise you corrupt generated defaultcapabilities json

if [[ "${PLATFORM_NAME,,}" != "ios" ]]; then
  return 0
fi

export DEFAULT_CAPABILITIES=true
#TODO: review extra default params we used in mcloud-ios
#'{"webkitDebugProxyPort": '${iwdp_port}', "derivedDataPath":"'${BASEDIR}/tmp/DerivedData/${udid}'", remove -> "usePrebuiltWDA": "true", ??? "useNewWDA": "'$newWDA'"

cat << EndOfMessage
{
  "udid":"$DEVICE_UDID",
  "webDriverAgentUrl":"http://${WDA_HOST}:${WDA_PORT}",
  "platformVersion": "${PLATFORM_VERSION}",
  "automationName":"${AUTOMATION_NAME}",
  "platformName": "${PLATFORM_NAME}",
  "deviceName": "${DEVICE_NAME}"
}
EndOfMessage
