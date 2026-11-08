// Form + sandboxed receipt avoids cross-origin fetch restrictions without exposing credentials.
export function submitSheetOrder(endpoint,order,requestId){
 const url=new URL(endpoint);
 if(url.origin!=='https://script.google.com'||!url.pathname.endsWith('/exec'))throw new Error('إعداد ربط الطلبات غير صحيح.');
 return new Promise((resolve,reject)=>{
  const frame=document.createElement('iframe'),form=document.createElement('form');
  frame.name='vylo_'+crypto.randomUUID().replaceAll('-','');frame.hidden=true;
  form.method='POST';form.action=url.href;form.target=frame.name;form.hidden=true;
  const field=document.createElement('input');field.name='payload';field.value=JSON.stringify({order,requestId});form.append(field);
  const timer=setTimeout(()=>finish(new Error('تعذر تأكيد الطلب في الوقت المحدد. جرّب نفس الطلب؛ لا تعيد تسجيل طلب جديد.')),90000);
  function finish(error,value){clearTimeout(timer);window.removeEventListener('message',message);frame.remove();form.remove();error?reject(error):resolve(value);}
  function message(event){
   let origin;try{origin=new URL(event.origin);}catch{return;}
   if(origin.protocol!=='https:'||!(origin.hostname==='script.google.com'||origin.hostname.endsWith('.googleusercontent.com')))return;
   const data=event.data;if(data?.source!=='vylo-order-result'||data.requestId!==requestId)return;
   finish(null,{ok:Boolean(data.result?.ok),json:async()=>data.result});
  }
  window.addEventListener('message',message);document.body.append(frame,form);form.submit();
 });
}
