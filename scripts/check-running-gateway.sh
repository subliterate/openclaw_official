#!/usr/bin/env bash
# Check where the current openclaw-gateway is running from
# and gather info needed for safe switchover

set -euo pipefail

echo "=== Running openclaw processes ==="
ps aux | grep -i openclaw | grep -v grep || echo "(none found)"

GATEWAY_PID=$(pgrep -f openclaw-gateway 2>/dev/null | head -1)

if [[ -n "${GATEWAY_PID:-}" ]]; then
  echo ""
  echo "=== Gateway process (PID $GATEWAY_PID) ==="
  echo "Working dir: $(readlink -f /proc/$GATEWAY_PID/cwd 2>/dev/null || echo 'unknown')"
  echo "Executable:  $(readlink -f /proc/$GATEWAY_PID/exe 2>/dev/null || echo 'unknown')"
  echo "Cmdline:     $(cat /proc/$GATEWAY_PID/cmdline 2>/dev/null | tr '\0' ' ' || echo 'unknown')"
else
  echo ""
  echo "(no openclaw-gateway process found)"
fi

echo ""
echo "=== Global install ==="
echo "Which:   $(which openclaw 2>/dev/null || echo 'not found')"
echo "Version: $(openclaw --version 2>/dev/null || echo 'unknown')"

echo ""
echo "=== Credentials ==="
ls -la ~/.openclaw/credentials/ 2>/dev/null || echo "(no credentials dir)"

echo ""
echo "=== Gmail references in config ==="
grep -i gmail ~/.openclaw/openclaw.json 2>/dev/null || echo "(none found)"

echo ""
echo "=== Config file ==="
cat ~/.openclaw/openclaw.json 2>/dev/null | head -60 || echo "(not found)"
