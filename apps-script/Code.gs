// Bound to the VYLO Google Sheets workbook. No bot token is stored in this project.
// Private Script Properties: BRIDGE_SECRET (same secret as the server).
// Deploy as a Web App, execute as owner. The signed bridge is called only by the backend.
const VYLO_HEADERS = ['تاريخ الطلب','رقم الطلب','اسم ولي الأمر','رقم التليفون','اسم الطفل — الكتاب الأول','اسم الطفل — الكتاب الثاني','اسم الطفل — الهدية','المحافظة','العنوان بالتفصيل','الباقة','قيمة الكتب','الشحن','الإجمالي','المدفوع','الباقي','حالة الطلب','وقت التأكيد','رقم رسالة تليجرام','ملاحظات','آخر عملية دفع'];

function setupVyloSheet() {
  const book=SpreadsheetApp.getActiveSpreadsheet();
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID',book.getId());
  let sheet=book.getSheetByName('Orders');
  if(!sheet)sheet=book.insertSheet('Orders');
  if(sheet.getLastRow()===0)sheet.getRange(1,1,1,VYLO_HEADERS.length).setValues([VYLO_HEADERS]);
  const actual=sheet.getRange(1,1,1,VYLO_HEADERS.length).getValues()[0];
  if(actual.join('|')!==VYLO_HEADERS.join('|'))throw new Error('Header layout does not match the VYLO template.');
  sheet.setRightToLeft(true);sheet.setFrozenRows(1);
  sheet.getRange(1,1,1,VYLO_HEADERS.length).setBackground('#5B16A6').setFontColor('#FFFFFF').setFontWeight('bold').setWrap(true);
  sheet.setRowHeight(1,48);sheet.setColumnWidths(1,20,150);sheet.setColumnWidth(9,300);sheet.setColumnWidth(10,280);sheet.setColumnWidth(19,300);
  sheet.getRange('D:H').setNumberFormat('@');sheet.getRange('K:O').setNumberFormat('#,##0.00');
  sheet.getRange('A:A').setNumberFormat('yyyy-mm-dd hh:mm');sheet.getRange('Q:Q').setNumberFormat('yyyy-mm-dd hh:mm');
  if(!sheet.getFilter())sheet.getRange(1,1,sheet.getMaxRows(),20).createFilter();
  let ledger=book.getSheetByName('Payments');if(!ledger){ledger=book.insertSheet('Payments');ledger.appendRow(['التاريخ','رقم الطلب','معرف العملية','المدفوع السابق','المدفوع الجديد']);ledger.setFrozenRows(1);ledger.getRange('A1:E1').setBackground('#5B16A6').setFontColor('white').setFontWeight('bold');ledger.setColumnWidths(1,5,180);}
}
function doPost(e){
  const lock=LockService.getScriptLock();
  try{
    const envelope=JSON.parse(e.postData.contents);
    verifyVyloSignature_(envelope);
    const payload=JSON.parse(envelope.body);
    lock.waitLock(30000);
    const sheet=vyloWorkbook_().getSheetByName('Orders');
    if(!sheet)throw new Error('Run setupVyloSheet first.');
    if(!/^VY-[A-Z0-9]{12}$/.test(payload.orderId||''))throw new Error('Invalid order ID.');
    const existing=findVyloRow_(sheet,payload.orderId);
    let result;
    if(payload.action==='createOrder')result=createVyloOrder_(sheet,payload,existing);
    else if(payload.action==='attachMessage'){
      if(!existing||!Number.isSafeInteger(Number(payload.messageId)))throw new Error('Order/message not found.');
      sheet.getRange(existing,18).setNumberFormat('@').setValue(String(payload.messageId));
      result={ok:true,orderId:payload.orderId};
    }else if(payload.action==='recordDeposit')result=recordVyloDeposit_(sheet,payload,existing);
    else throw new Error('Unknown action.');
    SpreadsheetApp.flush();return vyloJson_(result);
  }catch(error){return vyloJson_({ok:false,message:'Operation was not confirmed.'});}
  finally{if(lock.hasLock())lock.releaseLock();}
}
function verifyVyloSignature_(envelope){
  const secret=PropertiesService.getScriptProperties().getProperty('BRIDGE_SECRET');
  if(!secret||!Number.isFinite(envelope.timestamp)||Math.abs(Date.now()-envelope.timestamp)>300000||!/^[a-f0-9]{32}$/.test(envelope.nonce||'')||typeof envelope.body!=='string')throw new Error('Unauthorized.');
  const signed=String(envelope.timestamp)+'.'+envelope.nonce+'.'+envelope.body;
  const expected=Utilities.computeHmacSha256Signature(signed,secret,Utilities.Charset.UTF_8).map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join('');
  if(typeof envelope.signature!=='string'||envelope.signature.length!==expected.length)throw new Error('Unauthorized.');
  let difference=0;for(let i=0;i<expected.length;i++)difference|=expected.charCodeAt(i)^envelope.signature.charCodeAt(i);
  if(difference!==0)throw new Error('Unauthorized.');
}
function vyloWorkbook_(){const id=PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');if(!id)throw new Error('Run setupVyloSheet first.');return SpreadsheetApp.openById(id);}
function findVyloRow_(sheet,id){
  if(sheet.getLastRow()<2)return 0;
  const matches=sheet.getRange(2,2,sheet.getLastRow()-1,1).createTextFinder(id).matchEntireCell(true).findAll();
  if(matches.length>1)throw new Error('Duplicate order IDs require review.');return matches.length?matches[0].getRow():0;
}
function vyloText_(value,max){const text=String(value||'').slice(0,max||400);return /^[=+@\-]/.test(text)?"'"+text:text;}
function createVyloOrder_(sheet,payload,existing){
  const order=payload.order;
  if(!order||!Array.isArray(order.children))throw new Error('Invalid order.');
  const prices={book24:349,bundle:698};
  if(!Object.prototype.hasOwnProperty.call(prices,order.packageId)||order.price!==prices[order.packageId]||order.shipping!==70||order.total!==prices[order.packageId]+70||order.children.length!==(order.packageId==='bundle'?3:1))throw new Error('Invalid amounts.');
  if(existing){const saved=sheet.getRange(existing,13).getValue();if(Number(saved)!==order.total)throw new Error('Order conflict.');return{ok:true,orderId:payload.orderId,row:existing};}
  const row=sheet.getLastRow()+1;
  sheet.getRange(row,4).setNumberFormat('@');sheet.getRange(row,18).setNumberFormat('@');
  sheet.getRange(row,1,1,20).setValues([[new Date(),payload.orderId,vyloText_(order.parentName,80),order.phone,vyloText_(order.children[0],50),vyloText_(order.children[1],50),vyloText_(order.children[2],50),vyloText_(order.governorate,30),vyloText_(order.address,300),vyloText_(order.packageLabel,100),order.price,70,'=SUM(K'+row+':L'+row+')',0,'=M'+row+'-N'+row,'جديد','','',vyloText_(order.notes,400),'']]);
  return{ok:true,orderId:payload.orderId,row};
}
function recordVyloDeposit_(sheet,payload,row){
  if(!row||!/^telegram-\d+$/.test(payload.eventId||''))throw new Error('Invalid payment event.');
  const ledger=vyloWorkbook_().getSheetByName('Payments');if(!ledger)throw new Error('Payments ledger missing.');
  const total=Number(sheet.getRange(row,13).getValue()),amount=Number(payload.amount);
  if(typeof payload.amount!=='number'||!Number.isFinite(amount)||amount<=0||Math.round(amount*100)>Math.round(total*100)||Math.abs(amount*100-Math.round(amount*100))>0.000001)throw new Error('Invalid amount.');
  const prior=ledger.getLastRow()>1?ledger.getRange(2,3,ledger.getLastRow()-1,1).createTextFinder(payload.eventId).matchEntireCell(true).findNext():null;
  if(prior){const saved=ledger.getRange(prior.getRow(),2,1,4).getValues()[0];if(saved[0]!==payload.orderId||Number(saved[3])!==amount)throw new Error('Payment conflict.');const currentPaid=Number(sheet.getRange(row,14).getValue());return{ok:true,paid:currentPaid,remaining:Math.round((total-currentPaid)*100)/100};}
  const old=Number(sheet.getRange(row,14).getValue())||0;
  sheet.getRange(row,14).setValue(amount);sheet.getRange(row,15).setFormula('=M'+row+'-N'+row);sheet.getRange(row,16).setValue('تم التأكيد');sheet.getRange(row,17).setValue(new Date());sheet.getRange(row,20).setValue(payload.eventId);
  ledger.appendRow([new Date(),payload.orderId,payload.eventId,old,amount]);
  return{ok:true,paid:amount,remaining:Math.round((total-amount)*100)/100};
}
function vyloJson_(value){return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);}
