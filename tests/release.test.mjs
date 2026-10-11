import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {validateMetadata, assertPublicPath, assertPublicText} from "../tools/release.mjs";
const metadata = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const plugin = await readFile(new URL("../YouTubeLinkCollector.plugin.js", import.meta.url), "utf8");
test("release rejects tag, runtime-version and authorship mismatches", () => {
    assert.equal(validateMetadata(metadata, plugin, `v${metadata.version}`).version, metadata.version);
    assert.throws(() => validateMetadata(metadata, plugin, "v0.0.0"), /mismatch/);
    assert.throws(() => validateMetadata(metadata, plugin.replace(`const VERSION = "${metadata.version}"`, 'const VERSION = "0.0.0"')), /mismatch/);
    assert.throws(() => validateMetadata({...metadata, author: "Wrong author"}, plugin), /mismatch/);
    assert.throws(() => validateMetadata({...metadata, release: {}}, plugin), /boolean/);
});
test("release refuses private configs, exports, checkpoints and traversal", () => {
    for (const name of ["YouTubeLinkCollector.config.json", "exports/results.txt", ".env", "private-audit/backup.json", "state-checkpoint.json", "results.csv", "../private.txt", "/absolute.txt", "tests/fixtures/private.json", ".git/config"]) {
        assert.throws(() => assertPublicPath(name), /publication path/);
    }
    for (const name of ["README.md", "tests/fixtures/1.0.0-126.json", ".github/workflows/release.yml"]) assertPublicPath(name);
});
test("publication scan rejects credentials without echoing their contents", () => {
    const fabricated = "ghp_" + "X".repeat(36);
    assert.throws(() => assertPublicText(fabricated, "fixture.txt"), error => !error.message.includes(fabricated) && /credential/.test(error.message));
    assert.throws(() => assertPublicText("C:" + "\\Users\\PrivatePerson\\data", "fixture.txt"), /profile/);
    assertPublicText("DISCORD_BOT_TOKEN is read from the environment", "BOT.md");
});
