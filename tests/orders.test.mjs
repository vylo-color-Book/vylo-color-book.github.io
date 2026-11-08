import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';
import { validateOrder, receipt } from '../orders.mjs';
import { normalizePhone, GOVERNORATES } from '../public/catalog.js';

const sample = (packageId='book24') => ({packageId,parentName:'اختبار تقني',phone:'01000000000',children:packageId==='bundle'?['طفل أول','طفل ثاني','طفل هدية']:['طفل تجريبي'],governorate:'القاهرة',address:'عنوان تجريبي فقط، لا يتم الشحن',notes:'اختبار فقط',website:''});
async function app(t, fetcher, config={}) {
  const server=createApp({token:'TEST_ONLY_NOT_A_REAL_TOKEN',chatId:'6405303283',databasePath:':memory:',requireSheets:false,...config},{fetcher});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}
const request=(base,payload,key='12345678-1234-1234-1234-123456789012')=>fetch(base+'/api/orders',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(payload)});
const accepted = () => new Response(JSON.stringify({ok:true,result:{message_id:101}}),{status:200,headers:{'Content-Type':'application/json'}});

test('all prices, shipping and deposit are computed server-side, ignoring tampered client totals',()=>{
  for(const [id,price,total,remaining] of [['book24',349,419,319],['bundle',698,768,668]]){
    const order=validateOrder({...sample(id),price:1,total:1,shipping:0,deposit:0});
    assert.equal(order.price,price);assert.equal(order.total,total);assert.equal(order.deposit,100);assert.equal(order.remaining,remaining);
  }
  assert.equal(GOVERNORATES.length,27);
});
test('Egyptian phone normalization supports Arabic digits and country codes',()=>{
  for(const n of ['٠١٢٧٠٣٦٦٨٧٤','۰۱۲۷۰۳۶۶۸۷۴','01270366874','+20 12 70366874','00201270366874'])assert.equal(normalizePhone(n),'01270366874');
  for(const n of ['123','011111111111','015abcd1234','01912345678'])assert.equal(normalizePhone(n),null);
});
test('reject missing child names, malformed names, invalid packages and governorates',()=>{
  for(const payload of [{...sample(),children:[]},{...sample('bundle'),children:['طفل واحد']},{...sample(),parentName:'   '},{...sample(),packageId:'toString'},{...sample(),governorate:'محافظة وهمية'},{...sample(),address:'شارع'},{...sample(),website:'spam'}])assert.throws(()=>validateOrder(payload));
});
test('WhatsApp receipt has the correct destination, order ID and unpaid deposit',()=>{
  const r=receipt(validateOrder(sample('bundle')),'VY-TEST');const u=new URL(r.whatsappUrl);
  assert.equal(u.host,'wa.me');assert.equal(u.pathname,'/201270366874');
  const text=u.searchParams.get('text');for(const s of ['VY-TEST','768','طفل هدية','مستعد لإرسال صور الطفل وتحويل الديبوزيت.'])assert.ok(text.includes(s));
  assert.doesNotMatch(text,/ديبوزيت[^\n]*100|100[^\n]*ديبوزيت/);assert.ok(!text.includes('لسه ما اتحوّلش'));
});
test('successful request reaches configured Telegram destination once, retry returns same receipt',async t=>{
  let calls=0;let sent;
  const base=await app(t,async(url,opts)=>{calls++;assert.ok(url.endsWith('/sendMessage'));sent=JSON.parse(opts.body);return accepted();});
  const first=await request(base,sample('bundle'));assert.equal(first.status,201);const r1=await first.json();assert.equal(r1.total,768);
  assert.equal(sent.chat_id,'6405303283');assert.ok(sent.text.includes('غير مدفوع'));assert.ok(sent.text.includes('طفل هدية'));
  assert.equal(sent.reply_markup.inline_keyboard[0][0].callback_data,'deposit:'+r1.orderId);
  assert.equal(sent.reply_markup.inline_keyboard[1][0].url,'https://wa.me/201000000000');
  const retry=await request(base,sample('bundle'));assert.equal(retry.status,200);assert.deepEqual(await retry.json(),r1);assert.equal(calls,1);
  const conflict=await request(base,sample('book24'));assert.equal(conflict.status,409);assert.equal(calls,1);
});
test('Telegram rejection never produces success or WhatsApp redirect; retry can succeed',async t=>{
  let calls=0;const base=await app(t,async()=>++calls===1?new Response(JSON.stringify({ok:false}),{status:403}):accepted());
  const fail=await request(base,sample());assert.equal(fail.status,502);const error=await fail.json();assert.equal(error.ok,false);assert.equal(error.whatsappUrl,undefined);
  const success=await request(base,sample());assert.equal(success.status,201);assert.equal(calls,2);
});
test('ambiguous network failure is held for review and never resent automatically',async t=>{
  let calls=0;const base=await app(t,async()=>{calls++;throw new Error('network');});
  assert.equal((await request(base,sample())).status,504);
  assert.equal((await request(base,sample())).status,409);assert.equal(calls,1);
});
test('concurrent duplicate attempts do not send duplicate messages',async t=>{
  let release;let started;const wait=new Promise(r=>release=r);const ready=new Promise(r=>started=r);let calls=0;
  const base=await app(t,async()=>{calls++;started();await wait;return accepted();});
  const first=request(base,sample());await ready;
  try {assert.equal((await request(base,sample())).status,409);}finally{release();}
  assert.equal((await first).status,201);assert.equal(calls,1);
});
test('missing runtime secrets, bad payloads and untrusted origins fail safely',async t=>{
  let calls=0;const base=await app(t,async()=>{calls++;return accepted();},{token:''});
  assert.equal((await request(base,sample())).status,503);
  const bad=await fetch(base+'/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:'broken'});assert.equal(bad.status,400);
  const cross=await fetch(base+'/api/orders',{method:'POST',headers:{Origin:'https://other.example','Content-Type':'application/json'},body:'{}'});assert.equal(cross.status,403);
  assert.equal(calls,0);
});
test('static server exposes public assets only and supports video range playback',async t=>{
  const base=await app(t,async()=>accepted());
  for(const file of ['/server.mjs','/.env','/.data/orders.sqlite','/package.json','/orders.mjs'])assert.equal((await fetch(base+file)).status,404);
  const home=await fetch(base+'/');assert.equal(home.status,200);assert.ok((await home.text()).includes('بطل الحكاية'));
  const video=await fetch(base+'/assets/product.mp4',{headers:{Range:'bytes=0-99'}});assert.equal(video.status,206);assert.equal((await video.arrayBuffer()).byteLength,100);
  const noRange=await fetch(base+'/assets/product.mp4',{headers:{Range:'bytes=999999999-'}});assert.equal(noRange.status,416);
});
