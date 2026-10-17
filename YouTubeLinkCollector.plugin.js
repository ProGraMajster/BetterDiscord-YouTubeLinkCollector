/**
 * @name YouTubeLinkCollector
 * @author ProGraMajster
 * @description Zbiera linki YouTube przez otwartą wyszukiwarkę i jej przyciski stron; checkpointy, odzyskiwanie, TXT/CSV/JSON.
 * @version 1.2.7
 */
"use strict";

// This file is both the distribution and the canonical source. No build step.
const NAME = "YouTubeLinkCollector";
const VERSION = "1.2.7";
const SCHEMA = 1;
const LIMITS = Object.freeze({records: 50000, messages: 250000, bytes: 24 * 1024 * 1024});
const DEFAULTS = Object.freeze({mode: "unique", canonicalTXT: true, embeds: true, search: true, pageDelayMinSeconds: 3, pageDelayMaxSeconds: 30, pageLoadTimeoutSeconds: 90});
const STATUSES = new Set(["idle", "running", "partial", "interrupted", "failed", "complete", "unknown"]);
const COVERAGES = new Set(["unknown", "partial", "interrupted", "failed", "complete"]);
const ID = /^[1-9]\d{16,19}$/;
const VIDEO = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST = /^[A-Za-z0-9_-]{1,256}$/;
const HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "www.youtu.be", "youtube-nocookie.com", "www.youtube-nocookie.com"]);
const now = () => new Date().toISOString();
const pause = () => new Promise(resolve => setTimeout(resolve, 0));
const byteSize = text => new TextEncoder().encode(text).length;
const str = (value, max = 256) => typeof value === "string" ? value.slice(0, max) : "";
const validId = value => typeof value === "string" && ID.test(value);
const resourceKey = record => `${record.resourceType}:${record.resourceID}`;
const recordKey = record => JSON.stringify([record.messageID, record.originalURL, record.ordinal]);
function iso(value) {
    if (value == null) return null;
    try { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toISOString() : null; }
    catch { return null; }
}
function cleanURL(raw) {
    return raw.trim().replace(/^[<\[(]+/, "").replace(/[>\]),.;:!?*|~]+$/g, "");
}
function parseYouTubeURL(raw) {
    if (typeof raw !== "string" || raw.length > 4096) return null;
    const originalURL = cleanURL(raw);
    if (!originalURL) return null;
    let url;
    try {
        const decoded = (/^https?%3a%2f%2f/i.test(originalURL) ? decodeURIComponent(originalURL) : originalURL).replace(/&amp;/gi, "&");
        url = new URL(/^[a-z][a-z\d+.-]*:/i.test(decoded) ? decoded : `https://${decoded}`);
    }
    catch { return null; }
    if (!/^https?:$/.test(url.protocol) || !HOSTS.has(url.hostname.toLowerCase()) || url.username || url.password || url.port) return null;
    let path;
    try { path = decodeURIComponent(url.pathname).replace(/\/+$/, ""); } catch { return null; }
    let resourceType = "video", resourceID = "";
    if (url.hostname.endsWith("youtu.be")) resourceID = path.slice(1);
    else if (path === "/watch") resourceID = url.searchParams.get("v") || "";
    else if (/^\/(shorts|live|embed)\/[^/]+$/.test(path)) resourceID = path.split("/")[2];
    else if (path === "/playlist") { resourceType = "playlist"; resourceID = url.searchParams.get("list") || ""; }
    else return null;
    if (!(resourceType === "video" ? VIDEO : PLAYLIST).test(resourceID)) return null;
    return {originalURL, normalizedURL: resourceType === "video" ? `https://www.youtube.com/watch?v=${resourceID}` : `https://www.youtube.com/playlist?list=${resourceID}`, resourceType, resourceID};
}
function extractText(text) {
    if (typeof text !== "string") return [];
    // Candidate discovery only. Host/path/query decisions are made by URL above.
    const candidates = /https?:\/\/[^\s<>"'`]+|https?%3a%2f%2f[^\s<>"'`]+|(?<![\w.@/:-])(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be|youtube-nocookie\.com)\/[^\s<>"'`]+/gi;
    const results = [];
    for (const match of text.matchAll(candidates)) {
        const adjacent = match[0].split(/[),;](?=\(?(?:https?:\/\/|https?%3a%2f%2f|(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)\/))/i);
        for (const candidate of adjacent) {
            const parsed = parseYouTubeURL(candidate);
            if (parsed) results.push(parsed);
        }
    }
    return results;
}
function extractMessage(message, includeEmbeds = true) {
    const content = extractText(message?.content);
    if (!includeEmbeds || !Array.isArray(message?.embeds)) return content;
    const inContent = new Set(content.map(resourceKey));
    const previewResources = new Set();
    const additional = [];
    for (const embed of message.embeds) {
        if (!embed || typeof embed !== "object") continue;
        // URL/video fields can be the same automatic preview; never count those twice.
        for (const value of [embed.url, embed.video?.url, embed.author?.url]) {
            for (const parsed of extractText(value)) {
                if (inContent.has(resourceKey(parsed)) || previewResources.has(resourceKey(parsed))) continue;
                additional.push(parsed);
                previewResources.add(resourceKey(parsed));
            }
        }
        // Authored text fields are real occurrences, including repeated URLs.
        for (const value of [embed.title, embed.description, embed.footer?.text, ...(Array.isArray(embed.fields) ? embed.fields.flatMap(field => [field?.name, field?.value]) : [])]) additional.push(...extractText(value));
    }
    return content.concat(additional);
}
function normalizeSelection(value) {
    if (!value || !validId(value.channelID) || !(value.serverID === "@me" || validId(value.serverID))) throw new Error("Nieprawidłowy kanał lub serwer.");
    return {serverID: value.serverID, serverName: str(value.serverName, 200) || value.serverID, channelID: value.channelID, channelName: str(value.channelName, 200) || value.channelID};
}
function pageDelayRange(config) {
    const min = config?.pageDelayMinSeconds ?? DEFAULTS.pageDelayMinSeconds;
    const max = config?.pageDelayMaxSeconds ?? DEFAULTS.pageDelayMaxSeconds;
    if (![min, max].every(x => Number.isSafeInteger(x) && x >= 0 && x <= 300) || min > max) throw new Error("Oczekiwanie między stronami: podaj całe sekundy od 0 do 300; minimum nie może przekraczać maksimum.");
    return {pageDelayMinSeconds: min, pageDelayMaxSeconds: max};
}
function choosePageDelay(config, random = Math.random) {
    const {pageDelayMinSeconds: min, pageDelayMaxSeconds: max} = pageDelayRange(config);
    return min + Math.floor(random() * (max - min + 1));
}
function pageLoadTimeout(config) {
    const seconds = config?.pageLoadTimeoutSeconds ?? DEFAULTS.pageLoadTimeoutSeconds;
    if (!Number.isSafeInteger(seconds) || seconds < 15 || seconds > 300) throw new Error("Limit oczekiwania na wyniki: podaj całe sekundy od 15 do 300.");
    return seconds;
}
function freshState(selection = null, config = DEFAULTS) {
    return {
        schemaVersion: SCHEMA, pluginVersion: VERSION, selection: selection ? normalizeSelection(selection) : null,
        config: {...DEFAULTS, ...config}, status: "idle", startedAt: null, updatedAt: now(),
        completeness: {status: "unknown", reason: "Nie rozpoczęto kolekcji.", evidence: null},
        checkpoint: {lastMessageID: null, searchCursor: null, before: null},
        progress: {messagesProcessed: 0, batchesProcessed: 0, malformedMessages: 0},
        searchTracking: {version: 1, activeKey: null, scopes: []},
        warnings: [], errors: [], records: [], seen: []
    };
}
function validateRecord(input, selection) {
    if (!input || !selection || !validId(input.messageID) || input.channelID !== selection.channelID || input.serverID !== selection.serverID) throw new Error("Rekord pochodzi z innego kanału lub ma nieprawidłowy identyfikator.");
    const parsed = parseYouTubeURL(input.originalURL);
    if (!parsed || parsed.normalizedURL !== input.normalizedURL || parsed.resourceID !== input.resourceID || parsed.resourceType !== input.resourceType) throw new Error("Niespójne dane linku YouTube.");
    if (!Number.isInteger(input.ordinal) || input.ordinal < 0 || input.ordinal > 100000) throw new Error("Nieprawidłowy indeks wystąpienia.");
    return {...parsed, serverID: selection.serverID, channelID: selection.channelID, messageID: input.messageID,
        messageURL: `https://discord.com/channels/${selection.serverID}/${selection.channelID}/${input.messageID}`,
        author: str(input.author) || null, timestamp: iso(input.timestamp), ordinal: input.ordinal};
}
function validateSnapshot(raw, limits = LIMITS) {
    if (!raw || raw.schemaVersion !== SCHEMA || !Array.isArray(raw.records) || !Array.isArray(raw.seen)) throw new Error("Nieobsługiwany lub uszkodzony zapis kolekcji.");
    if (raw.records.length > limits.records || raw.seen.length > limits.messages || byteSize(JSON.stringify(raw)) > limits.bytes) throw new Error("Zapis przekracza limit pamięci.");
    const state = freshState(raw.selection, raw.config);
    if (!STATUSES.has(raw.status) || !COVERAGES.has(raw.completeness?.status)) throw new Error("Nieprawidłowy status zapisu.");
    if (raw.config?.mode && !["all", "unique"].includes(raw.config.mode)) throw new Error("Nieprawidłowy tryb deduplikacji.");
    state.config = {mode: raw.config?.mode || DEFAULTS.mode, canonicalTXT: raw.config?.canonicalTXT !== false, embeds: raw.config?.embeds !== false, search: raw.config?.search !== false, ...pageDelayRange(raw.config), pageLoadTimeoutSeconds: pageLoadTimeout(raw.config)};
    state.status = raw.status;
    state.startedAt = iso(raw.startedAt);
    state.updatedAt = iso(raw.updatedAt) || now();
    state.records = raw.records.map(record => validateRecord(record, state.selection));
    const keys = new Set(state.records.map(recordKey));
    if (keys.size !== state.records.length) throw new Error("Powtórzone identyfikatory wystąpień w zapisie.");
    const seenIDs = new Set();
    state.seen = raw.seen.map(entry => {
        if (!Array.isArray(entry) || !validId(entry[0]) || typeof entry[1] !== "string" || entry[1].length > 32768 || seenIDs.has(entry[0])) throw new Error("Uszkodzony punkt wznowienia.");
        seenIDs.add(entry[0]); return [entry[0], entry[1]];
    });
    for (const field of Object.keys(state.progress)) {
        const value = raw.progress?.[field];
        if (!Number.isSafeInteger(value) || value < 0) throw new Error("Uszkodzone liczniki.");
        state.progress[field] = value;
    }
    if (state.progress.messagesProcessed !== state.seen.length) throw new Error("Licznik wiadomości nie odpowiada punktom wznowienia.");
    if (state.records.some(record => !seenIDs.has(record.messageID))) throw new Error("Brakuje punktu wznowienia dla rekordu.");
    for (const field of ["lastMessageID", "before"]) {
        const value = raw.checkpoint?.[field];
        if (value != null && !validId(value)) throw new Error("Nieprawidłowy kursor.");
        state.checkpoint[field] = value || null;
    }
    state.checkpoint.searchCursor = Number.isSafeInteger(raw.checkpoint?.searchCursor) && raw.checkpoint.searchCursor >= 0 ? raw.checkpoint.searchCursor : null;
    if (raw.checkpoint?.runMode != null) {
        if (!["auto", "local"].includes(raw.checkpoint.runMode)) throw new Error("Nieprawidłowy tryb wznowienia.");
        state.checkpoint.runMode = raw.checkpoint.runMode;
    }
    if (raw.checkpoint?.exportFormat != null) {
        if (!["txt", "csv", "json"].includes(raw.checkpoint.exportFormat)) throw new Error("Nieprawidłowy format wznowienia.");
        state.checkpoint.exportFormat = raw.checkpoint.exportFormat;
    }
    state.completeness = {status: raw.completeness.status, reason: str(raw.completeness.reason, 1000), evidence: raw.completeness.evidence || null};
    state.warnings = Array.isArray(raw.warnings) ? raw.warnings.slice(-20).map(x => str(x, 1000)) : [];
    state.errors = Array.isArray(raw.errors) ? raw.errors.slice(-20).map(x => str(x, 1000)) : [];
    state.searchTracking = SearchTracker.validate(raw.searchTracking, state.selection);
    if (state.status === "complete" || state.completeness.status === "complete") {
        // Only the official bot can establish traversal evidence. Imports remain declarations.
        const e = state.completeness.evidence;
        if (e?.method !== "official-bot-history" || e.reachedEnd !== true || e.permissionsChecked !== true || e.messageContentEnabled !== true || !iso(e.finishedAt) || !(e.snapshotUpperMessageID === null || validId(e.snapshotUpperMessageID))) throw new Error("Brak dowodów zakończenia historii.");
    }
    return state;
}
class Collection {
    constructor(selection = null, config = DEFAULTS, limits = LIMITS) {
        this.state = freshState(selection, config); this.limits = limits;
        this.records = new Map(); this.seen = new Map(); this.resources = new Map();
        this.estimatedBytes = 65536; this.revision = 0; this.invalidMessages = new Set();
        this.trackingBytes = byteSize(JSON.stringify(this.state.searchTracking));
    }
    static restore(raw, limits = LIMITS) {
        const state = validateSnapshot(raw, limits);
        const collection = new Collection(state.selection, state.config, limits);
        collection.state = state;
        collection.seen = new Map(state.seen);
        for (const record of state.records) collection._insert(record);
        collection.estimatedBytes = byteSize(JSON.stringify(state)) + 65536;
        collection.trackingBytes = byteSize(JSON.stringify(state.searchTracking));
        collection.state.records = []; collection.state.seen = [];
        if (state.status === "running") collection.interrupt("Kolekcja przerwana przez zamknięcie klienta. Wznów lokalny odczyt; historia nie jest automatycznie odtwarzana.");
        return collection;
    }
    _insert(record) {
        this.records.set(recordKey(record), record);
        const key = resourceKey(record);
        if (!this.resources.has(key)) this.resources.set(key, []);
        this.resources.get(key).push(record);
        this.revision++;
    }
    warn(message) {
        if (!this.state.warnings.includes(message)) this.state.warnings = [...this.state.warnings, message].slice(-20);
    }
    begin() {
        if (!this.state.selection) throw new Error("Najpierw wybierz otwarty kanał.");
        this.state.status = "running"; this.state.startedAt ||= now(); this.state.updatedAt = now();
        this.state.completeness = {status: "partial", reason: "Odczyt wyłącznie załadowanych wiadomości i widocznych wyników. Pełna historia nie została potwierdzona.", evidence: null};
    }
    interrupt(reason = "Zatrzymano przez użytkownika. Zebrane dane zachowano.") {
        this.state.status = "interrupted"; this.state.updatedAt = now();
        this.state.completeness = {status: "interrupted", reason, evidence: null};
    }
    fail(error) {
        this.state.status = "failed"; this.state.updatedAt = now();
        const message = str(error?.message || String(error), 1000);
        this.state.errors = [...this.state.errors, message].slice(-20);
        this.state.completeness = {status: "failed", reason: message, evidence: null};
    }
    process(message) {
        const selection = this.state.selection;
        if (!selection || !message || !validId(message.id) || message.channel_id !== selection.channelID) return false;
        if (typeof message.content !== "string" || (message.embeds != null && !Array.isArray(message.embeds))) {
            if (!this.invalidMessages.has(message.id)) {
                if (this.invalidMessages.size < this.limits.messages) this.invalidMessages.add(message.id);
                this.state.progress.malformedMessages++;
            }
            this.warn("Pominięto wiadomość o nieprawidłowej strukturze; kompletność nie jest potwierdzona."); return false;
        }
        const links = extractMessage(message, this.state.config.embeds);
        const author = str(message.author?.username) || null, timestamp = iso(message.timestamp);
        const fingerprint = links.length ? JSON.stringify([links.map(x => x.originalURL), author, timestamp]) : "[]";
        if (this.seen.get(message.id) === fingerprint) return false;
        const ordinals = new Map();
        const additions = [], enrichments = [];
        for (const link of links) {
            const ordinal = ordinals.get(link.originalURL) || 0;
            ordinals.set(link.originalURL, ordinal + 1);
            const record = {...link, serverID: selection.serverID, channelID: selection.channelID, messageID: message.id,
                messageURL: `https://discord.com/channels/${selection.serverID}/${selection.channelID}/${message.id}`, author, timestamp, ordinal};
            const previous = this.records.get(recordKey(record));
            if (!previous) additions.push(record);
            else if ((!previous.author && author) || (!previous.timestamp && timestamp)) enrichments.push([previous, record]);
        }
        const newMessage = !this.seen.has(message.id);
        const addedBytes = additions.reduce((sum, record) => sum + byteSize(JSON.stringify(record)) + 8, 0)
            + enrichments.reduce((sum, [previous, record]) => sum + Math.max(0, byteSize(JSON.stringify({...previous, author: previous.author || record.author, timestamp: previous.timestamp || record.timestamp})) - byteSize(JSON.stringify(previous))), 0)
            + (newMessage ? byteSize(JSON.stringify([message.id, fingerprint])) + 8 : Math.max(0, byteSize(fingerprint) - byteSize(this.seen.get(message.id))));
        if (this.records.size + additions.length > this.limits.records || this.seen.size + Number(newMessage) > this.limits.messages || this.estimatedBytes + addedBytes > this.limits.bytes || fingerprint.length > 32768) {
            this.interrupt("Osiągnięto limit pamięci. Wyeksportuj JSON i rozpocznij nową kolekcję; ostatnia wiadomość nie została zatwierdzona.");
            throw new Error(this.state.completeness.reason);
        }
        // Commit records and the message checkpoint together. No partial message commits.
        for (const record of additions) this._insert(record);
        for (const [previous, record] of enrichments) { previous.author ||= record.author; previous.timestamp ||= record.timestamp; this.revision++; }
        this.seen.set(message.id, fingerprint);
        this.estimatedBytes += addedBytes;
        this.state.progress.messagesProcessed = this.seen.size;
        this.state.checkpoint.lastMessageID = message.id; this.state.updatedAt = now();
        return true;
    }
    stats() { return {totalOccurrences: this.records.size, uniqueResources: this.resources.size, duplicates: this.records.size - this.resources.size}; }
    snapshot() { return {...this.state, records: [...this.records.values()], seen: [...this.seen.entries()]}; }
    groups() {
        return [...this.resources.values()].map(records => ({...records[0], occurrenceCount: records.length,
            originalURLs: [...new Set(records.map(x => x.originalURL))],
            sourceMessages: [...new Map(records.map(x => [x.messageID, {messageID: x.messageID, messageURL: x.messageURL, channelID: x.channelID, serverID: x.serverID, author: x.author, timestamp: x.timestamp}])).values()]}));
    }
}
async function collectBatch(collection, messages, {cancelled = () => false, onProgress = () => {}, chunkSize = 100} = {}) {
    let changed = false, inspected = 0;
    for (const message of messages) {
        if (cancelled() || collection.state.status !== "running") break;
        const messageChanged = collection.process(message);
        if (messageChanged && !changed) collection.state.progress.batchesProcessed++;
        changed = messageChanged || changed;
        if (++inspected % chunkSize === 0) { onProgress(); await pause(); }
    }
    onProgress(); return changed;
}
function csvCell(value) {
    let text = value == null ? "" : String(value);
    // Spreadsheet engines may skip whitespace/control chars before a formula.
    if (/^[\s\u0000-\u001f\u007f]*[=+\-@]/u.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
}
function exportData(collection, format, {mode = collection.state.config.mode, canonicalTXT = collection.state.config.canonicalTXT, exportedAt = now()} = {}) {
    if (!["all", "unique"].includes(mode)) throw new Error("Nieprawidłowy tryb eksportu.");
    const records = mode === "unique" ? collection.groups() : [...collection.records.values()];
    if (format === "txt") return records.map(x => canonicalTXT ? x.normalizedURL : x.originalURL).join("\r\n") + (records.length ? "\r\n" : "");
    if (format === "csv") {
        const columns = ["OriginalURL", "NormalizedURL", "ResourceType", "ResourceID", "Author", "Timestamp", "MessageURL", "ChannelID", "MessageID"];
        if (mode === "unique") columns.push("OccurrenceCount", "SourceMessageURLs", "OriginalURLs");
        const rows = records.map(record => {
            const values = [record.originalURL, record.normalizedURL, record.resourceType, record.resourceID, record.author, record.timestamp, record.messageURL, record.channelID, record.messageID];
            if (mode === "unique") values.push(record.occurrenceCount, JSON.stringify(record.sourceMessages.map(x => x.messageURL)), JSON.stringify(record.originalURLs));
            return values.map(csvCell).join(",");
        });
        return "\uFEFF" + [columns.join(","), ...rows].join("\r\n") + "\r\n";
    }
    if (format !== "json") throw new Error("Nieobsługiwany format eksportu.");
    const payload = {schemaVersion: SCHEMA, pluginVersion: VERSION, exportedAt, mode,
        selectedServer: collection.state.selection ? {id: collection.state.selection.serverID, name: collection.state.selection.serverName} : null,
        selectedChannel: collection.state.selection ? {id: collection.state.selection.channelID, name: collection.state.selection.channelName} : null,
        scanStatus: collection.state.status, completeness: collection.state.completeness, ...collection.stats(),
        progress: collection.state.progress, searchTracking: collection.state.searchTracking, checkpoint: collection.state.checkpoint, warnings: collection.state.warnings, errors: collection.state.errors,
        records, occurrences: [...collection.records.values()], uniqueResourceRecords: collection.groups(),
        // Lossless round trip, including the seen-message checkpoint. No unrelated message text.
        collection: collection.snapshot()};
    const compact = JSON.stringify(payload);
    // Keep large round-trip files bounded; small exports remain human-readable.
    return byteSize(compact) > 16 * 1024 * 1024 ? compact : JSON.stringify(payload, null, 2);
}
function filename(collection, format, date = now()) {
    const channel = (collection.state.selection?.channelName || "kanal").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/g, "").slice(0, 70) || "kanal";
    const stamp = date.replace(/[:.]/g, "-");
    return `youtube-${channel}-${stamp}-${collection.state.completeness.status === "complete" ? "COMPLETE" : "INCOMPLETE"}.${format}`;
}
function digest(text) {
    let result = 2166136261;
    for (let index = 0; index < text.length; index++) result = Math.imul(result ^ text.charCodeAt(index), 16777619);
    return (result >>> 0).toString(16);
}
async function writeExportFile(fs, target, text) {
    if (typeof fs?.open !== "function") throw new Error("Brak API fs.open; wymagany adapter filesystemu.");
    const temporary = `${target}.ytlc-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`;
    let created = false, handle;
    try {
        handle = await fs.open(temporary, "wx", 0o600); created = true;
        await handle.writeFile(text, "utf8"); await handle.sync(); await handle.close(); handle = null;
        await fs.rename(temporary, target);
    } catch (error) {
        if (handle) await handle.close().catch(() => {});
        if (created) await fs.unlink(temporary).catch(() => {});
        throw error;
    }
}
function fileCapabilities(fs) {
    const has = (object, names) => names.every(name => typeof object?.[name] === "function");
    return {
        promiseWrite: has(fs?.promises, ["open", "rename", "unlink"]),
        callbackWrite: has(fs, ["writeFile", "readFile", "rename", "unlink"]),
        promiseRead: has(fs?.promises, ["stat", "readFile"]),
        callbackRead: has(fs, ["stat", "readFile"])
    };
}
function callbackFile(fs, method, ...args) {
    return new Promise((resolve, reject) => {
        try { fs[method](...args, (error, value) => error ? reject(error) : resolve(value)); }
        catch (error) { reject(error); }
    });
}
async function writeCompatibleFile(fs, target, text) {
    const caps = fileCapabilities(fs);
    if (caps.promiseWrite) return writeExportFile(fs.promises, target, text);
    if (!caps.callbackWrite) throw new Error("Filesystem nie obsługuje bezpiecznego zapisu eksportu.");
    // BetterDiscord's fs is a callback polyfill, without promises/open/FileHandle.
    const temporary = `${target}.ytlc-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`;
    let created = false;
    try {
        try { await callbackFile(fs, "writeFile", temporary, text, {encoding: "utf8", flag: "wx", mode: 0o600}); created = true; }
        catch (error) { if (error.code !== "EEXIST") await callbackFile(fs, "unlink", temporary).catch(() => {}); throw error; }
        if (await callbackFile(fs, "readFile", temporary, "utf8") !== text) throw new Error("Odczyt kontrolny eksportu jest niezgodny.");
        await callbackFile(fs, "rename", temporary, target); created = false;
        if (await callbackFile(fs, "readFile", target, "utf8") !== text) throw new Error("Nie potwierdzono zawartości pliku docelowego.");
    } catch (error) {
        if (created) await callbackFile(fs, "unlink", temporary).catch(() => {});
        throw error;
    }
}
async function readCompatibleFile(fs, path) {
    const caps = fileCapabilities(fs), maximum = 256 * 1024 * 1024;
    if (!caps.promiseRead && !caps.callbackRead) throw new Error("Filesystem nie obsługuje odczytu JSON.");
    const stat = caps.promiseRead ? await fs.promises.stat(path) : await callbackFile(fs, "stat", path);
    if (!Number.isSafeInteger(stat?.size) || stat.size < 0 || stat.size > maximum) throw new Error("Nieprawidłowy rozmiar pliku lub plik przekracza 256 MiB.");
    const text = caps.promiseRead ? await fs.promises.readFile(path, "utf8") : await callbackFile(fs, "readFile", path, "utf8");
    if (typeof text !== "string" || byteSize(text) > maximum) throw new Error("Nieprawidłowa zawartość JSON lub plik przekracza 256 MiB.");
    return text;
}
function dialogPath(result, mode) {
    if (result == null || result.cancelled || result.canceled) return null;
    const path = typeof result === "string" ? result : mode === "save" ? result.filePath : result.filePaths?.[0];
    if (typeof path !== "string" || !path) throw new Error("Dialog zwrócił nierozpoznany wynik; plik nie został wybrany.");
    return path;
}
class ExportIO {
    constructor({ui, fs, download, clipboard, cancelled}) { Object.assign(this, {ui, fs, download, clipboard, cancelled}); }
    async save(text, name, format) {
        const caps = fileCapabilities(this.fs);
        if (typeof this.ui?.openDialog === "function" && (caps.promiseWrite || caps.callbackWrite)) {
            let path;
            try { path = dialogPath(await this.ui.openDialog({mode: "save", title: "Eksport linków YouTube", defaultPath: name, filters: [{name: format.toUpperCase(), extensions: [format]}], showOverwriteConfirmation: true}), "save"); }
            catch (error) { this.dialogError = error.message; }
            if (!this.dialogError) {
                if (!path || this.cancelled?.()) return "cancelled";
                await writeCompatibleFile(this.fs, path, text); return "saved";
            }
        }
        if (this.cancelled?.()) return "cancelled";
        try { if (await this.download?.(text, name, format)) return "download"; } catch (error) { this.fallbackError = error.message; }
        try { if (await this.clipboard?.(text)) return "copied"; } catch (error) { this.fallbackError = error.message; }
        return "manual";
    }
}
function protectEmptyConfig(api, fs) {
    const folder = api.Plugins?.folder;
    if (typeof folder !== "string" || typeof fs?.existsSync !== "function" || typeof fs?.readFileSync !== "function") return false;
    const target = `${folder.replace(/[\\/]+$/, "")}/${NAME}.config.json`;
    if (!fs.existsSync(target)) return true;
    try {
        if (typeof fs.statSync === "function" && fs.statSync(target).size > 256 * 1024 * 1024) throw new Error("Plik konfiguracji przekracza 256 MiB.");
        const raw = JSON.parse(String(fs.readFileSync(target, "utf8")).replace(/^\uFEFF/, ""));
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Nieprawidłowa struktura konfiguracji.");
        if (["checkpoint", "state-a", "state-b"].some(key => Object.hasOwn(raw, key))) throw new Error("BdApi.Data nie zwrócił checkpointów obecnych na dysku.");
        return true;
    } catch (error) { throw new Error(`Chroniono istniejący plik ${NAME}.config.json: ${error.message} Zamknij Discord i przywróć kopię konfiguracji. Nie nadpisano danych.`); }
}
class Persistence {
    constructor(data, limits = LIMITS) { this.data = data; this.limits = limits; this.slot = "b"; this.generation = 0; this.recovery = []; }
    readBank(envelope) {
        if (envelope?.schemaVersion !== SCHEMA || !Number.isSafeInteger(envelope.generation) || envelope.generation < 1 || typeof envelope.payload !== "string" || byteSize(envelope.payload) > this.limits.bytes || digest(envelope.payload) !== envelope.digest) throw new Error("Uszkodzona suma kontrolna zapisu.");
        return Collection.restore(JSON.parse(envelope.payload), this.limits);
    }
    inspect() {
        const candidates = [], errors = [];
        const add = (name, envelope, slot = null) => {
            if (envelope == null) return;
            try { const c = this.readBank(envelope), raw = JSON.parse(envelope.payload); candidates.push({name, slot, generation: envelope.generation, version: raw.pluginVersion, updatedAt: raw.updatedAt, selection: c.state.selection, ...c.stats(), envelope}); }
            catch (error) { errors.push(name + ": " + error.message); }
        };
        for (const slot of ["a", "b"]) add("state-" + slot, this.data.load("state-" + slot), slot);
        for (const key of ["legacy-1.0.0", "legacy-1.1.0", "recovery-safety"]) {
            const copy = this.data.load(key); if (copy == null) continue;
            try {
                if (typeof copy.payload !== "string" || byteSize(copy.payload) > 2 * this.limits.bytes + 65536 || digest(copy.payload) !== copy.digest) throw new Error("Uszkodzona kopia bezpieczeństwa.");
                const raw = JSON.parse(copy.payload);
                for (const slot of ["a", "b"]) add(key + "/state-" + slot, raw["state-" + slot]);
            } catch (error) { errors.push(key + ": " + error.message); }
        }
        this.recovery = candidates; this.recoveryErrors = errors; return candidates;
    }
    load() {
        const pointer = this.data.load("checkpoint"), candidates = this.inspect(), banks = candidates.filter(x => x.slot);
        const committed = banks.find(x => x.slot === pointer?.slot && x.generation === pointer?.generation);
        const best = committed || [...banks].sort((a,b) => b.generation - a.generation)[0] || [...candidates].sort((a,b) => b.totalOccurrences - a.totalOccurrences)[0];
        if (!best) {
            if (this.recoveryErrors.length || pointer != null) throw new Error("Nie można odtworzyć kolekcji. Zapisy pozostawiono bez zmian. Przywróć eksport JSON lub świadomie zresetuj dane.");
            return null;
        }
        this.slot = best.slot || pointer?.slot || "b"; this.generation = Math.max(0, ...banks.map(x => x.generation));
        this.loadedRecords = best.totalOccurrences;
        const collection = this.readBank(best.envelope);
        if (this.recoveryErrors.length || !committed) collection.warn("Odtworzono awaryjny punkt zapisu. Ostatnie zmiany mogły nie zostać zapisane.");
        const larger = candidates.filter(x => x.selection?.channelID === best.selection?.channelID && x.totalOccurrences > best.totalOccurrences);
        if (larger.length) collection.warn("Istnieje większy zapis tego kanału (" + Math.max(...larger.map(x => x.totalOccurrences)) + " wystąpień). Sprawdź Odzyskiwanie danych przed dalszym zbieraniem.");
        if (["1.0.0", "1.1.0"].includes(best.version)) { this.migrationVersion = best.version; this.legacy = this.rawBanks(); }
        if (banks.some(x => x !== best && (x.totalOccurrences > best.totalOccurrences || x.selection?.channelID !== best.selection?.channelID && x.totalOccurrences))) this.safety = this.rawBanks();
        return collection;
    }
    rawBanks() { return {checkpoint: this.data.load("checkpoint"), "state-a": this.data.load("state-a"), "state-b": this.data.load("state-b")}; }
    preserve(key, raw) {
        const payload = JSON.stringify(raw), previous = this.data.load(key);
        if (byteSize(payload) > 2 * this.limits.bytes + 65536) throw new Error("Kopia checkpointów przekracza limit pamięci. Zachowano banki; wyeksportuj dane przed aktualizacją zapisu.");
        if (previous != null) {
            if (typeof previous.payload !== "string" || digest(previous.payload) !== previous.digest) throw new Error("Uszkodzona kopia migracyjna; zachowano checkpointy.");
            if (key === "recovery-safety" && previous.payload !== payload) {
                // A fixed bounded archive must never silently replace an older rescue copy.
                const old = JSON.parse(previous.payload);
                const retained = new Set([old["state-a"]?.payload, old["state-b"]?.payload]);
                for (const e of [raw["state-a"],raw["state-b"]]) if (e && !retained.has(e.payload)) throw new Error("Kopia odzyskiwania już zawiera inne dane. Wyeksportuj dostępne zapisy przed zastąpieniem kolekcji.");
            }
            return;
        }
        this.data.save(key, {digest: digest(payload), payload});
        const check = this.data.load(key);
        if (check?.payload !== payload || check?.digest !== digest(payload)) throw new Error("Nie potwierdzono kopii migracyjnej " + (this.migrationVersion || "odzyskiwania") + "; oryginalne banki zachowano.");
    }
    save(collection, {allowReplace = false} = {}) {
        const banks = this.rawBanks();
        if (!allowReplace && collection.records.size === 0 && [banks["state-a"],banks["state-b"]].some(e => { try { return this.readBank(e).records.size > 0; } catch { return false; } })) throw new Error("Pusta kolekcja nie może nadpisać poprawnego checkpointu. Użyj jawnego Reset po wykonaniu kopii.");
        // Backup happens before any bank rotation, including upgrades from 1.1.0.
        if (this.legacy) { this.preserve("legacy-" + this.migrationVersion, this.legacy); this.legacy = null; }
        if (this.safety) { this.preserve("recovery-safety", this.safety); this.safety = null; }
        const payload = JSON.stringify(collection.snapshot());
        if (byteSize(payload) > this.limits.bytes) throw new Error("Zapis przekracza limit 24 MiB. Eksportuj dane przed resetem.");
        const slot = this.slot === "a" ? "b" : "a", generation = this.generation + 1;
        const envelope = {schemaVersion: SCHEMA, generation, digest: digest(payload), payload};
        this.data.save("state-" + slot, envelope);
        const check = this.data.load("state-" + slot);
        if (check?.digest !== envelope.digest || check?.payload !== payload) throw new Error("BetterDiscord nie potwierdził zapisu danych.");
        this.data.save("checkpoint", {slot, generation});
        const pointer = this.data.load("checkpoint");
        if (pointer?.slot !== slot || pointer.generation !== generation) throw new Error("BetterDiscord nie potwierdził punktu wznowienia.");
        this.slot = slot; this.generation = generation; this.loadedRecords = collection.records.size;
    }
    restoreCandidate(name) {
        const candidate = this.inspect().find(x => x.name === name);
        if (!candidate) throw new Error("Wybrany zapis nie jest już dostępny lub jest uszkodzony.");
        return this.readBank(candidate.envelope);
    }
    reset(collection, {eraseLegacy = false} = {}) {
        // Called only after explicit replacement confirmation; keep old banks in a verified copy.
        this.save(collection, {allowReplace: true});
        this.data.delete(this.slot === "a" ? "state-b" : "state-a");
        if (eraseLegacy) for (const key of ["legacy-1.0.0", "legacy-1.1.0", "recovery-safety"]) this.data.delete(key);
        this.recovery = this.inspect();
    }
}
function stableContext(value, depth = 0) {
    if (depth > 5) throw new Error("Nierozpoznana struktura filtrów wyszukiwania.");
    if (value == null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return value;
    if (typeof value === "string") return str(value, 2000);
    if (Array.isArray(value) && value.length <= 100) return value.map(x => stableContext(x, depth + 1));
    // Plain React data can come from another JavaScript realm. Class instances
    // and accessor properties remain unsupported.
    const proto = value && typeof value === "object" ? Object.getPrototypeOf(value) : undefined;
    const plain = proto === null || proto && Object.getPrototypeOf(proto) === null && Object.hasOwn(proto, "hasOwnProperty");
    if (plain && Object.keys(value).length <= 50 && Object.values(Object.getOwnPropertyDescriptors(value)).every(d => Object.hasOwn(d, "value"))) {
        return Object.fromEntries(Object.keys(value).sort().filter(key => !["offset", "limit", "page"].includes(key)).map(key => [key, stableContext(value[key], depth + 1)]));
    }
    throw new Error("Nie można rozpoznać filtrów wyszukiwania; użyj własnego opisu zakresu.");
}
function searchScope(selection, query, filters, sort, searchID = null) {
    const context = {channelID: selection.channelID, serverID: selection.serverID, searchID: str(String(searchID ?? "")), query: str(query, 2000), filters: stableContext(filters || {}), sort: str(sort, 200) || "nieznane"};
    const key = JSON.stringify(stableContext(context));
    if (key.length > 12000) throw new Error("Zakres wyszukiwania jest zbyt duży.");
    return {key, context};
}
class SearchTracker {
    constructor(collection) { this.collection = collection; this.state = collection.state.searchTracking; }
    static validate(raw, selection = null) {
        if (raw == null) return {version: 1, activeKey: null, scopes: []}; // Additive 1.0.0 migration.
        if (raw.version !== 1 || !Array.isArray(raw.scopes) || raw.scopes.length > 64 || byteSize(JSON.stringify(raw)) > 4 * 1024 * 1024) throw new Error("Uszkodzony lub zbyt duży postęp wyszukiwania.");
        const keys = new Set(); let count = 0;
        for (const scope of raw.scopes) {
            if (!scope || typeof scope.key !== "string" || scope.key.length > 12000 || keys.has(scope.key) || !scope.context || !Array.isArray(scope.pages)) throw new Error("Uszkodzony zakres wyszukiwania.");
            if (typeof scope.context.query !== "string" || typeof scope.context.sort !== "string" || !scope.context.filters || typeof scope.context.filters !== "object" || !validId(scope.context.channelID) || !(scope.context.serverID === "@me" || validId(scope.context.serverID)) || selection && (scope.context.channelID !== selection.channelID || scope.context.serverID !== selection.serverID)) throw new Error("Zakres wyszukiwania ma nieprawidłowy kanał lub kontekst.");
            keys.add(scope.key);
            if (JSON.stringify(stableContext(scope.context)) !== scope.key) throw new Error("Niespójny zakres wyszukiwania.");
            const pages = new Set();
            for (const page of scope.pages) {
                if (++count > 8000 || typeof page.key !== "string" || page.key.length > 40 || pages.has(page.key) || !["observed", "visible-only", "processed", "recheck", "timeout"].includes(page.status) || !(page.number === null || Number.isSafeInteger(page.number) && page.number > 0 && page.number <= 100000) || typeof page.signature !== "string" || page.signature.length > 6000 || !Number.isSafeInteger(page.messageCount) || page.messageCount < 0 || page.messageCount > 250 || !iso(page.observedAt) || (page.processedAt != null && !iso(page.processedAt))) throw new Error("Uszkodzony odczyt strony.");
                pages.add(page.key);
                const ids = page.signature ? page.signature.split(",") : [];
                if (ids.length !== page.messageCount || ids.some(id => !validId(id)) || new Set(ids).size !== ids.length || page.status === "processed" && !iso(page.processedAt)) throw new Error("Niespójny podpis odczytu strony.");
                if (page.excludedIDs != null && (!Array.isArray(page.excludedIDs) || page.excludedIDs.length > 250 || new Set(page.excludedIDs).size !== page.excludedIDs.length || page.excludedIDs.some(id => !validId(id) || !ids.includes(id)))) throw new Error("Niespójne wyniki spoza wybranego kanału.");
            }
            if (!(scope.reportedTotal === null || Number.isSafeInteger(scope.reportedTotal) && scope.reportedTotal >= 0) || !(scope.totalPages === null || Number.isSafeInteger(scope.totalPages) && scope.totalPages > 0 && scope.totalPages <= 100000) || !(scope.currentPage === null || Number.isSafeInteger(scope.currentPage) && scope.currentPage > 0 && scope.currentPage <= 100000)) throw new Error("Uszkodzone liczniki wyszukiwania.");
            if (scope.navigation != null) {
                const n = scope.navigation;
                if (!["reading","waiting","finished","interrupted"].includes(n.phase) || !Number.isSafeInteger(n.fromPage) || n.fromPage < 1 || n.fromPage > 100000 || !(n.expectedPage === null || Number.isSafeInteger(n.expectedPage) && n.expectedPage > 0 && n.expectedPage <= 100000) || ![null,"prev","next"].includes(n.direction) || !iso(n.updatedAt)) throw new Error("Uszkodzony checkpoint nawigacji.");
            }
        }
        if (raw.activeKey !== null && !keys.has(raw.activeKey)) throw new Error("Brak aktywnego zakresu wyszukiwania.");
        return JSON.parse(JSON.stringify(raw));
    }
    active() { return this.state.scopes.find(x => x.key === this.state.activeKey) || null; }
    budget(before) {
        const bytes = byteSize(JSON.stringify(this.state)), delta = bytes - this.collection.trackingBytes;
        if (bytes > 4 * 1024 * 1024 || this.collection.estimatedBytes + delta > this.collection.limits.bytes) {
            this.state = JSON.parse(before); this.collection.state.searchTracking = this.state;
            this.collection.interrupt("Limit pamięci historii stron. Rekordy zachowano; eksportuj JSON.");
            throw new Error(this.collection.state.completeness.reason);
        }
        this.collection.estimatedBytes += delta; this.collection.trackingBytes = bytes;
    }
    observe(search) {
        if (!search?.scope || !search.pageKey) return null;
        const before = JSON.stringify(this.state);
        let scope = this.state.scopes.find(x => x.key === search.scope.key);
        if (!scope) {
            if (this.state.scopes.length >= 64) throw new Error("Limit 64 zakresów wyszukiwania. Wyeksportuj dane.");
            scope = {...search.scope, reportedTotal: null, totalPages: null, currentPage: null, pages: [], updatedAt: now()}; this.state.scopes.push(scope);
        }
        this.state.activeKey = scope.key;
        if (search.reportedTotal != null && scope.reportedTotal != null && search.reportedTotal !== scope.reportedTotal) for (const page of scope.pages) if (page.status === "processed") page.status = "recheck";
        scope.reportedTotal = search.reportedTotal ?? scope.reportedTotal;
        scope.totalPages = search.totalPages ?? scope.totalPages;
        if (scope.currentPage !== search.pageNumber) scope.updatedAt = now();
        scope.currentPage = search.pageNumber;
        let page = scope.pages.find(x => x.key === search.pageKey);
        if (!page) {
            if (this.state.scopes.reduce((sum, x) => sum + x.pages.length, 0) >= 8000 || byteSize(JSON.stringify(this.state)) > 3.8 * 1024 * 1024) throw new Error("Limit historii stron. Wyeksportuj JSON.");
            page = {key: search.pageKey, number: search.pageNumber, status: "observed", signature: "", messageCount: 0, observedAt: now(), processedAt: null, source: search.source}; scope.pages.push(page);
        }
        if (!search.loaded && page.status === "processed") page.status = "recheck";
        if (page.number === null && search.pageNumber !== null) page.number = search.pageNumber;
        else if (page.number !== null && search.pageNumber !== null && page.number !== search.pageNumber) {
            page.status = "recheck";
            this.collection.warn("Numer strony nie zgadza się z zapisanym offsetem. Poczekaj na prawidłowy stan paginacji; odczytu nie zaliczono.");
        }
        this.budget(before);
        return page;
    }
    commit(search, manuallyConfirmed = false) {
        const before = JSON.stringify(this.state);
        try { return this.commitPage(search, manuallyConfirmed); }
        finally { this.budget(before); }
    }
    commitPage(search, manuallyConfirmed = false) {
        const page = this.observe(search);
        if (!page || !search.loaded || search.messages.length > 250) return false;
        if (search.pageNumber !== null && page.number !== search.pageNumber) return false;
        const excluded = search.excludedMessages || [];
        if (excluded.some(x => !validId(x.id) || !validId(x.channel_id) || x.channel_id === this.collection.state.selection.channelID) || search.messages.length + excluded.length > 250) { page.status = "recheck"; return false; }
        const ids = [...new Set([...search.messages, ...excluded].map(x => x.id))].sort();
        if (ids.length !== search.messages.length + excluded.length) { page.status = "recheck"; return false; }
        if (search.messages.some(message => {
            if (message.channel_id !== this.collection.state.selection.channelID || typeof message.content !== "string" || message.embeds != null && !Array.isArray(message.embeds)) return true;
            const links = extractMessage(message, this.collection.state.config.embeds);
            const fingerprint = links.length ? JSON.stringify([links.map(x => x.originalURL), str(message.author?.username) || null, iso(message.timestamp)]) : "[]";
            return this.collection.seen.get(message.id) !== fingerprint;
        })) { page.status = "recheck"; return false; }
        const signature = ids.join(",");
        const scope = this.active();
        if (!manuallyConfirmed && scope.pages.some(x => x.key !== page.key && x.signature && x.signature === signature)) {
            page.status = "recheck"; this.collection.warn("Ta sama zawartość pojawiła się pod innym numerem strony. Nie zaliczono powtórzonego lub niedoładowanego zestawu."); return false;
        }
        if (page.signature && page.signature !== signature) {
            for (const previous of scope.pages) if (previous.status === "processed") previous.status = "recheck";
            this.collection.warn("Zestaw wyników na wcześniej odczytanej stronie zmienił się. Poprzednie strony wymagają sprawdzenia; linki zachowano.");
        }
        const confirmed = manuallyConfirmed || search.fullPage === true || page.source === "user-confirmed" && page.signature === signature;
        // Never equate seeing a page number with reading its messages.
        if (!ids.length && !(search.fullPage && search.reportedTotal === 0)) { page.status = "recheck"; return false; }
        const excludedIDs = excluded.map(x => x.id).sort();
        if (page.signature === signature && JSON.stringify(page.excludedIDs || []) === JSON.stringify(excludedIDs) && page.status === (confirmed ? "processed" : "visible-only")) return false;
        const previous = JSON.stringify(page);
        page.status = confirmed ? "processed" : "visible-only";
        page.signature = signature; page.messageCount = ids.length;
        if (excludedIDs.length) page.excludedIDs = excludedIDs; else delete page.excludedIDs;
        page.processedAt = now(); page.source = manuallyConfirmed ? "user-confirmed" : search.source;
        return previous !== JSON.stringify(page);
    }
    summary(scope = this.active()) {
        if (!scope) return {observed: 0, processed: 0, missing: [], recheck: [], confirmed: [], domains: [], warnings: ["Kontekst wyszukiwania nie został odczytany."]};
        const confirmed = scope.pages.filter(x => x.status === "processed" && x.number).map(x => x.number).sort((a,b) => a-b);
        const observedNumbers = scope.pages.map(x => x.number || 0), maximum = Math.min(100000, Math.max(scope.totalPages || 0, ...observedNumbers));
        const missing = [], have = new Set(confirmed);
        for (let number = 1; number <= maximum; number++) if (!have.has(number)) missing.push(number);
        const context = JSON.stringify(scope.context), warnings = [];
        const channels = scope.context.filters.channel_id;
        if (!(Array.isArray(channels) && channels.length === 1 && channels[0] === scope.context.channelID) && !/\bin:/i.test(scope.context.query)) warnings.push("Nie potwierdzono filtra jednego kanału. Kolektor zapisuje tylko wybrany kanał; licznik Discorda może obejmować szerszy zakres.");
        if (/author_id|author_type|from:|MEE6/i.test(context)) warnings.push("Aktywny filtr autora/typu autora ogranicza wyniki; usuń go, aby uwzględnić pozostałych użytkowników.");
        if (/min_id|max_id|before:|after:|during:|date/i.test(context)) warnings.push("Zakres dat ogranicza historię.");
        if (/mentions|has:|\"has\"|link_hostname/i.test(context)) warnings.push("Dodatkowe filtry mogą ograniczać wyniki.");
        if (scope.context.sort === "nieznane") warnings.push("Sortowanie nierozpoznane. Strony wymagają potwierdzenia lub własnego opisu zakresu z sortowaniem.");
        const domains = this.state.scopes.filter(x => x.pages.some(p => p.status === "processed")).flatMap(x => ["youtube.com", "youtu.be"].filter(domain => JSON.stringify(x.context).includes(domain)));
        for (const domain of ["youtube.com", "youtu.be"]) if (!domains.includes(domain)) warnings.push(`Brak potwierdzonego odczytu zakresu ${domain}.`);
        return {observed: scope.pages.length, processed: scope.pages.filter(x => x.status === "processed").length, userConfirmed: scope.pages.filter(x => x.status === "processed" && x.source === "user-confirmed").length, confirmed, missing, recheck: scope.pages.filter(x => x.status !== "processed").map(x => x.number || x.key), domains: [...new Set(domains)], warnings};
    }
    accounting(scope = this.active()) {
        const ids = new Set((scope?.pages || []).filter(page => page.status === "processed").flatMap(page => page.signature.split(",").filter(Boolean)));
        const excluded = new Set((scope?.pages || []).filter(page => page.status === "processed").flatMap(page => page.excludedIDs || []));
        // A later read in the selected channel takes precedence over an old exclusion.
        for (const id of excluded) if (this.collection.seen.has(id)) excluded.delete(id);
        let withLinks = 0, withoutLinks = 0, unverified = 0;
        for (const id of ids) {
            if (excluded.has(id)) continue;
            const fingerprint = this.collection.seen.get(id);
            if (fingerprint === "[]") { withoutLinks++; continue; }
            try {
                const saved = JSON.parse(fingerprint);
                if (Array.isArray(saved) && Array.isArray(saved[0]) && saved[0].length && saved[0].every(url => parseYouTubeURL(url))) { withLinks++; continue; }
            } catch { /* An old or incomplete checkpoint is not proof of no links. */ }
            unverified++;
        }
        const progress = this.summary(scope);
        return {read: ids.size - excluded.size, reviewed: ids.size, outsideChannel: excluded.size, withLinks, withoutLinks, unverified,
            allPages: !!scope?.totalPages && !progress.missing.length && !progress.recheck.length && progress.processed === scope.totalPages,
            reportedTotal: scope?.reportedTotal ?? null};
    }
}
function toMessages(value) {
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?._array)) return value._array;
    if (typeof value?.toArray === "function") { const array = value.toArray(); if (Array.isArray(array)) return array; }
    if (value instanceof Map) return [...value.values()];
    throw new Error("Nierozpoznany format MessageStore; używany będzie odczyt widocznych elementów.");
}
function committedFiber(fiber) {
    if (!fiber) return null;
    // A bailout can leave return pointers in the other branch. Follow the
    // committed root's child lists, matching each ancestor or its alternate.
    const path = [], seen = new Set(); let node = fiber;
    while (node?.return && path.length < 128 && !seen.has(node)) { seen.add(node); path.push(node); node = node.return; }
    if (node?.return) return null;
    let current = node?.stateNode?.current;
    if (!current) return fiber;
    if (current !== node && current !== node.alternate) return null;
    let scanned = 0;
    for (const expected of path.reverse()) {
        let child = current.child;
        while (child && child !== expected && child !== expected.alternate && ++scanned < 5000) child = child.sibling;
        if (!child || scanned >= 5000) return null;
        current = child;
    }
    return current;
}
function readSearchProps(api, root) {
    // Read mounted React props only; never call action creators, hooks or handlers.
    const result = {props: {}, pagination: null};
    if (!root) return result;
    try {
        const currentFiber = element => {
            return committedFiber(api.ReactUtils?.getInternalInstance?.(element));
        };
        const paginationProps = p => Number.isSafeInteger(p?.currentPage) && p.currentPage >= 1 && Number.isSafeInteger(p?.pageSize) && p.pageSize > 0 && Number.isSafeInteger(p?.totalCount) && p.totalCount >= 0;
        let fiber = currentFiber(root);
        const ancestors = [];
        for (let i = 0; fiber && i < 20; i++, fiber = committedFiber(fiber.return)) {
            ancestors.push(fiber);
            const p = fiber.memoizedProps;
            if (p?.searchContext && p.search && Array.isArray(p.messages) && !result.props.searchContext) result.props = p;
            else if ((p?.searchId != null || p?.searchID != null) && !result.props.searchContext) result.props = p;
        }
        // Follow the existing rel buttons to their Pagination ancestor first. This
        // remains bounded even when hundreds of message descendants precede it.
        for (const control of root.querySelectorAll?.('[rel="next"], [rel="prev"]') || []) {
            let node = currentFiber(control);
            for (let i = 0; node && i < 24; i++, node = committedFiber(node.return)) {
                if (paginationProps(node.memoizedProps)) { const p = node.memoizedProps; result.pagination = {currentPage:p.currentPage, pageSize:p.pageSize, totalCount:p.totalCount}; break; }
            }
            if (result.pagination) break;
        }
        // Pagination is a child of the search root. Its actual pageSize is the evidence;
        // never substitute a hardcoded size or the number of mounted DOM messages.
        const queue = ancestors.slice(0, 2).map(x => x.child).filter(Boolean), seen = new Set();
        for (let count = 0; !result.pagination && queue.length && count < 600; count++) {
            const node = queue.shift(); if (!node || seen.has(node)) continue; seen.add(node);
            const p = node.memoizedProps;
            if (paginationProps(p)) { result.pagination = {currentPage: p.currentPage, pageSize: p.pageSize, totalCount: p.totalCount}; break; }
            if (node.child) queue.push(node.child); if (node.sibling) queue.push(node.sibling);
        }
    } catch { /* DOM/store fallback remains partial. */ }
    return result;
}
function contextSearchID(context) {
    if (!context || typeof context.type !== "string") return null;
    const type = context.type.toLowerCase();
    if (type === "guild") return validId(context.guildId) ? context.guildId : null;
    if (["guild_channel", "channel", "thread"].includes(type)) return validId(context.channelId) ? context.channelId : null;
    return null; // Cross-DM/unknown context cannot prove a selected channel's scope.
}
function localizedCount(text) {
    const match = /^\s*([0-9][0-9\s\u00a0\u202f,.]*)\s+(?:wynik|result|rezultat)/i.exec(text || "");
    if (!match) return null;
    const value = Number(match[1].replace(/\D/g, "")); return Number.isSafeInteger(value) ? value : null;
}
function messageShape(value, channelID) {
    return {object: !!value && typeof value === "object", validID: validId(value?.id), channelPresent: typeof value?.channel_id === "string", channelMatches: value?.channel_id === channelID, contentType: typeof value?.content, embedsType: value?.embeds == null ? "absent" : Array.isArray(value.embeds) ? "array" : "other", hit: value?.hit === true ? "true" : value?.hit === false ? "false" : "absent", messageType: Number.isSafeInteger(value?.type) ? value.type : null};
}
function pageIDs(search) { return [...search.messages, ...(search.excludedMessages || [])].map(x => x.id).sort().join(","); }
function pageEvidence(search) { return JSON.stringify([search.messages.map(x => [x.id,x.content,x.embeds]), (search.excludedMessages || []).map(x => [x.id,x.channel_id])]); }
class LocalAdapter {
    constructor(api, doc = document, loc = location) {
        this.api = api; this.document = doc; this.location = loc; this.stores = {};
        for (const name of ["SelectedChannelStore", "ChannelStore", "GuildStore", "PermissionStore", "MessageStore", "SearchMessageStore", "SearchStore", "SearchQueryStore", "SelectedSearchContextStore"]) {
            try { this.stores[name] = api.Webpack.getStore(name); } catch { this.stores[name] = null; }
        }
    }
    selection() {
        const route = /^\/channels\/(@me|\d+)\/(\d+)/.exec(this.location.pathname);
        const channelID = this.stores.SelectedChannelStore?.getChannelId?.() || route?.[2];
        if (!validId(channelID)) throw new Error("Otwórz konkretny kanał tekstowy w Discordzie.");
        if (!route || route[2] !== channelID) throw new Error("Widok kanału nie zgadza się z danymi klienta. Otwórz ponownie kanał tekstowy.");
        const channel = this.stores.ChannelStore?.getChannel?.(channelID);
        if (!channel || ![0, 1, 3, 5, 10, 11, 12].includes(channel.type)) throw new Error("Wybierz kanał tekstowy, wiadomości prywatne lub konkretny wątek.");
        const serverID = channel.guild_id || "@me";
        this.checkPermissions(channel);
        return normalizeSelection({channelID, serverID, channelName: channel.name || "wiadomosci-prywatne", serverName: serverID === "@me" ? "Wiadomości prywatne" : this.stores.GuildStore?.getGuild?.(serverID)?.name || serverID});
    }
    checkPermissions(channel) {
        if (!channel.guild_id) return;
        const permissions = this.stores.PermissionStore;
        if (typeof permissions?.can !== "function") throw new Error("Nie można sprawdzić uprawnień kanału. Odczyt został zablokowany; sprawdź aktualizację Discorda/BetterDiscord.");
        if (!permissions.can(1024n, channel) || !permissions.can(65536n, channel)) throw new Error("Brak uprawnień Wyświetlanie kanału lub Czytanie historii wiadomości.");
    }
    ensureSelected(selection) {
        const current = this.selection();
        if (current.channelID !== selection.channelID || current.serverID !== selection.serverID) throw new Error("Zmieniono otwarty kanał. Otwórz wybrany kanał i wznów kolekcję.");
    }
    resolve(messageID, channelID, allowOtherChannels = false) {
        this.resolveDiagnostics = {candidates: [], mounted: false, fiber: false};
        for (const store of [this.stores.MessageStore, this.stores.SearchMessageStore]) {
            if (typeof store?.getMessage !== "function") continue;
            for (const args of [[channelID, messageID], [messageID, channelID], [messageID]]) {
                try {
                    const message = store.getMessage(...args);
                    if (message?.id === messageID && this.resolveDiagnostics.candidates.length < 6) this.resolveDiagnostics.candidates.push(messageShape(message, channelID));
                    if (message?.id === messageID && validId(message.channel_id) && (message.channel_id === channelID || allowOtherChannels) && typeof message.content === "string" && (message.embeds == null || Array.isArray(message.embeds))) return message;
                } catch { /* Guarded unstable Discord store signatures. */ }
            }
        }
        // A hit may have left a store while its complete message is still mounted.
        // Reuse committed-fiber resolution; do not accept DOM text as a full record.
        try {
            const node = this.document.querySelector?.(`[id="message-content-${messageID}"]`);
            let fiber = node && committedFiber(this.api.ReactUtils?.getInternalInstance?.(node));
            this.resolveDiagnostics.mounted = !!node; this.resolveDiagnostics.fiber = !!fiber;
            for (let i = 0; fiber && i < 24; i++, fiber = committedFiber(fiber.return)) {
                const message = fiber.memoizedProps?.message;
                if (message?.id === messageID && validId(message.channel_id) && (message.channel_id === channelID || allowOtherChannels) && typeof message.content === "string" && (message.embeds == null || Array.isArray(message.embeds))) return message;
            }
        } catch { /* An unresolved message must continue to block page completion. */ }
        return null;
    }
    domMessage(root, selection, messageID) {
        const content = root.querySelector(`[id="message-content-${messageID}"]`);
        if (!content) return null;
        const read = node => {
            if (node.nodeType === 3) return node.textContent || "";
            if (node.nodeType !== 1) return "";
            if (node.tagName === "A" && parseYouTubeURL(node.getAttribute("href"))) return ` ${node.getAttribute("href")} `;
            return [...node.childNodes].map(read).join("");
        };
        return {id: messageID, channel_id: selection.channelID, content: read(content), embeds: [],
            timestamp: root.querySelector("time[datetime]")?.getAttribute("datetime") || null, author: null};
    }
    inspectSearch(selection, manual = null) {
        const safe = (store, method, ...args) => { try { return typeof store?.[method] === "function" ? store[method](...args) : null; } catch { return null; } };
        const legacy = this.stores.SearchStore, queryStore = this.stores.SearchQueryStore || legacy;
        const root = this.document.querySelector?.('[class*="searchResultsWrap"], [data-ytlc-search]');
        const read = readSearchProps(this.api, root), props = read.props, state = props.search || {};
        const selectedContext = root ? safe(this.stores.SelectedSearchContextStore, "getSelectedSearchContext") : null;
        const context = props.searchContext || selectedContext;
        let id = contextSearchID(context) || props.searchId || props.searchID || safe(legacy, "getCurrentSearchId");
        this.searchDiagnostics = {root: !!root, props: !!props.searchContext, queryStore: !!queryStore, contextStore: !!this.stores.SelectedSearchContextStore, pagination: !!read.pagination};
        const resultStore = this.stores.SearchMessageStore;
        // SearchResults (23179) blocks page changes for isSearching/isIndexing/error.
        // Its historical indexing flag is background work, not page loading. Nested
        // embeds can keep loading spinners/progressbars indefinitely after results
        // are ready; their DOM state must never qualify the search page as busy.
        const busyReasons = [
            ["legacy-searching", safe(legacy,"isSearching",id) === true],
            ["store-fetching", safe(resultStore,"getIsFetching",id) === true],
            ["store-indexing", safe(resultStore,"getIsIndexing",id) === true],
            ["store-error", safe(resultStore,"getError",id) != null],
            ["props-searching", state.isSearching === true || props.isSearching === true || props.searching === true],
            ["props-indexing", state.isIndexing === true],
            ["props-error", state.hasError === true]
        ].filter(([, active]) => active).map(([name]) => name);
        const busy = busyReasons.length > 0;
        const backgroundIndexing = safe(resultStore,"getIsHistoricalIndexing",id) === true || state.isHistoricalIndexing === true;
        this.searchDiagnostics = {...this.searchDiagnostics, busy, busyReasons, backgroundIndexing};
        if (!root && id == null && !manual?.query) return null;
        if (context && (context.guildId && context.guildId !== selection.serverID || context.channelId && context.channelId !== selection.channelID)) return {unavailable: true, loading: busy, warning: "Wyszukiwarka wskazuje inny kanał lub serwer. Odczyt tej strony nie został zaliczony."};
        if (!id && !manual?.query) return {unavailable: true, loading: busy, warning: "Nie odczytano aktywnego kontekstu wyszukiwarki. Sprawdź SearchQueryStore/SelectedSearchContextStore w diagnostyce lub użyj własnego opisu."};
        const query = safe(queryStore, "getSearchResultsQueryString", id);
        const filters = safe(queryStore, "getSearchResultsQuery", id) || props.searchResultsQuery;
        const activeSort = root?.querySelector?.('[role="tab"][aria-selected="true"], [class*="sort"] [aria-checked="true"]')?.textContent;
        const mode = safe(queryStore, "getSearchMode", id) ?? props.searchMode;
        const sort = filters?.sort_by ? `${filters.sort_by}/${filters.sort_order || ""}` : props.sortBy ? `${props.sortBy}/${props.sortOrder || ""}` : typeof mode === "string" ? mode : str(activeSort, 200);
        if (!query && !filters && !manual?.query) return {unavailable: true, loading: busy, warning: "Nie odczytano zapytania. Wprowadź własny opis zakresu (filtry i sortowanie), aby prowadzić historię stron."};
        let scope;
        try { scope = manual?.query ? searchScope(selection, manual.query, {manual: true, clientQuery: query || "", clientFilters: filters || {}, clientSort: sort || "nieznane"}, "opis użytkownika", id) : searchScope(selection, query || "", filters, sort, id); }
        catch (error) { return {unavailable: true, loading: busy, warning: error.message}; }
        const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
        const positive = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 && Number(value) <= 100000 ? Number(value) : null;
        const queryOffset = safe(queryStore, "getSearchResultsOffset", id), propsOffset = integer(state.offset);
        const offset = integer(queryOffset) ?? propsOffset;
        const offsetCoherent = propsOffset === null || integer(queryOffset) === null || propsOffset === queryOffset;
        let filtersCoherent = true, filterError = false;
        try { if (filters && props.searchResultsQuery && filters !== props.searchResultsQuery) filtersCoherent = JSON.stringify(stableContext(filters)) === JSON.stringify(stableContext(props.searchResultsQuery)); }
        catch { filtersCoherent = false; filterError = true; }
        const coherent = offsetCoherent && filtersCoherent;
        const pagination = read.pagination;
        const pageNode = root?.querySelector?.('[aria-current="page"], [class*="pagination"] [class*="activeButton"], [class*="pageControl"] [class*="active"], [class*="pageButton"][class*="active"]');
        // SearchPagination (module 876689) passes floor(offset/pageSize)+1.
        // Its UI page is ONE based; only its onPageChange callback subtracts 1.
        const pageNumber = pagination ? positive(pagination.currentPage) : positive(pageNode?.textContent?.trim()) || positive(manual?.page);
        const size = pagination?.pageSize;
        const paginationOffset = pagination ? (pagination.currentPage - 1) * size : null;
        const pageCoherent = !pagination || propsOffset === null || propsOffset === paginationOffset;
        const reportedTotal = integer(state.totalResults) ?? integer(props.totalResults) ?? integer(safe(resultStore,"getTotalCount",id)) ?? localizedCount(root?.querySelector?.('[class*="totalResults"]')?.textContent) ?? integer(manual?.total);
        const totalPages = pagination ? Math.max(1, Math.ceil(pagination.totalCount / size)) : positive(props.totalPages);
        const payload = Array.isArray(props.messages) ? props.messages : safe(legacy,"getSearchResults",id) ?? props.searchResults;
        const groups = Array.isArray(payload) ? payload : Array.isArray(payload?.messages) ? payload.messages : null;
        const messages = new Map(), excluded = new Map(), unresolvedReasons = {}, unresolvedDetails = []; let unresolved = 0, expected = null, recovered = 0;
        const completeRecord = message => validId(message?.id) && validId(message.channel_id) && typeof message.content === "string" && (message.embeds == null || Array.isArray(message.embeds));
        const completeMessage = message => validId(message?.id) && message.channel_id === selection.channelID && typeof message.content === "string" && (message.embeds == null || Array.isArray(message.embeds));
        if (groups) {
            const flat = groups.flat(2).filter(x => x?.hit !== false); expected = flat.length;
            for (const value of flat) {
                // Deferred React hit objects can be incomplete even while the same
                // exact ID is already complete in a mounted client message store.
                // Resolve only IDs supplied by this page, never append a raw store.
                const id = typeof value === "string" ? value : value?.id;
                // Discord can search a whole server while one channel remains selected.
                // A complete hit from another channel is identified, not missing. Keep
                // only its identity for page evidence; never import its links or content.
                const message = completeRecord(value) ? value : validId(id) ? this.resolve(id, selection.channelID, true) : null;
                if (completeRecord(message) && message.channel_id !== selection.channelID) { excluded.set(id, {id, channel_id: message.channel_id}); continue; }
                if (completeMessage(message)) { messages.set(message.id, message); if (message !== value) recovered++; }
                else {
                    unresolved++;
                    const reason = !validId(id) ? "missing-id" : value?.channel_id && value.channel_id !== selection.channelID ? "different-channel" : message ? "incomplete-message" : "missing-in-store";
                    unresolvedReasons[reason] = (unresolvedReasons[reason] || 0) + 1;
                    if (unresolvedDetails.length < 3) unresolvedDetails.push({hit: messageShape(value, selection.channelID), resolution: validId(id) ? this.resolveDiagnostics : null});
                }
            }
        } else if (root) {
            for (const node of root.querySelectorAll('[id^="message-content-"]')) {
                const message = this.resolve(node.id.slice("message-content-".length), selection.channelID);
                if (message) messages.set(message.id, message); else unresolved++;
            }
        }
        // SearchMessageStore appends until the client's onFetchStart clears it.
        // Deferred mounted props, matching offsets and page size qualify this page;
        // the store's raw array by itself is never proof of a complete current page.
        const resolvedHits = messages.size + excluded.size;
        const loaded = !busy && coherent && pageCoherent && (resolvedHits > 0 || expected === 0 && reportedTotal === 0);
        const hidden = Number(props.blockCount || 0) + Number(props.ignoreCount || 0);
        // Client props identify a page, but deferred/filtered rendering may expose fewer hits.
        const pageExpected = pagination && reportedTotal !== null && propsOffset !== null ? Math.min(size, Math.max(0, reportedTotal - propsOffset)) : null;
        const fullPage = groups !== null && expected === resolvedHits && unresolved === 0 && hidden === 0 && scope.context.sort !== "nieznane" && coherent && pageCoherent && (pageExpected === null || expected === pageExpected);
        const next = root?.querySelector?.('[rel="next"], [data-ytlc-next]');
        const nextDisabled = next ? next.disabled === true || next.getAttribute?.("aria-disabled") === "true" : null;
        const coherenceReason = !offsetCoherent ? "offset-store/props" : !filtersCoherent ? filterError ? "filter-format" : "filters-store/props" : !pageCoherent ? "offset-pagination/props" : null;
        const waitReason = coherenceReason ? `Niezgodność danych strony: ${coherenceReason} (offset store=${integer(queryOffset)}, props=${propsOffset}, paginacja=${paginationOffset}).` : busy ? `Discord ładuje wyszukiwarkę lub zgłasza błąd: ${busyReasons.join(", ")}.` : !fullPage ? `Niepełny odczyt strony ${pageNumber ?? "?"}: rozpoznano ${resolvedHits}/${pageExpected ?? "?"} wyników; nierozpoznane: ${unresolved}, ukryte: ${hidden}.` : null;
        this.searchDiagnostics = {...this.searchDiagnostics, coherent: coherent && pageCoherent, coherenceReason, queryOffset: integer(queryOffset), propsOffset, paginationOffset, currentPage: pagination?.currentPage ?? null, paginationBase: 1, filtersCoherent, payload: groups !== null, unresolved, unresolvedReasons, unresolvedDetails, recovered, pageSize: size ?? null, reportedTotal, totalPages, hidden, next: !!next, busy, busyReasons, backgroundIndexing, loaded, fullPage, readMessages: messages.size, expectedHits: pageExpected, sortKnown: scope.context.sort !== "nieznane"};
        Object.assign(this.searchDiagnostics, {resolvedHits, outsideChannel: excluded.size});
        return {scope, pageNumber: coherent && pageCoherent ? pageNumber : null, pageKey: integer(offset) !== null ? `offset:${offset}` : pageNumber ? `page:${pageNumber}` : null,
            offset, reportedTotal, totalPages, expectedHits: pageExpected, messages: [...messages.values()], excludedMessages: [...excluded.values()], resolvedHits, outsideChannel: excluded.size, loaded, loading: busy, fullPage, unresolved, waitReason,
            navigationReady: !!root && !!pagination && !!props.searchContext,
            lastPage: loaded && fullPage && !!pagination && pageNumber === totalPages && (nextDisabled === true || !next && totalPages === 1),
            source: groups ? "client-results" : manual?.query ? "manual-context/visible-results" : "visible-results"};
    }
    navigate(search, direction) {
        if (!["next", "prev"].includes(direction)) throw new Error("Nierozpoznany kierunek nawigacji.");
        const current = this.inspectSearch(search.scope.context);
        // inspectSearch expects normalized channel/server IDs, which the scope carries.
        if (!current?.loaded || !current.fullPage || !current.navigationReady || current.scope?.key !== search.scope.key || current.pageKey !== search.pageKey || current.pageNumber !== search.pageNumber || pageEvidence(current) !== pageEvidence(search)) {
            const error = new Error("Wyniki zmieniły się przed kliknięciem. Nie wykonano przejścia.");
            if (current?.scope?.key === search.scope.key && current.pageKey === search.pageKey && current.pageNumber === search.pageNumber) error.code = "PAGE_UNSTABLE_BEFORE_CLICK";
            throw error;
        }
        const root = this.document.querySelector('[class*="searchResultsWrap"], [data-ytlc-search]');
        const controls = [...(root?.querySelectorAll?.(`[rel="${direction}"]`) || [])];
        if (controls.length !== 1) throw new Error(`Nie znaleziono jednoznacznego przycisku ${direction === "next" ? "następnej" : "poprzedniej"} strony (rel=${direction}). Zatrzymano bez zgadywania selektorów.`);
        const control = controls[0];
        if (control.isConnected === false || control.disabled || control.getAttribute?.("aria-disabled") === "true" || typeof control.click !== "function") throw new Error("Przycisk strony jest niedostępny. Nie wywołano żadnych prywatnych akcji klienta.");
        control.click(); // Exactly one existing UI action; success is verified on subsequent reads.
    }
    read(selection, config) {
        this.ensureSelected(selection);
        const messages = new Map(), warnings = [];
        try {
            if (typeof this.stores.MessageStore?.getMessages !== "function") throw new Error("MessageStore niedostępny; zbierane są wyłącznie widoczne wiadomości.");
            for (const message of toMessages(this.stores.MessageStore.getMessages(selection.channelID))) {
                if (message?.channel_id === selection.channelID && validId(message.id)) messages.set(message.id, message);
            }
        } catch (error) { warnings.push(error.message); }
        let fallbackUsed = false, unresolvedSearch = 0;
        for (const root of this.document.querySelectorAll('[id^="chat-messages-"]')) {
            const match = /^chat-messages-(\d+)-(\d+)$/.exec(root.id);
            if (!match || match[1] !== selection.channelID || !validId(match[2])) continue;
            const stored = this.resolve(match[2], selection.channelID);
            if (stored) messages.set(stored.id, stored);
            else if (!messages.has(match[2])) {
                const message = this.domMessage(root, selection, match[2]);
                if (message) { messages.set(message.id, message); fallbackUsed = true; }
            }
        }
        if (config.search) {
            // Read only already-mounted messages. Never invoke searches or click next pages.
            for (const node of this.document.querySelectorAll('[id^="message-content-"]')) {
                if (node.closest(".ytlc")) continue;
                const messageID = node.id.slice("message-content-".length);
                if (!validId(messageID) || messages.has(messageID)) continue;
                const stored = this.resolve(messageID, selection.channelID);
                if (stored) messages.set(messageID, stored);
                else if (!node.closest('[id^="chat-messages-"]')) unresolvedSearch++;
            }
        }
        if (fallbackUsed) warnings.push("Odczyt DOM ma ograniczenia: brak autora i embedów, możliwe pominięcia przy zmianie układu klienta.");
        if (unresolvedSearch) warnings.push("Nie udało się przypisać części widocznych wyników do wybranego kanału. Otwórz wynik w kanale i zbierz go ponownie.");
        let searchCursor = null;
        try {
            const store = this.stores.SearchStore, id = store?.getCurrentSearchId?.();
            const offset = id != null ? store.getSearchResultsOffset?.(id) : null;
            if (Number.isSafeInteger(offset) && offset >= 0) searchCursor = offset;
        } catch { /* Informational only; never used as a resumable network cursor. */ }
        return {messages: [...messages.values()], warnings, searchCursor};
    }
}
class UIPageNavigator {
    constructor({stableMs = 1000, timeoutMs = 30000, maxTransitions = 10000, fromBeginning = false} = {}) {
        this.stableMs = stableMs; this.timeoutMs = timeoutMs; this.maxTransitions = maxTransitions;
        this.phase = "reading"; this.transitions = 0; this.started = null; this.candidate = null; this.fromBeginning = fromBeginning;
    }
    signature(search) { return pageIDs(search); }
    tick(search, time = Date.now()) {
        this.started ??= time;
        if (this.cancelled) return {type: "cancelled"};
        // onFetchStart clears SearchMessageStore; deferred props temporarily report
        // totalResults=0 and can lose the old scope while the next page is fetching.
        // Do not compare or commit that intermediate state. Recheck everything once
        // loading ends, and never extend the original transition timeout.
        if (this.phase === "waiting" && search?.loading === true) return time - this.started >= this.timeoutMs
            ? {type: "error", message: `Timeout przejścia (${this.timeoutMs / 1000} s): wyszukiwarka nadal ładuje następną stronę. Kliknięcia nie ponowiono; checkpoint zachowano.`}
            : {type: "wait"};
        if (!search?.scope) return {type: "error", message: "Zamknięto lub nie rozpoznano wyszukiwarki. Zatrzymano automatyczne przechodzenie."};
        this.scopeKey ??= search.scope.key;
        if (search.loaded) this.reportedTotal ??= search.reportedTotal;
        if (this.scopeKey !== search.scope.key) return {type: "error", message: "Zmieniono zakres lub sortowanie wyszukiwania. Zatrzymano automatyczne przechodzenie; dane zachowano."};
        if (search.loaded && this.reportedTotal !== search.reportedTotal) return {type: "error", message: "Liczba wyników zmieniła się podczas przechodzenia stron. Zatrzymano, aby nie pominąć przesuniętych wiadomości."};
        const ids = this.signature(search);
        if (this.phase === "waiting") {
            if (search.pageNumber && search.pageNumber !== this.fromPage && search.pageNumber !== this.expectedPage) return {type: "error", message: "Strona zmieniła się poza zaplanowanym przejściem. Zatrzymano nawigację."};
            if (search.pageNumber === this.expectedPage && search.pageKey !== this.fromKey && ids !== this.fromSignature && search.loaded && search.navigationReady) {
                this.phase = "reading"; this.candidate = null; this.started = time;
            } else if (time - this.started >= this.timeoutMs) return {type: "error", message: `Timeout przejścia (${this.timeoutMs / 1000} s): nie potwierdzono nowej, w pełni załadowanej strony. Kliknięcia nie ponowiono; linki i checkpoint zachowano.`};
            else return {type: "wait"};
        }
        if (!search.pageKey || !search.pageNumber || !search.totalPages || !search.navigationReady || !search.loaded || !search.fullPage) {
            this.candidate = null;
            return time - this.started >= this.timeoutMs ? {type: "error", message: `Timeout odczytu (${this.timeoutMs / 1000} s): ${search.waitReason || "strona jest niepełna, ładuje się lub zawiera ukryte/nierozpoznane wyniki."} Nie przechodzono dalej.`} : {type: "wait"};
        }
        const signature = JSON.stringify([search.scope.key, search.pageKey, search.pageNumber, ids, pageEvidence(search)]);
        if (signature !== this.candidate?.signature) { this.candidate = {signature, since: time}; return {type: "wait"}; }
        if (time - this.candidate.since < this.stableMs) return {type: "wait"};
        return {type: "capture"};
    }
    afterCommit(search, time = Date.now()) {
        if (this.cancelled) return {type: "cancelled"};
        // Rewinding is an explicit operation, never an accidental resume side effect.
        this.rewinding ??= this.fromBeginning && search.pageNumber > 1;
        if (this.rewinding && search.pageNumber === 1) this.rewinding = false;
        if (!this.rewinding && search.pageNumber === search.totalPages && search.lastPage) { this.phase = "finished"; return {type: "finish"}; }
        if (!this.rewinding && search.pageNumber >= search.totalPages) return {type:"error",message:"Paginator nie potwierdza końca zadeklarowanej ostatniej strony. Nie przechodzono poza rozpoznany zakres."};
        if (++this.transitions > this.maxTransitions) return {type: "error", message: "Osiągnięto limit 10 000 przejść tej sesji. Zatrzymano; eksportuj JSON i wznów."};
        const direction = this.rewinding ? "prev" : "next";
        this.fromPage = search.pageNumber; this.expectedPage = this.fromPage + (direction === "prev" ? -1 : 1);
        this.fromKey = search.pageKey; this.fromSignature = this.signature(search); this.phase = "waiting"; this.started = time; this.candidate = null;
        return {type: "navigate", direction, expectedPage: this.expectedPage};
    }
    cancel() { this.cancelled = true; this.phase = "interrupted"; }
}
const CSS = `
.ytlc{box-sizing:border-box;font:14px/1.45 var(--font-primary,system-ui);color:var(--text-normal,#dbdee1);background:var(--background-secondary,#2b2d31);border:1px solid var(--background-modifier-accent,#41434a);border-radius:12px;padding:18px;min-width:0}
.ytlc *{box-sizing:border-box}.ytlc [hidden]{display:none!important}.ytlc-window{position:fixed;right:24px;bottom:24px;width:min(740px,calc(100vw - 48px));height:min(790px,90vh);max-height:90vh;display:flex;flex-direction:column;overflow:hidden;padding:0;z-index:1001;box-shadow:0 14px 60px #0008}
.ytlc h2{font-size:20px;font-weight:700;margin:0}.ytlc h3{font-size:15px;margin:18px 0 8px}.ytlc p{margin:8px 0}.ytlc small,.ytlc-muted{color:var(--text-muted,#a5a8ae)}
.ytlc-head,.ytlc-actions,.ytlc-controls,.ytlc-pager{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.ytlc-head{justify-content:space-between;margin-bottom:12px}
.ytlc .ytlc-head{margin:0;padding:16px 18px 8px;flex-shrink:0}.ytlc-window .ytlc-head{cursor:grab;touch-action:none;user-select:none}.ytlc-window .ytlc-head[data-dragging=true]{cursor:grabbing}.ytlc-title small{display:block;font-size:11px;font-weight:400;margin-top:3px}.ytlc .ytlc-title h2{font-size:18px}
.ytlc button,.ytlc select,.ytlc input,.ytlc textarea{font:inherit;border-radius:6px;border:1px solid var(--background-modifier-accent,#41434a);color:inherit;background:var(--background-primary,#313338);padding:7px 10px;min-height:34px}
.ytlc button{cursor:pointer}.ytlc button:disabled{opacity:.45;cursor:default}.ytlc button.ytlc-primary{background:var(--brand-500,#5865f2);border-color:transparent;color:white}.ytlc button.ytlc-danger{color:var(--text-danger,#f88)}
.ytlc :focus-visible{outline:2px solid var(--brand-500,#5865f2);outline-offset:2px}.ytlc input[type=checkbox]{min-height:0;margin-right:6px;accent-color:var(--brand-500,#5865f2)}
.ytlc-channel{font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;font-size:12px}.ytlc-status{font-weight:650;color:var(--text-warning,#efbb69);font-size:13px}.ytlc-status[data-complete=true]{color:#70dca4}
.ytlc-status[data-search-finished=true]{color:#70dca4}.ytlc-search-summary{padding:12px;border:1px solid var(--background-modifier-accent,#41434a);border-radius:8px;margin:0 0 12px}.ytlc-search-summary p:first-of-type{font-weight:600}.ytlc-history-note{font-size:12px}.ytlc-search-summary p,.ytlc-page-health p{margin:5px 0}
.ytlc-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0}.ytlc-stat{padding:10px;border-radius:8px;background:var(--background-primary,#313338)}.ytlc-stat b{font-size:21px;display:block;font-variant-numeric:tabular-nums}.ytlc-stat span{font-size:12px;color:var(--text-muted,#a5a8ae)}
.ytlc-controls input[type=search]{flex:1;min-width:140px;width:100%}.ytlc-results{margin:10px 0;border-radius:6px;background:var(--background-primary,#313338)}.ytlc-result{padding:10px 12px;border-bottom:1px solid var(--background-modifier-accent,#41434a);overflow-wrap:anywhere;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:4px 12px}.ytlc a{color:var(--text-link,#00a8fc)}.ytlc-result>a{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ytlc-result small{display:block;grid-column:1/-1}.ytlc-pager{justify-content:space-between}
.ytlc label{display:block;margin:8px 0}.ytlc summary{cursor:pointer;font-weight:600}.ytlc code{user-select:text;overflow-wrap:anywhere}.ytlc-diagnostics{white-space:pre-wrap;overflow-wrap:anywhere;min-width:0}.ytlc-notes{max-height:110px;overflow:auto;color:var(--text-warning,#efbb69)}.ytlc-error{color:var(--text-danger,#ff9393)}.ytlc-launcher{position:fixed;left:50%;top:40px;transform:translateX(-50%);z-index:999;border:0;border-radius:8px;padding:8px 12px;background:var(--brand-500,#5865f2);color:white;cursor:pointer}
.ytlc-channelbar{padding:0 18px 10px;display:flex;align-items:center;gap:8px;flex-shrink:0}.ytlc-channelbar button{font-size:12px;min-height:28px;padding:4px 8px}.ytlc-runbar{margin:0 18px 12px;padding:12px;background:var(--background-primary,#313338);border:1px solid var(--background-modifier-accent,#41434a);border-radius:9px;flex-shrink:0}.ytlc-runbar[data-phase=error]{border-color:#b85b63}.ytlc-runbar[data-phase=error] .ytlc-status{color:#ff9ba2}.ytlc-runbar[data-phase=delay] .ytlc-status{color:#b7bdff}.ytlc-run-top{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}.ytlc-run-top p{font-size:12px;margin:0;font-variant-numeric:tabular-nums}.ytlc progress{display:block;appearance:none;width:100%;height:6px;overflow:hidden;border:0;border-radius:8px;background:#ffffff15;margin:10px 0 12px;accent-color:var(--brand-500,#5865f2)}.ytlc progress::-webkit-progress-bar{background:#ffffff15}.ytlc progress::-webkit-progress-value{background:var(--brand-500,#5865f2);border-radius:8px}.ytlc .ytlc-activity{font-size:12px;line-height:1.4;margin:9px 0 0;color:var(--text-muted,#a5a8ae);font-variant-numeric:tabular-nums}.ytlc-runbar[data-working=true] .ytlc-activity:before{content:' ';display:inline-block;width:7px;height:7px;margin-right:7px;border-radius:50%;background:#8a94ff;animation:ytlc-pulse 1.4s infinite}@keyframes ytlc-pulse{50%{opacity:.35}}@media(prefers-reduced-motion:reduce){.ytlc-runbar .ytlc-activity:before{animation:none!important}}
.ytlc-tabs{display:flex;gap:4px;border-bottom:1px solid var(--background-modifier-accent,#41434a);padding:0 18px;flex-shrink:0}.ytlc-tabs button{border:0;border-bottom:2px solid transparent;border-radius:5px 5px 0 0;background:transparent;min-width:0;padding:9px 12px;color:var(--text-muted,#a5a8ae)}.ytlc-tabs button[aria-selected=true]{color:var(--text-normal,#fff);border-bottom-color:var(--brand-500,#5865f2);background:#ffffff08}.ytlc-body{min-height:0;padding:16px 18px;overflow:auto;flex:1;overscroll-behavior:contain;scrollbar-gutter:stable}.ytlc-tabpanel{min-width:0}.ytlc-tabpanel>details{border-bottom:1px solid var(--background-modifier-accent,#41434a);padding:12px 0}.ytlc-tabpanel>details>summary{margin-bottom:8px}.ytlc-tabpanel .ytlc-notes{max-height:none;overflow:visible}.ytlc-page-health{padding:12px;border-radius:8px;margin-bottom:12px;background:#5865f212;border:1px solid #5865f244}.ytlc-page-health[data-blocked=true]{background:#ed424512;border-color:#b85b63}.ytlc-page-health strong{display:block}.ytlc-page-health small{display:block;margin-top:4px}.ytlc-notice{font-size:13px;line-height:1.5;overflow-wrap:anywhere}.ytlc-footer{border-top:1px solid var(--background-modifier-accent,#41434a);padding:10px 18px;display:flex;gap:8px;align-items:center;flex-shrink:0;background:var(--background-secondary,#2b2d31)}.ytlc-footer small{flex:1;min-width:0;font-size:11px}.ytlc-footer select{width:78px}.ytlc-window .ytlc-body{scrollbar-width:thin}.ytlc:not(.ytlc-window){padding:0}.ytlc:not(.ytlc-window) .ytlc-body{max-height:650px}.ytlc .ytlc-stats{margin:8px 0 12px}.ytlc-stat b{font-size:24px}.ytlc-tabpanel h3:first-child{margin-top:0}
@media(max-width:560px){.ytlc-window{right:8px;bottom:8px;width:calc(100vw - 16px);height:94vh;max-height:94vh}.ytlc .ytlc-head{padding:10px 12px 6px}.ytlc-channelbar{padding:0 12px 8px}.ytlc-runbar{margin:0 12px 8px;padding:9px}.ytlc-tabs{padding:0 8px;gap:0}.ytlc-tabs button{flex:1;padding:8px 5px;font-size:12px}.ytlc-body{padding:12px}.ytlc-footer{padding:8px 12px}.ytlc-footer small{font-size:10px}.ytlc-stats{gap:5px}.ytlc-stat{padding:8px}.ytlc-stat b{font-size:20px}.ytlc-stat span{font-size:11px}.ytlc-actions{gap:5px}.ytlc-runbar button{padding:6px 9px;font-size:12px}.ytlc-activity{max-height:36px;overflow:hidden}}
@media(max-height:600px){.ytlc-title small{display:none}.ytlc-channelbar{padding-bottom:5px}.ytlc .ytlc-head{padding-top:8px;padding-bottom:4px}.ytlc-runbar{padding:8px;margin-bottom:6px}.ytlc progress{margin:6px 0 8px}.ytlc .ytlc-activity{margin-top:5px}.ytlc-tabs button{padding-top:5px;padding-bottom:5px}}
`;
function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
}
function linkNode(text, href) {
    const link = element("a", text); link.href = href; link.target = "_blank"; link.rel = "noopener noreferrer"; return link;
}
function movableWindow(root, handle, onPosition, initialPosition = null) {
    const view = root.ownerDocument.defaultView;
    let drag = null;
    const place = (left, top) => {
        const width = view.innerWidth, height = view.innerHeight;
        const x = Math.max(8, Math.min(left, Math.max(8, width - root.getBoundingClientRect().width - 8)));
        const y = Math.max(8, Math.min(top, Math.max(8, height - handle.getBoundingClientRect().height - 8)));
        Object.assign(root.style, {left: `${x}px`, top: `${y}px`, right: "auto", bottom: "auto", maxHeight: `min(88vh, ${Math.max(0, height - y - 8)}px)`});
        onPosition({left: x, top: y});
    };
    const down = event => {
        if (event.button !== 0 || event.isPrimary === false || event.target.closest("button,a,input,select,textarea,summary")) return;
        const rect = root.getBoundingClientRect();
        try { handle.setPointerCapture(event.pointerId); } catch { return; }
        drag = {id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top};
        handle.dataset.dragging = "true"; event.preventDefault();
    };
    const move = event => {
        if (drag?.id !== event.pointerId) return;
        place(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y);
    };
    const finish = event => {
        if (!drag || event && drag.id !== event.pointerId) return;
        const id = drag.id; drag = null; delete handle.dataset.dragging;
        if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
    };
    const key = event => {
        if (event.target !== handle || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
        event.preventDefault(); const rect = root.getBoundingClientRect(), step = event.shiftKey ? 50 : 20;
        place(rect.left + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0), rect.top + (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0));
    };
    const resize = () => { const rect = root.getBoundingClientRect(); place(rect.left, rect.top); };
    handle.tabIndex = 0;
    handle.setAttribute("aria-label", "Przesuń okno kolektora: przeciągnij pasek tytułu lub użyj strzałek");
    const listeners = [["pointerdown", down], ["pointermove", move], ["pointerup", finish], ["pointercancel", finish], ["lostpointercapture", finish], ["keydown", key]];
    for (const [name, listener] of listeners) handle.addEventListener(name, listener);
    view.addEventListener("resize", resize);
    if (initialPosition) place(initialPosition.left, initialPosition.top);
    return () => { finish(); for (const [name, listener] of listeners) handle.removeEventListener(name, listener); view.removeEventListener("resize", resize); };
}
// Optional read-only file connection: no server, commands, credentials or eval.
// A short-lived request created by the local CLI enables sanitized snapshots.
class LiveDiagnostics {
    constructor(fs, folder, snapshot, clock = Date.now) {
        Object.assign(this, {fs, folder, snapshot, clock}); this.enabled = false;
    }
    start() {
        if (this.timer || typeof this.folder !== "string" || !["readFileSync", "statSync"].every(k => typeof this.fs?.[k] === "function") || !fileCapabilities(this.fs).callbackWrite && !fileCapabilities(this.fs).promiseWrite) return;
        this.enabled = true; this.timer = setInterval(() => { void this.poll(); }, 2000); void this.poll();
    }
    async poll() {
        if (!this.enabled || this.writing) return;
        const prefix = `${this.folder.replace(/[\\/]+$/, "")}/${NAME}`;
        try {
            const size = this.fs.statSync(prefix + ".debug-request.json").size;
            if (!Number.isSafeInteger(size) || size < 1 || size > 4096) return;
            const request = JSON.parse(String(this.fs.readFileSync(prefix + ".debug-request.json", "utf8")));
            const time = this.clock();
            if (request.protocol !== 1 || !/^[a-f0-9]{32}$/.test(request.nonce) || !Number.isSafeInteger(request.expiresAt) || request.expiresAt <= time || request.expiresAt > time + 1800000 || Object.keys(request).some(k => !["protocol", "nonce", "expiresAt"].includes(k))) return;
            this.writing = true;
            await writeCompatibleFile(this.fs, prefix + ".diagnostics.json", JSON.stringify({protocol: 1, nonce: request.nonce, expiresAt: request.expiresAt, observedAt: new Date(time).toISOString(), ...this.snapshot()}, null, 2));
        } catch { /* Diagnostics must never stop collection or overwrite its data. */ }
        finally { this.writing = false; }
    }
    stop() { this.enabled = false; clearInterval(this.timer); this.timer = null; }
}
class YouTubeLinkCollector {
    constructor() {
        this.collection = new Collection(); this.panels = new Set(); this.active = false;
        this.running = false; this.busy = false; this.dirty = false; this.storageBlocked = false;
        this.generation = 0; this.lastSavedAt = null; this.ioBusy = false;
        this.manualSearch = null; this.downloads = new Map(); this.fileInputs = new Map(); this.searchCandidate = null;
        this.lastCheckAt = null; this.lastProgressAt = null; this.runStartedAt = null;
    }
    start() {
        if (this.active) return;
        this.api = new BdApi(NAME);
        this.persistence = new Persistence(this.api.Data);
        this.active = true;
        try {
            const restored = this.persistence.load();
            if (!restored) protectEmptyConfig(this.api, this.fileSystem());
            this.collection = restored || this.collection;
        }
        catch (error) { this.storageBlocked = true; this.collection.fail(error); }
        const previousScope = new SearchTracker(this.collection).active();
        if (previousScope?.context.filters?.manual) this.manualSearch = {query: previousScope.context.query, page: null, total: null};
        this.adapter = new LocalAdapter(this.api);
        this.liveDiagnostics = new LiveDiagnostics(this.fileSystem(), this.api.Plugins?.folder, () => this.diagnosticSnapshot());
        this.liveDiagnostics.start();
        this.heartbeatTimer = setInterval(() => {
            if (!this.running && this.panels.size && this.collection.state.selection) {
                try { this.liveSearch = this.adapter.inspectSearch(this.collection.state.selection); } catch { /* No client actions. */ }
            }
            this.renderSoon();
        }, 1000);
        this.api.DOM?.addStyle?.(CSS);
        this.launcher = element("button", "YT • Kolektor", "ytlc-launcher");
        this.launcher.title = "Otwórz kolektor linków YouTube (Alt+Shift+Y)";
        this.launcher.addEventListener("click", () => this.openWindow());
        document.body.append(this.launcher);
        this.keyHandler = event => {
            if (event.altKey && event.shiftKey && event.code === "KeyY") { event.preventDefault(); this.openWindow(); }
        };
        document.addEventListener("keydown", this.keyHandler);
        this.saveTimer = setInterval(() => { if (this.dirty) this.save(); }, 15000);
        this.storeListeners = [];
        for (const store of [this.adapter.stores.SearchStore, this.adapter.stores.SearchQueryStore, this.adapter.stores.SelectedSearchContextStore, this.adapter.stores.SearchMessageStore, this.adapter.stores.MessageStore]) {
            if (typeof store?.addChangeListener !== "function" || typeof store?.removeChangeListener !== "function") continue;
            const listener = () => { try { this.checkScope(); this.scheduleRead(); } catch (error) { this.stopCollection(error.message); } };
            try { store.addChangeListener(listener); this.storeListeners.push([store, listener]); } catch { /* Polling fallback. */ }
        }
        if (this.storageBlocked) this.openWindow();
    }
    stop() {
        if (!this.active) return;
        this.stopCollection(); this.active = false; this.generation++;
        this.liveDiagnostics?.stop(); clearInterval(this.heartbeatTimer);
        clearInterval(this.saveTimer); clearInterval(this.pollTimer); clearTimeout(this.readTimer); clearTimeout(this.renderTimer);
        // BetterDiscord reuses this instance on disable/enable. A cancelled timer
        // handle must not keep renderSoon's pending-work guard permanently true.
        this.renderTimer = null; this.readTimer = null;
        clearInterval(this.backupTimer);
        for (const [store, listener] of this.storeListeners || []) { try { store.removeChangeListener(listener); } catch { /* Client update. */ } }
        this.storeListeners = [];
        for (const [url, timer] of this.downloads) { clearTimeout(timer); URL.revokeObjectURL(url); } this.downloads.clear();
        for (const [input, resolve] of this.fileInputs) { input.remove(); resolve(null); } this.fileInputs.clear();
        document.removeEventListener("keydown", this.keyHandler);
        this.windowCleanup?.(); this.windowCleanup = null;
        this.launcher?.remove(); this.window?.remove(); this.window = null;
        for (const panel of this.panels) panel.root.remove();
        this.panels.clear(); this.settingsRoot = null; this.api.DOM?.removeStyle?.(); this.backupPath = null; this.backupCollection = null;
    }
    onSwitch() {
        if (!this.running) return;
        try { this.adapter.ensureSelected(this.collection.state.selection); this.scheduleRead(); }
        catch (error) { this.stopCollection(error.message); }
    }
    observer(mutation) {
        if (!this.running) return;
        const target = mutation?.target?.nodeType === 3 ? mutation.target.parentElement : mutation?.target;
        if (target?.closest?.(".ytlc") || target?.classList?.contains("ytlc-launcher")) return;
        this.scheduleRead();
    }
    scheduleRead() {
        if (!this.running || this.readTimer || this.busy) return;
        // A timer ensures a quiet interval is not required for a busy channel.
        this.readTimer = setTimeout(() => { this.readTimer = null; void this.read(); }, 350);
    }
    async read() {
        if (!this.running || this.busy) return;
        this.busy = true; this.lastCheckAt = Date.now(); const generation = this.generation, collection = this.collection;
        try {
            const search = this.checkScope();
            this.liveSearch = search;
            const batch = this.adapter.read(collection.state.selection, collection.state.config);
            for (const warning of batch.warnings) collection.warn(warning);
            collection.state.checkpoint.searchCursor = batch.searchCursor;
            const merged = [...new Map([...batch.messages, ...(search?.messages || [])].map(x => [x.id, x])).values()];
            const changed = await collectBatch(collection, merged, {cancelled: () => !this.running || generation !== this.generation, onProgress: () => this.renderSoon()});
            if (changed || batch.warnings.length) this.dirty = true;
            if (changed) this.lastProgressAt = Date.now();
            if (!this.running || generation !== this.generation) return;
            if (this.navigator) {
                const navigator = this.navigator, decision = navigator.tick(search);
                if (decision.type === "error") { collection.fail(new Error(decision.message)); this.stopCollection(null, true); return; }
                if (decision.type === "capture") {
                    const current = this.adapter.inspectSearch(collection.state.selection);
                    if (!current?.loaded || !current.fullPage || !current.navigationReady || current.totalPages !== search.totalPages || current.scope?.key !== search.scope.key || current.pageKey !== search.pageKey || pageEvidence(current) !== pageEvidence(search)) return;
                    const tracker = new SearchTracker(collection); tracker.commit(current);
                    const page = tracker.active()?.pages.find(x => x.key === current.pageKey);
                    if (page?.status !== "processed") throw new Error("Nie potwierdzono odczytu wszystkich wiadomości strony. Automatyczne przejście zostało zablokowane.");
                    this.lastSearch = current;
                    this.lastProgressAt = Date.now();
                    const action = navigator.afterCommit(current);
                    const beforeNavigation = JSON.stringify(tracker.state);
                    tracker.active().navigation = {phase: navigator.phase, fromPage: current.pageNumber, expectedPage: action.expectedPage ?? null, direction: action.direction ?? null, updatedAt: now()};
                    tracker.budget(beforeNavigation);
                    this.dirty = true;
                    if (!this.save() || !this.running || generation !== this.generation || this.navigator !== navigator) return;
                    if (action.type === "error") { collection.fail(new Error(action.message)); this.stopCollection(null,true); }
                    else if (action.type === "navigate") {
                        const ready = await this.waitNavigationDelay(navigator.delaySatisfiedForPage === current.pageKey ? 0 : choosePageDelay(collection.state.config));
                        if (!ready || !this.running || generation !== this.generation || this.navigator !== navigator) return;
                        navigator.delaySatisfiedForPage = current.pageKey;
                        // The loading timeout starts at the UI action, after the pacing delay.
                        navigator.started = Date.now();
                        try { this.adapter.navigate(current, action.direction); navigator.rechecks = 0; navigator.delaySatisfiedForPage = null; this.recheckNotice = null; } // Revalidates after the delay.
                        catch (error) {
                            if (error.code !== "PAGE_UNSTABLE_BEFORE_CLICK" || (navigator.rechecks || 0) >= 3) throw error;
                            navigator.rechecks = (navigator.rechecks || 0) + 1;
                            navigator.phase = "reading"; navigator.candidate = null; navigator.started = Date.now();
                            this.recheckNotice = "Zawartość zmieniła się podczas przerwy. Ponownie sprawdzam tę stronę; nie kliknięto następnej.";
                        }
                    }
                    else if (action.type === "finish") {
                        this.stopCollection("Zakończono przejście dostępnych stron tego wyszukiwania. Kolekcja pozostaje INCOMPLETE: indeks, pozostałe zakresy i pełna historia nie są potwierdzone.");
                        this.autoFinished = collection.state.status !== "failed";
                        this.api.UI?.showToast?.(this.autoFinished ? "Odczyt stron zakończony. Przygotowuję pełny eksport kolekcji." : "Końcowy checkpoint nie został zapisany. Eksportuję dane pozostające w pamięci.", {type:this.autoFinished ? "success" : "warning"});
                        void this.export(this.autoExportFormat || "txt");
                    }
                }
                return;
            }
            if (search?.scope && search.pageKey) {
                const tracker = new SearchTracker(collection), before = JSON.stringify(tracker.state);
                tracker.observe(search);
                const signature = JSON.stringify([search.scope.key, search.pageKey, pageEvidence(search), search.loaded]);
                const time = Date.now();
                if (this.searchCandidate?.signature !== signature) this.searchCandidate = {signature, since: time, pageSince: this.searchCandidate?.pageKey === search.pageKey ? this.searchCandidate.pageSince : time, pageKey: search.pageKey};
                else if (search.loaded && time - this.searchCandidate.since >= 900) {
                    const current = this.adapter.inspectSearch(collection.state.selection, this.manualSearch);
                    if (current?.scope?.key === search.scope.key && current.pageKey === search.pageKey && current.loaded && pageEvidence(current) === pageEvidence(search)) {
                        tracker.commit(search); this.lastSearch = search;
                    }
                }
                if (!search.loaded && time - this.searchCandidate.pageSince >= 20000) {
                    const page = tracker.active()?.pages.find(x => x.key === search.pageKey);
                    if (page) page.status = "timeout";
                    collection.warn("Timeout ładowania strony (20 s). Wróć do niej i sprawdź ponownie; nie zaliczono odczytu.");
                }
                if (before !== JSON.stringify(tracker.state)) this.dirty = true;
            } else if (search?.warning) collection.warn(search.warning);
        } catch (error) {
            if (collection.state.status === "interrupted") this.stopCollection(collection.state.completeness.reason);
            else if (/Zmieniono otwarty kanał/.test(error.message)) this.stopCollection(error.message);
            else { collection.fail(error); this.stopCollection(null, true); }
        } finally { this.busy = false; this.renderSoon(); }
    }
    checkScope() {
        if (!this.collection.state.selection || !this.collection.state.config.search) return null;
        this.adapter.ensureSelected(this.collection.state.selection);
        const search = this.adapter.inspectSearch(this.collection.state.selection, this.manualSearch);
        const key = search?.scope?.key || null;
        if (this.running && this.boundScope && key !== this.boundScope && !(this.navigator?.phase === "waiting" && search?.loading === true)) throw new Error("Zmieniono lub zamknięto zakres wyszukiwania. Zatrzymano odczyt. Dane zachowano; Wznów przyjmie nowy zakres.");
        if (this.running && !this.boundScope && key) this.boundScope = key;
        return search;
    }
    pauseCollection() {
        this.stopCollection("Dane zachowano. Wznów odczyt lub ponownie wybierz Zbierz wszystkie strony dla otwartego wyszukiwania.");
        this.paused = true; this.renderSoon();
    }
    waitNavigationDelay(seconds) {
        if (seconds === 0) return Promise.resolve(true);
        return new Promise(resolve => {
            const pending = {seconds, dueAt: Date.now() + seconds * 1000, resolve};
            this.navigationDelay = pending;
            pending.timer = setTimeout(() => {
                if (this.navigationDelay !== pending) return;
                clearInterval(pending.ticker); this.navigationDelay = null; this.renderSoon(); resolve(true);
            }, seconds * 1000);
            pending.ticker = setInterval(() => this.renderSoon(), 1000);
            this.renderSoon();
        });
    }
    cancelNavigationDelay() {
        const pending = this.navigationDelay;
        if (!pending) return;
        this.navigationDelay = null; clearTimeout(pending.timer); clearInterval(pending.ticker); pending.resolve(false);
    }
    save() {
        if (this.storageBlocked) return false;
        try {
            this.persistence.save(this.collection); this.dirty = false; this.lastSavedAt = now(); this.renderSoon(); return true;
        } catch (error) {
            this.running = false; this.generation++; clearInterval(this.pollTimer);
            this.cancelNavigationDelay(); this.navigator?.cancel(); this.navigator = null;
            this.collection.fail(new Error(`Błąd zapisu: ${error.message} Dane pozostają w pamięci — wyeksportuj JSON.`));
            this.dirty = true; this.renderSoon(); return false;
        }
    }
    stopCollection(reason, keepFailure = false) {
        this.cancelNavigationDelay();
        const wasRunning = this.running;
        if (this.navigator) {
            const scope = new SearchTracker(this.collection).active();
            if (scope?.navigation && this.navigator.phase !== "finished") scope.navigation.phase = "interrupted";
            this.navigator.cancel(); this.navigator = null;
        }
        this.running = false; this.generation++; clearInterval(this.pollTimer); clearTimeout(this.readTimer); this.readTimer = null;
        if (wasRunning && !keepFailure) this.collection.interrupt(reason);
        if (wasRunning || this.dirty) { this.dirty = true; this.save(); }
        this.renderSoon();
    }
    selectChannel() {
        try {
            const selection = this.adapter.selection();
            if (this.collection.state.selection?.channelID === selection.channelID) return;
            const apply = () => {
                if (!this.active) return;
                this.stopCollection();
                this.disableBackup();
                const fresh = new Collection(selection, this.collection.state.config);
                try { this.persistence.reset(fresh); this.collection = fresh; this.storageBlocked = false; this.dirty = false; this.renderSoon(); }
                catch (error) { this.showError(error.message); }
            };
            if (this.collection.seen.size || this.storageBlocked) this.confirm("Zmiana kanału", "Zmiana kanału usunie bieżącą kolekcję. Najpierw wyeksportuj JSON, aby zachować dane.", apply);
            else apply();
        } catch (error) { this.showError(error.message); }
    }
    startCollection(resume = true, {mode = "local", search = null, format = "txt", fromBeginning = false} = {}) {
        if (this.running || this.ioBusy) return;
        if (this.storageBlocked) return this.showError("Uszkodzony zapis jest chroniony. Najpierw importuj poprawny JSON lub zresetuj dane.");
        const begin = () => {
            if (!this.active) return;
            try {
                this.adapter = new LocalAdapter(this.api);
                if (!this.collection.state.selection) this.collection = new Collection(this.adapter.selection(), this.collection.state.config);
                this.adapter.ensureSelected(this.collection.state.selection);
                this.boundScope = search?.scope?.key || null; this.searchCandidate = null; this.lastSearch = null; this.paused = false; this.autoFinished = false; this.recheckNotice = null;
                this.collection.state.checkpoint.runMode = mode;
                if (mode === "auto") {
                    this.collection.state.checkpoint.exportFormat = format;
                    const tracker = new SearchTracker(this.collection); tracker.observe(search);
                    const beforeNavigation = JSON.stringify(tracker.state);
                    if (tracker.active() && Number.isSafeInteger(search.pageNumber)) tracker.active().navigation = {phase: "reading", fromPage: search.pageNumber, expectedPage: null, direction: null, updatedAt: now()};
                    tracker.budget(beforeNavigation);
                    this.navigator = new UIPageNavigator({fromBeginning, timeoutMs: pageLoadTimeout(this.collection.state.config) * 1000});
                    this.autoExportFormat = format;
                }
                this.runStartedAt = Date.now(); this.lastProgressAt = this.runStartedAt;
                this.collection.begin(); this.running = true; this.generation++; this.dirty = true;
                if (!this.save()) return;
                this.pollTimer = setInterval(() => this.scheduleRead(), 2000);
                this.scheduleRead(); this.renderSoon();
            } catch (error) { this.showError(error.message); }
        };
        begin(); // Start and Resume both preserve records; Reset is the explicit destructive path.
    }
    startAllPages(format = "txt", {fromBeginning = false, resume = false} = {}) {
        if (this.running || this.busy || this.ioBusy || this.storageBlocked) return;
        try {
            const selection = this.collection.state.selection || this.adapter.selection();
            this.adapter.ensureSelected(selection);
            const search = this.adapter.inspectSearch(selection);
            if (!search?.scope || !search.navigationReady || !search.totalPages) throw new Error(search?.warning || "Nie odczytano kontekstu lub paginacji otwartej wyszukiwarki. Szczegóły są w Diagnostyce.");
            const previousScope = new SearchTracker(this.collection).active();
            if (resume && previousScope && previousScope.key !== search.scope.key) throw new Error("Otwarta wyszukiwarka ma inne filtry lub sortowanie niż zapis. Przywróć poprzedni zakres albo rozpocznij nowy odczyt od bieżącej strony.");
            this.manualSearch = null;
            this.startCollection(true, {mode: "auto", search, fromBeginning, format: ["txt","csv","json"].includes(format) ? format : "txt"});
            this.renderSoon();
        } catch (error) { this.showError(error.message); }
    }
    resumeCollection(format = this.collection.state.checkpoint.exportFormat || "txt") {
        if (this.canResumeAuto()) this.startAllPages(format, {resume: true});
        else this.startCollection(true);
    }
    canResumeAuto() { return this.collection.state.checkpoint.runMode === "auto" || this.collection.state.checkpoint.runMode == null && !!new SearchTracker(this.collection).active()?.navigation; }
    restartAllPages(format) {
        this.api.UI?.showConfirmationModal?.("Zbieranie od początku", "Kolektor cofnie wyszukiwarkę do strony 1. Dotychczasowe linki zostaną zachowane. Aby kontynuować obecną stronę, wybierz Anuluj i Wznów zbieranie.", {confirmText: "Od początku", cancelText: "Anuluj", danger: false, onConfirm: () => { if (this.active) this.startAllPages(format, {fromBeginning: true}); }});
    }
    activitySnapshot(time = Date.now()) {
        const delay = this.navigationDelay, search = this.liveSearch, nav = this.navigator;
        const finished = new SearchTracker(this.collection).active()?.navigation?.phase === "finished";
        const phase = this.ioBusy ? "export" : !this.running ? this.collection.state.status === "failed" ? "error" : this.paused ? "paused" : finished ? "finished" : "stopped" : delay ? "delay" : !nav ? "local" : nav.phase === "waiting" ? "transition" : !search?.loaded || !search?.fullPage ? "loading" : nav.candidate ? "stabilizing" : "reading";
        const titles = {export: "Przygotowuję eksport", error: "Zatrzymano po błędzie — dane zachowane", paused: "Pauza — możesz wznowić od obecnej strony", finished: "Przebieg zakończony — zebrane linki są gotowe do eksportu", stopped: this.collection.state.status === "idle" ? "Oczekuję na uruchomienie" : "Zatrzymano — Wznów kontynuuje od obecnej strony", delay: "Strona zapisana — przerwa przed przejściem", local: "Monitoruję załadowane wiadomości — bez przełączania stron", transition: "Czekam na potwierdzenie nowej strony", loading: "Czekam na pełne wyniki tej strony", stabilizing: "Sprawdzam stabilność wyników", reading: "Odczytuję bieżącą stronę"};
        return {phase, title: titles[phase], checkedSecondsAgo: this.lastCheckAt == null ? null : Math.max(0, Math.floor((time - this.lastCheckAt) / 1000)), progressSecondsAgo: this.lastProgressAt == null ? null : Math.max(0, Math.floor((time - this.lastProgressAt) / 1000)), remainingDelaySeconds: delay ? Math.max(0, Math.ceil((delay.dueAt - time) / 1000)) : null, waitingSeconds: nav?.started == null ? 0 : Math.max(0, Math.floor((time - nav.started) / 1000)), timeoutSeconds: nav ? nav.timeoutMs / 1000 : pageLoadTimeout(this.collection.state.config)};
    }
    diagnosticSnapshot() {
        let availability = "ready", scopeMatchesCheckpoint = null;
        try {
            const selection = this.collection.state.selection || this.adapter.selection();
            const search = this.adapter.inspectSearch(selection), previous = new SearchTracker(this.collection).active();
            scopeMatchesCheckpoint = previous && search?.scope ? previous.key === search.scope.key : null;
        } catch { availability = "selection-unavailable"; }
        const raw = this.adapter?.searchDiagnostics || {}, search = {};
        for (const key of ["root", "props", "queryStore", "contextStore", "pagination", "busy", "backgroundIndexing", "coherent", "queryOffset", "propsOffset", "paginationOffset", "currentPage", "paginationBase", "filtersCoherent", "payload", "unresolved", "recovered", "pageSize", "reportedTotal", "totalPages", "hidden", "next", "loaded", "fullPage", "readMessages", "expectedHits", "sortKnown"]) {
            if (typeof raw[key] === "boolean" || raw[key] === null || Number.isFinite(raw[key])) search[key] = raw[key];
        }
        search.busyReasons = (raw.busyReasons || []).filter(x => /^(legacy-searching|store-fetching|store-indexing|store-error|props-searching|props-indexing|props-error)$/.test(x));
        search.unresolvedReasons = Object.fromEntries(Object.entries(raw.unresolvedReasons || {}).filter(([k,v]) => ["missing-id", "different-channel", "incomplete-message", "missing-in-store"].includes(k) && Number.isSafeInteger(v)));
        search.unresolvedDetails = raw.unresolvedDetails || [];
        for (const key of ["resolvedHits", "outsideChannel"]) if (Number.isSafeInteger(raw[key])) search[key] = raw[key];
        const panels = [...this.panels].map(panel => ({connected: !!panel.root.isConnected, activeTab: ["run","links","settings","diagnostics"].includes(panel.activeTab) ? panel.activeTab : null, lastRenderedSecondsAgo: panel.lastRenderedAt == null ? null : Math.max(0, Math.floor((Date.now() - panel.lastRenderedAt) / 1000)), error: panel.renderError || null}));
        const reason = this.collection.state.completeness.reason;
        const errorCode = this.collection.state.status !== "failed" ? null : /Timeout przejścia/.test(reason) ? "TRANSITION_TIMEOUT" : /Timeout odczytu/.test(reason) ? "READ_TIMEOUT" : /zapisu|checkpointu/.test(reason) ? "CHECKPOINT_ERROR" : /zakres|sortowanie|filtry/.test(reason) ? "SCOPE_CHANGED" : /Wyniki zmieniły/.test(reason) ? "PAGE_CHANGED" : "OTHER";
        return {plugin: NAME, version: VERSION, active: this.active, running: this.running, status: this.collection.state.status, errorCode, availability, scopeMatchesCheckpoint, panels, activity: this.activitySnapshot(), counts: this.collection.stats(), checkedMessages: this.collection.seen.size, search, stores: Object.fromEntries(Object.entries(this.adapter?.stores || {}).map(([name, value]) => [name, !!value]))};
    }
    recover(name, exportOnly = false) {
        if (this.running || this.busy || this.ioBusy) return;
        try {
            const recovered = this.persistence.restoreCandidate(name);
            if (exportOnly) { void this.export("json", recovered); return; }
            if (!recovered.state.selection) throw new Error("Wybrany zapis nie zawiera kanału.");
            this.adapter.ensureSelected(recovered.state.selection);
            this.confirm("Odtworzyć wybrany checkpoint?", `${name}: ${recovered.records.size} wystąpień. Bieżąca kolekcja ma ${this.collection.records.size}. Zastąpienie wymaga potwierdzenia; najpierw wyeksportuj obie kopie JSON.`, () => {
                try {
                    this.adapter.ensureSelected(recovered.state.selection);
                    this.persistence.reset(recovered); this.disableBackup(); this.collection = recovered;
                    this.storageBlocked = false; this.dirty = false; this.lastSearch = null; this.manualSearch = null; this.renderSoon();
                } catch (error) { this.showError(error.message); }
            });
        } catch (error) { this.showError(error.message); }
    }
    confirm(title, text, action) {
        if (typeof this.api.UI?.showConfirmationModal !== "function") return this.showError("Brak API potwierdzenia. Operacja zastępująca dane jest zablokowana.");
        const generation = this.generation, collection = this.collection;
        this.api.UI.showConfirmationModal(title, text, {confirmText: "Potwierdź", cancelText: "Anuluj", danger: true, onConfirm: () => { if (this.active && this.generation === generation && this.collection === collection) action(); }});
    }
    reset() {
        this.confirm("Usunąć wszystkie zebrane dane?", "Usunięte zostaną wyniki i obie kopie zapisu. Eksport JSON pozwala później odtworzyć kolekcję.", () => {
            this.stopCollection();
            this.disableBackup();
            const fresh = new Collection(this.collection.state.selection, this.collection.state.config);
            try {
                this.persistence.reset(fresh, {eraseLegacy: true}); this.collection = fresh; this.storageBlocked = false; this.dirty = false; this.renderSoon();
            } catch (error) { this.showError(`Nie udało się zresetować zapisu: ${error.message}`); }
        });
    }
    showError(message) { this.collection.warn(str(message, 1000)); this.api.UI?.showToast?.(message, {type: "error"}); this.renderSoon(); }
    fileSystem() { try { return require("fs"); } catch { return null; } }
    async copyText(text) {
        try { if (typeof navigator?.clipboard?.writeText === "function") { await navigator.clipboard.writeText(text); return true; } } catch { /* Clipboard permission denied: local selection fallback. */ }
        if (typeof document.execCommand !== "function") return false;
        const input = element("textarea"); input.value = text; input.style.position = "fixed"; input.style.left = "-10000px"; document.body.append(input);
        try { input.select(); return document.execCommand("copy") === true; } catch { return false; } finally { input.remove(); }
    }
    async copyLinks(text) {
        if (await this.copyText(text)) this.api.UI?.showToast?.("Skopiowano do schowka.", {type: "success"});
        else { this.pendingExport = {text, name: "linki.txt", format: "txt"}; this.showError("Schowek niedostępny. Zaznacz treść w polu eksportu i naciśnij Ctrl+C."); }
    }
    downloadExport(text, name, format) {
        if (typeof URL.createObjectURL !== "function" || typeof Blob !== "function") return false;
        let url;
        try {
            url = URL.createObjectURL(new Blob([text], {type: `${format === "json" ? "application/json" : format === "csv" ? "text/csv" : "text/plain"};charset=utf-8`}));
            const anchor = element("a"); anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove();
            const timer = setTimeout(() => { URL.revokeObjectURL(url); this.downloads.delete(url); }, 60000); this.downloads.set(url, timer); return true;
        } catch { if (url) URL.revokeObjectURL(url); return false; }
    }
    async export(format, collection = this.collection) {
        if (this.ioBusy) return;
        this.ioBusy = true; const generation = this.generation; this.renderSoon();
        try {
            await pause();
            const text = exportData(collection, format), name = filename(collection, format);
            this.pendingExport = {text, name, format};
            const io = new ExportIO({ui: this.api.UI, fs: this.fileSystem(), download: (...args) => this.downloadExport(...args), clipboard: value => this.copyText(value), cancelled: () => !this.active || this.generation !== generation});
            const result = await io.save(text, name, format);
            if (io.dialogError) this.collection.warn(`Natywny dialog niedostępny: ${io.dialogError}. Użyto alternatywnego eksportu.`);
            const messages = {saved: "Zapisano eksport UTF-8.", download: "Przekazano plik do pobrania. Sprawdź pobrane pliki; zapis na dysku nie został potwierdzony.", copied: "Skopiowano pełny eksport do schowka. Zapisz go jako UTF-8.", manual: "Zapis i schowek niedostępne. Zaznacz treść eksportu i skopiuj ją ręcznie."};
            if (result !== "cancelled") this.api.UI?.showToast?.(messages[result], {type: result === "saved" || result === "copied" ? "success" : "info"});
        } catch (error) { this.showError(`Eksport nie został zapisany: ${error.message}`); }
        finally { this.ioBusy = false; this.renderSoon(); }
    }
    async importJSON(browserPicker = false) {
        if (this.ioBusy || this.running || this.busy) return;
        this.ioBusy = true; this.renderSoon();
        try {
            const fs = this.fileSystem(), caps = fileCapabilities(fs);
            let text;
            if (!browserPicker && typeof this.api.UI?.openDialog === "function" && (caps.promiseRead || caps.callbackRead)) {
                const result = await this.api.UI.openDialog({mode: "open", title: "Odtwórz kolekcję JSON", openFile: true, multiSelections: false, filters: [{name: "JSON", extensions: ["json"]}]});
                const path = dialogPath(result, "open");
                if (!path || !this.active) return;
                text = await readCompatibleFile(fs, path);
            } else text = await this.pickJSON();
            if (text == null || !this.active) return;
            const parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
            const imported = Collection.restore(parsed.collection || parsed);
            if (!imported.state.selection) throw new Error("JSON nie zawiera wybranego kanału.");
            const current = this.adapter.selection();
            if (current.channelID !== imported.state.selection.channelID || current.serverID !== imported.state.selection.serverID) throw new Error("Otwórz kanał wskazany w JSON przed importem. Inny kanał nie został wybrany.");
            imported.warn("Import zastępuje kolekcję. Dane oraz dowody bota pochodzą z pliku; wtyczka nie potwierdza ich na serwerze.");
            this.confirm("Zastąpić kolekcję danymi z JSON?", `Kanał: ${imported.state.selection.channelName}. Wystąpienia: ${imported.records.size}. Zastąpienie usuwa bieżące wyniki; zachowaj wcześniejszy eksport.`, () => {
                try {
                    this.adapter.ensureSelected(imported.state.selection);
                    this.persistence.reset(imported); this.disableBackup(); this.collection = imported; this.storageBlocked = false; this.dirty = false; this.renderSoon();
                } catch (error) { this.showError(`Import nie został zapisany: ${error.message}`); }
            });
        } catch (error) { this.showError(`Import odrzucony: ${error.message}`); }
        finally { this.ioBusy = false; this.renderSoon(); }
    }
    pickJSON() {
        return new Promise((resolve, reject) => {
            const input = element("input"); input.type = "file"; input.accept = ".json,application/json"; input.style.display = "none";
            const finish = () => { this.fileInputs.delete(input); input.remove(); };
            this.fileInputs.set(input, resolve);
            input.addEventListener("cancel", () => { finish(); resolve(null); }, {once: true});
            input.addEventListener("change", async () => {
                const file = input.files?.[0];
                try {
                    if (!file) return resolve(null);
                    if (file.size > 256 * 1024 * 1024) throw new Error("Plik przekracza 256 MiB.");
                    const text = await file.text();
                    if (byteSize(text) > 256 * 1024 * 1024) throw new Error("Plik przekracza 256 MiB.");
                    resolve(text);
                } catch (error) { reject(error); } finally { finish(); }
            }, {once: true});
            document.body.append(input); input.click();
        });
    }
    setManualScope(panel) {
        const page = Number(panel.manualPage.value), total = panel.manualTotal.value === "" ? null : Number(panel.manualTotal.value), query = panel.manualQuery.value.trim();
        if (!query || !Number.isSafeInteger(page) || page < 1 || page > 100000 || total !== null && (!Number.isSafeInteger(total) || total < 0)) return this.showError("Podaj opis zakresu z filtrami i sortowaniem oraz prawidłowy numer strony. Licznik wyników jest opcjonalny.");
        if (this.running && query !== this.manualSearch?.query) this.stopCollection("Zmieniono własny opis zakresu. Wznów, aby przyjąć nowy zakres.");
        this.manualSearch = {query, page, total}; this.lastSearch = null; this.searchCandidate = null;
        this.scheduleRead(); this.renderSoon();
    }
    confirmPage() {
        try {
            const search = this.adapter.inspectSearch(this.collection.state.selection, this.manualSearch);
            const prior = this.lastSearch;
            if (!search?.pageNumber || !prior || prior.scope.key !== search.scope?.key || prior.pageKey !== search.pageKey || !search.loaded || JSON.stringify(prior.messages.map(x => x.id).sort()) !== JSON.stringify(search.messages.map(x => x.id).sort())) throw new Error("Najpierw uruchom odczyt i poczekaj na stabilne wyniki bieżącej strony. Jeśli numer jest nieznany, wpisz go we własnym oznaczeniu.");
            this.confirm("Potwierdzić odczyt strony?", "Potwierdź dopiero po sprawdzeniu wszystkich wyników tej strony (w tym przewinięciu listy). To Twoje potwierdzenie zakresu widocznego w kliencie, a nie dowód kompletnej historii kanału.", () => {
                const current = this.adapter.inspectSearch(this.collection.state.selection, this.manualSearch);
                if (!current?.loaded || current.scope?.key !== search.scope.key || current.pageKey !== search.pageKey || JSON.stringify(current.messages.map(x => x.id).sort()) !== JSON.stringify(search.messages.map(x => x.id).sort())) return this.showError("Strona zmieniła się podczas potwierdzania. Poczekaj na ponowny odczyt.");
                if (new SearchTracker(this.collection).commit(current, true)) { this.dirty = true; this.save(); } this.renderSoon();
            });
        } catch (error) { this.showError(error.message); }
    }
    async configureBackup() {
        if (this.ioBusy) return;
        const fs = this.fileSystem(), caps = fileCapabilities(fs);
        if (typeof this.api.UI?.openDialog !== "function" || !(caps.promiseWrite || caps.callbackWrite)) return this.showError("Okresowe kopie wymagają działającego filesystemu i natywnego wyboru pliku.");
        this.ioBusy = true; const generation = this.generation, collection = this.collection; this.renderSoon();
        try {
            const path = dialogPath(await this.api.UI.openDialog({mode: "save", title: "Kopia JSON: wybrany plik będzie aktualizowany co 5 minut", defaultPath: filename(this.collection, "json"), filters: [{name: "JSON", extensions: ["json"]}], showOverwriteConfirmation: true}), "save");
            if (!path || !this.active || generation !== this.generation || collection !== this.collection) return;
            await writeCompatibleFile(fs, path, exportData(this.collection, "json"));
            if (!this.active || generation !== this.generation || collection !== this.collection) return;
            this.backupPath = path; this.backupCollection = this.collection;
            clearInterval(this.backupTimer);
            this.backupTimer = setInterval(() => { void this.runBackup(); }, 5 * 60000);
            this.api.UI?.showToast?.("Zapisano kopię JSON. Ten plik będzie aktualizowany co 5 minut w tej sesji.", {type: "success"});
        } catch (error) { this.showError(`Nie uruchomiono kopii: ${error.message}`); }
        finally { this.ioBusy = false; this.renderSoon(); }
    }
    async runBackup() {
        if (!this.active || !this.backupPath || this.ioBusy) return;
        if (this.backupCollection !== this.collection) return this.disableBackup();
        this.ioBusy = true;
        try { await writeCompatibleFile(this.fileSystem(), this.backupPath, exportData(this.collection, "json")); }
        catch (error) { this.disableBackup(); this.showError(`Kopie okresowe zatrzymane: ${error.message}`); }
        finally { this.ioBusy = false; this.renderSoon(); }
    }
    disableBackup() { clearInterval(this.backupTimer); this.backupPath = null; this.backupCollection = null; this.renderSoon(); }
    getSettingsPanel() {
        if (!this.settingsRoot) this.settingsRoot = this.buildPanel(false);
        return this.settingsRoot;
    }
    openWindow() {
        if (this.window?.isConnected) { this.window.querySelector("button")?.focus(); return; }
        this.window = this.buildPanel(true); document.body.append(this.window);
        this.windowCleanup = movableWindow(this.window, this.window.querySelector(".ytlc-head"), position => { this.windowPosition = position; }, this.windowPosition);
        this.window.querySelector("button")?.focus(); this.renderSoon();
    }
    buildPanel(windowed) {
        const root = element("section", null, `ytlc${windowed ? " ytlc-window" : ""}`);
        root.setAttribute("aria-label", "Kolektor linków YouTube");
        if (windowed) { root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "false"); }
        const panel = {root, page: 0, query: "", duplicates: false, resultRevision: -1, activeTab: "run", scrollPositions: {}};
        const head = element("div", null, "ytlc-head"), title = element("div", null, "ytlc-title"); title.append(element("h2", "YouTube Link Collector"));
        title.append(element("small", `v${VERSION} · ProGraMajster${windowed ? " · przeciągnij nagłówek, aby przesunąć" : ""}`));
        head.append(title);
        const button = (text, action, className) => {
            const node = element("button", text, className); node.type = "button"; node.addEventListener("click", action); return node;
        };
        if (windowed) {
            const close = () => { this.windowCleanup?.(); this.windowCleanup = null; root.remove(); this.panels.delete(panel); this.window = null; this.launcher?.focus(); };
            head.append(button("Zamknij", close));
            root.addEventListener("keydown", event => { if (event.key === "Escape") { event.stopPropagation(); close(); } });
        } else head.append(button("Otwórz okno", () => this.openWindow()));
        root.append(head, element("p", "Zbieraj wiadomości już załadowane w wybranym kanale. Wyszukuj i przechodź strony ręcznie; wyniki lokalne pozostają niepełne.", "ytlc-muted"));
        panel.channel = element("p", null, "ytlc-channel"); root.append(panel.channel);
        root.append(element("h3", "Skanowanie"), element("p", "Tryb półautomatyczny: zmieniaj strony w wyszukiwarce Discorda; odczyt i checkpointy działają automatycznie.", "ytlc-muted"));
        panel.scanning = element("p"); panel.coverage = element("p"); root.append(panel.scanning, panel.coverage);
        panel.scopeSelect = element("select"); panel.scopeSelect.setAttribute("aria-label", "Historia zakresów wyszukiwania");
        panel.scopeSelect.addEventListener("change", () => { panel.scopeKey = panel.scopeSelect.value || null; this.renderPanel(panel); }); root.append(panel.scopeSelect);
        const manual = element("details"); manual.append(element("summary", "Własne oznaczenie, gdy klient nie udostępnia zakresu lub numeru strony"));
        panel.manualQuery = element("input"); panel.manualQuery.placeholder = "np. in:muzyka youtube.com, bez autora, najstarsze"; panel.manualQuery.value = this.manualSearch?.query || "";
        panel.manualQuery.setAttribute("aria-label", "Własny opis zakresu i sortowania");
        panel.manualPage = element("input"); panel.manualPage.type = "number"; panel.manualPage.min = "1"; panel.manualPage.placeholder = "Numer strony"; panel.manualPage.setAttribute("aria-label", "Numer strony Discorda");
        panel.manualTotal = element("input"); panel.manualTotal.type = "number"; panel.manualTotal.min = "0"; panel.manualTotal.placeholder = "Licznik wyników (opcjonalny)"; panel.manualTotal.setAttribute("aria-label", "Licznik wyników Discorda");
        manual.append(element("p", "Dane wpisane ręcznie są oznaczane jako deklaracja użytkownika. Przy każdej zmianie strony zaktualizuj numer. Jeśli zmienisz filtry lub sortowanie, zmień również opis zakresu."), panel.manualQuery, panel.manualPage, panel.manualTotal, button("Zastosuj oznaczenie", () => this.setManualScope(panel)));
        const clearManual = button("Odczyt zakresu z klienta", () => { if (this.running) this.stopCollection("Zmieniono sposób określania zakresu. Wznów odczyt."); this.manualSearch = null; this.lastSearch = null; this.renderSoon(); });
        manual.append(clearManual); root.append(manual);
        panel.confirmPage = button("Potwierdź odczyt strony", () => this.confirmPage()); root.append(panel.confirmPage);
        const actions = element("div", null, "ytlc-actions");
        panel.select = button("Wybierz otwarty kanał", () => this.selectChannel());
        panel.start = button("Start", () => this.startCollection(true), "ytlc-primary");
        panel.pause = button("Pauza", () => this.pauseCollection());
        panel.stop = button("Stop", () => this.stopCollection());
        panel.resume = button("Wznów zbieranie", () => this.resumeCollection(panel.format?.value));
        panel.reset = button("Reset", () => this.reset(), "ytlc-danger");
        actions.append(panel.select, panel.start, panel.pause, panel.stop, panel.resume, panel.reset); root.append(actions);
        panel.status = element("div", null, "ytlc-status"); panel.status.setAttribute("role", "status"); panel.status.setAttribute("aria-live", "polite"); root.append(panel.status);
        const stats = element("div", null, "ytlc-stats"); panel.stats = {};
        for (const [key, text] of [["messages", "Wiadomości"], ["occurrences", "Wystąpienia linków YouTube"], ["unique", "Unikalne filmy / playlisty"], ["duplicates", "Powtórzenia"], ["batches", "Partie z nowymi danymi"], ["malformed", "Nieprawidłowe wiadomości"]]) {
            const stat = element("div", null, "ytlc-stat"); panel.stats[key] = element("b", "0"); stat.append(panel.stats[key], element("span", text)); stats.append(stat);
        }
        root.append(stats);
        panel.saved = element("small"); root.append(panel.saved);
        const help = element("details"), summary = element("summary", "Wyszukiwanie i pełna historia");
        panel.queries = element("div");
        help.append(summary, element("p", "W wyszukiwarce Discorda wybierz filtr in: dla tego kanału. Uruchom osobno obie poniższe kwerendy; has:link jest opcjonalnym, dodatkowym filtrem. Przejdź dostępne strony ręcznie. Filtry autora i dat ograniczają wynik. Przejście dostępnych stron nie dowodzi pełnej historii kanału."), panel.queries);
        root.append(help, element("h3", "Wyniki"));
        const controls = element("div", null, "ytlc-controls");
        panel.search = element("input"); panel.search.type = "search"; panel.search.placeholder = "Szukaj adresu, ID lub autora"; panel.search.setAttribute("aria-label", "Szukaj w zebranych wynikach");
        panel.search.addEventListener("input", () => { panel.query = panel.search.value.toLowerCase(); panel.page = 0; this.renderPanel(panel); });
        panel.mode = element("select"); panel.mode.setAttribute("aria-label", "Tryb deduplikacji");
        for (const [value, text] of [["unique", "Unikalne zasoby"], ["all", "Wszystkie wystąpienia"]]) { const option = element("option", text); option.value = value; panel.mode.append(option); }
        panel.mode.addEventListener("change", () => { this.collection.state.config.mode = panel.mode.value; this.dirty = true; panel.page = 0; this.renderSoon(); });
        controls.append(panel.search, panel.mode); root.append(controls);
        panel.copyVisible = button("Kopiuj linki z wyświetlanej strony", () => { void this.copyLinks(panel.filtered.slice(panel.page * 100, (panel.page + 1) * 100).map(x => x.normalizedURL).join("\r\n")); }); root.append(panel.copyVisible);
        const duplicateLabel = element("label"), duplicateCheck = element("input"); duplicateCheck.type = "checkbox";
        duplicateCheck.addEventListener("change", () => { panel.duplicates = duplicateCheck.checked; panel.page = 0; this.renderPanel(panel); });
        duplicateLabel.append(duplicateCheck, document.createTextNode("Tylko zasoby z wieloma wystąpieniami")); root.append(duplicateLabel);
        panel.results = element("div", null, "ytlc-results"); root.append(panel.results);
        const pager = element("div", null, "ytlc-pager");
        panel.previous = button("Poprzednia", () => { panel.page--; this.renderPanel(panel); });
        panel.next = button("Następna", () => { panel.page++; this.renderPanel(panel); });
        panel.pageLabel = element("small"); pager.append(panel.previous, panel.pageLabel, panel.next); root.append(pager);
        root.append(element("h3", "Eksport i odzyskiwanie"));
        const exports = element("div", null, "ytlc-actions"); panel.exportButtons = [];
        panel.format = element("select"); panel.format.setAttribute("aria-label", "Format eksportu");
        for (const value of ["txt", "csv", "json"]) { const option = element("option", value.toUpperCase()); option.value = value; panel.format.append(option); }
        panel.format.value = this.collection.state.checkpoint.exportFormat || "txt";
        const save = button("Eksportuj", () => { void this.export(panel.format.value); }, "ytlc-primary"); panel.exportButtons.push(save);
        panel.import = button("Import JSON", () => { void this.importJSON(); });
        const checkpoint = button("Zapisz punkt wznowienia", () => { this.dirty = true; this.save(); }); panel.checkpoint = checkpoint;
        exports.append(panel.format, save, panel.import, checkpoint); root.append(exports);
        const fallback = element("details"); fallback.append(element("summary", "Pobieranie i kopiowanie eksportu"));
        fallback.append(button("Pobierz przez przeglądarkę", () => { const format = panel.format.value; if (this.downloadExport(exportData(this.collection, format), filename(this.collection, format), format)) this.api.UI?.showToast?.("Przekazano plik do pobrania; sprawdź pobrane pliki.", {type: "info"}); else this.showError("Pobieranie niedostępne. Użyj kopiowania eksportu."); }), button("Skopiuj pełny eksport", () => { void this.copyLinks(exportData(this.collection, panel.format.value)); }));
        panel.exportText = element("textarea"); panel.exportText.readOnly = true; panel.exportText.setAttribute("aria-label", "Treść ostatniego eksportu do ręcznego skopiowania"); panel.exportText.style.width = "100%"; panel.exportText.rows = 4;
        fallback.append(panel.exportText, button("Import JSON przez wybór przeglądarki", () => { void this.importJSON(true); })); root.append(fallback);
        const backups = element("div", null, "ytlc-actions"); panel.backup = button("Włącz kopię JSON co 5 min…", () => { void this.configureBackup(); }); panel.backupStop = button("Wyłącz kopie", () => this.disableBackup()); panel.backupStatus = element("small"); backups.append(panel.backup, panel.backupStop, panel.backupStatus); root.append(backups);
        root.append(element("small", "Eksport obejmuje wszystkie wyniki zgodnie z wybranym trybem, również te ukryte filtrem. JSON zachowuje wszystkie wystąpienia i punkt wznowienia. Niepełne pliki mają INCOMPLETE w nazwie."));
        const settings = element("details"); settings.append(element("summary", "Ustawienia i prywatność")); panel.checks = {};
        for (const [key, text] of [["canonicalTXT", "Używaj adresów kanonicznych w TXT"], ["embeds", "Uwzględniaj linki z dostępnych embedów"], ["search", "Odczytuj już widoczne wyniki wyszukiwania"]]) {
            const label = element("label"), input = element("input"); input.type = "checkbox"; panel.checks[key] = input;
            input.addEventListener("change", () => {
                this.collection.state.config[key] = input.checked; this.dirty = true;
                if (key !== "canonicalTXT") this.collection.warn("Zmiana źródeł dotyczy kolejnych odczytów. Zebrane wcześniej wystąpienia pozostają zachowane.");
                this.scheduleRead(); this.renderSoon();
            });
            label.append(input, document.createTextNode(text)); settings.append(label);
        }
        settings.append(element("p", "Oczekiwanie między stronami: dla każdego przejścia wybierana jest przerwa z tego zakresu. Po zatrzymaniu zbierania wpisz wartości i wybierz Zapisz zakres."));
        const delayControls = element("div", null, "ytlc-controls"); panel.delayInputs = {};
        for (const [key, text] of [["pageDelayMinSeconds", "Minimum oczekiwania (s)"], ["pageDelayMaxSeconds", "Maksimum oczekiwania (s)"]]) {
            const label = element("label", text), input = element("input"); input.type = "number"; input.min = "0"; input.max = "300"; input.step = "1"; input.style.width = "90px"; input.setAttribute("aria-label", text); panel.delayInputs[key] = input;
            label.append(input); delayControls.append(label);
        }
        panel.delaySave = button("Zapisz zakres", () => {
            if (this.running || this.busy || this.storageBlocked) return;
            try {
                const candidate = Object.fromEntries(Object.entries(panel.delayInputs).map(([key, input]) => [key, input.value === "" ? NaN : Number(input.value)]));
                Object.assign(this.collection.state.config, pageDelayRange(candidate)); this.dirty = true; this.save();
            } catch (error) { this.showError(error.message); }
            panel.delayConfigKey = null; this.renderSoon();
        });
        delayControls.append(panel.delaySave);
        settings.append(delayControls);
        const timeoutLabel = element("label", "Limit ładowania / odczytu strony (s) ");
        panel.loadTimeout = element("input"); panel.loadTimeout.type = "number"; panel.loadTimeout.min = "15"; panel.loadTimeout.max = "300"; panel.loadTimeout.step = "1"; panel.loadTimeout.style.width = "90px";
        panel.loadTimeout.setAttribute("aria-label", "Limit ładowania strony w sekundach");
        timeoutLabel.append(panel.loadTimeout);
        panel.timeoutSave = button("Zapisz limit", () => {
            if (this.running || this.busy || this.storageBlocked) return;
            try { this.collection.state.config.pageLoadTimeoutSeconds = pageLoadTimeout({pageLoadTimeoutSeconds: Number(panel.loadTimeout.value)}); this.dirty = true; this.save(); }
            catch (error) { this.showError(error.message); }
            this.renderSoon();
        });
        settings.append(timeoutLabel, panel.timeoutSave, element("p", "Limit ładowania jest niezależny od przerwy między stronami. Niepełnych wyników nie pomijamy. Po błędzie Wznów ponownie sprawdza obecną stronę, bez cofania."));
        panel.fromBeginning = button("Zbierz od początku…", () => this.restartAllPages(panel.format.value));
        panel.newScope = button("Nowy zakres od bieżącej strony", () => this.startAllPages(panel.format.value));
        settings.append(panel.fromBeginning, panel.newScope, element("p", "Nowy zakres przyjmuje aktualne filtry i zachowuje dotychczasowe linki. Tryb ręczny poniżej odczytuje tylko załadowane wiadomości; nie przełącza stron."), panel.start);
        settings.append(element("p", "Dane pozostają lokalnie w BdApi.Data: adresy, identyfikatory wiadomości, nazwa autora i czas. Wtyczka nie przechowuje tokenów ani pełnych treści wiadomości. Limit: 50 000 wystąpień, 250 000 wiadomości i 24 MiB na punkt zapisu. Zapis co 15 s oraz przy zatrzymaniu. Nagłe zamknięcie może utracić ostatnią niezapisaną partię.", "ytlc-muted")); root.append(settings);
        const diagnostics = element("details"); diagnostics.append(element("summary", "Diagnostyka")); panel.diagnostics = element("p", "", "ytlc-diagnostics"); diagnostics.append(panel.diagnostics);
        diagnostics.append(button("Kopiuj raport diagnostyczny", () => { void this.copyLinks(JSON.stringify({observedAt: now(), ...this.diagnosticSnapshot()}, null, 2)); }));
        panel.notes = element("div", null, "ytlc-notes"); panel.notes.setAttribute("role", "log"); diagnostics.append(panel.notes);
        // Main actions and results stay visible; technical/recovery controls are collapsed.
        const mainActions = element("div",null,"ytlc-actions");
        panel.collectAll = button("Zbieraj od bieżącej strony", () => {
            if (this.canResumeAuto()) this.resumeCollection(panel.format.value);
            else this.startAllPages(panel.format.value);
        }, "ytlc-primary");
        panel.progress = element("p"); panel.progress.setAttribute("aria-live","polite");
        panel.runProgress = element("progress"); panel.runProgress.setAttribute("aria-label", "Potwierdzone strony wyszukiwania"); panel.runProgress.style.width = "100%";
        panel.activity = element("p", null, "ytlc-activity"); panel.activity.setAttribute("aria-live", "off");
        panel.notice = element("p",null,"ytlc-muted");
        panel.searchSummary = element("div", null, "ytlc-search-summary");
        panel.searchSummary.append(element("strong", "Wiadomości z wybranego wyszukiwania"));
        panel.readCount = element("p"); panel.linkCounts = element("p"); panel.accountingNote = element("p", null, "ytlc-muted");
        panel.searchSummary.append(panel.readCount, panel.linkCounts, panel.accountingNote);
        panel.historyNote = element("p", null, "ytlc-muted ytlc-history-note");
        mainActions.append(panel.collectAll, panel.pause, panel.stop, panel.format, save);
        const history = element("details"); history.append(element("summary","Historia skanowania"),panel.scanning,panel.coverage,panel.scopeSelect,manual,panel.confirmPage,help);
        const recovery = element("details"); recovery.append(element("summary","Kopie, import i odzyskiwanie"),panel.import,checkpoint,backups,fallback);
        panel.recoverySelect = element("select"); panel.recoverySelect.setAttribute("aria-label","Dostępne checkpointy do odzyskania");
        panel.recover = button("Odtwórz wybrany zapis",()=>this.recover(panel.recoverySelect.value));
        panel.recoverExport = button("Eksportuj wybrany zapis JSON",()=>this.recover(panel.recoverySelect.value,true));
        panel.recoveryInfo = element("p"); recovery.append(panel.recoveryInfo,panel.recoverySelect,panel.recoverExport,panel.recover);
        settings.append(panel.reset);
        const channelControls = element("div", null, "ytlc-channelbar"); channelControls.append(panel.channel, panel.select);
        const mainStats = element("div",null,"ytlc-stats");
        const collectionLabel = element("strong", "Linki YouTube w całej kolekcji");
        for (const key of ["occurrences","unique","duplicates"]) mainStats.append(panel.stats[key].parentElement);
        const otherStats = element("div",null,"ytlc-stats");
        for (const key of ["messages","batches","malformed"]) otherStats.append(panel.stats[key].parentElement);
        history.append(otherStats);
        // One scrolling body, with persistent controls above and export below it.
        // All tabs reuse the existing collection/actions; no second controller.
        panel.runbar = element("div", null, "ytlc-runbar");
        const runTop = element("div", null, "ytlc-run-top"); runTop.append(panel.status, panel.progress);
        mainActions.replaceChildren(panel.collectAll,panel.pause,panel.stop);
        panel.runbar.append(runTop,panel.runProgress,mainActions,panel.activity);
        panel.health = element("div", null, "ytlc-page-health"); panel.health.setAttribute("role", "status");
        panel.healthTitle = element("strong"); panel.healthCounts = element("p"); panel.healthHelp = element("small");
        panel.health.append(panel.healthTitle,panel.healthCounts,panel.healthHelp);
        panel.notice.className = "ytlc-notice";
        const runBody = element("div", null, "ytlc-tabpanel");
        const limits = element("details"); limits.append(element("summary", "Zakres i kompletność danych"),panel.historyNote,panel.accountingNote);
        runBody.append(panel.health,panel.notice,mainStats,panel.searchSummary,limits,history);
        const linksBody = element("div", null, "ytlc-tabpanel");
        linksBody.append(element("h3", "Zebrane linki"),controls,duplicateLabel,panel.copyVisible,panel.results,pager);
        const settingsBody = element("div", null, "ytlc-tabpanel"); settings.open = true;
        settingsBody.append(settings,recovery);
        const diagnosticBody = element("div", null, "ytlc-tabpanel"); diagnostics.open = true; diagnosticBody.append(diagnostics);
        panel.body = element("div", null, "ytlc-body"); panel.tabs = {}; panel.tabpanels = {};
        const tabs = element("div", null, "ytlc-tabs"); tabs.setAttribute("role", "tablist"); tabs.setAttribute("aria-label", "Widok kolektora");
        const serial = this.panelSequence = (this.panelSequence || 0) + 1;
        for (const [key,label,body] of [["run","Zbieranie",runBody],["links","Linki",linksBody],["settings","Ustawienia",settingsBody],["diagnostics","Diagnostyka",diagnosticBody]]) {
            const tab = button(label, () => this.setPanelTab(panel,key)); tab.id = `ytlc-tab-${serial}-${key}`; body.id = `ytlc-view-${serial}-${key}`;
            tab.setAttribute("role","tab"); tab.setAttribute("aria-controls",body.id); body.setAttribute("role","tabpanel"); body.setAttribute("aria-labelledby",tab.id);
            tab.addEventListener("keydown", event => {
                const keys = Object.keys(panel.tabs), index = keys.indexOf(key);
                const target = event.key === "Home" ? 0 : event.key === "End" ? keys.length - 1 : event.key === "ArrowRight" ? (index + 1) % keys.length : event.key === "ArrowLeft" ? (index + keys.length - 1) % keys.length : null;
                if (target === null) return; event.preventDefault(); this.setPanelTab(panel,keys[target]); panel.tabs[keys[target]].focus();
            });
            panel.tabs[key] = tab; panel.tabpanels[key] = body; tabs.append(tab); panel.body.append(body);
        }
        const footer = element("div", null, "ytlc-footer"); save.className = "ytlc-export";
        footer.append(panel.saved,panel.format,save);
        root.replaceChildren(head,channelControls,panel.runbar,tabs,panel.body,footer);
        this.setPanelTab(panel,"run");
        this.panels.add(panel); this.renderPanelSafely(panel); return root;
    }
    setPanelTab(panel, key) {
        if (!panel.tabs[key]) return;
        panel.scrollPositions[panel.activeTab] = panel.body.scrollTop;
        panel.activeTab = key;
        for (const name of Object.keys(panel.tabs)) { const selected = name === key; panel.tabs[name].setAttribute("aria-selected",String(selected)); panel.tabs[name].tabIndex = selected ? 0 : -1; panel.tabpanels[name].hidden = !selected; }
        panel.body.scrollTop = panel.scrollPositions[key] || 0;
    }
    renderSoon() {
        if (!this.active || this.renderTimer) return;
        this.renderTimer = setTimeout(() => {
            this.renderTimer = null;
            this.refreshPanels();
        }, 180);
    }
    refreshPanels() {
        for (const panel of this.panels) {
            // BetterDiscord may detach a settings node before mounting it again.
            // Keep its registration until explicit close/stop, rather than freezing
            // a subsequently remounted view forever. Only two panels are retained.
            if (panel.root.isConnected) this.renderPanelSafely(panel);
        }
    }
    renderPanelSafely(panel) {
        try { this.renderPanel(panel); panel.lastRenderedAt = Date.now(); panel.renderError = null; }
        catch (error) {
            const line = /YouTubeLinkCollector\.plugin\.js:(\d+):(\d+)/.exec(error.stack || "");
            panel.renderError = {name: ["TypeError","RangeError","Error"].includes(error.name) ? error.name : "Error", line: line ? Number(line[1]) : null};
            panel.status.textContent = this.running ? "Zbieranie trwa · błąd widoku" : "Błąd odświeżania widoku";
            panel.stop.disabled = panel.pause.disabled = !this.running;
            panel.collectAll.disabled = this.running || this.busy || this.ioBusy || this.storageBlocked;
            panel.activity.textContent = "Panel ponowi odświeżenie. Stop nadal zatrzymuje zbieranie; dane są zachowane.";
            panel.root.dataset.renderError = "true";
        }
        if (!panel.renderError) delete panel.root.dataset.renderError;
    }
    renderPanel(panel) {
        const collection = this.collection, state = collection.state, stats = collection.stats();
        const statusNames = {idle: "Gotowy", running: "Zbieranie lokalne — zakres częściowy", partial: "Kolekcja częściowa", interrupted: "Kolekcja przerwana", failed: "Błąd kolekcji", complete: "Zakres historii zakończony według importu bota", unknown: "Kompletność nieznana"};
        panel.channel.textContent = state.selection ? `${state.selection.serverName} / #${state.selection.channelName}` : "Wybierz kanał, z którego chcesz zebrać linki";
        panel.channel.title = state.selection ? `Kolekcja tego kanału · ${state.selection.channelID}` : "";
        panel.status.textContent = this.navigator ? "Zbieranie wszystkich stron" : statusNames[state.status];
        panel.status.dataset.complete = String(state.completeness.status === "complete");
        const values = {messages: state.progress.messagesProcessed, occurrences: stats.totalOccurrences, unique: stats.uniqueResources, duplicates: stats.duplicates, batches: state.progress.batchesProcessed, malformed: state.progress.malformedMessages};
        for (const key of Object.keys(values)) panel.stats[key].textContent = values[key].toLocaleString("pl-PL");
        panel.saved.textContent = this.storageBlocked ? "Zapis zablokowany" : this.dirty ? "Zapisywanie zmian…" : this.lastSavedAt ? `Zapisano ${new Date(this.lastSavedAt).toLocaleTimeString("pl-PL")}` : "Dane lokalne · eksport całej kolekcji";
        panel.start.disabled = this.running || this.busy || this.ioBusy || this.storageBlocked;
        panel.stop.disabled = !this.running;
        panel.pause.disabled = !this.running;
        if (this.paused) panel.status.textContent = "Pauza · dane zapisane";
        const tracker = new SearchTracker(collection), scope = tracker.state.scopes.find(x => x.key === panel.scopeKey) || tracker.active(), progress = tracker.summary(scope);
        const live = this.liveSearch?.scope?.context.channelID === state.selection?.channelID && this.liveSearch?.scope?.context.serverID === state.selection?.serverID && (!scope || this.liveSearch.scope.key === scope.key) ? this.liveSearch : null;
        const scopeKey = JSON.stringify(tracker.state.scopes.map(x => x.key));
        if (panel.scopesKey !== scopeKey) {
            panel.scopesKey = scopeKey; panel.scopeSelect.replaceChildren();
            const active = element("option", "Bieżący zakres"); active.value = ""; panel.scopeSelect.append(active);
            for (const [index, previous] of tracker.state.scopes.entries()) { const option = element("option", `${index + 1}. ${previous.context.query || JSON.stringify(previous.context.filters)} · ${previous.context.sort}`); option.value = previous.key; panel.scopeSelect.append(option); }
        }
        panel.scopeSelect.value = panel.scopeKey || "";
        const pageCounts = scope?.pages.filter(x => x.status === "processed" && x.source === "client-results" && x.messageCount > 0).map(x => x.messageCount) || [];
        const estimate = scope?.reportedTotal && pageCounts.length && new Set(pageCounts).size === 1 ? Math.ceil(scope.reportedTotal / pageCounts[0]) : null;
        const denominator = scope?.totalPages || (estimate ? `około ${estimate} (szacunek z odczytanych stron)` : "liczba nieznana");
        const compress = numbers => { const segments = []; let start, end; for (const n of numbers.slice(0, 100000)) { if (start == null) start = end = n; else if (n === end + 1) end = n; else { segments.push(start === end ? String(start) : `${start}–${end}`); start = end = n; } } if (start != null) segments.push(start === end ? String(start) : `${start}–${end}`); return segments.slice(0, 30).join(", ") + (segments.length > 30 ? ", …" : ""); };
        panel.scanning.textContent = `Zakres: ${scope ? `${scope.context.query || JSON.stringify(scope.context.filters)} · sortowanie: ${scope.context.sort}` : "nieznany"}. Strona Discorda: ${scope?.currentPage || "nieznana"}. Wyniki zgłoszone: ${scope?.reportedTotal ?? "nieznane"}. Strony odczytane: ${progress.processed} / ${denominator}; w tym ręcznie potwierdzone: ${progress.userConfirmed || 0}; zaobserwowane: ${progress.observed}. Zapisane komunikaty błędów: ${state.errors.length}; nieprawidłowe wiadomości: ${state.progress.malformedMessages}.`;
        const accounting = tracker.accounting(scope);
        const countMismatch = accounting.allPages && accounting.reportedTotal !== null && accounting.reviewed !== accounting.reportedTotal;
        const traversalFinished = !this.running && state.status !== "failed" && accounting.allPages && scope?.navigation?.phase === "finished";
        const searchFinished = traversalFinished && !accounting.unverified && !countMismatch;
        if (searchFinished) panel.status.textContent = "Odczyt wyszukiwania zakończony";
        else if (traversalFinished) panel.status.textContent = "Odczyt wymaga sprawdzenia";
        else if (!this.running && state.status !== "failed" && scope?.navigation?.phase === "finished") panel.status.textContent = "Dotarto do końca — wcześniejsze strony wymagają odczytu";
        panel.status.dataset.searchFinished = String(searchFinished);
        const outstanding = [compress(progress.missing), progress.recheck.slice(0,30).join(", ")].filter(Boolean).join("; ");
        panel.coverage.textContent = `Strony wybranego wyszukiwania: ${accounting.allPages ? "wszystkie potwierdzone" : "odczyt częściowy"}. Potwierdzone: ${compress(progress.confirmed) || "brak"}. Do odczytu lub sprawdzenia: ${outstanding || (accounting.allPages ? "brak" : "numery nieznane")}. ${progress.warnings.join(" ")}`;
        panel.searchSummary.hidden = !scope;
        panel.readCount.textContent = `Sprawdzone wyniki: ${accounting.reviewed.toLocaleString("pl-PL")} / ${accounting.reportedTotal?.toLocaleString("pl-PL") ?? "?"}`;
        panel.linkCounts.textContent = `Wybrany kanał: ${accounting.read.toLocaleString("pl-PL")} wiadomości · z linkami: ${accounting.withLinks.toLocaleString("pl-PL")} · bez linków: ${accounting.withoutLinks.toLocaleString("pl-PL")}${accounting.outsideChannel ? ` · poza kanałem: ${accounting.outsideChannel.toLocaleString("pl-PL")}` : ""}${accounting.unverified ? ` · niepotwierdzone: ${accounting.unverified.toLocaleString("pl-PL")}` : ""}`;
        panel.accountingNote.textContent = accounting.unverified ? "Nie udało się potwierdzić odczytu części wiadomości. Nie zaliczono ich do wiadomości bez linków; sprawdź ten zakres ponownie." : countMismatch ? "Liczba sprawdzonych wiadomości różni się od licznika wyszukiwarki. Sprawdź zakres ponownie; różnica nie oznacza wiadomości bez linków." : "Wiadomości bez rozpoznanych linków YouTube zostały sprawdzone — nie są pominiętymi wynikami. Liczba wiadomości może różnić się od liczby linków: jedna wiadomość może zawierać kilka adresów.";
        panel.accountingNote.className = accounting.unverified || countMismatch ? "ytlc-error" : "ytlc-muted";
        panel.historyNote.textContent = state.completeness.status === "complete" ? "Pełna historia: potwierdzona według zaimportowanych danych bota." : "Pełna historia rozmowy: niepotwierdzona. Odczyt obejmuje wybrany zakres wyszukiwania i załadowane wiadomości. Oznaczenie INCOMPLETE w eksporcie dotyczy pełnej historii, a nie wiadomości bez linków.";
        const delay = this.navigationDelay;
        const remaining = delay ? Math.max(0, Math.ceil((delay.dueAt - Date.now()) / 1000)) : null;
        const activity = this.activitySnapshot();
        panel.activity.dataset.phase = activity.phase;
        panel.runbar.dataset.phase = activity.phase; panel.runbar.dataset.working = String(this.running || this.ioBusy);
        panel.activity.textContent = this.running ? `${activity.title}${delay ? ` · jeszcze ${remaining} s` : ` · odczyt ${activity.checkedSecondsAgo ?? "—"} s temu`}${["loading", "transition", "stabilizing"].includes(activity.phase) ? ` · ${activity.waitingSeconds}/${activity.timeoutSeconds} s` : ""}` : activity.title;
        panel.runProgress.max = live?.totalPages ?? scope?.totalPages ?? 1; panel.runProgress.value = progress.processed;
        panel.progress.textContent = `${progress.processed}/${live?.totalPages ?? scope?.totalPages ?? "?"} stron · otwarta ${live?.pageNumber ?? scope?.currentPage ?? "?"}`;
        panel.health.hidden = !live;
        panel.health.dataset.blocked = String(!!live && !live.fullPage && !live.loading);
        panel.healthTitle.textContent = live ? `Strona ${live.pageNumber ?? "?"} · ${live.loading ? "Discord ładuje wyniki" : live.fullPage ? "wszystkie wyniki rozpoznane" : "odczyt wymaga uzupełnienia"}` : "Brak otwartej wyszukiwarki";
        panel.healthCounts.textContent = live ? `Rozpoznane: ${live.resolvedHits ?? live.messages.length}/${live.expectedHits ?? "?"} · w tym kanale: ${live.messages.length}${live.outsideChannel ? ` · w innych kanałach: ${live.outsideChannel}` : ""}${live.unresolved ? ` · nieodczytane: ${live.unresolved}` : ""}` : "";
        panel.healthHelp.textContent = live?.outsideChannel ? "Wyszukiwarka obejmuje inne kanały. Ich wyniki są rozpoznane i wyłączone z tej kolekcji. Aby zbierać tylko ten kanał, dodaj filtr „w: / in:” w Discordzie." : live?.unresolved ? "To faktycznie nierozpoznane wyniki, a nie wiadomości bez linków. Strona nie została zaliczona. Możesz ponowić odczyt; zebrane linki pozostają bezpieczne." : "Zbieram linki tylko z kanału wskazanego nad paskiem postępu. Wznowienie zaczyna od otwartej strony.";
        panel.notice.hidden = state.status !== "failed" && !this.storageBlocked && !this.recheckNotice;
        panel.notice.textContent = state.status === "failed" ? live?.fullPage ? "Poprzednia próba została zatrzymana. Bieżąca strona jest już rozpoznana — wybierz Wznów zbieranie. Dotychczasowe linki i checkpoint są zachowane." : `${live?.waitReason || state.completeness.reason} Zbieranie zatrzymano; dane zachowane. Wznów ponownie sprawdzi otwartą stronę, bez cofania.` : this.storageBlocked ? "Zapis chroniony. Otwórz Ustawienia → Kopie, import i odzyskiwanie." : this.recheckNotice || "";
        panel.notice.className = state.status === "failed" ? "ytlc-notice ytlc-error" : "ytlc-notice ytlc-muted";
        panel.tabs.links.textContent = `Linki (${stats.totalOccurrences.toLocaleString("pl-PL")})`;
        if (this.running) panel.status.textContent = delay ? `Przerwa · ${remaining} s` : activity.phase === "loading" ? "Odczyt strony" : activity.phase === "transition" ? "Zmiana strony" : "Zbieranie w toku";
        else if (state.status === "failed") panel.status.textContent = live?.fullPage ? "Zatrzymano · można wznowić" : "Zatrzymano · sprawdź odczyt";
        panel.collectAll.disabled = this.running || this.busy || this.ioBusy || this.storageBlocked;
        panel.collectAll.textContent = this.canResumeAuto() ? "Wznów zbieranie" : "Zbieraj od bieżącej strony";
        if (this.running) panel.collectAll.textContent = "Zbieranie w toku";
        panel.start.textContent = "Odczyt ręczny bez zmiany stron";
        panel.fromBeginning.disabled = panel.newScope.disabled = this.running || this.busy || this.ioBusy || this.storageBlocked;
        panel.loadTimeout.disabled = panel.timeoutSave.disabled = this.running || this.busy || this.storageBlocked;
        if (panel.root.ownerDocument?.activeElement !== panel.loadTimeout) panel.loadTimeout.value = String(pageLoadTimeout(state.config));
        const candidates = this.persistence?.recovery || [], recoveryKey = candidates.map(x=>`${x.name}:${x.generation}:${x.totalOccurrences}`).join("|");
        if (panel.recoveryKey !== recoveryKey) {
            panel.recoveryKey = recoveryKey; panel.recoverySelect.replaceChildren();
            for (const c of candidates) { const option = element("option",`${c.name} · ${c.totalOccurrences} wyst. · ${c.version} · ${c.updatedAt}`); option.value=c.name; panel.recoverySelect.append(option); }
        }
        panel.recoveryInfo.textContent = candidates.length ? "Checkpointy odczytane przy uruchomieniu. Eksport nie zmienia kolekcji. Odtworzenie wymaga potwierdzenia." : "Brak wcześniejszych poprawnych checkpointów. Importuj własny JSON lub kopię konfiguracji.";
        panel.recover.disabled = panel.recoverExport.disabled = this.running || this.busy || this.ioBusy || !candidates.length;
        panel.confirmPage.disabled = this.ioBusy || !this.lastSearch?.pageNumber;
        panel.backup.disabled = this.ioBusy || !state.selection || typeof this.api.UI?.openDialog !== "function" || !(fileCapabilities(this.fileSystem()).promiseWrite || fileCapabilities(this.fileSystem()).callbackWrite);
        panel.backupStop.disabled = !this.backupPath;
        panel.backupStatus.textContent = this.backupPath ? "Kopie aktywne w tej sesji (co 5 min)." : "Kopie wyłączone; wskaż plik, aby je włączyć.";
        if (panel.exportText.value !== (this.pendingExport?.text || "")) panel.exportText.value = this.pendingExport?.text || "";
        const capabilities = fileCapabilities(this.fileSystem());
        panel.diagnostics.textContent = `Wtyczka ${VERSION}; dialog: ${typeof this.api.UI?.openDialog === "function" ? "dostępny" : "brak"}; fs.promises: ${capabilities.promiseWrite ? "zapis dostępny" : "brak zapisu"}; fs callback: ${capabilities.callbackWrite ? "zapis dostępny" : "brak zapisu"}. Stores: ${Object.entries(this.adapter?.stores || {}).map(([name, store]) => `${name}=${store ? "dostępny" : "brak"}`).join(", ")}. Odczyt wyszukiwarki: ${JSON.stringify(this.adapter?.searchDiagnostics || {})}. Nawigacja wyłącznie przez istniejące rel=next/prev; brak kontrolki zatrzymuje przejście.`;
        panel.resume.disabled = this.running || this.busy || this.ioBusy || !state.selection || this.storageBlocked;
        panel.select.disabled = this.running || this.busy || this.ioBusy;
        panel.reset.disabled = this.running || this.busy || this.ioBusy;
        panel.import.disabled = this.running || this.busy || this.ioBusy;
        panel.checkpoint.disabled = this.ioBusy || this.storageBlocked;
        for (const node of panel.exportButtons) node.disabled = this.ioBusy || !state.selection;
        panel.mode.value = state.config.mode;
        for (const [key, input] of Object.entries(panel.checks)) input.checked = state.config[key];
        const delayConfigKey = JSON.stringify(pageDelayRange(state.config));
        for (const [key, input] of Object.entries(panel.delayInputs)) { input.disabled = this.running || this.busy; if (panel.delayConfigKey !== delayConfigKey) input.value = String(state.config[key]); }
        panel.delayConfigKey = delayConfigKey; panel.delaySave.disabled = this.running || this.busy || this.storageBlocked;
        if (panel.queryChannel !== state.selection?.channelID) {
            panel.queryChannel = state.selection?.channelID; panel.queries.replaceChildren();
            if (state.selection) for (const domain of ["youtube.com", "youtu.be"]) panel.queries.append(element("p", null), element("code", `in:${state.selection.channelName} ${domain}`));
        }
        const cacheKey = `${collection.revision}|${state.config.mode}|${panel.query}|${panel.duplicates}`;
        if (panel.resultCollection !== collection || panel.cacheKey !== cacheKey) {
            panel.resultCollection = collection; panel.cacheKey = cacheKey;
            const records = state.config.mode === "unique" ? collection.groups() : [...collection.records.values()];
            panel.filtered = records.filter(record => (!panel.duplicates || collection.resources.get(resourceKey(record)).length > 1) && (!panel.query || JSON.stringify([record.originalURL, record.resourceID, record.author, record.messageID, record.originalURLs, record.sourceMessages]).toLowerCase().includes(panel.query)));
        }
        const pages = Math.max(1, Math.ceil(panel.filtered.length / 100)); panel.page = Math.max(0, Math.min(panel.page, pages - 1));
        const renderKey = `${cacheKey}|${panel.page}`;
        if (panel.lastRenderKey !== renderKey || panel.lastRenderCollection !== collection) {
            panel.lastRenderKey = renderKey; panel.lastRenderCollection = collection; const fragment = document.createDocumentFragment();
            for (const record of panel.filtered.slice(panel.page * 100, (panel.page + 1) * 100)) {
                const row = element("div", null, "ytlc-result"); row.append(linkNode(record.normalizedURL, record.normalizedURL));
                const copy = element("button", "Kopiuj"); copy.type = "button"; copy.addEventListener("click", () => { void this.copyLinks(record.normalizedURL); }); row.append(copy);
                const meta = element("small", `${record.resourceType === "video" ? "Wideo" : "Playlista"} · ${record.occurrenceCount || 1} wyst. · ${record.author || "autor niedostępny"} · `);
                meta.append(linkNode("Wiadomość źródłowa", record.messageURL)); row.append(meta); fragment.append(row);
            }
            if (!panel.filtered.length) fragment.append(element("p", "Brak wyników dla bieżącego filtra.", "ytlc-muted"));
            panel.results.replaceChildren(fragment);
        }
        panel.pageLabel.textContent = `${panel.filtered.length.toLocaleString("pl-PL")} ${state.config.mode === "unique" ? "unikalnych filmów / playlist" : "wystąpień linków"} · strona listy ${panel.page + 1}/${pages}`;
        panel.previous.disabled = panel.page === 0; panel.next.disabled = panel.page >= pages - 1;
        const notesKey = JSON.stringify([state.status, state.completeness.reason, state.warnings, state.errors]);
        if (panel.notesKey !== notesKey) {
            panel.notesKey = notesKey; panel.notes.replaceChildren();
            const historicalErrors = state.errors.slice();
            if (state.status === "failed") {
                panel.notes.append(element("p", `Bieżący błąd: ${state.completeness.reason}`, "ytlc-error"));
                if (historicalErrors.at(-1) === state.completeness.reason) historicalErrors.pop();
            }
            if (historicalErrors.length) {
                const history = element("details"); history.append(element("summary", `Historia wcześniejszych błędów (${historicalErrors.length})`), element("p", "Zachowane komunikaty z wcześniejszych prób; nie opisują bieżącego stanu.", "ytlc-muted"), ...historicalErrors.map(x => element("p", x, "ytlc-muted"))); panel.notes.append(history);
            }
            panel.notes.append(...state.warnings.map(x => element("p", x)));
        }
    }
}
YouTubeLinkCollector.Core = Object.freeze({NAME, VERSION, SCHEMA, LIMITS, DEFAULTS, pageDelayRange, pageLoadTimeout, choosePageDelay, ID, validId, byteSize, parseYouTubeURL, extractText, extractMessage, validateSnapshot, Collection, Persistence, UIPageNavigator, LocalAdapter, readSearchProps, contextSearchID, localizedCount, SearchTracker, searchScope, stableContext, collectBatch, exportData, csvCell, filename, writeExportFile, writeCompatibleFile, readCompatibleFile, fileCapabilities, dialogPath, ExportIO, protectEmptyConfig, digest, iso, now, movableWindow, LiveDiagnostics});
module.exports = YouTubeLinkCollector;
