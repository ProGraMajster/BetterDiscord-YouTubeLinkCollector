import {spawnSync} from "node:child_process";
import {readdir, readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import vm from "node:vm";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
async function files(directory) {
    const all = [];
    for (const entry of await readdir(directory, {withFileTypes: true})) {
        if ([".git", "node_modules", "exports", "artifacts"].includes(entry.name)) continue;
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) all.push(...await files(target));
        else if (/\.(?:js|cjs|mjs)$/.test(entry.name)) all.push(target);
    }
    return all;
}
let failed = false, count = 0;
for (const file of await files(root)) {
    const result = spawnSync(process.execPath, ["--check", file], {encoding: "utf8"});
    if (result.status !== 0) { process.stderr.write(result.stderr); failed = true; }
    count++;
}
const plugin = await readFile(path.join(root, "YouTubeLinkCollector.plugin.js"), "utf8");
const metadata = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
if (metadata.author !== "ProGraMajster" || !plugin.includes(" * @author ProGraMajster\n") || !plugin.includes(` * @version ${metadata.version}\n`)) { process.stderr.write("Author/version metadata mismatch.\n"); failed = true; }
for (const name of ["browser-fixture.html", "automation-browser.html"]) {
    const fixture = await readFile(path.join(root, "tests", name), "utf8");
    for (const match of fixture.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
        try { new vm.Script(match[1], {filename: name}); }
        catch (error) { process.stderr.write(`${error.message}\n`); failed = true; }
    }
}
if (!plugin.startsWith("/**\n * @name YouTubeLinkCollector") || !plugin.includes("module.exports = YouTubeLinkCollector")) { process.stderr.write("Invalid plugin packaging.\n"); failed = true; }
// Security boundary regression checks, intentionally narrow to the distribution.
for (const pattern of [/\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bgetToken\s*\(/, /\beval\s*\(/, /\bnew\s+Function\s*\(/, /\binnerHTML\s*=/, /\.Net\./]) {
    if (pattern.test(plugin)) { process.stderr.write(`Unexpected network/token/dynamic-code/HTML primitive in plugin: ${pattern}\n`); failed = true; }
}
if (failed) process.exitCode = 1;
else process.stdout.write(`Syntax checked ${count} JavaScript files; plugin packaging and network boundary passed.\n`);
