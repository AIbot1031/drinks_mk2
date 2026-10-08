import fs from 'node:fs/promises';
const required = ['public/index.html', 'public/app.js', 'public/styles.css', 'data/catalog.json'];
for (const path of required) await fs.access(path);
const catalog = JSON.parse(await fs.readFile('data/catalog.json', 'utf8'));
if (catalog.total !== catalog.drinks.length || new Set(catalog.drinks.map(d => d.id)).size !== catalog.total) throw new Error('飲料資料筆數或 ID 有誤');
console.log(`網站檔案就緒，${catalog.total} 筆飲料；Wrangler 將打包 Worker 與靜態網站。`);
