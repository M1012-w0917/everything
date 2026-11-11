// 构建后的兜底检查：内部字段（verifyMethod、discoveredVia）不能出现在 dist/ 里。
// 正常情况下 validatePerk 根本不把内部字段交给 build，这里防的是有人把内部 URL 抄进了公开字段。
import fs from 'node:fs';
import path from 'node:path';
import { INTERNAL_FIELDS } from './validate.mjs';

const TEXT_EXT = new Set(['.html', '.js', '.json', '.md', '.txt', '.css', '.svg']);

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (TEXT_EXT.has(path.extname(e.name))) yield p;
  }
}

// URL 在不同输出里的写法：原文、HTML 转义、<script> JSON 转义
const variants = (u) => [...new Set([
  u,
  u.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll("'", '&#39;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
  JSON.stringify(u).slice(1, -1).replaceAll('&', '\\u0026').replaceAll('<', '\\u003c').replaceAll('>', '\\u003e'),
])];

export function findLeaks(outDir, internalUrls, publicUrls) {
  const needles = [...INTERNAL_FIELDS];
  for (const u of internalUrls) if (!publicUrls.has(u)) needles.push(...variants(u));
  const hits = [];
  for (const file of walk(outDir)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const n of needles) if (text.includes(n)) hits.push(`${file}：${n}`);
  }
  return hits;
}
