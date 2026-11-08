import { randomUUID, createHash } from 'node:crypto';
import { PACKAGES, SHIPPING, DEPOSIT, GOVERNORATES, WHATSAPP, normalizePhone } from './public/catalog.js';

export class OrderError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
function clean(value, min, max, label) {
  if (typeof value !== 'string') throw new OrderError(`راجع ${label}.`);
  const s = value.trim().replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ');
  if (s.length < min || s.length > max) throw new OrderError(`راجع ${label}.`);
  return s;
}
export function validateOrder(input) {
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
export const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function orderId() { return 'VY-' + randomUUID().replaceAll('-','').slice(0,12).toUpperCase(); }
export function orderMessage(order, id, test = false, paid = null) {
  const children = order.children.map((name,i) => `${PACKAGES[order.packageId].children[i]}: ${name}`).join('\n');
  const payment = paid === null ? `الديبوزيت المطلوب: ${order.deposit} جنيه — غير مدفوع\nالباقي بعد دفعه: ${order.remaining} جنيه` : `المدفوع المسجل: ${paid} جنيه\nالباقي: ${Math.round((order.total-paid)*100)/100} جنيه`;
  const state=paid===null?'جديد — في انتظار التواصل على واتساب والصور والديبوزيت':'تم التأكيد — تم تسجيل المدفوع في Google Sheets';
  return `${test ? '🧪 اختبار تقني فقط — ليس طلب شراء\n\n' : ''}🎨 طلب VYLO\nرقم الطلب: ${id}\n\nاسم ولي الأمر: ${order.parentName}\n${children}\nرقم التليفون: ${order.phone}\nالمحافظة: ${order.governorate}\nالعنوان: ${order.address}\n\nالباقة: ${order.packageLabel}\nقيمة الكتب: ${order.price} جنيه\nالشحن: ${order.shipping} جنيه\nالإجمالي: ${order.total} جنيه\n${payment}\n\nالملاحظات: ${order.notes || 'لا يوجد'}\nالحالة: ${state}`;
}
export function receipt(order, id) {
  const children = order.children.map((n,i)=>`${PACKAGES[order.packageId].children[i]}: ${n}`).join('\n');
  const text = `أهلًا VYLO 🎨\nسجّلت طلب وعايز أكمل التفاصيل.\nرقم الطلب: ${id}\n\nاسم ولي الأمر: ${order.parentName}\n${children}\nالتليفون: ${order.phone}\nالمحافظة: ${order.governorate}\nالعنوان: ${order.address}\nالباقة: ${order.packageLabel}\nالكتب: ${order.price} جنيه\nالشحن: ${order.shipping} جنيه\nالإجمالي: ${order.total} جنيه\nالديبوزيت: ${order.deposit} جنيه من الإجمالي، لسه ما اتحوّلش\nالباقي بعد تحويله: ${order.remaining} جنيه\n${order.notes ? 'ملاحظاتي: '+order.notes+'\n' : ''}\nجاهز أبعت صور الطفل وأعرف تفاصيل تحويل الديبوزيت.`;
  return {ok:true,orderId:id,total:order.total,deposit:order.deposit,remaining:order.remaining,whatsappUrl:`https://wa.me/${WHATSAPP}?text=${encodeURIComponent(text)}`};
}
export async function sendTelegram(config, order, id, fetcher = fetch) {
  if (!config.token || !config.chatId) throw new OrderError('خدمة الطلبات لم تُفعّل بعد. تواصل مع VYLO على واتساب.',503);
  let response;
  try {
    response = await fetcher(`https://api.telegram.org/bot${config.token}/sendMessage`,{
      method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(15000),
      body:JSON.stringify({chat_id:config.chatId,text:orderMessage(order,id,Boolean(config.testLabel)),disable_web_page_preview:true,
        reply_markup:{inline_keyboard:[[{text:'💰 تأكيد ودفع ديبوزيت',callback_data:`deposit:${id}`}],[{text:'💬 التواصل مع ولي الأمر',url:`https://wa.me/20${order.phone.slice(1)}`}]]}})
    });
  } catch { throw new OrderError('تعذر تأكيد الإرسال. تواصل معنا على واتساب قبل إعادة الطلب.',504); }
  let data;
  try {data=await response.json();}catch{throw new OrderError('تعذر التأكد من تسجيل الطلب. تواصل معنا على واتساب.',504);}
  if (!response.ok || !data.ok || !data.result?.message_id) throw new OrderError('تعذر إرسال الطلب الآن. جرّب تاني أو تواصل معنا على واتساب.',502);
  return data.result.message_id;
}
