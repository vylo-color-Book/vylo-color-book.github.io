export function initializeStore(db){
  const columns=db.prepare('PRAGMA table_info(orders)').all().map(c=>c.name);
  if(!columns.includes('payload'))db.exec('ALTER TABLE orders ADD COLUMN payload TEXT');
  if(!columns.includes('paid'))db.exec('ALTER TABLE orders ADD COLUMN paid REAL NOT NULL DEFAULT 0');
  db.exec('CREATE TABLE IF NOT EXISTS prompts (message_id TEXT PRIMARY KEY, order_id TEXT NOT NULL, user_id TEXT NOT NULL, expires INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS payments (event_id TEXT PRIMARY KEY, order_id TEXT NOT NULL, amount REAL NOT NULL); CREATE TABLE IF NOT EXISTS bot_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  return {
    getOrder(id){const row=db.prepare('SELECT * FROM orders WHERE order_id=?').get(id);if(!row?.payload)return null;const order=JSON.parse(row.payload);return{...row,total:order.total,phone:order.phone};},
    getPromptForOrder(id,userId){return db.prepare('SELECT * FROM prompts WHERE order_id=? AND user_id=? ORDER BY expires DESC LIMIT 1').get(id,userId);},
    savePrompt(p){db.prepare('INSERT OR REPLACE INTO prompts VALUES (?,?,?,?)').run(p.messageId,p.orderId,p.userId,p.expires);},
    getPrompt(id){return db.prepare('SELECT * FROM prompts WHERE message_id=?').get(id);},
    removePrompt(id){db.prepare('DELETE FROM prompts WHERE message_id=?').run(id);},
    hasPayment(id){return Boolean(db.prepare('SELECT event_id FROM payments WHERE event_id=?').get(id));},
    savePayment(p){db.exec('BEGIN IMMEDIATE');try{db.prepare('INSERT OR IGNORE INTO payments VALUES (?,?,?)').run(p.eventId,p.orderId,p.amount);db.prepare('UPDATE orders SET paid=? WHERE order_id=?').run(p.amount,p.orderId);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}},
    getOffset(){return Number(db.prepare("SELECT value FROM bot_state WHERE key='offset'").get()?.value||0);},
    setOffset(value){db.prepare("INSERT OR REPLACE INTO bot_state VALUES ('offset',?)").run(String(value));}
  };
}
