/* Meal builder: optional offline calculation of an entire dish from ingredient weights.
   Uses approximate per-100g values from extras.js and private customFoods. No network. */
(function () {
  "use strict";
  const get = id => document.getElementById(id);
  const safe = value => esc(String(value == null ? "" : value));
  let selection = null;
  let parts = [];
  let hasApplied = false;
  const round = n => Math.round((Number(n) + Number.EPSILON) * 10) / 10;
  const catalog = () => window.vNextFoodCatalog ? window.vNextFoodCatalog() : [];
  const own = () => Array.isArray(db.customFoods) ? db.customFoods : [];
  function findFood(source, index) {
    const arr = source === "own" ? own() : source === "catalog" ? catalog() : [];
    const item = arr[index];
    if (!item || typeof item.name !== "string") return null;
    const result = {
      name: item.name, type: item.type === "Напиток" ? "Напиток" : "Еда",
      kcal: Number(item.kcal), protein: Number(item.protein),
      fat: Number(item.fat), carbs: Number(item.carbs)
    };
    return ["kcal","protein","fat","carbs"].every(k => Number.isFinite(result[k]) && result[k] >= 0) ? result : null;
  }
  function search() {
    const q = get("builderQuery").value.trim().toLocaleLowerCase("ru-RU");
    const matches = [];
    for (const [source, data] of [["own", own()], ["catalog", catalog()]]) {
      for (let i = 0; i < data.length; i++) {
        if (matches.length >= 12) break;
        if (!q || String(data[i].name).toLocaleLowerCase("ru-RU").includes(q)) {
          matches.push({source,index:i,food:data[i]});
        }
      }
      if (matches.length >= 12) break;
    }
    get("builderResults").innerHTML = matches.length ?
      matches.map(({source,index,food}) =>
        '<button type="button" class="food-choice" onclick="vBuildChoose(' +
        "'" + source + "'," + index +
        ')"><span>' + safe(food.name) + '</span><small>≈ ' + safe(food.kcal) + ' ккал / 100 ' +
        (food.type === "Напиток" ? "мл" : "г") + '</small></button>').join("") :
      '<p class="muted">Не найдено. Свои продукты можно сохранить в форме записи.</p>';
  }
  function choose(source, index) {
    const food = findFood(source,index);
    if (!food) return;
    selection = food;
    get("builderSelected").textContent = "Выбрано: " + food.name + " · " + food.kcal +
      " ккал на 100 " + (food.type === "Напиток" ? "мл" : "г");
    get("builderQuery").value = food.name;
    get("builderResults").innerHTML = "";
  }
  function totals(items) {
    return items.reduce((out, x) => {
      const mult = Number(x.grams) / 100;
      out.grams += Number(x.grams);
      for (const k of ["kcal","protein","fat","carbs"]) out[k] += Number(x[k]) * mult;
      return out;
    }, {grams:0,kcal:0,protein:0,fat:0,carbs:0});
  }
  function render() {
    const full = totals(parts);
    get("builderParts").innerHTML = parts.length ? parts.map((p,i) =>
      '<div class="item row between"><div><b>' + safe(p.name) + '</b><div class="muted">' +
      safe(p.grams) + (p.type === "Напиток" ? " мл" : " г") + ' · ≈ ' +
      Math.round(p.kcal * p.grams / 100) + ' ккал</div></div>' +
      '<button type="button" class="btn ghost" onclick="vBuildRemove(' + i +
      ')" aria-label="Убрать ингредиент">✕</button></div>').join("") :
      '<p class="muted">Ингредиенты ещё не добавлены.</p>';
    get("builderTotals").textContent = parts.length ?
      "Итого: " + round(full.grams) + " г/мл · ≈ " + Math.round(full.kcal) +
      " ккал · Б " + round(full.protein) + " / Ж " + round(full.fat) +
      " / У " + round(full.carbs) + " г" : "";
  }
  function add() {
    if (!selection) return alert("Сначала выбери ингредиент");
    const grams = Number(get("builderGrams").value);
    if (!Number.isFinite(grams) || grams <= 0 || grams > 10000) {
      return alert("Проверь массу ингредиента: от 1 до 10 000 г/мл");
    }
    if (parts.length >= 25) return alert("В одном блюде можно указать до 25 ингредиентов.");
    parts.push({...selection, grams});
    hasApplied = false;
    render();
    get("builderQuery").value = "";
    get("builderSelected").textContent = "Можно добавить следующий ингредиент";
    selection = null;
    search();
  }
  function remove(index) {
    if (!Number.isInteger(index) || index < 0 || index >= parts.length) return;
    parts.splice(index,1);
    hasApplied = false;
    render();
  }
  function reset() {
    selection = null;
    parts = [];
    hasApplied = false;
    get("builderQuery").value = "";
    get("builderGrams").value = "100";
    get("builderDishName").value = "";
    get("builderSelected").textContent = "";
    get("builderDetails").open = false;
    render();
    search();
  }
  function apply() {
    if (!parts.length) return alert("Сначала добавь хотя бы один ингредиент.");
    const full = totals(parts);
    const name = get("builderDishName").value.trim();
    if (name.length > 150) return alert("Название блюда должно быть короче 150 символов.");
    if (name) get("mealName").value = name;
    else if (!get("mealName").value.trim()) {
      get("mealName").value = parts.length === 1 ? parts[0].name :
        "Блюдо: " + parts.slice(0,2).map(x => x.name).join(" + ");
    }
    get("mealKcal").value = Math.round(full.kcal);
    get("mealProtein").value = round(full.protein);
    get("mealFat").value = round(full.fat);
    get("mealCarbs").value = round(full.carbs);
    get("foodGrams").value = round(full.grams);
    hasApplied = true;
    get("builderApplied").textContent = "✓ Расчёт перенесён в запись. Можно поправить название, калории и БЖУ вручную, затем сохранить.";
  }
  // Ingredient metadata is stored only after applying the calculation. When editing,
  // old data is not discarded unless the builder is used again.
  function getParts() {
    return hasApplied && parts.length ? parts.map(x => ({...x})) : null;
  }
  function openMeal(item) {
    reset();
    if (!item || !Array.isArray(item.ingredients) || !item.ingredients.length) return;
    const valid = item.ingredients.filter(x => x && typeof x.name === "string" &&
      Number.isFinite(Number(x.grams)) && Number(x.grams) > 0 &&
      ["kcal","protein","fat","carbs"].every(k => Number.isFinite(Number(x[k])) && Number(x[k]) >= 0)
    ).slice(0,25);
    parts = valid.map(x => ({
      name: x.name, grams: Number(x.grams), type: x.type === "Напиток" ? "Напиток" : "Еда",
      kcal: Number(x.kcal), protein: Number(x.protein), fat: Number(x.fat), carbs: Number(x.carbs)
    }));
    hasApplied = false; // retain legacy saved breakdown until user explicitly presses Apply
    get("builderDishName").value = item.name || "";
    render();
  }
  window.vBuildSearch = search;
  window.vBuildChoose = choose;
  window.vBuildAdd = add;
  window.vBuildRemove = remove;
  window.vBuildApply = apply;
  window.vBuildGetParts = getParts;
  window.vBuilderOpenMeal = openMeal;
  window.vBuildTotals = totals;
})();
