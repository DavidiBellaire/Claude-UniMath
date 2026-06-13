#!/bin/bash
# ============================================================================
# Claude-UniMath — macOS Installer
#
# Author: Davidi Bellaire (github.com/DavidiBellaire)
#
# Adds universal right-to-left + mathematics support to Claude Desktop on
# macOS. Every RTL script (Hebrew, Arabic, Persian, Urdu, Syriac, and more)
# is detected, English and LaTeX/KaTeX are isolated as left-to-right islands,
# and code blocks stay LTR — so mixed-direction text with math renders cleanly.
#
# Design:
#   - The original /Applications/Claude.app is NEVER modified.
#   - A patched copy is built at ~/Applications/Claude-UniMath.app.
#   - No sudo required; everything happens in your home folder.
#   - Fully reversible: uninstall just deletes the copy.
#
# Requirements: Node.js (npx) and Xcode CLI tools (codesign).
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PAYLOAD_FILE="$SCRIPT_DIR/src/payload.js"
ICON_FILE="$SCRIPT_DIR/assets/icon.icns"   # optional

SOURCE_APP="/Applications/Claude.app"
APP_NAME="Claude-UniMath"
PATCHED_APP="$HOME/Applications/$APP_NAME.app"
PATCHED_ASAR="$PATCHED_APP/Contents/Resources/app.asar"
MARKER="CLAUDE-UNIMATH START"

TMP_DIR=""

# --- pretty output ---------------------------------------------------------
C_RED=$'\033[0;31m'; C_GRN=$'\033[0;32m'; C_YLW=$'\033[0;33m'
C_CYN=$'\033[0;36m'; C_BLD=$'\033[1m'; C_NC=$'\033[0m'
log()     { printf '  %s[*]%s %s\n' "$C_CYN" "$C_NC" "$1"; }
ok()      { printf '  %s[+]%s %s\n' "$C_GRN" "$C_NC" "$1"; }
warn()    { printf '  %s[!]%s %s\n' "$C_YLW" "$C_NC" "$1"; }
err()     { printf '  %s[x]%s %s\n' "$C_RED" "$C_NC" "$1"; }
step()    { printf '\n%s%s> %s%s\n' "$C_BLD" "$C_CYN" "$1" "$C_NC"; }
die()     { err "$1"; exit 1; }

cleanup() { [ -n "$TMP_DIR" ] && [ -d "$TMP_DIR" ] && rm -rf "$TMP_DIR" 2>/dev/null || true; }
trap cleanup EXIT

# --- dependency tools ------------------------------------------------------
asar_cmd() {
  if command -v asar >/dev/null 2>&1; then asar "$@";
  elif command -v npx >/dev/null 2>&1; then npx --yes @electron/asar "$@";
  else die "Neither 'asar' nor 'npx' is available."; fi
}
fuses_cmd() {
  command -v npx >/dev/null 2>&1 || die "npx (Node.js) is required for @electron/fuses."
  npx --yes @electron/fuses "$@"
}

check_deps() {
  local missing=()
  command -v npx >/dev/null 2>&1 || command -v asar >/dev/null 2>&1 || \
    missing+=("Node.js (provides npx)")
  command -v npx >/dev/null 2>&1 || missing+=("Node.js (needed for @electron/fuses)")
  command -v codesign >/dev/null 2>&1 || missing+=("Xcode CLI tools (codesign)")
  if [ ${#missing[@]} -gt 0 ]; then
    err "Missing dependencies:"
    for d in "${missing[@]}"; do printf '      - %s\n' "$d"; done
    printf '\n  Install Node.js: https://nodejs.org/ or  brew install node\n'
    printf '  Install Xcode CLI tools:  xcode-select --install\n\n'
    exit 1
  fi
}

quit_patched() {
  if pgrep -f "$APP_NAME.app" >/dev/null 2>&1; then
    step "Quitting running $APP_NAME..."
    osascript -e "tell application \"$APP_NAME\" to quit" 2>/dev/null || true
    sleep 2
    pkill -f "$APP_NAME.app/Contents/MacOS" 2>/dev/null || true
    sleep 1
    ok "$APP_NAME stopped."
  fi
}

# --- install ---------------------------------------------------------------
install_patch() {
  printf '\n%s%s================================================%s\n' "$C_BLD" "$C_CYN" "$C_NC"
  printf '%s%s     Claude-UniMath — Install%s\n' "$C_BLD" "$C_CYN" "$C_NC"
  printf '%s%s================================================%s\n\n' "$C_BLD" "$C_CYN" "$C_NC"

  [ -d "$SOURCE_APP" ] || die "Claude.app not found at $SOURCE_APP. Is Claude Desktop installed?"
  [ -f "$PAYLOAD_FILE" ] || die "payload.js not found at $PAYLOAD_FILE. Re-clone the repository."
  check_deps
  quit_patched

  step "Creating patched copy..."
  mkdir -p "$HOME/Applications"
  [ -d "$PATCHED_APP" ] && { log "Removing previous copy..."; rm -rf "$PATCHED_APP"; }
  log "Copying Claude.app -> $APP_NAME.app ..."
  cp -R "$SOURCE_APP" "$PATCHED_APP"
  ok "Created $PATCHED_APP"

  if [ -f "$ICON_FILE" ]; then
    step "Applying custom icon..."
    cp "$ICON_FILE" "$PATCHED_APP/Contents/Resources/electron.icns"
    /usr/libexec/PlistBuddy -c "Delete :CFBundleIconName" "$PATCHED_APP/Contents/Info.plist" 2>/dev/null || true
    ok "Icon applied."
  fi

  step "Renaming app to $APP_NAME (cosmetic)..."
  # CFBundleDisplayName is cosmetic; do NOT touch CFBundleName (breaks fuse lookup).
  /usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string $APP_NAME" "$PATCHED_APP/Contents/Info.plist" 2>/dev/null \
    || /usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName $APP_NAME" "$PATCHED_APP/Contents/Info.plist"
  ok "Will display as \"$APP_NAME\"."

  TMP_DIR="$(mktemp -d)"
  step "Extracting app.asar..."
  asar_cmd extract "$PATCHED_ASAR" "$TMP_DIR/app"
  ok "Extracted."

  step "Injecting Claude-UniMath payload..."
  local build_dir="$TMP_DIR/app/.vite/build"
  [ -d "$build_dir" ] || die ".vite/build/ not found — Claude Desktop's internal structure may have changed."
  local injected=0 skipped=0
  for js in "$build_dir"/*.js; do
    [ -f "$js" ] || continue
    if grep -q "$MARKER" "$js" 2>/dev/null; then skipped=$((skipped+1)); continue; fi
    cat "$PAYLOAD_FILE" "$js" > "$TMP_DIR/merged.js"
    mv "$TMP_DIR/merged.js" "$js"
    injected=$((injected+1))
    log "patched: $(basename "$js")"
  done
  [ "$injected" -eq 0 ] && [ "$skipped" -eq 0 ] && die "No .js files in .vite/build/."
  [ "$injected" -gt 0 ] && ok "Injected into $injected file(s)."
  [ "$skipped" -gt 0 ] && log "Skipped $skipped already-patched file(s)."

  step "Repacking app.asar..."
  asar_cmd pack "$TMP_DIR/app" "$TMP_DIR/app.asar.new"
  cp "$TMP_DIR/app.asar.new" "$PATCHED_ASAR"
  ok "Repacked."

  step "Disabling ASAR integrity fuse..."
  log "Electron validates the archive hash at startup; the modified archive"
  log "needs this fuse off or the app refuses to launch."
  fuses_cmd write --app "$PATCHED_APP" EnableEmbeddedAsarIntegrityValidation=off 2>&1 \
    | while IFS= read -r line; do log "$line"; done
  ok "Fuse disabled."

  step "Re-signing (ad-hoc)..."
  log "Our changes invalidate Anthropic's signature; ad-hoc signing lets macOS run the copy."
  local ent="$TMP_DIR/entitlements.plist"
  if codesign -d --entitlements :- "$SOURCE_APP" > "$ent" 2>/dev/null && [ -s "$ent" ]; then
    # Strip team-id-coupled keys that macOS rejects under ad-hoc signing.
    /usr/libexec/PlistBuddy -c "Delete :com.apple.application-identifier" "$ent" 2>/dev/null || true
    /usr/libexec/PlistBuddy -c "Delete :com.apple.developer.team-identifier" "$ent" 2>/dev/null || true
    /usr/libexec/PlistBuddy -c "Delete :keychain-access-groups" "$ent" 2>/dev/null || true
    log "Preserving original entitlements (keeps features like Cowork working)..."
    codesign --force --deep --sign - --entitlements "$ent" "$PATCHED_APP" 2>&1 \
      | while IFS= read -r line; do log "$line"; done
  else
    warn "Could not read original entitlements — some features may not work."
    codesign --force --deep --sign - "$PATCHED_APP" 2>&1 \
      | while IFS= read -r line; do log "$line"; done
  fi
  ok "Re-signed."

  rm -rf "$TMP_DIR" 2>/dev/null || true; TMP_DIR=""

  step "Launching $APP_NAME..."
  open "$PATCHED_APP"

  printf '\n%s%s================================================%s\n' "$C_BLD" "$C_GRN" "$C_NC"
  printf '%s%s     INSTALLED SUCCESSFULLY%s\n' "$C_BLD" "$C_GRN" "$C_NC"
  printf '%s%s================================================%s\n\n' "$C_BLD" "$C_GRN" "$C_NC"
  printf '  Patched app:  %s%s%s\n' "$C_BLD" "$PATCHED_APP" "$C_NC"
  printf '  Original app: %s%s%s (untouched)\n\n' "$C_BLD" "$SOURCE_APP" "$C_NC"
  printf '  Re-run after each Claude update:  %s./install.sh --install%s\n' "$C_BLD" "$C_NC"
  printf '  Remove:                           %s./install.sh --uninstall%s\n\n' "$C_BLD" "$C_NC"
}

uninstall_patch() {
  printf '\n%s%s================================================%s\n' "$C_BLD" "$C_CYN" "$C_NC"
  printf '%s%s     Claude-UniMath — Uninstall%s\n' "$C_BLD" "$C_CYN" "$C_NC"
  printf '%s%s================================================%s\n\n' "$C_BLD" "$C_CYN" "$C_NC"
  if [ ! -d "$PATCHED_APP" ]; then warn "Nothing to remove at $PATCHED_APP."; exit 0; fi
  quit_patched
  step "Removing patched app..."
  rm -rf "$PATCHED_APP"
  ok "Removed $PATCHED_APP"
  printf '\n  The original Claude.app was never modified.\n\n'
}

show_status() {
  printf '\n%sClaude-UniMath — Status%s\n\n' "$C_BLD" "$C_NC"
  if [ -d "$SOURCE_APP" ]; then
    local v; v="$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$SOURCE_APP/Contents/Info.plist" 2>/dev/null || echo unknown)"
    ok "Original Claude.app: installed (v$v)"
  else
    warn "Original Claude.app: not found"
  fi
  if [ -d "$PATCHED_APP" ]; then
    local pv; pv="$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$PATCHED_APP/Contents/Info.plist" 2>/dev/null || echo unknown)"
    local fuse; fuse="$(npx --yes @electron/fuses read --app "$PATCHED_APP" 2>/dev/null | grep EnableEmbeddedAsarIntegrityValidation || echo unknown)"
    if printf '%s' "$fuse" | grep -q "Disabled"; then
      ok "Patched $APP_NAME.app: installed (v$pv, fuse disabled)"
    else
      warn "Patched $APP_NAME.app: found (v$pv) but fuse state unclear"
    fi
  else
    log "Patched $APP_NAME.app: not installed"
  fi
  printf '\n'
}

usage() {
  cat <<EOF

${C_BLD}Claude-UniMath — macOS Installer${C_NC}

Usage: $0 [OPTION]

  --install     Build patched copy at ~/Applications/$APP_NAME.app
  --uninstall   Remove the patched app
  --status      Show install status
  --help        This message

With no option, an interactive menu is shown.

EOF
}

menu() {
  printf '%s%s== Claude-UniMath (macOS) ==%s\n\n' "$C_BLD" "$C_CYN" "$C_NC"
  printf '  1. Install\n  2. Uninstall\n  3. Status\n  4. Exit\n\n'
  read -rp "  Choice (1-4): " choice
  case "$choice" in
    1) install_patch ;;
    2) uninstall_patch ;;
    3) show_status ;;
    4) exit 0 ;;
    *) die "Invalid choice." ;;
  esac
}

case "${1:-}" in
  --install)   install_patch ;;
  --uninstall) uninstall_patch ;;
  --status)    show_status ;;
  --help|-h)   usage ;;
  "")          menu ;;
  *)           err "Unknown option: $1"; usage; exit 1 ;;
esac
