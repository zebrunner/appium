FROM appium/appium:v2.2.2-p2
ENV PLATFORM_NAME=ANDROID
ENV DEVICE_UDID=

# Integration UUID for ReDroid integration
ENV ROUTER_UUID=

# Enable local caching for appium instances
ENV APPIUM_PORT=4723
ENV APPIUM_HOME=/usr/lib/node_modules/appium
ENV APPIUM_APPS_DIR=/opt/appium-storage
ENV APPIUM_APP_WAITING_TIMEOUT=600
ENV APPIUM_MAX_LOCK_FILE_LIFETIME=1800
ENV APPIUM_APP_FETCH_RETRIES=0
ENV APPIUM_APP_SIZE_DISABLE=false

################################################
######### NODE CONFIGURATION VARIABLES #########
# Hub hostname or IP address
ENV SELENIUM_HOST localhost
# Hub port
ENV SELENIUM_PORT 4444
# How often, in seconds, the Node will try to register itself for the first time to the Distributor.
ENV REGISTER_CYCLE 300
# How long, in seconds, will the Node try to register to the Distributor for the first time.
# After this period is completed, the Node will not attempt to register again.
ENV REGISTER_PERIOD 1000
# How often, in seconds, will the Node send heartbeat events to the Distributor to inform it that the Node is up.
ENV HEARTBEAT_PERIOD 5
# Let X be the session-timeout in seconds.
# The Node will automatically kill a session that has not had any activity in the last X seconds.
# This will release the slot for other tests.
ENV GRID_BROWSER_TIMEOUT 180
#todo add description
ENV PUBLISH_EVENTS_PORT 4442
#todo add description
ENV SUBSCRIBE_EVENTS_PORT 4443
# Log level. Default logging level is INFO. Log levels are described here
# https://docs.oracle.com/javase/7/docs/api/java/util/logging/Level.html
ENV NODE_LOG_LEVEL INFO
ENV HTTP_LOGS false
################################################

# Default appium 2.0 ueser:
# uid=1300(androidusr) gid=1301(androidusr) groups=1301(androidusr)

USER root
RUN mkdir -p $APPIUM_APPS_DIR && \
	chown androidusr:androidusr $APPIUM_APPS_DIR

# Android envs
ENV ADB_PORT=5037
ENV ANDROID_DEVICE=
ENV ADB_POLLING_SEC=5

ENV PROXY_PORT=8080
ENV SERVER_PROXY_PORT=0

ENV CHROMEDRIVER_AUTODOWNLOAD=true

# Log settings
ENV LOG_LEVEL=info
ENV LOG_DIR=/tmp/log
ENV TASK_LOG=/tmp/log/appium.log
ENV LOG_FILE=session.log
ENV VIDEO_LOG=/tmp/log/appium-video.log
ENV VIDEO_LOG_FILE=video.log

# iOS envs
ENV WDA_HOST=localhost
ENV WDA_PORT=8100
ENV MJPEG_PORT=8101
ENV WDA_WAIT_TIMEOUT=30
ENV WDA_LOG_FILE=/tmp/log/wda.log
ENV WDA_BUNDLEID=com.facebook.WebDriverAgentRunner.xctrunner
ENV WDA_FILE=/tmp/zebrunner/WebDriverAgent.ipa

# Screenrecord params
ENV SCREENRECORD_OPTS="--bit-rate 2000000"
ENV FFMPEG_OPTS=

# Timeout settings
ENV UNREGISTER_IF_STILL_DOWN_AFTER=60000

# #86 move usbreset onto the appium side
ENV DEVICE_BUS=/dev/bus/usb/003/011

# Usbmuxd settings "host:port"
ENV USBMUXD_SOCKET_ADDRESS=

# Debug mode vars
ENV DEBUG=false
ENV DEBUG_TIMEOUT=3600
ENV VERBOSE=false

#Setup libimobile device, usbmuxd and some tools
RUN export DEBIAN_FRONTEND=noninteractive && apt-get update && apt-get -y install iputils-ping nano jq telnet netcat curl ffmpeg libimobiledevice-utils libimobiledevice6 usbmuxd socat

#Grab gidevice from github and extract it in a folder
RUN wget https://github.com/danielpaulus/go-ios/releases/download/v1.0.120/go-ios-linux.zip
# https://github.com/danielpaulus/go-ios/releases/latest/download/go-ios-linux.zip
RUN unzip go-ios-linux.zip -d /usr/local/bin

COPY files/start-capture-artifacts.sh /opt

# Zebrunner MCloud node config generator
COPY files/debug.sh /opt
COPY files/android.sh /opt
COPY files/ios.sh /opt
COPY files/start-wda.sh /opt
COPY files/check-wda.sh /opt
COPY files/zbr-config-gen.sh /opt
COPY files/zbr-default-caps-gen.sh /opt

COPY target/mcloud-node-1.0.jar \
    /opt
COPY target/mcloud-node.jar \
    /opt

COPY agent/target/mcloud-node-agent-1.0.jar \
    /opt
COPY agent/target/mcloud-node-agent.jar \
    /opt

ENV ENTRYPOINT_DIR=/opt/entrypoint
RUN mkdir -p ${ENTRYPOINT_DIR}
COPY entrypoint.sh ${ENTRYPOINT_DIR}
COPY device_connect.sh ${ENTRYPOINT_DIR}

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
	appium driver install xcuitest@5.7.0

# Custom mcloud patches
COPY files/mcloud/ /opt/mcloud
# do not make backups because unpatched js files in the same folder might be used by Appium
RUN cp -r -v /opt/mcloud/* ${APPIUM_HOME}

#override CMD to have PID=1 for the root process with ability to handle trap on SIGTERM
CMD ["/opt/entrypoint/entrypoint.sh"]

HEALTHCHECK --interval=10s --retries=3 CMD ["healthcheck"]
