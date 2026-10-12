# Project checks; `make check` runs the linters, the script tests and the docker image tests
SHELL := /bin/bash
VENV := .venv
export PATH := $(CURDIR)/$(VENV)/bin:$(PATH)

.DEFAULT_GOAL := help
.PHONY: help check lint test docker image patch e2e

help: ## this list
	@grep -E '^[a-z0-9]+:.*## ' $(MAKEFILE_LIST) | sed -E 's/:.*## /\t/'

check: ## everything below, as CI runs it; every step runs, the failed ones fail the target
	@status=0; for target in lint test docker; do $(MAKE) --no-print-directory $$target || status=1; done; exit $$status

lint: $(VENV)/.installed ## the linters (tests/lint.sh): yaml, workflows, Dockerfile, markdown, shell, the patch
	tests/lint.sh

test: ## the tests of build.sh and the config generators, no docker needed
	@status=0; for t in tests/build_test.sh tests/config_test.sh; do $$t || status=1; done; exit $$status

docker: ## the docker tests: image, patch and e2e (the image is built once, IMAGE overrides its tag)
	@status=0; for t in tests/image_test.sh tests/patch_test.sh tests/e2e_test.sh; do $$t || status=1; done; exit $$status

image: ## the image build, its contents and the Appium startup (tests/image_test.sh)
	tests/image_test.sh

patch: ## the tests of the Appium patch inside the image (tests/patch_test.sh, tests/patch/*.test.mjs)
	tests/patch_test.sh

e2e: ## the device containers with a fake device: startup, health, video recording (tests/e2e_test.sh)
	tests/e2e_test.sh

# The tools of tests/requirements-lint.txt in .venv; the hadolint-py wheel for macOS is broken, brew provides it there
$(VENV)/.installed: tests/requirements-lint.txt
	python3 -m venv $(VENV)
	@if [[ "$$(uname)" == Darwin ]]; then \
	  grep -v '^hadolint-py' tests/requirements-lint.txt > $(VENV)/requirements.txt; \
	else \
	  cp tests/requirements-lint.txt $(VENV)/requirements.txt; \
	fi
	$(VENV)/bin/pip install --quiet --disable-pip-version-check --requirement $(VENV)/requirements.txt
	@command -v hadolint > /dev/null || { echo "hadolint is missing: brew install hadolint"; exit 1; }
	touch $@
