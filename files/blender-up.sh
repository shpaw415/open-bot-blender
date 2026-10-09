#!/bin/sh
# blender plugin service supervisor (open-bot blender plugin).
# Keeps one headless Blender alive on 127.0.0.1:9876 and honors the plugin's
# "enabled" setting from ~/.config/open-bot/plugin-blender.json. Started by
# the plugin's setup commands; the pidfile guard makes re-runs a no-op.
set -u

config=/home/agent/.config/open-bot/plugin-blender.json
pidfile=/home/agent/.open-bot/blender-up.pid
log=/home/agent/.open-bot/blender.log
serve=/home/agent/.open-bot/plugin-blender/blender-serve.py
requests=/home/agent/.open-bot/plugin-blender/requests

if [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile" 2>/dev/null)" 2>/dev/null; then
  exit 0
fi
echo $$ >"$pidfile"
trap 'rm -f "$pidfile"' EXIT

enabled() {
  [ -f "$config" ] || return 0
  value=$(sed -n 's/.*"enabled"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$config" | head -n 1)
  [ "$value" != "off" ]
}

running() {
  pgrep -f blender-serve.py >/dev/null 2>&1
}

# blender runs in the background so this loop keeps evaluating the toggle
# every cycle; startpid fences the slow xvfb/blender startup window so the
# loop does not double-spawn before the serve process appears.
startpid=""
while :; do
  if enabled; then
    if running; then
      startpid=""
    elif [ -n "$startpid" ] && kill -0 "$startpid" 2>/dev/null; then
      : # xvfb/blender still coming up
    elif command -v blender >/dev/null 2>&1 && [ -f "$serve" ]; then
      echo "$(date -u +%FT%TZ) blender starting" >>"$log"
      BLENDER_MCP_PORT="${BLENDER_MCP_PORT:-9876}" \
        PYTHONPATH="$requests${PYTHONPATH:+:$PYTHONPATH}" \
        xvfb-run -a blender --factory-startup -noaudio \
        -P "$serve" >>"$log" 2>&1 &
      startpid=$!
    fi
  else
    startpid=""
    if running; then
      pkill -f "blender --factory-startup" 2>/dev/null || true
      pkill -f blender-serve.py 2>/dev/null || true
      pkill -f "xvfb-run -a blender" 2>/dev/null || true
      echo "$(date -u +%FT%TZ) blender stopped (plugin service off)" >>"$log"
    fi
  fi
  sleep 2
done
