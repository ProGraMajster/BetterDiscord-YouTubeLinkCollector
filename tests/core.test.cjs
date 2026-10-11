"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const Plugin = require("../YouTubeLinkCollector.plugin.js");
const {Collection, Persistence, LocalAdapter, collectBatch, parseYouTubeURL, extractText, extractMessage, exportData, csvCell, filename, LIMITS} = Plugin.Core;
const CHANNEL = "111111111111111111", GUILD = "222222222222222222", BASE = 333333333333333333n;
const VIDEO = "dQw4w9WgXcQ", SECOND = "abcdefghij_", LIST = "PL_test-list_123";
const selection = {channelID: CHANNEL, channelName: "muzyka", serverID: GUILD, serverName: "Serwer"};
const message = (content = `https://youtu.be/${VIDEO}`, index = 0, extra = {}) => ({id: String(BASE + BigInt(index)), channel_id: CHANNEL, content, embeds: [], author: {username: "TestUser"}, timestamp: "2026-10-09T12:00:00.000Z", ...extra});
const collection = () => { const value = new Collection(selection); value.begin(); return value; };
for (const [name, input, id, type = "video"] of [
    ["watch", `https://youtube.com/watch?v=${VIDEO}`, VIDEO],
    ["www", `https://www.youtube.com/watch?v=${VIDEO}&t=1`, VIDEO],
    ["mobile", `https://m.youtube.com/watch?feature=share&v=${VIDEO}`, VIDEO],
    ["short", `https://youtu.be/${VIDEO}?si=abc`, VIDEO],
    ["shorts", `https://youtube.com/shorts/${VIDEO}`, VIDEO],
    ["live", `https://youtube.com/live/${VIDEO}`, VIDEO],
    ["embed", `https://youtube.com/embed/${VIDEO}`, VIDEO],
    ["music", `https://music.youtube.com/watch?v=${VIDEO}&list=OTHER`, VIDEO],
    ["playlist", `https://youtube.com/playlist?list=${LIST}`, LIST, "playlist"],
    ["scheme omitted", `www.youtube.com/watch?v=${VIDEO}`, VIDEO],
    ["http case insensitive host", `http://YOUTUBE.COM/watch?v=${VIDEO}`, VIDEO],
    ["nocookie embed", `https://www.youtube-nocookie.com/embed/${VIDEO}`, VIDEO],
    ["percent encoded ID", "https://youtube.com/watch?v=%64Qw4w9WgXcQ", VIDEO],
    ["fully encoded URL", encodeURIComponent(`https://youtu.be/${VIDEO}?t=1`), VIDEO],
    ["underscore at end", `https://youtu.be/${SECOND}`, SECOND],
    ["angle and punctuation", `<https://youtu.be/${VIDEO}>.`, VIDEO]
]) test(`URL ${name}`, () => {
    const parsed = parseYouTubeURL(input);
    assert.equal(parsed?.resourceID, id); assert.equal(parsed.resourceType, type);
    assert.equal(parsed.normalizedURL, type === "video" ? `https://www.youtube.com/watch?v=${id}` : `https://www.youtube.com/playlist?list=${id}`);
});
test("preserves original query/encoding and decodes only for normalization", () => {
    const original = encodeURIComponent(`https://youtu.be/${VIDEO}?t=1&si=z`);
    assert.equal(parseYouTubeURL(original).originalURL, original);
    const query = `https://www.youtube.com/watch?x=2&v=${VIDEO}&list=${LIST}`;
    assert.equal(parseYouTubeURL(query).originalURL, query);
});
test("rejects hostile hosts, unsupported resource paths, malformed input and credentials", () => {
    for (const input of [null, 5, {}, "", "https://youtube.com.evil.test/watch?v=" + VIDEO, "https://evilyoutube.com/watch?v=" + VIDEO, "https://example.test/?u=youtube.com/watch?v=" + VIDEO, "https://user:pass@youtube.com/watch?v=" + VIDEO, "ftp://youtube.com/watch?v=" + VIDEO, "https://youtube.com:8080/watch?v=" + VIDEO, "https://youtube.com/watch?v=bad", "https://youtu.be/", "https://youtube.com/channel/UC123", "https://youtube.com/playlist?list=", "https://youtube.com/embed/%ZZ", "javascript:alert(1)", "https://youtu.be/" + "x".repeat(5000)]) assert.equal(parseYouTubeURL(input), null, String(input));
    assert.equal(extractText("ftp://youtu.be/" + VIDEO).length, 0);
    assert.equal(extractText("evil.youtube.com/watch?v=" + VIDEO).length, 0);
});
test("multiple URLs, markdown, punctuation, spoilers, schemeless and encoded links", () => {
    const input = `([film](https://youtu.be/${VIDEO})), **https://youtube.com/shorts/${SECOND}** ||https://youtube.com/playlist?list=${LIST}|| m.youtube.com/watch?v=${VIDEO} ${encodeURIComponent(`https://youtu.be/${SECOND}`)}`;
    const extracted = extractText(input);
    assert.deepEqual(extracted.map(x => x.resourceID), [VIDEO, SECOND, LIST, VIDEO, SECOND]);
});
test("URLs separated only by punctuation are extracted separately", () => {
    assert.deepEqual(extractText(`https://youtu.be/${VIDEO},https://youtu.be/${SECOND};youtube.com/playlist?list=${LIST}`).map(x => x.resourceID), [VIDEO, SECOND, LIST]);
    assert.equal(extractText(`https://youtu.be/${VIDEO}?next=https://example.test/`).length, 1);
});
test("multiple identical text occurrences are retained; previews are representations", () => {
    const content = `https://youtu.be/${VIDEO} https://youtu.be/${VIDEO}`;
    const embedded = {url: `https://youtube.com/watch?v=${VIDEO}`, video: {url: `https://youtube.com/embed/${VIDEO}`}};
    assert.equal(extractMessage({content, embeds: [embedded]}).length, 2);
    assert.equal(extractMessage({content: "", embeds: [embedded]}).length, 1);
    assert.equal(extractMessage({content: "", embeds: [embedded]}, false).length, 0);
    assert.equal(extractMessage({content: "", embeds: [{description: content}]}).length, 2);
    assert.equal(extractMessage({content: "", embeds: [null, {fields: [{value: `https://youtu.be/${SECOND}`}]}]}).length, 1);
});
test("equivalent formats group, playlists stay separate, and all sources are preserved", () => {
    const data = collection();
    data.process(message(`https://youtu.be/${VIDEO} https://youtube.com/watch?v=${VIDEO} https://youtube.com/playlist?list=${LIST}`));
    data.process(message(`https://youtube.com/shorts/${VIDEO}`, 1));
    assert.deepEqual(data.stats(), {totalOccurrences: 4, uniqueResources: 2, duplicates: 2});
    const group = data.groups().find(x => x.resourceType === "video");
    assert.equal(group.occurrenceCount, 3); assert.equal(group.originalURLs.length, 3); assert.equal(group.sourceMessages.length, 2);
    assert.equal(group.sourceMessages[0].messageURL, `https://discord.com/channels/${GUILD}/${CHANNEL}/${BASE}`);
});
test("re-reading and restoring do not duplicate occurrences or processed-message counters", () => {
    const data = collection(), repeated = message(`https://youtu.be/${VIDEO} https://youtu.be/${VIDEO}`);
    assert.equal(data.process(repeated), true); assert.equal(data.process(repeated), false);
    const restored = Collection.restore(JSON.parse(JSON.stringify(data.snapshot())));
    assert.equal(restored.state.status, "interrupted");
    restored.begin(); assert.equal(restored.process(repeated), false);
    assert.equal(restored.records.size, 2); assert.equal(restored.seen.size, 1);
});
test("missing metadata is enriched without fabricating a new occurrence", () => {
    const data = collection(); data.process(message(undefined, 0, {author: null, timestamp: null}));
    data.process(message());
    assert.equal(data.records.size, 1); assert.equal([...data.records.values()][0].author, "TestUser");
});
test("edits preserve previously observed links and add new observations", () => {
    const data = collection(); data.process(message()); data.process(message(`https://youtu.be/${SECOND}`));
    assert.equal(data.records.size, 2); assert.equal(data.seen.size, 1);
});
test("messages outside selected channel and malformed data cannot contaminate results", () => {
    const data = collection();
    for (const item of [null, {}, message(undefined, 1, {id: "wrong"}), message(undefined, 2, {channel_id: GUILD})]) assert.equal(data.process(item), false);
    const malformed = message(undefined, 3, {content: null}); data.process(malformed); data.process(malformed);
    assert.equal(data.state.progress.malformedMessages, 1); assert.equal(data.records.size, 0);
    data.process(message(undefined, 3, {timestamp: "invalid", author: {username: 99}}));
    assert.equal([...data.records.values()][0].timestamp, null); assert.equal([...data.records.values()][0].author, null);
});
test("checkpoints of messages without YouTube do not retain unrelated author/timestamp data", () => {
    const data = collection(); data.process(message("ordinary message", 0, {author: {username: "Private unrelated author"}}));
    assert.equal(data.seen.get(String(BASE)), "[]");
    assert.ok(!JSON.stringify(data.snapshot()).includes("Private unrelated author"));
});
test("switching dedup modes and filters never requires a rescan", () => {
    const data = collection(); data.process(message(`https://youtu.be/${VIDEO} https://youtu.be/${VIDEO}`));
    assert.equal(exportData(data, "txt", {mode: "unique"}).trim().split("\r\n").length, 1);
    assert.equal(exportData(data, "txt", {mode: "all"}).trim().split("\r\n").length, 2);
    assert.equal(data.records.size, 2);
});
test("TXT canonical or original, UTF-8 and empty exports", () => {
    const data = collection(); data.process(message());
    assert.equal(exportData(data, "txt"), `https://www.youtube.com/watch?v=${VIDEO}\r\n`);
    assert.equal(exportData(data, "txt", {canonicalTXT: false}), `https://youtu.be/${VIDEO}\r\n`);
    assert.equal(exportData(collection(), "txt"), "");
});
test("CSV quotes commas, double quotes and newlines and shields formulas", () => {
    assert.equal(csvCell('a,"b"\nc'), '"a,""b""\nc"');
    for (const value of ["=1+1", "+cmd", "-cmd", "@SUM(A1)", " \t=1", "\u0000=1", "\n-1"]) assert.equal(csvCell(value), `"'${value}"`);
    const data = collection(); data.process(message(undefined, 0, {author: {username: '=HYPERLINK("x")'}}));
    const csv = exportData(data, "csv", {mode: "all"});
    assert.ok(csv.startsWith("\uFEFFOriginalURL,NormalizedURL,ResourceType,ResourceID,Author,Timestamp,MessageURL,ChannelID,MessageID\r\n"));
    assert.ok(csv.includes('"\'=HYPERLINK(""x"")"'));
    assert.ok(exportData(data, "csv").includes("OccurrenceCount,SourceMessageURLs,OriginalURLs"));
});
test("JSON contains counts, scope, status, full occurrences and recoverable state", () => {
    const data = collection(); data.process(message(`https://youtu.be/${VIDEO} https://youtu.be/${VIDEO}`)); data.interrupt();
    const parsed = JSON.parse(exportData(data, "json", {exportedAt: "2026-10-09T12:00:00.000Z"}));
    assert.equal(parsed.pluginVersion, Plugin.Core.VERSION); assert.equal(parsed.totalOccurrences, 2); assert.equal(parsed.uniqueResources, 1); assert.equal(parsed.duplicates, 1);
    assert.equal(parsed.records.length, 1); assert.equal(parsed.occurrences.length, 2); assert.equal(parsed.completeness.status, "interrupted");
    const restored = Collection.restore(parsed.collection); assert.deepEqual(restored.stats(), data.stats());
});
test("filenames identify incomplete scope and sanitize filesystem characters", () => {
    const data = new Collection({...selection, channelName: 'CON/"..:muzyka?'});
    const name = filename(data, "txt", "2026-10-09T12:30:00.000Z");
    assert.ok(name.includes("INCOMPLETE")); assert.ok(!/[<>:"/\\|?*]/.test(name));
});
test("capacity stops before committing any part of an oversized message", () => {
    const data = new Collection(selection, undefined, {...LIMITS, records: 1}); data.begin();
    assert.throws(() => data.process(message(`https://youtu.be/${VIDEO} https://youtu.be/${SECOND}`)), /limit/);
    assert.equal(data.records.size, 0); assert.equal(data.seen.size, 0); assert.equal(data.state.status, "interrupted");
    assert.equal(Collection.restore(data.snapshot()).records.size, 0);
});
test("cancellation yields to the event loop and keeps only committed message checkpoints", async () => {
    const data = collection(); let cancelled = false;
    await collectBatch(data, Array.from({length: 500}, (_, index) => message(undefined, index)), {chunkSize: 10, cancelled: () => cancelled, onProgress: () => { cancelled = true; data.interrupt(); }});
    assert.equal(data.records.size, 10); assert.equal(data.state.progress.batchesProcessed, 1);
    const restored = Collection.restore(data.snapshot()); restored.begin();
    await collectBatch(restored, Array.from({length: 500}, (_, index) => message(undefined, index)));
    assert.equal(restored.records.size, 500); assert.equal(restored.state.progress.messagesProcessed, 500);
});
test("restore rejects corrupted, cross-channel, missing-checkpoint and fake-complete state", () => {
    const data = collection(); data.process(message());
    for (const mutate of [x => { x.schemaVersion = 99; }, x => { x.records[0].channelID = GUILD; }, x => { x.records[0].resourceID = SECOND; }, x => { x.records[0].ordinal = -1; }, x => { x.records.push(x.records[0]); }, x => { x.seen = []; x.progress.messagesProcessed = 0; }, x => { x.seen.push(x.seen[0]); }, x => { x.status = "complete"; x.completeness.status = "complete"; }, x => { x.progress.messagesProcessed = -1; }]) {
        const copy = JSON.parse(JSON.stringify(data.snapshot())); mutate(copy); assert.throws(() => Collection.restore(copy));
    }
});
const memoryData = () => {
    const values = new Map();
    return {values, load: key => structuredClone(values.get(key)), save: (key, value) => values.set(key, structuredClone(value)), delete: key => values.delete(key)};
};
test("dual-bank persistence restores checkpoints and falls back on corruption", () => {
    const storage = memoryData(), persistence = new Persistence(storage), data = collection();
    data.process(message()); persistence.save(data); data.process(message(undefined, 1)); persistence.save(data);
    assert.equal(new Persistence(storage).load().records.size, 2);
    storage.values.get("state-b").payload += "bad";
    const recovered = new Persistence(storage).load(); assert.equal(recovered.records.size, 1); assert.ok(recovered.state.warnings.some(x => x.includes("awaryjny")));
});
test("write failure retains previous checkpoint and both corrupt banks are protected", () => {
    const storage = memoryData(), persistence = new Persistence(storage), data = collection();
    data.process(message()); persistence.save(data);
    storage.save = (key, value) => { if (key === "checkpoint") throw new Error("disk full"); storage.values.set(key, structuredClone(value)); };
    data.process(message(undefined, 1)); assert.throws(() => persistence.save(data), /disk full/);
    assert.equal(new Persistence(storage).load().records.size, 1);
    storage.values.get("state-a").digest = "invalid"; storage.values.get("state-b").digest = "invalid";
    assert.throws(() => new Persistence(storage).load(), /bez zmian/);
});
test("explicit reset removes fallback data and persisted configuration is retained", () => {
    const storage = memoryData(), persistence = new Persistence(storage), data = collection(); data.process(message()); persistence.save(data);
    const fresh = new Collection(selection, {mode: "all", search: false}); persistence.reset(fresh);
    const restored = new Persistence(storage).load(); assert.equal(restored.records.size, 0); assert.equal(restored.state.config.mode, "all"); assert.equal(restored.state.config.search, false);
    assert.equal([...storage.values.keys()].filter(key => key.startsWith("state-")).length, 1);
});
function adapterFixture({history = [], search = [], permissions = true, storeBroken = false} = {}) {
    const stores = {SelectedChannelStore: {getChannelId: () => CHANNEL}, ChannelStore: {getChannel: () => ({id: CHANNEL, guild_id: GUILD, name: "muzyka", type: 0})}, GuildStore: {getGuild: () => ({name: "Serwer"})}, PermissionStore: {can: () => permissions}, MessageStore: {getMessages: () => storeBroken ? {} : {_array: history}, getMessage: (channel, id) => history.find(x => x.id === id && x.channel_id === channel)}, SearchMessageStore: {getMessage: (channel, id) => search.find(x => x.id === id && x.channel_id === channel)}, SearchStore: {getCurrentSearchId: () => "search", getSearchResultsOffset: () => 25}};
    const doc = {querySelectorAll: selector => selector.includes("message-content") ? search.map(x => ({id: `message-content-${x.id}`, closest: () => null})) : []};
    const adapter = new LocalAdapter({Webpack: {getStore: name => stores[name]}}, doc, {pathname: `/channels/${GUILD}/${CHANNEL}`});
    return {adapter, stores};
}
test("mocked message/search stores read only loaded selected-channel data", () => {
    const fixture = adapterFixture({history: [message()], search: [message(undefined, 1), message(undefined, 2, {channel_id: GUILD})]});
    const batch = fixture.adapter.read(selection, {search: true});
    assert.equal(batch.messages.length, 2); assert.equal(batch.searchCursor, 25); assert.ok(batch.warnings.length);
    assert.equal(fixture.adapter.read(selection, {search: false}).messages.length, 1);
});
test("permission failures, changed channels and unsupported store data fail visibly", () => {
    assert.throws(() => adapterFixture({permissions: false}).adapter.selection(), /Brak uprawnień/);
    const fixture = adapterFixture(); fixture.stores.PermissionStore = null; fixture.adapter.stores.PermissionStore = null;
    assert.throws(() => fixture.adapter.selection(), /Nie można sprawdzić/);
    assert.throws(() => adapterFixture().adapter.ensureSelected({...selection, channelID: GUILD}), /Zmieniono/);
    assert.ok(adapterFixture({storeBroken: true}).adapter.read(selection, {search: false}).warnings[0].includes("Nierozpoznany"));
});
test("DOM fallback is channel-scoped and cannot invent authors", () => {
    const content = {nodeType: 1, tagName: "DIV", childNodes: [{nodeType: 1, tagName: "A", getAttribute: () => `https://youtu.be/${VIDEO}`} ]};
    const root = {id: `chat-messages-${CHANNEL}-${BASE}`, querySelector: selector => selector.startsWith("[id=") ? content : null};
    const other = {...root, id: `chat-messages-${GUILD}-${BASE + 1n}`};
    const fixture = adapterFixture({storeBroken: true});
    fixture.adapter.document = {querySelectorAll: selector => selector.includes("chat-messages") ? [root, other] : []};
    const batch = fixture.adapter.read(selection, {search: false});
    assert.equal(batch.messages.length, 1); assert.equal(batch.messages[0].author, null); assert.equal(extractMessage(batch.messages[0]).length, 1);
});
test("large fixture: 50,000 messages, 2,000 resources, 4,000 occurrences and lossless JSON", async () => {
    const data = collection(); let yielded = 0;
    const messages = Array.from({length: 50000}, (_, index) => {
        const video = `V${String(Math.floor(index / 2)).padStart(10, "0")}`;
        return message(index < 4000 ? `https://youtu.be/${video}` : "No video", index);
    });
    await collectBatch(data, messages, {chunkSize: 200, onProgress: () => yielded++});
    assert.deepEqual(data.stats(), {totalOccurrences: 4000, uniqueResources: 2000, duplicates: 2000});
    assert.equal(data.state.progress.messagesProcessed, 50000); assert.ok(yielded >= 250);
    const exported = JSON.parse(exportData(data, "json"));
    assert.equal(Collection.restore(exported.collection).records.size, 4000);
    assert.equal(exported.uniqueResourceRecords.length, 2000);
});
