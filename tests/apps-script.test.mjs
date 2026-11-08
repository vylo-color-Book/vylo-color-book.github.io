import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createHmac} from 'node:crypto';
import {validateOrder} from '../orders.mjs';

const code=await fs.readFile(new URL('../apps-script/Code.gs',import.meta.url),'utf8');
function context(){
  const ctx=vm.createContext({Date,Number,JSON,Object,String,Math,Array,
    PropertiesService:{getScriptProperties:()=>({getProperty:key=>key==='BRIDGE_SECRET'?'unit-test-bridge-secret':null})},
    Utilities:{Charset:{UTF_8:'UTF_8'},computeHmacSha256Signature:(data,secret)=>[...createHmac('sha256',secret).update(data).digest()].map(b=>b>127?b-256:b)}
  });vm.runInContext(code,ctx);return ctx;
}
test('Apps Script verifies the backend HMAC and rejects expired or tampered requests',()=>{
  const c=context(),e={timestamp:Date.now(),nonce:'a'.repeat(32),body:JSON.stringify({action:'createOrder',orderId:'VY-ABCDEF123456'})};
  e.signature=createHmac('sha256','unit-test-bridge-secret').update(`${e.timestamp}.${e.nonce}.${e.body}`).digest('hex');
  assert.doesNotThrow(()=>c.verifyVyloSignature_(e));
  assert.throws(()=>c.verifyVyloSignature_({...e,body:e.body+' '}));
  assert.throws(()=>c.verifyVyloSignature_({...e,timestamp:e.timestamp-600000}));
  assert.throws(()=>c.verifyVyloSignature_({...e,signature:'0'.repeat(64)}));
});
test('Apps Script enforces the current 24-page catalog, formula calculations and literal user text',()=>{
  const c=context();let values;
  const sheet={getLastRow:()=>1,getRange:()=>({setNumberFormat(){return this;},setValues(v){values=v;return this;}})};
  const order=validateOrder({packageId:'bundle',parentName:'=اختبار',phone:'01000000000',children:['طفل أول','طفل ثاني','طفل هدية'],governorate:'القاهرة',address:'عنوان للاختبار التقني فقط',notes:'=HYPERLINK("https://example.test")'});
  c.createVyloOrder_(sheet,{orderId:'VY-ABCDEF123456',order},0);
  const row=values[0];assert.equal(row[10],698);assert.equal(row[11],70);assert.equal(row[12],'=SUM(K2:L2)');assert.equal(row[13],0);assert.equal(row[14],'=M2-N2');assert.ok(row[2].startsWith("'="));assert.ok(row[18].startsWith("'="));
  assert.throws(()=>c.createVyloOrder_(sheet,{orderId:'VY-ABCDEF123456',order:{...order,packageId:'book12',price:249,total:319}},0));
  assert.throws(()=>c.createVyloOrder_(sheet,{orderId:'VY-ABCDEF123456',order:{...order,price:1,total:71}},0));
});
