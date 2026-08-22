# RETOOL Implementation Plan: Restricted Agent Connectivity

## Goal

Enable one or more agents to operate with a strict connectivity scope:

- Allowed: Gmail, GitHub, text messaging, Messenger, Discord, local PC terminal (CLI)
- Denied: all other channels and tools by default

## Current-State Summary

### What already exists

| Capability                                               | Location                                                              | Status       |
| -------------------------------------------------------- | --------------------------------------------------------------------- | ------------ |
| Per-agent tool policy (`allow`/`deny`/`profile`)         | `src/config/types.tools.ts` → `AgentToolsConfig`                      | Ready to use |
| Tool policy enforcement (wildcard matching)              | `src/agents/pi-tools.policy.ts` → `filterToolsByPolicy()`             | Ready to use |
| Tool profiles (`minimal`, `coding`, `messaging`, `full`) | `src/config/types.tools.ts` → `ToolProfileId`                         | Ready to use |
| Per-agent skills allowlist                               | `src/config/types.agents.ts` → `AgentConfig.skills`                   | Ready to use |
| Outbound target resolution + `allowFrom` gating          | `src/infra/outbound/targets.ts` → `resolveOutboundTarget()`           | Ready to use |
| Cross-context send policy (within/across providers)      | `src/config/types.tools.ts` → `ToolsConfig.message.crossContext`      | Ready to use |
| Broadcast enable/disable                                 | `src/config/types.tools.ts` → `ToolsConfig.message.broadcast.enabled` | Ready to use |
| Channel plugin registry + extension discovery            | `src/plugins/registry.ts`, `extensions/*/index.ts`                    | Ready to use |
| Agent routing + bindings                                 | `src/routing/resolve-route.ts` → `resolveAgentRoute()`                | Ready to use |
| Exec tool security modes (`deny`/`allowlist`/`full`)     | `src/config/types.tools.ts` → `ExecToolConfig.security`               | Ready to use |
| 37 channel extensions                                    | `extensions/`                                                         | Operational  |

### What doesn't exist yet

- **No per-agent outbound channel allowlist.** `resolveOutboundTarget()` checks per-peer `allowFrom`, but there's no agent-scoped "only send to these channels" gate.
- **No Gmail channel extension.** Requires new OAuth integration + `ChannelPlugin` implementation.
- **No Messenger channel extension.** Requires Facebook app review + webhook pipeline.
- **Text messaging (iMessage/BlueBubbles) status unverified.** Extensions exist (`extensions/bluebubbles`, `extensions/imessage`) but operational status needs confirmation before counting as baseline.

## Scope

In scope:

- Hard-restrict enabled channels and tools per agent profile
- Add outbound channel allowlist enforcement at the routing layer
- Implement Gmail connector extension
- Implement Messenger connector extension (subject to platform eligibility)
- Add policy validation, negative tests, and docs

Out of scope:

- Broad social platform expansion beyond requested set
- Loosening default security posture

## Architecture Decisions

### 1. Default-deny policy

Start from no channels and no tools, then explicitly allow required ones.

### 2. Two access layers

**Layer A — Channel routing constraints:**

- Inbound: Agent bindings (`src/routing/resolve-route.ts`) already scope which agents handle which channels. Only create bindings for allowed channels.
- Outbound: Insert a new `allowedChannels` check in `src/infra/outbound/targets.ts` → `resolveOutboundTarget()` (after line ~144, before calling `plugin.outbound.resolveTarget()`). This is the single enforcement point where all outbound sends converge.

**Layer B — Agent tool policy:**

- Use `AgentConfig.tools` (`allow`/`deny`/`profile`) to restrict which tools an agent can invoke.
- Use `AgentConfig.tools.exec.security` for CLI command gating (`"allowlist"` mode with explicit command approval).
- Use `AgentConfig.skills` to whitelist allowed skills.

### 3. Connector model

Gmail and Messenger implemented as channel extensions following the established pattern:

```
extensions/<channel-id>/
├── package.json          # @openclaw/<channel-id>, openclaw.extensions: ["./index.ts"]
├── openclaw.plugin.json  # { id, channels, configSchema }
├── index.ts              # default export: { id, name, register(api) }
└── src/
    ├── channel.ts        # ChannelPlugin<ResolvedAccount> implementation
    └── runtime.ts        # set/get runtime pattern
```

Registration pattern (from existing extensions like Discord, IRC):

```typescript
register(api: OpenClawPluginApi) {
  setXxxRuntime(api.runtime);
  api.registerChannel({ plugin: xxxPlugin });
}
```

## Delivery Phases

### Phase 1: Policy Baseline (No New Connectors)

Objective: restrict existing capabilities immediately using config + one code change.

#### Prerequisites

- [ ] Verify iMessage/BlueBubbles extension is operational (test send/receive). If not, document gap.

#### Task 1.1: Create restricted agent config

Add a new agent entry in `openclaw.json` → `agents.list[]`:

```jsonc
{
  "id": "restricted",
  "name": "Restricted Agent",
  "tools": {
    "profile": "messaging", // base profile
    "allow": ["exec", "sessions_send", "message"],
    "deny": ["gateway", "agents_list", "whatsapp_login", "cron"],
    "exec": {
      "security": "allowlist", // only approved CLI commands
      "ask": "always", // optional approval gate
    },
  },
  "skills": ["git", "gh"], // only git-related skills
  // new field (see Task 1.3):
  "channels": {
    "allow": ["discord", "bluebubbles", "gmail", "messenger"],
  },
}
```

#### Task 1.2: Restrict inbound routing

Add bindings that route only allowed channels to this agent:

```jsonc
// openclaw.json → bindings[]
[
  { "agentId": "restricted", "match": { "channel": "discord" } },
  { "agentId": "restricted", "match": { "channel": "bluebubbles" } },
  // gmail + messenger bindings added in Phases 2-3
]
```

All other inbound channels route to the default agent, not `restricted`.

#### Task 1.3: Enforce outbound channel allowlist (code change required)

**Where:** `src/infra/outbound/targets.ts` → `resolveOutboundTarget()`

**What:** Before the existing `plugin.outbound.resolveTarget()` call, check whether the target channel is in the agent's `channels.allow` list. If not, return a structured error.

**New config type** (add to `src/config/types.agents.ts` → `AgentConfig`):

```typescript
channels?: {
  /** Outbound channel allowlist. If set, only these channels can receive outbound sends. */
  allow?: string[];
};
```

**Enforcement pseudocode:**

```typescript
// In resolveOutboundTarget(), after resolving the agent config:
const agentChannels = agentConfig?.channels?.allow;
if (agentChannels && !agentChannels.includes(targetChannel)) {
  return { ok: false, error: `channel "${targetChannel}" not in agent allowlist` };
}
```

#### Task 1.4: Disable broadcast

Set `tools.message.broadcast.enabled: false` in the restricted agent's config scope.

#### Task 1.5: Add startup validation

Add a config validation step (in the existing config validation pipeline) that checks:

- Every channel in `agents[].channels.allow` has a corresponding extension installed.
- Every tool in `agents[].tools.allow` is a recognized tool name or pattern.
- Bindings don't reference agents that don't exist.

Fail fast with a clear error message on mismatch.

#### Acceptance criteria

- [ ] Restricted agent cannot invoke tools outside its `allow` list (positive + **negative** test).
- [ ] Restricted agent cannot send outbound messages to channels outside `channels.allow` (**negative** test: attempt send to Slack → blocked).
- [ ] Restricted agent cannot receive inbound from unbound channels (no binding = no route).
- [ ] Broadcast is blocked for the restricted agent.
- [ ] Discord inbound/outbound continues to function.
- [ ] iMessage/BlueBubbles inbound/outbound continues to function (or gap documented).
- [ ] Startup fails with clear error if config references nonexistent channel/tool.

#### Testing strategy (Phase 1)

- **Positive tests:** Agent sends to Discord → succeeds. Agent runs `git status` → succeeds.
- **Negative tests:** Agent sends to Slack → blocked with error. Agent calls `whatsapp_login` → denied. Agent attempts broadcast → denied.
- **Config validation tests:** Invalid channel in allowlist → startup error. Invalid tool name → startup error.

---

### Phase 2: Gmail Extension

Objective: add native Gmail connectivity.

#### Task 2.1: Extension scaffolding

Create `extensions/gmail/` following the standard pattern:

- `package.json`: `@openclaw/gmail`, `openclaw.extensions: ["./index.ts"]`
- `openclaw.plugin.json`: `{ "id": "gmail", "channels": ["gmail"] }`
- `index.ts`: register with `api.registerChannel({ plugin: gmailPlugin })`
- `src/channel.ts`: `ChannelPlugin<ResolvedGmailAccount>` with required adapters
- `src/runtime.ts`: `setGmailRuntime()` / `getGmailRuntime()`

Required adapters for Gmail:

- `config`: Account resolution (Google account ID, email address, tokens)
- `outbound`: Send email via Gmail API
- `messaging`: Format inbound email as OpenClaw message (subject, body, attachments → normalized payload)
- `security`: Validate inbound webhook/push signatures (if using Pub/Sub)

#### Task 2.2: Auth and credential flow

- OAuth 2.0 authorization code flow for Google account linking.
- Scopes: `gmail.readonly`, `gmail.send` (minimal). **Do not request `gmail.modify`** unless delete/label operations are explicitly needed later.
- Credential storage: follow existing extension credential conventions (likely `~/.openclaw/` credentials store).
- Token refresh: automatic refresh before expiry, with exponential backoff on failure.

#### Task 2.3: Core operations

- **Read:** List threads/messages with scoped queries (label, date range, sender). Map to OpenClaw inbound message format.
- **Send/Reply:** Compose and send email. Support reply-to threading (RFC 2822 `In-Reply-To` / `References`).
- **Inbound notifications:** Two options with different infrastructure requirements:
  - **Option A — Google Cloud Pub/Sub (preferred):** Requires a GCP project, service account, and Pub/Sub topic. Provides near-real-time push. **Infrastructure dependency: GCP project setup is a prerequisite.**
  - **Option B — Polling fallback:** Periodic `messages.list` with `historyId` tracking. Higher latency (~30-60s), no GCP dependency.
  - Recommend: implement Option B first for fast iteration, Option A as an upgrade.

#### Task 2.4: Safety and limits

- OAuth scope restricted to `gmail.readonly` + `gmail.send`.
- Rate limiting: respect Gmail API quotas (250 units/second default). Implement retry with exponential backoff.
- Payload normalization: email body (HTML/plain) → OpenClaw message format. Attachment handling via Gmail API parts.

#### Task 2.5: Tests

- Unit: OAuth token refresh (success, expiry, revocation). Email → message mapping. Message → email composition.
- Integration: mocked Gmail API (fixture-based). Full send/receive cycle.
- Negative: send blocked when Gmail channel not in agent's `channels.allow`.

#### Acceptance criteria

- [ ] Agent can read inbox and send email when Gmail channel is enabled.
- [ ] Agent cannot use Gmail when channel is not in its allowlist.
- [ ] Token refresh works under simulated expiry/revocation.
- [ ] Polling-based inbound notification works reliably.

---

### Phase 3: Messenger Extension

Objective: add native Messenger connectivity.

**Important:** This phase has an external dependency on Facebook's app review process, which can take 2-6 weeks. Engineering work and app review should run in parallel where possible.

#### Task 3.0: Platform feasibility gate (blocking)

- [ ] Validate Facebook Page/App eligibility for Messenger Platform API.
- [ ] Confirm webhook deployment requirements (HTTPS endpoint, verification token).
- [ ] Understand app review scope: which permissions are needed, expected review timeline.
- [ ] **Go/no-go decision** before committing to Tasks 3.2+.

#### Task 3.1: Submit app for review (parallel with engineering)

Start the Facebook app review process early, as it's the longest lead-time item.

#### Task 3.2: Extension scaffolding

Create `extensions/messenger/` following the standard pattern:

- `package.json`: `@openclaw/messenger`
- `openclaw.plugin.json`: `{ "id": "messenger", "channels": ["messenger"] }`
- `src/channel.ts`: `ChannelPlugin<ResolvedMessengerAccount>`
- Required adapters: `config`, `outbound`, `messaging`, `security`, `gateway` (for webhook endpoint)

#### Task 3.3: Auth + webhook pipeline

- App credentials: App ID + App Secret from Facebook Developer console.
- Page Access Token handling (long-lived token exchange).
- Webhook verification: `GET` endpoint with `hub.verify_token` challenge.
- Webhook ingestion: `POST` endpoint with HMAC-SHA256 signature validation (mandatory — `X-Hub-Signature-256` header).
- Register gateway method for webhook endpoint via `gatewayMethods` field on the `ChannelPlugin`.

#### Task 3.4: Core operations

- **Inbound:** Receive `messaging` webhook events → normalize to OpenClaw message format.
- **Outbound:** Send text/media replies via Send API. Respect 24-hour messaging window policy.

#### Task 3.5: Compliance controls

- Enforce Facebook's 24-hour standard messaging window.
- Respect message tags for out-of-window sends (only permitted tags).
- Block unsupported message types with explicit error.

#### Task 3.6: Tests

- Unit: HMAC signature verification. Webhook payload → message mapping. Send path composition.
- Integration: webhook fixture replay (recorded payloads).
- Negative: send to unallowed context → blocked.

#### Acceptance criteria

- [ ] Messenger inbound/outbound works end-to-end with approved Facebook app.
- [ ] Webhook signature verification rejects tampered payloads.
- [ ] Disallowed account contexts blocked with explicit operator error.
- [ ] 24-hour messaging window policy enforced.

---

### Phase 4: Hardening + Rollout

Objective: productionize with guardrails and rollback capability.

#### Task 4.1: Security review

- OAuth token storage: verify encryption at rest.
- Token lifecycle: refresh, revocation, and rotation for both Gmail and Messenger.
- Least-privilege audit: confirm no excess OAuth scopes or API permissions.
- CLI exec: confirm `allowlist` mode is enforced for restricted agent.

#### Task 4.2: Observability

- Structured logs for: outbound sends (channel, target, success/failure), policy denials, token refresh events.
- Channel health signals: connection status, last successful send/receive timestamp.
- Failure metrics: send failures by channel, auth failures, rate limit hits.
- **Alert on policy violation attempts** (agent tried to use a blocked channel/tool).

#### Task 4.3: Rollback strategy

- Each new channel extension can be disabled by removing it from `channels.allow` and its binding — no code change required.
- If a connector causes instability: disable the extension in config, restart. Agent falls back to remaining channels.
- Keep extension code deployable but dormant (registered but not bound/allowed).

#### Task 4.4: Documentation

- Operator setup docs for Gmail (OAuth app creation, credential linking, Pub/Sub setup if used).
- Operator setup docs for Messenger (Facebook app creation, webhook setup, app review).
- "Restricted mode" docs with complete example `openclaw.json` config.
- Troubleshooting guide: common auth failures, policy denial debugging.

#### Task 4.5: Staged rollout

- Dev: full integration testing with all channels.
- Beta: single restricted agent with Discord + text only (Phase 1 config).
- Stable: add Gmail, then Messenger, one at a time with monitoring.

#### Acceptance criteria

- [ ] Reproducible setup from docs alone (fresh environment test).
- [ ] Rollback of any single channel takes < 5 minutes (config change + restart).
- [ ] Operational runbook covers: token rotation, webhook re-registration, policy denial debugging.
- [ ] No regressions in existing channel routing behavior.
- [ ] Policy violation attempts generate alerts.

## Config Model (Target)

Complete example for `openclaw.json`:

```jsonc
{
  "agents": {
    "list": [
      {
        "id": "restricted",
        "name": "Restricted Agent",
        "default": false,
        "tools": {
          "profile": "messaging",
          "allow": ["exec", "sessions_send", "message"],
          "deny": [
            "gateway",
            "agents_list",
            "whatsapp_login",
            "cron",
            "memory_search",
            "memory_get",
          ],
          "exec": {
            "security": "allowlist",
            "ask": "on-miss",
          },
        },
        "skills": ["git", "gh"],
        "channels": {
          "allow": ["discord", "bluebubbles", "gmail", "messenger"],
        },
      },
    ],
  },
  "bindings": [
    { "agentId": "restricted", "match": { "channel": "discord" } },
    { "agentId": "restricted", "match": { "channel": "bluebubbles" } },
    { "agentId": "restricted", "match": { "channel": "gmail" } },
    { "agentId": "restricted", "match": { "channel": "messenger" } },
  ],
  "tools": {
    "message": {
      "broadcast": { "enabled": false },
      "crossContext": {
        "allowWithinProvider": true,
        "allowAcrossProviders": false,
      },
    },
  },
}
```

Default policy: anything not explicitly listed is denied.

## Outbound Enforcement — Code Change Detail

**File:** `src/infra/outbound/targets.ts`
**Function:** `resolveOutboundTarget()`
**Call flow:**

```
runMessageAction()  (src/infra/outbound/message-action-runner.ts)
  → executeSendAction()  (src/infra/outbound/outbound-send-service.ts)
    → sendMessage()  (src/infra/outbound/message.ts)
      → resolveOutboundTarget()  ← INSERT CHECK HERE
        → plugin.outbound.resolveTarget()
          → deliverOutboundPayloads()  (src/infra/outbound/deliver.ts)
```

Insert the `channels.allow` check in `resolveOutboundTarget()` before the existing `allowFrom` resolution. This is the single convergence point for all outbound sends.

## Security Requirements

- OAuth tokens encrypted at rest (follow existing credential store conventions).
- Gmail OAuth scopes: `gmail.readonly` + `gmail.send` only.
- Messenger webhook signature verification mandatory (HMAC-SHA256).
- CLI exec in `allowlist` mode with `ask: "on-miss"` for the restricted agent.
- Audit log entries for: outbound actions, terminal commands, policy denials.
- Alert on repeated policy violation attempts (potential misconfiguration or abuse).

## Risks and Mitigations

| Risk                                          | Severity | Mitigation                                                                                                                                           |
| --------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Messenger API eligibility/app review delays   | High     | Feasibility gate (Task 3.0) before engineering commitment. Submit for review early (Task 3.1). Fallback: defer Messenger, ship other channels first. |
| OAuth/token lifecycle complexity (Gmail)      | Medium   | Robust refresh/retry with exponential backoff. Integration tests for expiry, revocation, and concurrent refresh.                                     |
| Over-privileged CLI access                    | Medium   | `exec.security: "allowlist"` mode. `ask: "on-miss"` for unapproved commands. Per-agent tool deny list.                                               |
| Channel-policy drift over time                | Low      | Config validation at startup (Task 1.5). Fail fast on unknown channel/tool references.                                                               |
| iMessage/BlueBubbles not actually operational | Medium   | Prerequisite check in Phase 1. If broken, document gap and adjust `channels.allow` accordingly.                                                      |
| GCP dependency for Gmail push notifications   | Low      | Implement polling first (Option B). Pub/Sub is an optimization, not a blocker.                                                                       |
| Rollback difficulty                           | Low      | Channel disable is config-only (remove from `channels.allow` + binding, restart). No code change needed.                                             |

## Dependencies

### External

- Google Cloud Console project (for Gmail OAuth client credentials)
- GCP Pub/Sub topic + subscription (optional, for Gmail push — not required for polling)
- Facebook Developer App (for Messenger)
- Facebook App Review approval (for Messenger — 2-6 week lead time)

### Internal

- iMessage/BlueBubbles extension operational status (verify in Phase 1)
- Existing credential storage conventions documented/accessible

## Definition of Done

- [ ] Restricted agent config enforces default-deny for tools and channels.
- [ ] Outbound sends to disallowed channels are blocked at `resolveOutboundTarget()`.
- [ ] GitHub workflows functional via terminal (`git`/`gh`) under `exec.security: "allowlist"`.
- [ ] Gmail extension operational with OAuth auth, read, send, and polling-based inbound.
- [ ] Messenger extension operational (pending app review) with webhook inbound and Send API outbound.
- [ ] Negative tests verify all denial paths (blocked channel, blocked tool, blocked broadcast).
- [ ] Startup validation catches misconfigurations.
- [ ] Rollback of any channel is config-only and takes < 5 minutes.
- [ ] Setup docs reproducible from scratch.
