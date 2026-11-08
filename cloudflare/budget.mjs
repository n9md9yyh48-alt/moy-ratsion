/* Persistent per-month conservative budget ledger.
   Stores only counters and opaque request IDs, never chat text or photos.
   SQLite-backed Durable Object KV storage is used on Cloudflare Free. */
export const MONTHLY_LIMIT_MICROUSD=5_000_000;
const RESERVE={photo:50_000,chat:20_000}; // $0.05 and $0.02; refunded after measured usage
export function monthKey(t=Date.now()){return new Date(t).toISOString().slice(0,7);}
export function dayKey(t=Date.now()){return new Date(t).toISOString().slice(0,10);}
export function estimatedCharge(usage){
  if(!usage || !Number.isFinite(usage.input_tokens) || !Number.isFinite(usage.output_tokens) ||
    usage.input_tokens<0||usage.output_tokens<0)return null;
  // GPT-6.1 Terra Standard: $1/M input + $5/M output.
  // Cost in millionths of a USD. Add 30% contingency and round up.
  return Math.ceil((usage.input_tokens+5*usage.output_tokens)*1.3);
}
export class BudgetLedger {
  constructor(state){this.state=state;}
  async request(action,payload={},at=Date.now()){
    const month=monthKey(at),day=dayKey(at);
    if(action==="reserve"){
      const kind=payload.kind;
      if(!["photo","chat"].includes(kind)||typeof payload.id!=="string"||
        !/^[0-9a-f-]{36}$/i.test(payload.id))return {ok:false,status:400,error:"Неверные параметры."};
      return await this.state.storage.transaction(async tx=>{
        const key="budget:"+month;
        const row=await tx.get(key)||{spent:0,held:0,pending:{},days:{}};
        const slot=row.days[day]||{count:0,history:[]};
        const minute=slot.history.filter(t=>t>at-60_000);
        if(slot.count>=20||minute.length>=3)return {ok:false,status:429,error:"Дневной или минутный лимит достигнут."};
        const hold=RESERVE[kind];
        if(row.spent+row.held+hold>MONTHLY_LIMIT_MICROUSD){
          return {ok:false,status:402,error:"Месячный лимит $5 достигнут. Новые запросы отключены."};
        }
        if(row.pending[payload.id])return {ok:false,status:409,error:"Повторный запрос."};
        row.pending[payload.id]={hold,kind,day};
        row.held+=hold;
        slot.count++;
        slot.history=minute.concat(at);
        row.days[day]=slot;
        await tx.put(key,row);
        return {ok:true,month,reserved:hold,remaining:Math.max(0,MONTHLY_LIMIT_MICROUSD-row.spent-row.held)};
      });
    }
    if(action==="settle"){
      if(typeof payload.id!=="string"||!payload.id||!/^\d{4}-\d{2}$/.test(String(payload.month||"")))return {ok:false,status:400};
      return await this.state.storage.transaction(async tx=>{
        const key="budget:"+payload.month;
        const row=await tx.get(key);
        if(!row||!row.pending[payload.id])return {ok:false,status:404};
        const hold=row.pending[payload.id].hold;
        // If provider didn't supply trustworthy usage, keep the full hold.
        const charge=estimatedCharge(payload.usage);
        row.held-=hold;
        row.spent+=charge===null ? hold : Math.max(0,charge);
        delete row.pending[payload.id];
        await tx.put(key,row);
        return {ok:true,spent_micro_usd:row.spent,remaining_micro_usd:Math.max(0,MONTHLY_LIMIT_MICROUSD-row.spent-row.held)};
      });
    }
    if(action==="status"){
      const row=await this.state.storage.get("budget:"+month)||{spent:0,held:0};
      return {ok:true,month,limit_usd:5,estimated_spend_usd:row.spent/1_000_000,
        reserved_usd:row.held/1_000_000,remaining_usd:Math.max(0,MONTHLY_LIMIT_MICROUSD-row.spent-row.held)/1_000_000};
    }
    return {ok:false,status:404,error:"Неизвестный запрос."};
  }
  async fetch(request){
    const url=new URL(request.url);
    if(request.method!=="POST")return Response.json({ok:false},{status:405});
    let data;
    try{data=await request.json();}catch(_){return Response.json({ok:false},{status:400});}
    const result=await this.request(url.pathname.slice(1),data);
    return Response.json(result,{status:result.ok?200:result.status||500});
  }
}
