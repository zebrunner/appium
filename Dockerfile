FROM appium/appium:v3.1.1-p0

# Device data
ENV PLATFORM_NAME=""
ENV DEVICE_UDID=""

# Credentials for changing status of device
ENV STF_API_URL=""
ENV STF_AUTH_TOKEN=""

# Integration UUID for ReDroid integration
ENV ROUTER_UUID=""

# Appium settings
ENV APPIUM_PORT=4723
ENV APPIUM_HOME=/usr/lib/node_modules/appium
ENV APPIUM_APPS_DIR=/opt/appium-storage
ENV APPIUM_APP_WAITING_TIMEOUT=600
ENV APPIUM_MAX_LOCK_FILE_LIFETIME=1800
ENV APPIUM_APP_FETCH_RETRIES=0
ENV APPIUM_CLI=""
ENV APPIUM_APP_SIZE_DISABLE=false
ENV APPIUM_PLUGINS=""

# Create dir for apps
USER root
RUN mkdir -p $APPIUM_APPS_DIR && \
	chown androidusr:androidusr $APPIUM_APPS_DIR

# Android settings
ENV REMOTE_ADB_HOST=connector
ENV ADB_SERVER_SOCKET=tcp:connector:5037
ENV ADB_PORT=5037
ENV ANDROID_DEVICE=""
ENV ADB_POLLING_SEC=5

ENV CHROMEDRIVER_AUTODOWNLOAD=true
ENV CHROMEDRIVER_PORT=8200
# Chromedriver devtools port
ENV ANDROID_DEVTOOLS_PORT=9222
ENV CHROME_OPTIONS="\"androidDevToolsPort\": ${ANDROID_DEVTOOLS_PORT}"

# Proxy settings
ENV PROXY_PORT=8080
ENV SERVER_PROXY_PORT=0

# Log settings
ENV LOG_LEVEL=info
ENV LOG_DIR=/tmp/log
ENV TASK_LOG=/tmp/log/appium.log
ENV LOG_FILE=session.log

# iOS settings
ENV WDA_HOST=connector
ENV WDA_PORT=8100
ENV MJPEG_PORT=8101
ENV DEVICE_TIMEOUT=300
ENV WDA_LOG_FILE=/tmp/log/wda.log
ENV SHARE_WDA_LOG=false

# Video recording settings
ENV BROADCAST_HOST=device
ENV BROADCAST_PORT=2223
ENV FFMPEG_OPTS=""
ENV RECORD_ARTIFACTS=true

# Timeout settings
ENV UNREGISTER_IF_STILL_DOWN_AFTER=3000

# Default device bus settings
ENV DEVICE_BUS=/dev/bus/usb/003/011

# Usbmuxd settings "host:port"
ENV USBMUXD_SOCKET_ADDRESS=connector:2222

# Debug mode settings
ENV DEBUG=false
ENV DEBUG_TIMEOUT=3600
ENV VERBOSE=false

# Additional tools
RUN export DEBIAN_FRONTEND=noninteractive && \
    apt-get update && \
    apt-get -y install --no-install-recommends \
        iputils-ping nano jq telnet netcat-traditional curl ffmpeg \
        libimobiledevice-utils libimobiledevice6 usbmuxd socat inotify-tools && \
    rm -rf /var/lib/apt/lists/*

# Grab go-ios from github and extract it in a folder
ARG GO_IOS_VERSION=v1.0.182
RUN mkdir -p /tmp/go-ios && \
    wget -O /tmp/go-ios/go-ios-linux.zip https://github.com/danielpaulus/go-ios/releases/download/${GO_IOS_VERSION}/go-ios-linux.zip && \
    unzip /tmp/go-ios/go-ios-linux.zip -d /tmp/go-ios/ && \
    cp /tmp/go-ios/ios-amd64 /usr/local/bin/ios && \
    rm -rf /tmp/go-ios && \
    ios --version

# Check and install drivers
RUN appium driver list && \
    appium plugin list

RUN appium driver install uiautomator2@6.7.15 && \
    appium driver install xcuitest@10.18.2

# Copy video recorder script
COPY files/start-capture-artifacts.sh /opt

# Zebrunner MCloud node config generator
COPY files/debug.sh /opt
COPY files/android.sh /opt
COPY files/ios.sh /opt
COPY files/zbr-config-gen.sh /opt
COPY files/zbr-default-caps-gen.sh /opt

# Entrypoint
ARG ENTRYPOINT_DIR=/opt/entrypoint
RUN mkdir -p ${ENTRYPOINT_DIR}
COPY entrypoint.sh ${ENTRYPOINT_DIR}

# TODO: think about entrypoint container usage to apply permission fixes
#RUN chown -R androidusr:androidusr $ENTRYPOINT_DIR

# Healthcheck
COPY files/healthcheck /usr/local/bin

# Usbreset
COPY files/usbreset /usr/local/bin

# TODO: migrate everything to androiduser
#USER androidusr

# Custom Mcloud patches
COPY files/mcloud/ /opt/mcloud
# Do not make backups because unpatched js files in the same folder might be used by Appium
RUN cp -r -v /opt/mcloud/* ${APPIUM_HOME}

# Check appium
RUN appium --version

# Override CMD to have PID=1 for the root process with ability to handle trap on SIGTERM
CMD ["/opt/entrypoint/entrypoint.sh"]

HEALTHCHECK --interval=10s --retries=3 CMD ["healthcheck"]
