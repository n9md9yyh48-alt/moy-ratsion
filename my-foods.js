/* Личные продукты в локальном дневнике. Не отправляет данные на сервер.
   Записи через безопасный v12Commit и попадают в JSON-экспорт. */
(function () {
  "use strict";
  const get = id => document.getElementById(id);
  const safe = value => esc(String(value == null ? "" : value));
  let selected = null;
  const stored = () => Array.isArray(db.customFoods) ? db.customFoods : [];
  function label(food) { return String(food.name || "").trim(); }
  function finiteNutrition(food) {
    return ["kcal","protein","fat","carbs"].every(key =>
      Number.isFinite(Number(food[key])) && Number(food[key]) >= 0 &&
      Number(food[key]) <= 100000);
  }
  function applyMyFood() {
    const item = selected === null ? null : stored()[selected];
    const grams = Number(get("foodGrams").value);
    if (!item) return alert("Сначала выбери продукт из списка");
    if (!Number.isFinite(grams) || grams < 1 || grams > 10000) return alert("Укажи массу от 1 до 10 000 г/мл");
    const factor = grams / 100;
    get("mealName").value = label(item) + " · " + grams + (item.type === "Напиток" ? " мл" : " г");
    for (const [id, key] of [["mealKcal","kcal"],["mealProtein","protein"],["mealFat","fat"],["mealCarbs","carbs"]]) {
      const v = Number(item[key]) * factor;
      get(id).value = key === "kcal" ? Math.round(v) : Math.round(v * 10) / 10;
    }
    if (item.type === "Напиток") get("mealType").value = "Напиток";
    get("foodHint").textContent = "Мой продукт — " + grams + (item.type === "Напиток" ? " мл" : " г") + ". Все значения можно изменить.";
  }
  function myFoodButtons() {
    const input = get("foodQuery");
    const query = input.value.trim().toLocaleLowerCase("ru-RU");
    const rows = stored().map((item, i) => ({item,i}))
      .filter(({item}) => label(item).toLocaleLowerCase("ru-RU").includes(query))
      .slice(0, query ? 12 : 6);
    return rows.length ? '<div class="my-food-heading">Мои продукты</div>' +
      rows.map(({item,i}) => '<div class="my-food-item">' +
      '<button type="button" class="food-choice" onclick="vMyFoodChoose(' + i + ')">' +
      '<span>★ ' + safe(label(item)) + '</span><small>' + safe(item.kcal) + ' ккал / 100 ' +
      (item.type === "Напиток" ? "мл" : "г") + '</small></button>' +
      '<button type="button" class="btn ghost" aria-label="Удалить продукт ' + safe(label(item)) +
      '" onclick="vMyFoodRemove(' + i + ')">✕</button></div>').join("") : "";
  }
  function showMyFoodButtons() {
    const results = get("foodResults");
    // При поиске сначала показываем собственные продукты, затем встроенный справочник.
    results.innerHTML = myFoodButtons() + results.innerHTML;
  }
  function choose(index) {
    if (!stored()[index]) return;
    selected = index;
    get("foodQuery").value = stored()[index].name;
    get("foodResults").innerHTML = "";
    applyMyFood();
  }
  function remove(index) {
    const item = stored()[index];
    if (!item || !confirm("Удалить продукт «" + label(item) + "» из личного справочника? Записи в дневнике останутся.")) return;
    if (window.v12Commit(next => next.customFoods.splice(index,1))) {
      selected = null;
      search();
    }
  }
  function readForm() {
    const name = get("mealName").value.trim()
      .replace(/\s*[·•]\s*\d+(?:[.,]\d+)?\s*(?:г|мл)\s*$/iu, "").trim();
    const grams = Number(get("foodGrams").value);
    if (!name || name.length > 100) throw Error("Название должно содержать от 1 до 100 символов.");
    if (!Number.isFinite(grams) || grams < 1 || grams > 10000) throw Error("Укажи массу текущей порции: 1–10 000 г/мл.");
    const source = {};
    for (const [key, id] of [["kcal","mealKcal"],["protein","mealProtein"],["fat","mealFat"],["carbs","mealCarbs"]]) {
      const input = get(id).value;
      if (String(input).trim() === "") throw Error("Заполни калории и БЖУ.");
      source[key] = Number(input);
    }
    if (!finiteNutrition(source)) throw Error("Укажи корректные неотрицательные значения калорий и БЖУ.");
    const factor = 100 / grams;
    const food = {name, type: get("mealType").value === "Напиток" ? "Напиток" : "Еда"};
    for (const key of ["kcal","protein","fat","carbs"]) {
      food[key] = Math.round(source[key] * factor * 10) / 10;
    }
    return {food, grams};
  }
  function saveMyFood() {
    let result;
    try { result = readForm(); } catch(e) { alert(e.message); return; }
    const {food, grams} = result;
    if (!confirm("Сохранить «" + food.name + "» в «Мои продукты»? Подтверди, что введённые калории и БЖУ относятся к " + grams +
      (food.type === "Напиток" ? " мл" : " г") + " текущей порции. Значения будут пересчитаны на 100 г/мл.")) return;
    const duplicate = stored().findIndex(x => label(x).toLowerCase() === food.name.toLowerCase());
    if (duplicate >= 0 && !confirm("Такой продукт уже существует. Заменить его значения?")) return;
    if (window.v12Commit(next => {
      if (!Array.isArray(next.customFoods)) next.customFoods = [];
      if (duplicate >= 0) next.customFoods[duplicate] = food;
      else next.customFoods.push(food);
    })) {
      selected = duplicate >= 0 ? duplicate : stored().length - 1;
      get("foodHint").textContent = "★ «" + food.name + "» сохранён. Он доступен при поиске и попадёт в резервную копию JSON.";
      search();
    }
  }
  const baseSearch = window.vNextSearchFoods;
  const baseFill = window.vNextFillFood;
  const baseRecalc = window.vNextRecalcFood;
  function search() {
    selected = null;
    baseSearch();
    showMyFoodButtons();
  }
  const baseOpen = openMeal;
  openMeal = function (...args) {
    selected = null;
    baseOpen(...args);
    showMyFoodButtons();
  };
  window.vNextSearchFoods = search;
  window.vNextFillFood = index => { selected = null; baseFill(index); };
  window.vNextRecalcFood = () => selected === null ? baseRecalc() : applyMyFood();
  window.vMyFoodChoose = choose;
  window.vMyFoodRemove = remove;
  window.vMyFoodSave = saveMyFood;
})();
