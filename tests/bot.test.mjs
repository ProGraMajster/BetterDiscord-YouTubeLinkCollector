import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {DiscordBotClient, preflight, effectivePermissions, scanHistory, atomicWrite, readCheckpoint, main} from "../tools/collect-channel.mjs";
import Plugin from "../YouTubeLinkCollector.plugin.js";
const {Collection, exportData, VERSION} = Plugin.Core;
const channelID = "111111111111111111", guildID = "222222222222222222", botID = "444444444444444444", applicationID = "555555555555555555";
const upper = 333333333333333333n;
const identity = {botID, applicationID, selection: {channelID, channelName: "muzyka", serverID: guildID, serverName: "Serwer"}};
const message = id => ({id: String(id), channel_id: channelID, content: "https://youtu.be/dQw4w9WgXcQ", embeds: [], author: {username: "Bot fixture"}, timestamp: "2026-10-09T00:00:00Z"});
const cursor = () => ({botID, applicationID, before: null, snapshotUpperMessageID: null, reachedEnd: false});
const pagesClient = pages => { let index = 0; const routes = []; return {routes, get: async route => { routes.push(route); if (index >= pages.length) throw new Error("Unexpected extra request"); return structuredClone(pages[index++]); }}; };

test("1.2.0/1.2.1/1.2.2/1.2.3/1.2.4 official-bot checkpoints remain readable after the patch upgrade", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ytlc-compat-"));
    try {
        const data = new Collection(identity.selection); data.begin(); data.process(message(upper));
        data.state.checkpoint.before = String(upper);
        for (const version of ["1.2.0", "1.2.1", "1.2.2", "1.2.3", "1.2.4"]) {
            const snapshot = data.snapshot(); snapshot.pluginVersion = version;
            const file = path.join(directory, "checkpoint-"+version+".json");
            await atomicWrite(file, JSON.stringify({toolVersion: version, bot: {...cursor(), before: String(upper), snapshotUpperMessageID: String(upper)}, collection: snapshot}));
            const restored = await readCheckpoint(file);
            assert.equal(restored.collection.records.size, 1); assert.equal(restored.collection.state.pluginVersion, VERSION);
        }
    } finally { await fs.rm(directory, {recursive:true, force:true}); }
});
test("official history advances with snowflake before cursor until an empty authorized page", async () => {
    const client = pagesClient([[message(upper), message(upper - 1n)], [message(upper - 2n)], []]);
    const checkpoints = [];
    const result = await scanHistory({client, identity, recheck: async () => identity, checkpoint: async (data, bot) => checkpoints.push(structuredClone({collection: data.snapshot(), bot}))});
    assert.equal(client.routes[1], `/channels/${channelID}/messages?limit=100&before=${upper - 1n}`);
    assert.equal(client.routes.length, 3); assert.equal(result.collection.records.size, 3);
    assert.equal(result.collection.state.status, "complete"); assert.equal(result.bot.snapshotUpperMessageID, String(upper));
    assert.equal(Collection.restore(JSON.parse(exportData(result.collection, "json")).collection).state.status, "complete");
    assert.equal(checkpoints.at(-1).bot.reachedEnd, true);
});
test("a short nonempty history page is followed; it never establishes completion", async () => {
    const result = await scanHistory({client: pagesClient([[message(upper)]]), identity, maxPages: 1, recheck: async () => identity});
    assert.equal(result.collection.state.status, "interrupted"); assert.equal(result.bot.reachedEnd, false);
});
test("empty page after permission revocation cannot claim completion", async () => {
    const data = new Collection(identity.selection);
    await assert.rejects(scanHistory({client: pagesClient([[]]), identity, collection: data, recheck: async () => { throw new Error("READ_MESSAGE_HISTORY revoked"); }}), /revoked/);
    assert.equal(data.state.status, "failed"); assert.equal(data.state.completeness.status, "failed");
});
test("malformed and cross-channel pages are rejected before any commit", async () => {
    for (const bad of [{...message(upper - 1n), channel_id: guildID}, {...message(upper - 1n), content: null}, {...message(upper - 1n), embeds: null}, {...message(upper - 1n), timestamp: "bad"}, message(upper)]) {
        const data = new Collection(identity.selection);
        await assert.rejects(scanHistory({client: pagesClient([[message(upper), bad]]), identity, collection: data}), /Malformed/);
        assert.equal(data.records.size, 0);
    }
});
test("repeated/non-advancing history cursor stops with previous progress", async () => {
    const data = new Collection(identity.selection);
    await assert.rejects(scanHistory({client: pagesClient([[message(upper)], [message(upper)]]), identity, collection: data}), /non-advancing/);
    assert.equal(data.records.size, 1); assert.equal(data.state.checkpoint.before, String(upper));
});
test("interrupted page replays safely and remains anchored to the initial upper boundary", async () => {
    const data = new Collection(identity.selection), bot = cursor(), controller = new AbortController();
    const page = Array.from({length: 150}, (_, index) => message(upper - BigInt(index)));
    // Endpoint page max 100; cancel immediately after the cooperative chunk of a full page.
    const first = await scanHistory({client: pagesClient([page.slice(0, 100)]), identity, collection: data, bot, signal: controller.signal, onProgress: () => controller.abort()});
    assert.equal(first.collection.records.size, 100); assert.equal(bot.before, null); assert.equal(data.state.status, "interrupted");
    const resumed = Collection.restore(data.snapshot());
    const client = pagesClient([page.slice(0, 100), page.slice(100), []]);
    await scanHistory({client, identity, collection: resumed, bot, recheck: async () => identity});
    assert.equal(client.routes[0], `/channels/${channelID}/messages?limit=100&before=${upper + 1n}`);
    assert.equal(resumed.records.size, 150); assert.equal(resumed.seen.size, 150); assert.equal(resumed.state.status, "complete");
});
test("history retry pacing obeys 429 headers and uses only Bot authorization", async () => {
    const waits = [], requests = []; let calls = 0;
    const client = new DiscordBotClient("mock-token", {wait: async ms => waits.push(ms), fetchImpl: async (url, options) => {
        requests.push({url, options});
        return calls++ === 0 ? new Response(JSON.stringify({retry_after: 1.2}), {status: 429, headers: {"Retry-After": "2"}}) : new Response("[]", {status: 200, headers: {"X-RateLimit-Remaining": "0", "X-RateLimit-Reset-After": "1.5"}});
    }});
    assert.deepEqual(await client.get(`/channels/${channelID}/messages?limit=100`), []);
    assert.deepEqual(waits, [2100, 1600]);
    assert.equal(requests[0].options.headers.Authorization, "Bot mock-token"); assert.equal(requests[0].options.redirect, "error");
    assert.ok(requests.every(x => x.url.startsWith("https://discord.com/api/v10/")));
    await assert.rejects(client.get("https://evil.test/"), /Unexpected/);
});
test("401 and 403 stop immediately; repeated 429 requests have a bounded budget", async () => {
    for (const code of [401, 403]) {
        let requests = 0;
        const client = new DiscordBotClient("mock", {wait: async () => {}, fetchImpl: async () => { requests++; return new Response("{}", {status: code}); }});
        await assert.rejects(client.get("/users/@me"), new RegExp(String(code))); assert.equal(requests, 1);
    }
    let requests = 0;
    const client = new DiscordBotClient("mock", {wait: async () => {}, fetchImpl: async () => { requests++; return new Response('{"retry_after":1}', {status: 429}); }});
    await assert.rejects(client.get("/users/@me"), /six/); assert.equal(requests, 6);
});
test("preflight rejects ordinary accounts, missing content access and wrong channel types", async () => {
    const good = {
        "/users/@me": {bot: true, id: botID}, "/oauth2/applications/@me": {id: applicationID, flags: 1 << 19},
        [`/channels/${channelID}`]: {id: channelID, guild_id: guildID, name: "muzyka", type: 0, permission_overwrites: []},
        [`/guilds/${guildID}`]: {id: guildID, name: "Serwer", owner_id: "666666666666666666"},
        [`/guilds/${guildID}/roles`]: [{id: guildID, permissions: String(1024 | 65536)}],
        [`/guilds/${guildID}/members/${botID}`]: {roles: [], user: {id: botID}}
    };
    assert.deepEqual(await preflight({get: async route => good[route]}, channelID), identity);
    for (const mutate of [x => { x["/users/@me"].bot = false; }, x => { x["/oauth2/applications/@me"].flags = 0; }, x => { x[`/channels/${channelID}`].type = 11; }, x => { x[`/guilds/${guildID}/roles`][0].permissions = "1024"; }]) {
        const data = structuredClone(good); mutate(data);
        await assert.rejects(preflight({get: async route => data[route]}, channelID));
    }
});
test("channel permission overwrites and administrator shortcut follow the official order", () => {
    const guild = {id: guildID}, roleID = "777777777777777777";
    const roles = [{id: guildID, permissions: "66560"}, {id: roleID, permissions: "0"}], member = {roles: [roleID]};
    const channel = {permission_overwrites: [{id: guildID, type: 0, deny: "65536", allow: "0"}, {id: roleID, type: 0, deny: "0", allow: "65536"}]};
    assert.equal(effectivePermissions(guild, roles, member, channel, botID) & 65536n, 65536n);
    channel.permission_overwrites.push({id: botID, type: 1, deny: "65536", allow: "0"});
    assert.equal(effectivePermissions(guild, roles, member, channel, botID) & 65536n, 0n);
    roles[1].permissions = "8"; assert.equal(effectivePermissions(guild, roles, member, channel, botID) & 65536n, 65536n);
});
test("atomic checkpoint roundtrip and mismatch validation preserve recovery", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ytlc-test-"));
    try {
        const file = path.join(directory, "checkpoint.json"), data = new Collection(identity.selection), bot = cursor();
        data.begin(); data.process(message(upper)); bot.before = String(upper); bot.snapshotUpperMessageID = String(upper); data.state.checkpoint.before = bot.before;
        await atomicWrite(file, JSON.stringify({toolVersion: VERSION, bot, collection: data.snapshot()}));
        const restored = await readCheckpoint(file); assert.equal(restored.collection.records.size, 1); assert.equal(restored.collection.state.status, "interrupted");
        bot.before = String(upper - 1n); await atomicWrite(file, JSON.stringify({toolVersion: VERSION, bot, collection: data.snapshot()}));
        await assert.rejects(readCheckpoint(file), /Inconsistent/);
        assert.deepEqual((await fs.readdir(directory)).sort(), ["checkpoint.json"]);
    } finally { await fs.rm(directory, {recursive: true, force: true}); }
});
test("failed atomic export leaves an existing file intact and cleans only its own temporary", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ytlc-write-"));
    try {
        const target = path.join(directory,"export.txt"); await fs.writeFile(target,"previous export");
        const wrapped = {open: (...args) => fs.open(...args), rename: async () => { throw new Error("rename rejected"); }, unlink: (...args) => fs.unlink(...args)};
        await assert.rejects(Plugin.Core.writeExportFile(wrapped,target,"new export"), /rename rejected/);
        assert.equal(await fs.readFile(target,"utf8"),"previous export"); assert.deepEqual(await fs.readdir(directory),["export.txt"]);
        await atomicWrite(target,"żółw\r\n"); assert.equal(await fs.readFile(target,"utf8"),"żółw\r\n");
    } finally { await fs.rm(directory,{recursive:true,force:true}); }
});
test("CLI refuses concurrent writers and preserves existing checkpoint on a non-resume run", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ytlc-lock-"));
    try {
        const checkpoint = path.join(directory,`checkpoint-${channelID}.json`), lock = `${checkpoint}.lock`;
        await fs.writeFile(lock,"existing process lock");
        await assert.rejects(main(["--channel",channelID,"--out",directory]), /locked/);
        assert.equal(await fs.readFile(lock,"utf8"),"existing process lock");
        await fs.unlink(lock); await fs.writeFile(checkpoint,"existing checkpoint");
        await assert.rejects(main(["--channel",channelID,"--out",directory]), /Checkpoint exists/);
        assert.equal(await fs.readFile(checkpoint,"utf8"),"existing checkpoint");
        assert.deepEqual(await fs.readdir(directory),[`checkpoint-${channelID}.json`]);
    } finally { await fs.rm(directory,{recursive:true,force:true}); }
});
test("50,000 mocked historical messages traverse 501 pages and retain >1,800 links", async () => {
    let requests = 0;
    const client = {get: async route => {
        const before = /&before=(\d+)/.exec(route)?.[1];
        const offset = before ? Number(upper - BigInt(before)) + 1 : 0;
        requests++;
        if (offset >= 50000) return [];
        return Array.from({length: 100}, (_, index) => {
            const absolute = offset + index;
            const item = message(upper - BigInt(absolute));
            item.content = absolute % 20 === 0 ? `https://youtu.be/V${String(absolute).padStart(10, "0")}` : "ordinary message";
            return item;
        });
    }};
    const result = await scanHistory({client, identity, recheck: async () => identity});
    assert.equal(requests, 501); assert.equal(result.collection.seen.size, 50000); assert.equal(result.collection.records.size, 2500); assert.equal(result.collection.resources.size, 2500); assert.equal(result.collection.state.status, "complete");
});
