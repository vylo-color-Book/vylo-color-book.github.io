import { OrderError, orderMessage } from './orders.mjs';

export function parsePaid(value,total){
  const s=String(value||'').replace(/[٠-٩]/g,c=>'٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/[۰-۹]/g,c=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(c)).trim().replace(/[٫,]/g,'.');
  if(!/^\d+(\.\d{1,2})?$/.test(s))throw new OrderError('اكتب مبلغًا صحيحًا زي 100 أو 100.50.');
  const amount=Number(s);if(!Number.isFinite(amount)||amount<=0||Math.round(amount*100)>Math.round(total*100))throw new OrderError(`المبلغ لازم يكون أكبر من صفر، وبحد أقصى ${total} جنيه.`);
  return Math.round(amount*100)/100;
}
export class DepositBot {
  constructor(config,store,sheets,fetcher=fetch){this.config=config;this.store=store;this.sheets=sheets;this.fetcher=fetcher;this.running=false;}
  async api(method,payload){
    let response;try{response=await this.fetcher(`https://api.telegram.org/bot${this.config.token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(method==='getUpdates'?35000:15000)});}catch{throw new Error('Telegram connection failed');}
    let result;try{result=await response.json();}catch{throw new Error('Telegram invalid response');}
    if(!response.ok||!result.ok)throw new Error('Telegram request failed');return result.result;
  }
  authorized(chatId,userId){return String(chatId)===String(this.config.chatId)&&String(userId)===String(this.config.adminId||this.config.chatId);}
  async handle(update){
    if(update.callback_query){
      const c=update.callback_query;
      if(!this.authorized(c.message?.chat?.id,c.from?.id))return;
      if(!/^deposit:VY-[A-Z0-9]{12}$/.test(c.data||''))return;
      const id=c.data.slice(8),row=this.store.getOrder(id);
      if(!row||String(row.message_id)!==String(c.message.message_id))return;
      await this.api('answerCallbackQuery',{callback_query_id:c.id,text:'اكتب المبلغ في الرد على رسالة البوت.'});
      const old=this.store.getPromptForOrder(id,String(c.from.id));
      if(old&&old.expires>Date.now())return;
      const prompt=await this.api('sendMessage',{chat_id:this.config.chatId,reply_parameters:{message_id:c.message.message_id},
        text:`💰 تأكيد ودفع ديبوزيت\nالطلب: ${id}\nالإجمالي: ${row.total} جنيه\nالمسجل مدفوع: ${row.paid||0} جنيه\n\nاكتب إجمالي المبلغ المدفوع حتى الآن بالجنيه، مثل 100.\nالرقم الجديد هيحل محل المدفوع المسجل، مش هيتضاف عليه.\nللإلغاء ابعت /cancel كرد على الرسالة دي.`,
        reply_markup:{force_reply:true,selective:true,input_field_placeholder:'إجمالي المدفوع، مثل 100'}});
      this.store.savePrompt({messageId:String(prompt.message_id),orderId:id,userId:String(c.from.id),expires:Date.now()+30*60000});return;
    }
    const m=update.message;
    if(!m||!this.authorized(m.chat?.id,m.from?.id)||!m.reply_to_message?.message_id)return;
    const prompt=this.store.getPrompt(String(m.reply_to_message.message_id));
    if(!prompt||prompt.user_id!==String(m.from.id))return;
    if(prompt.expires<Date.now()){this.store.removePrompt(prompt.message_id);await this.api('sendMessage',{chat_id:this.config.chatId,text:'انتهت مدة إدخال المبلغ. اضغط زر الديبوزيت على الأوردر من جديد.'});return;}
    if(m.text?.trim()==='/cancel'){this.store.removePrompt(prompt.message_id);await this.api('sendMessage',{chat_id:this.config.chatId,text:'تم إلغاء إدخال المبلغ. الأوردر لم يتغير.'});return;}
    const row=this.store.getOrder(prompt.order_id);if(!row)return;
    const eventId=`telegram-${update.update_id}`;
    if(this.store.hasPayment(eventId))return;
    let sheetConfirmed=false;
    try{
      const amount=parsePaid(m.text,row.total);
      const result=await this.sheets.recordDeposit(row.order_id,amount,eventId);
      const remaining=Math.round((row.total-amount)*100)/100;
      if(result.paid!==amount||result.remaining!==remaining)throw new Error('Sheet totals do not match');
      sheetConfirmed=true;
      this.store.savePayment({eventId,orderId:row.order_id,amount});
      // The sheet is authoritative. A success message is sent only after it confirms the write.
      await this.api('sendMessage',{chat_id:this.config.chatId,reply_parameters:{message_id:Number(row.message_id)},text:`✅ تم التأكيد والتسجيل في Google Sheets\nالطلب: ${row.order_id}\nإجمالي المدفوع: ${amount} جنيه\nالباقي: ${remaining} جنيه\nالحالة: تم التأكيد`});
      await this.api('editMessageText',{chat_id:this.config.chatId,message_id:Number(row.message_id),text:orderMessage(JSON.parse(row.payload),row.order_id,Boolean(this.config.testLabel),amount),reply_markup:{inline_keyboard:[[{text:`✅ مدفوع ${amount} جنيه — تعديل المبلغ`,callback_data:`deposit:${row.order_id}`}],[{text:'💬 التواصل مع ولي الأمر',url:`https://wa.me/20${row.phone.slice(1)}`}]]}});
      this.store.removePrompt(prompt.message_id);
    }catch(error){
      const text=sheetConfirmed?'المبلغ اتسجل في الشيت، لكن تعذر تحديث رسالة الأوردر. راجع الشيت قبل تعديل المبلغ.':error instanceof OrderError?error.message:'تعذر تأكيد تحديث الشيت. المدفوع لم يتم تأكيده. جرّب الرد على نفس رسالة إدخال المبلغ.';
      await this.api('sendMessage',{chat_id:this.config.chatId,reply_parameters:{message_id:Number(prompt.message_id)},text});
    }
  }
  async start(){
    if(this.running||!this.config.token||!this.config.chatId)return;
    const webhook=await this.api('getWebhookInfo',{});
    if(webhook.url)throw new Error('Existing Telegram webhook found; polling was not started.');
    this.running=true;
    while(this.running){
      try{
        const updates=await this.api('getUpdates',{offset:this.store.getOffset(),timeout:25,allowed_updates:['message','callback_query']});
        for(const update of updates){if(!this.running)break;await this.handle(update);this.store.setOffset(update.update_id+1);}
      }catch{if(this.running)await new Promise(resolve=>{const timer=setTimeout(resolve,5000);timer.unref?.();});}
    }
  }
  stop(){this.running=false;}
}
