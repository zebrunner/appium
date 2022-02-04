#!/bin/bash

#export

APPIUM_LOG="${APPIUM_LOG:-/var/log/appium.log}"

> "${APPIUM_LOG}"
ls -la "${APPIUM_LOG}"
> /tmp/video.log

