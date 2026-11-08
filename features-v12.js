/* Мой рацион v1.2 — календарь, быстрые записи, история веса, защита данных.
   Использует общую модель db и ключ localStorage из app.js (v1.1). */
(function () {
  "use strict";
  const BACKUP_KEY = "moy-ratsion-v1-auto-backup";
  const VERSION = "1.2";
  let selectedDate = today();
  let displayedMonth = selectedDate.slice(0, 7);
  let editMealIndex = null;
  let editWeightIndex = null;
  let storageLocked = false;
  let lastBackupAt = 0;
  const oldTab = tab;

  function isValidModel(v) {
    return !!v && typeof v === "object" && !Array.isArray(v) &&
      Array.isArray(v.meals) && Array.isArray(v.weights) &&
      !!v.settings && typeof v.settings === "object";
  }

  // Строгая проверка только для импорта: старые версии продолжают открываться
  // без миграций, а незнакомый/повреждённый JSON не заменяет дневник.
  function validateBackup(data) {
    if (!isValidModel(data)) throw Error("Файл не похож на резервную копию «Моего рациона».");
    if (data.meals.length > 30000 || data.weights.length > 30000) {
      throw Error("В файле слишком много записей.");
    }
    const goodNumber = (n, max) => n !== null && n !== "" && Number.isFinite(Number(n)) &&
      Number(n) >= 0 && Number(n) <= max;
    if (!goodNumber(data.settings.calories, 20000) || Number(data.settings.calories) < 1000 ||
      !goodNumber(data.settings.start, 500) || Number(data.settings.start) < 20 ||
      !goodNumber(data.settings.target, 500) || Number(data.settings.target) < 20) {
      throw Error("В резервной копии некорректные настройки целей.");
    }
    for (const m of data.meals) {
      if (!m || typeof m !== "object" || typeof m.name !== "string" ||
        !m.name.trim() || m.name.length > 300 || !hasValidDate(m.date) ||
        typeof m.type !== "string" || m.type.length > 80 ||
        !["kcal", "protein", "fat", "carbs"].every(k => goodNumber(m[k], 100000))) {
        throw Error("Файл содержит некорректную запись о еде.");
      }
      if (m.photo != null && m.photo !== "" &&
        (typeof m.photo !== "string" || m.photo.length > 8000000 ||
          !/^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=\s]+$/i.test(m.photo))) {
        throw Error("Файл содержит недопустимое фото. Поддерживаются только JPEG, PNG и WebP.");
      }
    }
    for (const w of data.weights) {
      if (!w || !hasValidDate(w.date) || !goodNumber(w.value, 500) || Number(w.value) < 20) {
        throw Error("Файл содержит некорректное измерение веса.");
      }
    }
    if (data.customFoods !== undefined &&
      (!Array.isArray(data.customFoods) || data.customFoods.length > 5000 ||
        data.customFoods.some(x => !x || typeof x.name !== "string" ||
          !x.name.trim() || x.name.length > 100 ||
          !["kcal", "protein", "fat", "carbs"].every(k => goodNumber(x[k], 100000))))) {
      throw Error("В файле некорректный список личных продуктов.");
    }
    if (data.recipeFavorites !== undefined &&
      (!Array.isArray(data.recipeFavorites) ||
        data.recipeFavorites.some(x => typeof x !== "string" || x.length > 200))) {
      throw Error("В файле некорректный список избранных рецептов.");
    }
    if (data.favorites !== undefined &&
      (!Array.isArray(data.favorites) ||
        data.favorites.some(x => !x || typeof x.name !== "string" || !x.name.trim()))) {
      throw Error("В файле некорректное избранное.");
    }
    return true;
  }
  function hasValidDate(v) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ""));
    if (!m) return false;
    const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
    const date = new Date(year, month - 1, day, 12);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  }
  function fmtDate(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
      "-" + String(d.getDate()).padStart(2, "0");
  }
  function shiftDay(date, amount) {
    const d = new Date(date + "T12:00:00");
    d.setDate(d.getDate() + amount);
    return fmtDate(d);
  }
  function checkStorage() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw && !isValidModel(JSON.parse(raw))) throw Error("Неверный формат дневника");
    } catch (_) {
      storageLocked = true;
    }
  }
  function commit(change) {
    if (storageLocked) {
      alert("Данные в памяти браузера повреждены или недоступны. Сначала восстанови резервную копию в настройках. Новые записи не сохраняются.");
      return false;
    }
    let current, next, raw;
    try {
      current = JSON.stringify(db);
      next = JSON.parse(current);
      change(next);
      if (!isValidModel(next)) throw Error("Некорректная структура данных");
      raw = JSON.stringify(next);
      if (raw === current) return true;
      // Не дублируем большие фотографии в localStorage: нехватка места
      // не должна повредить основную запись.
      if (current.length < 350000 && Date.now() - lastBackupAt > 120000) {
        try {
          const stored = localStorage.getItem(KEY);
          if (stored && isValidModel(JSON.parse(stored))) {
            localStorage.setItem(BACKUP_KEY, stored);
            lastBackupAt = Date.now();
          }
        } catch (_) { /* Основной дневник важнее автоматической копии */ }
      }
      localStorage.setItem(KEY, raw); // атомарная запись: при ошибке прежнее состояние остаётся
    } catch (e) {
      alert("Не удалось сохранить. Старые записи не изменены. Возможно, память заполнена фотографиями. Сделай резервную копию JSON. " + (e && e.message ? e.message : ""));
      return false;
    }
    db = next;
    try { render(); }
    catch (e) { alert("Запись сохранена, но интерфейс не обновился. Закрой и открой приложение снова."); }
    return true;
  }
  function knownMeals() {
    return Array.isArray(db.meals) ? db.meals : [];
  }
  function favorites() {
    return Array.isArray(db.favorites) ? db.favorites : [];
  }
  function signature(x) {
    return String(x.type || "") + "|" + String(x.name || "").trim().toLowerCase();
  }
  function nutrition(x) {
    return {
      type: String(x.type || "Перекус"),
      name: String(x.name || "").trim(),
      kcal: Number(x.kcal) || 0,
      protein: Number(x.protein) || 0,
      fat: Number(x.fat) || 0,
      carbs: Number(x.carbs) || 0
    };
  }
  function displayDate(d) {
    try {
      return new Date(d + "T12:00:00").toLocaleDateString("ru-RU", {
        day: "numeric", month: "long", year: "numeric"
      });
    } catch (_) {
      return d;
    }
  }
  function renderCalendar() {
    $("selectedDate").value = selectedDate;
    $("dayCaption").textContent = selectedDate === today() ?
      "Сегодня · " + displayDate(selectedDate) : displayDate(selectedDate);
    const first = new Date(displayedMonth + "-01T12:00:00");
    const year = first.getFullYear(), month = first.getMonth();
    $("calendarMonth").textContent = first.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
    const startOffset = (first.getDay() + 6) % 7;
    const total = new Date(year, month + 1, 0).getDate();
    const mealsByDate = new Set(knownMeals().map(x => x.date));
    let html = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map(d => '<span class="week-day">' + d + "</span>").join("");
    for (let i = 0; i < startOffset; i++) html += '<span class="calendar-empty"></span>';
    for (let day = 1; day <= total; day++) {
      const date = fmtDate(new Date(year, month, day, 12));
      const css = "calendar-day" + (date === selectedDate ? " selected" : "") +
        (date === today() ? " current" : "") + (mealsByDate.has(date) ? " has-meals" : "");
      html += '<button type="button" class="' + css + '" aria-label="' + esc(date) +
        '" aria-pressed="' + (date === selectedDate) + '" onclick="v12SelectDay(' +
        "'" + date + "'" + ')">' + day + '</button>';
    }
    $("calendarGrid").innerHTML = html;
  }
  function renderQuick() {
    const all = knownMeals();
    const favs = favorites();
    const favKeys = new Set(favs.map(signature));
    const used = new Set();
    const recent = [];
    for (let i = all.length - 1; i >= 0 && recent.length < 6; i--) {
      const x = all[i], key = signature(x);
      if (!x.name || used.has(key) || favKeys.has(key)) continue;
      used.add(key);
      recent.push({ item: x, idx: i });
    }
    let html = "";
    if (favs.length) {
      html += '<div class="muted">Избранное ★</div><div class="quick-row">';
      favs.slice(0, 8).forEach((x, i) => {
        html += '<button class="btn secondary quick-button" onclick="v12QuickFavorite(' + i +
          ')">＋ ' + esc(x.name) + ' <small>' + esc(x.kcal) + ' ккал</small></button>';
      });
      html += "</div>";
    }
    if (recent.length) {
      html += '<div class="muted">Недавние блюда</div><div class="quick-row">';
      recent.forEach(({ item, idx }) => {
        html += '<button class="btn ghost quick-button" onclick="v12QuickMeal(' + idx +
          ')">＋ ' + esc(item.name) + ' <small>' + esc(item.kcal) + ' ккал</small></button>';
      });
      html += "</div>";
    }
    $("quickMeals").innerHTML = html || '<p class="muted">Добавь первый приём пищи — здесь появятся кнопки для быстрого повторения.</p>';
  }
  function renderMeals() {
    const rows = knownMeals().map((item, idx) => ({ item, idx }))
      .filter(o => o.item.date === selectedDate).reverse();
    const favKeys = new Set(favorites().map(signature));
    $("meals").innerHTML = rows.length ? rows.map(({ item, idx }) => {
      const fav = favKeys.has(signature(item));
      return '<div class="item"><div class="row between"><div><b>' + esc(item.name) +
        '</b><div class="muted">' + esc(item.type) + ' · ' + esc(item.kcal) +
        ' ккал</div></div><div class="edit-actions">' +
        '<button class="btn secondary" onclick="v12EditMeal(' + idx + ')">Изменить</button>' +
        '<button class="btn ghost" onclick="v12RemoveMeal(' + idx + ')">✕</button></div></div>' +
        (item.photo ? '<img class="photo" src="' + esc(item.photo) + '" alt="Фото еды">' : '') +
        '<div class="row meal-tools"><button class="btn ghost" onclick="v12QuickMeal(' + idx +
        ')">↻ Повторить</button><button class="btn ghost" onclick="v12ToggleFavorite(' + idx +
        ')">' + (fav ? "★ В избранном" : "☆ В избранное") + "</button></div></div>";
    }).join("") : '<p class="muted">В этот день записей нет. Можно добавить еду или выбрать другой день.</p>';
  }
  function renderWeightHistory() {
    const rows = (Array.isArray(db.weights) ? db.weights : [])
      .map((item, idx) => ({ item, idx }))
      .sort((a, b) => String(b.item.date).localeCompare(String(a.item.date)))
      .slice(0, 30);
    $("weightHistory").innerHTML = rows.length ?
      '<h3>История измерений</h3>' + rows.map(({ item, idx }) =>
        '<div class="item row between"><div><b>' + esc(item.value) +
        ' кг</b><div class="muted">' + esc(item.date) + '</div></div><div class="edit-actions">' +
        '<button class="btn secondary" onclick="v12EditWeight(' + idx + ')">Изменить</button>' +
        '<button class="btn ghost" onclick="v12RemoveWeight(' + idx + ')">✕</button></div></div>'
      ).join("") : '<p class="muted">Пока нет измерений веса.</p>';
  }
  function render12() {
    const dayItems = knownMeals().filter(x => x.date === selectedDate);
    const dailyTotal = sum(dayItems, "kcal");
    $("todayKcal").textContent = dailyTotal;
    $("goalKcal").textContent = db.settings.calories || 2500;
    $("calFill").style.width = Math.max(0, Math.min(100, 100 * dailyTotal / (Number(db.settings.calories) || 2500))) + "%";
    $("prot").textContent = sum(dayItems, "protein") + " г";
    $("fat").textContent = sum(dayItems, "fat") + " г";
    $("carb").textContent = sum(dayItems, "carbs") + " г";
    $("foodDrinks").textContent = "Еда: " + sum(dayItems.filter(x => x.type !== "Напиток"), "kcal") +
      " ккал · Напитки: " + sum(dayItems.filter(x => x.type === "Напиток"), "kcal") + " ккал";
    const activeTab = document.querySelectorAll(".tabs button.active")[0];
    if (!activeTab || activeTab.dataset.tab === "home") {
      $("heading").textContent = selectedDate === today() ? "Сегодня 🍽️" : "Дневник 🍽️";
    }
    renderCalendar();
    renderQuick();
    renderMeals();
    const weights = (Array.isArray(db.weights) ? db.weights : []).slice()
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    $("weightInfo").innerHTML = "<p>Старт: <b>" + esc(db.settings.start) +
      " кг</b> · Цель: <b>" + esc(db.settings.target) + " кг</b></p><p>Последний вес: <b>" +
      (weights.length ? esc(weights[weights.length - 1].value) + " кг" : "не записан") + "</b></p>";
    drawWeight(weights);
    renderWeightHistory();
    const backup = $("backupStatus");
    if (backup) {
      let available = false;
      try { available = isValidModel(JSON.parse(localStorage.getItem(BACKUP_KEY) || "null")); } catch (_) {}
      backup.textContent = storageLocked ?
        "⚠️ Хранилище повреждено или недоступно. Используй восстановление из JSON." :
        (available ? "Автокопия доступна на этом устройстве. " : "Автокопия ещё не создана. ") +
        "Для надёжного хранения периодически скачивай JSON.";
    }
  }
  function setDay(date) {
    if (!hasValidDate(date)) return;
    selectedDate = date;
    displayedMonth = date.slice(0, 7);
    render();
  }
  function changeMonth(delta) {
    const d = new Date(displayedMonth + "-01T12:00:00");
    d.setMonth(d.getMonth() + delta);
    displayedMonth = fmtDate(d).slice(0, 7);
    renderCalendar();
  }
  function openMeal12(index) {
    editMealIndex = Number.isInteger(index) && index >= 0 ? index : null;
    const item = editMealIndex === null ? null : db.meals[editMealIndex];
    $("mealForm").reset();
    $("mealDialogTitle").textContent = item ? "Редактировать запись" : "Добавить еду или напиток";
    $("existingPhoto").classList.toggle("hide", !item || !item.photo);
    $("removePhotoWrap").classList.toggle("hide", !item || !item.photo);
    $("removeMealPhoto").checked = false;
    $("mealDate").value = item ? item.date : selectedDate;
    if (item) {
      $("mealType").value = item.type;
      $("mealName").value = item.name;
      ["Kcal", "Protein", "Fat", "Carbs"].forEach((suffix, i) => {
        $("meal" + suffix).value = item[["kcal", "protein", "fat", "carbs"][i]] || 0;
      });
    }
    $("mealDialog").showModal();
  }
  function openWeight12(index) {
    editWeightIndex = Number.isInteger(index) && index >= 0 ? index : null;
    const item = editWeightIndex === null ? null : db.weights[editWeightIndex];
    $("weightForm").reset();
    $("weightDialogTitle").textContent = item ? "Изменить измерение" : "Записать вес";
    $("weightDate").value = item ? item.date : selectedDate;
    if (item) $("weightValue").value = item.value;
    $("weightDialog").showModal();
  }
  async function submitMeal(e) {
    e.preventDefault();
    const name = $("mealName").value.trim();
    const date = $("mealDate").value;
    if (!name || !hasValidDate(date)) return alert("Проверь название и дату");
    let photo = null;
    try { photo = await shrink($("mealPhoto").files[0]); }
    catch (_) { return alert("Не удалось прочитать фотографию"); }
    const item = {
      id: editMealIndex === null ? crypto.randomUUID() : (db.meals[editMealIndex].id || crypto.randomUUID()),
      date, type: $("mealType").value, name,
      kcal: Number($("mealKcal").value),
      protein: Number($("mealProtein").value),
      fat: Number($("mealFat").value),
      carbs: Number($("mealCarbs").value),
      photo: photo || ($("removeMealPhoto").checked ? null : (editMealIndex === null ? null : db.meals[editMealIndex].photo || null))
    };
    if (Object.keys(item).some(k => ["kcal", "protein", "fat", "carbs"].includes(k) &&
      (!Number.isFinite(item[k]) || item[k] < 0))) return alert("Проверь калории и БЖУ");
    if (commit(next => {
      if (editMealIndex === null) next.meals.push(item);
      else next.meals[editMealIndex] = item;
    })) {
      $("mealDialog").close();
      editMealIndex = null;
      setDay(date);
    }
  }
  function submitWeight(e) {
    e.preventDefault();
    const date = $("weightDate").value;
    const value = Number($("weightValue").value);
    if (!hasValidDate(date) || !Number.isFinite(value) || value < 20 || value > 500) {
      return alert("Проверь дату и вес");
    }
    const match = db.weights.findIndex((w, idx) => idx !== editWeightIndex && w.date === date);
    if (match >= 0) return alert("Измерение на эту дату уже существует. Используй кнопку «Изменить».");
    if (commit(next => {
      const item = { date, value };
      if (editWeightIndex === null) next.weights.push(item);
      else next.weights[editWeightIndex] = item;
    })) {
      $("weightDialog").close();
      editWeightIndex = null;
    }
  }
  function repeatItem(item) {
    if (!item || !item.name) return;
    const meal = Object.assign({ id: crypto.randomUUID(), date: selectedDate, photo: null }, nutrition(item));
    if (commit(next => next.meals.push(meal))) {
      const msg = $("quickNotice");
      if (msg) { msg.textContent = "Добавлено: " + item.name; }
    }
  }
  function removeMeal12(index) {
    if (!db.meals[index] || !confirm("Удалить запись «" + db.meals[index].name + "»?")) return;
    commit(next => next.meals.splice(index, 1));
  }
  function removeWeight12(index) {
    if (!db.weights[index] || !confirm("Удалить измерение за " + db.weights[index].date + "?")) return;
    commit(next => next.weights.splice(index, 1));
  }
  function toggleFavorite(index) {
    const item = db.meals[index];
    if (!item) return;
    const key = signature(item);
    commit(next => {
      if (!Array.isArray(next.favorites)) next.favorites = [];
      const i = next.favorites.findIndex(x => signature(x) === key);
      if (i < 0) next.favorites.unshift(nutrition(item));
      else next.favorites.splice(i, 1);
    });
  }
  function saveSettings12() {
    const calories = Number($("setCalories").value);
    const start = Number($("setStart").value), target = Number($("setTarget").value);
    if (![calories, start, target].every(Number.isFinite) || calories < 1000 || start < 20 || target < 20) {
      return alert("Проверь цели");
    }
    if (commit(next => { next.settings = { ...next.settings, calories, start, target }; })) {
      alert("Цели сохранены");
    }
  }
  function exportData12() {
    try {
      const a = document.createElement("a");
      const u = URL.createObjectURL(new Blob([JSON.stringify(db, null, 2)], { type: "application/json" }));
      a.href = u; a.download = "moy-ratsion-backup-" + today() + ".json";
      document.body.appendChild(a);
      a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 60000);
    } catch (e) {
      alert("Не удалось выгрузить JSON: " + (e && e.message ? e.message : ""));
    }
  }
  function restoreFromFile() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      if (!input.files || !input.files.length) return;
      try {
        const file = input.files[0];
        if (file.size > 30000000) throw Error("Файл слишком большой");
        const parsed = JSON.parse(await file.text());
        validateBackup(parsed);
        if (!confirm("Заменить дневник содержимым выбранного файла? Перед этим сохрани текущий дневник кнопкой «Скачать JSON».")) return;
        const old = localStorage.getItem(KEY);
        if (old && old.length < 350000) {
          try { localStorage.setItem(BACKUP_KEY, old); }
          catch (_) { alert("Не удалось создать автокопию. Сначала освободи место и скачай JSON."); return; }
        }
        localStorage.setItem(KEY, JSON.stringify(parsed));
        db = parsed;
        storageLocked = false;
        render();
        alert("Данные восстановлены");
      } catch (e) {
        alert("Импорт отменён: " + (e && e.message ? e.message : "неверный файл"));
      }
    };
    input.click();
  }
  function restoreAutoBackup() {
    let snap = null;
    try { snap = JSON.parse(localStorage.getItem(BACKUP_KEY) || "null"); }
    catch (_) {}
    try { validateBackup(snap); }
    catch (_) { return alert("Автокопия повреждена или несовместима. Попробуй восстановить JSON."); }
    if (!confirm("Восстановить автокопию? Текущие записи будут заменены. Сначала скачай JSON, если они нужны.")) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(snap));
      db = snap; storageLocked = false; render();
      alert("Автокопия восстановлена");
    } catch (_) { alert("Не удалось восстановить: не хватает места в памяти."); }
  }
  function clearData12() {
    if (!confirm("Удалить ВСЕ записи, фотографии, настройки и локальную автокопию с этого устройства?")) return;
    if (!confirm("Это действие необратимо без заранее скачанного JSON. Подтверждаешь удаление?")) return;
    try {
      localStorage.removeItem(KEY);
      localStorage.removeItem(BACKUP_KEY);
      location.reload();
    } catch (_) { alert("Не удалось удалить данные браузера"); }
  }

  // Доступные из HTML обработчики; аргументы — индексы, а не данные пользователя.
  window.v12SelectDay = setDay;
  window.v12ShiftDay = delta => setDay(shiftDay(selectedDate, delta));
  window.v12Today = () => setDay(today());
  window.v12ChangeMonth = changeMonth;
  window.v12EditMeal = openMeal12;
  window.v12RemoveMeal = removeMeal12;
  window.v12QuickMeal = index => repeatItem(db.meals[index]);
  window.v12QuickFavorite = index => repeatItem(favorites()[index]);
  window.v12ToggleFavorite = toggleFavorite;
  window.v12EditWeight = openWeight12;
  window.v12RemoveWeight = removeWeight12;
  window.v12RestoreAutoBackup = restoreAutoBackup;

  window.v12ValidateBackup = validateBackup;
  window.v12Commit = commit;
  checkStorage();
  render = render12;
  openMeal = openMeal12;
  openWeight = openWeight12;
  saveSettings = saveSettings12;
  exportData = exportData12;
  importData = restoreFromFile;
  clearData = clearData12;
  tab = function (name) { oldTab(name); if (name === "home") render(); };
  $("mealForm").onsubmit = submitMeal;
  $("weightForm").onsubmit = submitWeight;
  $("selectedDate").onchange = e => setDay(e.target.value);
  render();
})();
