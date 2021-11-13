FROM appium/appium:v1.22.0-p0

# ESG tasks management setting. Allow different requests for one task if true
ENV RETAIN_TASK=false

# ESG<->ReDroid default integration args
ENV REMOTE_ADB=true
ENV ANDROID_DEVICES=android:5555
ENV REMOTE_ADB_POLLING_SEC=5
ENV CHROMEDRIVER_AUTODOWNLOAD=true
ENV SCREENRECORD_OPTS=
ENV FFMPEG_OPTS=

# ESG S3 storage params for driver artifacts (video, logs etc)
ENV BUCKET=
ENV TENANT=
ENV AWS_ACCESS_KEY_ID=
ENV AWS_SECRET_ACCESS_KEY=
ENV AWS_DEFAULT_REGION=

RUN apt-get update && apt-get install -y awscli iputils-ping ffmpeg nano

COPY capture-screen.sh /root
COPY concat-video.sh /root
COPY wireless_connect.sh /root
COPY entry_point.sh /root

#override CMD to have PID=1 for the root process with ability to handle trap on SIGTERM
CMD ["/root/entry_point.sh"]
