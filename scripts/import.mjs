#!/usr/bin/env node
// 批量导入羊毛：node scripts/import.mjs <file.json|file.jsonl> [--update] [--dry-run]
//   --update   id 已存在时覆盖（默认跳过）
//   --dry-run  只校验并打印结果，不写入 data/perks.jsonl
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readRecords, parseJsonl, validateCategories, validatePerk, serializePerk, formatIssue,
} from '../lib/validate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATEGORIES = path.join(ROOT, 'data/categories.json');
const PERKS = path.join(ROOT, 'data/perks.jsonl');
const rel = (p) => path.relative(process.cwd(), p) || p;

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const files = args.filter((a) => !a.startsWith('--'));
const unknownFlags = [...flags].filter((f) => !['--update', '--dry-run'].includes(f));
if (files.length !== 1 || unknownFlags.length || !/\.jsonl?$/.test(files[0])) {
  console.error('用法：node scripts/import.mjs <file.json|file.jsonl> [--update] [--dry-run]');
  if (unknownFlags.length) console.error(`未知参数：${unknownFlags.join(' ')}`);
  process.exit(2);
}
const input = files[0];
const update = flags.has('--update');
const dryRun = flags.has('--dry-run');

const cat = validateCategories(CATEGORIES);
if (cat.errors.length) {
  console.error('分类数据有错误，先修复：');
  cat.errors.forEach((e) => console.error(`  ${e}`));
  process.exit(1);
}
const categoryIds = new Set(cat.categories.map((c) => c.id));

// 读取现有数据：保留原始行文本，只替换被更新的行、在末尾追加新行，diff 最小。
const existingText = fs.existsSync(PERKS) ? fs.readFileSync(PERKS, 'utf8') : '';
const lines = existingText.split(/\r?\n/);
while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
const lineOfId = new Map();
for (const rec of parseJsonl(existingText)) {
  if (rec.error) {
    console.error(`${rel(PERKS)}:${rec.line} ${rec.error}`);
    console.error('现有数据无法解析，已中止导入，避免覆盖。');
    process.exit(1);
  }
  if (typeof rec.value?.id === 'string') lineOfId.set(rec.value.id, rec.line - 1);
}

let records;
try {
  records = readRecords(input);
} catch (e) {
  console.error(`无法读取 ${input}：${e.message}`);
  process.exit(2);
}

const counts = { added: 0, updated: 0, skipped: 0, failed: 0 };
const failures = [], skips = [], warnings = [];
const seenInFile = new Map();

for (const rec of records) {
  if (rec.error) {
    counts.failed++;
    failures.push(formatIssue(input, rec, { msg: rec.error }));
    continue;
  }
  const { perk, issues, warnings: w } = validatePerk(rec.value, categoryIds);
  const id = typeof rec.value?.id === 'string' ? rec.value.id : undefined;
  if (id && seenInFile.has(id)) issues.push({ field: 'id', msg: `与本文件第 ${seenInFile.get(id)} 行重复` });
  if (id) seenInFile.set(id, rec.line);
  if (!perk || issues.length) {
    counts.failed++;
    failures.push(...issues.map((x) => formatIssue(input, rec, x, id)));
    continue;
  }
  warnings.push(...w.map((x) => formatIssue(input, rec, x, id)));
  const line = serializePerk(rec.value);
  if (lineOfId.has(perk.id)) {
    const idx = lineOfId.get(perk.id);
    if (!update) {
      counts.skipped++;
      skips.push(`${perk.id}：id 已存在（加 --update 可覆盖）`);
    } else if (JSON.stringify(JSON.parse(lines[idx])) === line) {
      counts.skipped++;
      skips.push(`${perk.id}：内容未变化`);
    } else {
      lines[idx] = line;
      counts.updated++;
    }
  } else {
    lineOfId.set(perk.id, lines.length);
    lines.push(line);
    counts.added++;
  }
}

if (!dryRun && (counts.added || counts.updated)) fs.writeFileSync(PERKS, lines.join('\n') + '\n');

if (warnings.length) {
  console.log('警告：');
  warnings.forEach((x) => console.log(`  ${x}`));
}
if (skips.length) {
  console.log('跳过：');
  skips.forEach((x) => console.log(`  ${x}`));
}
if (failures.length) {
  console.log('失败原因：');
  failures.forEach((x) => console.log(`  ${x}`));
}
console.log(`${dryRun ? '[试运行，未写入] ' : ''}新增 ${counts.added} / 更新 ${counts.updated} / 跳过 ${counts.skipped} / 失败 ${counts.failed}`);
process.exit(counts.failed ? 1 : 0);
