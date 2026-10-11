"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const Plugin = require("../YouTubeLinkCollector.plugin.js");
function movableFixture() {
    const events = () => ({listeners:new Map(),addEventListener(name,fn){this.listeners.set(name,fn);},removeEventListener(name){this.listeners.delete(name);}});
    const view={...events(),innerWidth:1200,innerHeight:800},positions=[];
    const root={ownerDocument:{defaultView:view},style:{},getBoundingClientRect(){return{left:parseFloat(this.style.left)||516,top:parseFloat(this.style.top)||100,width:Math.min(660,view.innerWidth-48)};}};
    const handle={...events(),dataset:{},setAttribute(){},capture:null,setPointerCapture(id){this.capture=id;},hasPointerCapture(id){return this.capture===id;},releasePointerCapture(){this.capture=null;},getBoundingClientRect:()=>({height:70})};
    const cleanup=Plugin.Core.movableWindow(root,handle,p=>positions.push(p));
    const emit=(name,extra={})=>handle.listeners.get(name)?.({target:handle,button:0,isPrimary:true,pointerId:1,clientX:600,clientY:120,preventDefault(){},...extra});
    handle.closest=()=>null;
    return{root,handle,view,positions,cleanup,emit};
}
test("window pointer dragging excludes buttons, clamps the title to the viewport and releases capture on cancel",()=>{
    const f=movableFixture();
    f.emit("pointerdown",{target:{closest:()=>({})}});f.emit("pointermove",{clientX:800});assert.equal(f.positions.length,0);
    f.emit("pointerdown");f.emit("pointermove",{clientX:300,clientY:250});assert.deepEqual(f.positions.at(-1),{left:216,top:230});
    f.emit("pointermove",{pointerId:2,clientX:0});assert.equal(f.positions.length,1);
    f.emit("pointermove",{clientX:-3000,clientY:3000});assert.deepEqual(f.positions.at(-1),{left:8,top:722});
    f.emit("pointercancel");assert.equal(f.handle.capture,null);f.emit("pointermove",{clientX:500});assert.equal(f.positions.length,2);
    f.cleanup();assert.equal(f.handle.listeners.size,0);assert.equal(f.view.listeners.size,0);
});
test("window keyboard movement and viewport resize keep the header reachable; disposal removes resize and active capture",()=>{
    const f=movableFixture();f.emit("keydown",{key:"ArrowLeft"});assert.deepEqual(f.positions.at(-1),{left:496,top:100});
    f.emit("keydown",{key:"ArrowDown",shiftKey:true});assert.deepEqual(f.positions.at(-1),{left:496,top:150});
    f.view.innerWidth=480;f.view.innerHeight=200;f.view.listeners.get("resize")();assert.deepEqual(f.positions.at(-1),{left:40,top:122});
    f.emit("pointerdown");f.cleanup();assert.equal(f.handle.capture,null);assert.equal(f.view.listeners.size,0);
});
// Small DOM fixture for lifecycle cleanup. Layout is checked separately in a browser.
class Node {
    constructor(tag = "DIV") { this.tagName = tag.toUpperCase(); this.nodeType = 1; this.children = []; this.listeners = new Map(); this.isConnected = false; this.classList = {contains: name => (this.className || "").split(" ").includes(name)}; }
    append(...children) { for (const child of children) { child.isConnected = this.isConnected; this.children.push(child); } }
    remove() { this.isConnected = false; }
    addEventListener(name, listener) { this.listeners.set(name, listener); }
    removeEventListener(name) { this.listeners.delete(name); }
    closest(selector) { return selector === ".ytlc" && this.classList.contains("ytlc") ? this : null; }
    setAttribute(name, value) { this[name] = value; }
}
function environment() {
    const previous = {document: global.document, location: global.location, BdApi: global.BdApi};
    const body = new Node("body"); body.isConnected = true;
    const listeners = new Map(), values = new Map(), styles = new Map();
    global.document = {body, createElement: tag => new Node(tag), addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name), querySelectorAll: () => []};
    global.location = {pathname: "/channels/222222222222222222/111111111111111111"};
    global.BdApi = class {
        constructor(name) {
            assert.equal(name, "YouTubeLinkCollector");
            this.Data = {load: key => structuredClone(values.get(key)), save: (key, data) => values.set(key, structuredClone(data)), delete: key => values.delete(key)};
            this.Webpack = {getStore: () => undefined};
            this.DOM = {addStyle: css => styles.set(name, css), removeStyle: () => styles.delete(name)};
            this.UI = {showToast: () => {}, showConfirmationModal: () => {}};
        }
    };
    return {listeners, values, styles, restore: () => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete global[key]; else global[key] = value; } }};
}
test("plugin start/stop is idempotent and cleans timers, DOM, styles and key listeners", () => {
    const env = environment(), plugin = new Plugin();
    try {
        plugin.start(); plugin.start();
        assert.equal(env.listeners.size, 1); assert.equal(env.styles.size, 1); assert.ok(env.styles.get("YouTubeLinkCollector").includes(".ytlc"));
        assert.equal(global.document.body.children.length, 1);
        plugin.stop(); plugin.stop();
        assert.equal(env.listeners.size, 0); assert.equal(env.styles.size, 0); assert.equal(plugin.active, false); assert.equal(plugin.launcher.isConnected, false);
    } finally { plugin.stop(); env.restore(); }
});
test("disable interrupts and persists a running scan without losing occurrences", () => {
    const env = environment(), plugin = new Plugin();
    try {
        plugin.start();
        plugin.collection = new Plugin.Core.Collection({channelID: "111111111111111111", serverID: "222222222222222222", channelName: "muzyka", serverName: "Serwer"});
        plugin.collection.begin(); plugin.running = true;
        plugin.collection.process({id: "333333333333333333", channel_id: "111111111111111111", content: "https://youtu.be/dQw4w9WgXcQ", embeds: []});
        plugin.stop();
        const state = new Plugin.Core.Persistence(plugin.api.Data).load();
        assert.equal(state.records.size, 1); assert.equal(state.state.status, "interrupted");
        plugin.start(); assert.equal(plugin.collection.records.size, 1); assert.equal(plugin.running, false);
    } finally { plugin.stop(); env.restore(); }
});
test("persistence failures stop collection while retaining exportable in-memory records", () => {
    const env = environment(), plugin = new Plugin();
    try {
        plugin.start(); plugin.collection = new Plugin.Core.Collection({channelID: "111111111111111111", serverID: "222222222222222222"});
        plugin.collection.begin(); plugin.running = true;
        plugin.collection.process({id: "333333333333333333", channel_id: "111111111111111111", content: "https://youtu.be/dQw4w9WgXcQ", embeds: []});
        plugin.api.Data.save = () => { throw new Error("disk full"); };
        assert.equal(plugin.save(), false); assert.equal(plugin.running, false); assert.equal(plugin.collection.state.status, "failed");
        assert.equal(JSON.parse(Plugin.Core.exportData(plugin.collection, "json")).totalOccurrences, 1);
    } finally { plugin.stop(); env.restore(); }
});
test("self-generated text mutations are ignored by the local scan observer", () => {
    const plugin = new Plugin(); plugin.running = true;
    let scheduled = 0; plugin.scheduleRead = () => scheduled++;
    const root = new Node(); root.className = "ytlc";
    plugin.observer({target: {nodeType: 3, parentElement: root}});
    assert.equal(scheduled, 0);
    plugin.observer({target: new Node()}); assert.equal(scheduled, 1);
});
test("disable during a search batch persists committed messages but never confirms an unfinished page", async () => {
    const env=environment(), plugin=new Plugin();
    try {
        plugin.start(); plugin.collection=new Plugin.Core.Collection({channelID:"111111111111111111",serverID:"222222222222222222"}); plugin.collection.begin(); plugin.running=true;
        const messages=Array.from({length:250},(_,index)=>({id:String(333333333333333333n+BigInt(index)),channel_id:"111111111111111111",content:`https://youtu.be/V${String(index).padStart(10,"0")}`,embeds:[]}));
        const search={scope:Plugin.Core.searchScope(plugin.collection.state.selection,"youtube.com",{},"timestamp/asc"),pageNumber:1,pageKey:"page:1",reportedTotal:250,totalPages:1,loaded:true,fullPage:true,messages,source:"client-results"};
        plugin.adapter={ensureSelected:()=>{},inspectSearch:()=>search,read:()=>({messages,warnings:[],searchCursor:0})};
        plugin.renderSoon=()=>{if(plugin.running && plugin.collection.seen.size>=100) plugin.stop();};
        await plugin.read(); const restored=new Plugin.Core.Persistence(plugin.api.Data).load();
        assert.equal(plugin.active,false); assert.equal(restored.records.size,100); assert.equal(new Plugin.Core.SearchTracker(restored).summary().processed,0);
        assert.equal(env.listeners.size,0); assert.equal(env.styles.size,0);
    } finally { plugin.stop(); env.restore(); }
});
