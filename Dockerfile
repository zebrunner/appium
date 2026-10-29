# check=skip=SecretsUsedInArgOrEnv
# STF_AUTH_TOKEN is declared empty as documentation of the supported env vars; the real value is passed at runtime
FROM appium/appium:v3.1.1-p0 AS appium

# The base image is linux/amd64 only (Android platform-tools, OpenJDK path): another platform would build
# an image with amd64 binaries, so the build stops
ARG TARGETARCH
RUN if [ -n "${TARGETARCH}" ] && [ "${TARGETARCH}" != "amd64" ]; then \
      echo "[error] the image is linux/amd64 only: the base image appium/appium is amd64 only, got ${TARGETARCH}" >&2; \
      exit 1; \
    fi

# The layers go from the rarely to the often changed ones: the packages and the drivers are kept in the build
# cache when the env vars, the scripts or the patch change

USER root

# Additional tools
RUN export DEBIAN_FRONTEND=noninteractive && \
    apt-get update && \
    apt-get -y install --no-install-recommends \
        iputils-ping nano jq telnet netcat-traditional curl ffmpeg \
        libimobiledevice-utils libimobiledevice6 socat inotify-tools openssh-client && \
    # androidusr of the base image is a sudoer without a password: the user of Appium gets no root
    export SUDO_FORCE_REMOVE=yes && apt-get -y purge sudo && \
    gpasswd -d androidusr sudo && \
    rm -rf /var/lib/apt/lists/*

# The Appium of the base image: the drivers are installed and the patch is copied into APPIUM_HOME (the base
# image keeps its own drivers in ~/.appium); a new base image may move Appium, tests/image_test.sh checks it
ENV APPIUM_HOME=/usr/lib/node_modules/appium
RUN appium_dir="$(dirname "$(readlink -f "$(command -v appium)")")" && \
    if [ "${appium_dir}" != "${APPIUM_HOME}" ]; then \
      echo "[error] APPIUM_HOME is ${APPIUM_HOME} but the Appium of the base image is in ${appium_dir}" >&2; \
      exit 1; \
    fi

USER androidusr

# Check and install drivers
RUN appium driver list && \
    appium plugin list && \
    appium driver install uiautomator2@6.7.15 && \
    appium driver install xcuitest@10.18.2

# Set environment variables
ENV ANDROID_DEVTOOLS_PORT=9222

ENV \
    # Device data
    PLATFORM_NAME="" \
    DEVICE_UDID="" \
    # Credentials for changing status of device
    STF_API_URL="" \
    STF_AUTH_TOKEN="" \
    # the id of an external orchestrator of the device (e.g. on-demand emulators): the name of the recording artifacts
    ROUTER_UUID="" \
    # Appium settings
    APPIUM_PORT=4723 \
    APPIUM_APPS_DIR=/opt/appium-storage \
    APPIUM_CONFIG_DIR=/opt/config \
    APPIUM_APP_WAITING_TIMEOUT=600 \
    APPIUM_MAX_LOCK_FILE_LIFETIME=1800 \
    APPIUM_APP_FETCH_RETRIES=3 \
    APPIUM_APPS_MAX_AGE=7 \
    APPIUM_APPS_MIN_FREE=10 \
    APPIUM_CLI="" \
    APPIUM_APP_SIZE_DISABLE=false \
    APPIUM_PLUGINS="" \
    # Android settings
    REMOTE_ADB_HOST=connector \
    ADB_SERVER_SOCKET=tcp:connector:5037 \
    ADB_PORT=5037 \
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
    # Usbmuxd settings "host:port"
    USBMUXD_SOCKET_ADDRESS=connector:2222 \
    # Simulators: xcrun of the macOS host over ssh through the connector
    DEVICE_CONNECTION="" \
    HOST_SSH_USER="" \
    HOST_SSH_HOST=connector \
    HOST_SSH_PORT=22 \
    HOST_SSH_KEY=/opt/zebrunner/ssh/id_ed25519 \
    # Debug mode settings
    LOGGER_LEVEL=INFO \
    DEBUG=false \
    DEBUG_TIMEOUT=3600 \
    VERBOSE=false

USER root

# The dirs of the apps, the configs, the logs and the entrypoint; the usbmuxd socket forwarded by ios.sh is in
# a dir of androidusr, /var/run is root only; xcrun of the simulators mirrors the app paths of the macOS host in /Users
# and /Library/Developer/CoreSimulator
ARG ENTRYPOINT_DIR=/opt/entrypoint
RUN mkdir -p ${APPIUM_APPS_DIR} ${APPIUM_CONFIG_DIR} ${LOG_DIR} /tmp/usbmuxd ${ENTRYPOINT_DIR} /Users /Library/Developer/CoreSimulator && \
    chown -R androidusr:androidusr ${APPIUM_APPS_DIR} ${APPIUM_CONFIG_DIR} ${LOG_DIR} /tmp/usbmuxd ${ENTRYPOINT_DIR} /Users /Library/Developer/CoreSimulator && \
    ln -s /tmp/usbmuxd/usbmuxd /var/run/usbmuxd && \
    ln -s /usr/local/bin/xcrun /usr/local/bin/lipo

USER androidusr

# Video recorder script, device modules & Zebrunner MCloud node config generator
COPY --chown=androidusr:androidusr \
    files/module/start-capture-artifacts.sh \
    files/util/debug.sh \
    files/util/logger.sh \
    files/module/android.sh \
    files/module/ios.sh \
    files/config/zbr-config-gen.sh \
    files/config/zbr-default-caps-gen.sh /opt/

# Healthcheck, Usbreset & xcrun of the macOS host for the simulators
COPY --chown=androidusr:androidusr \
    files/healthcheck \
    files/util/xcrun /usr/local/bin/

COPY --chown=androidusr:androidusr \
    files/entrypoint.sh ${ENTRYPOINT_DIR}/

# Custom Mcloud patches of @appium/base-driver, over the installed files
# Do not make backups because unpatched js files in the same folder might be used by Appium
COPY --chown=androidusr:androidusr \
    files/patch/node_modules/ ${APPIUM_HOME}/node_modules/

ARG VERSION=dev
LABEL org.opencontainers.image.title="Zebrunner MCloud Appium" \
      org.opencontainers.image.description="Appium for the Android and iOS devices of Zebrunner MCloud" \
      org.opencontainers.image.source="https://github.com/zebrunner/appium" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.version="${VERSION}"

# The entrypoint is PID 1 to handle SIGTERM: no ENTRYPOINT of the base image (e.g. sh -c) runs it
ENTRYPOINT []
CMD ["/opt/entrypoint/entrypoint.sh"]

# Appium starts in 10-30 s, an iOS container waits for WDA up to DEVICE_TIMEOUT
HEALTHCHECK --interval=10s --timeout=10s --start-period=60s --retries=3 CMD ["healthcheck"]

# ==============================
# Stage 2 - Appium Image Plugin
# ==============================
FROM appium AS appium-image

ARG EXTRA_MODULE_DIR=/opt/appium-extra
ENV APPIUM_PLUGINS=images \
    NODE_PATH=${EXTRA_MODULE_DIR}/node_modules:${APPIUM_HOME}/node_modules

# Install plugin
RUN appium plugin install images@4.1.0

USER root

# Install sharp in separate folder
# sharp is pinned; hadolint takes the --prefix value for an unpinned package
# hadolint ignore=DL3016
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
