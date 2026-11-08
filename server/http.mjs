/* Opt-in, private backend. It is not hosted by GitHub Pages.
   Requires AI_ACCESS_TOKEN (>=32 characters), OPENAI_API_KEY and AI_MODEL. */
import http from "node:http";
import {timingSafeEqual} from "node:crypto";
import {fileURLToPath} from "node:url";
import {analyzeMealPhoto} from "./vision.mjs";
import {askOpenAI,validateChatPayload} from "./coach.mjs";

const MAX_BODY_BYTES = 2_100_000;
const DEFAULT_ORIGIN = "https://n9md9yyh48-alt.github.io";

function json(res,status,data,origin=""){
  res.statusCode=status;
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Cache-Control","no-store");
  res.setHeader("X-Content-Type-Options","nosniff");
  res.setHeader("Referrer-Policy","no-referrer");
  if(origin){res.setHeader("Access-Control-Allow-Origin",origin);res.setHeader("Vary","Origin");}
  res.end(JSON.stringify(data));
}
function secureEquals(left,right){
  if(typeof left!=="string"||typeof right!=="string")return false;
  const a=Buffer.from(left),b=Buffer.from(right);
  return a.length===b.length && timingSafeEqual(a,b);
}
function configured(env){
  return typeof env.AI_ACCESS_TOKEN==="string" &&
    env.AI_ACCESS_TOKEN.length>=32 &&
    typeof env.OPENAI_API_KEY==="string" &&
    env.OPENAI_API_KEY.length>=12 &&
    typeof env.AI_MODEL==="string" && env.AI_MODEL.length>=3;
}
function fromJson(req){
  return new Promise((resolve,reject)=>{
    let bytes=0;
    const chunks=[];
    req.on("data",chunk=>{
      bytes+=chunk.length;
      if(bytes>MAX_BODY_BYTES){
        reject(Object.assign(new Error("Фото слишком большое."),{status:413}));
        req.pause();
      } else chunks.push(chunk);
    });
    req.on("end",()=>{
      if(bytes>MAX_BODY_BYTES)return;
      try{resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));}
      catch(_){reject(Object.assign(new Error("Неверный JSON."),{status:400}));}
    });
    req.on("error",reject);
  });
}
function timestampDay(now){
  return new Date(now).toISOString().slice(0,10);
}

export function createApiHandler({env=process.env,fetchImpl=fetch,now=Date.now}={}){
  const minutePerClient=new Map();
  let day=timestampDay(now()),dailyUsed=0;
  const configuredOrigin=env.AI_ALLOWED_ORIGIN||DEFAULT_ORIGIN;
  if(!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(configuredOrigin) &&
     !/^http:\/\/localhost(?::\d+)?$/.test(configuredOrigin)){
    throw Error("AI_ALLOWED_ORIGIN must be a single trusted origin.");
  }
  const dailyLimit=Number.isInteger(Number(env.AI_DAILY_LIMIT)) ?
    Math.min(100,Math.max(1,Number(env.AI_DAILY_LIMIT))) : 20;
  return async function handler(req,res){
    const origin=req.headers.origin||"";
    const allowed=origin && origin===configuredOrigin;
    if(origin&&!allowed) return json(res,403,{error:"Недопустимый источник запроса."});
    if(req.method==="OPTIONS"){
      if(!allowed)return json(res,403,{error:"CORS запрещён."});
      res.statusCode=204;
      res.setHeader("Access-Control-Allow-Origin",origin);
      res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers","Authorization, Content-Type");
      res.setHeader("Access-Control-Max-Age","600");
      return res.end();
    }
    if(req.url==="/health" && req.method==="GET"){
      return json(res,200,{status:"ok",ready:configured(env)},allowed?origin:"");
    }
    if(req.method!=="POST"||!["/api/analyze-meal","/api/coach"].includes(req.url)){
      return json(res,404,{error:"Не найдено."},allowed?origin:"");
    }
    const cors=allowed?origin:"";
    if(!configured(env))return json(res,503,{error:"Анализ фотографий пока не настроен."},cors);
    const auth=req.headers.authorization||"";
    if(!auth.startsWith("Bearer ") || !secureEquals(auth.slice(7),env.AI_ACCESS_TOKEN)){
      return json(res,401,{error:"Требуется авторизация."},cors);
    }
    const source=req.socket.remoteAddress||"unknown";
    const current=now(),date=timestampDay(current);
    if(date!==day){day=date;dailyUsed=0;minutePerClient.clear();}
    const recent=(minutePerClient.get(source)||[]).filter(t=>t>current-60_000);
    if(recent.length>=3 || dailyUsed>=dailyLimit){
      return json(res,429,{error:"Лимит запросов исчерпан. Повтори позже."},cors);
    }
    if(!String(req.headers["content-type"]||"").startsWith("application/json")){
      return json(res,415,{error:"Требуется JSON."},cors);
    }
    const suppliedLength=Number(req.headers["content-length"]);
    if(Number.isFinite(suppliedLength)&&suppliedLength>MAX_BODY_BYTES){
      return json(res,413,{error:"Фото слишком большое."},cors);
    }
    try{
      const body=await fromJson(req);
      if(req.url==="/api/coach"){
        validateChatPayload(body);
      }else if(!body||typeof body!=="object"||Array.isArray(body)||
         body.consent!==true||typeof body.image_data_url!=="string"){
        return json(res,400,{error:"Нужно явно подтвердить отправку фото."},cors);
      }
      // Count accepted requests before the provider call; failed provider calls
      // still consume the daily budget to avoid repeated billing attempts.
      recent.push(current);minutePerClient.set(source,recent);dailyUsed++;
      const result=req.url==="/api/coach" ? await askOpenAI({
        payload:body,apiKey:env.OPENAI_API_KEY,model:env.AI_MODEL,fetchImpl
      }) : await analyzeMealPhoto({
        imageDataUrl:body.image_data_url,
        apiKey:env.OPENAI_API_KEY,model:env.AI_MODEL,fetchImpl
      });
      return json(res,200,result,cors);
    }catch(e){
      const status=[400,413,429,502,503,504].includes(e.status)?e.status:500;
      return json(res,status,{error:status===500?"Не удалось обработать запрос.":e.message},cors);
    }
  };
}

export function createApiServer(options){
  return http.createServer(createApiHandler(options));
}

if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1]){
  const port=Number(process.env.PORT)||8787;
  const server=createApiServer();
  server.listen(port,()=>{
    // No request contents, tokens or IP addresses are logged.
    console.log("Meal photo API listening on port "+port+
      "; configured="+configured(process.env));
  });
}
