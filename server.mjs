import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { createReadStream, mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createInterface } from 'node:readline';
import { OrderError, validateOrder, fingerprint, orderId, receipt, sendTelegram } from './orders.mjs';
import { SheetsBridge, deriveBridgeSecret } from './sheets.mjs';
import { DepositBot } from './bot.mjs';
import { initializeStore } from './store.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.join(root,'public');
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.jpg':'image/jpeg','.png':'image/png','.mp4':'video/mp4','.woff2':'font/woff2','.ttf':'font/ttf','.txt':'text/plain; charset=utf-8'};

export function createApp(config = {}, dependencies = {}) {
  const dbPath = config.databasePath || path.join(root,'.data','orders.sqlite');
  if (dbPath !== ':memory:') mkdirSync(path.dirname(dbPath),{recursive:true});
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS orders (request_key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, order_id TEXT NOT NULL, state TEXT NOT NULL, message_id TEXT, created_at TEXT NOT NULL)');
  const store=initializeStore(db);
  const sheets=dependencies.sheetAdapter||new SheetsBridge(config,dependencies.sheetFetcher);
  const requireSheets=config.requireSheets!==false;
  const bot=new DepositBot(config,store,sheets,dependencies.botFetcher);
  const inFlight=new Set();
  const limits = new Map();
  const cleanup = setInterval(() => {const now=Date.now();for(const [ip,v] of limits)if(v.until<now)limits.delete(ip);},60000); cleanup.unref();
  function json(res, code, body, extra={}) { res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...extra});res.end(JSON.stringify(body)); }
  async function handler(req,res) {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      const origin=req.headers.origin;
      const sameOrigins=new Set([`http://${req.headers.host}`,`https://${req.headers.host}`]);
      const allowed=config.allowedOrigin || '';
      if (origin && origin!==allowed && !sameOrigins.has(origin)) return json(res,403,{ok:false,message:'مصدر الطلب غير مسموح.'});
      if(origin) {res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
      if(req.method==='OPTIONS') {res.writeHead(204,{'Access-Control-Allow-Methods':'POST, GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Idempotency-Key','Access-Control-Max-Age':'600'});return res.end();}
      if(url.pathname==='/api/health'&&req.method==='GET')return json(res,200,{ok:true,ordersConfigured:Boolean(config.token&&config.chatId&&(!requireSheets||sheets.configured)),sheetsConfigured:Boolean(sheets.configured)});
      if(url.pathname!=='/api/orders')return json(res,404,{ok:false,message:'غير موجود.'});
      if(req.method!=='POST')return json(res,405,{ok:false,message:'طريقة الطلب غير مسموحة.'},{Allow:'POST'});
      if(!(req.headers['content-type']||'').startsWith('application/json'))return json(res,415,{ok:false,message:'صيغة البيانات غير صحيحة.'});
      const ip = req.socket.remoteAddress || 'unknown';
      const now=Date.now();let limit=limits.get(ip);
      if(!limit||limit.until<now){limit={count:0,until:now+15*60000};limits.set(ip,limit);}
      if(++limit.count>30)return json(res,429,{ok:false,message:'محاولات كتير في وقت قصير. انتظر شوية وجرّب تاني.'},{'Retry-After':'900'});
      let activeKey;
      try {
        const declared=Number(req.headers['content-length']||0);if(declared>12000)throw new OrderError('حجم البيانات كبير.',413);
        const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>12000)throw new OrderError('حجم البيانات كبير.',413);chunks.push(chunk);}
        let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new OrderError('بيانات الطلب غير صحيحة.');}
        const order=validateOrder(input);
        const key=req.headers['idempotency-key'];
        if(typeof key!=='string'||! /^[a-zA-Z0-9-]{16,100}$/.test(key))throw new OrderError('رقم المحاولة غير صحيح. حدّث الصفحة.');
        if(!config.token||!config.chatId)throw new OrderError('خدمة تسجيل الطلبات لم تُفعّل بعد. تواصل مع VYLO على واتساب.',503);
        if(requireSheets&&!sheets.configured)throw new OrderError('خدمة تسجيل الطلبات لم تُفعّل بعد. تواصل مع VYLO على واتساب.',503);
        const hash=fingerprint(order);
        const existing=db.prepare('SELECT * FROM orders WHERE request_key = ?').get(key);
        if(existing&&existing.fingerprint!==hash)throw new OrderError('بيانات المحاولة اتغيّرت. حدّث الصفحة وجرّب تاني.',409);
        if(existing?.state==='sent')return json(res,200,receipt(order,existing.order_id));
        if(inFlight.has(key)||existing?.state==='sending'||existing?.state==='uncertain')throw new OrderError('المحاولة دي قيد المراجعة. تواصل معنا على واتساب قبل إعادة الطلب.',409);
        inFlight.add(key);activeKey=key;
        const id=existing?.order_id||orderId();
        if(!existing)db.prepare("INSERT INTO orders (request_key,fingerprint,order_id,state,message_id,created_at,payload) VALUES (?, ?, ?, 'sheet_pending', NULL, ?, ?)").run(key,hash,id,new Date().toISOString(),JSON.stringify(order));
        let state=existing?.state||'sheet_pending',messageId=existing?.message_id;
        if(state==='sheet_pending'){
          if(sheets.configured)await sheets.createOrder(order,id);
          db.prepare("UPDATE orders SET state='sheet_saved' WHERE request_key=?").run(key);state='sheet_saved';
        }
        if(state==='sheet_saved'||state==='failed'){
          db.prepare("UPDATE orders SET state='sending' WHERE request_key=?").run(key);
          try{messageId=await sendTelegram(config,order,id,dependencies.fetcher);}
          catch(error){db.prepare('UPDATE orders SET state=? WHERE request_key=?').run(error.status===502?'sheet_saved':'uncertain',key);throw error;}
          db.prepare("UPDATE orders SET state='telegram_sent', message_id=? WHERE request_key=?").run(String(messageId),key);
        }
        if(sheets.configured)await sheets.attachMessage(id,Number(messageId));
        db.prepare("UPDATE orders SET state='sent' WHERE request_key=?").run(key);
        return json(res,201,receipt(order,id));
      }catch(error){return json(res,error instanceof OrderError?error.status:500,{ok:false,message:error instanceof OrderError?error.message:'تعذر تسجيل الطلب. تواصل معنا على واتساب.'});}
      finally{if(activeKey)inFlight.delete(activeKey);}
    }
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405,{Allow:'GET, HEAD'});return res.end();}
    try {
      const decoded=decodeURIComponent(url.pathname);
      if(decoded.includes('\\')||decoded.includes('\0')||decoded.split('/').some(s=>s.startsWith('.')))throw new Error('path');
      const filename=path.resolve(publicRoot,'.'+(decoded==='/'?'/index.html':decoded));
      if(!filename.startsWith(publicRoot+path.sep))throw new Error('path');
      const stat=await fs.stat(filename);if(!stat.isFile())throw new Error('file');
      const ext=path.extname(filename);if(!types[ext])throw new Error('type');
      res.setHeader('Content-Type',types[ext]);res.setHeader('Cache-Control',['.html','.css','.js'].includes(ext)?'no-cache':'public, max-age=3600');
      if(ext==='.mp4') {
        res.setHeader('Accept-Ranges','bytes');
        if(req.headers.range){const match=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!match){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`});return res.end();}
          const start=Number(match[1]),end=match[2]?Math.min(Number(match[2]),stat.size-1):stat.size-1;
          if(start> end||start>=stat.size){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`});return res.end();}
          res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${stat.size}`,'Content-Length':end-start+1});if(req.method==='HEAD')return res.end();return createReadStream(filename,{start,end}).pipe(res);
        }
      }
      res.setHeader('Content-Length',stat.size);res.writeHead(200);if(req.method==='HEAD')return res.end();createReadStream(filename).pipe(res);
    }catch{res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('الصفحة غير موجودة.');}
  }
  const server=http.createServer((req,res)=>{handler(req,res).catch(()=>{if(!res.headersSent)json(res,500,{ok:false,message:'تعذر إكمال الطلب.'});else res.end();});});
  server.requestTimeout=35000;server.headersTimeout=10000;
  server.on('close',()=>{bot.stop();clearInterval(cleanup);db.close();});
  if(config.pollTelegram)server.on('listening',()=>{bot.start().catch(()=>console.log('Telegram polling could not start. Check private runtime configuration and existing webhook.'));});
  return server;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  let secret={};
  if(process.argv.includes('--stdin-config')){
    if(process.stdin.isTTY)process.stdin.setRawMode(true);
    console.log('Ready for private runtime configuration on stdin (input is hidden).');
    const rl=createInterface({input:process.stdin,terminal:false});
    secret=await new Promise((resolve,reject)=>{rl.once('line',line=>{try{resolve(JSON.parse(line));}catch{reject(new Error('Invalid runtime configuration'));}finally{rl.close();}});});
    if(process.stdin.isTTY)process.stdin.setRawMode(false);
  }
  const config={token:secret.token||process.env.TELEGRAM_BOT_TOKEN,chatId:secret.chatId||process.env.TELEGRAM_CHAT_ID,
    allowedOrigin:process.env.ALLOWED_ORIGIN||'',testLabel:Boolean(secret.testLabel),databasePath:process.env.VYLO_DATABASE_PATH,
    sheetsUrl:secret.sheetsUrl||process.env.SHEETS_BRIDGE_URL,sheetsSecret:secret.sheetsSecret||process.env.SHEETS_BRIDGE_SECRET,
    adminId:process.env.TELEGRAM_ADMIN_ID||secret.chatId||process.env.TELEGRAM_CHAT_ID,
    requireSheets:secret.requireSheets!==false,pollTelegram:process.env.TELEGRAM_POLLING==='true'||Boolean(secret.pollTelegram)};
  if(!config.sheetsSecret)config.sheetsSecret=deriveBridgeSecret(config.token,process.env.SHEETS_BRIDGE_CONTEXT||undefined);
  const server=createApp(config);const port=Number(process.env.PORT||4173);
  server.listen(port,process.env.HOST||'127.0.0.1',()=>console.log(`VYLO preview: http://127.0.0.1:${port} | Telegram ${config.token&&config.chatId?'configured':'not configured'}`));
}
