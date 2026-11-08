/* Optional image-analysis UI. Disabled unless ai-config.js names a live HTTPS backend.
   No image upload without the user's deliberate click and confirmation. */
(function(){
  "use strict";
  const button=document.getElementById("aiAnalyzePhoto");
  const status=document.getElementById("aiPhotoStatus");
  const resultBox=document.getElementById("aiPhotoResult");
  const resultText=document.getElementById("aiPhotoResultText");
  const applyButton=document.getElementById("aiApplyEstimate");
  if(!button||!status||!resultBox||!resultText||!applyButton)return;
  const endpoint=String(window.MEAL_AI_ENDPOINT||"").trim();
  const ready=/^https:\/\/[a-z0-9.-]+(?::\d+)?\/api\/analyze-meal$/i.test(endpoint);
  button.hidden=!ready;
  let estimate=null;
  let active=false;
  const get=id=>document.getElementById(id);
  const within=(n,low,high)=>Number.isInteger(n)&&n>=low&&n<=high;
  function validate(data){
    if(!data||data.recognized!==true||data.requires_confirmation!==true||
       data.estimated_only!==true||typeof data.dish_name!=="string"||!data.dish_name.trim()) {
      return false;
    }
    return [
      ["portion_min_g","portion_max_g",3000],["kcal_min","kcal_max",5000],
      ["protein_min_g","protein_max_g",500],["fat_min_g","fat_max_g",500],
      ["carbs_min_g","carbs_max_g",500]
    ].every(([a,b,max])=>within(data[a],0,max)&&within(data[b],data[a],max));
  }
  function reset(){
    estimate=null;active=false;
    status.textContent="";
    resultBox.hidden=true;
    button.disabled=false;
  }
  async function analyze(){
    if(!ready||active)return;
    const file=get("mealPhoto").files[0];
    if(!file){status.textContent="Сначала выбери фотографию еды.";return}
    if(!confirm("Отправить только выбранное фото через защищённый сервер в OpenAI для примерной оценки блюда? Масса, калории и БЖУ по фото неточны. Без подтверждения ничего не запишется в дневник."))return;
    const secret=prompt("Введи приватный токен сервиса. Он будет использован только для этого запроса и не сохранится в приложении.");
    if(!secret||secret.trim().length<32){status.textContent="Токен не введён. Запрос не отправлен.";return;}
    active=true;button.disabled=true;estimate=null;resultBox.hidden=true;
    status.textContent="Обработка выбранной фотографии…";
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),35000);
    try{
      const dataUrl=await shrink(file);
      if(!dataUrl)throw Error("Фотография отсутствует.");
      const response=await fetch(endpoint,{
        method:"POST",
        headers:{"Content-Type":"application/json","Authorization":"Bearer "+secret.trim()},
        body:JSON.stringify({consent:true,image_data_url:dataUrl}),
        signal:controller.signal
      });
      let responseBody={};
      try{responseBody=await response.json();}catch(_){}
      if(!response.ok)throw Error(typeof responseBody.error==="string" ?
        responseBody.error.slice(0,200) : "Сервис временно недоступен.");
      if(!responseBody.recognized){
        status.textContent="ИИ не смог определить блюдо. Заполни запись вручную.";
        return;
      }
      if(!validate(responseBody))throw Error("Сервис вернул неполные или некорректные данные.");
      estimate=responseBody;
      const units=[
        "Вес ≈ "+estimate.portion_min_g+"–"+estimate.portion_max_g+" г",
        "Калории ≈ "+estimate.kcal_min+"–"+estimate.kcal_max+" ккал",
        "Б "+estimate.protein_min_g+"–"+estimate.protein_max_g+" г",
        "Ж "+estimate.fat_min_g+"–"+estimate.fat_max_g+" г",
        "У "+estimate.carbs_min_g+"–"+estimate.carbs_max_g+" г"
      ];
      resultText.textContent=estimate.dish_name+" · "+units.join(" · ") +
        (estimate.notes?"\n"+estimate.notes:"");
      resultBox.hidden=false;
      status.textContent="Получена приблизительная оценка. Проверь её перед добавлением.";
    }catch(e){
      status.textContent=e.name==="AbortError"?"Сервис не ответил. Можно добавить еду вручную.":
        (e.message||"Не удалось обработать фото. Введи еду вручную.").slice(0,250);
    }finally{
      clearTimeout(timer);active=false;button.disabled=false;
    }
  }
  function apply(){
    if(!validate(estimate))return;
    const mid=(a,b)=>Math.round((a+b)/2);
    get("mealName").value=estimate.dish_name;
    get("mealKcal").value=mid(estimate.kcal_min,estimate.kcal_max);
    get("mealProtein").value=mid(estimate.protein_min_g,estimate.protein_max_g);
    get("mealFat").value=mid(estimate.fat_min_g,estimate.fat_max_g);
    get("mealCarbs").value=mid(estimate.carbs_min_g,estimate.carbs_max_g);
    status.textContent="Оценка перенесена в поля как примерные средние значения. Проверь название, порцию, калории и БЖУ, затем нажми «Сохранить».";
    resultBox.hidden=true;
  }
  button.onclick=analyze;
  applyButton.onclick=apply;
  window.vAIReset=reset;
})();