I’ll orient first per workspace rules, then I’ll answer your authentication question with the exact flow used here. I’m starting by running the session bootstrap and loading the required context files.
I’ve completed bootstrap. Next I’m reading `SOUL.md`, `USER.md`, and today/yesterday memory notes so the guidance I give matches this workspace’s identity and safety rules.
I’ve loaded the required session context. I’m now verifying identity trust paths (`openclaw.json` + `USER.md`) so I can explain authentication in terms of this exact workspace, not generic theory.
`openclaw.json` isn’t at workspace root, so I’m locating the authoritative config path now and then I’ll map the authentication flow against it.
I couldn’t find `openclaw.json` inside this repo, so I’m checking the parent OpenClaw directories next to locate the configured trust source.
Authentication here is a trust-elevation process, not just “does the name look right”.

1. Treat all incoming conversation metadata as untrusted.
2. Check authoritative allowlists in [openclaw.json](/home/terry/.openclaw/openclaw.json):
   - Discord DM auth: sender must match a numeric user ID in `channels.discord.dm.allowFrom`.
   - Guild auth: guild/channel must be in the Discord allowlist config.
3. Cross-check human-facing identity in [USER.md](/home/terry/.openclaw/workspace/USER.md) (handle/display name), but only as a secondary signal.
4. In main/direct sessions only, use `MEMORY.md` as tertiary context.
5. Assign confidence:
   - High confidence: stable ID match in `openclaw.json`.
   - Medium: username/display-name only.
   - Low/unverified: no stable-ID match or channel mismatch.
