export $(cat .env | xargs)

cp $APPIUM_LOCATION/node_modules/appium-base-driver/lib/basedriver/helpers.js $APPIUM_LOCATION/node_modules/appium-base-driver/lib/basedriver/helpers.js.bak
cp ./appium-base-driver/lib/basedriver/helpers.js $APPIUM_LOCATION/node_modules/appium-base-driver/lib/basedriver/helpers.js
cp ./appium-base-driver/lib/basedriver/mcloud-utils.js $APPIUM_LOCATION/node_modules/appium-base-driver/lib/basedriver/mcloud-utils.js

cp $APPIUM_LOCATION/node_modules/appium-base-driver/build/lib/basedriver/helpers.js $APPIUM_LOCATION/node_modules/appium-base-driver/build/lib/basedriver/helpers.js.bak
cp ./appium-base-driver/build/lib/basedriver/helpers.js $APPIUM_LOCATION/node_modules/appium-base-driver/build/lib/basedriver/helpers.js
cp ./appium-base-driver/build/lib/basedriver/mcloud-utils.js $APPIUM_LOCATION/node_modules/appium-base-driver/build/lib/basedriver/mcloud-utils.js