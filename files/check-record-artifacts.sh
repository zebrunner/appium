#!/bin/bash

shopt -s nullglob

: "${LOG_DIR:?LOG_DIR not set}"
: "${APPIUM_PORT:?APPIUM_PORT not set}"

while :; do
  sleep 100

  files=("$LOG_DIR"/.recording-artifact-*)
  if ((${#files[@]} == 0)); then
    sleep 300
    continue
  fi

  response=$(curl -fsS --max-time 5 "http://127.0.0.1:${APPIUM_PORT}/wd/hub/sessions/") || {
    echo "ERROR: failed to fetch sessions"
    sleep 300
    continue
  }

  mapfile -t session_ids < <(jq -r '.value[]?.id' <<< "$response" 2>/dev/null) || {
    echo "ERROR: failed to parse JSON response"
    sleep 300
    continue
  }

  if [[ ${#session_ids[@]} -eq 0 ]]; then
    echo "No active sessions found"
  else
    echo "Active sessions:"
    echo "${session_ids[*]}" | tr ' ' '\n'
  fi

  declare -A active_sessions=()
  for sid in "${session_ids[@]}"; do
    [[ -n "$sid" ]] && active_sessions["$sid"]=1
  done

  for file in "${files[@]}"; do
    [[ -f "$file" ]] || continue
    session_id="${file##*.recording-artifact-}"

    if [[ -z "${active_sessions[$session_id]:-}" ]]; then
      echo "Deleting: $file (session: $session_id)"
      rm -f -- "$file"
    fi
  done
done
