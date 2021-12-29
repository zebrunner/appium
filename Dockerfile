FROM appium/appium:v1.22.0-p0

ENV PLATFORM_NAME=ANDROID
ENV DEVICE_UDID=

# Tasks management setting allowing serving several sequent requests.
ENV RETAIN_TASK=true

# Android envs
ENV REMOTE_ADB=false
ENV ANDROID_DEVICES=android:5555
ENV REMOTE_ADB_POLLING_SEC=5

ENV CHROMEDRIVER_AUTODOWNLOAD=true

# iOS envs
ENV WDA_WAIT_TIMEOUT=30
ENV WDA_ENV=/opt/zebrunner/wda.env

# Screenrecord params
ENV SCREENRECORD_OPTS="--bit-rate 2000000"
ENV FFMPEG_OPTS=

# S3 storage params for driver artifacts (video, logs etc)
ENV BUCKET=
ENV TENANT=
ENV AWS_ACCESS_KEY_ID=
ENV AWS_SECRET_ACCESS_KEY=
ENV AWS_DEFAULT_REGION=

# Appium location for optimized downoading enabling
ENV APPIUM_LOCATION=/usr/lib/node_modules/appium

RUN apt-get update && \
	apt-get install -y awscli iputils-ping ffmpeg nano

COPY files/capture-artifacts.sh /opt
COPY files/stop-capture-artifacts.sh /opt
COPY files/upload-artifacts.sh /opt
COPY files/concat-artifacts.sh /opt
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

# Local apps downloader
COPY downloader/ /opt/downloader/

#override CMD to have PID=1 for the root process with ability to handle trap on SIGTERM
CMD ["/root/entry_point.sh"]

HEALTHCHECK CMD ["healthcheck"]
