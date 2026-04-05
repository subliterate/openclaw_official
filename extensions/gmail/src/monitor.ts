import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { resolveGmailAccount } from "./accounts.js";
import { getMessage, getProfile, pollHistory } from "./api.js";
import { getGmailRuntime } from "./runtime.js";
import type { GmailConfig, GmailInboundMessage, ResolvedGmailAccount } from "./types.js";

type CoreConfig = OpenClawConfig & {
  channels?: { gmail?: GmailConfig };
};

export type GmailMonitorOptions = {
  accountId: string;
  config?: CoreConfig;
  abortSignal?: AbortSignal;
  statusSink?: (patch: Record<string, unknown>) => void;
  onMessage?: (message: GmailInboundMessage, account: ResolvedGmailAccount) => Promise<void>;
};

/**
 * Polls Gmail for new messages and dispatches them to the handler.
 * Uses the Gmail History API with historyId tracking for incremental polling.
 */
export async function monitorGmailProvider(
  opts: GmailMonitorOptions,
): Promise<{ stop: () => void }> {
  const core = getGmailRuntime();
  const cfg = opts.config ?? (core.config.loadConfig() as CoreConfig);
  const account = resolveGmailAccount({ cfg, accountId: opts.accountId });

  if (!account.configured) {
    throw new Error(
      `Gmail is not configured for account "${account.accountId}" (need clientId, clientSecret, and refreshToken in channels.gmail).`,
    );
  }

  const logger = core.logging.getChildLogger({ channel: "gmail", accountId: opts.accountId });

  const pollIntervalMs = (account.config.pollIntervalSec ?? 60) * 1000;
  const label = account.config.label ?? "INBOX";
  const maxResults = account.config.maxResults ?? 10;
  const seenMessageIds = new Set<string>();

  let stopped = false;
  let historyId = "";
  let pollTimer: ReturnType<typeof setTimeout> | null = null;

  // Initialize: get current historyId so we only see new messages.
  try {
    const profile = await getProfile(account);
    historyId = profile.historyId;
    opts.statusSink?.({
      running: true,
      lastStartAt: Date.now(),
      email: profile.email,
    });
    logger.info(`[gmail:${account.accountId}] monitoring started (${profile.email})`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    opts.statusSink?.({ running: false, lastError: msg });
    throw new Error(`Gmail monitor initialization failed: ${msg}`);
  }

  async function poll() {
    if (stopped) {
      return;
    }

    try {
      if (!historyId) {
        // No historyId — full sync not supported, just get current position.
        const profile = await getProfile(account);
        historyId = profile.historyId;
        return;
      }

      const result = await pollHistory(account, historyId, label);

      if (result.latestHistoryId) {
        historyId = result.latestHistoryId;
      } else {
        // historyId expired — reset by fetching current position.
        const profile = await getProfile(account);
        historyId = profile.historyId;
        logger.warn(`[gmail:${account.accountId}] historyId expired, reset to current`);
        return;
      }

      // Fetch and dispatch new messages.
      const newIds = result.messageIds.filter((id) => !seenMessageIds.has(id));
      const fetchLimit = Math.min(newIds.length, maxResults);

      for (let i = 0; i < fetchLimit; i++) {
        if (stopped) break;
        const id = newIds[i]!;

        try {
          const message = await getMessage(account, id);
          seenMessageIds.add(id);

          // Skip messages sent by ourselves.
          if (account.email && message.from === account.email.toLowerCase()) {
            continue;
          }

          core.channel.activity.record({
            channel: "gmail",
            accountId: account.accountId,
            direction: "inbound",
            at: message.timestamp,
          });

          opts.statusSink?.({ lastInboundAt: message.timestamp });

          if (opts.onMessage) {
            await opts.onMessage(message, account);
          }
        } catch (err) {
          logger.error(
            `[gmail:${account.accountId}] failed to fetch message ${id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      // Prevent unbounded growth of seen set.
      if (seenMessageIds.size > 5000) {
        const entries = [...seenMessageIds];
        const trimmed = entries.slice(entries.length - 2000);
        seenMessageIds.clear();
        for (const entry of trimmed) {
          seenMessageIds.add(entry);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[gmail:${account.accountId}] poll error: ${msg}`);
      opts.statusSink?.({ lastError: msg });
    } finally {
      if (!stopped) {
        pollTimer = setTimeout(poll, pollIntervalMs);
      }
    }
  }

  // Start the first poll after a short delay to allow gateway startup.
  pollTimer = setTimeout(poll, 2000);

  return {
    stop: () => {
      stopped = true;
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
      opts.statusSink?.({ running: false, lastStopAt: Date.now() });
      logger.info(`[gmail:${account.accountId}] monitoring stopped`);
    },
  };
}
