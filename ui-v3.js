/* Мой рацион 3.0 — исключительно визуальные индикаторы.
   Берёт данные из существующих элементов. НЕ меняет localStorage или модель db. */
(function(){
  "use strict";
  const byId=id=>document.getElementById(id);
  const amount=id=>{
    const text=byId(id)?.textContent||"";
    return Math.max(0,Number(text.replace(/[^\d.,-]/g,"").replace(",","."))||0);
  };
  const format=n=>Math.round(n).toLocaleString("ru-RU");
  function refresh(){
    const ring=byId("calorieRing"),delta=byId("kcalDelta");
    if(!ring||!delta)return;
    const kcal=amount("todayKcal"),goal=amount("goalKcal")||2500;
    const percent=Math.max(0,Math.min(100,kcal/goal*100));
    ring.style.setProperty("--ring-percent",percent.toFixed(2)+"%");
    ring.style.setProperty("--ring-fill",kcal>goal?"#f16c6b":"#edc36e");
    ring.setAttribute("aria-valuemin","0");
    ring.setAttribute("aria-valuemax",String(goal));
    ring.setAttribute("aria-valuenow",String(Math.min(kcal,goal)));
    ring.setAttribute("aria-valuetext",format(kcal)+" из "+format(goal)+" килокалорий");
    delta.classList.toggle("over",kcal>goal);
    delta.classList.toggle("empty",kcal===0);
    delta.textContent=kcal===0?"Пока без записей":
      kcal>goal?"+"+format(kcal-goal)+" ккал к цели":"Осталось "+format(goal-kcal)+" ккал";
    // Шкалы показывают доли энергии по Б/Ж/У в записанной еде,
    // не выдают их за персональные нормы или назначение врача.
    const p=amount("prot"),f=amount("fat"),c=amount("carb");
    const energy=4*p+9*f+4*c;
    [["protBar",4*p],["fatBar",9*f],["carbBar",4*c]].forEach(([id,value])=>{
      const bar=byId(id);
      if(!bar)return;
      const share=energy>0?Math.min(100,value/energy*100):0;
      bar.style.width=share.toFixed(1)+"%";
      bar.parentElement?.setAttribute("aria-valuenow",String(Math.round(share)));
      bar.parentElement?.setAttribute("aria-valuetext",Math.round(share)+" процентов энергии записанных БЖУ");
    });
    const date=byId("selectedDate")?.value||"";
    const caption=byId("nutritionDate");
    if(caption&&date){
      const [year,month,day]=date.split("-").map(Number);
      const parsed=new Date(year,month-1,day,12);
      caption.textContent=Number.isFinite(parsed.getTime())?
        parsed.toLocaleDateString("ru-RU",{day:"numeric",month:"long"}):date;
    }
  }
  const previousRender=render;
  render=function(){previousRender();refresh();};
  window.v3Refresh=refresh;
  refresh();
})();
