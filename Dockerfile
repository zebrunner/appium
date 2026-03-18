FROM appium/appium:v3.1.1-p0 AS appium

# Set environment variables
ENV ANDROID_DEVTOOLS_PORT=9222

ENV \
    # Device data
    PLATFORM_NAME="" \
    DEVICE_UDID="" \
    # Credentials for changing status of device
    STF_API_URL="" \
    STF_AUTH_TOKEN="" \
    # Integration UUID for ReDroid integration
    ROUTER_UUID="" \
    # Appium settings
    APPIUM_PORT=4723 \
    APPIUM_HOME=/usr/lib/node_modules/appium \
    APPIUM_APPS_DIR=/opt/appium-storage \
    APPIUM_CONFIG_DIR=/opt/config \
    APPIUM_APP_WAITING_TIMEOUT=600 \
    APPIUM_MAX_LOCK_FILE_LIFETIME=1800 \
    APPIUM_APP_FETCH_RETRIES=0 \
    APPIUM_CLI="" \
    APPIUM_APP_SIZE_DISABLE=false \
    APPIUM_PLUGINS="" \
    # Android settings
    REMOTE_ADB_HOST=connector \
    ADB_SERVER_SOCKET=tcp:connector:5037 \
    ADB_PORT=5037 \
    ANDROID_DEVICE="" \
    ADB_POLLING_SEC=5 \
    # Chromedriver settings
    CHROMEDRIVER_AUTODOWNLOAD=true \
    CHROMEDRIVER_PORT=8200 \
    # Chromedriver devtools port
    CHROME_OPTIONS="\"androidDevToolsPort\": ${ANDROID_DEVTOOLS_PORT}" \
    # Proxy settings
    PROXY_PORT=8080 \
    SERVER_PROXY_PORT=0 \
    # Log settings
    LOG_LEVEL=info \
    LOG_DIR=/tmp/log \
    TASK_LOG=/tmp/log/appium.log \
    LOG_FILE=session.log \
    # iOS settings
    WDA_HOST=connector \
    WDA_PORT=8100 \
    MJPEG_PORT=8101 \
    DEVICE_TIMEOUT=300 \
    WDA_LOG_FILE=/tmp/log/wda.log \
    SHARE_WDA_LOG=false \
    # Video recording settings
    BROADCAST_HOST=device \
    BROADCAST_PORT=2223 \
    FFMPEG_OPTS="" \
    RECORD_ARTIFACTS=true \
    # Timeout settings
    UNREGISTER_IF_STILL_DOWN_AFTER=3000 \
    # Default device bus settings
    DEVICE_BUS=/dev/bus/usb/003/011 \
    # Usbmuxd settings "host:port"
    USBMUXD_SOCKET_ADDRESS=connector:2222 \
    # Debug mode settings
    DEBUG=false \
    DEBUG_TIMEOUT=3600 \
    VERBOSE=false

USER root

# Create dir for apps
RUN mkdir -p $APPIUM_APPS_DIR && \
    chown -R androidusr:androidusr $APPIUM_APPS_DIR

# Create dir for appium config files
RUN mkdir -p $APPIUM_CONFIG_DIR && \
    chown -R androidusr:androidusr $APPIUM_CONFIG_DIR

# Create log dir
RUN mkdir -p $LOG_DIR  && \
    chown -R androidusr:androidusr $LOG_DIR

# Additional tools
RUN export DEBIAN_FRONTEND=noninteractive && \
    apt-get update && \
    apt-get -y install --no-install-recommends \
        iputils-ping nano jq telnet netcat-traditional curl ffmpeg \
        libimobiledevice-utils libimobiledevice6 usbmuxd socat inotify-tools && \
    rm -rf /var/lib/apt/lists/*

# Grab go-ios from github and extract it in a folder
ARG GO_IOS_VERSION=v1.0.204
RUN mkdir -p /tmp/go-ios && \
    wget -O /tmp/go-ios/go-ios-linux.zip https://github.com/danielpaulus/go-ios/releases/download/${GO_IOS_VERSION}/go-ios-linux.zip && \
    unzip /tmp/go-ios/go-ios-linux.zip -d /tmp/go-ios/ && \
    cp /tmp/go-ios/ios-amd64 /usr/local/bin/ios && \
    chown -R androidusr:androidusr /usr/local/bin/ios && \
    rm -rf /tmp/go-ios && \
    ios --version

# Entrypoint
ARG ENTRYPOINT_DIR=/opt/entrypoint
RUN mkdir -p ${ENTRYPOINT_DIR} && \
    chown -R androidusr:androidusr ${ENTRYPOINT_DIR}
COPY --chown=androidusr:androidusr \
    files/entrypoint.sh ${ENTRYPOINT_DIR}

USER androidusr

# Check and install drivers
RUN appium driver list && \
    appium plugin list && \
    appium driver install uiautomator2@6.7.15 && \
    appium driver install xcuitest@10.18.2

# Copy video recorder script & Zebrunner MCloud node config generator
COPY --chown=androidusr:androidusr \
    files/module/start-capture-artifacts.sh \
    files/util/debug.sh \
    files/module/android.sh \
    files/module/ios.sh \
    files/config/zbr-config-gen.sh \
    files/config/zbr-default-caps-gen.sh /opt/

# Healthcheck & Usbreset
COPY --chown=androidusr:androidusr \
    files/healthcheck \
    files/util/usbreset /usr/local/bin/

# Custom Mcloud patches
COPY --chown=androidusr:androidusr \
    files/patch/node_modules /opt/mcloud/
# Do not make backups because unpatched js files in the same folder might be used by Appium
RUN cp -r -v /opt/mcloud/* ${APPIUM_HOME}

# Check appium
RUN appium --version

# Override CMD to have PID=1 for the root process with ability to handle trap on SIGTERM
CMD ["/opt/entrypoint/entrypoint.sh"]

HEALTHCHECK --interval=10s --retries=3 CMD ["healthcheck"]

# ==============================
# Stage 2 — Appium Image Plugin
# ==============================
FROM appium AS appium-image

ARG EXTRA_MODULE_DIR=/opt/appium-extra
ENV APPIUM_PLUGINS=images \
    NODE_PATH=${EXTRA_MODULE_DIR}/node_modules:${APPIUM_HOME}/node_modules

# Install plugin
RUN appium plugin install images@4.1.0

USER root

# Install sharp in separate folder
RUN mkdir -p ${EXTRA_MODULE_DIR} && \
    chown -R androidusr:androidusr ${EXTRA_MODULE_DIR} && \
    npm install \
      --foreground-scripts \
      --loglevel verbose \
      --prefix ${EXTRA_MODULE_DIR} \
      --no-save \
      --package-lock=false \
      --include=optional \
      sharp@0.34.5

USER androidusr

# Check build
RUN node -p "process.env.NODE_PATH" && \
    node -p "require.resolve('sharp')" && \
    node -e "const s=require('sharp'); \
    console.log('Sharp version:'); \
    console.log(JSON.stringify({versions:s.versions.sharp, concurrency:s.concurrency(), platform: process.platform, arch: process.arch}, null, 2))"
