# OpenClaw Connectivity Regressions and Remedies

Date: 2026-02-21
Scope: Findings from commits on 2026-02-15 and 2026-02-16 that can look like "network/agent connection issues."

## Finding 1: Per-agent outbound channel allowlist blocks sends

Relevant commits:

- `a63917a66` (2026-02-15)
- `1a6ecd148` (2026-02-15, logging and integration tests)

### What was implemented

- A per-agent outbound allowlist was added (`agents.list[].channels.allow`).
- Enforcement was added in `src/infra/outbound/message-action-runner.ts:726`.
- Allowlist resolution is in `src/agents/agent-scope.ts:132`.
- If a channel is not in the allowlist, send is rejected with:
  - `Agent "<id>" is not allowed to send to channel "<channel>"...`

### What it did

- Agents that previously could send to any channel started failing outbound sends.
- This can look like transport/network failure even though the send is denied by policy before transport.
- The tests in `src/infra/outbound/message-action-runner.test.ts:1033` intentionally validate this restricted behavior.

### Remedy

1. Decide if the agent should be restricted or unrestricted.
2. If restricted, include all required channels in `channels.allow`.
3. If unrestricted, remove `channels.allow` entirely for that agent.
4. Add a preflight test that validates required channel routes for each production agent profile.
5. Monitor for `[policy-denial] ... outbound blocked by channel allowlist` log events.

Example config fix:

```json
{
  "agents": {
    "list": [
      {
        "id": "restricted",
        "channels": {
          "allow": ["discord", "bluebubbles", "gmail", "messenger", "slack", "whatsapp"]
        }
      }
    ]
  }
}
```

## Finding 2: Exec session cap and sandbox defaults can throttle agents

Relevant commit:

- `35b7abc65` (2026-02-16)

### What was implemented

- New default exec concurrency cap: `maxConcurrentSessions = 16`.
  - Applied in `src/agents/bash-tools.exec.ts:136`.
  - Denial path in `src/agents/bash-tools.exec.ts:174`.
- New sandbox default limits:
  - `pidsLimit = 512`, `memory = 2g`, `memorySwap = 2g`, `cpus = 2`, `ulimits.nproc = 256`
  - Set in `src/agents/sandbox/config.ts:78` and constants in `src/agents/sandbox/constants.ts:53`.

### What it did

- High parallelism workloads can hit `exec denied: max concurrent sessions reached`.
- Sandboxed tasks under heavier load can degrade, timeout, or fail due to tighter CPU/memory/pid limits.
- Symptoms can look like unstable agent connectivity because commands fail before work completes.

### Remedy

1. Increase or disable session cap for busy agents:
   - Set `tools.exec.maxConcurrentSessions` higher (for example 32) or `0` for unlimited.
2. Right-size sandbox resources for your workload:
   - Increase memory/cpus/pids/nproc where needed.
3. Add telemetry and alerts for:
   - `max concurrent sessions reached`
   - OOM/pid exhaustion signals in sandbox logs.
4. Keep long-running background processes under control with process cleanup policy.

Example config tuning:

```json
{
  "tools": {
    "exec": {
      "maxConcurrentSessions": 32
    }
  },
  "sandbox": {
    "docker": {
      "memory": "4g",
      "memorySwap": "4g",
      "cpus": 4,
      "pidsLimit": 1024,
      "ulimits": {
        "nproc": 512
      }
    }
  }
}
```

## Finding 3: Messenger inbound became strict (signature + DM policy)

Relevant commit:

- `1a6ecd148` (2026-02-15)

### What was implemented

- Messenger webhook signature verification was added:
  - `x-hub-signature-256` is required and validated in `extensions/messenger/src/webhook.ts:169`.
  - Invalid signature returns `401 Unauthorized`.
- Inbound DM policy enforcement defaults to `allowlist`:
  - `extensions/messenger/src/inbound.ts:55`.
  - Non-allowed senders are dropped and logged as `[policy-denial]`.

### What it did

- Any webhook auth mismatch (secret mismatch, modified body, bad proxy behavior) drops inbound events.
- Any sender not on allowlist is blocked by default unless policy is relaxed.
- This can be interpreted as "Messenger connection broken" when it is policy/auth enforcement.

### Remedy

1. Verify webhook signature path end-to-end:
   - Confirm `appSecret` matches Meta app config.
   - Ensure no middleware/proxy mutates raw request body before signature verification.
2. Confirm account policy:
   - Keep `dmPolicy: "allowlist"` for security and populate `allowFrom`.
   - Use `pairing` during onboarding.
   - Use `open` only when intentionally public.
3. Add operational log checks for:
   - `401 Unauthorized` on webhook endpoint.
   - `[policy-denial] channel="messenger" ...`.

## Finding 4: Gmail inbound defaults to allowlist and can silently block senders

Relevant commit:

- `a63917a66` (2026-02-15)

### What was implemented

- Gmail inbound DM policy defaults to `allowlist`:
  - `extensions/gmail/src/inbound.ts:52`.
- Unknown senders are blocked unless allowed by policy.
- Later commit added explicit policy-denial logging for Gmail (`1a6ecd148`):
  - `extensions/gmail/src/inbound.ts:55`.

### What it did

- Inbound Gmail messages from non-allowlisted senders do not route to agents.
- If operators expect open inbound behavior, this appears as "Gmail not connected."

### Remedy

1. Set explicit Gmail policy per account instead of relying on defaults.
2. Populate `allowFrom` for allowed senders/domains when using `allowlist`.
3. For open mode, include `"*"` in `allowFrom` (schema requires it).
4. Add log monitoring for `[policy-denial] channel="gmail" ...`.

Example Gmail policy config:

```json
{
  "channels": {
    "gmail": {
      "dmPolicy": "allowlist",
      "allowFrom": ["ops@example.com", "*@trusted-partner.com"]
    }
  }
}
```

## Non-culprit notes from same window

- `00ab70ae4` (2026-02-15) is docs-only and not a runtime cause.
- `5ad021d52` (2026-02-16) added Gmail actions (`search`, `read`, `channel-list`) and is not a likely source of connection degradation by itself.

## Recommended rollout order

1. Fix allowlists/policies first (highest chance of immediate behavior restoration).
2. Raise `maxConcurrentSessions` and sandbox limits for busy environments.
3. Add log-based alerting for policy denials and exec-cap denials.
4. Add regression tests for your exact production routing matrix and expected channel reachability.
