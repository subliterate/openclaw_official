#!/bin/bash
# deploy-fix.sh — validate → build → restart openclaw gateway atomically.
# Run after any source change to openclaw_official.
# Usage: ./scripts/deploy-fix.sh [--skip-build]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
OPENCLAW=/home/terry/.local/bin/openclaw

log() { echo "[deploy-fix] $*"; }

# ── 1. Validate current config before touching anything ───────────────────────
log "Validating config..."
if ! "$OPENCLAW" config validate; then
    echo "[deploy-fix] ERROR: Config is invalid. Fix openclaw.json before deploying." >&2
    exit 1
fi

# ── 2. Build (unless skipped) ─────────────────────────────────────────────────
if [[ "${1:-}" != "--skip-build" ]]; then
    log "Building from source..."
    cd "$REPO"
    npm run build
    log "Build complete."
else
    log "Skipping build (--skip-build passed)."
fi

# ── 3. Validate config again against freshly built schema ────────────────────
log "Re-validating config against new build..."
if ! "$OPENCLAW" config validate; then
    echo "[deploy-fix] ERROR: Config invalid against new schema. Gateway NOT restarted." >&2
    echo "[deploy-fix] Run: openclaw doctor --fix   then retry." >&2
    exit 1
fi

# ── 4. Restart ────────────────────────────────────────────────────────────────
log "Restarting gateway..."
systemctl --user restart openclaw-gateway.service

# ── 5. Confirm startup ────────────────────────────────────────────────────────
sleep 4
if systemctl --user is-active --quiet openclaw-gateway.service; then
    log "Gateway is running."
    journalctl --user -u openclaw-gateway.service -n 5 --no-pager
else
    echo "[deploy-fix] ERROR: Gateway failed to start after restart." >&2
    journalctl --user -u openclaw-gateway.service -n 20 --no-pager
    exit 1
fi
