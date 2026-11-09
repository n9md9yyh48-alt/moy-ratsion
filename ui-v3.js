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
  // A miniature calendar overview is derived from the currently selected day,
  // not from fabricated demo data. Missing days stay blank.
  const dateKey=d=>d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
  function refreshWeek(){
    const panel=byId("miniWeekBars"),date=byId("selectedDate")?.value;
    if(!panel||!date||!Array.isArray(db.meals))return;
    const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if(!match)return;
    const end=new Date(Number(match[1]),Number(match[2])-1,Number(match[3]),12);
    if(!Number.isFinite(end.getTime()))return;
    const goal=Number(db.settings?.calories)||2500;
    const days=Array.from({length:7},(_,i)=>{
      const day=new Date(end);
      day.setDate(end.getDate()-6+i);
      const iso=dateKey(day);
      const entries=db.meals.filter(meal=>meal.date===iso);
      const total=Math.round(entries.reduce((sum,meal)=>sum+(Number(meal.kcal)||0),0));
      return {day,iso,total,count:entries.length};
    });
    const peak=Math.max(1,goal,...days.map(d=>d.total));
    panel.replaceChildren();
    for(const d of days){
      const column=document.createElement("div");
      column.className="mini-week-day"+(d.iso===date?" selected":"")+(d.count?" recorded":" empty")+(d.total>goal?" over":"");
      const value=document.createElement("span");
      value.className="mini-week-value";
      value.textContent=d.count?d.total>=1000?(d.total/1000).toFixed(1).replace(".",",")+"к":String(d.total):"—";
      const track=document.createElement("span");
      track.className="mini-week-track";
      const bar=document.createElement("span");
      bar.className="mini-week-bar";
      bar.style.height=(d.count?Math.max(7,Math.round(d.total/peak*100)):3)+"%";
      track.appendChild(bar);
      const label=document.createElement("span");
      label.className="mini-week-label";
      label.textContent=d.day.toLocaleDateString("ru-RU",{weekday:"short"}).replace(".","");
      const dayNum=document.createElement("span");
      dayNum.className="mini-week-number";
      dayNum.textContent=String(d.day.getDate());
      column.append(value,track,label,dayNum);
      column.setAttribute("title",d.day.toLocaleDateString("ru-RU",{day:"numeric",month:"long"})+": "+
        (d.count?format(d.total)+" ккал, "+d.count+" записей":"нет записей"));
      panel.appendChild(column);
    }
  }
  function refreshMealCount(){
    const label=byId("mealCount"),date=byId("selectedDate")?.value;
    if(!label||!date||!Array.isArray(db.meals))return;
    const n=db.meals.filter(m=>m.date===date).length;
    label.textContent=n+" "+(n%10===1&&n%100!==11?"запись":
      (n%10>=2&&n%10<=4&&(n%100<12||n%100>14)?"записи":"записей"));
  }
  window.v3ShowImport=function(){
    const details=byId("chatImportDetails");
    if(!details)return;
    details.open=true;
    if(typeof details.scrollIntoView==="function")
      details.scrollIntoView({behavior:"smooth",block:"center"});
  };
  // Keep aria-current synced when the original navigation toggles sections.
  const previousTab=tab;
  tab=function(name){
    previousTab(name);
    document.querySelectorAll(".tabs button[data-tab]").forEach(button=>{
      if(button.dataset.tab===name)button.setAttribute("aria-current","page");
      else button.removeAttribute("aria-current");
    });
  };
  const previousRender=render;
  render=function(){previousRender();refresh();refreshWeek();refreshMealCount();};
  window.v3Refresh=refresh;
  refresh();
  refreshWeek();
  refreshMealCount();
})();
