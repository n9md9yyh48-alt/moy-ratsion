import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import worker from "../cloudflare/worker.mjs";
import {BudgetLedger,MONTHLY_LIMIT_MICROUSD,estimatedCharge} from "../cloudflare/budget.mjs";

function harness(){
 const data=new Map();
 const tx={get:async k=>structuredClone(data.get(k)),put:async(k,v)=>data.set(k,structuredClone(v))};
 const storage={get:tx.get,put:tx.put,transaction:async fn=>fn(tx)};
 const ledger=new BudgetLedger({storage});
 return {ledger,data};
}
const id=()=>randomUUID();
const start=Date.UTC(2026,10,9,12);
const secrets={
 OPENAI_API_KEY:"mock-only-valid-secret-key",
 AI_ACCESS_TOKEN:"b".repeat(48),
 AI_MODEL:"gpt-6.1-terra"
};
const origin="https://n9md9yyh48-alt.github.io";
function environment(ledger){
 return {...secrets,BUDGET:{
  idFromName: name=>name,
  get:()=>({fetch:request=>ledger.fetch(request)})
 }};
}
function request(path="/api/coach",body={consent:true,messages:[{role:"user",content:"Что приготовить?"}]},token=secrets.AI_ACCESS_TOKEN){
 return new Request("https://worker.example"+path,{
  method:"POST",
  headers:{Origin:origin,"Content-Type":"application/json",Authorization:"Bearer "+token},
  body:JSON.stringify(body)
 });
}
test("reservation is persistent and usage settlement releases unused funds",async()=>{
 const {ledger}=harness();
 const requestId=id();
 const held=await ledger.request("reserve",{id:requestId,kind:"photo"},start);
 assert.equal(held.ok,true);
 assert.equal(held.reserved,50_000);
 assert.equal(held.month,"2026-11");
 let s=await ledger.request("status",{},start);
 assert.equal(s.reserved_usd,0.05);
 assert.equal(s.estimated_spend_usd,0);
 const done=await ledger.request("settle",{id:requestId,month:held.month,
  usage:{input_tokens:2200,output_tokens:260}},start);
 assert.equal(done.ok,true);
 s=await ledger.request("status",{},start);
 assert.equal(s.reserved_usd,0);
 assert.equal(s.estimated_spend_usd,estimatedCharge({input_tokens:2200,output_tokens:260})/1_000_000);
});
test("monthly budget blocks new paid requests when $5 is fully reserved",async()=>{
 const {ledger}=harness();
 let result;
 // 20/day: five different days, 3/minute. No provider settlement => holds remain charged.
 for(let d=0;d<5;d++){
  for(let i=0;i<20;i++){
   const at=start+d*86400000+i*70000;
   result=await ledger.request("reserve",{id:id(),kind:"photo"},at);
   assert.equal(result.ok,true);
  }
 }
 assert.equal((await ledger.request("status",{},start)).remaining_usd,0);
 result=await ledger.request("reserve",{id:id(),kind:"chat"},start+6*86400000);
 assert.equal(result.ok,false);
 assert.equal(result.status,402);
});
test("limits are daily and minute-based, monthly rollovers work",async()=>{
 const {ledger}=harness();
 for(let i=0;i<3;i++)assert.equal(
  (await ledger.request("reserve",{id:id(),kind:"chat"},start+i*5000)).ok,true);
 const blocked=await ledger.request("reserve",{id:id(),kind:"chat"},start+16000);
 assert.equal(blocked.status,429);
 const fresh=await ledger.request("reserve",{id:id(),kind:"chat"},Date.UTC(2026,11,1,10));
 assert.equal(fresh.ok,true);
 assert.equal(fresh.month,"2026-12");
});
test("settlement can close a reservation from the preceding month",async()=>{
 const {ledger}=harness();
 const created=await ledger.request("reserve",{id:id(),kind:"chat"},Date.UTC(2026,10,30,23,59));
 const found=await ledger.request("settle",{id:Object.keys((await ledger.state.storage.get("budget:2026-11")).pending)[0],
  month:created.month,usage:{input_tokens:1000,output_tokens:200}},Date.UTC(2026,11,1,0,1));
 assert.equal(found.ok,true);
 const old=await ledger.request("status",{},Date.UTC(2026,10,30,22));
 assert.ok(old.estimated_spend_usd>0);
 const next=await ledger.request("status",{},Date.UTC(2026,11,1,1));
 assert.equal(next.estimated_spend_usd,0);
});
test("cloudflare proxy fails closed without secrets and rejects unauthenticated calls",async()=>{
 const {ledger}=harness();
 const unconfigured=await worker.fetch(new Request("https://worker.example/health"),{});
 assert.equal((await unconfigured.json()).ready,false);
 const disabled=await worker.fetch(request(),{});
 assert.equal(disabled.status,503);
 const unauthorized=await worker.fetch(request("/api/coach",undefined,"incorrect"),environment(ledger));
 assert.equal(unauthorized.status,401);
 const foreign=await worker.fetch(new Request("https://worker.example/api/coach",{
  method:"POST",headers:{Origin:"https://evil.example","Content-Type":"application/json"}}),environment(ledger));
 assert.equal(foreign.status,403);
});
test("only deliberately approved requests can reserve money",async()=>{
 const {ledger}=harness(),env=environment(ledger);
 const r=await worker.fetch(request("/api/coach",{consent:false,messages:[{role:"user",content:"Hi"}]}),env);
 assert.equal(r.status,400);
 const invalid=await worker.fetch(request("/api/analyze-meal",{consent:true,image_data_url:"https://evil.example/a.png"}),env);
 assert.equal(invalid.status,400);
 const s=await ledger.request("status",{},Date.now());
 assert.equal(s.estimated_spend_usd,0);
 assert.equal(s.reserved_usd,0);
});
test("OpenAI mock is charged by measured token usage, not the initial hold",async()=>{
 const {ledger}=harness(),env=environment(ledger);
 const realFetch=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  assert.equal(String(url),"https://api.openai.com/v1/responses");
  assert.equal(JSON.parse(options.body).model,"gpt-6.1-terra");
  return Response.json({
   status:"completed",usage:{input_tokens:1500,output_tokens:200},
   output:[{type:"message",content:[{type:"output_text",text:"Попробуй овощной салат с индейкой."}]}]
  });
 };
 try{
  const r=await worker.fetch(request(),env);
  assert.equal(r.status,200);
  assert.equal((await r.json()).source,"openai");
  const b=await worker.fetch(new Request("https://worker.example/api/budget",{
   headers:{Origin:origin,Authorization:"Bearer "+secrets.AI_ACCESS_TOKEN}
  }),env);
  assert.equal(b.status,200);
  const spent=(await b.json()).estimated_spend_usd;
  assert.equal(spent,estimatedCharge({input_tokens:1500,output_tokens:200})/1_000_000);
 }finally{globalThis.fetch=realFetch;}
});
test("Wrangler config uses only free-tier SQLite state and leaves secrets out of git",()=>{
 const {readFileSync}=requireShim();
 const c=JSON.parse(readFileSync(new URL("../wrangler.jsonc",import.meta.url),"utf8"));
 assert.equal(c.vars.AI_MODEL,"gpt-6.1-terra");
 assert.equal(c.exports.BudgetLedger.storage,"sqlite");
 assert.deepEqual(c.secrets.required,["OPENAI_API_KEY","AI_ACCESS_TOKEN"]);
 assert.equal(JSON.stringify(c).includes("sk-proj"),false);
});
function requireShim(){
 // The test is ESM so use a lazy wrapper to keep static import ordering simple.
 return {readFileSync:fs.readFileSync};
}
