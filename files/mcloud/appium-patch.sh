#!/bin/bash

#For local usage on Mac:
#export APPIUM_HOME=/opt/homebrew/lib/node_modules/appium
#cp -R ./files/mcloud/* ${APPIUM_HOME}/node_modules

cp -r -v --backup=numbered /opt/mcloud/* ${APPIUM_HOME}/node_modules
