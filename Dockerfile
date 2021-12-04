FROM appium/appium:v1.22.0-p0

# Tasks management setting allowing serving several sequent requests.
ENV RETAIN_TASK=true

# Android Appium params 
ENV REMOTE_ADB=false
ENV ANDROID_DEVICES=android:5555
ENV REMOTE_ADB_POLLING_SEC=5

ENV CHROMEDRIVER_AUTODOWNLOAD=true

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
	apt-get install -y awscli iputils-ping ffmpeg nano libimobiledevice-utils libimobiledevice6 usbmuxd cmake git build-essential

#Grab gidevice from github and extract it in a folder
RUN wget https://github.com/danielpaulus/go-ios/releases/latest/download/go-ios-linux.zip
RUN mkdir go-ios
RUN unzip go-ios-linux.zip -d go-ios

COPY capture-artifacts.sh /root
COPY file/stop-capture-artifacts.sh /opt
COPY upload-artifacts.sh /root
COPY concat-artifacts.sh /root
COPY wireless_connect.sh /root
COPY local_connect.sh /root
COPY entry_point.sh /root

# Zebrunner MCloud node config generator
COPY files/configgen.sh /opt
COPY files/WebDriverAgent.ipa /opt

#override CMD to have PID=1 for the root process with ability to handle trap on SIGTERM
CMD ["/root/entry_point.sh"]
