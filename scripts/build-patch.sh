#!/bin/bash
# Builds the patched @appium/base-driver from files/patch/appium-<version>.diff and copies the built js files of
# the patched sources into files/patch/node_modules (the files of the image) or into --out <dir>.
# The Appium version is the one of the base image in the Dockerfile (appium/appium:v3.3.0-p0 -> appium@3.3.0).
# Needs docker: the build runs in NODE_IMAGE (node:22), the npm cache is kept in the zbr-appium-npm-cache volume.
#
# Usage: scripts/build-patch.sh [--out <dir>]
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
NODE_IMAGE="${NODE_IMAGE:-node:22}"
TARGET="$REPO/files/patch/node_modules/@appium/base-driver/build/lib"
OUT=""
if [[ "${1:-}" == "--out" && -n "${2:-}" ]]; then
  OUT="$2"
elif [[ $# -gt 0 ]]; then
  echo "Usage: $0 [--out <dir>]" >&2
  exit 2
fi

version="$(sed -n -E 's|^FROM appium/appium:v([0-9]+\.[0-9]+\.[0-9]+)(-[^ ]*)? AS appium$|\1|p' "$REPO/Dockerfile")"
if [[ -z "$version" ]]; then
  echo "[error] no 'FROM appium/appium:v<version> AS appium' in the Dockerfile" >&2
  exit 1
fi
diff_file="files/patch/appium-${version//./_}.diff"
if [[ ! -f "$REPO/$diff_file" ]]; then
  echo "[error] no $diff_file for appium@${version} of the base image" >&2
  exit 1
fi

# the patched sources: packages/base-driver/lib/<path>.(ts|js) -> build/lib/<path>.js
patched="$(sed -n -E 's#^\+\+\+ b/packages/base-driver/lib/(.*)\.(ts|js)$#\1.js#p' "$REPO/$diff_file" | sort)"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cp "$REPO/$diff_file" "$work/patch.diff"
echo "$patched" > "$work/patched"

echo "building @appium/base-driver of appium@${version} with ${diff_file} in ${NODE_IMAGE}"
docker run --rm \
  --volume "$work:/work" \
  --volume zbr-appium-npm-cache:/npm-cache \
  --env npm_config_cache=/npm-cache \
  --env npm_config_update_notifier=false \
  --env VERSION="$version" \
  --env OWNER="$(id -u):$(id -g)" \
  "$NODE_IMAGE" bash -c '
    set -euo pipefail
    git clone -q -c advice.detachedHead=false --depth 1 --branch "appium@${VERSION}" https://github.com/appium/appium.git /src
    cd /src
    git apply --check /work/patch.diff
    git apply /work/patch.diff
    npm ci --ignore-scripts --no-audit --no-fund --loglevel=error
    npx tsc -b packages/base-driver
    mkdir -p /work/out
    while read -r file; do
      mkdir -p "/work/out/$(dirname "$file")"
      cp "packages/base-driver/build/lib/$file" "/work/out/$file"
    done < /work/patched
    chown -R "$OWNER" /work/out'

if [[ -n "$OUT" ]]; then
  mkdir -p "$OUT"
  cp -R "$work/out/." "$OUT/"
  echo "built files: $OUT"
else
  # the built files replace the files of the image, copies of sources not in the diff anymore are removed
  find "$TARGET" -name '*.js' -type f | while read -r file; do
    grep -qxF "${file#"$TARGET"/}" "$work/patched" || rm -v "$file"
  done
  cp -R "$work/out/." "$TARGET/"
  echo "updated: ${TARGET#"$REPO"/}"
fi
