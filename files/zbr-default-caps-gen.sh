#!/bin/bash

#IMPORTANT!!! Don't do any echo otherwise you corrupt generated defaultcapabilities json

# convert to lower case using Linux/Mac compatible syntax (bash v3.2)
PLATFORM_NAME=`echo "$PLATFORM_NAME" |  tr '[:upper:]' '[:lower:]'`
if [[ "${PLATFORM_NAME}" == "android" ]]; then
cat << EndOfMessage
{
 "deviceName": "${DEVICE_NAME}",
 "platformName":"${PLATFORM_NAME}",
 "platformVersion":"${PLATFORM_VERSION}",
 "udid": "${DEVICE_UDID}",
 "automationName": "${AUTOMATION_NAME}",
 "provider": "mcloud",
 "enableVideo": "true",
 "enableLog": "true",
 "enableVnc": "false"
}
EndOfMessage
fi


#TODO: review extra default params we used in mcloud-ios
#'{"webkitDebugProxyPort": '${iwdp_port}'

if [[ "${PLATFORM_NAME}" == "ios" ]]; then
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
 "deviceName": "${DEVICE_NAME}",
 "provider": "mcloud",
 "enableVideo": "true",
 "enableLog": "true",
 "enableVnc": "false"
}
EndOfMessage
fi

