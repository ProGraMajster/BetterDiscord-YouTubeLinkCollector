# Public distribution audit — 2026-10-11

Author: **ProGraMajster**. Version: **1.2.5**. License: **MIT**, selected by the project author.

The current standalone plugin was inspected directly rather than recovered from an older ZIP. Its SHA-256 is `b3f90a2e13dfd01bc0db1002f66df1a05473e1a4c6b273ed891094e88742addd`, identical to the installed version at the time of this audit. No runtime code, installed plugin, or user configuration was changed for publication.

The repository includes public source, project documentation and synthetic fixtures. Private configuration, real collected links, user exports/checkpoints, raw account screenshots, client cache, extracted vendor bundles, installation backups, and workspace scripts remain outside the distribution. Earlier redundant panel images remain local and ignored; the retained panel/settings images were visually reviewed and contain synthetic IDs and links. The test author's placeholder name was made generic. Private bank details and a private configuration fingerprint were removed from historical reports; their technical findings remain available.

The source ZIP uses the reviewed Git index and internal SHA-256 manifest, including explicit path checks and archive readback verification. Packaging cannot recursively ingest the workspace or ignored user data. Publication guards reject private filenames, unknown JSON artifacts, typical credential signatures and local profile paths. These guards supplement manual review and do not promise to detect every possible secret.

Local Node.js 24 / Windows validation: **171/171 tests passed**, zero failures/skips; **11 JavaScript files** and both inline HTML fixtures passed syntax/metadata/network-boundary checks. The additional three tests check publication version/author guards, private-path rejection and secret-safe errors. ZIP packaging verified all reviewed file entries and the internal manifest. GitHub CI separately tests Node.js 22/24 on Windows/Linux for the published commit.

The runtime's previous synthetic browser qualification remains in [VALIDATION.md](VALIDATION.md) and [BROWSER-RESULTS.txt](BROWSER-RESULTS.txt). This publication does not replace those checks with native-client claims. Current native BetterDiscord qualification remains incomplete, so the first public release is a **prerelease**. Completed search pagination does not establish full channel-history coverage or physical completion of an export download.

See [RELEASING.md](RELEASING.md) for exact version tags, manifest refresh, validation and automated release steps. The attached asset checksum file covers the standalone plugin and ZIP; the manifest inside the ZIP covers the public project files.
