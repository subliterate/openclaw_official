# Messenger extension (developer reference)

This directory contains the **Facebook Messenger external channel plugin** for OpenClaw.

## Layout

- Extension package: `extensions/messenger/` (entry: `index.ts`).
- Channel implementation: `extensions/messenger/src/channel.ts`.
- Webhook handler: `extensions/messenger/src/webhook.ts` (GET verification + POST with HMAC-SHA256).
- Graph API client: `extensions/messenger/src/api.ts` (probe, sendText, sendMedia, parse).
- Inbound processing: `extensions/messenger/src/inbound.ts` (DM policy + agent routing).
- Outbound: `extensions/messenger/src/send.ts` (send helper wrapping `sendTextMessage`).
- Account resolution: `extensions/messenger/src/accounts.ts` (config/env merging).
- PSID normalization: `extensions/messenger/src/normalize.ts`.
- Runtime bridge: `extensions/messenger/src/runtime.ts` (set via `api.runtime`).

## Internal helpers

- `probeMessenger` in `extensions/messenger/src/api.ts` — health check (fetches Page profile).
- `sendTextMessage` in `extensions/messenger/src/api.ts` — send text via Send API.
- `sendMediaMessage` in `extensions/messenger/src/api.ts` — send attachment via Send API.
- `parseMessengerMessage` in `extensions/messenger/src/api.ts` — parse webhook entry.
- `sendMessageMessenger` in `extensions/messenger/src/send.ts` — high-level send with config resolution.
- `resolveMessengerAccount` in `extensions/messenger/src/accounts.ts` — resolve account from config/env.
- `handleMessengerWebhookRequest` in `extensions/messenger/src/webhook.ts` — HTTP handler for GET/POST.

## Webhooks

- **GET** `/webhook/messenger` — Facebook verification challenge (`hub.mode=subscribe`, `hub.verify_token`, `hub.challenge`).
- **POST** `/webhook/messenger` — Event delivery with `X-Hub-Signature-256` HMAC-SHA256 signature verification.
- Responds `200 EVENT_RECEIVED` immediately, processes messages asynchronously.
- Registered via `api.registerHttpHandler(handleMessengerWebhookRequest)`.

## Config

```jsonc
{
  "channels": {
    "messenger": {
      "pageAccessToken": "EAAx...", // Facebook Page access token
      "appSecret": "...", // Facebook App secret (for HMAC verification)
      "verifyToken": "...", // Webhook verify token (shared secret)
      "webhookPath": "/webhook/messenger", // Gateway HTTP path (default)
      "dmPolicy": "allowlist", // "open" | "pairing" | "allowlist" | "disabled"
      "allowFrom": ["123456789"], // PSIDs of allowed senders
      "textChunkLimit": 2000, // Max message length (default: 2000)
      "accounts": {
        // Optional multi-account
        "page2": {
          "pageAccessToken": "...",
          "name": "Page 2",
        },
      },
    },
  },
}
```

Environment variables (default account only):

- `MESSENGER_PAGE_ACCESS_TOKEN`
- `MESSENGER_APP_SECRET`
- `MESSENGER_VERIFY_TOKEN`

## Setup

1. Create a Facebook Developer App at developers.facebook.com.
2. Add the Messenger product.
3. Link a Facebook Page and generate a long-lived Page Access Token.
4. Configure the webhook URL: `https://<your-domain>/webhook/messenger`.
5. Subscribe to the `messages` webhook event.
6. Submit for App Review (`pages_messaging` permission).

## Tests

```bash
pnpm vitest run extensions/messenger
```
