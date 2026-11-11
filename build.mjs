#!/usr/bin/env node
// 构建静态站点到 dist/。零 npm 依赖，只用 Node 内置模块。
//   node build.mjs
//   SITE_URL=https://example.com/perk-atlas/ node build.mjs   # 可选：生成绝对 canonical / hreflang
//   BUILD_DATE=2026-12-01 node build.mjs                       # 可选：按指定日期（北京时间 00:00）判断过期
//   BUILD_DATE=2026-11-12T16:00:00Z node build.mjs             # 也可以给带时区的时刻
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDataset, isExpired, isHttpsUrl, buildNow, dateInZone } from './lib/validate.mjs';
import { findLeaks } from './lib/leak-check.mjs';

process.chdir(path.dirname(fileURLToPath(import.meta.url)));
const OUT = 'dist';

// ---------- 数据 ----------
let now;
try {
  now = buildNow();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
const date = dateInZone(now);
const { categories, perks, internalUrls, errors, warnings } = loadDataset();
for (const w of warnings) console.warn(`警告 ${w}`);
if (errors.length) {
  console.error(`数据校验失败，共 ${errors.length} 处错误：`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}
const visible = perks.filter((p) => !isExpired(p, now));
const expiredCount = perks.length - visible.length;
const updated = visible.reduce((max, p) => (p.reviewed > max ? p.reviewed : max), '') || date;
const catById = new Map(categories.map((c) => [c.id, c]));

let SITE_URL = '';
if (process.env.SITE_URL) {
  try {
    const u = new URL(process.env.SITE_URL);
    if (!/^https?:$/.test(u.protocol)) throw new Error('protocol');
    SITE_URL = u.href.endsWith('/') ? u.href : `${u.href}/`;
  } catch {
    console.error(`SITE_URL 不是合法的 http(s) 地址：${process.env.SITE_URL}`);
    process.exit(1);
  }
}

// ---------- 转义 ----------
const esc = (s) => String(s)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
// 外部链接只允许 https（数据已校验，这里再兜底一次）
const href = (u) => {
  if (!isHttpsUrl(u)) throw new Error(`拒绝输出非 https 链接：${u}`);
  return esc(u);
};
// 写进 Markdown / llms.txt 的数据：转义 & < >，避免被渲染器当成 HTML
const mdEsc = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
// 英文页上回退显示的中文：包一层 lang="zh-CN"
const isFallback = (obj, field, lang) => lang === 'en' && Boolean(obj.fallbackEn?.has(field));
const txt = (obj, field, lang, value = obj[field][lang]) => (isFallback(obj, field, lang)
  ? `<span lang="zh-CN">${esc(value)}</span>` : esc(value));
// 写进 <script> 的 JSON：转义 < > & 和 JS 行分隔符，防止提前闭合标签
const jsonForScript = (v) => JSON.stringify(v)
  .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
  .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

// ---------- 界面文字 ----------
const T = {
  zh: {
    htmlLang: 'zh-CN', site: '羊毛星图', siteAlt: 'PERK ATLAS', siteAltLang: 'en',
    switchText: 'EN', switchLabel: 'English',
    skip: '跳到正文', navLabel: '主导航', all: '全部资源', aiIndex: 'AI 索引',
    homeTitle: '羊毛星图 · 免费资源，一目了然', homeDesc: '按类别发现免费资源，先把条件看清再开始。',
    eyebrow: 'THE FREE RESOURCE ATLAS', hero: ['免费资源，', '一目了然。'], lead: ['按类别发现。', '把条件看清，再开始。'],
    hint: '选择一个星体，展开资源目录 →', mapLabel: '资源分类',
    dirTitle: '资源目录', dirDocTitle: '资源目录 · 羊毛星图', dirDesc: '全部免费资源，可按分类筛选和搜索。', dirEyebrow: 'EXPLORE THE ATLAS',
    searchPh: '搜索名称、用途或条件…', searchLabel: '搜索资源', filterLabel: '按分类筛选', filterAll: '全部',
    count: '显示 {n} 项', empty: '没有找到匹配资源。', reset: '清除筛选', close: '关闭详情',
    back: '← 返回资源目录', eligibility: '适用条件', limits: '约束与费用', validity: '有效时间', expiresOn: '到期日：',
    steps: '领取步骤', open: '打开官方入口', newTab: '（在新标签页打开）', copy: '复制给 AI',
    copyOk: '已复制，可粘贴给你的 AI。', copyFail: '复制失败，已选中下方摘要，请手动复制。',
    fullSummary: '完整 AI 摘要', reviewed: '核验于', source: '查看来源',
    docTitle: (name) => `${name} · 羊毛星图`,
    colon: '：', sep: '；', stepSep: ' → ',
    sum: { marks: '条件标记', benefit: '权益', eligibility: '适用条件', constraints: '限制', cost: '费用', deadline: '截止', expires: '到期', steps: '步骤', url: '入口', source: '来源', reviewed: '核验' },
    footerOne: '{n} 项资源 · 官方来源已查阅', footerOther: '{n} 项资源 · 官方来源已查阅',
    expiryDate: (d) => `${d}（北京时间当天结束）`,
    expiryInstant: (ms) => `${new Date(ms + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ')}（北京时间）`,
    expiredNote: '已过期：这条羊毛已经结束，仅作存档。',
    badgesLabel: '条件标记', flagsLabel: '条件筛选',
    noCard: '无需绑卡', noCardTitle: '只显示明确无需绑卡的（未标注是否需要绑卡的不显示）',
    card: { true: '需绑卡', false: '无需绑卡' }, renew: { true: '到期自动扣费', false: '不自动扣费' },
    audience: { all: '不限身份', student: '限学生', developer: '限开发者计划', 'new-user': '限新用户', enterprise: '限企业机构' },
    worldwide: '全球可用', regionsOnly: (names) => `仅限：${names.join('、')}`,
    footer2: '按条件使用 · 更新于 ', fmtDate: (d) => d.replaceAll('-', '.'),
    mdTitle: '羊毛星图资源索引',
    mdIntro: (n, d) => `共 ${n} 项，更新于 ${d}。官方条款已查阅，未实测领取。英文版见 en/resources.md。`,
  },
  en: {
    htmlLang: 'en', site: 'Perk Atlas', siteAlt: '羊毛星图', siteAltLang: 'zh-CN',
    switchText: '中文', switchLabel: '中文',
    skip: 'Skip to content', navLabel: 'Main', all: 'All resources', aiIndex: 'AI index',
    homeTitle: 'Perk Atlas · Free resources at a glance', homeDesc: 'Browse free resources by category. Read the conditions before you start.',
    eyebrow: 'THE FREE RESOURCE ATLAS', hero: ['Free resources,', 'at a glance.'], lead: ['Browse by category.', 'Read the conditions, then begin.'],
    hint: 'Pick a sphere to open the directory →', mapLabel: 'Categories',
    dirTitle: 'Directory', dirDocTitle: 'Directory · Perk Atlas', dirDesc: 'All free resources, searchable and filterable by category.', dirEyebrow: 'EXPLORE THE ATLAS',
    searchPh: 'Search names, uses or conditions…', searchLabel: 'Search resources', filterLabel: 'Filter by category', filterAll: 'All',
    count: '{n} shown', empty: 'No matching resources.', reset: 'Clear filters', close: 'Close details',
    back: '← Back to directory', eligibility: 'Eligibility', limits: 'Limits & cost', validity: 'Validity', expiresOn: 'Expires: ',
    steps: 'How to claim', open: 'Open official page', newTab: ' (opens in a new tab)', copy: 'Copy for AI',
    copyOk: 'Copied. Paste it into your AI assistant.', copyFail: 'Copy failed. The summary below is selected; copy it manually.',
    fullSummary: 'Full AI summary', reviewed: 'Reviewed', source: 'View source',
    docTitle: (name) => `${name} · Perk Atlas`,
    colon: ': ', sep: '; ', stepSep: ' → ',
    sum: { marks: 'Conditions', benefit: 'Benefit', eligibility: 'Eligibility', constraints: 'Limits', cost: 'Cost', deadline: 'Deadline', expires: 'Expires', steps: 'Steps', url: 'Link', source: 'Source', reviewed: 'Reviewed' },
    footerOne: '{n} resource · official sources reviewed', footerOther: '{n} resources · official sources reviewed',
    expiryDate: (d) => `${d} (end of day, Beijing time, UTC+8)`,
    expiryInstant: (ms) => `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    expiredNote: 'Expired: this offer has ended. Kept for reference.',
    badgesLabel: 'Conditions', flagsLabel: 'Conditions',
    noCard: 'No card', noCardTitle: 'Only offers confirmed to need no card (entries without card info are hidden)',
    card: { true: 'Card required', false: 'No card' }, renew: { true: 'Auto-renews', false: 'No auto-charge' },
    audience: { all: 'Open to all', student: 'Students', developer: 'Developer program', 'new-user': 'New users', enterprise: 'Organizations' },
    worldwide: 'Worldwide', regionsOnly: (names) => `Only: ${names.join(', ')}`,
    footer2: 'Check conditions before use · Updated ', fmtDate: (d) => d,
    mdTitle: 'Perk Atlas resource index',
    mdIntro: (n, d) => `${n} entries, updated ${d}. Official terms reviewed; redemption not tested. Chinese version: ../resources.md.`,
  },
};
const LANGS = Object.keys(T);
const other = (lang) => (lang === 'zh' ? 'en' : 'zh');

// ---------- 路径：全部用相对路径，站点可放在任意子路径 ----------
// 站内页面用「站点根下的绝对路径」表示（如 /en/resources/gimp.html），输出时转成相对路径。
const prefix = (lang) => (lang === 'zh' ? '/' : '/en/');
const pageUrl = (lang, page) => prefix(lang) + page;
// 目录地址一律补成 index.html，双击打开（file://）时也能跳到页面而不是目录列表
function rel(from, to) {
  const dir = from.endsWith('/') ? from : path.posix.dirname(from);
  const target = to.endsWith('/') ? `${to}index.html` : to;
  return path.posix.relative(dir, target) || path.posix.basename(target);
}
const absolute = (p) => SITE_URL + p.slice(1);

// ---------- 到期时间与条件标记 ----------
// 静态文字永远带时区：日期型按北京时间当天结束；时刻型中文按北京时间、英文按 UTC
function formatExpiry(p, lang) {
  if (p.expiresKind === 'date') return T[lang].expiryDate(p.expires);
  if (p.expiresKind === 'instant') return T[lang].expiryInstant(Date.parse(p.expiresAt));
  return '';
}

const regionNames = {};
function regionName(code, lang) {
  regionNames[lang] ??= new Intl.DisplayNames([T[lang].htmlLang], { type: 'region' });
  return regionNames[lang].of(code);
}

// where = 'row'（目录行，只放需要提醒的）或 'detail'（全部已知值）；字段缺失就不出
function badgeTexts(p, lang, where) {
  const t = T[lang], row = where === 'row', out = [];
  if (p.requiresCard !== undefined) out.push(t.card[p.requiresCard]);
  if (p.autoRenew !== undefined && (!row || p.autoRenew)) out.push(t.renew[p.autoRenew]);
  if (p.audience !== undefined && (!row || p.audience !== 'all')) out.push(t.audience[p.audience]);
  if (p.regions !== undefined) {
    if (p.regions[0] === 'global') { if (!row) out.push(t.worldwide); }
    else out.push(t.regionsOnly(p.regions.map((c) => regionName(c, lang))));
  }
  return out;
}
function badgesHtml(p, lang, where) {
  const items = badgeTexts(p, lang, where);
  if (!items.length) return '';
  return `<ul class="badges" aria-label="${esc(T[lang].badgesLabel)}">${items.map((s) => `<li class="badge">${esc(s)}</li>`).join('')}</ul>`;
}
const expiresAttr = (p) => (p.expiresAt ? ` data-expires="${esc(p.expiresAt)}"` : '');

// ---------- 文本摘要（复制给 AI / Markdown 共用） ----------
// 每行：[标签, 值, 值来自哪个数据字段（用于回退标记）, 值前缀]
function summaryFields(p, lang) {
  const t = T[lang], s = t.sum, L = (k) => p[k][lang];
  const marks = badgeTexts(p, lang, 'detail');
  const rows = marks.length ? [[s.marks, marks.join(t.sep)]] : [];
  rows.push(
    [s.benefit, L('benefit'), 'benefit'],
    [s.eligibility, L('eligibility'), 'eligibility'],
    [s.constraints, L('constraints').join(t.sep), 'constraints'],
    [s.cost, L('cost'), 'cost'],
    [s.deadline, L('deadline'), 'deadline'],
  );
  if (p.expiresKind !== 'none') rows.push([s.expires, formatExpiry(p, lang)]);
  rows.push(
    [s.steps, L('steps').join(t.stepSep), 'steps'],
    [s.url, p.url],
    [s.source, p.source],
    [s.reviewed, L('verification'), 'verification', `${p.reviewed} `],
  );
  return rows;
}
const summaryText = (p, lang) => [p.name[lang], ...summaryFields(p, lang)
  .map(([k, v, , pre = '']) => `${k}${T[lang].colon}${pre}${v}`)].join('\n');
// 页面里的摘要：内容与 summaryText 相同，只是回退的中文片段带 lang 标记
const summaryHtml = (p, lang) => [txt(p, 'name', lang), ...summaryFields(p, lang)
  .map(([k, v, f, pre = '']) => esc(`${k}${T[lang].colon}${pre}`) + (f ? txt(p, f, lang, v) : esc(v)))].join('\n');

// ---------- HTML 片段 ----------
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";

// 页脚条目数：和 app.js 同一规则（n === 1 用 one 模板，其他用 other），无 JS 时也正确
const countText = (t, n) => (n === 1 ? t.footerOne : t.footerOther).replace('{n}', String(n));

function layout({ lang, page, title, description, main, extra = '' }) {
  const t = T[lang], o = other(lang);
  const here = pageUrl(lang, page);
  const r = (to) => esc(rel(here, to));
  const alt = (l) => (SITE_URL ? esc(absolute(pageUrl(l, page))) : r(pageUrl(l, page)));
  const current = (p) => (p === page ? ' aria-current="page"' : '');
  return `<!doctype html>
<html lang="${t.htmlLang}" class="no-js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${esc(CSP)}">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#e9f0fa">
${SITE_URL ? `<link rel="canonical" href="${alt(lang)}">\n` : ''}<link rel="alternate" hreflang="zh-CN" href="${alt('zh')}">
<link rel="alternate" hreflang="en" href="${alt('en')}">
<link rel="alternate" hreflang="x-default" href="${alt('zh')}">
<link rel="icon" href="${r('/favicon.svg')}" type="image/svg+xml">
<link rel="stylesheet" href="${r('/styles.css')}">
</head>
<body>
<a class="skip" href="#main">${esc(t.skip)}</a>
<header class="site-header">
<a class="brand" href="${r(pageUrl(lang, ''))}"${current('')}><b>${esc(t.site)}</b> <small lang="${t.siteAltLang}">${esc(t.siteAlt)}</small></a>
<nav class="site-nav" aria-label="${esc(t.navLabel)}">
<a class="pill" href="${r(pageUrl(lang, 'directory.html'))}"${current('directory.html')}>${esc(t.all)}</a>
<a class="nav-link" href="${r(pageUrl(lang, 'resources.md'))}">${esc(t.aiIndex)}</a>
<a class="pill lang-switch" href="${r(pageUrl(o, page))}" hreflang="${T[o].htmlLang}" lang="${T[o].htmlLang}" aria-label="${esc(t.switchLabel)}" data-lang-switch>${esc(t.switchText)}</a>
</nav>
</header>
<main id="main">
${main}
</main>
<footer class="site-footer"><span data-visible-count data-one="${esc(t.footerOne)}" data-other="${esc(t.footerOther)}">${esc(countText(t, visible.length))}</span><span>${esc(t.footer2)}<time class="nowrap" datetime="${esc(updated)}">${esc(t.fmtDate(updated))}</time></span></footer>
${extra}<script src="${r('/app.js')}" defer></script>
</body>
</html>
`;
}

function detailBody(p, lang, level) {
  const t = T[lang], L = (k) => p[k][lang];
  const h = `h${level}`, sub = `h${level + 1}`;
  const titleId = level === 2 ? ' id="detail-title"' : '';
  const T_ = (f) => txt(p, f, lang);
  const list = (tag, f) => {
    const li = isFallback(p, f, lang) ? '<li lang="zh-CN">' : '<li>';
    return `<${tag}>${L(f).map((s) => `${li}${esc(s)}</li>`).join('')}</${tag}>`;
  };
  const ext = `target="_blank" rel="noopener noreferrer"`;
  const sourceText = p.sourceLabel[lang] || t.source;
  const expiryTime = p.expiresKind === 'instant'
    ? `<time datetime="${esc(p.expiresAt)}" data-local-time>${esc(formatExpiry(p, lang))}</time>`
    : `<time datetime="${esc(p.expires)}">${esc(formatExpiry(p, lang))}</time>`;
  const badges = badgesHtml(p, lang, 'detail');
  return `<article class="detail" data-perk="${esc(p.id)}"${expiresAttr(p)}>
<p class="eyebrow">${esc(p.provider)} / ${T_('tag')}</p>
<${h} class="detail-title"${titleId}>${T_('name')}</${h}>
${badges ? `${badges}\n` : ''}${p.expiresAt ? `<p class="expired-note" data-expired-note hidden>${esc(t.expiredNote)}</p>\n` : ''}<p>${T_('benefit')}</p>
<${sub} class="detail-sub">${esc(t.eligibility)}</${sub}>
<p>${T_('eligibility')}</p>
<${sub} class="detail-sub">${esc(t.limits)}</${sub}>
${list('ul', 'constraints')}
<p>${T_('cost')}</p>
<${sub} class="detail-sub">${esc(t.validity)}</${sub}>
<p>${T_('deadline')}</p>
${p.expiresKind !== 'none' ? `<p>${esc(t.expiresOn)}${expiryTime}</p>\n` : ''}<${sub} class="detail-sub">${esc(t.steps)}</${sub}>
${list('ol', 'steps')}
<div class="actions">
<a class="primary" href="${href(p.url)}" ${ext}>${esc(t.open)} <span aria-hidden="true">↗</span><span class="visually-hidden">${esc(t.newTab)}</span></a>
<button type="button" class="pill needs-js" data-copy data-ok="${esc(t.copyOk)}" data-fail="${esc(t.copyFail)}">${esc(t.copy)}</button>
</div>
<p class="meta">${esc(t.reviewed)} <time datetime="${esc(p.reviewed)}">${esc(p.reviewed)}</time> · ${T_('verification')} <a class="source-link" href="${href(p.source)}" ${ext}>${esc(sourceText)} <span aria-hidden="true">↗</span><span class="visually-hidden">${esc(t.newTab)}</span></a></p>
<details><summary>${esc(t.fullSummary)}</summary><pre data-summary>${summaryHtml(p, lang)}</pre></details>
<p class="copy-status" role="status" data-copy-status></p>
</article>`;
}

// ---------- 页面 ----------
function homePage(lang) {
  const t = T[lang], o = other(lang);
  const nodes = categories.map((c) => `<a class="node" href="directory.html?category=${esc(encodeURIComponent(c.id))}">`
    + `<span class="sprite s${Number(c.sprite)}" aria-hidden="true"></span>`
    + `<strong>${txt(c, 'name', lang)}</strong>`
    // 中文页这里显示英文名；英文名缺失回退时它其实是中文
    + `<small lang="${o === 'en' && c.fallbackEn.has('name') ? 'zh-CN' : T[o].htmlLang}">${esc(c.name[o])}</small>`
    + `<span class="desc">${txt(c, 'description', lang)}</span></a>`).join('\n');
  const main = `<div class="hero">
<div class="intro">
<p class="eyebrow">${esc(t.eyebrow)}</p>
<h1>${t.hero.map(esc).join('<br>')}</h1>
<p class="lead">${t.lead.map(esc).join('<br>')}</p>
<p>${esc(t.hint)}</p>
</div>
<nav class="map" aria-label="${esc(t.mapLabel)}">
<span class="orbit" aria-hidden="true"></span>
${nodes}
</nav>
</div>`;
  return layout({ lang, page: '', title: t.homeTitle, description: t.homeDesc, main });
}

function searchText(p, lang) {
  const o = other(lang), L = (k) => p[k][lang];
  return [
    p.id, p.provider, catById.get(p.category).name[lang],
    L('name'), L('tag'), L('summary'), L('benefit'), L('eligibility'), L('cost'), L('deadline'),
    ...L('constraints'), ...L('steps'), p.keywords[lang], ...badgeTexts(p, lang, 'detail'),
    p.name[o], // 也能搜到另一语言的名称
  ].join(' ').normalize('NFKC').toLowerCase();
}

function directoryPage(lang) {
  const t = T[lang];
  const chips = [`<button type="button" class="pill" data-filter="all" aria-pressed="true">${esc(t.filterAll)}</button>`,
    ...categories.map((c) => `<button type="button" class="pill" data-filter="${esc(c.id)}" aria-pressed="false">${txt(c, 'name', lang)}</button>`)];
  const rows = visible.map((p) => `<a class="row" href="resources/${esc(p.id)}.html" data-id="${esc(p.id)}" data-category="${esc(p.category)}"`
    + `${p.requiresCard !== undefined ? ` data-card="${p.requiresCard}"` : ''}${expiresAttr(p)}>`
    + `<div class="row-head"><h2>${txt(p, 'name', lang)}</h2>`
    + `<div class="row-meta"><span class="tag">${txt(p, 'tag', lang)}</span>${badgesHtml(p, lang, 'row')}</div></div>`
    + `<p>${txt(p, 'summary', lang)}</p></a>`).join('\n');
  const main = `<div class="catalog">
<p class="eyebrow">${esc(t.dirEyebrow)}</p>
<h1>${esc(t.dirTitle)}</h1>
<div class="needs-js">
<label class="visually-hidden" for="search">${esc(t.searchLabel)}</label>
<input class="search" id="search" type="search" placeholder="${esc(t.searchPh)}" autocomplete="off">
<div class="filters" role="group" aria-label="${esc(t.filterLabel)}">
${chips.join('\n')}
</div>
<div class="filters filters-flags" role="group" aria-label="${esc(t.flagsLabel)}">
<button type="button" class="pill" data-flag="nocard" aria-pressed="false" title="${esc(t.noCardTitle)}">${esc(t.noCard)}</button>
</div>
<p class="result-count" id="result-count" role="status" data-template="${esc(t.count)}"></p>
</div>
<div class="rows" id="rows">
${rows}
</div>
<p class="empty" id="empty" hidden>${esc(t.empty)} <button type="button" class="pill" id="reset">${esc(t.reset)}</button></p>
</div>`;
  const templates = visible.map((p) => `<template id="tpl-${esc(p.id)}">${detailBody(p, lang, 2)}</template>`).join('\n');
  const index = Object.fromEntries(visible.map((p) => [p.id, searchText(p, lang)]));
  const extra = `<dialog id="detail" aria-labelledby="detail-title"><div class="dialog-body">`
    + `<button type="button" class="close" aria-label="${esc(t.close)}"><span aria-hidden="true">✕</span></button>`
    + `<div id="detail-content"></div></div></dialog>
${templates}
<script type="application/json" id="search-index">${jsonForScript(index)}</script>
`;
  return layout({ lang, page: 'directory.html', title: t.dirDocTitle, description: t.dirDesc, main, extra });
}

function resourcePage(p, lang) {
  const t = T[lang];
  const main = `<div class="standalone">
<a class="back" href="../directory.html">${esc(t.back)}</a>
${detailBody(p, lang, 1)}
</div>`;
  return layout({ lang, page: `resources/${p.id}.html`, title: t.docTitle(p.name[lang]), description: p.summary[lang], main });
}

function markdown(lang) {
  const t = T[lang];
  const e = mdEsc;
  const out = [`# ${t.mdTitle}`, '', t.mdIntro(visible.length, e(updated))];
  for (const c of categories) {
    const items = visible.filter((p) => p.category === c.id);
    if (!items.length) continue;
    out.push('', `## ${e(c.name[lang])}`);
    for (const p of items) {
      out.push('', `### ${e(p.name[lang])}`, '', `${e(p.provider)} · ${e(p.tag[lang])} · ${e(p.summary[lang])}`, '');
      for (const [k, v, , pre = ''] of summaryFields(p, lang)) out.push(`- ${k}${t.colon}${e(pre + v)}`);
    }
  }
  return `${out.join('\n')}\n`;
}

function llmsTxt() {
  return `# Perk Atlas (羊毛星图)

> Static, curated directory of free resources and perks, in Chinese and English. Official terms were reviewed; redemption was not tested. ${visible.length} entries, updated ${mdEsc(updated)}.

## Data
- [Readable index, Chinese](resources.md)
- [Readable index, English](en/resources.md)
- [Structured data, bilingual JSON](resources.json)

## Pages
- [Directory, Chinese](directory.html)
- [Directory, English](en/directory.html)
`;
}

function resourcesJson() {
  return `${JSON.stringify({
    name: { zh: T.zh.site, en: T.en.site },
    updated,
    generated: date,
    count: visible.length,
    categories: categories.map(({ id, name, description }) => ({ id, name, description })),
    resources: visible.map((p) => ({
      ...p,
      pages: { zh: `resources/${p.id}.html`, en: `en/resources/${p.id}.html` },
    })),
  }, null, 2)}\n`;
}

// ---------- 输出 ----------
fs.rmSync(OUT, { recursive: true, force: true });
function write(urlPath, content) {
  const file = path.join(OUT, urlPath.endsWith('/') ? `${urlPath}index.html` : urlPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

for (const lang of LANGS) {
  write(pageUrl(lang, ''), homePage(lang));
  write(pageUrl(lang, 'directory.html'), directoryPage(lang));
  for (const p of visible) write(pageUrl(lang, `resources/${p.id}.html`), resourcePage(p, lang));
  write(pageUrl(lang, 'resources.md'), markdown(lang));
}
write('/resources.json', resourcesJson());
write('/llms.txt', llmsTxt());

for (const f of ['styles.css', 'app.js', 'favicon.svg']) fs.copyFileSync(path.join('src', f), path.join(OUT, f));
if (fs.existsSync('assets')) fs.cpSync('assets', path.join(OUT, 'assets'), { recursive: true });
if (!fs.existsSync(path.join(OUT, 'assets/glass-atlas.webp'))) {
  console.warn('警告 缺少 assets/glass-atlas.webp，星体将显示为纯 CSS 渐变球。见 README「星体图」。');
}

// 兜底：内部字段和内部 URL 不得出现在产物里。命中就删掉 dist/，避免被误部署
const publicUrls = new Set(perks.flatMap((p) => [p.url, p.source]));
const leaks = findLeaks(OUT, internalUrls, publicUrls);
if (leaks.length) {
  console.error(`内部字段泄露到产物，共 ${leaks.length} 处（已删除 ${OUT}/）：`);
  for (const l of leaks) console.error(`  ${l}`);
  fs.rmSync(OUT, { recursive: true, force: true });
  process.exit(1);
}

console.log(`构建完成：${visible.length} 条上线，${expiredCount} 条已过期未显示（判断时刻 ${new Date(now).toISOString()}，北京时间 ${date}），更新日期 ${updated}。`);
console.log(`输出：${OUT}/（${LANGS.length} 种语言 × ${visible.length + 2} 页）`);
