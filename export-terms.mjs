/**
 * 从云端导出全部词条到 terms.json（GitHub Pages 镜像的数据源）。
 * 用法：node export-terms.mjs
 * 在官方站点后台增删改词条后，重新运行本脚本并 git push 即可同步镜像。
 */
import { writeFileSync } from 'node:fs';

const ENDPOINT = 'https://econ-lexicon.app.workbuddy.host';
const KEY = 'wbpk_IvtEXYhjdGRRwAy4QyaS4B_ZbSYSihtH1H7Ie7g6cDT79c5A9ODoAtf';

const res = await fetch(
  ENDPOINT + '/.cloud/database/rest/terms?select=id,term,category,short_def,detail,example,created_at&order=id.asc&limit=2000',
  { headers: { Origin: ENDPOINT, 'x-wb-webapp-access-key': KEY } }
);
if (!res.ok) {
  console.error('导出失败：HTTP', res.status, await res.text());
  process.exit(1);
}
const rows = await res.json();
writeFileSync('terms.json', JSON.stringify(rows, null, 2), 'utf8');
console.log('已导出', rows.length, '条词条到 terms.json');
