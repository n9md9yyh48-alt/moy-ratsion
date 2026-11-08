/* Client-only photo processing for the food diary.
   No cloud or AI upload. Replaces app.js shrink() with a size-limited image encoder. */
(function () {
  "use strict";
  const input = document.getElementById("mealPhoto");
  const preview = document.getElementById("photoPreview");
  const status = document.getElementById("photoPreviewStatus");
  let previewUrl = null;
  const allowed = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
  function validImage(file) {
    if (!file) return true;
    if (typeof file.size !== "number" || file.size > 25 * 1024 * 1024 || file.size <= 0)
      throw Error("Фотография должна быть меньше 25 МБ.");
    const type = String(file.type || "").toLowerCase();
    if (type && !allowed.has(type))
      throw Error("Нужна фотография JPEG, PNG, WebP или HEIC.");
    if (!type && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name || ""))
      throw Error("Неизвестный формат фотографии.");
    return true;
  }
  const forgetPreview = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }
  };
  function showPreview() {
    forgetPreview();
    const file = input.files && input.files[0];
    preview.classList.add("hide");
    preview.removeAttribute("src");
    if (!file) { status.textContent = ""; return; }
    try {
      validImage(file);
      previewUrl = URL.createObjectURL(file);
      preview.src = previewUrl;
      preview.classList.remove("hide");
      status.textContent = "Фото выбрано: " + (file.size / (1024 * 1024)).toFixed(1) +
        " МБ. При сохранении размер будет уменьшен для локального дневника.";
    } catch (e) {
      status.textContent = e.message;
      alert(e.message);
      input.value = "";
    }
  }
  // Compress to JPEG <= 180KB in base64 when practical; protects limited iPhone localStorage.
  shrink = function (file) {
    if (!file) return Promise.resolve(null);
    try { validImage(file); } catch (e) { return Promise.reject(e); }
    return new Promise((resolve,reject) => {
      const img = new Image();
      let sourceUrl = null, finished = false;
      const finish = (error, value) => {
        if (finished) return;
        finished = true;
        if (sourceUrl) URL.revokeObjectURL(sourceUrl);
        img.onload = null;
        img.onerror = null;
        if (error) reject(error); else resolve(value);
      };
      img.onload = () => {
        try {
          const width = Number(img.naturalWidth || img.width);
          const height = Number(img.naturalHeight || img.height);
          if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
            throw Error("Не удалось определить размер фотографии.");
          const scale = Math.min(1, 720 / Math.max(width,height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(width * scale));
          canvas.height = Math.max(1, Math.round(height * scale));
          const context = canvas.getContext("2d");
          if (!context) throw Error("Обработка фото недоступна в этом браузере.");
          context.fillStyle = "#ffffff";
          context.fillRect(0,0,canvas.width,canvas.height);
          context.drawImage(img,0,0,canvas.width,canvas.height);
          let result = "";
          for (const quality of [0.72,0.6,0.48,0.36,0.26]) {
            result = canvas.toDataURL("image/jpeg",quality);
            if (result.length <= 180000) break;
          }
          if (!result.startsWith("data:image/jpeg;base64,") || result.length > 350000)
            throw Error("Фотография слишком сложная для локального хранения. Сохрани запись без фото.");
          finish(null,result);
        } catch (e) { finish(e); }
      };
      img.onerror = () => finish(Error("Не удалось открыть фото. Попробуй JPEG или PNG."));
      try {
        sourceUrl = URL.createObjectURL(file);
        img.src = sourceUrl;
      } catch (e) { finish(e); }
    });
  };
  function resetPreview() {
    forgetPreview();
    if (preview) {
      preview.classList.toggle("hide", true);
      if (typeof preview.removeAttribute === "function") preview.removeAttribute("src");
    }
    if (status) status.textContent = "";
  }
  if (input && preview && status) input.onchange = showPreview;
  window.vPhotoResetPreview = resetPreview;
  window.vPhotoValidate = validImage;
})();
