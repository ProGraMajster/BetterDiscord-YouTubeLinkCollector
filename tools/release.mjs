// Publication tooling by ProGraMajster. Manifest logic adapted from the existing packager.
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {appendFile, copyFile, lstat, mkdir, readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

export function validateMetadata(metadata, plugin, tag) {
    const version = metadata.version;
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error("Version must be MAJOR.MINOR.PATCH.");
    if (tag !== undefined && tag !== `v${version}`) throw Error("Tag/package version mismatch.");
    if (metadata.author !== "ProGraMajster" || metadata.license !== "MIT" ||
        !/^ \* @author ProGraMajster$/m.test(plugin) ||
        !plugin.includes(` * @version ${version}\n`) ||
        !plugin.includes(`const VERSION = "${version}";`)) throw Error("Plugin/package author, license or version mismatch.");
    if (typeof metadata.release?.prerelease !== "boolean") throw Error("Explicit release.prerelease boolean required.");
    return {version, tag: `v${version}`, prerelease: metadata.release.prerelease};
}

export function assertPublicPath(name) {
    if (!name || name.includes("\\") || name.startsWith("/") || name.split("/").some(x => !x || x === "." || x === "..") ||
        /(?:^|\/)(?:\.git|\.codex|\.env[^/]*|node_modules|exports|backups|private-audit|work|artifacts|Cache(?:_Data)?|client-assets)(?:\/|$)/i.test(name) ||
        /(?:\.config\.json|\.(?:csv|log|tmp|lock|bak|asar|zip)(?:\.sha256)?)$/i.test(name) ||
        /checkpoint[^/]*\.json$/i.test(name) ||
        (name.endsWith(".json") && !["package.json", "tests/fixtures/1.0.0-126.json"].includes(name))) {
        throw Error(`Non-public or unsupported publication path: ${name}`);
    }
}

export function assertPublicText(text, name) {
    if (/(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,}|mfa\.[A-Za-z0-9_-]{50,}|[A-Za-z0-9_-]{24,28}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{25,})/.test(text)) {
        throw Error(`Potential credential in ${name}; contents suppressed.`);
    }
    if (/\b[A-Z]:\\(?:Users|Documents and Settings)\\/i.test(text) || /\/Users\/[^/\s]+\//.test(text)) {
        throw Error(`Local user-profile path in ${name}.`);
    }
}

async function publicationFiles() {
    const git = spawnSync("git", ["ls-files", "-z"], {cwd: root, encoding: "utf8"});
    if (git.status !== 0) throw Error("Packaging requires the reviewed Git index, not a recursive workspace copy.");
    const names = git.stdout.split("\0").filter(Boolean).sort();
    for (const name of ["YouTubeLinkCollector.plugin.js", "package.json", "README.md", "CHANGELOG.md", "LICENSE", "AGENTS.md", "SHA256SUMS.txt", ".github/workflows/ci.yml", ".github/workflows/release.yml"]) {
        if (!names.includes(name)) throw Error(`Required publication file is not tracked: ${name}`);
    }
    for (const name of names) {
        assertPublicPath(name);
        if (!(await lstat(path.join(root, name))).isFile()) throw Error(`Non-regular publication file: ${name}`);
        if (/\.(?:md|txt|json|js|cjs|mjs|html|yml|ps1)$/.test(name)) assertPublicText(await readFile(path.join(root, name), "utf8"), name);
    }
    return names.filter(name => name !== "SHA256SUMS.txt");
}

async function main() {
    const [mode, requestedTag] = process.argv.slice(2);
    if (!["--manifest", "--check", "--package"].includes(mode)) throw Error("Use --manifest, --check, or --package [vMAJOR.MINOR.PATCH].");
    const metadata = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    const info = validateMetadata(metadata, await readFile(path.join(root, "YouTubeLinkCollector.plugin.js"), "utf8"), requestedTag);
    if (!(await readFile(path.join(root, "README.md"), "utf8")).includes(`**Current version: ${info.version} `) ||
        !(await readFile(path.join(root, "docs", "UPGRADE.md"), "utf8")).startsWith(`# Upgrade to ${info.version} `)) {
        throw Error("Current README/upgrade version mismatch.");
    }
    const names = await publicationFiles();
    const manifest = (await Promise.all(names.map(async name => `${digest(await readFile(path.join(root, name)))}  ${name}`))).join("\n") + "\n";
    const manifestPath = path.join(root, "SHA256SUMS.txt");
    if (mode === "--manifest") {
        await writeFile(manifestPath, manifest);
        process.stdout.write(`Public manifest refreshed: ${names.length} files plus manifest.\n`);
        return;
    }
    if (await readFile(manifestPath, "utf8") !== manifest) throw Error("Tracked files differ from SHA256SUMS.txt; review changes and run release:manifest.");
    const changelog = await readFile(path.join(root, "CHANGELOG.md"), "utf8");
    const entry = changelog.split(/^## /m).slice(1).find(section => section.startsWith(`${info.version} `));
    if (!entry) throw Error("Current version is missing from CHANGELOG.md.");
    if (mode === "--check") {
        process.stdout.write(`Publication audit, ${info.tag} metadata and ${names.length} file hashes passed.\n`);
        return;
    }
    const destination = path.join(root, "artifacts");
    await mkdir(destination, {recursive: true});
    const zipName = `YouTubeLinkCollector-${info.tag}.zip`;
    const pack = spawnSync("pwsh", ["-NoProfile", "-File", path.join(root, "tools", "package-release.ps1"), "-SourceRoot", root, "-ArchivePath", path.join(destination, zipName)], {cwd: root, stdio: "inherit"});
    if (pack.status !== 0) throw Error("ZIP packaging or archive verification failed.");
    await copyFile(path.join(root, "YouTubeLinkCollector.plugin.js"), path.join(destination, "YouTubeLinkCollector.plugin.js"));
    const assets = ["YouTubeLinkCollector.plugin.js", zipName];
    await writeFile(path.join(destination, "SHA256SUMS.txt"), (await Promise.all(assets.map(async name => `${digest(await readFile(path.join(destination, name)))}  ${name}`))).join("\n") + "\n");
    const notes = `# YouTube Link Collector ${info.tag}\n\nAuthor: **ProGraMajster**. License: **MIT**.\n\n${info.prerelease ? "**Prerelease:** the current UI has not been fully qualified in native BetterDiscord. Automated tests and synthetic BdApi/browser fixtures are separate from native-client evidence.\n\n" : ""}## Features and usage\n\n- Collects YouTube URLs from locally available messages and all pages of an already-open Discord search using its existing UI buttons.\n- Stabilizes each page, saves a checkpoint before navigation, and verifies new results after loading. Includes page progress, configurable pacing, and cancellable Pause/Stop.\n- Resume preserves records and checkpoints. After restarting, reopen the same search and choose **Wznów zbieranie**; the current page is reread before advancing forward, without duplicating unchanged observations. Rewinding is a separate confirmed action. Automatic navigation does not restart unattended.\n- Exports the entire collection as TXT, CSV, or JSON; JSON includes all occurrences and the checkpoint.\n- Supports common YouTube video/Shorts/Live/embed/music/playlist URLs and a draggable Polish-language panel.\n\n## Changes in ${info.version}\n\n${entry.substring(entry.indexOf("\n") + 1).trim()}\n\n## Installation\n\nDownload **YouTubeLinkCollector.plugin.js** and place it in the BetterDiscord Plugins folder, then enable the plugin. No npm installation is required. For an upgrade, stop collection, retain your configuration and full JSON export, and replace only the plugin file. The ZIP includes public source, tests, and documentation. Verify downloads using the attached **SHA256SUMS.txt**.\n\n## Limits\n\nCompleted search pages do not prove full channel-history coverage; search/loaded-message exports retain **INCOMPLETE** coverage. Client React/store/pagination changes may require updates; unrecognized or inconsistent pages stop with diagnostics. Pending work is canceled immediately, although an already-delivered client click may finish loading. Browser download handoff does not confirm a physical file saved. Limits are 50,000 occurrences, 250,000 messages, and 24 MiB per snapshot. The plugin makes no custom Discord requests and reads no user token. Pacing does not guarantee invisibility or bypass platform restrictions.\n\nUnofficial; unaffiliated with Discord, BetterDiscord, or YouTube. See the README, validation report, and native test checklist in the repository.\n`;
    await writeFile(path.join(destination, "RELEASE-NOTES.md"), notes);
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `version=${info.version}\ntag=${info.tag}\nprerelease=${info.prerelease}\n`);
    process.stdout.write(`Prepared ${info.tag}: plugin, verified source ZIP, checksums and release notes.\n`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
