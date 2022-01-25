#FROM appium/appium:v1.22.0-p0
FROM appium:v1.22.2-p0

ENV PLATFORM_NAME=ANDROID
ENV DEVICE_UDID=

# Tasks management setting allowing serving several sequent requests.
ENV RETAIN_TASK=true

# Enable local caching for appium instances
ENV MCLOUD=false
ENV APPIUM_HOME=/usr/lib/node_modules/appium
ENV APPIUM_APPS_DIR=/opt/appium-storage
ENV APPIUM_APP_WAITING_TIMEOUT=600
RUN mkdir -p $APPIUM_APPS_DIR

# Android envs
ENV REMOTE_ADB=false
ENV ANDROID_DEVICES=android:5555
ENV REMOTE_ADB_POLLING_SEC=5

ENV CHROMEDRIVER_AUTODOWNLOAD=true

# iOS envs
ENV WDA_PORT=8100
ENV MJPEG_PORT=8101
ENV WDA_WAIT_TIMEOUT=30
ENV WDA_ENV=/opt/zebrunner/wda.env
ENV WDA_LOG_FILE=/opt/zebrunner/wda.log
ENV WDA_BUNDLEID=com.facebook.WebDriverAgentRunner.xctrunner

ENV P12FILE=/opt/zebrunner/mcloud.p12
ENV P12PASSWORD=

RUN mkdir -p /opt/zebrunner/DeveloperDiskImages

# Screenrecord params
ENV SCREENRECORD_OPTS="--bit-rate 2000000"
ENV FFMPEG_OPTS=

# S3 storage params for driver artifacts (video, logs etc)
ENV BUCKET=
ENV TENANT=
ENV AWS_ACCESS_KEY_ID=
ENV AWS_SECRET_ACCESS_KEY=
ENV AWS_DEFAULT_REGION=

#Setup libimobile device, usbmuxd and some tools
RUN export DEBIAN_FRONTEND=noninteractive && apt-get update && apt-get -y install awscli iputils-ping ffmpeg nano jq unzip  wget curl libimobiledevice-utils libimobiledevice6 usbmuxd

#Grab gidevice from github and extract it in a folder
RUN wget https://github.com/danielpaulus/go-ios/releases/download/v1.0.42/go-ios-linux.zip
# https://github.com/danielpaulus/go-ios/releases/latest/download/go-ios-linux.zip
RUN unzip go-ios-linux.zip -d /usr/local/bin

COPY files/start-capture-artifacts.sh /opt
COPY files/stop-capture-artifacts.sh /opt
COPY files/upload-artifacts.sh /opt
COPY files/concat-video-recordings.sh /opt
COPY files/reset-logs.sh /opt
COPY wireless_connect.sh /root
COPY local_connect.sh /root
COPY entry_point.sh /root

# Zebrunner MCloud node config generator
COPY files/android.sh /opt
COPY files/ios.sh /opt
COPY files/zbr-config-gen.sh /opt
COPY files/zbr-default-caps-gen.sh /opt

# Healthcheck
COPY files/healthcheck /usr/local/bin

# Custom mclout patches
COPY files/mcloud/ /opt/mcloud/

#override CMD to have PID=1 for the root process with ability to handle trap on SIGTERM
CMD ["/root/entry_point.sh"]

HEALTHCHECK CMD ["healthcheck"]
