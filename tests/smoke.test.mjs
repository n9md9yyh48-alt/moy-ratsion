import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const files = ["app.js", "features-v12.js", "recipes-extra.js", "extras.js", "my-foods.js"];
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
function environment(seed = initialData()) {
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
    createElement: () => ({click() {}, remove() {}, style: {}}), body: {appendChild() {}}
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
    location: {reload() {}}, URL: {createObjectURL: () => "blob:fake", revokeObjectURL() {}},
    Blob, Image: class {}, setTimeout: () => {}
  };
  const context = vm.createContext(sandbox);
  for (const file of files) vm.runInContext(source[file], context, {filename: file});
  const read = () => JSON.parse(state.get("moy-ratsion-v1"));
  return {context, element, read, alerts, confirmations, state, setQuota: val => {quota = val},
    run: expr => vm.runInContext(expr, context)};
}

test("all scripts parse and UI contains the required controls", () => {
  for (const file of files) assert.doesNotThrow(() => new vm.Script(source[file], {filename: file}));
  for (const id of ["calendarGrid","quickMeals","foodQuery","foodResults","foodGrams","pantryQuery",
    "recipeFavOnly","weeklyBars","weightHistory","storageDetails","removeMealPhoto","removePhotoWrap"]) assert.match(html, new RegExp('id="' + id + '"'));
  assert.match(html, /src="app.js".*src="features-v12.js".*src="extras.js"/s);
  assert.match(serviceWorker, /extras\.js/);
  assert.match(serviceWorker, /recipes-extra\.js/);
  assert.match(serviceWorker, /my-foods\.js/);
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

test("report display and recipe favorites do not publish personal data", () => {
  assert.match(source["app.js"], /moy-ratsion-v1/);
  assert.match(html, /Версия 1\.2/);
  assert.ok(!source["extras.js"].includes("sk-"));
});
