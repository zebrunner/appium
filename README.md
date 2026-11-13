# Zebrunner MCloud Appium

Enhanced Appium docker image for testing on Android and iOS devices: phones, tablets, Android TV, Apple TV (tvOS), Android emulators and iOS simulators.

- It is built on top of [Appium](https://github.com/appium/appium/) and supports:
  - iOS devices of Linux and macOS hosts (usbmuxd of the connector container), wireless iOS and tvOS devices and the iOS / tvOS simulators of a macOS host
  - Integration with [STF](https://github.com/zebrunner/stf) for remote manual testing
  - Cached local storage to minimize download calls to external resources (S3, AppCenter, Azure, etc.)
  - Video recording of every session, including Apple TV and Android TV
  - Video recording for pre-conditions and mapping with test results in [Zebrunner Reporting](https://zebrunner.com/)

Feel free to support the development with a [**donation**](https://www.paypal.com/donate/?hosted_button_id=MNHYYCYHAKUVA) for the next improvements.

<p align="center">
  <a href="https://zebrunner.com/"><img alt="Zebrunner" src="https://github.com/zebrunner/zebrunner/raw/master/docs/img/zebrunner_intro.png"></a>
</p>

> Follow the installation and configuration guide in [MCloud](https://github.com/zebrunner/mcloud) to reuse this image effectively.

## Image contents

| Component | Version |
| --- | --- |
| Base image | `appium/appium:v3.1.1-p0` (Appium 3.1.1) |
| UiAutomator2 driver | 6.7.15 |
| XCUITest driver | 10.18.2 |
| images plugin, `appium-image` stage | 4.1.0 (with sharp 0.34.5) |
| Playwright driver (`files/playwright`) | playwright-core 1.65.0, see [Playwright](#playwright) |

The Appium base driver is patched for MCloud (`files/patch`): recording markers, the shared application storage, the device status endpoints and the STF device updates.

## Build

```bash
make build VERSION=3.1.1                          # public.ecr.aws/zebrunner/appium:3.1.1, the `appium` stage
make build VERSION=3.1.1-img TARGET=appium-image  # plus the Appium images plugin and sharp
make push VERSION=3.1.1                           # built by docker buildx and pushed: docker login public.ecr.aws first
```

The image is `linux/amd64` only: the build of another platform is rejected, on Apple Silicon it is built emulated.
`IMAGE_REPO` sets another repository, `VERSION` is the tag and the `org.opencontainers.image.version` label (`dev` by
default, required by `push`). `make push` uses the buildx builder `mcloud` (docker-container driver), which it creates
once.

The file `VERSION` is the release in work (bumped by hand after a release, CONVENTIONS.md#versions). The `publish` job of CI pushes the image of every merge into `develop` after all the checks passed: `public.ecr.aws/zebrunner/appium:<VERSION>-develop-<sha>` (7 characters of the commit) and `<VERSION>-develop-latest`, the newest commit of `develop`.

## Run

In MCloud every device has four containers, created by [mcloud-agent](https://github.com/zebrunner/mcloud-agent) (`roles/*devices/templates/zebrunner-farm` is the reference of all the options):

- `connector`: the adb server (Android) or usbmuxd and WebDriverAgent (iOS) of the device
- `device`: the STF provider and the screen broadcast of the device
- `appium`: this image
- `uploader`: uploads the artifacts of `/tmp/log` to S3

The appium container reaches the others by the host names `connector` and `device` (`--link` or network aliases) and shares two volumes: the application storage of the host and the artifacts volume of the device with the uploader.

```bash
# Android
docker run -d --name device-pixel-appium --net mcloud --restart on-failure:5 \
  --link device-pixel-connector:connector --link device-pixel:device \
  -v appium-storage-volume:/opt/appium-storage -v device-pixel:/tmp/log \
  -e PLATFORM_NAME=android -e DEVICE_UDID=<udid> -e DEVICE_NAME=Pixel \
  -e CONNECT_TO_GRID=true -e SELENIUM_HOST=<hub host> -e SELENIUM_PORT=4444 -e STF_PROVIDER_HOST=<host ip> \
  -e DEFAULT_CAPABILITIES=true -e RELAXED_SECURITY=true \
  -e STF_API_URL=<stf url>/api/v1 -e STF_AUTH_TOKEN=<token> \
  -e APPIUM_PORT=4723 -p 4723:4723 \
  public.ecr.aws/zebrunner/appium:<tag>

# iOS: the same with
#   -e PLATFORM_NAME=ios -e WDA_HOST=connector -e APPIUM_CLI=--session-override
# a simulator of the macOS host: -e WIRELESS=true -e DEVICE_CONNECTION=ios-sim -e HOST_SSH_USER=<user of the host>
#   -v <private ssh key>:/opt/zebrunner/ssh/id_ed25519:ro
```

## Configuration

The container is configured with environment variables; the defaults are the values of the image. In MCloud they are set by [mcloud-agent](https://github.com/zebrunner/mcloud-agent).

### Device

| Variable | Default | Description |
| --- | --- | --- |
| `PLATFORM_NAME` | | `android` or `ios` (any case): the device module to run, the default capabilities and the video source |
| `DEVICE_UDID` | | the udid of the device: capabilities, `/status-adb`, STF updates |
| `DEVICE_NAME` | | the device name in the node config and the default capabilities |
| `ANDROID_DEVICES` | | `/status-adb` looks for this name when `DEVICE_UDID` is empty |

`PLATFORM_VERSION`, `DEVICETYPE` (Phone, Tablet, TV) and `AUTOMATION_NAME` are detected by the device module at startup.

### Appium

| Variable | Default | Description |
| --- | --- | --- |
| `APPIUM_PORT` | `4723` | the port of Appium, the base path is `/wd/hub` |
| `PATH`, `JAVA_HOME`, `ANDROID_HOME`, `TZ` | the ones of the base image | the platform-tools and build-tools of the Android SDK in `/opt/android`, Java 17 of `apksigner`, UTC; the other variables of the base image (versions, the paths of its build) are not kept |
| `APPIUM_CLI` | | extra Appium arguments, e.g. `--session-override` |
| `APPIUM_PLUGINS` | | the plugins to use (`--use-plugins`), `images` in the `appium-image` stage |
| `NODE_PATH` | `appium-image` stage: `/opt/appium-extra/node_modules:${APPIUM_HOME}/node_modules` | where Node finds sharp (installed apart from Appium) for the images plugin |
| `LOG_LEVEL` | `info` | the Appium log level |
| `RELAXED_SECURITY` | | `true` enables all insecure features (`--relaxed-security`) for every session: `mobile: shell` (`adb_shell`), the Appium log of the earlier sessions of the device (`get_server_logs`), the emulator console, the screen streaming, the download of chromedriver; prefer `ADB_SHELL` and `CHROMEDRIVER_AUTODOWNLOAD` for the features the tests need |
| `CHROMEDRIVER_AUTODOWNLOAD` | `true` | allows `*:chromedriver_autodownload` (mobile web on Android) |
| `ADB_SHELL` | | `true` allows `*:adb_shell` (`mobile: shell`) |
| `DEFAULT_CAPABILITIES` | | `true` passes the capabilities of the device (udid, connector hosts and ports) to every session; nothing is passed for other platforms than `android` and `ios` |
| `APPIUM_CONFIG_DIR` | `/opt/config` | the generated `nodeconfig.json` and `defaultcapabilities.json` |

### Selenium Grid (mcloud-grid)

| Variable | Default | Description |
| --- | --- | --- |
| `CONNECT_TO_GRID` | | `true` registers Appium in [mcloud-grid](https://github.com/zebrunner/mcloud-grid) with a generated node config (`MobileRemoteProxy`) |
| `SELENIUM_HOST`, `SELENIUM_PORT` | | the hub, required with `CONNECT_TO_GRID=true` |
| `STF_PROVIDER_HOST` | | the host of the node url, required with `CONNECT_TO_GRID=true` |
| `NODE_REGISTRATION_TOKEN` | | the node token of the device host (`mcn1.<label>.<secret>`) the node registers with, which mcloud-agent passes from its `MCLOUD_NODE_TOKEN` (`./zebrunner.sh join`); [mcloud-grid](https://github.com/zebrunner/mcloud-grid#node-registration) registers the node only when STF verifies it for `STF_PROVIDER_HOST`; it is in `custom` of `nodeconfig.json` and masked in the node config the container logs |
| `ADB_PORT` | `5037` | the adb port of the device in the node capabilities (`adb_port`) |
| `UNREGISTER_IF_STILL_DOWN_AFTER` | `3000` | ms, the node config value; after Appium exits with 101 (hub down) the container waits this long plus 15 s before the restart |

A missing required variable or a wrong number ends the container with the reason in its log. `CUSTOM_NODE_CONFIG` is ignored: the Zebrunner node config is always generated.

Every device host has its own node token, there is no token shared by the farm: the host joins the farm with an invite of the administrator (`./zebrunner.sh node-invite <label> <address>` of [mcloud](https://github.com/zebrunner/mcloud), `./zebrunner.sh join` of [mcloud-agent](https://github.com/zebrunner/mcloud-agent) writes the token `mcn1.<label>.<secret>` into its `MCLOUD_NODE_TOKEN`), and mcloud-agent passes it to the Appium containers of the host as `NODE_REGISTRATION_TOKEN`. [mcloud-grid](https://github.com/zebrunner/mcloud-grid#node-registration) registers the node only when STF verifies the token: it must belong to an active node of STF whose address is `STF_PROVIDER_HOST`, the host of the node url (the address of the invite). The hub sends the token back to this node only, in the header `X-MCloud-Node-Token` of its requests. With `NODE_REGISTRATION_TOKEN` Appium answers only the requests with it in `X-MCloud-Node-Token` and the ones of the container itself (the healthcheck): the others get `401`, their WebSockets (e.g. the logcat broadcast) are closed, the refused address is logged once in 10 minutes. So the device is used through the hub only, which reserves it in STF; Appium Inspector and the other clients connect to the hub too.

### Applications

Remote applications are kept in a shared storage, so the devices of a host download an application once.

| Variable | Default | Description |
| --- | --- | --- |
| `APPIUM_APPS_DIR` | `/opt/appium-storage` | the storage, an application is stored as `<host>/<path>` of its url without the query (an http(s) url only; its dot segments are resolved, the file stays in the storage); empty disables the storage |
| `APPIUM_APP_SIZE_DISABLE` | `false` | `true` uses a stored application without comparing its size with the remote one |
| `APPIUM_APP_WAITING_TIMEOUT` | `600` | s, how long a session waits for the download of the same application by another device (`.lock` file) |
| `APPIUM_MAX_LOCK_FILE_LIFETIME` | `1800` | s, an older `.lock` file is removed as left by a crashed download |
| `APPIUM_APP_FETCH_RETRIES` | `3` | the retries of a broken download, `0` disables them |
| `APPIUM_APPS_MAX_AGE` | `7` | days, a download removes the applications not used for this time; `0` keeps them |
| `APPIUM_APPS_MIN_FREE` | `10` | %, a download removes the least recently used applications while the free space of the storage is below it; `0` disables it |

Every build of an application is usually a new url, so the storage is cleaned before a download: the applications not used for `APPIUM_APPS_MAX_AGE` days, then the least recently used ones while the free space is below `APPIUM_APPS_MIN_FREE`, and the temporary copies of the interrupted downloads. An application is used when a session takes it from the storage; the ones used in the last hour and the ones being downloaded (`.lock`) are kept. A failed cleanup is logged and does not fail the session.

### Video recording and artifacts

Every session is recorded: the patched Appium creates `${LOG_DIR}/.recording-artifact-<session id>` on a new session and deletes it on the session end. The video, the session log and the other files of `LOG_DIR` are then moved to `${LOG_DIR}/<session id>/` and `${LOG_DIR}/.artifact-<session id>` is created for the uploader. `docker stop` finishes the active sessions the same way.

The video of a session is finalized in the background, so the recording of the next session starts at once (`files/module/recording.sh`); the session log and the files of the session are shared before it, so the next session does not write into them. A recording is shared once (the lock `${LOG_DIR}/.sharing-artifact-<session id>`), also when the end of the session and `docker stop` share it together. On Android the STF screen broadcast is one for the device: `on` and `off` are sent under a lock and `off` only when no other recording reads the broadcast, and the adb forwards are removed only when no other session is active. A watchdog is the safety net of a lost session end: the marker of a session Appium does not know for `RECORDING_STALE_SEC` is removed (its recording is shared), an ffmpeg without a session is stopped after `RECORDING_ORPHAN_CHECKS` checks.

On iOS the video is the stream of the WDA MJPEG server, which sends a frame only when the screen changes (the zebrunner fork of WebDriverAgent repeats the last one every 20 s). ffmpeg reads it through `files/util/mjpeg-relay.js`: every new frame is passed at once and the last one is repeated after `MJPEG_RELAY_HEARTBEAT_MS`, so the video of a static screen or of a short session is not empty and ffmpeg finishes it at once on the session end. Without a frame of the stream after `MJPEG_RELAY_FIRST_FRAME_MS` the first frame is the screenshot of WDA. The timestamps of the frames are the wall clock, the repeated frames keep the timeline.

| Variable | Default | Description |
| --- | --- | --- |
| `RECORD_ARTIFACTS` | `true` | `false` disables the video, the logs are still shared |
| `LOG_DIR` | `/tmp/log` | the artifacts, a volume shared with the uploader |
| `TASK_LOG` | `/tmp/log/appium.log` | the Appium log, shared as the session log |
| `LOG_FILE` | `session.log` | the name of the shared session log |
| `BROADCAST_HOST`, `BROADCAST_PORT` | `device`, `2223` | Android: the STF screen broadcast, switched `on` and `off` around the recording |
| `FFMPEG_OPTS` | | extra ffmpeg output options |
| `RECORDING_WATCHDOG_SEC` | `60` | the period of the watchdog of the recordings |
| `RECORDING_STALE_SEC` | `600` | the age of the marker of a session unknown to Appium the watchdog removes |
| `RECORDING_ORPHAN_CHECKS` | `5` | the checks of the watchdog an ffmpeg without a session survives |
| `MJPEG_RELAY_HEARTBEAT_MS` | `500` | iOS: ms without a new frame of WDA after which the MJPEG relay repeats the last one |
| `MJPEG_RELAY_FIRST_FRAME_MS` | `1000` | iOS: ms without a frame of the stream after which the first frame is the screenshot of WDA |
| `RECORDING_CARD` | `false` | `true` puts the card of the session before its video, see below |
| `RECORDING_CARD_SEC` | `3` | s, the duration of the card |
| `RECORDING_TIMESTAMP` | `false` | `true` stamps every frame with its capture time in UTC and the session id |
| `DEVICE_LOCATION` | | the location of the device on the card, e.g. the farm and the shelf |
| `IMAGE_VERSION` | the `VERSION` of the build | the version of the image on the card |
| `ROUTER_UUID` | | the marker name instead of the session id, the id of an external orchestrator of the device (e.g. on-demand emulators) |
| `WDA_LOG_FILE`, `SHARE_WDA_LOG` | `/tmp/log/wda.log`, `false` | iOS: share the WDA log with the session artifacts |

A session with the `appium:mcloudExternalRecording: true` capability creates no marker: the recording is managed by the client.

With `RECORDING_CARD=true` the video starts with a card of `RECORDING_CARD_SEC`: the logo and the session, the test (the first capability set of `name`, `appium:name`, `zebrunner:name`, `zebrunner:testName`, `testName`), the app (the file of `appium:app`, `appium:bundleId` or `appium:appPackage`, with the installed version on Android), the device and its model, the OS (with the API level on Android), the UDID, the start and the end in UTC with the duration, the node, the hub, `DEVICE_LOCATION` and the version of the image (`files/module/recording-card.sh`). The details are collected at the start of the recording, the card is rendered at its end with the size of the video and joined to it without encoding the video again; the video stays without a card when it fails. The card is before the session: the video is `RECORDING_CARD_SEC` longer than the session. With `RECORDING_TIMESTAMP=true` every frame shows its capture time in UTC (the wall clock timestamp of the frame) and the short session id at the bottom.

### STF

| Variable | Default | Description |
| --- | --- | --- |
| `STF_API_URL` | | the STF API, e.g. `https://stf.example.com/api/v1` |
| `STF_AUTH_TOKEN` | | the STF access token |

With all of `STF_API_URL`, `STF_AUTH_TOKEN` and `DEVICE_UDID` set, the device errors of Appium are reported to STF: the device is marked `Unhealthy` (no space left on the host or on the device, `INSTALL_FAILED_INSUFFICIENT_STORAGE`, unfinished device setup, failed `am` command) or gets a note (another failed install - a problem of the application, e.g. `INSTALL_FAILED_VERSION_DOWNGRADE` -, lost proxy connection, unknown session).

### Android

| Variable | Default | Description |
| --- | --- | --- |
| `REMOTE_ADB_HOST` | `connector` | the adb server of the device container, the default `remoteAdbHost` capability |
| `ADB_SERVER_SOCKET` | `tcp:connector:5037` | the adb server for the adb client of the container |
| `CHROMEDRIVER_PORT` | `8200` | the chromedriver port, forwarded to the connector |
| `ANDROID_DEVTOOLS_PORT` | `9222` | the Chrome DevTools port, forwarded to the connector |
| `CHROME_OPTIONS` | `"androidDevToolsPort": 9222` | the members of the default `chromeOptions` capability; `androidDevToolsPort` needs Chrome / WebView 87+ on the device (see Limitations) |

### Playwright

The `Playwright` automation runs [Playwright](https://playwright.dev/docs/api/class-android) tests on an Android device: an Appium session with `appium:automationName: Playwright` reserves the device through mcloud-grid as any other session (the queue, STF, the video and the artifacts of the session), and the driver of the image (`files/playwright`, linked into `APPIUM_HOME`) serves the Playwright server of the device on the WebSocket `/mcloud/playwright/<session id>` of Appium. mcloud-grid passes that WebSocket on to the clients (`/mcloud/playwright/<session id>` of MCloud), the client connects with `_android.connect()` and drives Chrome, the WebViews and the device itself; see the example of [MCloud](https://github.com/zebrunner/mcloud) (`examples/playwright`).

- Every connection gets its own Playwright server of the device, of the version of the client: a client connects only to a server of its major.minor (Playwright checks `User-Agent`). The version of the image is bundled, another one is installed on its first connection (`npm install playwright-core@<version>` and its device driver APKs; the device host needs the npm registry) into `PLAYWRIGHT_CACHE_DIR`, the storage of the apps shared by the devices of a host. A host without the registry serves the bundled version only.
- One client at a time: a second connection of the session is closed with `1013`. The connection ends with the session (`1001`) and with the device (the status of the Playwright server).
- The session has no command timeout while a client is connected (the client sends no WebDriver commands); mcloud-grid keeps it while its WebSocket is open.
- The session wakes the device, dismisses its lock screen and keeps the screen on while plugged in (`svc power stayon true`) till its end, then gives `stay_on_while_plugged_in` its value back: Chrome draws no frames for a screen that is off or locked, its clicks and screenshots wait until their timeouts. A secure lock (PIN, pattern, password) stays, the log names it: remove it on the devices of the farm. `appium:skipUnlock: true` leaves the screen as it is.
- Chrome reads the command line of Playwright only on a rooted or a debuggable device (an emulator of a Google APIs image) or with `chrome://flags/#enable-command-line-on-non-rooted-devices` enabled: enable the flag once on the other devices (Play Store images too), otherwise `launchBrowser()` waits for the DevTools socket of Chrome until its timeout; the first run of Chrome (and the browser choice screen of the EU devices) is passed by hand once too.

| Variable | Default | Description |
| --- | --- | --- |
| `PLAYWRIGHT_BROWSERS_PATH` | `/opt/playwright/browsers` | the device driver APKs of Playwright |
| `PLAYWRIGHT_CACHE_DIR` | `/opt/appium-storage/playwright` | the other Playwright versions, installed on demand; empty: `APPIUM_APPS_DIR/playwright` |

### iOS

| Variable | Default | Description |
| --- | --- | --- |
| `WDA_HOST`, `WDA_PORT` | `connector`, `8100` | WebDriverAgent, the default `webDriverAgentUrl` capability |
| `MJPEG_PORT` | `8101` | the WDA MJPEG server, the video source |
| `DEVICE_TIMEOUT` | `300` | s, how long the startup waits for WDA |
| `USBMUXD_SOCKET_ADDRESS` | `connector:2222` | usbmuxd of the connector; the iOS tools use it directly, `/var/run/usbmuxd` is forwarded to it |
| `WIRELESS` | `false` | `true` for a device without usbmuxd (a simulator, or WDA started by another tool and relayed by the connector): no usbmuxd forwarding, WDA is reached at `WDA_HOST:WDA_PORT` |
| `DEVICE_CONNECTION` | empty | `ios-sim` for an iOS or tvOS simulator of the macOS host, see [Simulators](#simulators); `android-sim` for an Android emulator: a device of the `default` characteristics is a `Phone`, not a `TV` |
| `HOST_SSH_USER` | empty | the user of the macOS host of the simulator |
| `HOST_SSH_HOST`, `HOST_SSH_PORT` | `connector`, `22` | ssh of the macOS host, relayed by the connector |
| `HOST_SSH_KEY` | `/opt/zebrunner/ssh/id_ed25519` | the mounted private ssh key of the user of the host |

### Simulators

A simulator runs on the macOS host, its connector boots it and starts WebDriverAgent, Appium of the container drives it as a simulator. XCUITest needs Xcode for a simulator: `/usr/local/bin/xcrun` of the image runs `xcrun` of the host over ssh (through the connector, `HOST_SSH_HOST:HOST_SSH_PORT`), the local files of its arguments (the app to install, ...) are copied to the host first and the files it writes into the temporary folder are copied back. `DEVELOPER_DIR` points at a copy of `Info.plist` of the Xcode of the host (the Xcode version). The default capabilities have `appium:isHeadless`: the container can't open the Simulator UI, a simulator booted with its UI is used as is. Without `HOST_SSH_USER` the `xcrun` of the image fails like a missing tool, as before. The features of XCUITest that write the files of the simulator directly (the Safari, keyboard and localization preferences, the app data reset) are not available: their errors are logged and the session goes on.

### Debug

| Variable | Default | Description |
| --- | --- | --- |
| `DEBUG` | `false` | `true` keeps the container for `DEBUG_TIMEOUT` seconds (`3600`) after the entrypoint exits |
| `VERBOSE` | `false` | `true` traces the entrypoint (`set -x`) |
| `LOGGER_LEVEL` | `INFO` | the minimum level of the log lines of the scripts: `DEBUG`, `INFO`, `WARN` or `ERROR` (`[dd/mm/YYYY HH:MM:SS] [LEVEL] message`, `util/logger.sh`); the Appium log level is `LOG_LEVEL` |

### Device status

`GET /wd/hub/status-adb` and `GET /wd/hub/status-wda` report whether the device or WDA is ready. With a JSON body `{"exitCode": <code>}` (as mcloud-grid sends) Appium exits with the code when the check fails, so the container restarts. WDA gets 3 s to answer and a second attempt after 500 ms (a WDA busy with the end of the last session is not down), `adb devices` gets 5 s; mcloud-grid waits 10 s for the check.

## Limitations

- The image is `linux/amd64` only: the base image `appium/appium` is amd64 only (Android platform-tools), a build for another platform stops with an error. An own `linux/arm64` image would lose functions: Google publishes no chromedriver (Chrome for Testing) for linux/arm64, so the Chrome and WebView sessions of Android would not work, and no Android build-tools (`aapt2`, `zipalign`) either, so they would be older builds of the distribution. On Apple silicon it runs emulated: install Rosetta 2 and let Docker Desktop use it (*Use Rosetta for x86_64/amd64 emulation on Apple Silicon*), otherwise it runs under the much slower QEMU emulation; `./zebrunner.sh status` of mcloud-agent shows it.
- Android 8.0+ only (the minimum of the UiAutomator2 driver of the image, `MIN_ANDROID` of `files/module/android.sh`): older devices get a warning at startup and their sessions fail.
- Chrome and the WebView contexts need Chrome and Android System WebView 87+ on the device: they are reached through the fixed DevTools port (`androidDevToolsPort`), which older chromedrivers reject with `unrecognized chrome option: androidDevToolsPort`. An older Chrome or WebView gets a warning at startup; update it on the device.
- Appium runs as `androidusr`, not root, and gets no root: the image removes `sudo` and the sudo group of `androidusr` (a passwordless sudoer in the base image).
- The base image is squashed into one layer without the files the image does not use: its own drivers (espresso, flutter, gecko, uiautomator2 6.1.1, about 410 MB) in `~/.appium` (Appium loads the drivers of `APPIUM_HOME`), the Android `cmdline-tools` (`sdkmanager`, `avdmanager`, `apkanalyzer`: the drivers use adb and the build-tools), the caches of npm and node-gyp, and the files its layers deleted or replaced: 2.41 GB -> 1.68 GB, a download of ~680 MB instead of ~1 GB. The squashed layer is built again by every release, so a device host downloads the whole image on an update.

## Troubleshooting

- `session not created: please close '<package>' and try again` on a switch to a `WEBVIEW_<package>` context: the WebView belongs to another app than the `appPackage` of the session (e.g. `org.chromium.webview_shell` on an AOSP emulator). Appium passes the `appPackage` to chromedriver as the package it expects in the DevTools, and chromedriver finds `<package>` there. Set `appium:chromeAndroidPackage` to the package of the WebView, e.g. `"appium:chromeAndroidPackage": "org.chromium.webview_shell"`.
- An AOSP emulator has no Chrome: a mobile web session (`browserName: Chrome`) fails with `Either provide 'app' option to install 'com.android.chrome'...`. Use a WebView app (e.g. `org.chromium.webview_shell`, preinstalled on AOSP) or install Chrome.
- `An attempt to register with the grid <hub> was unsuccessful: <reason>. <hint>` in the log: mcloud-grid refused the node registration (the reason is the error of the hub) or did not answer. The registration is retried every 5 s (`registerCycle`); the error is logged when the reason changes and once in 10 minutes for the same reason with the number of the attempts failed meanwhile, the other attempts at debug level, and `Appium is registered with the grid ...` once it succeeds. The reasons:
  - `HTTP 500: Node <url> is not reachable from the hub (<exception>), so it is not registered`: the hub connects back to the node url (`http://STF_PROVIDER_HOST:<appium port>/wd/hub`) and gets no answer. `STF_PROVIDER_HOST` must be an address of the device host that the hub can reach (in a LAN the LAN address: the public IP often fails without NAT hairpin) and the Appium port must be published.
  - `HTTP 500: Node <url> has an unknown or revoked node token, so it is not registered`: STF does not know the token or the node is not active: it was revoked, or the host joined again (a new join replaces the token, the old one is invalid). Check that `MCLOUD_NODE_TOKEN` of mcloud-agent is the token of the last `./zebrunner.sh join` and that the node is active in STF; otherwise invite the host again and join it.
  - the same answer when `STF_PROVIDER_HOST` is not the address of the node invite: a node token is valid only for the address the host joined with, which must be the host of the node url (`http://STF_PROVIDER_HOST:<appium port>/wd/hub`). Set `STF_PROVIDER_HOST` of mcloud-agent back to that address (`./zebrunner.sh join` writes it), or invite the host with its new address and join it again.
  - `HTTP 500: Node <url> has no node token` or `has a malformed node token` (not `mcn1.<label>.<secret>`, e.g. cut on a copy): `NODE_REGISTRATION_TOKEN` is not the node token of the host, join the host.
  - `HTTP 500: Node <url> has a node token, but STF could not verify it (<status>)`: STF does not answer or the STF integration of the hub is wrong; the node registers by itself once STF verifies the token.
  - `HTTP 500: Node <url> is not in NODE_ALLOWED_NETWORKS (<networks>)`: add the network of `STF_PROVIDER_HOST` to `NODE_ALLOWED_NETWORKS` of mcloud-grid.
  - `HTTP 500: Appium node must have 'UDID' capability` or `Node should have slot`: the generated node config has no device, check `DEVICE_UDID`.
  - `the hub <hub> is not reachable: <error>` (e.g. `ECONNREFUSED`, `ENOTFOUND`, `ETIMEDOUT`): check `SELENIUM_HOST`, `SELENIUM_PORT` and the network to the hub.

A registered node whose token STF rejects later (the node is revoked or joined again) is unregistered by the hub at once and its sessions end.

## Patch local appium

- Clone Zebrunner Appium and copy the patched files into Appium 3.1.1:

  ```bash
  git clone https://github.com/zebrunner/appium.git
  cd appium
  export APPIUM_HOME="$(npm root -g)/appium"
  cp -R -v ./files/patch/node_modules ./files/patch/build "${APPIUM_HOME}/"
  ```

  `files/patch/appium-3_1_1.diff` is the same patch for the Appium sources.

### Change the patch

The patch is kept twice: `files/patch/appium-<version>.diff` for the Appium sources (the version of the base image) and its build, the js files of `files/patch/node_modules` (`@appium/base-driver`) and `files/patch/build` (`appium`: the grid registration keeps the node registered while the hub is slow or unavailable, the hub would end the active session of a node that registers again, and logs why the hub refuses a registration) copied into `APPIUM_HOME` of the image. Change the diff (e.g. `git diff` of a patched `appium@<version>` checkout), run `make patch-build` to rebuild the js files and commit both; `make patch-sync` (also in CI) fails when they differ.

## Exit codes and health

- The docker healthcheck (every 10 s, after a 60 s start period) requires the Appium status; an offline Android device gets `adb reconnect` and is unhealthy when it stays offline.
- The container exits with `1` whenever Appium exits, so the `on-failure` restart policy starts it again. Appium exits with `101` when mcloud-grid finds the device or WDA down (`/status-adb`, `/status-wda` with `exitCode`): the container then waits `UNREGISTER_IF_STILL_DOWN_AFTER` plus 15 s for the hub to unregister the node.
- A wrong configuration (e.g. `CONNECT_TO_GRID=true` without the hub) ends the container with the reason in its log; an iOS container ends when WebDriverAgent does not answer in `DEVICE_TIMEOUT`.
- `DEBUG=true` keeps an ending container for `DEBUG_TIMEOUT` seconds to look into it.

## Development

`make check` runs everything CI runs, `make help` lists the single steps:

| Target | What it checks | Needs |
| --- | --- | --- |
| `make lint` | yamllint, actionlint, hadolint, pymarkdown, shellcheck, shfmt, `node --check`, the patch files, the Dockerfile versions in this README and no other Appium version or patch diff mentioned, every env var of the Dockerfile documented, the text file checks of CONVENTIONS.md | Python 3; on macOS `brew install hadolint` |
| `make test` | `make build` and `make push` with a docker stub, the config generators `files/config/zbr-*.sh`, `files/util/debug.sh`, `files/util/logger.sh`, the recording module `files/module/recording.sh` (the end of a session with another one active, the share of a recording once and its logs before its video, the STF broadcast lock, the watchdog) and the iOS MJPEG relay `files/util/mjpeg-relay.js` (the repeated last frame, the reconnect, the screenshot as the first frame) | bash, Python 3, jq, Node.js |
| `make docker` | the docker tests below: `make image`, `make patch`, `make e2e` and `make patch-sync` | Docker |
| `make image` | the image build and contents, the assumptions on the base image that a new release may break (where Appium is, the entrypoint as PID 1, the user, the Node of the patch build, the base driver version and files the patch replaces, the drivers and plugins using the patched base driver and supporting the Appium version, the default capabilities known to the drivers, the insecure features and the minimum Android of the drivers), the Android and iOS modules and the healthcheck with a fake adb and WDA, Appium startup with the env vars of the image and of mcloud-agent, `RECORD_ARTIFACTS=false`, shutdown, the `appium-image` stage with its plugin | Docker |
| `make patch` | the Appium patch inside the image with `node --test` (`tests/patch/*.test.mjs`): recording markers, `/status-wda`, `/status-adb`, STF device updates, the shared app storage, the grid registration of a slow hub and the logged reasons of a refused one | Docker |
| `make e2e` | iOS (also wireless) and Android containers with the mcloud-agent settings and a fake device (`tests/fixtures/fake-device.js`): startup, health, usbmuxd and adb forwarding, video recording and the shared artifacts of sessions (back-to-back and overlapping ones, a static screen of WDA, the screenshot as the first frame, the watchdog), `docker stop`, the exit code 101 of mcloud-grid | Docker |
| `make patch-sync` | the js files of the patch are the build of the patch diff (Appium sources of the base image version, built in `node:22`) | Docker |

The docker tests build the image once as `zbr-appium:test` (`IMAGE` overrides the tag, `REBUILD=true` forces a new build, `SKIP_BUILD=true` skips the build of `make image`). The image is amd64 only, so on Apple silicon it runs emulated and the docker tests take a while. With `JUNIT_DIR` set the results are also written as JUnit XML.

The shell scripts are formatted with shfmt (`.editorconfig`). Formatting-only commits are listed in `.git-blame-ignore-revs`, GitHub skips them in blame; locally: `git config blame.ignoreRevsFile .git-blame-ignore-revs`.

The conventions of the style, the formatting and the tooling of this repository are in [CONVENTIONS.md](CONVENTIONS.md), the same in all the MCloud docker image repositories.

## Support

- [Zebrunner PRO](https://zebrunner.com)
- [Zebrunner CE](https://zebrunner.github.io/community-edition)
- [Zebrunner Reporting](https://zebrunner.com/documentation)
- [Carina Guide](http://zebrunner.github.io/carina)
- [Demo Project](https://github.com/zebrunner/carina-demo)
- [Telegram Channel](https://t.me/zebrunner)

## License

[Apache License 2.0](LICENSE)
