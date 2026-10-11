# YouTube Link Collector

[![CI](https://github.com/ProGraMajster/BetterDiscord-YouTubeLinkCollector/actions/workflows/ci.yml/badge.svg)](https://github.com/ProGraMajster/BetterDiscord-YouTubeLinkCollector/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A standalone BetterDiscord plugin by **ProGraMajster** that collects YouTube links from messages available in the client and the currently open Discord search. It uses the search panel's existing pagination buttons, verifies each loaded page, and preserves occurrences and source references in a local collection.

**Current version: 1.2.5 (prerelease).** Download the installable plugin from [GitHub Releases](https://github.com/ProGraMajster/BetterDiscord-YouTubeLinkCollector/releases). The interface is currently in Polish. This is an unofficial project, unaffiliated with Discord, BetterDiscord, or YouTube.

## Features

- Automatic collection through the existing search UI, with page progress such as 15/103.
- Page stabilization, loading checks, new-page verification, timeouts, and immediate cancellation of pending navigation.
- Configurable delay between page changes: 3–30 seconds by default; whole seconds from 0 to 300.
- Persistent checkpoints, alternate recovery banks, JSON import, and collection-preserving restart.
- TXT, CSV, and JSON exports of the entire collection, independent of list filters and displayed rows.
- Unique-resource grouping or all occurrences, with original URLs, authors, timestamps, and message references when available.
- Separate counts for checked messages, messages with links, messages without recognized links, and unverified results.
- A draggable panel, keyboard movement, searchable results, and expandable diagnostics.

## Installation and update

1. Install [BetterDiscord](https://betterdiscord.app/) using its installation instructions.
2. Download **YouTubeLinkCollector.plugin.js** from the [release assets](https://github.com/ProGraMajster/BetterDiscord-YouTubeLinkCollector/releases).
3. In Discord, open **User Settings → BetterDiscord → Plugins → Open Plugins Folder**.
4. Place only the `.plugin.js` file in that folder and enable **YouTubeLinkCollector**.
5. Use **YT • Kolektor** in the top bar to open the panel.

The plugin requires no npm installation, compilation, or additional plugin library. The ZIP is a source/documentation bundle; do not copy the entire archive into Plugins.

Before updating, stop collection and retain your full JSON export, existing plugin, and configuration. Replace only the plugin, then disable/re-enable it. Keep its filename and configuration. Do not use Reset as an upgrade procedure. See [Upgrade and recovery](docs/UPGRADE.md).

## Collect all search pages

1. Open the desired channel or direct conversation. In **Ustawienia i prywatność**, use **Wybierz otwarty kanał** and verify the selection.
2. Open Discord search. For a server channel, set an exact `in:` filter. Search `youtube.com`, choose a consistent sort order, and remove unwanted author/date filters.
3. Select TXT, CSV, or JSON, then choose **Zbierz wszystkie strony** (Collect all pages).
4. The plugin reads and stabilizes the current results, saves the links and checkpoint, clicks an existing Next/Previous control, and waits for a verified new page. Starting in the middle reads that page, returns to page 1, then proceeds to the end.
5. Keep the channel, query, filters, and sort order unchanged. Their changes stop collection while preserving captured data. Use **Pauza** or **Stop** to cancel pending work; a click already delivered to Discord may finish loading.
6. After the last available page, the plugin initiates an export of the entire collection. Canceling the save dialog preserves the collection. A download fallback confirms handoff to the browser, not a physical file saved to disk.
7. Repeat for `youtu.be` without Reset. These are separate search scopes in the same collection. Use ordinary date filters to split searches limited by Discord's index or pagination.

Configure pacing while stopped under **Ustawienia i prywatność**: minimum/maximum seconds, then **Zapisz zakres**. Equal values give a fixed delay. Pacing controls workload; it does not guarantee invisibility or bypass client limits.

## Stop, resume, and checkpoints

Checkpoints use schema 1 and the existing `BdApi.Data` namespace, including alternate banks and readback validation. Start/Resume preserve existing records; Reset is an explicit destructive action. Periodic saving occurs every 15 seconds and when stopping or disabling the plugin. A crash can lose the latest unsaved batch.

After a pause or restart, reopen the same search scope and choose **Zbierz wszystkie strony** again to resume automatic collection. Pages may be revisited; unchanged messages do not create duplicate observations. **Start odczytu / Wznów odczyt** resumes reading locally available messages and is a separate action from automatic pagination. Navigation never starts unattended after a restart.

Use **Kopie, import i odzyskiwanie** for backup inspection, exporting a recovery copy, or explicitly restoring one. JSON includes all occurrences and the checkpoint; TXT/CSV cannot restore collection state. Import requires a valid compatible file and matching channel. See [Usage](docs/USAGE.md) and [architecture](docs/ARCHITECTURE.md) for details.

## Supported URLs and exports

Supported forms include `youtube.com/watch`, `youtu.be`, Shorts, Live, embed, playlists, `www`/`m`/`music.youtube.com`, and `youtube-nocookie.com`. Original parameters are retained; canonical URLs use the video or playlist ID. Video availability is not checked.

| Format | Contents |
| --- | --- |
| TXT | One original or canonical URL per line; unique resources or all occurrences. |
| CSV | URLs, resource type/ID, author, timestamp, message URL and channel/message IDs. Unique mode also includes occurrence count and sources. UTF-8 BOM, quoted cells, and formula-injection protection. |
| JSON | All occurrences, groups, collection metadata, coverage information, errors, search history, and a restorable checkpoint. |

A Discord search count represents messages, not videos. A checked message without a recognized YouTube URL is not a skipped result. Unverified messages and count mismatches are separate warnings. Completed search pagination still leaves full channel-history coverage **INCOMPLETE**: the index, filters, domains, pagination limits, edits, and deletions can affect what is accessible. Preserve the JSON export for coverage details.

## Compatibility and limitations

- The adapter was investigated against Discord client 1.0.9261 and the documented BetterDiscord APIs. Internal React/store/pagination contracts can change after client updates; compatibility with every build is not guaranteed.
- Unsupported or inconsistent search state stops navigation with diagnostics. Clicking a button alone is never treated as proof of a successful transition.
- The current UI was tested with synthetic BdApi/browser fixtures. It has **not been fully qualified in native BetterDiscord**, so this first GitHub release is a prerelease. See [validation evidence](docs/VALIDATION.md) and the [native test checklist](docs/MANUAL-TEST.md).
- Limits: 50,000 occurrences, 250,000 distinct messages, and 24 MiB per snapshot; whichever is reached first stops collection. Export JSON before resetting.
- The plugin makes no custom Discord requests, reads no user token, and has no telemetry or updater. Client modification and UI automation are not approval from the platform; see [Discord's platform policy](https://discord.com/safety/platform-manipulation-policy-explainer).

An optional, separate [registered-bot CLI](docs/BOT.md) reads permitted server-channel history using Discord's official bot API. It requires Node.js 22+, a registered bot, channel permissions, and Message Content Intent. It does not accept normal-user tokens or access DMs. The plugin does not use this CLI for UI navigation.

## Development and releases

Node.js **22+** is needed only for tests and tools. There are no package dependencies or build step.

```sh
npm test
npm run check
npm run release:check
npm run preview
```

The preview at `http://127.0.0.1:8765/` uses synthetic data and BdApi substitutes. `/automation` exercises UI pagination; it is not a logged-in Discord test. [This panel preview](docs/PANEL-1.2.5.png) is explicitly synthetic, not a screenshot of a user's Discord account.

CI checks Windows/Linux and Node.js 22/24 without Discord credentials. Tags matching `vMAJOR.MINOR.PATCH` run validation, package the tracked public files, and publish a plugin, source/docs ZIP, and SHA-256 checksums. See [release instructions](docs/RELEASING.md). Historical technical documentation is retained in Polish.

## Author and license

Created and maintained by **ProGraMajster**. Licensed under the [MIT License](LICENSE).
