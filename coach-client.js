/* OpenAI-only nutrition helper.
   No account memory, no automatic diary transmission, no key in source code.
   Chat exists in memory only and is disabled until a trusted backend is configured. */
(function(){
  "use strict";
  const get=id=>document.getElementById(id);
  if(!get("coach"))return;
  const base=String(window.MEAL_AI_ENDPOINT||"");
  const ready=/^https:\/\/[a-z0-9.-]+(?::\d+)?\/api\/analyze-meal$/i.test(base);
  const endpoint=ready?base.replace(/\/api\/analyze-meal$/,"/api/coach"):"";
  const messages=[];
  let busy=false, approved=false;
  const input=get("coachText"),send=get("coachSend"),clear=get("coachClear");
  const summaryCheck=get("coachShareWeek"),notice=get("coachStatus"),log=get("coachMessages");
  const safe=value=>esc(String(value==null?"":value));
  send.disabled=!ready;
  input.disabled=!ready;
  if(!ready)notice.textContent="ИИ пока не подключён. Чат заработает после настройки защищённого OpenAI API. Бесплатный дневник продолжает работать офлайн.";
  function render(){
    log.innerHTML=messages.length ? messages.map(item=>
      '<div class="coach-bubble '+(item.role==="user"?"from-user":"from-ai")+
      '"><div class="coach-sender">'+(item.role==="user"?"Ты":"Помощник OpenAI")+
      '</div><div class="coach-content">'+safe(item.content)+'</div></div>'
    ).join("") : '<p class="muted">Здесь появится диалог. История этого чата не сохраняется в дневнике и исчезнет после закрытия страницы.</p>';
  }
  function sevenDaySummary(){
    const days=new Set();
    const now=new Date();
    for(let i=0;i<7;i++){
      const date=new Date(now.getFullYear(),now.getMonth(),now.getDate()-i,12);
      days.add(date.getFullYear()+"-"+String(date.getMonth()+1).padStart(2,"0")+
        "-"+String(date.getDate()).padStart(2,"0"));
    }
    const foods=Array.isArray(db.meals)?db.meals.filter(x=>days.has(x.date)):[];
    const logged=new Set(foods.map(x=>x.date));
    const total=key=>Math.round(foods.reduce((n,item)=>{
      const val=Number(item[key]);
      return n+(Number.isFinite(val)&&val>=0?val:0);
    },0)*10)/10;
    return {days_logged:logged.size,kcal_total:total("kcal"),
      protein_total_g:total("protein"),fat_total_g:total("fat"),
      carbs_total_g:total("carbs"),calorie_goal:Number(db.settings.calories)||2500};
  }
  async function submit(){
    if(!ready||busy)return;
    const question=input.value.trim();
    if(!question||question.length>1100){
      notice.textContent="Введи вопрос длиной до 1100 символов.";return;
    }
    if(!approved){
      if(!confirm("Отправить сообщения этого чата в OpenAI? Сами записи дневника и фото не передаются. Для недельной сводки требуется отдельная галочка."))return;
      approved=true;
    }
    const withWeek=!!summaryCheck.checked;
    if(withWeek && !confirm("Передать OpenAI только суммы калорий и БЖУ за последние 7 дней, без названий блюд, фото или отдельных записей?"))return;
    const key=prompt("Приватный токен сервера. Используется для одного запроса и нигде не сохраняется.");
    if(!key||key.trim().length<32){notice.textContent="Приватный токен не введён. Запрос не отправлен.";return;}
    const conversation=[...messages.slice(-7),{role:"user",content:question}];
    const payload={consent:true,messages:conversation};
    if(withWeek){payload.share_summary=true;payload.week_summary=sevenDaySummary();}
    busy=true;send.disabled=true;notice.textContent="OpenAI формирует ответ…";
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
    try{
      const response=await fetch(endpoint,{method:"POST",
        headers:{"Content-Type":"application/json","Authorization":"Bearer "+key.trim()},
        body:JSON.stringify(payload),signal:controller.signal});
      let content={};
      try{content=await response.json()}catch(_){}
      if(!response.ok)throw Error(typeof content.error==="string"?content.error.slice(0,180):"Сервис временно недоступен.");
      if(!content||typeof content.reply!=="string"||!content.reply.trim()||
        content.source!=="openai"||content.reply.length>9000)throw Error("Получен некорректный ответ.");
      messages.push({role:"user",content:question},{role:"assistant",content:content.reply});
      if(messages.length>8)messages.splice(0,messages.length-8);
      input.value="";
      render();
      notice.textContent="Ответ получен. Это справочная информация; дневник не изменён.";
    }catch(e){
      notice.textContent=e.name==="AbortError"?"Ответ задерживается. Попробуй ещё раз.":String(e.message||"Нет связи.").slice(0,200);
    }finally{clearTimeout(timer);busy=false;send.disabled=!ready;}
  }
  function reset(){messages.length=0;approved=false;summaryCheck.checked=false;notice.textContent=ready?"Диалог очищен.":"ИИ пока не подключён.";render();}
  const baseTab=tab;
  tab=function(name){
    if(name==="coach"){
      baseTab("home");
      for(const id of ["home","recipes","reports","settings"])get(id).classList.toggle("hide",true);
      get("coach").classList.toggle("hide",false);
      document.querySelectorAll("[data-tab]").forEach(x=>x.classList.toggle("active",x.dataset.tab===name));
      get("heading").textContent="ИИ-помощник 🤖";
      return;
    }
    get("coach").classList.toggle("hide",true);
    baseTab(name);
  };
  send.onclick=submit;
  clear.onclick=reset;
  render();
  window.vCoachSummary=sevenDaySummary;
})();
