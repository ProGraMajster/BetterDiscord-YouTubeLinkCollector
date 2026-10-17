# Upgrade to 1.2.7 and recovery

Author: **ProGraMajster**.

Stop collection first. Retain the previous plugin, a full JSON export, and a copy of your BetterDiscord configuration made while Discord is fully closed. Replace only `YouTubeLinkCollector.plugin.js`, keeping its filename. Enable or disable/re-enable the plugin in BetterDiscord. Do not delete configuration or use Reset during an upgrade.

Schema 1, the plugin's data namespace, and active `checkpoint`/`state-a`/`state-b` keys remain compatible with 1.0.0, 1.1.0 and 1.2.0–1.2.6. Before rotating old 1.0/1.1 banks, verified legacy copies preserve their original data. A larger recovery bank is retained before overwrite. New optional pacing settings default to 3–30 seconds when absent; existing settings are preserved. The registered-bot tool also accepts prior supported checkpoint versions.

Compare collection counts after upgrading and export JSON again. Start/Resume preserve records. Navigation does not start automatically after a restart: reopen the same search scope and choose **Wznów zbieranie**. The current page is reread, then pagination moves forward. Rewinding requires **Zbierz od początku…** and confirmation. Unchanged messages do not create duplicate observations. The previous misleading local Resume button is replaced by an explicit advanced manual-reading action. Checkpoints optionally retain run mode/export format without changing schema 1; older checkpoints with navigation infer automatic resume. A missing load timeout defaults to 90 seconds.

If counts are smaller, stop and open **Kopie, import i odzyskiwanie**. Inspect available banks and export copies before restoring. Exporting a recovery copy does not replace the active collection. Restore/import requires a compatible JSON, matching channel, and confirmation; TXT/CSV cannot restore checkpoints. Invalid data or an implicit empty replacement blocks persistence instead of overwriting the previous collection.

Keep backups outside the repository and plugin release ZIP. Never commit `YouTubeLinkCollector.config.json`, exports, or private checkpoints. Periodic `BdApi.Data` readback confirms API acceptance, not a physical disk flush. A crash can lose unsaved data, so preserve full JSON exports during long collections.

In 1.2.7, page evidence optionally retains `excludedIDs` for fully recognized results outside the selected channel. These identities are part of the page signature and result count, but their links/content are not added to this channel collection. They are shown separately from linkless and unavailable messages. Older schema-1 pages without this field keep their existing meaning. All existing storage and tracking budgets apply. The UI timer fix supports repeated disable/enable on the same BetterDiscord instance.
