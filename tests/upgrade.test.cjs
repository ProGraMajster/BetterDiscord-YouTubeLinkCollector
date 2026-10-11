"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Plugin = require("../YouTubeLinkCollector.plugin.js");
const {Collection, Persistence, ExportIO, SearchTracker, searchScope, LocalAdapter, exportData, writeCompatibleFile, readCompatibleFile, fileCapabilities, dialogPath} = Plugin.Core;
const selection = {channelID: "111111111111111111", serverID: "222222222222222222", channelName: "muzyka", serverName: "Serwer"};
const message = index => ({id: String(333333333333333333n + BigInt(index)), channel_id: selection.channelID, content: `https://youtu.be/V${String(index).padStart(10,"0")}`, embeds: [], author: {username: "MEE6"}, timestamp: "2026-10-09T12:00:00Z"});
const collection = () => { const value = new Collection(selection); value.begin(); return value; };
const callbackFs = () => Object.fromEntries(["writeFile","readFile","stat","rename","unlink"].map(key => [key, fs[key].bind(fs)]));
const dataStore = initial => { const values = new Map(Object.entries(initial || {})); return {values, load: key => structuredClone(values.get(key)), save: (key,value) => values.set(key, structuredClone(value)), delete: key => values.delete(key)}; };
const snapshot = (page, items = [message(page)], query = "in:muzyka youtube.com", extra = {}) => ({scope: searchScope(selection, query, {channel_id:[selection.channelID]}, "timestamp/asc", selection.serverID), pageNumber: page, pageKey: `page:${page}`, reportedTotal: 2554, totalPages: null, loaded: true, fullPage: true, messages: items, source: "client-results", ...extra});
const ingest = (value, page) => { for (const item of page.messages) value.process(item); return new SearchTracker(value).commit(page); };

test("regression reproduces undefined.open with a BetterDiscord-shaped fs without promises", async () => {
    const polyfill = callbackFs(); assert.equal(polyfill.promises, undefined); assert.equal(polyfill.open, undefined);
    await assert.rejects(async () => polyfill.promises.open("unused", "wx"), /undefined.*open/);
    assert.equal(fileCapabilities(polyfill).callbackWrite, true);
});
for (const format of ["txt", "csv", "json"]) for (const variant of ["callback", "promises"]) test(`${format} writes UTF-8 through ${variant} API and confirms before success`, async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "ytlc-export-"));
    try {
        const value = collection(); value.process(message(1)); const text = exportData(value,format), target = path.join(directory,`zażółć.${format}`);
        const io = new ExportIO({ui:{openDialog:async options => {assert.ok(options.defaultPath.endsWith(`.${format}`)); return {canceled:false,filePath:target};}},fs:variant === "callback" ? callbackFs() : fs});
        assert.equal(await io.save(text,`zażółć-INCOMPLETE.${format}`,format), "saved");
        assert.equal(await fs.promises.readFile(target,"utf8"),text); assert.deepEqual(await fs.promises.readdir(directory), [`zażółć.${format}`]);
    } finally { await fs.promises.rm(directory,{recursive:true,force:true}); }
});
for (const result of [{canceled:true},{cancelled:true},null]) test(`cancelled dialog ${JSON.stringify(result)} never writes/downloads/copies`, async () => {
    const io = new ExportIO({ui:{openDialog:async () => result},fs:{writeFile(){throw Error("written");},readFile(){},rename(){},unlink(){}},download:()=>{throw Error("downloaded");},clipboard:()=>{throw Error("copied");}});
    assert.equal(await io.save("x","x.txt","txt"),"cancelled");
});
test("dialog supports both Electron/BD spellings and selected-path variants", () => {
    assert.equal(dialogPath({filePath:"x"},"save"),"x"); assert.equal(dialogPath("x","save"),"x");
    assert.equal(dialogPath({filePaths:["x"]},"open"),"x"); assert.throws(()=>dialogPath({},"save"),/nierozpoznany/);
});
test("missing dialog or filesystem uses download, then clipboard, then manual selection", async () => {
    const download = new ExportIO({ui:{},fs:null,download:()=>true}); assert.equal(await download.save("x","x.txt","txt"),"download");
    const copy = new ExportIO({ui:{},fs:callbackFs(),download:()=>false,clipboard:async()=>true}); assert.equal(await copy.save("x","x.txt","txt"),"copied");
    assert.equal(await new ExportIO({}).save("x","x.txt","txt"),"manual");
});
test("write denial is a true failure and never changes the existing destination", async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(),"ytlc-denied-"));
    try {
        const target = path.join(directory,"existing.json"); await fs.promises.writeFile(target,"previous");
        const polyfill = callbackFs(); polyfill.writeFile = (_path,_text,_options,cb)=>cb(Object.assign(Error("EACCES"),{code:"EACCES"}));
        await assert.rejects(writeCompatibleFile(polyfill,target,"new"),/EACCES/);
        assert.equal(await fs.promises.readFile(target,"utf8"),"previous");
    } finally { await fs.promises.rm(directory,{recursive:true,force:true}); }
});
for (const failure of ["readback", "rename"]) test(`${failure} failure retains original target and removes own temporary`, async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(),"ytlc-failure-"));
    try {
        const target = path.join(directory,"existing.json"); await fs.promises.writeFile(target,"previous"); const polyfill = callbackFs();
        if (failure === "readback") polyfill.readFile = (_path,_encoding,cb)=>cb(null,"truncated");
        else polyfill.rename = (_a,_b,cb)=>cb(Error("rename denied"));
        await assert.rejects(writeCompatibleFile(polyfill,target,"new"));
        assert.equal(await fs.promises.readFile(target,"utf8"),"previous"); assert.deepEqual(await fs.promises.readdir(directory),["existing.json"]);
    } finally { await fs.promises.rm(directory,{recursive:true,force:true}); }
});
test("import reads BD callback filesystem with UTF-8 BOM and restores JSON", async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(),"ytlc-import-"));
    try {
        const value=collection(); value.process(message(1)); const target=path.join(directory,"żółć.json"); await fs.promises.writeFile(target,"\uFEFF"+exportData(value,"json"),"utf8");
        const text=await readCompatibleFile(callbackFs(),target); assert.equal(Collection.restore(JSON.parse(text.replace(/^\uFEFF/,"")).collection).records.size,1);
    } finally { await fs.promises.rm(directory,{recursive:true,force:true}); }
});
test("oversized and invalid import never reach read/restore", async () => {
    await assert.rejects(readCompatibleFile({stat:(_p,cb)=>cb(null,{size:257*1024*1024}),readFile:()=>{throw Error("read attempted");}},"x"),/256 MiB/);
    assert.throws(()=>Collection.restore({schemaVersion:1}),/uszkodzony/);
});
test("actual 1.0.0-generated checkpoint retains exactly 126 records and original envelopes", () => {
    const fixture=require("./fixtures/1.0.0-126.json"), data=dataStore(fixture.values), persistence=new Persistence(data), value=persistence.load();
    assert.deepEqual(value.stats(),{totalOccurrences:126,uniqueResources:126,duplicates:0}); assert.equal(value.state.pluginVersion,Plugin.Core.VERSION);
    assert.equal(value.state.searchTracking.scopes.length,0); assert.equal(value.process(message(1)),false);
    persistence.save(value); persistence.save(value); persistence.save(value);
    const legacy=data.load("legacy-1.0.0"); assert.deepEqual(JSON.parse(legacy.payload),fixture.values);
    assert.equal(new Persistence(data).load().records.size,126); assert.equal(JSON.parse(exportData(value,"json")).occurrences.length,126);
});
test("failed migration backup never overwrites original 1.0.0 banks", () => {
    const fixture=require("./fixtures/1.0.0-126.json"), data=dataStore(fixture.values), persistence=new Persistence(data), value=persistence.load();
    data.save = key => {assert.equal(key,"legacy-1.0.0"); throw Error("disk full");};
    assert.throws(()=>persistence.save(value),/disk full/); assert.deepEqual(Object.fromEntries(data.values),fixture.values);
});
test("page number observation alone cannot confirm a read; partial data stays recheck", () => {
    const value=collection(), tracker=new SearchTracker(value), page=snapshot(1); tracker.observe(page);
    assert.equal(tracker.summary().observed,1); assert.equal(tracker.summary().processed,0);
    assert.equal(tracker.commit(page),false); assert.equal(tracker.active().pages[0].status,"recheck");
});
test("pages 1,2,5 reveal gaps 3,4; repeating page 5 does not increment progress", () => {
    const value=collection(); for (const number of [1,2,5]) ingest(value,snapshot(number));
    const tracker=new SearchTracker(value); assert.equal(tracker.summary().processed,3); assert.deepEqual(tracker.summary().missing,[3,4]);
    assert.equal(ingest(value,snapshot(5)),false); assert.equal(tracker.summary().processed,3); assert.equal(value.records.size,3);
});
test("loading page remains observed until stable and fully ingested", () => {
    const value=collection(), tracker=new SearchTracker(value), loading=snapshot(1,[],undefined,{loaded:false});
    tracker.observe(loading); assert.equal(tracker.commit(loading),false); assert.equal(tracker.summary().processed,0);
    ingest(value,snapshot(1)); assert.equal(tracker.summary().processed,1);
});
test("visible-only read stays distinct from full-page evidence; explicit confirmation persists", () => {
    const value=collection(), page=snapshot(1,[message(1)],undefined,{fullPage:false,source:"visible-results"}); ingest(value,page);
    const tracker=new SearchTracker(value); assert.equal(tracker.summary().processed,0); assert.equal(tracker.active().pages[0].status,"visible-only");
    tracker.commit(page,true); assert.equal(tracker.summary().processed,1); assert.equal(tracker.commit(page),false); assert.equal(tracker.summary().processed,1);
});
test("stale payload reused under a new page number cannot count as another read", () => {
    const value=collection(); ingest(value,snapshot(1,[message(1)])); ingest(value,snapshot(2,[message(1)]));
    const tracker=new SearchTracker(value); assert.equal(tracker.summary().processed,1); assert.equal(tracker.active().pages[1].status,"recheck");
});
test("query, author/date filter, sorting and search context each isolate page histories", () => {
    const value=collection(); const first=snapshot(1); ingest(value,first);
    for (const scope of [searchScope(selection,"youtu.be",{},"timestamp/asc"),searchScope(selection,"youtube.com",{author_id:["MEE6"]},"timestamp/asc"),searchScope(selection,"youtube.com",{min_id:"333333333333333333"},"timestamp/asc"),searchScope(selection,"youtube.com",{},"timestamp/desc")]) {
        const page={...snapshot(1,[message(2)]),scope}; new SearchTracker(value).observe(page); assert.equal(new SearchTracker(value).summary().processed,0);
    }
    assert.equal(value.records.size,1); assert.equal(value.state.searchTracking.scopes.length,5);
});
test("reported total or changed page results invalidate earlier page evidence", () => {
    const value=collection(); ingest(value,snapshot(1)); ingest(value,snapshot(2));
    ingest(value,snapshot(2,[message(3)],undefined,{reportedTotal:2555})); const tracker=new SearchTracker(value);
    assert.deepEqual(tracker.summary().confirmed,[2]); assert.equal(value.records.size,3);
});
test("filters warn about MEE6, dates and missing domains; domains require separate scopes", () => {
    const value=collection(), page=snapshot(1); page.scope=searchScope(selection,"from:MEE6 youtube.com after:2020",{},"timestamp/asc"); ingest(value,page);
    const tracker=new SearchTracker(value); assert.ok(tracker.summary().warnings.some(x=>x.includes("autora"))); assert.ok(tracker.summary().warnings.some(x=>x.includes("dat"))); assert.ok(tracker.summary().warnings.some(x=>x.includes("youtu.be")));
    ingest(value,snapshot(1,[message(2)],"youtu.be")); assert.ok(!tracker.summary().warnings.some(x=>x.includes("Brak potwierdzonego")));
});
test("interrupted search state restores scopes/pages without resuming navigation or duplicating links", () => {
    const value=collection(); ingest(value,snapshot(1)); const restored=Collection.restore(value.snapshot());
    assert.equal(restored.state.status,"interrupted"); assert.equal(new SearchTracker(restored).summary().processed,1);
    restored.begin(); ingest(restored,snapshot(1)); assert.equal(restored.records.size,1);
});
test("corrupted tracking metadata fails closed while good fallback bank remains readable", () => {
    const value=collection(); ingest(value,snapshot(1)); const broken=value.snapshot(); broken.searchTracking=structuredClone(broken.searchTracking); broken.searchTracking.scopes[0].pages[0].messageCount=-1;
    assert.throws(()=>Collection.restore(broken),/Uszkodzony/);
    const data=dataStore(), persistence=new Persistence(data); persistence.save(value); persistence.save(value);
    const bank=data.load("state-b"); bank.payload="corrupt"; data.save("state-b",bank);
    assert.equal(new Persistence(data).load().records.size,1);
});
test("no fixed page size: 3300 unique links / 6600 occurrences across variable-size pages export exactly", () => {
    const value=collection(); let index=0, pageNumber=0;
    while (index<6600) {
        const count=Math.min(6600-index,13+(pageNumber%37)), items=[];
        for (let i=0;i<count;i++,index++) { const item=message(index); item.content=`https://youtu.be/V${String(Math.floor(index/2)).padStart(10,"0")}`; items.push(item); }
        ingest(value,snapshot(++pageNumber,items,undefined,{reportedTotal:6600}));
    }
    assert.equal(value.resources.size,3300); assert.equal(value.records.size,6600);
    for (const mode of ["unique","all"]) {
        const expected=mode==="unique"?3300:6600;
        assert.equal(exportData(value,"txt",{mode}).trim().split("\r\n").length,expected);
        assert.equal(exportData(value,"csv",{mode}).trim().split("\r\n").length-1,expected);
        const json=JSON.parse(exportData(value,"json",{mode})); assert.equal(json.records.length,expected); assert.equal(json.occurrences.length,6600); assert.equal(Collection.restore(json.collection).records.size,6600);
        assert.equal(json.completeness.status,"partial"); assert.equal(json.searchTracking.scopes[0].pages.length,pageNumber);
    }
});
test("read-only adapter uses documented scope/offset plus verified mounted search messages", () => {
    const item=message(1), root={querySelector:selector=>selector.includes('aria-current')?{textContent:"5"}:selector.includes('totalResults')?{textContent:"2 554 wyników"}:null,querySelectorAll:()=>[{id:`message-content-${item.id}`}]};
    const stores={SearchStore:{getCurrentSearchId:()=>selection.serverID,getSearchResultsQueryString:()=>"in:muzyka youtube.com",getSearchResultsQuery:()=>({channel_id:[selection.channelID],author_id:["MEE6"],sort_by:"timestamp",sort_order:"asc"}),getSearchResultsOffset:()=>100},SearchMessageStore:{getMessage:(channel,id)=>id===item.id?item:null}};
    const adapter=new LocalAdapter({Webpack:{getStore:name=>stores[name]}},{querySelector:()=>root},{pathname:"/"});
    const search=adapter.inspectSearch(selection); assert.equal(search.pageNumber,5); assert.equal(search.reportedTotal,2554); assert.equal(search.offset,100); assert.equal(search.messages.length,1); assert.equal(search.fullPage,false);
});
test("unavailable search query produces a diagnostic instead of fabricated page progress", () => {
    const adapter=new LocalAdapter({Webpack:{getStore:()=>({getCurrentSearchId:()=>selection.serverID})}},{querySelector:()=>null},{pathname:"/"});
    assert.equal(adapter.inspectSearch(selection).unavailable,true);
});
test("scope change stops scanner before collecting from the new query", async () => {
    const plugin=new Plugin(); plugin.active=true; plugin.running=true; plugin.collection=collection(); plugin.collection.process(message(1)); plugin.boundScope=snapshot(1).scope.key;
    plugin.renderSoon=()=>{}; plugin.persistence=new Persistence(dataStore()); plugin.adapter={ensureSelected:()=>{},inspectSearch:()=>snapshot(1,[message(2)],"youtu.be"),read:()=>{throw Error("new scope read");}};
    await plugin.read(); assert.equal(plugin.running,false); assert.equal(plugin.collection.records.size,1); assert.match(plugin.collection.state.completeness.reason,/Zmieniono/);
});
test("pause/save/resume retains data and never navigates the search interface", () => {
    const plugin=new Plugin(); plugin.active=true; plugin.running=true; plugin.collection=collection(); ingest(plugin.collection,snapshot(1)); plugin.persistence=new Persistence(dataStore()); plugin.renderSoon=()=>{};
    plugin.pauseCollection(); assert.equal(plugin.running,false); assert.equal(plugin.paused,true); assert.equal(plugin.collection.records.size,1); assert.equal(new SearchTracker(plugin.persistence.load()).summary().processed,1);
});
test("unavailable native IPC falls back; unavailable download/clipboard leaves manual export", async () => {
    const io = new ExportIO({ui:{openDialog:async()=>{throw Error("IPC unavailable");}},fs:callbackFs(),download:()=>true});
    assert.equal(await io.save("x","x.txt","txt"),"download"); assert.equal(io.dialogError,"IPC unavailable");
    const manual = new ExportIO({download:()=>{throw Error("download failed");},clipboard:()=>{throw Error("clipboard denied");}});
    assert.equal(await manual.save("x","x.txt","txt"),"manual");
});
test("disabling scanner while export dialog is open prevents a subsequent filesystem write", async () => {
    const io = new ExportIO({ui:{openDialog:async()=>({filePath:"unused"})},fs:{writeFile(){throw Error("unexpected write");},readFile(){},rename(){},unlink(){}},cancelled:()=>true});
    assert.equal(await io.save("x","x.txt","txt"),"cancelled");
});
test("search loading timeout keeps the page unprocessed and preserves previous links", async () => {
    const plugin=new Plugin(); plugin.active=true; plugin.running=true; plugin.collection=collection(); plugin.collection.process(message(1)); plugin.persistence=new Persistence(dataStore()); plugin.renderSoon=()=>{};
    const search=snapshot(2,[],undefined,{loaded:false,fullPage:false});
    plugin.adapter={ensureSelected:()=>{},inspectSearch:()=>search,read:()=>({messages:[],warnings:[],searchCursor:25})};
    plugin.searchCandidate={signature:"different",pageKey:search.pageKey,since:Date.now()-21000,pageSince:Date.now()-21000};
    await plugin.read(); const tracker=new SearchTracker(plugin.collection);
    assert.equal(tracker.active().pages[0].status,"timeout"); assert.equal(tracker.summary().processed,0); assert.equal(plugin.collection.records.size,1); assert.ok(plugin.collection.state.warnings.some(x=>x.includes("Timeout")));
});
test("partially failed write cleans only its exclusive temporary and retains destination", async () => {
    const directory=await fs.promises.mkdtemp(path.join(os.tmpdir(),"ytlc-partial-"));
    try {
        const target=path.join(directory,"export.json"); await fs.promises.writeFile(target,"previous"); const polyfill=callbackFs();
        polyfill.writeFile=(temporary,_text,options,callback)=>fs.writeFile(temporary,"partial",options,error=>callback(error || Object.assign(Error("disk full"),{code:"ENOSPC"})));
        await assert.rejects(writeCompatibleFile(polyfill,target,"new"),/disk full/); assert.deepEqual(await fs.promises.readdir(directory),["export.json"]); assert.equal(await fs.promises.readFile(target,"utf8"),"previous");
    } finally { await fs.promises.rm(directory,{recursive:true,force:true}); }
});
test("malformed or changed message cannot be confirmed from an older seen checkpoint", () => {
    const value=collection(), first=snapshot(1); ingest(value,first);
    const changed=snapshot(1,[{...message(1),content:null}],undefined,{fullPage:true}); const tracker=new SearchTracker(value);
    assert.equal(tracker.commit(changed),false); assert.equal(tracker.summary().processed,0); assert.equal(value.records.size,1);
});
test("whole-file JSON corruption hidden by BdApi empty cache cannot be overwritten", () => {
    let writes=0; const api={Plugins:{folder:"/local/plugins"}};
    const polyfill={existsSync:()=>true,readFileSync:()=>"{truncated",writeFile:()=>writes++};
    assert.throws(()=>Plugin.Core.protectEmptyConfig(api,polyfill),/Chroniono istniejący/); assert.equal(writes,0);
    polyfill.readFileSync=()=>JSON.stringify({checkpoint:{slot:"a",generation:1}});
    assert.throws(()=>Plugin.Core.protectEmptyConfig(api,polyfill),/nie zwrócił checkpointów/);
    polyfill.readFileSync=()=>"{}"; assert.equal(Plugin.Core.protectEmptyConfig(api,polyfill),true);
    assert.equal(Plugin.Core.protectEmptyConfig({},null),false);
});
test("tracking budget rolls back only page evidence and retains an exportable collection", () => {
    const value=collection(); value.process(message(1)); value.limits={...Plugin.Core.LIMITS,bytes:value.estimatedBytes+20};
    assert.throws(()=>new SearchTracker(value).commit(snapshot(1)),/Limit pamięci/); assert.equal(value.records.size,1);
    const restored=Collection.restore(value.snapshot()); assert.equal(restored.records.size,1); assert.equal(restored.state.searchTracking.scopes.length,0);
});
test("discovering a page number for an existing offset never counts the same page twice", () => {
    const value=collection(), first={...snapshot(5),pageNumber:null,pageKey:"offset:100",offset:100}; ingest(value,first);
    ingest(value,{...first,pageNumber:5}); const tracker=new SearchTracker(value); assert.equal(tracker.summary().observed,1); assert.equal(tracker.summary().processed,1); assert.deepEqual(tracker.summary().confirmed,[5]);
    const conflict={...first,pageNumber:6}; assert.equal(tracker.commit(conflict),false); assert.equal(tracker.summary().processed,0); assert.equal(value.records.size,1);
});
