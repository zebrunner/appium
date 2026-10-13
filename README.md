# Zebrunner MCloud Appium

Enhanced Appium docker image for testing on physical devices (Android and iOS), including Phones, Tablets, TV and emulators/simulators.

* It is built on top of [Appium](https://github.com/appium/appium/) and supports:
  * Connection with iOS devices via the Linux Hardware
  * Integration with [STF](https://github.com/zebrunner/stf) for remote manual testing
  * Cached local storage to minimize download calls to external resources (S3, AppCenter, Azure, etc.)
  * Video recording capabilities including AppleTV, AndroidTV, and TizenTV
  * Video recording for pre-conditions and mapping with test results in [Zebrunner Reporting](https://zebrunner.com/)

Feel free to support the development with a [**donation**](https://www.paypal.com/donate/?hosted_button_id=MNHYYCYHAKUVA) for the next improvements.

<p align="center">
  <a href="https://zebrunner.com/"><img alt="Zebrunner" src="https://github.com/zebrunner/zebrunner/raw/master/docs/img/zebrunner_intro.png"></a>
</p>

> Follow the installation and configuration guide in [MCloud](https://github.com/zebrunner/mcloud) to reuse this image effectively.

## Build

```bash
./build.sh 3.1.1        # public.ecr.aws/zebrunner/appium:3.1.1, the `appium` stage
./build.sh -i 3.1.1-img # the `appium-image` stage: plus the Appium images plugin and sharp
```

The script shows the `docker build` command and waits for a confirmation; it exits with the status of the build. The image is `linux/amd64` only: another `BUILD_PLATFORM` or `docker build --platform` is rejected.

## Configuration

The container is configured with environment variables; the defaults are the values of the image. In MCloud they are set by [mcloud-agent](https://github.com/zebrunner/mcloud-agent).

### Device

| Variable | Default | Description |
|---|---|---|
| `PLATFORM_NAME` | | `android` or `ios` (any case): the device module to run, the default capabilities and the video source |
| `DEVICE_UDID` | | the udid of the device: capabilities, `/status-adb`, STF updates |
| `DEVICE_NAME` | | the device name in the node config and the default capabilities |
| `ANDROID_DEVICES` | | `/status-adb` looks for this name when `DEVICE_UDID` is empty |

`PLATFORM_VERSION`, `DEVICETYPE` (Phone, Tablet, TV) and `AUTOMATION_NAME` are detected by the device module at startup.

### Appium

| Variable | Default | Description |
|---|---|---|
| `APPIUM_PORT` | `4723` | the port of Appium, the base path is `/wd/hub` |
| `APPIUM_CLI` | | extra Appium arguments, e.g. `--session-override` |
| `APPIUM_PLUGINS` | | the plugins to use (`--use-plugins`), `images` in the `appium-image` stage |
| `LOG_LEVEL` | `info` | the Appium log level |
| `RELAXED_SECURITY` | | `true` enables all insecure features (`--relaxed-security`) |
| `CHROMEDRIVER_AUTODOWNLOAD` | `true` | allows `*:chromedriver_autodownload` (mobile web on Android) |
| `ADB_SHELL` | | `true` allows `*:adb_shell` (`mobile: shell`) |
| `DEFAULT_CAPABILITIES` | | `true` passes the capabilities of the device (udid, connector hosts and ports) to every session; nothing is passed for other platforms than `android` and `ios` |
| `APPIUM_CONFIG_DIR` | `/opt/config` | the generated `nodeconfig.json` and `defaultcapabilities.json` |

### Selenium Grid (mcloud-grid)

| Variable | Default | Description |
|---|---|---|
| `CONNECT_TO_GRID` | | `true` registers Appium in [mcloud-grid](https://github.com/zebrunner/mcloud-grid) with a generated node config (`MobileRemoteProxy`) |
| `SELENIUM_HOST`, `SELENIUM_PORT` | | the hub, required with `CONNECT_TO_GRID=true` |
| `STF_PROVIDER_HOST` | | the host of the node url, required with `CONNECT_TO_GRID=true` |
| `ADB_PORT`, `PROXY_PORT`, `SERVER_PROXY_PORT` | `5037`, `8080`, `0` | the ports of the device in the node capabilities |
| `UNREGISTER_IF_STILL_DOWN_AFTER` | `3000` | ms, the node config value; after Appium exits with 101 (hub down) the container waits this long plus 15 s before the restart |

A missing required variable or a wrong number ends the container with the reason in its log. `CUSTOM_NODE_CONFIG` is ignored: the Zebrunner node config is always generated.

### Applications

Remote applications are kept in a shared storage, so the devices of a host download an application once.

| Variable | Default | Description |
|---|---|---|
| `APPIUM_APPS_DIR` | `/opt/appium-storage` | the storage, an application is stored by its url path; empty disables the storage |
| `APPIUM_APP_SIZE_DISABLE` | `false` | `true` uses a stored application without comparing its size with the remote one |
| `APPIUM_APP_WAITING_TIMEOUT` | `600` | s, how long a session waits for the download of the same application by another device (`.lock` file) |
| `APPIUM_MAX_LOCK_FILE_LIFETIME` | `1800` | s, an older `.lock` file is removed as left by a crashed download |
| `APPIUM_APP_FETCH_RETRIES` | `3` | the retries of a broken download, `0` disables them |

### Video recording and artifacts

Every session is recorded: the patched Appium creates `${LOG_DIR}/.recording-artifact-<session id>` on a new session and deletes it on the session end. The video, the session log and the other files of `LOG_DIR` are then moved to `${LOG_DIR}/<session id>/` and `${LOG_DIR}/.artifact-<session id>` is created for the uploader. `docker stop` finishes the active sessions the same way.

| Variable | Default | Description |
|---|---|---|
| `RECORD_ARTIFACTS` | `true` | `false` disables the video, the logs are still shared |
| `LOG_DIR` | `/tmp/log` | the artifacts, a volume shared with the uploader |
| `TASK_LOG` | `/tmp/log/appium.log` | the Appium log, shared as the session log |
| `LOG_FILE` | `session.log` | the name of the shared session log |
| `BROADCAST_HOST`, `BROADCAST_PORT` | `device`, `2223` | Android: the STF screen broadcast, switched `on` and `off` around the recording |
| `FFMPEG_OPTS` | | extra ffmpeg output options |
| `ROUTER_UUID` | | the marker name instead of the session id (ReDroid integration) |
| `WDA_LOG_FILE`, `SHARE_WDA_LOG` | `/tmp/log/wda.log`, `false` | iOS: share the WDA log with the session artifacts |

A session with the `appium:mcloudExternalRecording: true` capability creates no marker: the recording is managed by the client.

### STF

| Variable | Default | Description |
|---|---|---|
| `STF_API_URL` | | the STF API, e.g. `https://stf.example.com/api/v1` |
| `STF_AUTH_TOKEN` | | the STF access token |

With all of `STF_API_URL`, `STF_AUTH_TOKEN` and `DEVICE_UDID` set, the device errors of Appium are reported to STF: the device is marked `Unhealthy` (no space left, failed install, unfinished device setup, failed `am` command) or gets a note (lost proxy connection, unknown session).

### Android

| Variable | Default | Description |
|---|---|---|
| `REMOTE_ADB_HOST` | `connector` | the adb server of the device container, the default `remoteAdbHost` capability |
| `ADB_SERVER_SOCKET` | `tcp:connector:5037` | the adb server for the adb client of the container |
| `CHROMEDRIVER_PORT` | `8200` | the chromedriver port, forwarded to the connector |
| `ANDROID_DEVTOOLS_PORT` | `9222` | the Chrome DevTools port, forwarded to the connector |
| `CHROME_OPTIONS` | `"androidDevToolsPort": 9222` | the members of the default `chromeOptions` capability |

### iOS

| Variable | Default | Description |
|---|---|---|
| `WDA_HOST`, `WDA_PORT` | `connector`, `8100` | WebDriverAgent, the default `webDriverAgentUrl` capability |
| `MJPEG_PORT` | `8101` | the WDA MJPEG server, the video source |
| `DEVICE_TIMEOUT` | `300` | s, how long the startup waits for WDA |
| `USBMUXD_SOCKET_ADDRESS` | `connector:2222` | usbmuxd of the connector; the iOS tools use it directly, `/var/run/usbmuxd` is forwarded to it |

### Debug

| Variable | Default | Description |
|---|---|---|
| `DEBUG` | `false` | `true` keeps the container for `DEBUG_TIMEOUT` seconds (`3600`) after the entrypoint exits |
| `VERBOSE` | `false` | `true` traces the entrypoint (`set -x`) |

### Device status

`GET /wd/hub/status-adb` and `GET /wd/hub/status-wda` report whether the device or WDA is ready. With a JSON body `{"exitCode": <code>}` (as mcloud-grid sends) Appium exits with the code when the check fails, so the container restarts.

## Limitations

* The image is `linux/amd64` only: the base image `appium/appium` is amd64 only (Android platform-tools), a build for another platform stops with an error. On Apple silicon it runs emulated.
* Android 8.0+ only: the image has the UiAutomator2 6.x driver, older devices get a warning at startup and their sessions fail.
* Appium runs as `androidusr`, not root.

## Patch local appium

* Clone Zebrunner Appium and copy the patched files into Appium 3.1.1:

  ```bash
  git clone https://github.com/zebrunner/appium.git
  cd appium
  export APPIUM_HOME="$(npm root -g)/appium"
  cp -R -v ./files/patch/node_modules "${APPIUM_HOME}/"
  ```

  `files/patch/appium-3_1_1.diff` is the same patch for the Appium sources.

### Change the patch

The patch is kept twice: `files/patch/appium-<version>.diff` for the Appium sources (the version of the base image) and its build, the js files of `files/patch/node_modules` copied into the image. Change the diff (e.g. `git diff` of a patched `appium@<version>` checkout), run `make patch-build` to rebuild the js files and commit both; `make patch-sync` (also in CI) fails when they differ.

* Download the [go-ios](https://github.com/danielpaulus/go-ios/releases) v1.0.204 utility (`go-ios-mac.zip`) and put it into `/usr/local/bin`

  > Make sure to unblock it as it goes from not identified developer on MacOS

## Checks

`make check` runs everything CI runs, `make help` lists the single steps:

| Command | What is checked | Needs |
|---|---|---|
| `make lint` | yamllint, actionlint, hadolint, pymarkdown, shellcheck, shfmt, the patch files | Python 3, hadolint on macOS: `brew install hadolint` |
| `make test` | `build.sh` with a fake docker, the config generators `files/config/zbr-*.sh` | bash, Python 3, jq |
| `make image` | the image build and contents, the Android module with a fake adb, the default capabilities with the installed drivers, Appium startup with the env vars of the image and of mcloud-agent, shutdown, the `appium-image` stage | Docker |
| `make patch` | the Appium patch inside the image with `node --test` (`tests/patch/*.test.mjs`): recording markers, `/status-wda`, `/status-adb`, STF device updates, the shared app storage | Docker |
| `make e2e` | iOS and Android containers with the mcloud-agent settings and a fake device (`tests/fixtures/fake-device.js`): startup, health, usbmuxd, video recording of sessions, `docker stop` | Docker |
| `make patch-sync` | the js files of the patch are the build of the patch diff (Appium sources of the base image version, built in `node:22`) | Docker |

The docker tests build the image once as `zbr-appium:test` (`IMAGE` overrides the tag, `REBUILD=true` forces a new build, `SKIP_BUILD=true` skips the build of `make image`). The image is amd64 only, so on Apple silicon it runs emulated and the docker tests take a while. With `JUNIT_DIR` set the results are also written as JUnit XML.

The shell scripts are formatted with shfmt (`.editorconfig`). Formatting-only commits are listed in `.git-blame-ignore-revs`, GitHub skips them in blame; locally: `git config blame.ignoreRevsFile .git-blame-ignore-revs`.

## Documentation and free support

* [Zebrunner PRO](https://zebrunner.com)
* [Zebrunner CE](https://zebrunner.github.io/community-edition)
* [Zebrunner Reporting](https://zebrunner.com/documentation)
* [Carina Guide](http://zebrunner.github.io/carina)
* [Demo Project](https://github.com/zebrunner/carina-demo)
* [Telegram Channel](https://t.me/zebrunner)

## License

Code - [Apache Software License v2.0](http://www.apache.org/licenses/LICENSE-2.0)

Documentation and Site - [Creative Commons Attribution 4.0 International License](http://creativecommons.org/licenses/by/4.0/deed.en_US)
