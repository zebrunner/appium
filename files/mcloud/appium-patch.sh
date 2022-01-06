# patched both sources in lib and compiled in build/lib for easier maintenance in future
cp ${APPIUM_HOME}/node_modules/appium-base-driver/lib/basedriver/helpers.js ${APPIUM_HOME}/node_modules/appium-base-driver/lib/basedriver/helpers.js.bak
cp ${APPIUM_HOME}/node_modules/appium-base-driver/lib/basedriver/commands/session.js ${APPIUM_HOME}/node_modules/appium-base-driver/lib/basedriver/commands/session.js.bak
cp /opt/mcloud/appium-base-driver/lib/basedriver/helpers.js ${APPIUM_HOME}/node_modules/appium-base-driver/lib/basedriver/helpers.js
cp /opt/mcloud/appium-base-driver/lib/basedriver/session.js ${APPIUM_HOME}/node_modules/appium-base-driver/lib/basedriver/commands/session.js
cp /opt/mcloud/appium-base-driver/lib/basedriver/mcloud-utils.js ${APPIUM_HOME}/node_modules/appium-base-driver/lib/basedriver/mcloud-utils.js

cp ${APPIUM_HOME}/node_modules/appium-base-driver/build/lib/basedriver/helpers.js ${APPIUM_HOME}/node_modules/appium-base-driver/build/lib/basedriver/helpers.js.bak
cp ${APPIUM_HOME}/node_modules/appium-base-driver/build/lib/basedriver/commands/session.js ${APPIUM_HOME}/node_modules/appium-base-driver/build/lib/basedriver/commands/session.js.bak
cp /opt/mcloud/appium-base-driver/build/lib/basedriver/helpers.js ${APPIUM_HOME}/node_modules/appium-base-driver/build/lib/basedriver/helpers.js
cp /opt/mcloud/appium-base-driver/build/lib/basedriver/session.js ${APPIUM_HOME}/node_modules/appium-base-driver/build/lib/basedriver/commands/session.js
cp /opt/mcloud/appium-base-driver/build/lib/basedriver/mcloud-utils.js ${APPIUM_HOME}/node_modules/appium-base-driver/build/lib/basedriver/mcloud-utils.js


# wda build/lib files
cp ${APPIUM_HOME}/node_modules/appium-xcuitest-driver/build/lib/ios-deploy.js ${APPIUM_HOME}/node_modules/appium-xcuitest-driver/build/lib/ios-deploy.js.bak
cp /opt/mcloud/appium-xcuitest-driver/build/lib/ios-deploy.js ${APPIUM_HOME}/node_modules/appium-xcuitest-driver/build/lib/ios-deploy.js

cp ${APPIUM_HOME}/node_modules/appium-xcuitest-driver/build/lib/utils.js ${APPIUM_HOME}/node_modules/appium-xcuitest-driver/build/lib/utils.js.bak
cp /opt/mcloud/appium-xcuitest-driver/build/lib/utils.js ${APPIUM_HOME}/node_modules/appium-xcuitest-driver/build/lib/utils.js

