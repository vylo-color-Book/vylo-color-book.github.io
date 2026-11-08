import { createHmac, randomBytes } from 'node:crypto';
import { OrderError } from './orders.mjs';

export const DEFAULT_BRIDGE_CONTEXT = 'vylo-sheets-bridge:1gol8E_a8y0_kE0ciBEm704CAyLWm7dthTP6XY5_Iu9r6J-HW3TC7nzfn';
export function deriveBridgeSecret(token, context=DEFAULT_BRIDGE_CONTEXT) {
  if(!token)return undefined;
  return createHmac('sha256',token).update(context).digest('hex');
}

export class SheetsBridge {
  constructor(config, fetcher=fetch) {
    this.url=config.sheetsUrl;this.secret=config.sheetsSecret;this.fetcher=fetcher;
  }
  get configured(){return Boolean(this.url&&this.secret);}
  async call(action,data){
    if(!this.configured)throw new OrderError('ربط تسجيل الطلبات غير مكتمل. تواصل معنا على واتساب.',503);
    const timestamp=Date.now(),nonce=randomBytes(16).toString('hex'),body=JSON.stringify({action,...data});
    const signature=createHmac('sha256',this.secret).update(`${timestamp}.${nonce}.${body}`).digest('hex');
    let response;
    try{response=await this.fetcher(this.url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({timestamp,nonce,body,signature}),signal:AbortSignal.timeout(20000)});}catch{throw new OrderError('تعذر تأكيد التسجيل في الشيت. جرّب تاني بنفس الطلب.',503);}
    let result;try{result=await response.json();}catch{throw new OrderError('تعذر تأكيد التسجيل في الشيت.',503);}
    if(!response.ok||!result.ok)throw new OrderError('تعذر التسجيل في الشيت. لم يتم تأكيد العملية.',503);
    return result;
  }
  createOrder(order,id){return this.call('createOrder',{orderId:id,order});}
  attachMessage(id,messageId){return this.call('attachMessage',{orderId:id,messageId});}
  recordDeposit(id,amount,eventId){return this.call('recordDeposit',{orderId:id,amount,eventId});}
}
