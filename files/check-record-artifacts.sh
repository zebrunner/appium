#!/bin/bash

shopt -s nullglob

: "${LOG_DIR:?LOG_DIR not set}"
: "${APPIUM_PORT:?APPIUM_PORT not set}"

while :; do
  sleep 100

  files=("$LOG_DIR"/.recording-artifact-*)
  if ((${#files[@]})); then
    response=$(curl -fsS --max-time 5 "http://127.0.0.1:${APPIUM_PORT}/wd/hub/sessions/") || {
      echo "ERROR: failed to fetch sessions"
      sleep 300
      continue
    }

    active_session_id=$(jq -r '.value[0].id // empty' <<< "$response" 2> /dev/null) || {
      echo "ERROR: failed to parse JSON response"
      sleep 300
      continue
    }

    if [[ -z "$active_session_id" ]]; then
      echo "No active session found"
    fi

  else
    sleep 300
    continue
  fi

  for file in "${files[@]}"; do
    [[ -f "$file" ]] || continue

    session_id="${file##*.recording-artifact-}"

    if [[ "$active_session_id" != "$session_id" ]]; then
      echo "Deleting: $file (session: $session_id)"
      rm -f -- "$file"
    fi
  done
done
