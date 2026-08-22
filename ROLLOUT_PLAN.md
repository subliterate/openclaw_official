# Rollout Plan: Restricted Agent Connectivity

## Pre-Execution Checklist

### 1. Install Dependencies

```bash
sudo pnpm install
```

This registers the new `@openclaw/messenger` workspace package.

### 2. Run Tests

```bash
pnpm vitest run extensions/gmail
pnpm vitest run extensions/messenger
pnpm vitest run src/infra/outbound/message-action-runner.test.ts
pnpm vitest run src/agents/agent-channel-allowlist.test.ts
pnpm vitest run src/config/config.schema-regressions.test.ts
```

### 3. Verify Existing Channels

Before adding new channels, confirm baseline channels are operational:

- [ ] Discord — send and receive a test message
- [ ] BlueBubbles/iMessage — send and receive a test message

If either is broken, document the gap and adjust `channels.allow` accordingly.

---

## External Setup

### Gmail

| Step | Action                                         | Where                                                        |
| ---- | ---------------------------------------------- | ------------------------------------------------------------ |
| 1    | Create a Google Cloud project                  | [console.cloud.google.com](https://console.cloud.google.com) |
| 2    | Enable the Gmail API                           | APIs & Services > Library > Gmail API                        |
| 3    | Create OAuth 2.0 credentials (Web application) | APIs & Services > Credentials                                |
| 4    | Configure OAuth consent screen                 | Scopes: `gmail.readonly`, `gmail.send`                       |
| 5    | Run OAuth flow to obtain a refresh token       | Use `oauth2l` or a one-time script                           |
| 6    | Set credentials                                | See "Credential Configuration" below                         |

**Minimal scopes:** `gmail.readonly` + `gmail.send`. Do NOT request `gmail.modify`.

### Messenger

| Step | Action                                    | Where                                                      |
| ---- | ----------------------------------------- | ---------------------------------------------------------- |
| 1    | Create a Facebook Developer App           | [developers.facebook.com](https://developers.facebook.com) |
| 2    | Add the Messenger product                 | App Dashboard > Add Product                                |
| 3    | Create/link a Facebook Page               | Settings > Page                                            |
| 4    | Generate a long-lived Page Access Token   | Graph API Explorer or Page settings                        |
| 5    | Set credentials                           | See "Credential Configuration" below                       |
| 6    | Configure webhook URL                     | App Dashboard > Messenger > Webhooks                       |
| 7    | Subscribe to `messages` webhook event     | Same page as step 6                                        |
| 8    | Submit for App Review (`pages_messaging`) | App Dashboard > App Review                                 |

**App Review timeline:** 2-6 weeks. Engineering and review run in parallel.

**Webhook requirements:**

- Must be HTTPS (TLS required by Facebook)
- Endpoint: `https://<your-domain>/webhook/messenger`
- Facebook sends a GET with `hub.verify_token` challenge during setup
- All POST events signed with `X-Hub-Signature-256` (HMAC-SHA256)

---

## Credential Configuration

Credentials can be set via config file or environment variables. Environment variables are used only for the `default` account.

### Option A: Environment Variables

```bash
# Gmail
export GMAIL_CLIENT_ID="your-client-id.apps.googleusercontent.com"
export GMAIL_CLIENT_SECRET="your-client-secret"
export GMAIL_REFRESH_TOKEN="1//your-refresh-token"

# Messenger
export MESSENGER_PAGE_ACCESS_TOKEN="EAAx..."
export MESSENGER_APP_SECRET="your-app-secret"
export MESSENGER_VERIFY_TOKEN="your-chosen-verify-token"
```

### Option B: Config File (`~/.openclaw/openclaw.json`)

Add under the top-level `channels` key:

```jsonc
{
  "channels": {
    "gmail": {
      "clientId": "your-client-id.apps.googleusercontent.com",
      "clientSecret": "your-client-secret",
      "refreshToken": "1//your-refresh-token",
      "dmPolicy": "allowlist",
      "allowFrom": ["trusted@example.com"],
    },
    "messenger": {
      "pageAccessToken": "EAAx...",
      "appSecret": "your-app-secret",
      "verifyToken": "your-chosen-verify-token",
      "webhookPath": "/webhook/messenger",
      "dmPolicy": "allowlist",
      "allowFrom": ["123456789"], // PSIDs of allowed senders
    },
  },
}
```

---

## Staged Rollout

### Stage 1: Baseline (Discord + BlueBubbles only)

Deploy with the current config. No Gmail or Messenger credentials needed.

```jsonc
// channels.allow — only baseline channels
"channels": { "allow": ["discord", "bluebubbles"] }

// bindings — only baseline
"bindings": [
  { "agentId": "restricted", "match": { "channel": "discord" } },
  { "agentId": "restricted", "match": { "channel": "bluebubbles" } }
]
```

**Verify:**

- [ ] Restricted agent can send/receive on Discord
- [ ] Restricted agent can send/receive on BlueBubbles
- [ ] Restricted agent CANNOT send to Slack (policy denial logged)
- [ ] Broadcast is blocked

### Stage 2: Add Gmail

After credentials are configured and `pnpm vitest run extensions/gmail` passes:

1. Add Gmail credentials (env vars or config)
2. Update `channels.allow`:
   ```jsonc
   "channels": { "allow": ["discord", "bluebubbles", "gmail"] }
   ```
3. Add binding:
   ```jsonc
   { "agentId": "restricted", "match": { "channel": "gmail" } }
   ```
4. Restart OpenClaw

**Verify:**

- [ ] Gmail probe succeeds (email address returned)
- [ ] Inbound email from allowlisted sender triggers agent
- [ ] Outbound email sends successfully
- [ ] Inbound from non-allowlisted sender is blocked (policy denial logged)

### Stage 3: Add Messenger

After Facebook app review is approved and credentials are configured:

1. Add Messenger credentials (env vars or config)
2. Update `channels.allow`:
   ```jsonc
   "channels": { "allow": ["discord", "bluebubbles", "gmail", "messenger"] }
   ```
3. Add binding:
   ```jsonc
   { "agentId": "restricted", "match": { "channel": "messenger" } }
   ```
4. Restart OpenClaw
5. Register webhook URL with Facebook (triggers GET verification)

**Verify:**

- [ ] Webhook verification challenge succeeds (200 + challenge echo)
- [ ] Inbound message from allowlisted PSID triggers agent
- [ ] Outbound reply sends via Send API
- [ ] Inbound from non-allowlisted PSID is blocked (policy denial logged)
- [ ] Tampered webhook payload is rejected (401)

---

## Rollback Procedures

### Disable a Single Channel

Time to rollback: < 2 minutes. No code changes.

1. Remove the channel from `channels.allow` in `~/.openclaw/openclaw.json`
2. Remove its binding from `bindings[]`
3. Restart OpenClaw

Example — removing Gmail:

```diff
- "channels": { "allow": ["discord", "bluebubbles", "gmail", "messenger"] }
+ "channels": { "allow": ["discord", "bluebubbles", "messenger"] }

  "bindings": [
    { "agentId": "restricted", "match": { "channel": "discord" } },
    { "agentId": "restricted", "match": { "channel": "bluebubbles" } },
-   { "agentId": "restricted", "match": { "channel": "gmail" } },
    { "agentId": "restricted", "match": { "channel": "messenger" } }
  ]
```

### Disable the Restricted Agent Entirely

1. Remove the agent entry from `agents.list[]`
2. Remove all its bindings
3. Restart — all channels fall back to the default agent

### Emergency: Disable All Outbound

Set an empty allowlist:

```jsonc
"channels": { "allow": [] }
```

This blocks ALL outbound sends for the agent. Inbound still routes but replies are blocked.

---

## Monitoring

### Policy Denial Logs

All policy enforcement points emit structured log lines with the `[policy-denial]` prefix:

```
[policy-denial] agent="restricted" action="send" channel="slack" allowed=[discord,bluebubbles,gmail,messenger] — outbound blocked by channel allowlist
[policy-denial] channel="gmail" account="default" from="spammer@evil.com" dmPolicy="allowlist" — inbound blocked by DM policy
[policy-denial] channel="messenger" account="default" from="999999" dmPolicy="allowlist" — inbound blocked by DM policy
[policy-denial] action="broadcast" — broadcast blocked (tools.message.broadcast.enabled=false)
```

**What to watch for:**

- Repeated denials from the same sender — potential misconfiguration or abuse
- Denials for channels that should be allowed — check `channels.allow` config
- Token refresh failures — check Gmail OAuth credentials

### Channel Health

Each channel extension reports health via the status system:

- `running` — whether the gateway is active
- `lastStartAt` / `lastStopAt` — last lifecycle events
- `lastInboundAt` / `lastOutboundAt` — last message timestamps
- `lastError` — most recent error

---

## Troubleshooting

| Symptom                                       | Likely Cause                               | Fix                                                    |
| --------------------------------------------- | ------------------------------------------ | ------------------------------------------------------ |
| "Agent X is not allowed to send to channel Y" | Channel not in `channels.allow`            | Add channel to allowlist, restart                      |
| Gmail token refresh fails                     | Expired/revoked refresh token              | Re-run OAuth flow, update `refreshToken`               |
| Messenger webhook 403                         | Wrong `verifyToken`                        | Check `MESSENGER_VERIFY_TOKEN` matches Facebook config |
| Messenger webhook 401                         | Wrong `appSecret`                          | Check `MESSENGER_APP_SECRET` matches Facebook app      |
| "Broadcast is disabled"                       | `tools.message.broadcast.enabled` is false | Intentional for restricted agent                       |
| Inbound messages not reaching agent           | Missing binding                            | Add binding for the channel                            |
| Gmail polling not picking up messages         | `historyId` expired                        | Restart — monitor auto-resets                          |
| Config validation error on startup            | Unknown channel in `channels.allow`        | Ensure extension is installed (`pnpm install`)         |

---

## Target Config (Final State)

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
          "exec": { "security": "allowlist", "ask": "on-miss" },
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
