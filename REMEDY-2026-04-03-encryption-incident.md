# Incident Report: Failed Secret Encryption Migration

**Date**: 2026-04-03
**Session**: Claude Opus 4.6 (main conversation)
**Outcome**: Config and systemd service reverted to original state after multiple failures

---

## Objective

Encrypt plaintext API keys and tokens in `~/.openclaw/openclaw.json` and `~/.config/systemd/user/openclaw-gateway.service` using sops + age, with zero agent access friction.

## What Was Attempted

1. Installed sops and age on Linux Mint 22.1
2. Generated age keypair at `~/.config/sops/age/keys.txt`
3. Created sops-encrypted secrets file at `~/.openclaw/secrets.enc.json`
4. Replaced plaintext values in `openclaw.json` with SecretRef objects
5. Created exec secret provider scripts for the OpenClaw secrets resolution protocol
6. Modified systemd service unit to use decrypted env vars via ExecStartPre

## What Went Wrong

### Failure 1: `env` block schema mismatch

- **What**: Placed SecretRef objects in the `env` config block
- **Why**: Did not verify the schema before editing. The `env` block is a `Record<string, string>` — it only accepts plain strings, not SecretRef objects.
- **Impact**: Config validation failure, build refused to complete

### Failure 2: Non-existent gmail channel

- **What**: Build rejected `channels.gmail` as unknown
- **Why**: Gmail is not a built-in or bundled channel plugin in this repo. The config entry was a leftover from a fork.
- **Impact**: Build failure after fixing Failure 1. Required removing gmail config, plugin entries, and binding.

### Failure 3: Stale plugin references

- **What**: Warnings for `messenger` and `google-gemini-cli-auth` plugins
- **Why**: These plugins don't exist in the current build. Stale config entries.
- **Impact**: Non-fatal warnings, but required further config cleanup.

### Failure 4: Wrong exec provider protocol

- **What**: Wrote `decrypt-secret.sh` as a CLI-arg-based script (`decrypt-secret.sh <KEY_NAME>`)
- **Why**: Did not read `src/secrets/resolve.ts` before writing the script. The exec secret provider uses a stdin-based JSON protocol (protocolVersion 1), not CLI arguments.
- **Impact**: Discord token and gateway auth token failed to resolve. Gateway crash loop.

### Failure 5: systemd environment isolation

- **What**: Gateway service could not run sops because env vars were missing
- **Why**: The exec provider runs scripts with a stripped environment. `SOPS_AGE_KEY_FILE`, `HOME`, and `PATH` were not passed through.
- **Impact**: `SecretProviderResolutionError: Exec provider "sops" exited with code 1`. Gateway crash loop (411+ restarts).

### Failure 6: API keys not available to CLI backends

- **What**: Even after SecretRef resolution worked for Discord/gateway tokens, the `codex` and `gemini` CLI backends had no API keys
- **Why**: CLI backends (`codex exec`, `gemini`) read API keys from their own process environment. Moving keys from the `env` config block to SecretRef removed them from the process environment. The `env` block sets process-level env vars; SecretRef resolves at a different layer.
- **Impact**: All models failed in cascade. `gpt-5.3-codex` -> `gpt-5.2-codex` -> `gemini-2.5-pro` -> `gemini-2.5-flash` -> `gemini-3-pro-preview` (only the last succeeded via embedded runner, not CLI backend).

### Failure 7: ExecStartPre approach for systemd

- **What**: Added ExecStartPre script to decrypt API keys into an EnvironmentFile before gateway start
- **Why**: Attempted to solve the CLI backend env var problem via systemd-level decryption
- **Impact**: Service failed to start — likely due to the ExecStartPre script itself failing in the systemd environment (could not diagnose further without shell access).

## Root Cause Analysis

The migration touched **four independent system boundaries** simultaneously:

1. **OpenClaw config schema** — which fields accept SecretRef vs plain strings
2. **OpenClaw secret resolution protocol** — stdin JSON protocol v1, not CLI args
3. **systemd environment isolation** — minimal env, no shell profile sourcing
4. **CLI backend env passthrough** — codex/gemini binaries need API keys in process env, independent of OpenClaw's secret resolution

Each boundary was discovered only after the previous fix failed. The agent (Claude) could not run shell commands in this session, making every fix a blind guess requiring user testing.

## What Was Left Behind (Inert)

These files were created during the attempt and remain on disk but are not referenced by any active config:

- `~/.openclaw/secrets.enc.json` — sops-encrypted secrets (valid, tested)
- `~/.openclaw/decrypt-secret.sh` — CLI-arg-based decryptor (works standalone)
- `~/.openclaw/sops-secret-provider.sh` — protocol v1 exec provider (works standalone)
- `~/.openclaw/gateway-env.sh` — systemd ExecStartPre decryptor (untested in systemd)
- `~/.openclaw/load-secrets.sh` — shell profile sourcer for env vars
- `~/.openclaw/.sops.yaml` — sops config (may not be in right location)
- `~/.openclaw/gateway.env` — decrypted env file (may contain plaintext keys if gateway-env.sh ran successfully)
- `~/.config/sops/age/keys.txt` — age private key (0600 permissions)

**Action required**: Review `~/.openclaw/gateway.env` — if it exists and contains plaintext keys, delete it. The encrypted `secrets.enc.json` and age key can remain for a future properly-tested migration.

## What Was Restored

Both files restored to their exact original state:

- `~/.openclaw/openclaw.json` — all plaintext keys, gmail config, all plugin entries
- `~/.config/systemd/user/openclaw-gateway.service` — original v2026.2.13, plaintext env vars, original binary path (`/home/terry/openclaw/dist/index.js`)

## Pre-existing Issues Discovered

These were present before the migration attempt and are unrelated:

1. **`codex-cli/gpt-5.3-codex` is unknown** — gateway logs `startup model warmup failed for codex-cli/gpt-5.3-codex: Error: Unknown model`. This is the configured primary model and was failing before any config changes.
2. **Full model fallback cascade** — all CLI backends (codex, gemini) fail; only `google-gemini-cli/gemini-3-pro-preview` via embedded runner succeeds.
3. **MEMORY.md oversized** — 23,867 chars vs 20,000 limit; truncated on every request.
4. **Discord delivery failures** — `TypeError: fetch failed` on final reply delivery.

## Recommendations

1. **Do not retry secret encryption without shell access** — this requires interactive debugging across multiple system boundaries.
2. **Use `openclaw secrets configure`** — the built-in interactive wizard handles the protocol, schema, and env passthrough correctly. Run it interactively, not via an agent.
3. **Investigate the model failures** — the `gpt-5.3-codex` unknown model error predates this incident and is causing degraded agent output quality.
4. **Trim MEMORY.md** — reduce to under 20,000 chars to stop truncation warnings.
5. **Clean up inert files** — review and optionally remove the leftover scripts/env files listed above, especially `~/.openclaw/gateway.env` if it contains plaintext secrets.
6. **Future encryption approach** — the sops infrastructure (encrypted file, age key, protocol-aware script) is valid and tested in isolation. The missing piece is wiring it through systemd. A future attempt should: (a) use `openclaw secrets configure` for the OpenClaw-internal SecretRef fields, (b) handle CLI backend env vars via a systemd `EnvironmentFile` generated by ExecStartPre with full PATH/HOME set, and (c) be tested interactively with shell access at each step.
