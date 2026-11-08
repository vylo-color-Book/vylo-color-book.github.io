import { submitSheetOrder } from './bridge.js';
import { PACKAGES, SHIPPING, DEPOSIT, GOVERNORATES, normalizePhone } from './catalog.js?v=4';

const form = document.querySelector('#order-form');
const status = document.querySelector('#form-status');
const submit = document.querySelector('#submit-button');
const childFields = document.querySelector('#children-fields');
const childCache = ['', '', ''];
const gov = document.querySelector('#governorate');
let sending = false;
let completed = false;
let requestKey = '';
let requestSignature = '';

for (const name of GOVERNORATES) gov.add(new Option(name, name));
document.querySelector('#year').textContent = new Date().getFullYear();
function selection() { return form.elements.packageId.value; }
function rememberChildren() { childFields.querySelectorAll('input').forEach((input, i) => { childCache[i] = input.value; }); }
function updatePackage() {
  rememberChildren();
  const p = PACKAGES[selection()];
  childFields.replaceChildren();
  if (selection() === 'bundle') {
    const hint = document.createElement('p'); hint.className = 'children-hint';
    hint.textContent = 'اكتب الاسم لكل كتاب، وممكن تكرر نفس الاسم لو الكتب لنفس الطفل.'; childFields.append(hint);
  }
  p.children.forEach((label, i) => {
    const div = document.createElement('div'); div.className = 'field';
    const l = document.createElement('label'); l.htmlFor = `child-${i}`; l.textContent = label + ' *';
    const input = document.createElement('input'); Object.assign(input, {id:`child-${i}`,name:`child${i}`,required:true,minLength:2,maxLength:50,placeholder:'الاسم اللي هيتكتب على الكتاب',value:childCache[i] || ''});
    div.append(l, input); childFields.append(div);
  });
  document.querySelector('#summary-name').textContent = p.label;
  document.querySelector('#summary-price').textContent = p.price + ' جنيه';
  document.querySelector('#summary-total').replaceChildren(document.createTextNode((p.price + SHIPPING) + ' '), Object.assign(document.createElement('small'),{textContent:'جنيه'}));
  document.querySelector('#summary-remaining').textContent = (p.price + SHIPPING - DEPOSIT) + ' جنيه';
}
form.querySelectorAll('[name="packageId"]').forEach(input => input.addEventListener('change', updatePackage));
document.querySelectorAll('[data-select]').forEach(button => button.addEventListener('click', () => {
  if (sending || completed) return;
  form.querySelector(`[value="${button.dataset.select}"]`).checked = true;
  updatePackage(); document.querySelector('#order').scrollIntoView({behavior:'smooth'});
}));
function setStatus(text, success = false) { status.textContent = text; status.classList.toggle('success', success); }
function key() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(16)}-${crypto.getRandomValues(new Uint32Array(4)).join('-')}`; }
function lockFields(lock) { form.querySelectorAll('input,select,textarea').forEach(e => e.disabled = lock); }
form.addEventListener('submit', async e => {
  e.preventDefault();
  if (sending || completed) return;
  const phone = normalizePhone(form.elements.phone.value);
  form.elements.phone.setCustomValidity(phone ? '' : 'اكتب رقم موبايل مصري صحيح من 11 رقم، زي 01012345678.');
  if (!form.reportValidity()) return;
  const payload = {
    packageId:selection(),parentName:form.elements.parentName.value.trim(),phone,
    children:[...childFields.querySelectorAll('input')].map(input=>input.value.trim()),
    governorate:gov.value,address:form.elements.address.value.trim(),notes:form.elements.notes.value.trim(),website:form.elements.website.value
  };
  const signature = JSON.stringify(payload);
  if (signature !== requestSignature) { requestKey = key(); requestSignature = signature; }
  sending = true; submit.disabled = true; lockFields(true);
  submit.querySelector('span').textContent = 'ثواني… بنسجّل طلبك';
  setStatus('');
  try {
    const response = window.VYLO_CONFIG?.sheetsEndpoint ? await submitSheetOrder(window.VYLO_CONFIG.sheetsEndpoint,payload,requestKey) : await fetch((window.VYLO_CONFIG?.apiBase || '').replace(/\/$/,'') + '/api/orders', {
      method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':requestKey},
      body:JSON.stringify(payload),signal:AbortSignal.timeout(65000)
    });
    let result;
    try { result = await response.json(); } catch { throw new Error('خدمة تسجيل الطلبات مش متاحة دلوقتي. جرّب تاني بعد شوية أو كلّمنا على واتساب.'); }
    if (!response.ok || !result.ok || !result.orderId) throw new Error(result.message || 'الطلب ما اتأكدش. راجع بياناتك وجرّب تاني.');
    const wa = new URL(result.whatsappUrl);
    if (wa.protocol !== 'https:' || wa.hostname !== 'wa.me' || wa.pathname !== '/201270366874') throw new Error('تعذر فتح رابط المتابعة. تواصل مع الصفحة.');
    completed = true;
    setStatus(`طلبك ${result.orderId} وصل! بنفتح واتساب عشان نكمّل الصور والديبوزيت.`, true);
    document.querySelector('#continue-whatsapp').href = wa.href;
    document.querySelector('#order-success').hidden = false; submit.hidden = true;
    // This is a lead. Payment has not happened and must not trigger a Purchase event.
    window.dispatchEvent(new CustomEvent('vylo:order-created',{detail:{orderId:result.orderId,value:result.total,currency:'EGP'}}));
    setTimeout(() => { window.location.assign(wa.href); }, 1000);
  } catch (error) {
    setStatus(error.name === 'TimeoutError' || error.name === 'AbortError' ? 'الاتصال اتأخر. جرّب نفس الطلب تاني؛ هنراجع رقم المحاولة لتجنب تكراره.' : error instanceof TypeError ? 'تعذر الاتصال بخدمة الطلبات. بياناتك لسه موجودة؛ جرّب تاني أو كلّمنا على واتساب.' : error.message);
    status.focus();
  } finally {
    sending = false;
    if (!completed) { submit.disabled = false; lockFields(false); submit.querySelector('span').textContent = 'سجّل الطلب وكمّل على واتساب'; }
  }
});
form.elements.phone.addEventListener('input', () => form.elements.phone.setCustomValidity(''));
document.querySelector('#new-order').addEventListener('click', () => {
  completed = false; requestKey = ''; requestSignature = ''; childCache.fill('');
  lockFields(false); form.reset(); updatePackage(); submit.disabled=false; submit.hidden=false;
  submit.querySelector('span').textContent='سجّل الطلب وكمّل على واتساب';
  document.querySelector('#order-success').hidden=true; setStatus(''); form.elements.parentName.focus();
});
const video = document.querySelector('#product-video');
document.querySelectorAll('[data-video]').forEach(button => button.addEventListener('click', () => {
  video.pause(); video.src = button.dataset.video; video.load();
  document.querySelectorAll('[data-video]').forEach(b => b.setAttribute('aria-pressed',String(b===button)));
}));
video.addEventListener('error', () => { document.querySelector('#video-fallback').hidden=false; });
if ('IntersectionObserver' in window) {
  new IntersectionObserver(entries => {
    document.body.classList.toggle('ordering', entries[0].isIntersecting);
  }, {rootMargin:'-90px 0px 0px 0px'}).observe(form);
}
updatePackage();
