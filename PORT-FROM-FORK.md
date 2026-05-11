# Ports from `subliterate/openclaw` fork

Five commits from the retired `~/openclaw` fork that have **no equivalent in openclaw_official** as of 2026-05-11. Cherry-pick will conflict — surrounding code has diverged across 35k upstream commits. Port the _intent_ by re-implementing against current `openclaw_official` shape, then PR upstream.

Source repo backup: <https://github.com/subliterate/openclaw> (private). Common ancestor with upstream: `9475791d98` (2026-02-13).

---

## Already applied locally (candidates to PR upstream)

These are _local fixes_ already in this `~/openclaw_official` working tree, applied during the 2026-05-11 cutover. Not yet PR'd upstream; openclaw maintainers commit `e322e837be "Add gmail, messenger, and google-gemini-cli-auth plugins from fork"` ported the gmail extension from the fork but missed two adapter contracts.

### Gmail — bundled-channel-entry contract migration

**File:** `extensions/gmail/index.ts`
**Symptom:** Gateway logs `[channels] bundled channel entry gmail missing bundled-channel-entry contract; skipping` and the gmail plugin falls through to a legacy load path.
**Cause:** Used `defineChannelPluginEntry` from `openclaw/plugin-sdk/core`. The new contract requires `defineBundledChannelEntry` from `openclaw/plugin-sdk/channel-entry-contract` with lazy `specifier`/`exportName` plugin/runtime references.
**Fix:** Rewrote to mirror `extensions/slack/index.ts` and `extensions/discord/index.ts` — lazy plugin/runtime loading via specifier.

### Gmail — channel monitor lifecycle (long-running Promise)

**Files:** `extensions/gmail/src/monitor.ts`, `extensions/gmail/src/channel.ts`
**Symptom:** Gmail channel rapidly auto-restarts (`channel exited without an error` → `auto-restart attempt N/10`). Status stays `stopped, health:not-running`.
**Cause:** `src/gateway/server-channels.ts:519-537` treats `startAccount` resolving as "channel exited". Gmail's `monitorGmailProvider` returned `{ stop }` synchronously after scheduling its first `setTimeout(poll, 2000)`, so `startAccount` resolved within ~500 ms and the supervisor immediately marked the channel as exited.
**Fix:** Refactored `monitorGmailProvider` to return `Promise<void>` that doesn't resolve until `opts.abortSignal` aborts. Matches Discord's `monitorDiscordProvider` lifecycle pattern. Channel `startAccount` now simply `await`s the monitor instead of capturing `{ stop }`.

---

## 1. `31b622928` — codex resume `--color` flag + pooled client reconnect loops

**Original date:** 2026-03-04
**Author:** noddy
**Files:** `src/agents/cli-backends.ts`, `src/agents/cli-runner.e2e.test.ts`, `src/gateway/call.ts`
**Diff:** 3 files, +16/-13

Two fixes bundled:

- Remove `--color` from `codex exec resume` args — flag is unsupported by `codex resume`, causes failures.
- Evict pooled gateway clients on server-side close so stale clients don't enter reconnect loops.

**Port check:** verify `openclaw_official`'s codex backend still passes `--color` to resume; verify gateway client pool (if present in new code) handles server-side close.

---

## 2. `c34a07e9f` — `seqByRun` cleanup in `clearAgentRunContext`

**Original date:** 2026-02-20
**Author:** terry
**Files:** `src/infra/agent-events.ts`
**Diff:** 1 file, +1

Module-level `seqByRun` Map accumulated one entry per agent run forever. Add cleanup alongside the existing `runContextById` cleanup.

**Port check:** open `src/infra/agent-events.ts` in `openclaw_official`, look for `seqByRun` and `clearAgentRunContext`. If the map still exists and isn't pruned, port the one-liner.

---

## 3. `a30b2af46` — stale `connId` destroying live node session on reconnect

**Original date:** 2026-02-20
**Author:** terry
**Files:** `src/gateway/node-registry.ts`
**Diff:** 1 file, +12

Race condition: when a node reconnects with a new `connId`, the old `connId → nodeId` mapping in `nodesByConn` wasn't cleaned up. When the old WebSocket closed, `unregister()` would resolve the stale `connId` to the nodeId and destroy the _live_ session, reject pending invokes, remove subscriptions.

Fix: clean up the stale mapping in `register()`, and guard `unregister()` against destroying a session that belongs to a newer connection.

**Port check:** repro-worthy. Look at `src/gateway/node-registry.ts` in `openclaw_official` (or wherever node registration moved to). Confirm the race is still possible. Upstream may have its own mitigation already; if not, this is real.

---

## 4. `3c2b8324d` — gateway connection pooling for `callGateway`

**Original date:** 2026-02-19
**Author:** terry
**Files:** `src/gateway/call.ts`, `src/gateway/client.ts`
**Diff:** 2 files, +115/-3

Sequential gateway operations (agent tool flows make 4-6 calls) repeat TCP + auth handshake. Pooled connections with 30s idle timeout (unref'd timers so CLI commands still exit cleanly) eliminate the overhead.

**Port check:** see if `openclaw_official`'s `src/gateway/call.ts` already has pooling. Earlier scan showed it doesn't grep for "pool"; verify by reading the file. If not present, this is a real perf win to port.

---

## 5. `9afa82690` — merge duplicate `sessions.patch` RPCs in `sessions_spawn`

**Original date:** 2026-02-19
**Author:** terry
**Files:** `src/agents/tools/sessions-spawn-tool.ts`
**Diff:** 1 file, +45/-27

`sessions_spawn` was making two sequential `sessions.patch` gateway calls — one for `model`, one for `thinkingLevel`. Combine into a single RPC, eliminating one round-trip per spawn on the happy path.

**Port check:** look at `sessions-spawn-tool.ts` in `openclaw_official` (or wherever spawn moved to). If two patches are still issued back-to-back, this port still applies.

---

## Suggested workflow per commit

```
cd ~/openclaw_official
# 1. Read the relevant file in current upstream shape
# 2. Read the fork commit to understand the original fix
git --git-dir=/home/terry/openclaw/.git show <sha> -- <file>
# 3. Re-implement against upstream shape
# 4. Verify against tests (and add one if missing)
# 5. PR to openclaw/openclaw upstream
```

Once all five are either ported, filed as upstream issues, or judged not-applicable, this file can be deleted along with `~/openclaw`.
