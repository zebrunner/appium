# patched both sources in lib and compiled in build/lib for easier maintenance in future
cp ${APPIUM_HOME}/node_modules/appium-base-driver/lib/basedriver/helpers.js ${APPIUM_HOME}/node_modules/appium-base-driver/lib/basedriver/helpers.js.bak
cp /opt/downloader/appium-base-driver/lib/basedriver/helpers.js ${APPIUM_HOME}/node_modules/appium-base-driver/lib/basedriver/helpers.js
cp /opt/downloader/appium-base-driver/lib/basedriver/mcloud-utils.js ${APPIUM_HOME}/node_modules/appium-base-driver/lib/basedriver/mcloud-utils.js

cp ${APPIUM_HOME}/node_modules/appium-base-driver/build/lib/basedriver/helpers.js ${APPIUM_HOME}/node_modules/appium-base-driver/build/lib/basedriver/helpers.js.bak
cp /opt/downloader/appium-base-driver/build/lib/basedriver/helpers.js ${APPIUM_HOME}/node_modules/appium-base-driver/build/lib/basedriver/helpers.js
cp /opt/downloader/appium-base-driver/build/lib/basedriver/mcloud-utils.js ${APPIUM_HOME}/node_modules/appium-base-driver/build/lib/basedriver/mcloud-utils.js
