import http from "node:http";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const routes = new Map([["/", "tests/browser-fixture.html"], ["/automation", "tests/automation-browser.html"], ["/plugin.js", "YouTubeLinkCollector.plugin.js"]]);
const port = Number(process.env.YTLC_PREVIEW_PORT || 8765);
const server = http.createServer(async (request, response) => {
    const target = routes.get(new URL(request.url, "http://127.0.0.1").pathname);
    if (!target) { response.writeHead(404); response.end("Not found"); return; }
    try {
        const text = await readFile(path.join(root,target));
        response.writeHead(200, {"Content-Type": target.endsWith(".html") ? "text/html; charset=utf-8" : "application/javascript; charset=utf-8", "Cache-Control": "no-store"});
        response.end(text);
    } catch { response.writeHead(500); response.end("Fixture unavailable"); }
});
server.listen(port,"127.0.0.1", () => process.stdout.write(`Mock BdApi browser fixture: http://127.0.0.1:${port}/ (not a real Discord test)\n`));
server.on("error", error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
