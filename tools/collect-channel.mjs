#!/usr/bin/env node
// Official registered bot only. The plugin never calls the Discord REST API.
import fs from "node:fs/promises";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {setTimeout as sleep} from "node:timers/promises";
import Plugin from "../YouTubeLinkCollector.plugin.js";
const {Collection, collectBatch, exportData, filename, validId, VERSION, now} = Plugin.Core;
const API = "https://discord.com/api/v10";
const VIEW = 1024n, HISTORY = 65536n, ADMIN = 8n;
const MAX_FILE_BYTES = 32 * 1024 * 1024;
export class DiscordBotClient {
    constructor(token, {fetchImpl = fetch, wait = sleep, signal, onWait = () => {}} = {}) {
        if (typeof token !== "string" || !token.trim() || /\s/.test(token)) throw new Error("Set DISCORD_BOT_TOKEN to a registered bot token (no 'Bot ' prefix).");
        this.token = token; this.fetch = fetchImpl; this.wait = wait; this.signal = signal; this.onWait = onWait;
    }
    async get(route) {
        if (!/^\/(users\/@me|oauth2\/applications\/@me|channels\/[1-9]\d{16,19}(?:\/messages\?(?:limit=100)(?:&before=[1-9]\d{16,19})?)?|guilds\/[1-9]\d{16,19}(?:\/roles|\/members\/[1-9]\d{16,19})?)$/.test(route)) throw new Error("Unexpected API route.");
        for (let attempt = 0; attempt < 6; attempt++) {
            this.signal?.throwIfAborted();
            let response;
            try {
                const signals = [AbortSignal.timeout(30000)]; if (this.signal) signals.push(this.signal);
                response = await this.fetch(`${API}${route}`, {method: "GET", redirect: "error", headers: {Authorization: `Bot ${this.token}`, "User-Agent": `YouTubeLinkCollector/${VERSION}`}, signal: AbortSignal.any(signals)});
            } catch (error) {
                this.signal?.throwIfAborted();
                if (attempt === 5) throw new Error("Network request failed after bounded retries. Progress retained.");
                await this.wait(1000 * 2 ** attempt, undefined, {signal: this.signal}); continue;
            }
            if (response.status === 429) {
                const body = await response.json().catch(() => ({}));
                const retry = Math.max(Number(body.retry_after) || 0, Number(response.headers.get("retry-after")) || 0, Number(response.headers.get("x-ratelimit-reset-after")) || 0);
                if (!Number.isFinite(retry) || retry <= 0) throw new Error("Discord returned 429 without a valid retry interval. Stopped safely.");
                if (attempt === 5) throw new Error("Repeated rate limits; stopped after six attempts. Resume later.");
                this.onWait(retry);
                await this.wait(Math.ceil(retry * 1000) + 100, undefined, {signal: this.signal}); continue;
            }
            if (response.status >= 500 && attempt < 5) { await this.wait(1000 * 2 ** attempt, undefined, {signal: this.signal}); continue; }
            if (!response.ok) throw new Error(`Discord HTTP ${response.status}. No permission/token bypass attempted; progress retained.`);
            const body = await response.json();
            const remaining = response.headers.get("x-ratelimit-remaining"), reset = Number(response.headers.get("x-ratelimit-reset-after"));
            const delay = remaining === "0" && Number.isFinite(reset) && reset > 0 ? Math.ceil(reset * 1000) + 100 : 300;
            await this.wait(delay, undefined, {signal: this.signal});
            return body;
        }
        throw new Error("Retry budget exhausted.");
    }
}
export function effectivePermissions(guild, roles, member, channel, botID) {
    if (!guild || !Array.isArray(roles) || !Array.isArray(member?.roles) || !Array.isArray(channel?.permission_overwrites)) throw new Error("Missing permission data. Cannot establish complete history.");
    if (guild.owner_id === botID) return VIEW | HISTORY | ADMIN;
    const roleIDs = new Set([guild.id, ...member.roles]);
    let permissions = 0n;
    for (const id of roleIDs) {
        const role = roles.find(x => x.id === id);
        if (!role || !/^\d+$/.test(role.permissions)) throw new Error("Malformed or missing role permissions.");
        permissions |= BigInt(role.permissions);
    }
    if ((permissions & ADMIN) !== 0n) return permissions | VIEW | HISTORY;
    const overwrite = entry => {
        if (!/^\d+$/.test(entry.allow) || !/^\d+$/.test(entry.deny)) throw new Error("Malformed channel overwrites.");
        return {allow: BigInt(entry.allow), deny: BigInt(entry.deny)};
    };
    const everyone = channel.permission_overwrites.find(x => x.id === guild.id && x.type === 0);
    if (everyone) { const item = overwrite(everyone); permissions = (permissions & ~item.deny) | item.allow; }
    let deny = 0n, allow = 0n;
    for (const entry of channel.permission_overwrites.filter(x => x.type === 0 && x.id !== guild.id && roleIDs.has(x.id))) { const item = overwrite(entry); deny |= item.deny; allow |= item.allow; }
    permissions = (permissions & ~deny) | allow;
    const personal = channel.permission_overwrites.find(x => x.id === botID && x.type === 1);
    if (personal) { const item = overwrite(personal); permissions = (permissions & ~item.deny) | item.allow; }
    return permissions;
}
export async function preflight(client, channelID) {
    const user = await client.get("/users/@me");
    if (user.bot !== true || !validId(user.id)) throw new Error("Credential is not a registered bot account. User-account automation is refused.");
    const application = await client.get("/oauth2/applications/@me");
    if (!validId(application.id) || !Number.isSafeInteger(application.flags)) throw new Error("Cannot inspect the bot application.");
    if ((application.flags & ((1 << 18) | (1 << 19))) === 0) throw new Error("MESSAGE CONTENT intent must be enabled/approved in the Developer Portal. Empty content cannot establish completeness.");
    const channel = await client.get(`/channels/${channelID}`);
    if (channel.id !== channelID || !validId(channel.guild_id) || ![0, 5].includes(channel.type)) throw new Error("Official tool supports one guild text/announcement channel only. Threads/DMs/forum parents are outside this scope.");
    const guild = await client.get(`/guilds/${channel.guild_id}`);
    if (guild.id !== channel.guild_id) throw new Error("Guild identity mismatch.");
    const roles = await client.get(`/guilds/${guild.id}/roles`);
    const member = await client.get(`/guilds/${guild.id}/members/${user.id}`);
    if (member.user?.id !== user.id) throw new Error("Bot membership could not be verified.");
    const permissions = effectivePermissions(guild, roles, member, channel, user.id);
    if ((permissions & VIEW) === 0n || (permissions & HISTORY) === 0n) throw new Error("Bot requires VIEW_CHANNEL and READ_MESSAGE_HISTORY on the selected channel.");
    return {botID: user.id, applicationID: application.id, selection: {serverID: guild.id, serverName: guild.name, channelID, channelName: channel.name}};
}
export async function atomicWrite(target, value) {
    await Plugin.Core.writeExportFile(fs, target, value);
}
export async function readCheckpoint(file) {
    if ((await fs.stat(file)).size > MAX_FILE_BYTES) throw new Error("Checkpoint exceeds 32 MiB.");
    const text = await fs.readFile(file, "utf8");
    if (Buffer.byteLength(text) > MAX_FILE_BYTES) throw new Error("Checkpoint exceeds 32 MiB.");
    const saved = JSON.parse(text);
    const collection = Collection.restore(saved.collection);
    const bot = saved.bot;
    if (!["1.0.0", "1.1.0", "1.2.0", "1.2.1", "1.2.2", "1.2.3", "1.2.4", "1.2.5", "1.2.6", VERSION].includes(saved.toolVersion) || !bot || !validId(bot.botID) || !validId(bot.applicationID) || typeof bot.reachedEnd !== "boolean" || !(bot.snapshotUpperMessageID === null || validId(bot.snapshotUpperMessageID)) || !(bot.before === null || validId(bot.before))) throw new Error("Invalid bot checkpoint.");
    if (bot.before !== collection.state.checkpoint.before || (bot.before && (!bot.snapshotUpperMessageID || BigInt(bot.before) > BigInt(bot.snapshotUpperMessageID))) || (bot.reachedEnd && collection.state.status !== "complete") || (collection.state.status === "complete" && !bot.reachedEnd)) throw new Error("Inconsistent bot checkpoint.");
    return {collection, bot};
}
export async function scanHistory({client, identity, collection = new Collection(identity.selection), bot = {botID: identity.botID, applicationID: identity.applicationID, before: null, snapshotUpperMessageID: null, reachedEnd: false}, checkpoint = async () => {}, signal, maxPages = 10000, onProgress = () => {}, recheck = () => preflight(client, identity.selection.channelID)}) {
    if (bot.botID !== identity.botID || bot.applicationID !== identity.applicationID || collection.state.selection?.channelID !== identity.selection.channelID || collection.state.selection?.serverID !== identity.selection.serverID) throw new Error("Checkpoint belongs to another bot/channel. No data changed.");
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100000) throw new Error("Invalid page limit.");
    if (bot.reachedEnd) return {collection, bot};
    if (collection.state.config.embeds !== true) throw new Error("Official history requires embed collection enabled.");
    collection.begin(); collection.state.completeness.reason = "Oficjalny bot przechodzi historię; pełny zakres nie został jeszcze potwierdzony.";
    try {
        await checkpoint(collection, bot);
        for (let pages = 0; pages < maxPages; pages++) {
            signal?.throwIfAborted();
            // A cancelled first page may already have established the upper boundary.
            // Include that boundary on replay while excluding newly created messages.
            const before = bot.before || (bot.snapshotUpperMessageID ? String(BigInt(bot.snapshotUpperMessageID) + 1n) : null);
            const page = await client.get(`/channels/${identity.selection.channelID}/messages?limit=100${before ? `&before=${before}` : ""}`);
            if (!Array.isArray(page) || page.length > 100) throw new Error("Malformed history page; checkpoint retained.");
            // Reject a whole page before committing any of its messages.
            const ids = new Set();
            for (const message of page) {
                if (!validId(message?.id) || message.channel_id !== identity.selection.channelID || typeof message.content !== "string" || !Array.isArray(message.embeds) || !message.timestamp || !Plugin.Core.iso(message.timestamp) || ids.has(message.id) || (before && BigInt(message.id) >= BigInt(before))) throw new Error("Malformed, cross-channel, duplicate or non-advancing history page.");
                ids.add(message.id);
            }
            if (!page.length) {
                // Empty pages also occur when history permission is absent. Recheck before completion.
                const verified = await recheck();
                if (verified.botID !== identity.botID || verified.applicationID !== identity.applicationID || verified.selection.channelID !== identity.selection.channelID || verified.selection.serverID !== identity.selection.serverID) throw new Error("Permission recheck returned another identity.");
                bot.reachedEnd = true; collection.state.status = "complete";
                collection.state.completeness = {status: "complete", reason: "Bot dotarł do końca dostępnej historii wybranego kanału do granicy pierwszej partii. Nowe wiadomości i późniejsze edycje/delecje nie należą do potwierdzonego zakresu.",
                    evidence: {method: "official-bot-history", reachedEnd: true, permissionsChecked: true, messageContentEnabled: true, snapshotUpperMessageID: bot.snapshotUpperMessageID, finishedAt: now(), applicationID: bot.applicationID, botID: bot.botID, finalEmptyPage: true}};
                collection.state.updatedAt = now(); await checkpoint(collection, bot); onProgress(collection); return {collection, bot};
            }
            const sorted = [...page].sort((a, b) => BigInt(a.id) > BigInt(b.id) ? -1 : 1);
            bot.snapshotUpperMessageID ||= sorted[0].id;
            await collectBatch(collection, sorted, {cancelled: () => signal?.aborted === true, onProgress: () => onProgress(collection)});
            signal?.throwIfAborted();
            bot.before = sorted.at(-1).id; collection.state.checkpoint.before = bot.before;
            await checkpoint(collection, bot); onProgress(collection);
            // Recheck authorization periodically, and always at the final empty page.
            if ((pages + 1) % 20 === 0) await recheck();
        }
        collection.interrupt(`Osiągnięto limit ${maxPages} stron tej sesji. Historia jest niepełna; użyj --resume.`);
        await checkpoint(collection, bot); return {collection, bot};
    } catch (error) {
        bot.reachedEnd = false;
        if (signal?.aborted) collection.interrupt("Przerwano narzędzie bota. Wznów przez --resume; niedokończona partia zostanie bezpiecznie odczytana ponownie.");
        else if (collection.state.status !== "interrupted") collection.fail(error);
        await checkpoint(collection, bot);
        if (signal?.aborted) return {collection, bot};
        throw error;
    }
}
function parseArguments(args) {
    const options = {resume: false, maxPages: 10000, help: false};
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--resume") options.resume = true;
        else if (arg === "--help" || arg === "-h") options.help = true;
        else if (["--channel", "--out", "--checkpoint", "--max-pages"].includes(arg)) {
            if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`Missing value for ${arg}.`);
            const value = args[++i];
            options[{"--channel": "channelID", "--out": "out", "--checkpoint": "checkpoint", "--max-pages": "maxPages"}[arg]] = arg === "--max-pages" ? Number(value) : value;
        } else throw new Error(`Unknown argument: ${arg}`);
    }
    return options;
}
async function exists(file) { try { await fs.access(file); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } }
export async function main(args = process.argv.slice(2)) {
    const options = parseArguments(args);
    if (options.help) {
        process.stdout.write("Registered bot only. Node >=22. DISCORD_BOT_TOKEN environment variable required.\nnode tools/collect-channel.mjs --channel CHANNEL_ID --out ./exports [--resume] [--checkpoint PATH] [--max-pages 10000]\nOnly one guild text/announcement channel, no child threads. Each page is checkpointed. Ctrl+C retains progress and exports incomplete results.\n"); return;
    }
    if (!validId(options.channelID) || !options.out) throw new Error("Specify --channel with a real channel ID and --out with an output directory. See --help.");
    if (!Number.isInteger(options.maxPages) || options.maxPages < 1 || options.maxPages > 100000) throw new Error("--max-pages must be 1..100000.");
    const output = path.resolve(options.out);
    const checkpointPath = path.resolve(options.checkpoint || path.join(output, `checkpoint-${options.channelID}.json`));
    await fs.mkdir(output, {recursive: true}); await fs.mkdir(path.dirname(checkpointPath), {recursive: true});
    const lockPath = `${checkpointPath}.lock`;
    const lock = await fs.open(lockPath, "wx", 0o600).catch(error => {
        if (error.code === "EEXIST") throw new Error("Checkpoint is locked. Another collector may be active. Remove a stale .lock only after confirming its process has stopped.");
        throw error;
    });
    try {
        await lock.writeFile(JSON.stringify({pid: process.pid, startedAt: now()}), "utf8");
        const hasCheckpoint = await exists(checkpointPath);
        if (hasCheckpoint && !options.resume) throw new Error("Checkpoint exists. Use --resume or choose another --checkpoint path; existing data will not be overwritten.");
        if (!hasCheckpoint && options.resume) throw new Error("--resume requires an existing checkpoint.");
        const restored = hasCheckpoint ? await readCheckpoint(checkpointPath) : null;
        const controller = new AbortController(); const interrupt = () => controller.abort(new Error("Interrupted by user"));
        process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
        let collection, bot, failure;
        try {
            const client = new DiscordBotClient(process.env.DISCORD_BOT_TOKEN, {signal: controller.signal, onWait: seconds => process.stdout.write(`Rate limit: waiting ${seconds} s.\n`)});
            const identity = await preflight(client, options.channelID);
            collection = restored?.collection || new Collection(identity.selection);
            bot = restored?.bot || {botID: identity.botID, applicationID: identity.applicationID, before: null, snapshotUpperMessageID: null, reachedEnd: false};
            if (collection.state.selection.channelID !== options.channelID || bot.botID !== identity.botID || bot.applicationID !== identity.applicationID) throw new Error("Checkpoint bot/channel mismatch. Existing checkpoint remains untouched.");
            const checkpoint = (data, cursor) => atomicWrite(checkpointPath, JSON.stringify({toolVersion: VERSION, bot: cursor, collection: data.snapshot()}));
            let lastProgress = 0;
            try {
                await scanHistory({client, identity, collection, bot, checkpoint, signal: controller.signal, maxPages: options.maxPages, onProgress: data => {
                    if (Date.now() - lastProgress < 1000) return;
                    lastProgress = Date.now();
                    process.stdout.write(`${data.state.progress.messagesProcessed} messages; ${data.records.size} URLs; ${data.resources.size} resources.\n`);
                }});
            } catch (error) { failure = error; }
            const date = now();
            for (const format of ["txt", "csv", "json"]) {
                const target = path.join(output, filename(collection, format, date));
                await atomicWrite(target, exportData(collection, format, {exportedAt: date}));
                process.stdout.write(`Saved ${target}\n`);
            }
            process.stdout.write(`Status: ${collection.state.status}. ${collection.state.completeness.reason}\n`);
            if (failure) throw failure;
            if (collection.state.status !== "complete") process.exitCode = 2;
        } finally { process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt); }
        } finally { await lock.close(); await fs.unlink(lockPath); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    main().catch(error => { process.stderr.write(`Error: ${error.message}\n`); process.exitCode = 1; });
}
