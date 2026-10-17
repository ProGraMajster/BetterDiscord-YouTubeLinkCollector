#!/usr/bin/env node
// Read-only connection to the real plugin; author: ProGraMajster.
import fs from "node:fs/promises";
import path from "node:path";
import {randomBytes} from "node:crypto";
const args = process.argv.slice(2), option = key => args.includes(key) ? args[args.indexOf(key) + 1] : null;
if (args.includes("--help")) {
    console.log("node tools/live-diagnostics.mjs [--connect | --disconnect] [--folder <BetterDiscord plugins folder>]\nConnect enables read-only sanitized snapshots for 30 minutes. Default: read the latest fresh response. No Discord token, debug port, UI commands or conversation data.");
} else {
    try {
        const folder = option("--folder") || (process.env.APPDATA ? path.join(process.env.APPDATA, "BetterDiscord", "plugins") : null);
        if (!folder) throw Error("Pass --folder with the BetterDiscord plugins directory.");
        const requestPath = path.join(folder, "YouTubeLinkCollector.debug-request.json"), responsePath = path.join(folder, "YouTubeLinkCollector.diagnostics.json");
        if (args.includes("--connect")) {
            const request = {protocol: 1, nonce: randomBytes(16).toString("hex"), expiresAt: Date.now() + 1800000};
            await fs.writeFile(requestPath, JSON.stringify(request), {flag: "wx", mode: 0o600});
            console.log("Read-only request created for 30 minutes. The enabled plugin should respond within a few seconds. Run this command without --connect to read the response; --disconnect removes the request.");
        } else if (args.includes("--disconnect")) {
            await fs.unlink(requestPath).catch(error => { if (error.code !== "ENOENT") throw error; });
            console.log("Diagnostic request removed. No collection/configuration files changed.");
        } else {
            const request = JSON.parse(await fs.readFile(requestPath, "utf8"));
            const response = JSON.parse(await fs.readFile(responsePath, "utf8"));
            if (request.expiresAt <= Date.now() || request.protocol !== 1 || response.protocol !== 1 || response.nonce !== request.nonce || Date.now() - Date.parse(response.observedAt) > 10000 || !Number.isFinite(Date.parse(response.observedAt))) throw Error("No fresh matching response from the real client. Check that the updated plugin is enabled; reconnect if the request expired.");
            console.log(JSON.stringify(response, null, 2));
        }
    } catch (error) { console.error(error.code === "ENOENT" ? "No live response/request yet. Use --connect and enable the updated plugin in Discord." : error.code === "EEXIST" ? "A request already exists. Read it, or use --disconnect before reconnecting." : error.message); process.exitCode = 1; }
}
