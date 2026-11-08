const PACKAGES = Object.freeze({
  book24: { label: 'كتاب 24 صفحة', price: 349, children: ['اسم الطفل'] },
  bundle: { label: 'كتابين 24 صفحة + كتاب 24 صفحة هدية', price: 698, children: ['اسم الطفل للكتاب الأول — 24 صفحة', 'اسم الطفل للكتاب الثاني — 24 صفحة', 'اسم الطفل لكتاب الهدية — 24 صفحة'] }
});
const SHIPPING = 70;
const DEPOSIT = 100;
const WHATSAPP = '201270366874';
const GOVERNORATES = Object.freeze(['القاهرة','الجيزة','الإسكندرية','القليوبية','المنوفية','الشرقية','الغربية','الدقهلية','البحيرة','كفر الشيخ','دمياط','بورسعيد','الإسماعيلية','السويس','مطروح','الفيوم','بني سويف','المنيا','أسيوط','سوهاج','قنا','الأقصر','أسوان','البحر الأحمر','الوادي الجديد','شمال سيناء','جنوب سيناء']);
function normalizePhone(value) {
  let n = String(value ?? '').replace(/[٠-٩]/g, c => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/[۰-۹]/g, c => '۰۱۲۳۴۵۶۷۸۹'.indexOf(c)).replace(/[\s()+-]/g, '');
  if (n.startsWith('0020')) n = n.slice(4);
  else if (n.startsWith('20')) n = n.slice(2);
  if (/^1[0125]\d{8}$/.test(n)) n = '0' + n;
  return /^01[0125]\d{8}$/.test(n) ? n : null;
}

class OrderError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
function clean(value, min, max, label) {
  if (typeof value !== 'string') throw new OrderError(`راجع ${label}.`);
  const s = value.trim().replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ');
  if (s.length < min || s.length > max) throw new OrderError(`راجع ${label}.`);
  return s;
}
function validateOrder(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new OrderError('بيانات الطلب غير صحيحة.');
  if (input.website) throw new OrderError('تعذر تسجيل الطلب.');
  if (!Object.hasOwn(PACKAGES, input.packageId)) throw new OrderError('اختار نوع الكتاب.');
  const p = PACKAGES[input.packageId];
  if (!Array.isArray(input.children) || input.children.length !== p.children.length) throw new OrderError('اكتب اسم الطفل لكل كتاب في الطلب.');
  const phone = normalizePhone(input.phone);
  if (!phone) throw new OrderError('اكتب رقم موبايل مصري صحيح.');
  if (!GOVERNORATES.includes(input.governorate)) throw new OrderError('اختار المحافظة من القائمة.');
  return {
    parentName:clean(input.parentName,2,80,'اسم ولي الأمر'),
    phone,children:input.children.map(n=>clean(n,2,50,'اسم الطفل')),
    governorate:input.governorate,address:clean(input.address,10,300,'العنوان بالتفصيل'),
    notes:clean(input.notes ?? '',0,400,'الملاحظات'),packageId:input.packageId,
    packageLabel:p.label,price:p.price,shipping:SHIPPING,total:p.price+SHIPPING,
    deposit:DEPOSIT,remaining:p.price+SHIPPING-DEPOSIT
  };
}

function orderMessage(order, id, test = false, paid = null) {
  const children = order.children.map((name,i) => `${PACKAGES[order.packageId].children[i]}: ${name}`).join('\n');
  const payment = paid === null ? `الديبوزيت المطلوب: ${order.deposit} جنيه — غير مدفوع\nالباقي بعد دفعه: ${order.remaining} جنيه` : `المدفوع المسجل: ${paid} جنيه\nالباقي: ${Math.round((order.total-paid)*100)/100} جنيه`;
  const state=paid===null?'جديد — في انتظار التواصل على واتساب والصور والديبوزيت':'تم التأكيد — تم تسجيل المدفوع في Google Sheets';
  return `${test ? '🧪 اختبار تقني فقط — ليس طلب شراء\n\n' : ''}🎨 طلب VYLO\nرقم الطلب: ${id}\n\nاسم ولي الأمر: ${order.parentName}\n${children}\nرقم التليفون: ${order.phone}\nالمحافظة: ${order.governorate}\nالعنوان: ${order.address}\n\nالباقة: ${order.packageLabel}\nقيمة الكتب: ${order.price} جنيه\nالشحن: ${order.shipping} جنيه\nالإجمالي: ${order.total} جنيه\n${payment}\n\nالملاحظات: ${order.notes || 'لا يوجد'}\nالحالة: ${state}`;
}
function receipt(order, id) {
  const children = order.children.map((n,i)=>`${PACKAGES[order.packageId].children[i]}: ${n}`).join('\n');
  const text = `أهلًا VYLO 🎨\nسجّلت طلب وعايز أكمل التفاصيل.\nرقم الطلب: ${id}\n\nاسم ولي الأمر: ${order.parentName}\n${children}\nالتليفون: ${order.phone}\nالمحافظة: ${order.governorate}\nالعنوان: ${order.address}\nالباقة: ${order.packageLabel}\nالكتب: ${order.price} جنيه\nالشحن: ${order.shipping} جنيه\nالإجمالي: ${order.total} جنيه\nالديبوزيت: ${order.deposit} جنيه من الإجمالي، لسه ما اتحوّلش\nالباقي بعد تحويله: ${order.remaining} جنيه\n${order.notes ? 'ملاحظاتي: '+order.notes+'\n' : ''}\nجاهز أبعت صور الطفل وأعرف تفاصيل تحويل الديبوزيت.`;
  return {ok:true,orderId:id,total:order.total,deposit:order.deposit,remaining:order.remaining,whatsappUrl:`https://wa.me/${WHATSAPP}?text=${encodeURIComponent(text)}`};
}

const VYLO_ORIGIN='https://ahmednasser667748-cyber.github.io';
function publicTelegram_(method,body){
 const token=PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
 if(!token)throw new Error('Bot configuration missing');
 const r=UrlFetchApp.fetch('https://api.telegram.org/bot'+token+'/'+method,{method:'post',contentType:'application/json',payload:JSON.stringify(body),muteHttpExceptions:true});
 const d=JSON.parse(r.getContentText());if(!d.ok)throw new Error('Telegram operation failed');return d.result;
}
function publicKeyboard_(id,phone,paid){return{inline_keyboard:[[{text:paid?'✅ مدفوع '+paid+' جنيه — تعديل المبلغ':'💰 تأكيد ودفع ديبوزيت',callback_data:'deposit:'+id}],[{text:'💬 التواصل مع ولي الأمر',url:'https://wa.me/20'+phone.slice(1)}]]};}
function doPost(e){
 if(e.parameter&&e.parameter.telegram){
  const props=PropertiesService.getScriptProperties(),secret=props.getProperty('BRIDGE_SECRET');
  if(!secret||e.parameter.telegram!==secret)return vyloJson_({ok:false});
  const lock=LockService.getScriptLock();lock.waitLock(25000);
  try{const u=JSON.parse(e.postData.contents);const key='WEBHOOK_'+u.update_id;if(!props.getProperty(key)){handlePublicVylo_(u);props.setProperty(key,String(Date.now()));}return vyloJson_({ok:true});}finally{lock.releaseLock();}
 }
 if(!e.parameter||!e.parameter.payload)return signedVyloPost_(e);
 let result={ok:false,message:'تعذر تأكيد تسجيل الطلب. جرّب نفس الطلب أو تواصل معنا على واتساب.'},requestId='';
 const lock=LockService.getScriptLock();
 try{
  if(e.postData.length>14000)throw new Error('Too large');
  const input=JSON.parse(e.parameter.payload);requestId=String(input.requestId||'');
  if(!/^[a-zA-Z0-9-]{16,100}$/.test(requestId))throw new Error('Invalid request');
  const order=validateOrder(input.order);
  const id='VY-'+Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,requestId).slice(0,6).map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join('').toUpperCase();
  lock.waitLock(25000);
  const sheet=vyloWorkbook_().getSheetByName('Orders');let row=findVyloRow_(sheet,id);
  if(row){const saved=sheet.getRange(row,3,1,17).getValues()[0];if(saved[1]!==order.phone||Number(saved[10])!==order.total)throw new Error('Conflict');}
  else row=createVyloOrder_(sheet,{orderId:id,order},0).row;
  let msg=String(sheet.getRange(row,18).getValue()||'');
  if(msg==='sending'||msg==='uncertain')throw new Error('Review required');
  if(!msg){
   sheet.getRange(row,18).setValue('sending');SpreadsheetApp.flush();
   try{const m=publicTelegram_('sendMessage',{chat_id:'6405303283',text:orderMessage(order,id,order.notes.indexOf('VYLO-INTEGRATION-TEST')>=0),reply_markup:publicKeyboard_(id,order.phone,0)});msg=String(m.message_id);sheet.getRange(row,18).setValue(msg);}
   catch(err){sheet.getRange(row,18).setValue('uncertain');throw err;}
  }
  SpreadsheetApp.flush();result=receipt(order,id);
 }catch(err){}finally{if(lock.hasLock())lock.releaseLock();}
 const data=JSON.stringify({source:'vylo-order-result',requestId,result}).replace(/</g,'\\u003c');
 return HtmlService.createHtmlOutput('<!doctype html><script>window.top.postMessage('+data+','+JSON.stringify(VYLO_ORIGIN)+');</script>').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
function setupPublicVylo(){
 const props=PropertiesService.getScriptProperties(),secret=props.getProperty('BRIDGE_SECRET');if(!secret)throw new Error('Bridge secret missing');
 const endpoint='https://script.google.com/macros/s/AKfycbx8HdIcmMzfHlKHe37vep4jEkn-3OpEuT3C-DEP1KVCGkOAOXim-OBTL9-ruuhh1PFYVA/exec?telegram='+secret;
 const hooks=publicTelegram_('getWebhookInfo',{});if(hooks.url&&hooks.url!==endpoint&&hooks.url!==endpoint.replace('/exec?telegram=','/exec/telegram/'))throw new Error('Existing different webhook: setup stopped');
 publicTelegram_('setWebhook',{url:endpoint,allowed_updates:['message','callback_query'],max_connections:1});
}
function publicRowOrder_(sheet,row){const v=sheet.getRange(row,1,1,20).getValues()[0];const bundle=Number(v[10])===698;return{parentName:v[2],phone:String(v[3]),children:bundle?[v[4],v[5],v[6]]:[v[4]],governorate:v[7],address:v[8],packageId:bundle?'bundle':'book24',packageLabel:v[9],price:Number(v[10]),shipping:70,total:Number(v[12]),deposit:100,remaining:Number(v[12])-100,notes:v[18]};}
function pollPublicVylo(){
 const lock=LockService.getScriptLock();if(!lock.tryLock(1000))return;
 try{const props=PropertiesService.getScriptProperties();const updates=publicTelegram_('getUpdates',{offset:Number(props.getProperty('PUBLIC_BOT_OFFSET')||0),timeout:0,limit:30,allowed_updates:['message','callback_query']});
 for(const u of updates){handlePublicVylo_(u);props.setProperty('PUBLIC_BOT_OFFSET',String(u.update_id+1));}
 }finally{lock.releaseLock();}
}
function handlePublicVylo_(u){
 const props=PropertiesService.getScriptProperties(),sheet=vyloWorkbook_().getSheetByName('Orders');
 if(u.callback_query){const c=u.callback_query;if(String(c.from.id)!=='6405303283'||String(c.message.chat.id)!=='6405303283'||!/^deposit:VY-[A-Z0-9]{12}$/.test(c.data||''))return;
 const id=c.data.slice(8),row=findVyloRow_(sheet,id);if(!row||String(sheet.getRange(row,18).getValue())!==String(c.message.message_id))return;
 try{publicTelegram_('answerCallbackQuery',{callback_query_id:c.id});}catch(err){}
 const m=publicTelegram_('sendMessage',{chat_id:'6405303283',reply_parameters:{message_id:c.message.message_id},text:'الطلب '+id+'\nاكتب إجمالي المدفوع حتى الآن، مثل 100. الرقم يستبدل المدفوع السابق ولا يضاف إليه.\nللإلغاء اكتب /cancel.',reply_markup:{force_reply:true,selective:true}});
 props.setProperty('PUBLIC_PROMPT_'+m.message_id,JSON.stringify({id,expires:Date.now()+30*60000}));return;
 }
 const m=u.message;if(!m||String(m.from.id)!=='6405303283'||String(m.chat.id)!=='6405303283'||!m.reply_to_message)return;
 const key='PUBLIC_PROMPT_'+m.reply_to_message.message_id,raw=props.getProperty(key);if(!raw)return;
 const p=JSON.parse(raw);if(p.expires<Date.now()||m.text==='/cancel'){props.deleteProperty(key);return;}
 const row=findVyloRow_(sheet,p.id);if(!row)return;
 const order=publicRowOrder_(sheet,row),text=String(m.text||'').replace(/[٠-٩]/g,c=>'٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/[٫,]/g,'.').trim(),amount=Number(text);
 if(!/^\d+(\.\d{1,2})?$/.test(text)||amount<=0||amount>order.total){publicTelegram_('sendMessage',{chat_id:'6405303283',text:'اكتب مبلغًا أكبر من صفر وحتى '+order.total+' جنيه بالرد على رسالة السؤال.'});return;}
 const paid=recordVyloDeposit_(sheet,{orderId:p.id,amount,eventId:'telegram-'+u.update_id},row);SpreadsheetApp.flush();
 publicTelegram_('editMessageText',{chat_id:'6405303283',message_id:Number(sheet.getRange(row,18).getValue()),text:orderMessage(order,p.id,order.notes.indexOf('VYLO-INTEGRATION-TEST')>=0,paid.paid),reply_markup:publicKeyboard_(p.id,order.phone,paid.paid)});
 publicTelegram_('sendMessage',{chat_id:'6405303283',text:'✅ اتسجل في الشيت\nالطلب '+p.id+'\nالمدفوع '+paid.paid+' جنيه\nالباقي '+paid.remaining+' جنيه'});props.deleteProperty(key);
}
