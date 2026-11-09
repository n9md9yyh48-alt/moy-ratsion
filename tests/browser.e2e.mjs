/* Browser end-to-end tests. Run separately with Playwright, not in node --test *.test.mjs.
   Uses an isolated local browser; never touches the user's iPhone diary or OpenAI API. */
import test,{before,after} from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {readFile} from "node:fs/promises";
import {once} from "node:events";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {chromium} from "playwright";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const types={".js":"text/javascript; charset=utf-8",".html":"text/html; charset=utf-8",
  ".webmanifest":"application/manifest+json",".svg":"image/svg+xml",".json":"application/json"};
let server,browser,base;
before(async()=>{
  server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,"http://localhost");
    if(!url.pathname.startsWith("/moy-ratsion/")){res.writeHead(404);return res.end();}
    const relative=decodeURIComponent(url.pathname.slice("/moy-ratsion/".length))||"index.html";
    const target=path.resolve(root,relative);
    if(!target.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
    try{
      const data=await readFile(target);
      res.writeHead(200,{"Content-Type":types[path.extname(target)]||"application/octet-stream",
        "Cache-Control":"no-store"});
      res.end(data);
    }catch(_){res.writeHead(404);res.end();}
  });
  server.listen(0,"127.0.0.1");
  await once(server,"listening");
  base="http://127.0.0.1:"+server.address().port+"/moy-ratsion/";
  browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
});
after(async()=>{
  if(browser)await browser.close();
  if(server)await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
});
const meal={v:1,id:"qa-meal-20261109",date:"2026-11-09",type:"Завтрак",
  name:"QA тестовый завтрак",kcal:123,protein:5,fat:4,carbs:7};
const code=Buffer.from(JSON.stringify(meal),"utf8").toString("base64url");
async function pageFor(options={}){
  const context=await browser.newContext({
    viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,
    ...options
  });
  const page=await context.newPage();
  return {context,page};
}
test("home, recipes and free ChatGPT sharing are visible without paid AI",async()=>{
  const {context,page}=await pageFor();
  const errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  const api=[];
  page.on("request",r=>{if(/api\.openai\.com|openrouter\.ai/.test(r.url()))api.push(r.url());});
  try{
    await page.goto(base,{waitUntil:"load"});
    await page.locator("#selectedDate").waitFor();
    assert.match(await page.title(),/Мой рацион/);
    await page.locator('button[data-tab="recipes"]').click();
    assert.equal(await page.locator("#recipes").isVisible(),true);
    assert.ok((await page.locator("#recipeList .recipe").count())>=1);
    await page.locator('button[data-tab="share"]').click();
    assert.equal(await page.locator("#share").isVisible(),true);
    await page.locator("#chatShareDate").fill("2026-11-09");
    await page.locator("#chatShareDate").dispatchEvent("change");
    await page.locator('button[onclick="vShareChatDay()"]').click();
    assert.match(await page.locator("#chatSharePreview").inputValue(),/2026-11-09.*записей нет/);
    assert.equal(await page.locator("#chatSharePreview").isVisible(),true);
    assert.equal(await page.locator("#coach").count(),0);
    assert.equal(api.length,0);
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});
test("a meal is saved only in isolated localStorage, visible on date and after reload",async()=>{
  const {context,page}=await pageFor();
  try{
    await page.goto(base,{waitUntil:"load"});
    await page.locator('button[onclick="openMeal()"]').click();
    await page.locator("#mealDate").fill("2026-11-09");
    await page.locator("#mealType").selectOption("Завтрак");
    await page.locator("#mealName").fill("QA тестовый завтрак");
    await page.locator("#mealKcal").fill("123");
    await page.locator("#mealProtein").fill("5");
    await page.locator("#mealFat").fill("4");
    await page.locator("#mealCarbs").fill("7");
    await page.locator("#mealForm button[type=submit]").click();
    await page.locator("#mealDialog").waitFor({state:"hidden"});
    assert.equal(await page.locator("#selectedDate").inputValue(),"2026-11-09");
    assert.match(await page.locator("#meals").innerText(),/QA тестовый завтрак/);
    assert.match(await page.locator("#todayKcal").innerText(),/123/);
    await page.reload({waitUntil:"load"});
    await page.locator("#selectedDate").fill("2026-11-09");
    await page.locator("#selectedDate").dispatchEvent("change");
    assert.match(await page.locator("#meals").innerText(),/QA тестовый завтрак/);
    const data=await page.evaluate(()=>JSON.parse(localStorage.getItem("moy-ratsion-v1")));
    assert.equal(data.meals.length,1);
    assert.equal(data.meals[0].kcal,123);
  }finally{await context.close();}
});
test("a chat link in an iPhone Safari-like browser does not silently save into wrong storage",async()=>{
  const {context,page}=await pageFor({
    userAgent:"Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27 Mobile/15E148 Safari/604.1"
  });
  const dialogs=[];
  page.on("dialog",d=>{dialogs.push(d.message());d.dismiss();});
  try{
    await page.goto(base+"#meal="+code,{waitUntil:"load"});
    assert.equal(await page.locator("#chatMealCode").inputValue(),"meal:"+code);
    assert.match(await page.locator("#chatMealPreview").innerText(),/123 ккал/);
    assert.match(await page.locator("#chatMealStatus").innerText(),/Safari/);
    const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem("moy-ratsion-v1")||"null"));
    assert.equal(stored?.meals.length||0,0);
    assert.equal(dialogs.length,0);
  }finally{await context.close();}
});
test("chat link in a home-screen-like PWA needs confirmation and ignores repeat imports",async()=>{
  const {context,page}=await pageFor({
    userAgent:"Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148"
  });
  await context.addInitScript(()=>{
    Object.defineProperty(navigator,"standalone",{configurable:true,get:()=>true});
  });
  const dialogs=[];
  page.on("dialog",async d=>{dialogs.push(d.message());await d.accept();});
  try{
    await page.goto(base+"#meal="+code,{waitUntil:"load"});
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem("moy-ratsion-v1")).meals.length===1);
    assert.match(await page.locator("#chatMealStatus").innerText(),/Добавлено/);
    await page.goto(base+"#meal="+code,{waitUntil:"load"});
    const data=await page.evaluate(()=>JSON.parse(localStorage.getItem("moy-ratsion-v1")));
    assert.equal(data.meals.length,1);
    assert.ok(dialogs.some(x=>/уже есть/.test(x)));
  }finally{await context.close();}
});
test("JSON backup downloads and restores a verified diary on an isolated browser",async()=>{
  const {context,page}=await pageFor({acceptDownloads:true});
  const dialogs=[];
  page.on("dialog",async d=>{dialogs.push(d.message());await d.accept();});
  try{
    await page.goto(base+"#meal="+code,{waitUntil:"load"});
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem("moy-ratsion-v1")||"null")?.meals?.length===1);
    await page.locator('button[data-tab="reports"]').click();
    const downloadEvent=page.waitForEvent("download");
    await page.locator('button[onclick="exportData()"]').click();
    const file=await downloadEvent;
    assert.match(file.suggestedFilename(),/^moy-ratsion-backup-.*\.json$/);
    const backup=await readFile(await file.path(),"utf8");
    const parsed=JSON.parse(backup);
    assert.equal(parsed.meals.length,1);
    assert.equal(parsed.meals[0].id,"chat-"+meal.id);
    assert.equal(parsed.meals[0].kcal,123);
    await page.evaluate(()=>localStorage.removeItem("moy-ratsion-v1"));
    await page.reload({waitUntil:"load"});
    assert.equal(await page.evaluate(()=>localStorage.getItem("moy-ratsion-v1")),null);
    await page.locator('button[data-tab="settings"]').click();
    const chooserEvent=page.waitForEvent("filechooser");
    await page.locator('button[onclick="importData()"]').click();
    const chooser=await chooserEvent;
    await chooser.setFiles({name:"backup.json",mimeType:"application/json",buffer:Buffer.from(backup)});
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem("moy-ratsion-v1")||"null")?.meals?.length===1);
    const restored=await page.evaluate(()=>JSON.parse(localStorage.getItem("moy-ratsion-v1")));
    assert.equal(restored.meals[0].id,"chat-"+meal.id);
    assert.ok(dialogs.some(x=>/Заменить дневник/.test(x)));
  }finally{await context.close();}
});

test("offline PWA shell stays available after service worker installs",async()=>{
  const {context,page}=await pageFor({serviceWorkers:"allow"});
  try{
    await page.goto(base,{waitUntil:"load"});
    await page.waitForFunction(async()=>navigator.serviceWorker&&
      !!(await navigator.serviceWorker.ready),null,{timeout:15000});
    await page.reload({waitUntil:"load"});
    await page.waitForFunction(()=>!!navigator.serviceWorker.controller,{timeout:15000});
    await context.setOffline(true);
    await page.reload({waitUntil:"domcontentloaded",timeout:15000});
    assert.match(await page.title(),/Мой рацион/);
    assert.equal(await page.locator("#home").isVisible(),true);
  }finally{await context.close();}
});
