# Read-only connection to the real Discord client

Author: **ProGraMajster**. Available in **1.2.6**.

This connects to the actual running BetterDiscord plugin through short-lived local files. It does not open a network port, restart Discord, read a user token, attach a debugger, run scripts from requests, or provide remote UI controls. It is separate from browser fixtures.

Enable the current plugin in BetterDiscord, then run in the project directory:

```sh
npm run doctor -- --connect
npm run doctor
npm run doctor -- --disconnect
```

On Windows the default location is the BetterDiscord `plugins` directory under `%APPDATA%`. Elsewhere, pass `--folder` with your own Plugins folder. If the plugin was replaced but the response stays stale, disable/re-enable it in BetterDiscord. Keeping the search panel open provides page diagnostics; collection itself starts only through its normal UI.

`--connect` exclusively creates `YouTubeLinkCollector.debug-request.json`, containing protocol 1, a random correlation nonce and an expiry at most 30 minutes away. The plugin checks this bounded request every two seconds and atomically writes `YouTubeLinkCollector.diagnostics.json`. Requests with unknown fields, commands, scripts, invalid protocol/nonce, or expired/excessive lifetimes are ignored. There is no operation dispatcher or evaluator.

The CLI accepts only a fresh matching response (within 10 seconds). An absent, expired or stale response is a connection failure, never proof of a running client. `--disconnect` removes only the request. It leaves collection/config files untouched and the last response may remain as a local diagnostic artifact; no further snapshots are written after disconnect/expiry.

Reports include plugin version, active/running status, a generic error category, phase/timing, aggregate link/message counts, available store flags, page/offset/total counters, loaded/coherence flags, unresolved reason counts, and whether the current search matches the checkpoint. They deliberately exclude message content, URLs, message/channel/server IDs, names, search query/filters and raw error text. The nonce is correlation data, not a Discord credential.

The panel's **Kopiuj raport diagnostyczny** button provides the same sanitized view without enabling the connection. A read-only snapshot cannot reproduce a remote computer's intermittent failure or verify a physical file-save dialog; native interaction and export checks remain separate.

The connection was verified against a real running Discord/BetterDiscord client on 2026-10-16: fresh version-1.2.6 responses, recognized search/React/pagination, a complete 25/25 page and later a complete 23/23 last page. The user confirmed forward navigation after Pause/Resume. The 50-page interruption was separately reproduced as a synthetic page-19 checkpoint test; no native 50-page qualification is claimed.

In 1.2.7, the report also contains qualified/outside-channel hit counts, bounded message-shape booleans/types for unresolved hits, and each registered panel's connection state, active tab, last successful refresh age and sanitized error type/source line. No message IDs, channel IDs, content, URLs or raw exception text are added. This identified a complete other-channel result behind the native 24/25 stall. Native UI refresh was separately confirmed after repairing same-instance timer disposal.
