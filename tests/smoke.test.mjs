import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const files = ["app.js", "photo-safe.js", "features-v12.js", "recipes-extra.js", "extras.js", "my-foods.js", "meal-builder.js", "ai-config.js", "ai-client.js", "coach-client.js", "chat-meal.js"];
const source = Object.fromEntries(files.map(file => [file, fs.readFileSync(new URL("../" + file, import.meta.url), "utf8")]));
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const serviceWorker = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");

function iso(delta = 0) {
  const d = new Date();
  d.setDate(d.getDate() + delta);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
    "-" + String(d.getDate()).padStart(2, "0");
}
function initialData(day = iso(-1)) {
  return { meals: [{ id: "old-1", date: day, type: "Завтрак", name: "Яйцо", kcal: 160,
    protein: 12, fat: 11, carbs: 1, photo: "data:image/jpeg;base64,AAAA" }],
    weights: [{date: day, value: 110}], settings: {calories: 2500, start: 115, target: 100} };
}
function environment(seed = initialData(), options = {}) {
  const state = new Map([["moy-ratsion-v1", JSON.stringify(seed)]]);
  const elements = new Map();
  const alerts = [], confirmations = [];
  let quota = false, counter = 0;
  const canvas = new Proxy({}, {get: () => () => {}, set: () => true});
  function element(id) {
    if (!elements.has(id)) {
      elements.set(id, {id, value: "", checked: false, files: [], innerHTML: "", textContent: "",
        style: {}, classList: {toggle() {}}, dataset: {}, reset() {},
        showModal() {this.open = true}, close() {this.open = false}, getContext() {return canvas}});
    }
    return elements.get(id);
  }
  const document = {
    getElementById: element,
    querySelectorAll: query => query.includes("button.active") ? [{dataset: {tab: "home"}}] : [],
    createElement: tag => tag === "canvas" ? {width:0,height:0,getContext: () => canvas,
      toDataURL: () => "data:image/jpeg;base64,QUFBQUFB"} : {click() {}, remove() {}, style: {}},
    body: {appendChild() {}}
  };
  const localStorage = {
    getItem: key => state.has(key) ? state.get(key) : null,
    setItem(key, value) {if (quota && key === "moy-ratsion-v1") throw Error("QuotaExceededError"); state.set(key, String(value))},
    removeItem: key => state.delete(key)
  };
  const sandbox = {
    window: {}, document, localStorage, navigator: {},
    crypto: {randomUUID: () => "test-" + ++counter},
    alert: message => alerts.push(String(message)),
    confirm: message => {confirmations.push(String(message)); return true},
    location: {reload() {},hash:options.hash||"",pathname:"/moy-ratsion/",search:""},
    history:{replaceState() {}}, URL: {createObjectURL: () => "blob:fake", revokeObjectURL() {}},
    Blob, Image: class {naturalWidth=1800; naturalHeight=1200;
      set src(_value) {Promise.resolve().then(() => this.onload?.());}}, setTimeout: () => {}, clearTimeout: () => {}, AbortController,
    atob, TextDecoder,
    prompt: () => options.token || "",
    fetch: options.fetch || (() => {throw Error("Unexpected network request")})
  };
  const context = vm.createContext(sandbox);
  for (const file of files) {
    if(file === "ai-client.js" && options.endpoint) sandbox.window.MEAL_AI_ENDPOINT = options.endpoint;
    vm.runInContext(source[file], context, {filename: file});
  }
  const read = () => JSON.parse(state.get("moy-ratsion-v1"));
  return {context, element, read, alerts, confirmations, state, setQuota: val => {quota = val},
    run: expr => vm.runInContext(expr, context)};
}

test("all scripts parse and UI contains the required controls", () => {
  for (const file of files) assert.doesNotThrow(() => new vm.Script(source[file], {filename: file}));
  for (const id of ["calendarGrid","quickMeals","foodQuery","foodResults","foodGrams","pantryQuery",
    "recipeFavOnly","weeklyBars","weightHistory","storageDetails","removeMealPhoto","removePhotoWrap",
    "photoPreview","photoPreviewStatus","builderDetails","builderResults","builderQuery","builderParts","builderTotals","builderGrams","builderDishName","builderApplied","aiAnalyzePhoto","aiPhotoStatus","aiPhotoResult","aiPhotoResultText","aiApplyEstimate","coachMessages","coachText","coachShareWeek","coachSend","coachClear","coachStatus","chatMealCode","chatMealStatus"]) assert.match(html, new RegExp('id="' + id + '"'));
  assert.match(html, /src="app.js".*src="features-v12.js".*src="extras.js"/s);
  assert.match(serviceWorker, /extras\.js/);
  assert.match(serviceWorker, /recipes-extra\.js/);
  assert.match(serviceWorker, /photo-safe\.js/);
  assert.match(serviceWorker, /meal-builder\.js/);
  assert.match(serviceWorker, /my-foods\.js/);
  assert.match(serviceWorker, /ai-config\.js/);
  assert.match(serviceWorker, /ai-client\.js/);
  assert.match(serviceWorker, /coach-client\.js/);
  assert.match(serviceWorker, /chat-meal\.js/);
});

test("opens existing data without a migration or overwriting photos", () => {
  const seed = initialData();
  const env = environment(seed);
  assert.equal(env.read().meals.length, 1);
  assert.equal(env.read().meals[0].photo, seed.meals[0].photo);
  assert.equal(env.read().weights[0].value, 110);
});

test("calendar and copy previous day do not duplicate photos", () => {
  const env = environment(initialData(iso(-1)));
  env.context.window.v12SelectDay(iso());
  env.context.window.vNextCopyYesterday();
  const meals = env.read().meals;
  assert.equal(meals.length, 2);
  assert.equal(meals[1].date, iso());
  assert.equal(meals[1].photo, null);
  assert.equal(meals[1].kcal, 160);
});

test("food search and 150g/200g portion calculations", () => {
  const env = environment();
  env.run("openMeal()");
  env.element("foodQuery").value = "Куриная грудка";
  env.element("foodGrams").value = 150;
  env.context.window.vNextSearchFoods();
  assert.match(env.element("foodResults").innerHTML, /Куриная грудка/);
  let found = false;
  for (let i = 0; i < 100; i++) {
    env.context.window.vNextFillFood(i);
    if (env.element("mealName").value.includes("Куриная грудка")) { found = true; break; }
  }
  assert.ok(found);
  assert.equal(env.element("mealKcal").value, 248);
  assert.equal(env.element("mealProtein").value, 46.5);
  env.element("foodGrams").value = 200;
  env.context.window.vNextRecalcFood();
  assert.equal(env.element("mealKcal").value, 330);
});

test("can add recipe favorite and find recipes by ingredient", () => {
  const env = environment();
  env.element("pantryQuery").value = "яйца";
  env.run("renderRecipes()");
  assert.match(env.element("recipeList").innerHTML, /яйца/);
  env.context.window.vNextToggleRecipe(0);
  assert.equal(env.read().recipeFavorites.length, 1);
  env.element("recipeFavOnly").checked = true;
  env.element("pantryQuery").value = "";
  env.run("renderRecipes()");
  assert.match(env.element("recipeCount").textContent, /Найдено: 1/);
});

test("weekly report and storage use existing local records", () => {
  const env = environment(initialData(iso(-1)));
  env.run("renderReport()");
  assert.match(env.element("weeklyBars").innerHTML, /Последние 7 дней/);
  env.run("tab('settings')");
  assert.match(env.element("storageDetails").textContent, /фото: 1/);
});

test("failed quota write leaves the existing diary intact", () => {
  const env = environment(initialData(iso(-1)));
  const before = env.state.get("moy-ratsion-v1");
  env.context.window.v12SelectDay(iso());
  env.setQuota(true);
  env.context.window.vNextCopyYesterday();
  assert.equal(env.state.get("moy-ratsion-v1"), before);
  assert.ok(env.alerts.some(x => x.includes("Не удалось сохранить")));
});

test("recipe book has 100 items and pages through results", () => {
  const env = environment();
  assert.equal(env.run("recipes.length"), 100);
  env.run("renderRecipes()");
  assert.match(env.element("recipeCount").textContent, /Найдено: 100 · показано: 20/);
  env.context.window.vNextMoreRecipes();
  assert.match(env.element("recipeCount").textContent, /показано: 40/);
});

test("calendar rejects impossible dates", () => {
  const env = environment();
  const before = env.element("selectedDate").value;
  env.context.window.v12SelectDay("2026-02-31");
  assert.equal(env.element("selectedDate").value, before);
});

test("removing a photo does not delete or alter the meal", async () => {
  const env = environment();
  env.context.window.v12EditMeal(0);
  assert.equal(env.element("removeMealPhoto").checked, false);
  env.element("mealName").value = "Яйцо без фото";
  env.element("removeMealPhoto").checked = true;
  await env.element("mealForm").onsubmit({preventDefault() {}});
  assert.equal(env.read().meals.length, 1);
  assert.equal(env.read().meals[0].name, "Яйцо без фото");
  assert.equal(env.read().meals[0].photo, null);
});

test("normal edits preserve existing photos", async () => {
  const env = environment();
  const photo = env.read().meals[0].photo;
  env.context.window.v12EditMeal(0);
  assert.equal(env.element("removeMealPhoto").checked, false);
  await env.element("mealForm").onsubmit({preventDefault() {}});
  assert.equal(env.read().meals[0].photo, photo);
});

test("save, find, recalculate, and remove personal food templates", () => {
  const env = environment();
  env.run("openMeal()");
  env.element("mealName").value = "Домашняя котлета";
  env.element("foodGrams").value = 200;
  env.element("mealKcal").value = 360;
  env.element("mealProtein").value = 40;
  env.element("mealFat").value = 16;
  env.element("mealCarbs").value = 12;
  env.context.window.vMyFoodSave();
  assert.equal(env.read().customFoods.length, 1);
  assert.equal(env.read().customFoods[0].name, "Домашняя котлета");
  assert.equal(env.read().customFoods[0].kcal, 180);
  env.element("foodQuery").value = "котлета";
  env.context.window.vNextSearchFoods();
  assert.match(env.element("foodResults").innerHTML, /★ Домашняя котлета/);
  env.context.window.vMyFoodChoose(0);
  env.element("foodGrams").value = 150;
  env.context.window.vNextRecalcFood();
  assert.equal(env.element("mealKcal").value, 270);
  assert.equal(env.element("mealProtein").value, 30);
  env.context.window.vMyFoodRemove(0);
  assert.equal(env.read().customFoods.length, 0);
});

test("rejects bad backup JSON without replacing existing records", () => {
  const env = environment();
  const backup = initialData();
  assert.equal(env.context.window.v12ValidateBackup(backup), true);
  const original = env.state.get("moy-ratsion-v1");
  const bad = structuredClone(backup);
  bad.meals[0].date = "2026-02-31";
  assert.throws(() => env.context.window.v12ValidateBackup(bad), /некорректную запись о еде/);
  const badPhoto = structuredClone(backup);
  badPhoto.meals[0].photo = "https://example.com/tracking.jpg";
  assert.throws(() => env.context.window.v12ValidateBackup(badPhoto), /недопустимое фото/);
  const invalidWeight = structuredClone(backup);
  invalidWeight.weights[0].value = -5;
  assert.throws(() => env.context.window.v12ValidateBackup(invalidWeight), /некорректное измерение веса/);
  assert.equal(env.state.get("moy-ratsion-v1"), original);
});

test("ingredient builder calculates and persists a mixed meal", async () => {
  const env = environment();
  env.run("openMeal()");
  const foods = env.context.window.vNextFoodCatalog();
  const rice = foods.findIndex(x => x.name === "Рис варёный");
  const chicken = foods.findIndex(x => x.name === "Куриная грудка готовая");
  assert.ok(rice >= 0 && chicken >= 0);
  env.context.window.vBuildChoose("catalog", rice);
  env.element("builderGrams").value = "150";
  env.context.window.vBuildAdd();
  env.context.window.vBuildChoose("catalog", chicken);
  env.element("builderGrams").value = "100";
  env.context.window.vBuildAdd();
  env.element("builderDishName").value = "Курица с рисом";
  env.context.window.vBuildApply();
  assert.equal(Number(env.element("mealKcal").value), 360);
  assert.equal(Number(env.element("mealCarbs").value), 42.3);
  env.element("mealDate").value = iso();
  env.element("mealType").value = "Обед";
  await env.element("mealForm").onsubmit({preventDefault() {}});
  const last = env.read().meals.at(-1);
  assert.equal(last.name, "Курица с рисом");
  assert.equal(last.ingredients.length, 2);
  assert.equal(last.ingredients[0].grams, 150);
  assert.equal(env.context.window.v12ValidateBackup(env.read()), true);
});

test("saved ingredient breakdown remains editable", async () => {
  const seed = initialData();
  seed.meals[0].ingredients = [{
    name:"Рис варёный", type:"Еда", grams:150, kcal:130, protein:2.7, fat:0.3, carbs:28.2
  }];
  const env = environment(seed);
  env.context.window.v12EditMeal(0);
  assert.match(env.element("builderParts").innerHTML, /Рис варёный/);
  await env.element("mealForm").onsubmit({preventDefault() {}});
  assert.equal(env.read().meals[0].ingredients[0].grams, 150);
});

test("photo validator rejects unsupported and oversized images", async () => {
  const env = environment();
  const validate = env.context.window.vPhotoValidate;
  assert.equal(validate({type:"image/jpeg",size:1024,name:"dish.jpg"}), true);
  assert.throws(() => validate({type:"image/svg+xml",size:1024,name:"dish.svg"}), /JPEG/);
  assert.throws(() => validate({type:"image/jpeg",size:26*1024*1024,name:"dish.jpg"}), /25 МБ/);
  await assert.rejects(env.run("shrink({type:'image/svg+xml',size:100,name:'dish.svg'})"), /JPEG/);
  assert.equal(env.read().meals.length, 1);
});

test("photo is resized and encoded locally as JPEG", async () => {
  const env = environment();
  const output = await env.run("shrink({type:'image/jpeg',size:200000,name:'dish.jpg'})");
  assert.match(output, /^data:image\/jpeg;base64,/);
  assert.ok(output.length < 180000);
  assert.equal(env.read().meals.length, 1);
});

test("malformed ingredient backup cannot replace the diary", () => {
  const env = environment();
  const data = initialData();
  data.meals[0].ingredients = [{name:"Соль",grams:-40,kcal:0,protein:0,fat:0,carbs:0}];
  assert.throws(() => env.context.window.v12ValidateBackup(data), /некорректный состав блюда/);
});

test("photo AI remains disabled until backend is securely configured", () => {
  const env = environment();
  assert.equal(env.element("aiAnalyzePhoto").hidden, true);
  assert.equal(env.context.window.MEAL_AI_ENDPOINT, "");
  env.run("openMeal()");
  assert.equal(env.element("aiPhotoStatus").textContent, "");
  assert.equal(env.read().meals.length, 1);
});

test("AI analysis is opt-in, requires a photo, and never auto-saves meal data", async () => {
  const payloads=[];
  const valid={
    recognized:true,requires_confirmation:true,estimated_only:true,dish_name:"Курица с рисом",
    portion_min_g:200,portion_max_g:300,kcal_min:300,kcal_max:500,
    protein_min_g:20,protein_max_g:50,fat_min_g:5,fat_max_g:15,
    carbs_min_g:30,carbs_max_g:70,notes:"Порция оценивается по фото.",confidence:"low"
  };
  const env=environment(initialData(),{
    endpoint:"https://private.example/api/analyze-meal",
    token:"a".repeat(40),
    fetch:async(url,options)=>{
      payloads.push({url,options});
      return {ok:true,status:200,json:async()=>valid};
    }
  });
  const button=env.element("aiAnalyzePhoto");
  assert.equal(button.hidden,false);
  assert.equal(payloads.length,0);
  await button.onclick();
  assert.equal(payloads.length,0);
  env.element("mealPhoto").files=[{type:"image/jpeg",size:2000,name:"dish.jpg"}];
  await button.onclick();
  assert.equal(payloads.length,1);
  assert.equal(payloads[0].url,"https://private.example/api/analyze-meal");
  assert.equal(JSON.parse(payloads[0].options.body).consent,true);
  assert.equal(env.read().meals.length,1);
  assert.equal(env.element("aiPhotoResult").hidden,false);
  env.element("aiApplyEstimate").onclick();
  assert.equal(env.element("mealKcal").value,400);
  assert.equal(env.element("mealProtein").value,35);
  assert.equal(env.read().meals.length,1);
});

test("only OpenAI assistant is shown and remains disabled without backend", () => {
  const env=environment();
  assert.equal(env.element("coachSend").disabled,true);
  assert.equal(env.element("coachText").disabled,true);
  assert.match(env.element("coachStatus").textContent,/пока не подключён/);
  env.run("tab('coach')");
  assert.equal(env.element("heading").textContent,"ИИ-помощник 🤖");
  assert.equal(env.read().meals.length,1);
});

test("chat sends only typed text by default, not local diary data", async()=>{
  const requests=[];
  const env=environment(initialData(),{
    endpoint:"https://secure.example/api/analyze-meal",
    token:"a".repeat(40),
    fetch:async(url,options)=>{
      requests.push({url,payload:JSON.parse(options.body)});
      return {ok:true,json:async()=>({
        reply:"Попробуй рис с овощами.",source:"openai",requires_confirmation:true
      })};
    }
  });
  assert.equal(env.element("coachSend").disabled,false);
  env.element("coachText").value="Что приготовить из риса?";
  await env.element("coachSend").onclick();
  assert.equal(requests.length,1);
  assert.equal(requests[0].url,"https://secure.example/api/coach");
  assert.equal(requests[0].payload.consent,true);
  assert.equal(requests[0].payload.week_summary,undefined);
  assert.doesNotMatch(JSON.stringify(requests[0].payload),/Яйцо/);
  assert.match(env.element("coachMessages").innerHTML,/Попробуй рис с овощами/);
  assert.equal(env.read().meals.length,1);
  env.element("coachShareWeek").checked=true;
  env.element("coachText").value="Какой у меня итог за неделю?";
  await env.element("coachSend").onclick();
  assert.equal(requests.length,2);
  assert.equal(requests[1].payload.share_summary,true);
  assert.equal(requests[1].payload.week_summary.kcal_total,160);
  assert.equal(requests[1].payload.week_summary.days_logged,1);
  assert.doesNotMatch(JSON.stringify(requests[1].payload),/Яйцо|base64/);
  env.element("coachClear").onclick();
  assert.match(env.element("coachMessages").innerHTML,/Здесь появится диалог/);
});

test("share code adds one breakfast without replacing previous meals",()=>{
  const env=environment();
  const payload={
    v:1,id:"breakfast-20261109-main",date:"2026-11-09",
    type:"Завтрак",name:"Яичница, белые колбаски, картофельные крокеты, чёрный кофе",
    kcal:1352,protein:58,fat:96,carbs:74
  };
  const code=Buffer.from(JSON.stringify(payload),"utf8").toString("base64url");
  env.element("chatMealCode").value="meal:"+code;
  env.context.window.vChatMealImport();
  const meals=env.read().meals;
  assert.equal(meals.length,2);
  const added=meals.at(-1);
  assert.equal(added.id,"chat-breakfast-20261109-main");
  assert.equal(added.date,"2026-11-09");
  assert.equal(added.kcal,1352);
  assert.equal(added.protein,58);
  assert.equal(added.fat,96);
  assert.equal(added.carbs,74);
  assert.equal(added.photo,null);
  assert.equal(meals[0].id,"old-1");
  assert.equal(env.context.window.v12ValidateBackup(env.read()),true);
  env.element("chatMealCode").value="meal:"+code;
  env.context.window.vChatMealImport();
  assert.equal(env.read().meals.length,2);
  assert.match(env.alerts.at(-1),/уже есть/);
});
test("malformed chat code is rejected without altering stored records",()=>{
  const env=environment();
  env.element("chatMealCode").value="https://example.com/#meal=INVALID";
  env.context.window.vChatMealImport();
  assert.equal(env.read().meals.length,1);
  assert.match(env.alerts.at(-1),/не распознан/);
});
test("URL fragment can offer a meal while leaving stored meals intact until confirmation",()=>{
  const payload={v:1,id:"link-test-20261109",date:"2026-11-09",
    type:"Завтрак",name:"Завтрак из чата",kcal:1352,protein:58,fat:96,carbs:74};
  const code=Buffer.from(JSON.stringify(payload),"utf8").toString("base64url");
  const env=environment(initialData(),{hash:"#meal="+code});
  assert.equal(env.read().meals.length,2);
  assert.match(env.confirmations.at(-1),/Добавить в локальный дневник/);
});
test("report display and recipe favorites do not publish personal data", () => {
  assert.match(source["app.js"], /moy-ratsion-v1/);
  assert.match(html, /Версия 1\.2/);
  assert.ok(!source["extras.js"].includes("sk-"));
});
