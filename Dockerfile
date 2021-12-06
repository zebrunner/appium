FROM appium/appium:v1.22.0-p0

ENV PLATFORM_NAME=ANDROID
ENV DEVICE_UDID=

# add go-ios utility into the PATH
ENV PATH=/root/go-ios:$PATH

# Tasks management setting allowing serving several sequent requests.
ENV RETAIN_TASK=true

# Android envs
ENV REMOTE_ADB=false
ENV ANDROID_DEVICES=android:5555
ENV REMOTE_ADB_POLLING_SEC=5

ENV CHROMEDRIVER_AUTODOWNLOAD=true

# iOS envs
ENV WDA_HOST=
ENV WDA_PORT=8100
ENV MJPEG_PORT=8101
ENV WDA_BUNDLEID=com.facebook.WebDriverAgentRunner.xctrunner
ENV WDA_WAIT_TIMEOUT=30
ENV WDA_ENV=/etc/wda.env

# Screenrecord params
ENV SCREENRECORD_OPTS="--bit-rate 2000000"
ENV FFMPEG_OPTS=

# S3 storage params for driver artifacts (video, logs etc)
ENV BUCKET=
ENV TENANT=
ENV AWS_ACCESS_KEY_ID=
ENV AWS_SECRET_ACCESS_KEY=
ENV AWS_DEFAULT_REGION=


RUN apt-get update && \
	apt-get install -y awscli iputils-ping ffmpeg nano libimobiledevice-utils libimobiledevice6 usbmuxd cmake git build-essential jq

#Grab gidevice from github and extract it in a folder
RUN wget https://github.com/danielpaulus/go-ios/releases/latest/download/go-ios-linux.zip
RUN mkdir go-ios
RUN unzip go-ios-linux.zip -d go-ios
RUN rm go-ios-linux.zip

RUN mkdir -p /opt/logs
COPY files/capture-artifacts.sh /opt
COPY files/stop-capture-artifacts.sh /opt
COPY files/upload-artifacts.sh /opt
COPY files/concat-artifacts.sh /opt
COPY files/start-wda.sh /opt
COPY wireless_connect.sh /root
COPY local_connect.sh /root
COPY entry_point.sh /root

# Zebrunner MCloud node config generator
COPY files/configgen.sh /opt
COPY files/ios-capabilities-gen.sh /opt
COPY files/WebDriverAgent.ipa /opt

# Healthcheck
COPY files/healthcheck /usr/local/bin

#override CMD to have PID=1 for the root process with ability to handle trap on SIGTERM
CMD ["/root/entry_point.sh"]

HEALTHCHECK CMD ["healthcheck"]
