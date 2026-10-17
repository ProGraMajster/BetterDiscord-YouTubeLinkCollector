"use strict";
const {test}=require("node:test"), assert=require("node:assert/strict");
const fs=require("node:fs"), path=require("node:path"), os=require("node:os"), {spawnSync}=require("node:child_process");
const Plugin=require("../YouTubeLinkCollector.plugin.js");
const {Collection,Persistence,SearchTracker,LocalAdapter,UIPageNavigator,LiveDiagnostics,pageLoadTimeout}=Plugin.Core;
const selection={channelID:"111111111111111111",serverID:"222222222222222222",channelName:"test",serverName:"Fixture"};
function client(page=19,total=1250,size=25) {
    const previous={document:global.document,location:global.location};
    const state={page,query:"youtube.com",loading:false,clicks:[]}, values=new Map();
    const item=n=>({id:String(333333333333333333n+BigInt(n)),channel_id:selection.channelID,content:`https://youtu.be/V${String(n).padStart(10,"0")}`,embeds:[]});
    const filters={channel_id:[selection.channelID],sort_by:"timestamp",sort_order:"asc"};
    const props={searchContext:{type:"GUILD",guildId:selection.serverID},search:{},messages:[],searchResultsQuery:filters,blockCount:0,ignoreCount:0};
    const pagination={currentPage:page,pageSize:size,totalCount:total};
    const next={isConnected:true,disabled:false,getAttribute:()=>null,click(){state.clicks.push("next");state.loading=true;}},prev={...next,click(){state.clicks.push("prev");state.loading=true;}};
    const root={querySelector:selector=>selector.includes('rel="next"')?next:null,querySelectorAll:selector=>selector==='[rel="next"]'?[next]:selector==='[rel="prev"]'?[prev]:[]};
    const doc={querySelector:()=>root,querySelectorAll:()=>[]},loc={pathname:`/channels/${selection.serverID}/${selection.channelID}`};
    const stores={SelectedChannelStore:{getChannelId:()=>selection.channelID},ChannelStore:{getChannel:()=>({id:selection.channelID,guild_id:selection.serverID,type:0,name:"test"})},GuildStore:{getGuild:()=>({name:"Fixture"})},PermissionStore:{can:()=>true},MessageStore:{getMessages:()=>({_array:[]})},SearchQueryStore:{getSearchResultsQueryString:()=>state.query,getSearchResultsQuery:()=>filters,getSearchResultsOffset:()=>(state.page-1)*size,getSearchMode:()=>"oldest"},SelectedSearchContextStore:{getSelectedSearchContext:()=>props.searchContext},SearchMessageStore:{getIsFetching:()=>state.loading,getIsIndexing:()=>false,getMessage:id=>state.messages.find(m=>m.id===id)}};
    const api={Data:{load:k=>structuredClone(values.get(k)),save:(k,v)=>values.set(k,structuredClone(v)),delete:k=>values.delete(k)},Webpack:{getStore:name=>stores[name]},ReactUtils:{getInternalInstance:()=>({memoizedProps:props,child:{memoizedProps:pagination}})},UI:{}};
    function show(number){state.page=number;state.loading=false;state.messages=Array.from({length:Math.min(size,total-(number-1)*size)},(_,n)=>item((number-1)*size+n));props.messages=state.messages;props.search={offset:(number-1)*size,totalResults:total,isSearching:false};pagination.currentPage=number;next.disabled=number===Math.ceil(total/size);}
    show(page); global.document=doc;global.location=loc;
    const makePlugin=collection=>{const p=new Plugin();p.active=true;p.api=api;p.collection=collection||new Collection(selection,{pageDelayMinSeconds:0,pageDelayMaxSeconds:0});p.persistence=new Persistence(api.Data);p.adapter=new LocalAdapter(api,doc,loc);p.renderSoon=()=>{};p.scheduleRead=()=>{};return p;};
    return {state,props,api,show,makePlugin,restore(){for(const[k,v]of Object.entries(previous)){if(v===undefined)delete global[k];else global[k]=v;}}};
}
async function capture(p){await p.read();await p.read();}
test("real plugin start on page 19 of 50 captures page 19 then clicks Next, never Previous",async()=>{
    const f=client(),p=f.makePlugin();try{p.startAllPages("json");assert.equal(p.running,true);assert.equal(p.navigator.timeoutMs,90000);p.navigator.stableMs=0;await capture(p);assert.deepEqual(f.state.clicks,["next"]);assert.equal(p.collection.records.size,25);assert.equal(new SearchTracker(p.collection).active().currentPage,19);assert.equal(p.persistence.load().state.checkpoint.runMode,"auto");}finally{p.stopCollection();f.restore();}
});
test("failure on page 19 resumes automatic capture and advances to page 20 without rewind",async()=>{
    const f=client(),p=f.makePlugin();try{
        p.startAllPages("json");p.navigator.stableMs=0;await capture(p);p.collection.fail(Error("Transition timed out"));p.stopCollection(null,true);
        const count=p.collection.records.size;f.show(19);
        p.resumeCollection();assert.equal(p.navigator.fromBeginning,false);p.navigator.stableMs=0;await capture(p);
        assert.deepEqual(f.state.clicks,["next","next"]);assert.equal(p.collection.records.size,count);assert.equal(p.collection.state.status,"running");assert.equal(p.autoExportFormat,"json");
    }finally{p.stopCollection();f.restore();}
});
test("restart retains resume mode and format but never starts navigation unattended",async()=>{
    const f=client(),p=f.makePlugin();let restored;
    try{p.startAllPages("csv");p.navigator.stableMs=0;await capture(p);p.stopCollection();restored=f.makePlugin(p.persistence.load());assert.equal(restored.running,false);assert.equal(restored.navigator,undefined);f.show(20);restored.resumeCollection();restored.navigator.stableMs=0;await capture(restored);assert.deepEqual(f.state.clicks,["next","next"]);assert.equal(restored.collection.records.size,50);assert.equal(restored.autoExportFormat,"csv");}finally{p.stopCollection();restored?.stopCollection();f.restore();}
});
test("legacy navigation checkpoint infers automatic resume; explicitly selected local mode remains local",()=>{
    const f=client(),p=f.makePlugin();try{p.startAllPages();p.stopCollection();delete p.collection.state.checkpoint.runMode;assert.equal(p.canResumeAuto(),true);p.collection.state.checkpoint.runMode="local";assert.equal(p.canResumeAuto(),false);}finally{p.stopCollection();f.restore();}
});
test("resume refuses changed query without erasing data or accepting a new scope",()=>{
    const f=client(),p=f.makePlugin();try{p.startAllPages();p.stopCollection();const key=new SearchTracker(p.collection).active().key;f.state.query="youtu.be";let message;p.showError=text=>{message=text;};p.resumeCollection();assert.equal(p.running,false);assert.equal(p.navigator,null);assert.match(message,/inne filtry/);assert.equal(new SearchTracker(p.collection).active().key,key);assert.deepEqual(f.state.clicks,[]);}finally{p.stopCollection();f.restore();}
});
test("incomplete hit object is recovered from the exact mounted ID rather than skipping a result",()=>{
    const f=client(),p=f.makePlugin();try{f.props.messages=[{id:f.state.messages[0].id},...f.state.messages.slice(1)];const search=p.adapter.inspectSearch(selection);assert.equal(search.fullPage,true);assert.equal(search.messages.length,25);assert.equal(p.adapter.searchDiagnostics.recovered,1);assert.equal(p.adapter.searchDiagnostics.unresolved,0);}finally{f.restore();}
});
test("genuinely missing 25th message remains incomplete and no automatic click is possible",async()=>{
    const f=client(),p=f.makePlugin();try{const missing=f.state.messages[0].id;f.state.messages=f.state.messages.slice(1);f.props.messages=[{id:missing},...f.state.messages];p.startAllPages();p.navigator.stableMs=0;await capture(p);assert.equal(p.collection.records.size,24);assert.equal(p.adapter.searchDiagnostics.fullPage,false);assert.equal(p.adapter.searchDiagnostics.unresolvedReasons["missing-in-store"],1);assert.deepEqual(f.state.clicks,[]);assert.equal(p.activitySnapshot().phase,"loading");}finally{p.stopCollection();f.restore();}
});
test("native page 6 regression: 24 selected-channel hits plus one complete foreign hit advances without importing foreign links",async()=>{
    const f=client(6,2414),p=f.makePlugin();try{
        f.state.messages[24]={...f.state.messages[24],channel_id:"999999999999999999"};f.props.messages=f.state.messages;
        p.startAllPages();p.navigator.stableMs=0;await capture(p);
        assert.deepEqual(f.state.clicks,["next"]);assert.equal(p.collection.records.size,24);
        const d=p.adapter.searchDiagnostics;assert.equal(d.fullPage,true);assert.equal(d.readMessages,24);assert.equal(d.resolvedHits,25);assert.equal(d.outsideChannel,1);assert.equal(d.unresolved,0);
        const tracker=new SearchTracker(p.collection),page=tracker.active().pages[0];assert.equal(page.status,"processed");assert.equal(page.messageCount,25);assert.deepEqual(page.excludedIDs,[f.state.messages[24].id]);
        const a=tracker.accounting();assert.equal(a.read,24);assert.equal(a.reviewed,25);assert.equal(a.outsideChannel,1);assert.equal(a.unverified,0);assert.equal(a.withoutLinks,0);
        const saved=p.persistence.load();assert.deepEqual(new SearchTracker(saved).accounting(),a);assert.equal(saved.records.size,24);
        const json=JSON.stringify(saved.snapshot());assert.equal(json.includes(f.state.messages[24].content),false);
    }finally{p.stopCollection();f.restore();}
});
test("entire foreign-channel pages are qualified independently and do not look like repeated empty selected pages",async()=>{
    const f=client(1,50),p=f.makePlugin();try{
        const foreign=()=>{f.state.messages=f.state.messages.map(m=>({...m,channel_id:"999999999999999999"}));f.props.messages=f.state.messages;};foreign();
        p.startAllPages();p.navigator.stableMs=0;await capture(p);assert.deepEqual(f.state.clicks,["next"]);assert.equal(p.collection.records.size,0);
        f.show(2);foreign();p.export=async()=>{};await capture(p);
        const tracker=new SearchTracker(p.collection);assert.equal(tracker.summary().processed,2);assert.equal(tracker.accounting().outsideChannel,50);assert.equal(tracker.accounting().allPages,true);assert.equal(p.autoFinished,true);
    }finally{p.stopCollection();f.restore();}
});
test("incomplete foreign hit resolves its exact ID while normal channel resolver still refuses it",()=>{
    const f=client(),p=f.makePlugin();try{
        f.state.messages[24]={...f.state.messages[24],channel_id:"999999999999999999"};f.props.messages=[...f.state.messages.slice(0,24),{id:f.state.messages[24].id}];
        assert.equal(p.adapter.resolve(f.state.messages[24].id,selection.channelID),null);
        const search=p.adapter.inspectSearch(selection);assert.equal(search.fullPage,true);assert.equal(search.outsideChannel,1);assert.equal(search.messages.length,24);
    }finally{f.restore();}
});
test("incomplete foreign payload and duplicate IDs cannot be declared a complete page",()=>{
    const f=client(),p=f.makePlugin();try{
        f.state.messages[24]={...f.state.messages[24],channel_id:"999999999999999999",content:null};f.props.messages=f.state.messages;
        assert.equal(p.adapter.inspectSearch(selection).fullPage,false);assert.equal(p.adapter.searchDiagnostics.unresolved,1);
        f.show(19);f.props.messages=[...f.state.messages.slice(0,24),f.state.messages[0]];
        assert.equal(p.adapter.inspectSearch(selection).fullPage,false);
    }finally{f.restore();}
});
test("excluded IDs are validated, budgeted and preserved in schema-1 JSON without marking them linkless",async()=>{
    const f=client(1,25),p=f.makePlugin();try{
        f.state.messages[24]={...f.state.messages[24],channel_id:"999999999999999999"};f.props.messages=f.state.messages;p.export=async()=>{};
        p.startAllPages();p.navigator.stableMs=0;await capture(p);
        const raw=p.collection.snapshot(),copy=Collection.restore(raw);assert.equal(raw.schemaVersion,1);assert.equal(new SearchTracker(copy).accounting().outsideChannel,1);
        for(const excludedIDs of [["bad"],[f.state.messages[24].id,f.state.messages[24].id],["888888888888888888"]]){
            const bad=structuredClone(raw);bad.searchTracking.scopes[0].pages[0].excludedIDs=excludedIDs;assert.throws(()=>Collection.restore(bad),/spoza/);
        }
    }finally{p.stopCollection();f.restore();}
});
test("a verified page change with partial results is a read failure, not a failed client click",()=>{
    const f=client(1,50),p=f.makePlugin();try{
        const n=new UIPageNavigator({stableMs:0,timeoutMs:30000}),first=p.adapter.inspectSearch(selection);
        n.tick(first,0);assert.equal(n.tick(first,1).type,"capture");n.afterCommit(first,1);
        f.show(2);f.state.messages=f.state.messages.slice(0,24);f.props.messages=f.state.messages;
        const next=p.adapter.inspectSearch(selection);assert.equal(n.tick(next,10).type,"wait");assert.equal(n.phase,"reading");
        const result=n.tick(next,30011);assert.equal(result.type,"error");assert.match(result.message,/Timeout odczytu.*24\/25/);
    }finally{f.restore();}
});
test("incomplete MessageStore object cannot shadow a complete SearchMessageStore record",()=>{
    const id="333333333333333333",message={id,channel_id:selection.channelID,content:"https://youtu.be/V0000000000",embeds:[]};
    const stores={MessageStore:{getMessage:()=>({...message,content:null})},SearchMessageStore:{getMessage:()=>message}};
    const adapter=new LocalAdapter({Webpack:{getStore:name=>stores[name]}},{querySelector:()=>null},{});
    assert.equal(adapter.resolve(id,selection.channelID),message);
});
test("mounted message recovery follows the committed React branch and checks the channel",()=>{
    const id="333333333333333333",message={id,channel_id:selection.channelID,content:"https://youtu.be/V0000000000",embeds:[]};
    const old={memoizedProps:{message:{...message,content:"stale"}}},current={memoizedProps:{message}},oldRoot={stateNode:{}},currentRoot={};
    old.alternate=current;current.alternate=old;old.return=oldRoot;current.return=currentRoot;oldRoot.alternate=currentRoot;currentRoot.alternate=oldRoot;oldRoot.child=old;currentRoot.child=current;oldRoot.stateNode.current=currentRoot;
    const adapter=new LocalAdapter({Webpack:{getStore:()=>null},ReactUtils:{getInternalInstance:()=>old}},{querySelector:()=>({})},{});
    assert.equal(adapter.resolve(id,selection.channelID),message);assert.equal(adapter.resolve(id,"999999999999999999"),null);
});
test("timeout setting survives checkpoints, is bounded, and is independent of pacing",()=>{
    const c=new Collection(selection,{pageDelayMinSeconds:60,pageDelayMaxSeconds:120,pageLoadTimeoutSeconds:180});assert.equal(pageLoadTimeout(Collection.restore(c.snapshot()).state.config),180);const raw=c.snapshot();delete raw.config.pageLoadTimeoutSeconds;assert.equal(pageLoadTimeout(Collection.restore(raw).state.config),90);for(const value of [0,14,301,1.5,NaN])assert.throws(()=>pageLoadTimeout({pageLoadTimeoutSeconds:value}));const n=new UIPageNavigator({timeoutMs:90000});assert.match(n.tick(null,0).message,/wyszukiwarki/);
});
test("activity distinguishes page loading, stabilization, pacing and transition with live ages",()=>{
    const p=new Plugin();p.running=true;p.lastCheckAt=1000;p.lastProgressAt=2000;p.navigator=new UIPageNavigator();p.navigator.started=2000;assert.equal(p.activitySnapshot(5000).phase,"loading");p.liveSearch={loaded:true,fullPage:true};p.navigator.candidate={};assert.equal(p.activitySnapshot(5000).phase,"stabilizing");p.navigationDelay={dueAt:9000};assert.equal(p.activitySnapshot(5000).remainingDelaySeconds,4);p.navigationDelay=null;p.navigator.phase="waiting";assert.equal(p.activitySnapshot(5000).phase,"transition");assert.equal(p.activitySnapshot(5000).checkedSecondsAgo,4);
});
test("diagnostic snapshot excludes conversation content, identities, query text, raw errors and URLs",()=>{
    const f=client(),p=f.makePlugin();try{p.collection.process(f.state.messages[0]);p.collection.fail(Error("PRIVATE ERROR VALUE"));f.state.query="PRIVATE QUERY VALUE";const text=JSON.stringify(p.diagnosticSnapshot());for(const value of [selection.channelID,selection.serverID,f.state.messages[0].content,"PRIVATE ERROR VALUE","PRIVATE QUERY VALUE"])assert.equal(text.includes(value),false);assert.equal(JSON.parse(text).search.readMessages,25);}finally{f.restore();}
});
test("live diagnostic bridge and CLI exchange fresh read-only snapshots without config writes",async()=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),"ytlc-live-")),cli=path.resolve(__dirname,"../tools/live-diagnostics.mjs");
    let bridge;
    try{
        fs.writeFileSync(path.join(dir,"YouTubeLinkCollector.config.json"),"PRIVATE CONFIG");
        assert.equal(spawnSync(process.execPath,[cli,"--connect","--folder",dir]).status,0);
        bridge=new LiveDiagnostics(fs,dir,()=>({version:Plugin.Core.VERSION,active:true,search:{readMessages:25}}));bridge.enabled=true;await bridge.poll();
        const result=spawnSync(process.execPath,[cli,"--folder",dir],{encoding:"utf8"});assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).search.readMessages,25);
        const requestFile=path.join(dir,"YouTubeLinkCollector.debug-request.json"),request=JSON.parse(fs.readFileSync(requestFile));request.nonce="f".repeat(32);fs.writeFileSync(requestFile,JSON.stringify(request));assert.equal(spawnSync(process.execPath,[cli,"--folder",dir]).status,1);
        assert.equal(spawnSync(process.execPath,[cli,"--disconnect","--folder",dir]).status,0);assert.equal(fs.existsSync(requestFile),false);assert.equal(fs.readFileSync(path.join(dir,"YouTubeLinkCollector.config.json"),"utf8"),"PRIVATE CONFIG");
    }finally{bridge?.stop();assert.ok(path.resolve(dir).startsWith(path.join(path.resolve(os.tmpdir()),"ytlc-live-")));fs.rmSync(dir,{recursive:true,force:true});}
});
test("live bridge ignores expired requests and rejects every command or script field",async()=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),"ytlc-live-"));let calls=0;
    const bridge=new LiveDiagnostics(fs,dir,()=>{calls++;return{};});bridge.enabled=true;
    try{for(const extra of [{expiresAt:Date.now()-1},{expiresAt:Date.now()+3600000},{expiresAt:Date.now()+60000,command:"eval"}]){fs.writeFileSync(path.join(dir,"YouTubeLinkCollector.debug-request.json"),JSON.stringify({protocol:1,nonce:"a".repeat(32),...extra}));await bridge.poll();}assert.equal(calls,0);assert.equal(fs.existsSync(path.join(dir,"YouTubeLinkCollector.diagnostics.json")),false);}finally{bridge.stop();assert.ok(path.resolve(dir).startsWith(path.join(path.resolve(os.tmpdir()),"ytlc-live-")));fs.rmSync(dir,{recursive:true,force:true});}
});
