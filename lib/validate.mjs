// 数据校验：build.mjs 和 scripts/import.mjs 共用这一份规则。
// 只依赖 Node 内置模块。
import fs from 'node:fs';

export const ID_PATTERN = /^[a-z0-9-]+$/;
export const SPRITE_COUNT = 6; // assets/glass-atlas.* 是 3×2 的精灵图

// 双语文本字段（每个都是 {zh, en}）
export const TEXT_FIELDS = ['name', 'tag', 'summary', 'benefit', 'eligibility', 'cost', 'deadline', 'verification'];
// 双语列表字段（每个都是 {zh: [], en: []}）
export const LIST_FIELDS = ['constraints', 'steps'];
// 保存到 perks.jsonl 时的字段顺序
// 可选字段：keywords（只参与搜索，不显示）、sourceLabel（来源链接文字），缺英文都不警告
export const FIELD_ORDER = [
  'id', 'category', 'provider', 'name', 'tag', 'summary', 'benefit', 'eligibility',
  'constraints', 'cost', 'deadline', 'steps', 'url', 'source', 'sourceLabel', 'reviewed', 'expires',
  'requiresCard', 'autoRenew', 'audience', 'regions', 'verification', 'keywords',
  'verifyMethod', 'discoveredVia',
];
const KNOWN = new Set(FIELD_ORDER);

// 内部字段：只在数据文件里，validatePerk 不会把它们放进公开的 perk
export const INTERNAL_FIELDS = ['verifyMethod', 'discoveredVia'];
export const AUDIENCES = ['all', 'student', 'developer', 'new-user', 'enterprise'];
export const VERIFY_METHODS = ['official-page', 'announcement', 'redeemed', 'unverified'];
export const DISCOVERY_TYPES = ['x', 'web', 'newsletter', 'manual'];
const DISCOVERY_KEYS = new Set(['type', 'url', 'date', 'note']);
// ICU 认识、但不是国家或地区的代码：未知地区、欧盟、欧元区、联合国、大洋洲其他、伪地区
const NON_REGION_CODES = new Set(['ZZ', 'EU', 'EZ', 'UN', 'QO', 'XA', 'XB']);
const UNKNOWN_HINT = '不知道就不写这个字段';

const MISSING_EN = '缺少英文，英文页将显示中文';
const NEWLINE = /[\r\n\u2028\u2029]/;
const NEWLINE_MSG = '不能包含换行符（单行文字字段）';
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v.trim() : '');
// 单行文字字段：原始值里有换行就报错
const checkLine = (v, field, issues) => {
  if (typeof v === 'string' && NEWLINE.test(v)) issues.push({ field, msg: NEWLINE_MSG });
};
// 规范化对象上记录哪些字段的英文是回退的中文（不可枚举，不会进入 JSON 输出）
const markFallback = (obj, fields) => Object.defineProperty(obj, 'fallbackEn', { value: new Set(fields), enumerable: false });

export function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function isHttpsUrl(s) {
  if (typeof s !== 'string' || s !== s.trim() || /\s/.test(s)) return false;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' && Boolean(u.hostname) && !u.username && !u.password;
  } catch {
    return false;
  }
}

// ---------- 时间 ----------
// 日期型 YYYY-MM-DD 统一按北京时间理解（Asia/Shanghai 自 1991 年起无夏令时，固定 +08:00）
export const DATE_ONLY_OFFSET = '+08:00';
const DAY_MS = 86400000;
const OFFSET_MS = 8 * 3600000;
const INSTANT = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-](\d{2}):(\d{2}))$/;

// 带时区的时刻；格式或日历不合法返回 null
function parseInstant(v) {
  const m = typeof v === 'string' ? INSTANT.exec(v) : null;
  if (!m || !isValidDate(m[1])) return null;
  const [h, min, s = '0', , oh = '0', om = '0'] = m.slice(2);
  if (+h > 23 || +min > 59 || +s > 59 || +oh > 23 || +om > 59) return null;
  const at = Date.parse(v);
  return Number.isNaN(at) ? null : at;
}
const startOfDateOnly = (d) => Date.parse(`${d}T00:00:00${DATE_ONLY_OFFSET}`);

export function parseExpires(v) {
  if (v === null) return { ok: true, at: null, kind: 'none' };
  if (isValidDate(v)) return { ok: true, at: startOfDateOnly(v) + DAY_MS, kind: 'date' };
  const at = parseInstant(v);
  return at === null ? { ok: false } : { ok: true, at, kind: 'instant' };
}

// 构建时用来判断过期的「现在」（毫秒）。BUILD_DATE 可设为日期（当天 00:00 北京时间）或带时区的时刻
export function buildNow() {
  const v = process.env.BUILD_DATE;
  if (!v) return Date.now();
  if (isValidDate(v)) return startOfDateOnly(v);
  const at = parseInstant(v);
  if (at === null) throw new Error(`BUILD_DATE 格式不对：应为 YYYY-MM-DD 或带时区的 ISO 时间（如 2026-11-12T16:00:00Z），当前为 "${v}"`);
  return at;
}

// 毫秒时间 → 北京时间的日期 YYYY-MM-DD
export const dateInZone = (ms) => new Date(ms + OFFSET_MS).toISOString().slice(0, 10);

export const isExpired = (perk, nowMs) => perk.expiresAt !== null && Date.parse(perk.expiresAt) <= nowMs;

// ---------- 定位：错误信息里要有行号 ----------

// 返回 JSON 文本中顶层数组每个元素的起始行号（1 起）。顶层是对象时返回 [1]。
export function locateArrayItems(text) {
  const lines = [];
  let line = 1, depth = 0, inStr = false, esc = false, expectItem = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n') line++;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (/\s/.test(ch)) continue;
    if (depth === 0 && ch === '{') return [line];
    if (depth === 1 && expectItem && ch !== ']') { lines.push(line); expectItem = false; }
    if (ch === '"') inStr = true;
    else if (ch === '[' || ch === '{') { depth++; if (depth === 1) expectItem = true; }
    else if (ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 1) expectItem = true;
  }
  return lines;
}

// 解析 JSONL；空行跳过。返回 [{line, raw, value?, error?}]
export function parseJsonl(text) {
  const out = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    if (!raw.trim()) return;
    try {
      out.push({ line: i + 1, raw, value: JSON.parse(raw) });
    } catch (e) {
      out.push({ line: i + 1, raw, error: `JSON 解析失败：${e.message}` });
    }
  });
  return out;
}

// 解析 .json（数组或单个对象）或 .jsonl 文件，统一成带行号的记录
export function readRecords(file) {
  const text = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.jsonl')) return parseJsonl(text);
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return [{ line: 1, error: `JSON 解析失败：${e.message}` }];
  }
  const items = Array.isArray(data) ? data : [data];
  const lines = locateArrayItems(text);
  return items.map((value, i) => ({ line: lines[i] ?? 1, index: i + 1, value }));
}

export function formatIssue(file, rec, issue, id) {
  const where = rec.index ? `${file}:${rec.line}（第 ${rec.index} 条）` : `${file}:${rec.line}`;
  const who = id ? ` [${id}]` : '';
  const field = issue.field ? ` 字段 ${issue.field}` : '';
  return `${where}${who}${field}：${issue.msg}`;
}

// ---------- 分类 ----------

export function validateCategories(file) {
  const errors = [], warnings = [], categories = [];
  let records;
  try {
    records = readRecords(file);
  } catch (e) {
    return { categories, errors: [`${file}：无法读取（${e.message}）`], warnings };
  }
  const seen = new Map();
  for (const rec of records) {
    if (rec.error) { errors.push(formatIssue(file, rec, { msg: rec.error })); continue; }
    const c = rec.value, issues = [], warns = [];
    if (!isObj(c)) { errors.push(formatIssue(file, rec, { msg: '应为对象' })); continue; }
    const id = str(c.id);
    if (!id) issues.push({ field: 'id', msg: '必填' });
    else if (!ID_PATTERN.test(id)) issues.push({ field: 'id', msg: `只能包含 a-z、0-9 和 -，当前为 "${c.id}"` });
    else if (seen.has(id)) issues.push({ field: 'id', msg: `与第 ${seen.get(id)} 行重复` });
    else seen.set(id, rec.line);
    if (!Number.isInteger(c.sprite) || c.sprite < 0 || c.sprite >= SPRITE_COUNT) {
      issues.push({ field: 'sprite', msg: `应为 0–${SPRITE_COUNT - 1} 的整数` });
    }
    const out = { id, sprite: c.sprite }, fallback = [];
    for (const f of ['name', 'description']) out[f] = bilingualText(c[f], f, issues, warns, true, fallback);
    markFallback(out, fallback);
    errors.push(...issues.map((x) => formatIssue(file, rec, x, id)));
    warnings.push(...warns.map((x) => formatIssue(file, rec, x, id)));
    if (!issues.length) categories.push(out);
  }
  return { categories, errors, warnings };
}

// ---------- 单条羊毛 ----------

function bilingualText(v, field, issues, warns, warnMissingEn, fallback) {
  if (!isObj(v)) { issues.push({ field, msg: '必填，应为 {"zh": "...", "en": "..."}' }); return null; }
  const zh = str(v.zh), en = str(v.en);
  if (!zh) issues.push({ field: `${field}.zh`, msg: '中文必填' });
  if (v.en !== undefined && typeof v.en !== 'string') issues.push({ field: `${field}.en`, msg: '应为字符串' });
  checkLine(v.zh, `${field}.zh`, issues);
  checkLine(v.en, `${field}.en`, issues);
  if (!en && warnMissingEn) warns.push({ field: `${field}.en`, msg: MISSING_EN });
  if (!en && zh) fallback.push(field);
  return { zh, en: en || zh };
}

// 可选双语字段：不填为空串，不回退、不警告
function optionalText(v, field, issues) {
  if (v === undefined) return { zh: '', en: '' };
  if (!isObj(v)) { issues.push({ field, msg: '应为 {"zh": "...", "en": "..."}' }); return { zh: '', en: '' }; }
  for (const lang of ['zh', 'en']) {
    if (v[lang] !== undefined && typeof v[lang] !== 'string') issues.push({ field: `${field}.${lang}`, msg: '应为字符串' });
    checkLine(v[lang], `${field}.${lang}`, issues);
  }
  return { zh: str(v.zh), en: str(v.en) };
}

function bilingualList(v, field, issues, warns, fallback) {
  if (!isObj(v)) { issues.push({ field, msg: '必填，应为 {"zh": [...], "en": [...]}' }); return null; }
  const clean = (arr, lang) => {
    if (arr === undefined) return [];
    if (!Array.isArray(arr)) { issues.push({ field: `${field}.${lang}`, msg: '应为字符串数组' }); return []; }
    arr.forEach((s, i) => {
      if (!str(s)) issues.push({ field: `${field}.${lang}[${i}]`, msg: '应为非空字符串' });
      checkLine(s, `${field}.${lang}[${i}]`, issues);
    });
    return arr.map(str).filter(Boolean);
  };
  const zh = clean(v.zh, 'zh'), en = clean(v.en, 'en');
  if (!zh.length) issues.push({ field: `${field}.zh`, msg: '中文必填，至少一项' });
  if (!en.length) {
    warns.push({ field: `${field}.en`, msg: MISSING_EN });
    if (zh.length) fallback.push(field);
  } else if (zh.length && en.length !== zh.length) {
    warns.push({ field: `${field}.en`, msg: `英文 ${en.length} 项，中文 ${zh.length} 项，请核对是否漏译` });
  }
  return { zh, en: en.length ? en : zh };
}

// 可选的结构化标记：写了就必须合法；null 也算错
function validateFlags(raw, p, issues) {
  const has = (k) => Object.hasOwn(raw, k);
  for (const k of ['requiresCard', 'autoRenew']) {
    if (!has(k)) continue;
    if (typeof raw[k] !== 'boolean') issues.push({ field: k, msg: `应为 true 或 false；${UNKNOWN_HINT}，当前为 ${JSON.stringify(raw[k])}` });
    else p[k] = raw[k];
  }
  if (has('audience')) {
    if (!AUDIENCES.includes(raw.audience)) issues.push({ field: 'audience', msg: `应为 ${AUDIENCES.join(' / ')} 之一；${UNKNOWN_HINT}，当前为 ${JSON.stringify(raw.audience)}` });
    else p.audience = raw.audience;
  }
  if (has('regions')) {
    const r = raw.regions;
    const before = issues.length;
    if (!Array.isArray(r) || !r.length) {
      issues.push({ field: 'regions', msg: `应为非空数组，如 ["global"] 或 ["CN","HK"]；${UNKNOWN_HINT}，当前为 ${JSON.stringify(r)}` });
    } else if (r.includes('global')) {
      if (r.length !== 1) issues.push({ field: 'regions', msg: '"global" 只能单独出现' });
    } else {
      const names = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
      r.forEach((code, i) => {
        const ok = typeof code === 'string' && /^[A-Z]{2}$/.test(code) && !NON_REGION_CODES.has(code) && names.of(code) !== undefined;
        if (!ok) issues.push({ field: `regions[${i}]`, msg: `应为 ISO 3166-1 两位大写地区代码（如 CN、HK）或 "global"，当前为 ${JSON.stringify(code)}` });
      });
      if (new Set(r).size !== r.length) issues.push({ field: 'regions', msg: '有重复的地区代码' });
    }
    if (issues.length === before) p.regions = [...r];
  }
}

// 内部字段：校验后单独返回，不进入公开 perk
function validateInternal(raw, issues, warnings) {
  const internal = {};
  if (Object.hasOwn(raw, 'verifyMethod')) {
    if (!VERIFY_METHODS.includes(raw.verifyMethod)) issues.push({ field: 'verifyMethod', msg: `应为 ${VERIFY_METHODS.join(' / ')} 之一；${UNKNOWN_HINT}，当前为 ${JSON.stringify(raw.verifyMethod)}` });
    else internal.verifyMethod = raw.verifyMethod;
  }
  if (Object.hasOwn(raw, 'discoveredVia')) {
    const list = raw.discoveredVia;
    if (!Array.isArray(list) || !list.length) {
      issues.push({ field: 'discoveredVia', msg: `应为非空数组；${UNKNOWN_HINT}` });
    } else {
      list.forEach((d, i) => {
        const f = `discoveredVia[${i}]`;
        if (!isObj(d)) { issues.push({ field: f, msg: '应为对象 {type, url?, date, note?}' }); return; }
        for (const k of Object.keys(d)) if (!DISCOVERY_KEYS.has(k)) warnings.push({ field: `${f}.${k}`, msg: '未知子字段' });
        if (!DISCOVERY_TYPES.includes(d.type)) issues.push({ field: `${f}.type`, msg: `应为 ${DISCOVERY_TYPES.join(' / ')} 之一，当前为 ${JSON.stringify(d.type)}` });
        if (d.url === undefined) {
          if (d.type !== 'manual') issues.push({ field: `${f}.url`, msg: 'type 不是 manual 时必填' });
        } else if (!isHttpsUrl(d.url)) issues.push({ field: `${f}.url`, msg: `必须是 https:// 开头的有效链接，当前为 ${JSON.stringify(d.url)}` });
        if (d.date === undefined) issues.push({ field: `${f}.date`, msg: '必填，格式 YYYY-MM-DD' });
        else if (!isValidDate(d.date)) issues.push({ field: `${f}.date`, msg: `不是合法日期（YYYY-MM-DD），当前为 ${JSON.stringify(d.date)}` });
        if (d.note !== undefined && typeof d.note !== 'string') issues.push({ field: `${f}.note`, msg: '应为字符串' });
        checkLine(d.note, `${f}.note`, issues);
      });
      internal.discoveredVia = list;
    }
  }
  return internal;
}

/**
 * 校验一条羊毛。
 * @param raw 原始对象
 * @param categoryIds 已有分类 id 的 Set
 * @returns {perk, internal, issues, warnings}
 *   perk 只按公开字段构造（不含 INTERNAL_FIELDS），补齐英文回退；internal 是内部字段；issues 非空表示无效
 */
export function validatePerk(raw, categoryIds) {
  const issues = [], warnings = [];
  if (!isObj(raw)) return { perk: null, internal: null, issues: [{ msg: '应为 JSON 对象' }], warnings };

  for (const k of Object.keys(raw)) {
    if (!KNOWN.has(k)) warnings.push({ field: k, msg: '未知字段，已忽略' });
  }

  const p = {};
  p.id = str(raw.id);
  if (!p.id) issues.push({ field: 'id', msg: '必填' });
  else if (!ID_PATTERN.test(p.id)) issues.push({ field: 'id', msg: `只能包含 a-z、0-9 和 -，当前为 "${raw.id}"` });

  p.category = str(raw.category);
  if (!p.category) issues.push({ field: 'category', msg: '必填' });
  else if (!categoryIds.has(p.category)) {
    issues.push({ field: 'category', msg: `分类 "${p.category}" 不存在，可选：${[...categoryIds].join(', ')}` });
  }

  p.provider = str(raw.provider);
  if (!p.provider) issues.push({ field: 'provider', msg: '必填' });
  checkLine(raw.provider, 'provider', issues);

  const fallback = [];
  for (const f of TEXT_FIELDS) p[f] = bilingualText(raw[f], f, issues, warnings, true, fallback);
  for (const f of LIST_FIELDS) p[f] = bilingualList(raw[f], f, issues, warnings, fallback);
  p.keywords = optionalText(raw.keywords, 'keywords', issues);

  for (const f of ['url', 'source']) {
    p[f] = raw[f];
    if (!raw[f]) issues.push({ field: f, msg: '必填' });
    else if (!isHttpsUrl(raw[f])) issues.push({ field: f, msg: `必须是 https:// 开头的有效链接，当前为 "${raw[f]}"` });
  }
  p.sourceLabel = optionalText(raw.sourceLabel, 'sourceLabel', issues);
  markFallback(p, fallback);

  p.reviewed = raw.reviewed;
  if (!raw.reviewed) issues.push({ field: 'reviewed', msg: '必填，格式 YYYY-MM-DD' });
  else if (!isValidDate(raw.reviewed)) issues.push({ field: 'reviewed', msg: `不是合法日期（YYYY-MM-DD），当前为 "${raw.reviewed}"` });

  p.expires = raw.expires ?? null;
  const exp = parseExpires(p.expires);
  if (!exp.ok) {
    issues.push({ field: 'expires', msg: `应为 YYYY-MM-DD、带时区的 ISO 时间（如 2026-11-12T16:00:00Z）或 null，当前为 "${raw.expires}"` });
  } else {
    p.expiresAt = exp.at === null ? null : new Date(exp.at).toISOString();
    p.expiresKind = exp.kind;
  }

  validateFlags(raw, p, issues);
  const internal = validateInternal(raw, issues, warnings);

  const ok = !issues.length;
  return { perk: ok ? p : null, internal: ok ? internal : null, issues, warnings: collapseMissingEn(warnings) };
}

// 把多个「缺少英文」警告合并成一行，避免刷屏
function collapseMissingEn(warns) {
  const missing = warns.filter((w) => w.msg === MISSING_EN).map((w) => w.field.replace(/\.en$/, ''));
  const rest = warns.filter((w) => w.msg !== MISSING_EN);
  if (missing.length) rest.push({ msg: `缺少英文（${missing.join(', ')}），英文页将显示中文` });
  return rest;
}

// 按固定字段顺序序列化成一行 JSONL（保存原始输入，不写入英文回退值）
export function serializePerk(raw) {
  const out = {};
  for (const k of FIELD_ORDER) {
    if (k === 'expires') out.expires = raw.expires ?? null;
    else if (raw[k] !== undefined) out[k] = raw[k];
  }
  return JSON.stringify(out);
}

// ---------- 整个数据集（build 使用） ----------

export function loadDataset({ categoriesFile = 'data/categories.json', perksFile = 'data/perks.jsonl' } = {}) {
  const cat = validateCategories(categoriesFile);
  const errors = [...cat.errors], warnings = [...cat.warnings], perks = [];
  const internalUrls = new Set(); // 只用于构建后的泄露检查
  const categoryIds = new Set(cat.categories.map((c) => c.id));
  let records;
  try {
    records = parseJsonl(fs.readFileSync(perksFile, 'utf8'));
  } catch (e) {
    return { categories: cat.categories, perks, internalUrls, errors: [...errors, `${perksFile}：无法读取（${e.message}）`], warnings };
  }
  const seen = new Map();
  for (const rec of records) {
    if (rec.error) { errors.push(formatIssue(perksFile, rec, { msg: rec.error })); continue; }
    const { perk, internal, issues, warnings: w } = validatePerk(rec.value, categoryIds);
    const id = rec.value?.id;
    if (typeof id === 'string' && id) {
      if (seen.has(id)) issues.push({ field: 'id', msg: `与第 ${seen.get(id)} 行重复` });
      else seen.set(id, rec.line);
    }
    errors.push(...issues.map((x) => formatIssue(perksFile, rec, x, id)));
    warnings.push(...w.map((x) => formatIssue(perksFile, rec, x, id)));
    if (perk && !issues.length) {
      perks.push(perk);
      for (const d of internal.discoveredVia ?? []) if (d.url) internalUrls.add(d.url);
    }
  }
  return { categories: cat.categories, perks, internalUrls, errors, warnings };
}
