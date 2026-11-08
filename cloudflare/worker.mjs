/* Free-tier Cloudflare Worker: privacy-first OpenAI proxy, OFF until deployed.
   No browser-side OpenAI key. Uses persistent SQLite-backed Durable Object ledger. */
import {validateImageDataUrl,analyzeMealPhoto} from "../server/vision.mjs";
import {validateChatPayload,askOpenAI} from "../server/coach.mjs";
export {BudgetLedger} from "./budget.mjs";

const ORIGIN="https://n9md9yyh48-alt.github.io";
const LIMIT=2_100_000;
const error=(reason,status=400)=>Object.assign(new Error(reason),{status});
function json(obj,status=200,origin=""){
  const headers={"Content-Type":"application/json; charset=utf-8",
    "Cache-Control":"no-store","X-Content-Type-Options":"nosniff",
    "Referrer-Policy":"no-referrer"};
  if(origin){headers["Access-Control-Allow-Origin"]=origin;headers["Vary"]="Origin";}
  return new Response(JSON.stringify(obj),{status,headers});
}
async function authOk(given,expected){
  if(typeof expected!=="string"||expected.length<32||!given.startsWith("Bearer "))return false;
  const enc=new TextEncoder();
  const [a,b]=await Promise.all([
    crypto.subtle.digest("SHA-256",enc.encode(given.slice(7))),
    crypto.subtle.digest("SHA-256",enc.encode(expected))
  ]);
  const left=new Uint8Array(a),right=new Uint8Array(b);
  let diff=0;
  for(let i=0;i<left.length;i++)diff|=left[i]^right[i];
  return diff===0;
}
async function limitedJson(request){
  const length=Number(request.headers.get("content-length"));
  if(Number.isFinite(length)&&length>LIMIT)throw error("Слишком большой запрос.",413);
  const reader=request.body?.getReader();
  if(!reader)throw error("Не получены данные.",400);
  let size=0;const chunks=[];
  try{
    while(true){
      const {value,done}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>LIMIT)throw error("Слишком большой запрос.",413);
      chunks.push(value);
    }
  }finally{if(size>LIMIT)await reader.cancel().catch(()=>{});}
  const bytes=new Uint8Array(size);
  let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  let parsed;
  try{parsed=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}
  catch(_){throw error("Неверный формат JSON.",400);}
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw error("Некорректный запрос.",400);
  return parsed;
}
function ready(env){
  return typeof env.OPENAI_API_KEY==="string"&&env.OPENAI_API_KEY.length>=12&&
    typeof env.AI_ACCESS_TOKEN==="string"&&env.AI_ACCESS_TOKEN.length>=32&&
    env.BUDGET&&typeof env.BUDGET.get==="function"&&env.AI_MODEL==="gpt-6.1-terra";
}
async function ledgerRequest(env,kind,payload){
  const stub=env.BUDGET.get(env.BUDGET.idFromName("private-owner-budget"));
  const response=await stub.fetch(new Request("https://budget.internal/"+kind,{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)
  }));
  const obj=await response.json();
  return {status:response.status,body:obj};
}
export default {
  async fetch(request,env){
    const url=new URL(request.url);
    const origin=request.headers.get("Origin")||"";
    const allowed=origin===ORIGIN;
    if(origin&&!allowed)return json({error:"Недопустимый источник."},403);
    if(request.method==="OPTIONS"){
      if(!allowed)return json({error:"CORS запрещён."},403);
      return new Response(null,{status:204,headers:{
        "Access-Control-Allow-Origin":ORIGIN,
        "Access-Control-Allow-Methods":"POST, GET, OPTIONS",
        "Access-Control-Allow-Headers":"Authorization, Content-Type",
        "Access-Control-Max-Age":"600","Vary":"Origin"
      }});
    }
    if(request.method==="GET"&&url.pathname==="/health"){
      return json({status:"ok",ready:!!ready(env)},200,allowed?ORIGIN:"");
    }
    if(!["/api/analyze-meal","/api/coach","/api/budget"].includes(url.pathname))
      return json({error:"Не найдено."},404,allowed?ORIGIN:"");
    if(!ready(env))return json({error:"OpenAI не настроен. Платные запросы выключены."},503,allowed?ORIGIN:"");
    if(!await authOk(request.headers.get("Authorization")||"",env.AI_ACCESS_TOKEN))
      return json({error:"Доступ запрещён."},401,allowed?ORIGIN:"");
    if(url.pathname==="/api/budget"&&request.method==="GET"){
      try{
        const result=await ledgerRequest(env,"status",{});
        return json(result.body,result.status,allowed?ORIGIN:"");
      }catch(_){return json({error:"Счётчик бюджета недоступен."},503,allowed?ORIGIN:"");}
    }
    if(request.method!=="POST")return json({error:"Метод не разрешён."},405,allowed?ORIGIN:"");
    if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get("Content-Type")||""))
      return json({error:"Требуется application/json."},415,allowed?ORIGIN:"");
    const photo=url.pathname==="/api/analyze-meal";
    let payload;
    try{
      payload=await limitedJson(request);
      if(photo){
        if(payload.consent!==true)throw error("Подтверди отправку фотографии.");
        validateImageDataUrl(payload.image_data_url);
      }else{
        validateChatPayload(payload);
      }
    }catch(e){
      return json({error:e.message||"Неправильные данные."},[400,413].includes(e.status)?e.status:400,allowed?ORIGIN:"");
    }
    // The ledger reserves a conservative amount before any OpenAI request.
    // A missing/failed durable budget ledger MUST block the paid operation.
    const id=crypto.randomUUID();
    let reservation;
    try{reservation=await ledgerRequest(env,"reserve",{kind:photo?"photo":"chat",id});}
    catch(_){return json({error:"Контроль бюджета недоступен. Запрос заблокирован."},503,allowed?ORIGIN:"");}
    if(reservation.status!==200 || !reservation.body.ok){
      const code=[402,429,409].includes(reservation.status)?reservation.status:503;
      return json({error:reservation.body.error||"Бюджетный лимит достигнут."},code,allowed?ORIGIN:"");
    }
    let usage=null,result=null,providerError=null;
    try{
      if(photo)result=await analyzeMealPhoto({imageDataUrl:payload.image_data_url,
        apiKey:env.OPENAI_API_KEY,model:env.AI_MODEL,onUsage:u=>{usage=u;}});
      else result=await askOpenAI({payload,apiKey:env.OPENAI_API_KEY,
        model:env.AI_MODEL,onUsage:u=>{usage=u;}});
    }catch(e){providerError=e;}
    let settled=false;
    try{
      const last=await ledgerRequest(env,"settle",{id,month:reservation.body.month,usage});
      settled=last.body.ok===true;
    }catch(_){/* if not settled, held budget remains blocked */ }
    if(providerError){
      return json({error:providerError.message||"OpenAI временно недоступен."},
        [400,429,502,503,504].includes(providerError.status)?providerError.status:502,allowed?ORIGIN:"");
    }
    if(!settled)return json({error:"Не удалось подтвердить расход бюджета. Запросы приостановлены."},503,allowed?ORIGIN:"");
    return json(result,200,allowed?ORIGIN:"");
  }
};
