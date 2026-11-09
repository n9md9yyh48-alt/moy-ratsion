/* Import a single meal from a chat share code or URL fragment.
   No network, no photos, no sharing the diary. Explicit confirmation.
   This writes ONLY to the current browser/PWA's existing localStorage. */
(function(){
  "use strict";
  const el=id=>document.getElementById(id);
  const prefix="meal:";
  const isIosBrowser=()=>/iPad|iPhone|iPod/.test(navigator?.userAgent||"") &&
    !(navigator.standalone===true ||
      (typeof matchMedia==="function"&&matchMedia("(display-mode: standalone)").matches));
  const status=message=>{const elStatus=el("chatMealStatus");if(elStatus)elStatus.textContent=message;};
  function decode(code){
    let value=String(code||"").trim();
    const marker=value.indexOf("#meal=");
    if(marker>=0)value=value.slice(marker+6);
    if(value.startsWith(prefix))value=value.slice(prefix.length);
    if(!/^[A-Za-z0-9_-]{20,1800}$/.test(value))throw Error("Некорректный код записи.");
    const b64=value.replace(/-/g,"+").replace(/_/g,"/");
    const decoded=atob(b64.padEnd(Math.ceil(b64.length/4)*4,"="));
    const bytes=Uint8Array.from(decoded,letter=>letter.charCodeAt(0));
    return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
  }
  function verified(item){
    if(!item||typeof item!=="object"||Array.isArray(item)||item.v!==1 ||
      typeof item.id!=="string"||!/^[a-z0-9-]{1,45}$/i.test(item.id) ||
      typeof item.date!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(item.date) ||
      !["Завтрак","Обед","Ужин","Перекус","Напиток"].includes(item.type) ||
      typeof item.name!=="string"||!item.name.trim()||item.name.length>180){
      throw Error("Запись имеет неверный формат.");
    }
    const [y,m,d]=item.date.split("-").map(Number);
    const check=new Date(y,m-1,d,12);
    if(y<2020||y>2100||check.getFullYear()!==y||
      check.getMonth()!==m-1||check.getDate()!==d)throw Error("Недопустимая дата.");
    for(const [key,max] of [["kcal",8000],["protein",1000],["fat",1000],["carbs",1000]]){
      if(typeof item[key]!=="number"||!Number.isFinite(item[key])||
        item[key]<0||item[key]>max)throw Error("Недопустимые калории или БЖУ.");
    }
    return {id:"chat-"+item.id,date:item.date,type:item.type,name:item.name.trim(),
      kcal:item.kcal,protein:item.protein,fat:item.fat,carbs:item.carbs,photo:null};
  }
  function previewMeal(meal){
    const panel=el("chatMealPreview");
    if(panel){
      panel.classList.toggle("hide",false);
      panel.textContent=meal.date+" · "+meal.type+" — "+meal.name+
        " · ≈ "+meal.kcal+" ккал · Б "+meal.protein+
        " / Ж "+meal.fat+" / У "+meal.carbs+" г";
    }
  }
  function save(code){
    let meal;
    try{meal=verified(decode(code));}
    catch(_){alert("Код питания не распознан. Проверь скопированный текст.");return false;}
    previewMeal(meal);
    if(db.meals.some(x=>x.id===meal.id)){
      alert("Эта запись уже есть в дневнике. Повторно не добавляю.");
      return false;
    }
    const iosNote=isIosBrowser() ?
      "\n\n⚠️ Ссылка открыта в браузере iPhone. Если твой дневник на экране Домой, Safari может сохранить запись ОТДЕЛЬНО. Скопируй код и вставь внутри установленного приложения." : "";
    if(!confirm("Добавить в локальный дневник «"+meal.name+"» на "+meal.date+
      "?\n≈ "+meal.kcal+" ккал · Б "+meal.protein+" · Ж "+meal.fat+
      " · У "+meal.carbs+" г\n\nЗначения приблизительные. Фото не переносится."+iosNote))return false;
    if(!window.v12Commit)return alert("Сохранение дневника недоступно."),false;
    const result=window.v12Commit(next=>{
      if(!next.meals.some(x=>x.id===meal.id))next.meals.push(meal);
    });
    if(result){
      if(typeof tab==="function")tab("home");
      const selected=el("selectedDate");
      if(selected){
        selected.value=meal.date;
        if(typeof selected.onchange==="function")selected.onchange({target:selected});
      }
      const status=el("chatMealStatus");
      if(status)status.textContent="✓ Добавлено в этот дневник: "+meal.name+
        " · "+meal.kcal+" ккал · "+meal.date;
    }
    return result;
  }
  function fromPaste(){
    const input=el("chatMealCode");
    if(input&&save(input.value))input.value="";
  }
  async function copyCode(){
    const input=el("chatMealCode");
    if(!input||!input.value.trim()){status("Сначала вставь код записи.");return false;}
    try{verified(decode(input.value));}
    catch(_){status("Этот код некорректен. Проверь его перед копированием.");return false;}
    try{
      if(!navigator.clipboard?.writeText)throw Error("Clipboard unavailable");
      const str=input.value.trim();
      await navigator.clipboard.writeText(str.startsWith("meal:")?str:"meal:"+str.replace(/^.*#meal=/,""));
      status("✓ Код скопирован. Открой установленный «Мой рацион» и вставь его в разделе «Сегодня».");
      return true;
    }catch(_){
      if(typeof input.focus==="function")input.focus();
      if(typeof input.select==="function")input.select();
      status("Не удалось скопировать автоматически. Выдели и скопируй код вручную.");
      return false;
    }
  }
  window.vChatMealCopy=copyCode;
  window.vChatMealImport=fromPaste;
  window.vChatMealParse=code=>verified(decode(code));
  function processLink(){
    if(typeof location==="undefined"||typeof location.hash!=="string"||
       !location.hash.startsWith("#meal="))return;
    const code=location.hash;
    const input=el("chatMealCode");
    if(input)input.value="meal:"+code.slice(6);
    const details=el("chatImportDetails");
    if(details)details.open=true;
    let parsed;
    try{
      parsed=verified(decode(code));
      previewMeal(parsed);
    }catch(_){
      status("Некорректная ссылка. Данные не добавлены.");
      return;
    }
    if(isIosBrowser())status("Это окно Safari, а не установленное приложение. Чтобы не потерять запись, нажми «Копировать код», затем вставь его в установленном «Моём рационе».");
    else status("Проверь данные и подтверди добавление в свой дневник.");
    // Remove the fragment from browser history regardless of confirmation;
    // avoids repeated prompting and accidental exposure in screen sharing.
    if(typeof history!=="undefined"&&typeof history.replaceState==="function"){
      history.replaceState(null,"",location.pathname+location.search);
    } else location.hash="";
    // An iPhone Safari tab may have a DIFFERENT localStorage than the
    // home-screen installed app. Do not save to the wrong diary automatically.
    if(!isIosBrowser())save(code);
  }
  processLink();
  if(typeof addEventListener==="function")addEventListener("hashchange",processLink);
})();
