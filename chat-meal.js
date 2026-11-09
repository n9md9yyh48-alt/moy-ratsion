/* Import a single meal from a chat share code or URL fragment.
   No network, no photos, no sharing the diary. Explicit confirmation.
   This writes ONLY to the current browser/PWA's existing localStorage. */
(function(){
  "use strict";
  const el=id=>document.getElementById(id);
  const prefix="meal:";
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
  function save(code){
    let meal;
    try{meal=verified(decode(code));}
    catch(_){alert("Код питания не распознан. Проверь скопированный текст.");return false;}
    if(db.meals.some(x=>x.id===meal.id)){
      alert("Эта запись уже есть в дневнике. Повторно не добавляю.");
      return false;
    }
    if(!confirm("Добавить в локальный дневник «"+meal.name+"» на "+meal.date+
      "?\n≈ "+meal.kcal+" ккал · Б "+meal.protein+" · Ж "+meal.fat+
      " · У "+meal.carbs+" г\n\nЗначения приблизительные. Фото не переносится."))return false;
    if(!window.v12Commit)return alert("Сохранение дневника недоступно."),false;
    const result=window.v12Commit(next=>{
      if(!next.meals.some(x=>x.id===meal.id))next.meals.push(meal);
    });
    if(result){
      if(typeof tab==="function")tab("home");
      const selected=el("selectedDate");
      if(selected){
        selected.value=meal.date;
        if(typeof selected.onchange==="function")selected.onchange();
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
  window.vChatMealImport=fromPaste;
  window.vChatMealParse=code=>verified(decode(code));
  function processLink(){
    if(typeof location==="undefined"||typeof location.hash!=="string"||
       !location.hash.startsWith("#meal="))return;
    const code=location.hash;
    // Remove the fragment from browser history regardless of confirmation;
    // avoids repeated prompting and accidental exposure in screen sharing.
    if(typeof history!=="undefined"&&typeof history.replaceState==="function"){
      history.replaceState(null,"",location.pathname+location.search);
    } else location.hash="";
    save(code);
  }
  processLink();
  if(typeof addEventListener==="function")addEventListener("hashchange",processLink);
})();
