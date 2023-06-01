FROM appium/appium:v2.0.b63-p2

ENV PLATFORM_NAME=ANDROID
ENV DEVICE_UDID=

# Tasks management setting allowing serving several sequent requests.
ENV RETAIN_TASK=true

# Enable local caching for appium instances
ENV MCLOUD=false
ENV APPIUM_PORT=4723
ENV APPIUM_HOME=/usr/lib/node_modules/appium
ENV APPIUM_APPS_DIR=/opt/appium-storage
ENV APPIUM_APP_WAITING_TIMEOUT=600
ENV APPIUM_MAX_LOCK_FILE_LIFETIME=1800
ENV APPIUM_CLI=

# Default appium 2.0 ueser:
# uid=1300(androidusr) gid=1301(androidusr) groups=1301(androidusr)

USER root
RUN mkdir -p $APPIUM_APPS_DIR && \
	chown androidusr:androidusr $APPIUM_APPS_DIR

# Android envs
ENV REMOTE_ADB=false
ENV ANDROID_DEVICES=android:5555
ENV REMOTE_ADB_POLLING_SEC=5
ENV EXIT_ON_ADB_FAILURE=0

ENV CHROMEDRIVER_AUTODOWNLOAD=true

# iOS envs
ENV WDA_HOST=localhost
ENV WDA_PORT=8100
ENV MJPEG_PORT=8101
ENV WDA_WAIT_TIMEOUT=30
ENV WDA_ENV=/opt/zebrunner/wda.env
ENV WDA_LOG_FILE=/opt/zebrunner/wda.log
ENV WDA_BUNDLEID=com.facebook.WebDriverAgentRunner.xctrunner

ENV P12FILE=/opt/zebrunner/mcloud.p12
ENV P12PASSWORD=

# Screenrecord params
ENV SCREENRECORD_OPTS="--bit-rate 2000000"
ENV FFMPEG_OPTS=

# S3 storage params for driver artifacts (video, logs etc)
ENV BUCKET=
ENV TENANT=
ENV AWS_ACCESS_KEY_ID=
ENV AWS_SECRET_ACCESS_KEY=
ENV AWS_DEFAULT_REGION=

# Timeout settings
ENV UNREGISTER_IF_STILL_DOWN_AFTER=60000

# #86 move usbreset onto the appium side
ENV DEVICE_BUS=/dev/bus/usb/003/011

#Setup libimobile device, usbmuxd and some tools
RUN export DEBIAN_FRONTEND=noninteractive && apt-get update && apt-get -y install awscli iputils-ping ffmpeg nano jq unzip telnet netcat wget curl libimobiledevice-utils libimobiledevice6 usbmuxd socat

#Grab gidevice from github and extract it in a folder
RUN wget https://github.com/danielpaulus/go-ios/releases/download/v1.0.113/go-ios-linux.zip
# https://github.com/danielpaulus/go-ios/releases/latest/download/go-ios-linux.zip
RUN unzip go-ios-linux.zip -d /usr/local/bin

COPY files/start-capture-artifacts.sh /opt
COPY files/stop-capture-artifacts.sh /opt
COPY files/upload-artifacts.sh /opt
COPY files/concat-video-recordings.sh /opt
COPY files/reset-logs.sh /opt

# Zebrunner MCloud node config generator
COPY files/android.sh /opt
COPY files/ios.sh /opt
COPY files/start-wda.sh /opt
COPY files/check-wda.sh /opt
COPY files/zbr-config-gen.sh /opt
COPY files/zbr-default-caps-gen.sh /opt

#TODO: review and adjust all appium 1.x diffs and patches
# Custom mcloud patches
#COPY files/mcloud/ /opt/mcloud/
COPY files/mcloud/ ${APPIUM_HOME}/
RUN ls -la ${APPIUM_HOME}/node_modules/@appium/base-driver/build/lib/protocol/routes.js

ENV ENTRYPOINT_DIR=/opt/entrypoint
RUN mkdir -p ${ENTRYPOINT_DIR}
COPY entrypoint.sh ${ENTRYPOINT_DIR}
COPY wireless_connect.sh ${ENTRYPOINT_DIR}
COPY local_connect.sh ${ENTRYPOINT_DIR}

#TODO: think about entrypoint container usage to apply permission fixes
#RUN chown -R androidusr:androidusr $ENTRYPOINT_DIR

# Healthcheck
COPY files/healthcheck /usr/local/bin
COPY files/usbreset /usr/local/bin

#TODO: migrate everything to androiduser
#USER androidusr


RUN appium driver list && \
	appium plugin list

#TODO:/ think about different images per each device platform
RUN appium driver install uiautomator2 && \
	appium driver install xcuitest

#override CMD to have PID=1 for the root process with ability to handle trap on SIGTERM
CMD ["/opt/entrypoint/entrypoint.sh"]

HEALTHCHECK --interval=10s --retries=3 CMD ["healthcheck"]
