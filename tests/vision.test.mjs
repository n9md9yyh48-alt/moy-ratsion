import test from "node:test";
import assert from "node:assert/strict";
import {once} from "node:events";
import {createApiServer} from "../server/http.mjs";
import {validateImageDataUrl,normalizeEstimate,buildVisionRequest} from "../server/vision.mjs";

const JPEG = "data:image/jpeg;base64,"+Buffer.from([0xff,0xd8,0xff,0xdb,0,0,0,0]).toString("base64");
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Kp8AAAAASUVORK5CYII=";
const TEST_ENV = {
  AI_ACCESS_TOKEN:"a".repeat(48),
  OPENAI_API_KEY:"mock-only-no-real-api-key",
  AI_MODEL:"gpt-4.1-mini",
  AI_ALLOWED_ORIGIN:"http://localhost:39999",
  AI_DAILY_LIMIT:"2"
};
const estimate={recognized:true,dish_name:"Рис с курицей",portion_min_g:180,portion_max_g:330,
  kcal_min:300,kcal_max:640,protein_min_g:20,protein_max_g:52,
  fat_min_g:3,fat_max_g:32,carbs_min_g:25,carbs_max_g:80,
  confidence:"low",notes:"Количество масла и вес блюда по фотографии не определяются."};
async function withServer(options,callback){
  const server=createApiServer(options);
  server.listen(0,"127.0.0.1");
  await once(server,"listening");
  try{
    await callback("http://127.0.0.1:"+server.address().port);
  } finally {
    await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
  }
}
const successProvider = async (_url,options)=>{
  assert.ok(options.headers.Authorization.startsWith("Bearer "));
  const payload=JSON.parse(options.body);
  assert.equal(payload.store,false);
  assert.equal(payload.text.format.type,"json_schema");
  assert.equal(payload.text.format.strict,true);
  assert.equal(payload.input[0].content[1].type,"input_image");
  return {ok:true,status:200,json:async()=>({
    status:"completed",
    output:[{type:"message",content:[{type:"output_text",text:JSON.stringify(estimate)}]}]
  })};
};
async function post(endpoint,body,{token=TEST_ENV.AI_ACCESS_TOKEN,origin=TEST_ENV.AI_ALLOWED_ORIGIN}={}){
  return fetch(endpoint+"/api/analyze-meal",{
    method:"POST",
    headers:{"Content-Type":"application/json",Authorization:"Bearer "+token,Origin:origin},
    body:JSON.stringify(body)
  });
}
test("binary magic bytes are checked and remote image URLs are blocked",()=>{
  assert.equal(validateImageDataUrl(JPEG).mime,"image/jpeg");
  assert.equal(validateImageDataUrl(PNG).mime,"image/png");
  assert.throws(()=>validateImageDataUrl("https://example.com/meal.jpg"),/JPEG, PNG/);
  assert.throws(()=>validateImageDataUrl("data:image/jpeg;base64,"+Buffer.from("<svg>").toString("base64")),/Формат/);
  assert.throws(()=>validateImageDataUrl("data:image/svg+xml;base64,AAAA"),/JPEG, PNG/);
});
test("vision provider schema avoids false precision and keeps image in direct request",()=>{
  const request=buildVisionRequest({dataUrl:PNG,model:"gpt-4.1-mini"});
  assert.equal(request.input[0].content[1].image_url,PNG);
  assert.equal(request.input[0].content[1].detail,"low");
  assert.equal(request.text.format.schema.additionalProperties,false);
  assert.equal(normalizeEstimate(estimate).estimated_only,true);
  assert.equal(normalizeEstimate(estimate).requires_confirmation,true);
});
test("impossible ranges and unrecognized image results are normalized",()=>{
  assert.throws(()=>normalizeEstimate({...estimate,kcal_min:800,kcal_max:200}),/диапазон/);
  const noFood=normalizeEstimate({...estimate,recognized:false});
  assert.equal(noFood.kcal_max,0);
  assert.equal(noFood.dish_name,"");
  assert.equal(noFood.confidence,"low");
});
test("server remains disabled without private secrets",async()=>{
  await withServer({env:{AI_ALLOWED_ORIGIN:TEST_ENV.AI_ALLOWED_ORIGIN},fetchImpl:()=>{throw Error("MUST_NOT_BE_CALLED")}},async endpoint=>{
    const health=await fetch(endpoint+"/health");
    assert.equal((await health.json()).ready,false);
    const response=await post(endpoint,{consent:true,image_data_url:PNG});
    assert.equal(response.status,503);
  });
});
test("private token and exact trusted origin are required",async()=>{
  await withServer({env:TEST_ENV,fetchImpl:successProvider},async endpoint=>{
    assert.equal((await post(endpoint,{consent:true,image_data_url:PNG},{token:"incorrect"})).status,401);
    assert.equal((await post(endpoint,{consent:true,image_data_url:PNG},{origin:"https://evil.example"})).status,403);
    const result=await fetch(endpoint+"/api/analyze-meal",{
      method:"OPTIONS",headers:{Origin:TEST_ENV.AI_ALLOWED_ORIGIN}
    });
    assert.equal(result.status,204);
    assert.equal(result.headers.get("access-control-allow-origin"),TEST_ENV.AI_ALLOWED_ORIGIN);
  });
});
test("consent is required; invalid images are refused before contacting provider",async()=>{
  let calls=0;
  const wrapped=async(...args)=>{calls++;return successProvider(...args)};
  await withServer({env:TEST_ENV,fetchImpl:wrapped},async endpoint=>{
    assert.equal((await post(endpoint,{consent:false,image_data_url:PNG})).status,400);
    assert.equal((await post(endpoint,{consent:true,image_data_url:"https://example.com/me.jpg"})).status,400);
    assert.equal(calls,0);
  });
});
test("valid photo is analyzed with confirmation required and server-side daily cap",async()=>{
  let calls=0;
  const wrapped=async(...args)=>{calls++;return successProvider(...args)};
  await withServer({env:TEST_ENV,fetchImpl:wrapped},async endpoint=>{
    const first=await post(endpoint,{consent:true,image_data_url:PNG});
    assert.equal(first.status,200);
    assert.equal(first.headers.get("cache-control"),"no-store");
    assert.equal(first.headers.get("access-control-allow-origin"),TEST_ENV.AI_ALLOWED_ORIGIN);
    const result=await first.json();
    assert.equal(result.dish_name,"Рис с курицей");
    assert.equal(result.requires_confirmation,true);
    assert.equal(result.estimated_only,true);
    assert.equal(result.kcal_min,300);
    assert.equal((await post(endpoint,{consent:true,image_data_url:JPEG})).status,200);
    assert.equal((await post(endpoint,{consent:true,image_data_url:PNG})).status,429);
    assert.equal(calls,2);
  });
});
test("upstream failure is sanitized rather than leaking provider output",async()=>{
  await withServer({env:TEST_ENV,fetchImpl:async()=>({ok:false,status:401})},async endpoint=>{
    const response=await post(endpoint,{consent:true,image_data_url:PNG});
    assert.equal(response.status,502);
    const info=await response.json();
    assert.doesNotMatch(JSON.stringify(info),/mock-only|a{20}/);
  });
});
