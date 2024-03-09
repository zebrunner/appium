#!/bin/bash

#IMPORTANT!!! Don't do any echo otherwise you corrupt generated defaultcapabilities json

# convert to lower case using Linux/Mac compatible syntax (bash v3.2)
PLATFORM_NAME=`echo "$PLATFORM_NAME" |  tr '[:upper:]' '[:lower:]'`
if [[ "${PLATFORM_NAME}" == "android" ]]; then
cat << EndOfMessage
{
 "platformName":"${PLATFORM_NAME}",
 "appium:platformVersion":"${PLATFORM_VERSION}",
 "appium:deviceName": "${DEVICE_NAME}",
 "appium:udid": "${DEVICE_UDID}",
 "appium:automationName": "${AUTOMATION_NAME}",
  "zebrunner:slotCapabilities": {
    "deviceName": "${DEVICE_NAME}",
    "platformName": "${PLATFORM_NAME}",
    "platformVersion": "${PLATFORM_VERSION}",
    "deviceType": "${DEVICETYPE}",
    "udid":"$DEVICE_UDID"
  }
}
EndOfMessage
fi


#TODO: review extra default params we used in mcloud-ios
#'{"webkitDebugProxyPort": '${iwdp_port}'

if [[ "${PLATFORM_NAME}" == "ios" ]]; then
cat << EndOfMessage
{
 "platformName": "${PLATFORM_NAME}",
 "appium:platformVersion": "${PLATFORM_VERSION}",
 "appium:deviceName": "${DEVICE_NAME}",
 "appium:udid":"$DEVICE_UDID",
 "appium:automationName":"${AUTOMATION_NAME}",
 "appium:mjpegServerPort": ${MJPEG_PORT},
 "appium:clearSystemFiles": "false",
 "appium:webDriverAgentUrl":"http://${WDA_HOST}:${WDA_PORT}",
 "appium:preventWDAAttachments": "true",
 "appium:simpleIsVisibleCheck": "true",
 "appium:wdaLocalPort": "${WDA_PORT}",
 "zebrunner:slotCapabilities": {
    "deviceName": "${DEVICE_NAME}",
    "platformName": "${PLATFORM_NAME}",
    "platformVersion": "${PLATFORM_VERSION}",
    "deviceType": "${DEVICETYPE}",
    "udid":"$DEVICE_UDID"
 }
}
EndOfMessage
fi
