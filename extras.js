/* Дополнительные офлайн-инструменты. После app.js и features-v12.js. */
(function(){
"use strict";
const RAW = [
"Яйцо варёное|155|12.6|10.6|1.1","Яйцо жареное|196|13.6|15.3|0.8",
"Омлет с молоком|154|11|11|2","Творог 5%|121|17|5|1.8",
"Творог 9%|159|16|9|2","Греческий йогурт 2%|73|9.7|2|3.9",
"Йогурт натуральный|60|4|2.5|6","Кефир 2,5%|52|3|2.5|4",
"Молоко 2,5%|52|2.8|2.5|4.7","Овсяная каша на воде|70|2.5|1.4|12",
"Овсяные хлопья сухие|389|16.9|6.9|66.3","Гречка варёная|110|3.6|1.1|21",
"Гречка сухая|343|13.3|3.4|71.5","Булгур варёный|83|3.1|0.2|18.6",
"Рис варёный|130|2.7|0.3|28.2","Макароны варёные|158|5.8|0.9|30.9",
"Картофель варёный|87|1.9|0.1|20","Картофельное пюре|104|2|3.9|15",
"Хлеб пшеничный|250|8.2|1.4|49","Хлеб ржаной|214|6.6|1.2|41.7",
"Лаваш|275|9|1.2|57","Банан|89|1.1|0.3|22.8",
"Яблоко|52|0.3|0.2|13.8","Апельсин|47|0.9|0.1|11.7",
"Виноград|69|0.7|0.2|18.1","Груша|57|0.4|0.1|15.2",
"Огурец|15|0.7|0.1|3.6","Помидор|18|0.9|0.2|3.9",
"Морковь|41|0.9|0.2|9.6","Перец сладкий|27|1|0.2|6",
"Брокколи отварная|35|2.4|0.4|7.2","Кукуруза|96|3.4|1.5|21",
"Шампиньоны|22|3.1|0.3|3.3","Капуста квашеная|19|1|0.1|4.3",
"Шпинат|23|2.9|0.4|3.6","Фасоль варёная|127|8.7|0.5|22.8",
"Чечевица варёная|116|9|0.4|20.1","Горох варёный|84|5.4|0.2|15",
"Куриная грудка готовая|165|31|3.6|0","Бедро куриное готовое|209|26|10.9|0",
"Индейка филе готовое|135|29|1.5|0","Говядина нежирная готовая|210|26|11|0",
"Свинина запечённая|242|27|14|0","Треска запечённая|105|23|0.9|0",
"Лосось запечённый|208|22|13|0","Тунец в воде консервированный|116|25.5|1|0",
"Креветки варёные|99|24|0.3|0.2","Лосось слабосолёный|183|19|12|0",
"Сыр твёрдый|356|25|27|2","Моцарелла|280|28|17|3",
"Фета|264|14.2|21.3|4.1","Масло сливочное|717|0.9|81.1|0.1",
"Масло оливковое|884|0|100|0","Майонез|680|1|75|2",
"Сахар|387|0|0|100","Мёд|304|0.3|0|82.4",
"Варенье|250|0.4|0.1|65","Грецкие орехи|654|15.2|65.2|13.7",
"Миндаль|579|21|49.9|21.6","Шоколад молочный|535|7.7|30|59.4",
"Пицца сырная (примерно)|266|11|10|33","Плов с мясом (примерно)|210|9|9|23",
"Борщ (примерно)|55|3|2|7","Куриный суп (примерно)|50|5|2|4",
"Салат овощной без масла|25|1.2|0.3|4.5","Сырники (примерно)|220|13|11|18",
"Котлеты из индейки (примерно)|180|20|8|7",
"Кофе чёрный без сахара|1|0|0|0|Напиток","Чай без сахара|1|0|0|0|Напиток",
"Апельсиновый сок|45|0.7|0.2|10.4|Напиток",
"Яблочный сок|46|0.1|0.1|11.3|Напиток",
"Лимонад с сахаром|42|0|0|10.6|Напиток",
"Какао с молоком|85|3.3|3.3|11.5|Напиток"
];
const FOODS=RAW.map(x=>{const p=x.split("|");return [p[0],...p.slice(1,5).map(Number),p[5]||""]});
let selectedFood=-1;
const get=id=>document.getElementById(id);
const clean=v=>esc(String(v==null?"":v));
function previousDate(s,n){const d=new Date(s+"T12:00:00");d.setDate(d.getDate()-n);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")}
function renderFoodResults(){
 const q=get("foodQuery").value.trim().toLocaleLowerCase("ru-RU");
 const found=FOODS.map((f,i)=>({f,i})).filter(({f})=>!q||f[0].toLocaleLowerCase("ru-RU").includes(q)).slice(0,q?12:7);
 get("foodResults").innerHTML=found.length?found.map(({f,i})=>
  '<button type="button" class="food-choice" onclick="vNextFillFood('+i+')"><span>'+clean(f[0])+'</span><small>≈ '+f[1]+' ккал / 100 г</small></button>'
 ).join(""):'<p class="muted">Ничего не найдено. Добавь продукт вручную.</p>';
}
function applyPortion(){
 const f=FOODS[selectedFood],grams=Number(get("foodGrams").value);
 if(!f||!Number.isFinite(grams)||grams<=0||grams>10000)return alert("Выбери продукт и укажи массу от 1 до 10 000 г/мл");
 const factor=grams/100;
 get("mealName").value=f[0]+" · "+grams+(f[5]?" мл":" г");
 get("mealKcal").value=Math.round(f[1]*factor);
 get("mealProtein").value=Math.round(f[2]*factor*10)/10;
 get("mealFat").value=Math.round(f[3]*factor*10)/10;
 get("mealCarbs").value=Math.round(f[4]*factor*10)/10;
 if(f[5])get("mealType").value=f[5];
 get("foodHint").textContent="Расчёт по справочнику для "+grams+" "+(f[5]?"мл":"г")+". Уточни состав и значения по этикетке; все поля редактируются.";
}
function fillFood(i){if(!FOODS[i])return;selectedFood=i;get("foodQuery").value=FOODS[i][0];get("foodResults").innerHTML="";applyPortion()}
function resetFood(){
 selectedFood=-1;get("foodQuery").value="";get("foodGrams").value="150";
 get("foodHint").textContent="Выбери продукт, укажи граммы — значения подставятся автоматически.";
 renderFoodResults();
}
function copyYesterday(){
 const destination=get("selectedDate").value||today(),source=previousDate(destination,1);
 const meals=db.meals.filter(x=>x.date===source);
 if(!meals.length){get("quickNotice").textContent="За вчерашний день записей нет.";return}
 const duplicated=db.meals.some(x=>x.date===destination&&x.copiedFromDate===source);
 const question=duplicated?"Рацион уже копировали сюда. Добавить повторно?":"Скопировать "+meals.length+" записей на "+destination+"? Фотографии копироваться не будут.";
 if(!confirm(question))return;
 const copies=meals.map(x=>({id:crypto.randomUUID(),date:destination,type:x.type,name:x.name,kcal:Number(x.kcal)||0,protein:Number(x.protein)||0,fat:Number(x.fat)||0,carbs:Number(x.carbs)||0,photo:null,copiedFromDate:source}));
 if(window.v12Commit(next=>next.meals.push(...copies)))get("quickNotice").textContent="Скопировано "+copies.length+" записей";
}
function renderWeekly(){
 const dates=Array.from({length:7},(_,i)=>previousDate(today(),6-i));
 const target=Number(db.settings.calories)||2500;
 const rows=dates.map(date=>({date,items:db.meals.filter(x=>x.date===date)}));
 const totals=rows.map(r=>r.items.reduce((n,x)=>n+(Number(x.kcal)||0),0));
 const max=Math.max(target,...totals,1),active=rows.filter(r=>r.items.length);
 let html='<h2>Последние 7 дней</h2><p class="muted">Столбики показывают калории относительно максимального значения. Пропуски не считаются нулевым потреблением.</p>';
 html+=rows.map((row,i)=>{
 const value=Math.round(totals[i]),width=Math.min(100,Math.max(0,value/max*100));
 const date=row.date.slice(5).split("-").reverse().join(".");
 return '<div class="report-bar-row"><span>'+date+'</span><div class="report-track"><div class="report-bar '+(value>target?'report-over':'')+'" style="width:'+width.toFixed(1)+'%"></div></div><b>'+(row.items.length?value+" ккал":"—")+'</b></div>';
 }).join("");
 if(active.length){const avg=key=>Math.round(active.reduce((n,r)=>n+r.items.reduce((m,x)=>m+(Number(x[key])||0),0),0)/active.length);
 html+='<div class="grid report-macros"><div class="stat"><small>Белки / заполненный день</small><strong>'+avg("protein")+' г</strong></div><div class="stat"><small>Жиры / заполненный день</small><strong>'+avg("fat")+' г</strong></div><div class="stat"><small>Углеводы / заполненный день</small><strong>'+avg("carbs")+' г</strong></div></div>';
 }else html+='<p class="muted">За неделю пока нет записей.</p>';
 get("weeklyBars").innerHTML=html;
}
function storageInfo(){
 const el=get("storageDetails");if(!el)return;
 let raw="",snap="";
 try{raw=localStorage.getItem(KEY)||"";snap=localStorage.getItem("moy-ratsion-v1-auto-backup")||""}catch(_){el.textContent="Не удалось прочитать хранилище.";return}
 const photoCount=db.meals.filter(m=>!!m.photo).length;
 el.textContent="Еда: "+db.meals.length+" записей · вес: "+db.weights.length+" измерений · фото: "+photoCount+
 ". Дневник занимает примерно "+Math.round(raw.length*2/1024)+" КБ"+(snap?"; автокопия ≈ "+Math.round(snap.length*2/1024)+" КБ.":"; локальной автокопии пока нет.")+
 " Данные остаются только на этом устройстве.";
}
function recipeMatch(x,terms){const ingredients=String(x[2]).toLocaleLowerCase("ru-RU");return terms.some(t=>ingredients.includes(t))}
function renderRecipesEnhanced(){
 const q=get("recipeSearch").value.trim().toLocaleLowerCase("ru-RU"),cat=get("recipeCategory").value;
 const pantry=get("pantryQuery").value.toLocaleLowerCase("ru-RU").split(/[,;\n]/).map(x=>x.trim()).filter(x=>x.length>1);
 const onlyFavs=get("recipeFavOnly").checked,favs=new Set(Array.isArray(db.recipeFavorites)?db.recipeFavorites:[]);
 const filtered=recipes.map((item,idx)=>({item,idx})).filter(({item})=>
 (!cat||item[0]===cat)&&(!q||(item[1]+" "+item[2]).toLocaleLowerCase("ru-RU").includes(q))&&(!onlyFavs||favs.has(item[1]))&&(!pantry.length||recipeMatch(item,pantry))
 ).sort((a,b)=>Number(favs.has(b.item[1]))-Number(favs.has(a.item[1])));
 get("recipeCount").textContent="Найдено: "+filtered.length;
 get("recipeList").innerHTML=filtered.length?filtered.map(({item,idx})=>
 '<div class="recipe"><div class="row between"><span class="chip">'+clean(item[0])+'</span><button class="btn ghost" type="button" onclick="vNextToggleRecipe('+idx+')">'+(favs.has(item[1])?"★ В избранном":"☆ В избранное")+'</button></div><h3>'+clean(item[1])+'</h3><div class="muted">≈ '+item[3]+' ккал/порция · '+clean(item[4])+'</div><p><b>Ингредиенты:</b> '+clean(item[2])+'</p><p>'+clean(item[5])+'</p><button class="btn secondary" onclick="addRecipe('+idx+')">＋ Добавить в дневник</button></div>'
 ).join(""):'<p class="muted">По запросу ничего не найдено.</p>';
}
function toggleRecipe(i){
 const item=recipes[i];if(!item)return;
 if(window.v12Commit(next=>{if(!Array.isArray(next.recipeFavorites))next.recipeFavorites=[];const idx=next.recipeFavorites.indexOf(item[1]);if(idx<0)next.recipeFavorites.push(item[1]);else next.recipeFavorites.splice(idx,1)}))renderRecipes();
}
const baseOpenMeal=openMeal;openMeal=function(...args){baseOpenMeal(...args);resetFood()};
const baseRender=render;render=function(){baseRender();storageInfo()};
const baseReport=renderReport;renderReport=function(){baseReport();renderWeekly()};
const baseTab=tab;tab=function(name){baseTab(name);if(name==="settings")storageInfo()};
renderRecipes=renderRecipesEnhanced;
window.vNextSearchFoods=renderFoodResults;window.vNextFillFood=fillFood;window.vNextRecalcFood=applyPortion;
window.vNextCopyYesterday=copyYesterday;window.vNextToggleRecipe=toggleRecipe;
})();
