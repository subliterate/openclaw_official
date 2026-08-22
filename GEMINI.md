# GEMINI.md - OpenClaw Project Context

## 1. Project Overview

**OpenClaw** is a personal AI assistant gateway designed to run on user-owned devices. It acts as a control plane (Gateway) that connects various messaging channels (WhatsApp, Telegram, Slack, Discord, etc.) to AI agents. It features an extensible skills platform, browser control, a live visual workspace (Canvas), and voice-driven interactions.

### Main Technologies

- **Runtime:** Node.js (>=22.12.0)
- **Language:** TypeScript (ESM)
- **Package Manager:** pnpm (>=10.23.0)
- **Build System:** tsdown, rolldown
- **Testing:** Vitest
- **Linting/Formatting:** Oxlint, Oxfmt
- **Documentation:** Mintlify

## 2. Architecture & Subsystems

- **Gateway (`src/gateway/`):** The central WebSocket control plane for sessions, channels, tools, and events.
- **Agents (`src/agents/`):** AI agent runtime (Pi agent) that processes messages and executes tools.
- **Channels (`src/channels/`, `src/whatsapp/`, etc.):** Integrations with various messaging platforms.
- **Tools (`src/browser/`, `src/canvas-host/`, `src/node-host/`):** Capabilities exposed to agents (browser, canvas, device nodes).
- **Extensions (`extensions/`):** Pluggable integrations (channels, tools) that extend core functionality.
- **Apps (`apps/`):** Companion applications for macOS (menu bar), iOS, and Android.
- **UI (`ui/`):** Web-based Control UI and WebChat.

## 3. Building and Running

### Core Commands

- **Install Dependencies:** `pnpm install`
- **Build Project:** `pnpm build`
- **Run CLI (Dev):** `pnpm dev` or `pnpm openclaw ...`
- **Run Gateway (Watch):** `pnpm gateway:watch`
- **Run Web UI (Dev):** `pnpm ui:dev`

### Testing

- **Run Unit Tests:** `pnpm test`
- **Run E2E Tests:** `pnpm test:e2e`
- **Run Live Tests:** `pnpm test:live` (requires real API keys)
- **Coverage:** `pnpm test:coverage`

### Standards & Quality

- **Lint:** `pnpm lint`
- **Format:** `pnpm format`
- **Type-check:** `pnpm tsgo`
- **Full Check:** `pnpm check` (format + tsgo + lint)

## 4. Development Conventions

- **Style:** Strict TypeScript (ESM). Avoid `any`. Prefer `@Observable` for UI state.
- **Formatting:** 4-space indentation. K&R braces (C style). Handled by `oxfmt`.
- **Naming:** `snake_case` for variables/macros, `PascalCase` for types/classes, `camelCase` for functions.
- **Testing:** Tests are colocated (`*.test.ts`). Aim for 70% coverage.
- **Comments:** Brief comments for non-obvious logic. Focus on _why_, not _what_.
- **Multi-Agent Safety:**
  - Use `scripts/committer "<msg>" <file...>` for commits.
  - Be careful with shared state (stashes, worktrees).
  - Always `git pull --rebase` before pushing.
- **Documentation:** Root-relative links in `docs/`. No `.md` extension in internal links.
- **Security:** Treat inbound DMs as untrusted input. Never commit secrets.

## 5. Key Directory Structure

- `src/`: Core logic and CLI wiring.
- `extensions/`: Workspace packages for plugins/channels.
- `packages/`: Internal service bots (clawdbot, moltbot).
- `apps/`: Platform-specific companion app source code.
- `ui/`: Web-based dashboard and chat interface.
- `docs/`: Mintlify documentation source.
- `skills/`: Bundled skills for agents.
- `scripts/`: Development and build utility scripts.

## 6. Project Context Variables

- **Project Root:** `/home/terry/openclaw`
- **Workspace Root:** `~/.openclaw/workspace`
- **Config Path:** `~/.openclaw/openclaw.json`
- **Credentials:** `~/.openclaw/credentials/`
- **Gateway Port:** Default `18789`
