#!/bin/bash

platform="${BUILD_PLATFORM:-linux/amd64}"
if [[ "$platform" != "linux/amd64" ]]; then
  echo "[error] the image is linux/amd64 only: the base image appium/appium is amd64 only, got BUILD_PLATFORM=${platform}"
  exit 1
fi

cmd=(docker build . --progress plain --platform "$platform" --provenance=false)

tagPath="public.ecr.aws/zebrunner/appium"

if [[ "$1" == "-i" ]]; then
  shift
else
  cmd+=(--target appium)
fi

if [[ -z "$1" ]]; then
  echo "Usage: $0 [-i] <tagVersion>"
  echo "  Where:"
  echo "    -i          - build docker image with image(photo) processing plugin"
  echo "     ---"
  echo "    tagVersion  - desired version for image build (e.g. 3.0, 2.1.5-demo)"
  exit 1
else
  tagVersion=$1
  cmd+=(--tag "$tagPath":"$tagVersion")
fi

echo "Following command will be executed:"
echo ""
echo "    ${cmd[*]}"
echo ""
read -r -p "Press any key to continue or CTRL+C to interrupt execution"
echo ""

"${cmd[@]}"
status=$?

echo ""
echo ""
if [ $status -eq 0 ]; then
  echo "--- Successfully built: --------------------------------------------------"
  echo ""
  echo "    $tagPath:$tagVersion"
  echo ""
  echo "--------------------------------------------------------------------------"
else
  echo "--------------------------------------------------------------------------"
  echo "Build failed"
  echo "--------------------------------------------------------------------------"
fi
echo ""
echo ""

exit $status
