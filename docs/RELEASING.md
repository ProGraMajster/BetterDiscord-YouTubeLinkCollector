# Publishing a release

Author: **ProGraMajster**.

The standalone plugin is the source and installable artifact. No compilation or npm dependencies are needed. Node.js 22+ and PowerShell 7 (`pwsh`) run the validation and the existing ZIP packager, adapted to portable parameters and a tracked-file manifest.

1. Update the plugin header, runtime `VERSION`, `package.json`, current README version, upgrade instructions, and an English `## X.Y.Z` changelog section. Keep author ProGraMajster, schema compatibility, and recovery/export behavior.
2. Set `release.prerelease` in `package.json` explicitly. Keep it `true` until native BetterDiscord qualification is documented; synthetic fixtures alone cannot justify a stable release.
3. Review files and stage only public source, docs and synthetic tests. `.gitignore` is not a substitute for this review. Never add private config, exports, checkpoints, tokens, cache, or account screenshots.
4. Run `npm test` and `npm run check`. After staging new files, run `npm run release:manifest`, review/stage `SHA256SUMS.txt`, then run `npm run release:check`. This checks metadata, the reviewed Git index, publication paths, potential credentials/profile paths, and every tracked-file hash. It is a guard, not a universal secret detector.
5. Commit and push to `main`. Wait for the complete CI matrix to succeed for that exact commit before tagging.
6. Create and push the matching version tag:

```sh
git tag vX.Y.Z
git push origin vX.Y.Z
```

The Release workflow tests the tag again, verifies its version, prepares the artifacts, checks the archive contents against the source manifest, and publishes **YouTube Link Collector vX.Y.Z** with:

- `YouTubeLinkCollector.plugin.js`
- `YouTubeLinkCollector-vX.Y.Z.zip`
- `SHA256SUMS.txt`

Only the publication job has `contents: write`. CI and packaging have read permissions. No Discord credentials are required. GitHub Actions are pinned to reviewed commit SHAs.

The ZIP contains the public tracked project beneath `YouTubeLinkCollector/`, including the internal per-file `SHA256SUMS.txt`. The separately attached checksum file covers the standalone plugin and ZIP. Zip entry timestamps are fixed for repeatable packaging on the same runtime.

For local packaging, use `npm run release:package -- vX.Y.Z`; outputs are ignored under `artifacts/`. Packaging refuses to replace an existing ZIP. Review/archive previous outputs outside the repo before another run.

If the tag exists but publication failed before creating a release, manually run the Release workflow with that tag. An existing release is never overwritten automatically. A retry after a successful publication fails safely; edit an existing release only as a separate intentional operation.

Verify the public repo, tag commit, downloaded assets and hashes after each publication. Download the plugin/ZIP/checksums and use `sha256sum --check SHA256SUMS.txt` on Linux, or `Get-FileHash -Algorithm SHA256` in PowerShell. Native-client tests remain a separate qualification step.
