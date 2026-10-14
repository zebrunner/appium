# Conventions

The conventions of the style, the formatting and the tooling of the Zebrunner MCloud docker image repositories:

- [appium](https://github.com/zebrunner/appium)
- [mcloud-android-connector](https://github.com/zebrunner/mcloud-android-connector)
- [mcloud-ios-connector](https://github.com/zebrunner/mcloud-ios-connector)

This file is the same in all of them: a change of a convention is made in every repository, and a new repository starts with a copy of it and of the shared files listed below. Most of the rules are checked by `make lint`; the rest is kept by review.

## Contents

- [Repository layout](#repository-layout)
- [Shared files](#shared-files)
- [Checks](#checks)
- [All files](#all-files)
- [Shell scripts](#shell-scripts)
- [Tests](#tests)
- [Dockerfile](#dockerfile)
- [YAML and GitHub Actions](#yaml-and-github-actions)
- [Markdown](#markdown)
- [Makefile](#makefile)
- [Git](#git)
- [New repository checklist](#new-repository-checklist)
- [Known deviations](#known-deviations)

## Repository layout

| Path | What it is |
| --- | --- |
| `Dockerfile` | the image |
| `entrypoint.sh`, `util/`, `bin/` | the scripts and binaries of the image (`files/` in appium) |
| `tests/lib.sh` | the shared helpers of the test scripts |
| `tests/lint.sh` | the static checks of `make lint` |
| `tests/<subject>_test.sh` | a test script; the docker ones are listed in `DOCKER_TESTS` of the `Makefile` |
| `tests/requirements-lint.txt` | the pinned linters, installed into `.venv` by `make lint` |
| `Makefile` | the entry point of all the checks: `make help` |
| `.github/workflows/ci.yml` | CI, runs the same checks as `make check` |
| `.github/dependabot.yml` | weekly updates of the actions, the base image and the linters |
| `.editorconfig` | the formatting of every file type, also the style of shfmt |
| `.gitignore`, `.dockerignore` | what git and the docker build context skip |
| `.hadolint.yaml`, `.shellcheckrc`, `.yamllint`, `.pymarkdown` | the configuration of the linters |
| `README.md` | the user documentation of the image |
| `CONVENTIONS.md` | this file |

## Shared files

These files are kept identical in all the repositories, a change goes to every one of them:

- `CONVENTIONS.md`
- `.shellcheckrc`, `.yamllint`, `.pymarkdown`, `.gitignore`
- `tests/lib.sh`, `tests/requirements-lint.txt`
- the debug mode script `util/debug.sh` (`files/util/debug.sh` in appium) and its test `tests/debug_test.sh` (the path of the script is the only difference)
- the logger `util/logger.sh` where the image has it

These files have a shared part and a project part, the shared part is the same everywhere:

| File | Project part |
| --- | --- |
| `.editorconfig` | the sections after the shared ones: shell scripts without the `.sh` extension, generated files |
| `.dockerignore` | the comment with the paths the image build needs |
| `.hadolint.yaml` | the ignored rules, each one with its reason |
| `tests/lint.sh` | `generated`, the list of `scripts` and the project sections between `markdown` and `shell` |
| `Makefile` | `DOCKER_TESTS` and the targets after `docker` |
| `.github/workflows/ci.yml` | the steps of the `docker` job and the jobs after it, the timeouts of the docker jobs |
| `.github/dependabot.yml` | the ecosystems: `docker` only when the base image can be updated without a manual change |

## Checks

`make check` runs everything CI runs, every step runs and the failed ones fail the target:

| Target | What it runs | Needs |
| --- | --- | --- |
| `make lint` | `tests/lint.sh`: yamllint, actionlint, hadolint, pymarkdown, `bash -n`, shellcheck, shfmt, the text file checks below and the project checks | Python 3 (the tools are installed into `.venv`); on macOS `brew install hadolint` |
| `make test` | every `tests/*_test.sh` that is not in `DOCKER_TESTS`, with stubs instead of the real tools | bash; no docker, no device |
| `make docker` | the tests of `DOCKER_TESTS`: the image build, its contents and its startup | Docker |

- The linters are pinned in `tests/requirements-lint.txt` as `name==version` and updated by Dependabot.
- shellcheck runs with `--severity=info`: every finding is fixed, or disabled on the line above with the reason (see [Shell scripts](#shell-scripts)).
- shfmt takes its style from `.editorconfig`, it has no flags of its own.
- The text file checks of `tests/lint.sh` cover every text file but `.git`, `.venv`, `.idea` and the `generated` paths: no non-ASCII and control characters, no CR, no trailing whitespace, a final newline.
- Every check prints `ok   - <description>` or `FAIL - <description>` with the details, and with `JUNIT_DIR` set it is also written as JUnit XML, which CI shows in the job summary and as annotations.

## All files

- UTF-8 with ASCII characters only: `-`, `...`, `->` instead of the typographic dash, ellipsis or arrow.
- LF line ends, a final newline, no trailing whitespace.
- Indentation by spaces, 2 per level: shell, YAML, JSON, JavaScript. Tabs only in the `Makefile`.
- The continuation lines of a Dockerfile instruction are indented by 4 spaces (see [Dockerfile](#dockerfile)).
- Generated files (e.g. the Appium patch of appium) are kept byte for byte: `.editorconfig` unsets the formatting for them and `tests/lint.sh` lists them in `generated`.
- The line length is not limited for shell and Markdown, YAML allows 160 characters; keep the code lines readable, around 120 characters.
- The comments are in English, short and to the point: why the code does something, not what it does.

## Shell scripts

### Format

The format is the one of shfmt with `.editorconfig`: 2 spaces, a space after a redirect operator (`> /dev/null`, `2> /dev/null`, `<<< "$x"`), `then` and `do` on the line of `if`, `for` and `while`, a long pipeline is split after `|` or `&&` with the next line indented.

```bash
#!/bin/bash

# wait_for <seconds> <command...>: runs the command every second until it succeeds, fails after the timeout
wait_for() {
  local timeout="$1"
  local start="$SECONDS"
  until "${@:2}" > /dev/null 2>&1; do
    if [[ $((SECONDS - start)) -ge "$timeout" ]]; then
      return 1
    fi
    sleep 1
  done
}
```

### Rules

- The shebang is `#!/bin/bash`, the scripts are bash scripts; `/bin/sh` code is only in the Dockerfile (`RUN`, the shell form of `HEALTHCHECK`).
- Tests with `[[ ]]`, never `[ ]` or `test`; arithmetic with `$(( ))` or `(( ))`.
- Command substitution with `$( )`, never backticks.
- Functions are defined as `name() {`, without the `function` keyword, and use `local` for their variables.
- A function has a comment line above it: `# name <arguments>: what it does or returns`.
- The expansions are quoted (`"$var"`, `"${array[@]}"`) unless word splitting is intended, and then a comment says why.
- Braces when the name is followed by a name character or for an expansion with an operator: `"${name}_suffix"`, `"${VAR:-default}"`, `"${var%%.*}"`; `"$var"` and `"${var}"` are both fine otherwise, keep one of them within a file.
- Another script is sourced with `.` or `source` and a `# shellcheck source=<path relative to the script>` line above it when its path is the one inside the image.
- A shellcheck finding is disabled only on the line above the code with the reason: `# <reason>` and `# shellcheck disable=SC2016`.
- The scripts of the image do not use `set -e`: they check the status of the commands that can fail and exit with the code of [Exit codes](#exit-codes). A tool script of `scripts/` that must stop on the first error starts with `set -euo pipefail`.
- Long scripts are split into sections with a `#### <Section>` comment line.

### Naming

| What | Style | Example |
| --- | --- | --- |
| env vars of the image, exported vars, constants | `UPPER_SNAKE_CASE` | `DEVICE_UDID`, `MIN_ANDROID` |
| variables and functions of the scripts of the image | `lowerCamelCase` | `isConfigValid`, `exitIfAdbServerStopped()` |
| variables and functions of `tests/`, `scripts/`, `build.sh` | `snake_case` | `check_contains()`, `diff_file` |
| file names | `kebab-case.sh`; `<subject>_test.sh` for the tests | `build-patch.sh`, `entrypoint_test.sh` |

The env vars of tools keep the names of the tools (e.g. `npm_config_cache`).

### Logging

- The scripts of the image log with `logger <LEVEL> <message>` of `util/logger.sh`: `[dd/mm/YYYY HH:MM:SS] [LEVEL] message`, the levels are `DEBUG`, `INFO`, `WARN`, `ERROR` and `LOGGER_LEVEL` sets the minimum one.
- The messages are sentences: `logger "ERROR" "Device ${DEVICE_UDID} is not connected!"`.
- `DEBUG=true`, `DEBUG_TIMEOUT` and `VERBOSE=true` of `util/debug.sh` are supported by every entrypoint.

### Exit codes

The entrypoint of a container started with a restart policy exits with:

- `0` for a problem a restart does not fix (an invalid configuration, a device that needs a person), so the restarts stop;
- `1` for a problem a restart may fix, so the container is started again;
- another code only when a caller expects it (e.g. `101` of appium), documented in the README.

The configuration is validated before anything starts: every invalid variable is logged, then the entrypoint exits with `0`.

## Tests

- A test script sources `tests/lib.sh` first, goes to `$REPO` and ends with `finish`:

  ```bash
  #!/bin/bash
  # Tests of util/logger.sh: the levels and the format.
  source "$(dirname "$0")/lib.sh"
  cd "$REPO" || exit 1

  section "levels"
  check "INFO is the default level" "1" "$(LOGGER_LEVEL= bash -c 'source util/logger.sh; logger DEBUG x; echo $?')"

  finish
  ```

- The checks are grouped by `section`; the assertions are `check`, `check_contains`, `check_not_contains`, `run_check`, or `pass`/`fail` for the rest; `skip_check` records a check that cannot run, `skip` the whole script (`require_cmd`, `require_os`).
- The tools of the image are replaced by stubs (`stub`, `record_stub`, `calls`) in `${WORK}/bin` at the front of `PATH`, so `make test` needs no docker and no device.
- The temporary files go to `$WORK`, removed on exit; a script frees its other resources (containers, ...) in its own `cleanup()`, which replaces the empty one of `tests/lib.sh`: never a new `trap ... EXIT`.
- The docker tests build the image once, `IMAGE` overrides its tag and `REBUILD=true` forces a new build.
- `tests/lib.sh` and `tests/lint.sh` run on the macOS system bash 3.2 (no `mapfile`, no associative arrays, no `${var^^}`); a test of a script of the image may need bash 4+ like the image (`brew install bash`).

## Dockerfile

```dockerfile
FROM alpine:3.24.1@sha256:<digest>

# the defaults of the configuration, all of them are documented in README.md
ENV DEVICE_UDID="" \
    POLLING_SEC=5 \
    # Debug mode
    DEBUG=false \
    DEBUG_TIMEOUT=3600 \
    VERBOSE=false

WORKDIR /opt/zebrunner/

# gcompat is needed by the glibc build of the tool
RUN apk add --no-cache \
        bash=5.3.9-r1 gcompat=1.1.0-r4 && \
    wget -q -O /tmp/tool.zip https://example.com/tool-1.2.3.zip && \
    echo "<sha256>  /tmp/tool.zip" > /tmp/tool.sha256 && \
    sha256sum -c /tmp/tool.sha256 && \
    rm -rf /tmp/tool.zip /tmp/tool.sha256

COPY util/ /opt/zebrunner/util/
COPY entrypoint.sh /opt/zebrunner/

ARG VERSION=dev
LABEL org.opencontainers.image.title="Zebrunner MCloud <name>" \
      org.opencontainers.image.description="<one line>" \
      org.opencontainers.image.source="https://github.com/zebrunner/<repository>" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.version="${VERSION}"

ENTRYPOINT ["/opt/zebrunner/entrypoint.sh"]

HEALTHCHECK --interval=20s --timeout=5s --start-period=120s --retries=3 \
    CMD ["sh", "-c", "<check>"]
```

- Everything is pinned: the base image by version (and digest where Dependabot updates it), the packages by version (`name=version-rN` for apk), the drivers and the npm packages by version, a download by its version and SHA-256 checked with `sha256sum -c`.
- The comments are `#` lines, the instructions are upper case.
- The continuation lines are indented by 4 spaces, the package names of an install command by 8; `&& \` ends a continued line.
- `${VAR}` with braces for the variables in the instructions; an empty default is `""`.
- `ENV` lists every variable of the configuration with its default, grouped by `#` comments; each one is documented in the README.
- `ENTRYPOINT`, `CMD` and `HEALTHCHECK` in the exec form; `sh -c` inside it when an env var is expanded.
- The layers go from the rarely to the often changed ones, the downloads are removed in the `RUN` that made them.
- The OCI labels with `ARG VERSION=dev`, the build passes the version: `--build-arg VERSION=<tag>`; `org.opencontainers.image.licenses` only when the repository declares its license.
- A hadolint rule is ignored for one instruction with `# hadolint ignore=<rule>` above it, for the whole file in `.hadolint.yaml`; both with the reason in a comment.
- `.dockerignore` keeps the build context to the files the image needs: `.git`, `.github`, `.idea`, `.venv`, `tests`, `*.md`, `.DS_Store` are excluded everywhere.

## YAML and GitHub Actions

- Every YAML file starts with `---`, 2 spaces, lines up to 160 characters, booleans only `true` and `false`, strings in double quotes when they need quotes (yamllint `--strict` with `.yamllint`).
- A comment is `#` and a space, at least one space after the content.
- The workflow is `.github/workflows/ci.yml`: `push` and `pull_request` on `develop`, `main`, `master` and `workflow_dispatch`; `concurrency` cancels the outdated runs of a pull request; `permissions: contents: read`.
- The jobs are `lint`, `tests`, `docker` (plus the project ones), each with `timeout-minutes` (`lint` and `tests` 10) and a JUnit report step `mikepenz/action-junit-report` with `annotate_only: true`, `detailed_summary: true`, `require_tests: true`.
- The `tests` job runs `make test`; the `docker` job uploads the JUnit XML as the `junit-docker` artifact.
- The `actions/*` are referenced by their major version tag, the other actions by the full commit SHA with the version in a comment: `uses: mikepenz/action-junit-report@<sha> # v6.6.0`.
- `.github/dependabot.yml` updates `github-actions`, `pip` (`directory: /tests`) and `docker` weekly, each with a comment of what it covers.

## Markdown

- pymarkdown with `.pymarkdown`: the line length is not limited, the allowed HTML is `p`, `a`, `img`, `b`, `br`.
- A paragraph or a list item is one line, no hard wraps.
- `-` for the list items, 2 spaces for a nested list.
- Tables with `| --- |` delimiters and spaces around the cell content.
- Fenced code blocks with the language: `bash`, `dockerfile`, `yaml`, `json`.
- The names of variables, files, commands and values are in backticks.
- The README sections, in this order, those that apply:
  1. `# <Title>`: what the image does, its base and platforms
  2. `## Image contents`: the components and their versions
  3. `## Build`
  4. `## Run`
  5. `## Configuration`: a table `| Variable | Default | Description |` with every env var of the Dockerfile
  6. the sections of the project (e.g. `## Startup`, `## Device type`, `## Limitations`, `## Troubleshooting`)
  7. `## Exit codes and health`
  8. `## Development`: the `make` targets and what they check, a link to this file
  9. `## Support`
  10. `## License`

## Makefile

- `make help` (the default goal) lists the targets with their `## <description>` comments.
- The targets are `help`, `check`, `lint`, `test`, `docker`, then the project ones; all of them are `.PHONY`.
- `check` runs `lint`, `test` and `docker`, every one of them, and fails when one failed.
- `test` runs every `tests/*_test.sh` but the ones of `DOCKER_TESTS`, `docker` runs `DOCKER_TESTS`: a new test script is picked up without a change of the `Makefile`.
- `lint` installs `tests/requirements-lint.txt` into `.venv` once (the stamp `.venv/.installed`).
- The recipes are indented with a tab, `SHELL := /bin/bash`.

## Git

- `develop` is the branch of the work, the pull requests go into it; `main` gets the releases.
- A branch is named in `kebab-case` by its subject: `fix-issue-288`, `style-conventions`.
- The commit messages are [Conventional Commits](https://www.conventionalcommits.org/): `<type>(<optional scope>): <summary>`, the summary in lower case without a final period, the types `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `build`, `ci`, `chore`.
- A formatting-only commit is listed in `.git-blame-ignore-revs` (GitHub skips it in blame; locally: `git config blame.ignoreRevsFile .git-blame-ignore-revs`).
- `make check` passes before a push.

## New repository checklist

1. Copy the [shared files](#shared-files) and the shared parts of the others from one of the repositories.
2. Set the project parts: `.dockerignore` comment, `.hadolint.yaml`, `DOCKER_TESTS`, the `scripts` and `generated` of `tests/lint.sh`, the docker job of the workflow.
3. Write `tests/<subject>_test.sh` for the scripts of the image and `tests/image_test.sh` for the image.
4. Write the README with the sections above.
5. `make check`.

## Known deviations

The rules not applied yet, each one is a separate change:

- appium logs with `echo "[info] ..."` instead of `util/logger.sh`.
