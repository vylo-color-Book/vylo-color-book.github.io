import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { SheetsBridge, deriveBridgeSecret } from '../sheets.mjs';
import { DepositBot, parsePaid } from '../bot.mjs';
import { initializeStore } from '../store.mjs';
import { createApp } from '../server.mjs';
import { OrderError, validateOrder } from '../orders.mjs';

const id='VY-ABCDEF123456';
test('bridge key derivation is project-specific and never returns the bot token',()=>{
  const token='TEST_ONLY_NOT_A_REAL_TOKEN';const a=deriveBridgeSecret(token,'project-a'),b=deriveBridgeSecret(token,'project-b');
  assert.match(a,/^[a-f0-9]{64}$/);assert.notEqual(a,b);assert.notEqual(a,token);assert.equal(deriveBridgeSecret(token,'project-a'),a);assert.equal(deriveBridgeSecret(''),undefined);
});
const order=validateOrder({parentName:'اختبار',phone:'01000000000',packageId:'book24',children:['طفل اختبار'],governorate:'القاهرة',address:'عنوان للاختبار فقط، لا تشحن',notes:'اختبار'});
function fixture(t,bridgeOverride){
  const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE orders (request_key TEXT PRIMARY KEY, fingerprint TEXT, order_id TEXT, state TEXT, message_id TEXT, created_at TEXT)');
  const store=initializeStore(db);db.prepare('INSERT INTO orders (request_key,order_id,state,message_id,payload) VALUES (?,?,?,?,?)').run('test-key',id,'sent','77',JSON.stringify(order));t.after(()=>db.close());
  const calls=[],writes=[];
  const sheets=bridgeOverride||{async recordDeposit(orderId,amount,eventId){writes.push({orderId,amount,eventId});return{ok:true,paid:amount,remaining:Math.round((419-amount)*100)/100};}};
  const bot=new DepositBot({token:'FAKE_TEST_TOKEN',chatId:'6405303283',adminId:'6405303283'},store,sheets,async(url,options)=>{
    const method=url.split('/').at(-1),payload=JSON.parse(options.body);calls.push({method,payload});return new Response(JSON.stringify({ok:true,result:method==='sendMessage'?{message_id:88}:true}));
  });
  return{db,store,bot,calls,writes};
}
const callback=(user=6405303283)=>({update_id:1,callback_query:{id:'callback1',from:{id:user},data:'deposit:'+id,message:{message_id:77,chat:{id:6405303283}}}});
const reply=(text='١٠٠',update=2)=>({update_id:update,message:{message_id:89,from:{id:6405303283},chat:{id:6405303283},reply_to_message:{message_id:88},text}});

test('deposit amount accepts Arabic digits and exact cents, rejects overpayment and malformed input',()=>{
  assert.equal(parsePaid('١٠٠',419),100);assert.equal(parsePaid('۱۰۰٫۵۰',419),100.5);assert.equal(parsePaid('319',319),319);
  for(const value of ['0','-1','420','100.001','1e2','hello','100 جنيه'])assert.throws(()=>parsePaid(value,419));
});
test('only the authorized admin and exact order message can open a deposit prompt',async t=>{
  const f=fixture(t);await f.bot.handle(callback(123));assert.equal(f.calls.length,0);
  const wrong=callback();wrong.callback_query.message.message_id=10;await f.bot.handle(wrong);assert.equal(f.calls.length,0);
  await f.bot.handle(callback());assert.equal(f.calls[0].method,'answerCallbackQuery');assert.equal(f.calls[1].payload.reply_markup.force_reply,true);
  assert.equal(f.store.getPrompt('88').order_id,id);assert.ok(f.calls[1].payload.text.includes('هيحل محل'));
});
test('replying to the correct prompt records actual paid amount and balance before success',async t=>{
  const f=fixture(t);await f.bot.handle(callback());await f.bot.handle(reply());
  assert.deepEqual(f.writes,[{orderId:id,amount:100,eventId:'telegram-2'}]);assert.equal(f.store.getOrder(id).paid,100);assert.equal(f.store.getPrompt('88'),undefined);
  const done=f.calls.find(c=>c.method==='sendMessage'&&c.payload.text.startsWith('✅'));assert.ok(done.payload.text.includes('319 جنيه'));assert.ok(done.payload.text.includes('Google Sheets'));
  const edited=f.calls.find(c=>c.method==='editMessageText');assert.ok(edited.payload.text.includes('الإجمالي: 419 جنيه'));assert.ok(edited.payload.text.includes('المدفوع المسجل: 100 جنيه'));assert.ok(edited.payload.text.includes('الباقي: 319 جنيه'));assert.equal(edited.payload.text.includes('غير مدفوع'),false);assert.equal(edited.payload.text.includes('undefined'),false);
  await f.bot.handle(reply());assert.equal(f.writes.length,1);
});
test('a failed sheet write never changes paid balance or sends confirmation',async t=>{
  const f=fixture(t,{async recordDeposit(){throw new OrderError('تعذر التسجيل في الشيت.',503);}});
  await f.bot.handle(callback());await f.bot.handle(reply());assert.equal(f.store.getOrder(id).paid,0);assert.ok(f.store.getPrompt('88'));
  assert.equal(f.calls.some(c=>c.method==='sendMessage'&&c.payload.text.startsWith('✅')),false);
});
test('a reply to a different order prompt and invalid amounts cannot record a payment',async t=>{
  const f=fixture(t);await f.bot.handle(callback());const wrong=reply();wrong.message.reply_to_message.message_id=999;await f.bot.handle(wrong);await f.bot.handle(reply('999'));
  assert.equal(f.writes.length,0);assert.equal(f.store.getOrder(id).paid,0);
});
test('cancel closes the prompt without changing order amounts',async t=>{
  const f=fixture(t);await f.bot.handle(callback());await f.bot.handle(reply('/cancel'));assert.equal(f.writes.length,0);assert.equal(f.store.getPrompt('88'),undefined);
});
test('bridge signs the exact action payload and only accepts acknowledged responses',async()=>{
  const bridge=new SheetsBridge({sheetsUrl:'https://script.google.com/macros/s/test/exec',sheetsSecret:'test-secret'},async(url,options)=>{
    const e=JSON.parse(options.body);const expected=createHmac('sha256','test-secret').update(`${e.timestamp}.${e.nonce}.${e.body}`).digest('hex');assert.equal(e.signature,expected);
    assert.deepEqual(JSON.parse(e.body),{action:'recordDeposit',orderId:id,amount:100,eventId:'telegram-2'});return new Response(JSON.stringify({ok:true,paid:100,remaining:319}));
  });
  assert.equal((await bridge.recordDeposit(id,100,'telegram-2')).remaining,319);
  const fail=new SheetsBridge({sheetsUrl:'https://example.test',sheetsSecret:'test-secret'},async()=>new Response('not json'));await assert.rejects(()=>fail.createOrder(order,id));
});
test('sheet synchronization retry after Telegram delivery never sends a second order message',async t=>{
  let telegram=0,creates=0,attaches=0;
  const sheets={configured:true,async createOrder(){creates++;return{ok:true};},async attachMessage(){if(++attaches===1)throw new OrderError('retry',503);return{ok:true};}};
  const server=createApp({token:'FAKE',chatId:'6405303283',databasePath:':memory:'},{sheetAdapter:sheets,fetcher:async()=>{telegram++;return new Response(JSON.stringify({ok:true,result:{message_id:77}}));}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const send=()=>fetch(`http://127.0.0.1:${server.address().port}/api/orders`,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'12345678-1234-1234-1234-123456789012'},body:JSON.stringify(order)});
  assert.equal((await send()).status,503);assert.equal((await send()).status,201);assert.equal(telegram,1);assert.equal(creates,1);assert.equal(attaches,2);
});
test('orders cannot succeed when Google Sheets has not been activated',async t=>{
  const server=createApp({token:'FAKE',chatId:'6405303283',databasePath:':memory:'});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const r=await fetch(`http://127.0.0.1:${server.address().port}/api/orders`,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'12345678-1234-1234-1234-123456789012'},body:JSON.stringify(order)});assert.equal(r.status,503);assert.equal((await r.json()).ok,false);
});
