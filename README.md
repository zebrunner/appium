Zebrunner MCloud Appium
==================

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

### Patch local appium
* Clone Zebrunner Appium and patch sources:
  ```
  git clone https://github.com/zebrunner/appium.git
  cd appium
  export APPIUM_HOME=/usr/local/lib/node_modules/appium
  cp -R -v ./files/mcloud/* ${APPIUM_HOME}/
  ```
* Download v1.0.120+ go ios utility [go-ios-mac.zip](https://github.com/danielpaulus/go-ios/releases) and put into `/usr/local/bin`
  > Make sure to unblock it as it goes from not identified developer on MacOS

## Checks

`make check` runs everything CI runs, `make help` lists the single steps:

| Command | What is checked | Needs |
|---|---|---|
| `make lint` | yamllint, actionlint, hadolint, pymarkdown, shellcheck, shfmt, the patch files | Python 3, hadolint on macOS: `brew install hadolint` |
| `make test` | `build.sh` with a fake docker, the config generators `files/config/zbr-*.sh` | bash, Python 3 |
| `make image` | the image build and contents, Appium startup with the env vars of the image and of mcloud-agent, shutdown, the `appium-image` stage | Docker |
| `make patch` | the Appium patch inside the image with `node --test` (`tests/patch/*.test.mjs`): recording markers, `/status-wda`, `/status-adb`, STF device updates, the shared app storage | Docker |
| `make e2e` | iOS and Android containers with the mcloud-agent settings and a fake device (`tests/fixtures/fake-device.js`): startup, health, video recording of sessions, `docker stop` | Docker |

The docker tests build the image once as `zbr-appium:test` (`IMAGE` overrides the tag, `REBUILD=true` forces a new build, `SKIP_BUILD=true` skips the build of `make image`). The image is amd64 only, so on Apple silicon it runs emulated and the docker tests take a while. With `JUNIT_DIR` set the results are also written as JUnit XML.

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
