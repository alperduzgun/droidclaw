#!/bin/zsh

set -euo pipefail

PHONE_IP="${PHONE_IP:-100.92.27.52}"
ADB_PORT="${ADB_PORT:-5555}"
DEVICE="${DEVICE:-${PHONE_IP}:${ADB_PORT}}"
PROJECT_DIR="${PROJECT_DIR:-/Users/alperduzgun/droidclaw}"
ADB_BIN="${ADB_BIN:-adb}"
BUN_BIN="${BUN_BIN:-bun}"
SCREENSHOT_DIR="${SCREENSHOT_DIR:-${PROJECT_DIR}/screenshots}"

usage() {
  cat <<EOF
Usage: ./scripts/remote-droidclaw.sh <command>

Commands:
  interactive  Open guided menu
  connect      Connect to the phone over Tailscale ADB
  status       Show Tailscale/ADB status
  start        Connect and run DroidClaw kernel
  goal         Ask for a goal and run DroidClaw
  screenshot   Capture a screenshot from the remote phone
  shell        Open adb shell on the remote phone
  devices      Show adb devices
  disconnect   Disconnect remote ADB session

Optional overrides:
  PHONE_IP=100.x.y.z
  ADB_PORT=5555
  DEVICE=100.x.y.z:5555
  PROJECT_DIR=/path/to/droidclaw
  SCREENSHOT_DIR=/path/to/screenshots
EOF
}

ensure_tools() {
  command -v "$ADB_BIN" >/dev/null 2>&1 || { echo "adb not found"; exit 1; }
  command -v "$BUN_BIN" >/dev/null 2>&1 || { echo "bun not found"; exit 1; }
}

connect_device() {
  echo "Connecting to ${DEVICE}..."
  "$ADB_BIN" connect "$DEVICE"
}

run_kernel() {
  cd "$PROJECT_DIR"
  export ANDROID_SERIAL="$DEVICE"
  "$BUN_BIN" run src/kernel.ts
}

show_status() {
  echo "Tailscale IPs:"
  tailscale ip -4 || true
  echo
  echo "ADB devices:"
  "$ADB_BIN" devices
  echo
  echo "Remote device check (${DEVICE}):"
  "$ADB_BIN" -s "$DEVICE" shell getprop ro.product.model || true
}

start_kernel() {
  connect_device
  exec "$0" goal
}

run_goal() {
  local goal_text="${1:-}"

  if [[ -z "$goal_text" ]]; then
    printf "Goal: "
    IFS= read -r goal_text
  fi

  if [[ -z "$goal_text" ]]; then
    echo "No goal provided."
    return 1
  fi

  connect_device
  printf "%s\n" "$goal_text" | run_kernel
}

open_shell() {
  connect_device
  exec "$ADB_BIN" -s "$DEVICE" shell
}

capture_screenshot() {
  connect_device

  mkdir -p "$SCREENSHOT_DIR"

  local ts
  ts="$(date +%Y%m%d-%H%M%S)"
  local remote_path="/sdcard/droidclaw-${ts}.png"
  local local_path="${SCREENSHOT_DIR}/droidclaw-${ts}.png"

  "$ADB_BIN" -s "$DEVICE" shell screencap -p "$remote_path"
  "$ADB_BIN" -s "$DEVICE" pull "$remote_path" "$local_path" >/dev/null

  echo "Screenshot saved:"
  echo "  ${local_path}"

  if command -v open >/dev/null 2>&1; then
    open "$local_path" >/dev/null 2>&1 || true
  fi
}

disconnect_device() {
  "$ADB_BIN" disconnect "$DEVICE"
}

interactive_menu() {
  while true; do
    cat <<EOF

Remote DroidClaw
  Device: ${DEVICE}

  1. Status
  2. Connect
  3. Start DroidClaw and enter goal
  4. Capture screenshot
  5. Open adb shell
  6. Show adb devices
  7. Disconnect
  8. Change device IP/port
  0. Exit
EOF

    printf "Select: "
    local choice
    IFS= read -r choice

    case "$choice" in
      1)
        ensure_tools
        show_status
        ;;
      2)
        ensure_tools
        connect_device
        ;;
      3)
        ensure_tools
        run_goal
        ;;
      4)
        ensure_tools
        capture_screenshot
        ;;
      5)
        ensure_tools
        open_shell
        ;;
      6)
        ensure_tools
        "$ADB_BIN" devices
        ;;
      7)
        ensure_tools
        disconnect_device
        ;;
      8)
        printf "Phone IP [%s]: " "$PHONE_IP"
        local new_ip
        IFS= read -r new_ip
        if [[ -n "$new_ip" ]]; then
          PHONE_IP="$new_ip"
        fi

        printf "ADB Port [%s]: " "$ADB_PORT"
        local new_port
        IFS= read -r new_port
        if [[ -n "$new_port" ]]; then
          ADB_PORT="$new_port"
        fi

        DEVICE="${PHONE_IP}:${ADB_PORT}"
        echo "Updated device: ${DEVICE}"
        ;;
      0)
        return 0
        ;;
      *)
        echo "Unknown selection: $choice"
        ;;
    esac
  done
}

main() {
  local cmd="${1:-}"

  case "$cmd" in
    interactive)
      ensure_tools
      interactive_menu
      ;;
    connect)
      ensure_tools
      connect_device
      ;;
    status)
      ensure_tools
      show_status
      ;;
    start)
      ensure_tools
      start_kernel
      ;;
    goal)
      ensure_tools
      shift || true
      run_goal "${*:-}"
      ;;
    screenshot)
      ensure_tools
      capture_screenshot
      ;;
    shell)
      ensure_tools
      open_shell
      ;;
    devices)
      ensure_tools
      "$ADB_BIN" devices
      ;;
    disconnect)
      ensure_tools
      disconnect_device
      ;;
    "" )
      ensure_tools
      interactive_menu
      ;;
    -h|--help|help)
      usage
      ;;
    *)
      echo "Unknown command: $cmd"
      echo
      usage
      exit 1
      ;;
  esac
}

main "$@"
