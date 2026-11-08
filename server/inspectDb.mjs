import Database from 'better-sqlite3';

const db = new Database('../.runtime/localgravity.sqlite', { readonly: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('Tables:', tables.map(t => t.name));
for (const t of tables) {
  const rows = db.prepare(`SELECT * FROM ${t.name} ORDER BY rowid DESC LIMIT 2`).all();
  console.log(`=== ${t.name} (${rows.length}) ===`);
  console.log(JSON.stringify(rows, null, 2));
}
