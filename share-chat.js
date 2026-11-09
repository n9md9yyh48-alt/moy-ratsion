/* Share only deliberately selected diary summaries with ChatGPT.
   No requests, no cloud sync, no automatic export of personal diary data. */
(function(){
 "use strict";
 const get=id=>document.getElementById(id);
 const preview=get("chatSharePreview");
 const status=get("chatShareStatus");
 if(!preview||!status)return;
 const fixed=n=>{
   const value=Number(n);
   return Number.isFinite(value)&&value>=0 ? Math.round(value*10)/10 : 0;
 };
 const fmt=date=>{
   const year=date.getFullYear(),month=date.getMonth()+1,day=date.getDate();
   return year+"-"+String(month).padStart(2,"0")+"-"+String(day).padStart(2,"0");
 };
 const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&
   fmt(new Date(value+"T12:00:00"))===value;
 const selectedDate=()=>{
   const date=get("chatShareDate")?.value || get("selectedDate")?.value;
   return validDate(date)?date:today();
 };
 const numbers=meals=>{
   const add=key=>Math.round(meals.reduce((acc,m)=>acc+fixed(m[key]),0)*10)/10;
   return {kcal:add("kcal"),protein:add("protein"),fat:add("fat"),carbs:add("carbs")};
 };
 const linesForDay=(date,full)=>{
   const meals=(Array.isArray(db.meals)?db.meals:[]).filter(m=>m.date===date);
   if(!meals.length)return date+" — записей нет (данных недостаточно).";
   const totals=numbers(meals);
   const lines=[date+" — "+totals.kcal+" ккал; Б "+totals.protein+
     " г, Ж "+totals.fat+" г, У "+totals.carbs+" г."];
   if(full)for(const m of meals){
     lines.push("• "+String(m.type||"Еда").slice(0,35)+": "+String(m.name||"Без названия").slice(0,160)+
       " — "+fixed(m.kcal)+" ккал, Б "+fixed(m.protein)+
       " г, Ж "+fixed(m.fat)+" г, У "+fixed(m.carbs)+" г.");
   }
   return lines.join("\n");
 };
 function generate(mode){
   const date=selectedDate();
   const parts=[
     "Данные моего локального дневника «Мой рацион». Калории и БЖУ — приблизительные.",
     "Пожалуйста, помоги проанализировать питание без предположений о незаписанных приёмах пищи.",
     "Дневная цель: "+fixed(db.settings?.calories)+" ккал."
   ];
   if(mode==="week"){
     parts.push("Отчёт за последние 7 календарных дней по "+date+":");
     const start=new Date(date+"T12:00:00");
     for(let i=6;i>=0;i--){
       const day=new Date(start);
       day.setDate(start.getDate()-i);
       parts.push(linesForDay(fmt(day),false));
     }
   }else{
     parts.push("Мои записи за "+date+":");
     parts.push(linesForDay(date,true));
   }
   parts.push("Не добавляй записи в мой дневник автоматически. Дай рекомендации с учётом неполноты данных.");
   return parts.join("\n");
 }
 function show(mode){
   if(mode!=="day"&&mode!=="week")return;
   const value=generate(mode);
   preview.value=value;
   preview.hidden=false;
   status.textContent="Текст подготовлен локально. Ничего не отправлено. Скопируй его только если хочешь поделиться с ChatGPT.";
 }
 async function copy(){
   const value=preview.value;
   if(!value){status.textContent="Сначала выбери день или неделю.";return false;}
   try{
     if(!navigator.clipboard?.writeText)throw Error("Clipboard unavailable");
     await navigator.clipboard.writeText(value);
     status.textContent="✓ Текст скопирован. Открой ChatGPT и вставь его в сообщение.";
     return true;
   }catch(_){
     if(typeof preview.focus==="function")preview.focus();
     if(typeof preview.select==="function")preview.select();
     status.textContent="Автоматическое копирование недоступно. Выдели текст в поле и скопируй вручную.";
     return false;
   }
 }
 const baseTab=tab;
 tab=function(name){
   if(name==="share"){
     baseTab("home");
     for(const id of ["home","recipes","reports","settings"])get(id).classList.toggle("hide",true);
     get("share").classList.toggle("hide",false);
     get("chatShareDate").value=get("selectedDate")?.value||today();
     preview.value="";
     preview.hidden=true;
     document.querySelectorAll("[data-tab]").forEach(x=>x.classList.toggle("active",x.dataset.tab===name));
     get("heading").textContent="ChatGPT и дневник 💬";
     return;
   }
   get("share").classList.toggle("hide",true);
   baseTab(name);
 };
 window.vShareChatDateChanged=()=>{
   preview.value="";
   preview.hidden=true;
   status.textContent="Дата изменена. Выбери день или 7 дней для нового отчёта.";
 };
 window.vShareChatDay=()=>show("day");
 window.vShareChatWeek=()=>show("week");
 window.vShareChatCopy=copy;
 window.vShareChatGenerate=generate;
})();
