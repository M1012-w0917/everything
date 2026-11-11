#!/usr/bin/env node
// v2 → v3 数据迁移：node scripts/migrate-v3.mjs <patch.json> [--dry-run]
//   patch.json 格式：{ "<id>": { 字段: 值, … }, … }，浅合并进 data/perks.jsonl 里同 id 的行。
//   每行合并后用 validatePerk 校验，再用 serializePerk 按 v3 字段顺序写回；行的先后顺序不变。
//   有失败时不写文件、exit 1；patch 里有但数据里没有的 id 算「跳过」，不算失败。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsonl, validateCategories, validatePerk, serializePerk, formatIssue } from '../lib/validate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATEGORIES = path.join(ROOT, 'data/categories.json');
const PERKS = path.join(ROOT, 'data/perks.jsonl');
const rel = (p) => path.relative(process.cwd(), p) || p;

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith('--'));
const flags = args.filter((a) => a.startsWith('--'));
if (files.length !== 1 || flags.some((f) => f !== '--dry-run')) {
  console.error('用法：node scripts/migrate-v3.mjs <patch.json> [--dry-run]');
  process.exit(2);
}
const dryRun = flags.includes('--dry-run');
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

let patch;
try {
  patch = JSON.parse(fs.readFileSync(files[0], 'utf8'));
} catch (e) {
  console.error(`无法读取补丁 ${files[0]}：${e.message}`);
  process.exit(2);
}
if (!isObj(patch) || !Object.values(patch).every(isObj)) {
  console.error('补丁格式应为 { "<id>": { 字段: 值, … } }');
  process.exit(2);
}

const cat = validateCategories(CATEGORIES);
if (cat.errors.length) {
  console.error('分类数据有错误，先修复：');
  cat.errors.forEach((e) => console.error(`  ${e}`));
  process.exit(1);
}
const categoryIds = new Set(cat.categories.map((c) => c.id));

const text = fs.readFileSync(PERKS, 'utf8');
const lines = text.split(/\r?\n/);
while (lines.length && !lines[lines.length - 1].trim()) lines.pop();

const counts = { migrated: 0, unchanged: 0, skipped: 0, failed: 0 };
const failures = [], warnings = [], skips = [];
const found = new Set();

for (const rec of parseJsonl(text)) {
  const file = rel(PERKS);
  if (rec.error) { counts.failed++; failures.push(formatIssue(file, rec, { msg: rec.error })); continue; }
  const id = rec.value?.id;
  const change = typeof id === 'string' && Object.hasOwn(patch, id) ? patch[id] : null;
  if (change) found.add(id);
  const issues = [];
  if (change && Object.hasOwn(change, 'id') && change.id !== id) issues.push({ field: 'id', msg: '补丁不能修改 id' });
  const merged = change ? { ...rec.value, ...change } : rec.value;
  const result = validatePerk(merged, categoryIds);
  issues.push(...result.issues);
  if (issues.length) {
    counts.failed++;
    failures.push(...issues.map((x) => formatIssue(file, rec, x, id)));
    continue;
  }
  warnings.push(...result.warnings.map((x) => formatIssue(file, rec, x, id)));
  const out = serializePerk(merged);
  if (out === lines[rec.line - 1]) counts.unchanged++;
  else { lines[rec.line - 1] = out; counts.migrated++; }
}

for (const id of Object.keys(patch)) {
  if (!found.has(id)) { counts.skipped++; skips.push(`${id}：数据里没有这个 id`); }
}

if (!dryRun && !counts.failed && counts.migrated) fs.writeFileSync(PERKS, `${lines.join('\n')}\n`);

if (warnings.length) { console.log('警告：'); warnings.forEach((x) => console.log(`  ${x}`)); }
if (skips.length) { console.log('跳过：'); skips.forEach((x) => console.log(`  ${x}`)); }
if (failures.length) { console.log('失败原因（未写入任何改动）：'); failures.forEach((x) => console.log(`  ${x}`)); }
const prefix = dryRun ? '[试运行，未写入] ' : '';
console.log(`${prefix}迁移 ${counts.migrated} / 未变 ${counts.unchanged} / 跳过 ${counts.skipped} / 失败 ${counts.failed}`);
process.exit(counts.failed ? 1 : 0);
