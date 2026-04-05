# Gmail extension (developer reference)

This directory contains the **Gmail external channel plugin** for OpenClaw.

## Layout

- Extension package: `extensions/gmail/` (entry: `index.ts`).
- Channel implementation: `extensions/gmail/src/channel.ts`.
- OAuth token management: `extensions/gmail/src/auth.ts` (refresh with exponential backoff).
- Gmail API client: `extensions/gmail/src/api.ts` (profile, messages, history, send).
- Inbound polling: `extensions/gmail/src/monitor.ts` (historyId-based incremental polling).
- Inbound processing: `extensions/gmail/src/inbound.ts` (DM policy + agent routing).
- Outbound: `extensions/gmail/src/send.ts` (send helper wrapping `sendEmail`).
- Runtime bridge: `extensions/gmail/src/runtime.ts` (set via `api.runtime`).

## Internal helpers

- `getAccessToken` in `extensions/gmail/src/auth.ts` — cached OAuth token with auto-refresh.
- `clearTokenCache` in `extensions/gmail/src/auth.ts` — clear cached token (e.g. on revocation).
- `probeGmail` in `extensions/gmail/src/api.ts` — health check (fetches profile).
- `sendEmail` in `extensions/gmail/src/api.ts` — send raw MIME email via Gmail API.
- `getMessage` in `extensions/gmail/src/api.ts` — fetch full message by ID.
- `pollHistory` in `extensions/gmail/src/api.ts` — incremental poll for new messages.
- `parseGmailMessage` in `extensions/gmail/src/api.ts` — parse Gmail API message into inbound format.
- `sendMessageGmail` in `extensions/gmail/src/send.ts` — high-level send with config resolution.
- `resolveGmailAccount` in `extensions/gmail/src/accounts.ts` — resolve account from config/env.

## Config

```jsonc
{
  "channels": {
    "gmail": {
      "clientId": "...", // OAuth client ID (Google Cloud Console)
      "clientSecret": "...", // OAuth client secret
      "refreshToken": "...", // OAuth refresh token
      "dmPolicy": "allowlist", // "open" | "pairing" | "allowlist" | "disabled"
      "allowFrom": ["user@example.com"],
      "pollIntervalSec": 60, // Polling interval (default: 60)
      "maxResults": 10, // Max emails per poll cycle
      "label": "INBOX", // Gmail label to monitor
      "accounts": {
        // Optional multi-account
        "work": {
          "refreshToken": "...",
          "name": "Work Gmail",
        },
      },
    },
  },
}
```

Environment variables (default account only):

- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`
- `GMAIL_REFRESH_TOKEN`
- `GMAIL_EMAIL` (optional, discovered at runtime via profile)

## Auth flow

1. Create OAuth 2.0 client in Google Cloud Console.
2. Request scopes: `gmail.readonly` + `gmail.send`.
3. Run authorization flow to obtain refresh token.
4. Store refresh token in config or env var.

Access tokens are cached in-memory and refreshed automatically 5 minutes before expiry with 3-retry exponential backoff.

## Inbound

Uses Gmail History API with `historyId` tracking for incremental polling. Only new messages since the last poll are fetched. Messages sent by the account itself are skipped.

## Tests

```bash
pnpm vitest run extensions/gmail
```
