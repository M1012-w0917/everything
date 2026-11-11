// 羊毛星图前端脚本：复制摘要、目录筛选与搜索、详情弹窗、到期检查、本地时间显示。
// 没有 JS 时所有页面仍可阅读：目录条目是普通链接，指向独立详情页；到期时间显示带时区的静态文字。
(() => {
  'use strict';
  const root = document.documentElement;
  root.classList.remove('no-js');
  root.classList.add('js');

  // ---------- 到期 ----------
  // 构建时已过滤过期条目；这里处理「构建之后才到期」的情况
  const isPast = (el) => Boolean(el.dataset.expires) && Date.parse(el.dataset.expires) <= Date.now();

  function markExpired(scope) {
    for (const article of scope.querySelectorAll('article.detail[data-expires]')) {
      const past = isPast(article);
      article.classList.toggle('is-expired', past);
      const note = article.querySelector('[data-expired-note]');
      if (note) note.hidden = !past;
    }
  }

  // 时刻型到期时间换成读者本地时间；静态文字（带北京时间/UTC）留在 title 里
  let timeFormat = null;
  function localizeTimes(scope) {
    for (const el of scope.querySelectorAll('time[data-local-time]')) {
      if (el.dataset.localized) continue;
      const d = new Date(el.dateTime);
      if (Number.isNaN(d.getTime())) continue;
      try {
        timeFormat ??= new Intl.DateTimeFormat(root.lang, {
          year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
          hourCycle: 'h23', timeZoneName: 'short',
        });
        // 时区缩写统一放到最后（zh-CN 默认会夹在日期和时刻中间）
        const parts = timeFormat.formatToParts(d);
        const zone = parts.find((p) => p.type === 'timeZoneName');
        const rest = parts.filter((p) => p !== zone).map((p) => p.value).join('').replace(/\s+/g, ' ').trim();
        const text = zone ? `${rest} ${zone.value}` : rest;
        el.title = el.textContent;
        el.textContent = text;
        el.dataset.localized = '1';
      } catch {
        return; // 不支持 Intl 时保留静态文字
      }
    }
  }

  markExpired(document);
  localizeTimes(document);

  // ---------- 复制给 AI ----------
  // 按钮所在的 [data-perk] 容器里有摘要 <pre> 和状态提示，弹窗和详情页共用。
  async function copySummary(button) {
    const scope = button.closest('[data-perk]');
    const pre = scope.querySelector('[data-summary]');
    const status = scope.querySelector('[data-copy-status]');
    try {
      if (!navigator.clipboard || !window.isSecureContext) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(pre.textContent);
      status.textContent = button.dataset.ok;
    } catch {
      const details = pre.closest('details');
      if (details) details.open = true;
      const range = document.createRange();
      range.selectNodeContents(pre);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      status.textContent = button.dataset.fail;
    }
  }
  document.addEventListener('click', (e) => {
    const button = e.target.closest('[data-copy]');
    if (button) copySummary(button);
  });

  // ---------- 目录页 ----------
  const list = document.getElementById('rows');
  if (!list) {
    document.addEventListener('visibilitychange', () => { if (!document.hidden) markExpired(document); });
    return;
  }

  const indexEl = document.getElementById('search-index');
  const index = indexEl ? JSON.parse(indexEl.textContent) : {};
  const input = document.getElementById('search');
  const rows = [...list.querySelectorAll('.row')];
  const chips = [...document.querySelectorAll('[data-filter]')];
  const noCardBtn = document.querySelector('[data-flag="nocard"]');
  const empty = document.getElementById('empty');
  const count = document.getElementById('result-count');
  const visibleCounts = [...document.querySelectorAll('[data-visible-count]')];
  const langLink = document.querySelector('[data-lang-switch]');
  const langBase = langLink ? langLink.getAttribute('href').split('?')[0] : '';
  const valid = new Set(chips.map((c) => c.dataset.filter));
  const norm = (s) => s.normalize('NFKC').toLowerCase();

  const params = new URLSearchParams(location.search);
  let category = valid.has(params.get('category')) ? params.get('category') : 'all';
  let noCard = params.get('nocard') === '1';
  if (params.get('q')) input.value = params.get('q');

  function syncUrl() {
    const p = new URLSearchParams();
    if (category !== 'all') p.set('category', category);
    const q = input.value.trim();
    if (q) p.set('q', q);
    if (noCard) p.set('nocard', '1');
    const qs = p.toString() ? `?${p}` : '';
    // file:// 等环境下改地址栏可能失败，不能影响筛选
    try {
      history.replaceState(null, '', location.pathname + qs + location.hash);
    } catch { /* 忽略 */ }
    // 语言切换后停在同一页面、同一筛选
    if (langLink) langLink.setAttribute('href', langBase + qs);
  }

  function apply() {
    const terms = norm(input.value).trim().split(/\s+/).filter(Boolean);
    let n = 0, live = 0;
    for (const row of rows) {
      const past = isPast(row);
      if (!past) live++;
      const text = index[row.dataset.id] || '';
      const show = !past
        && (category === 'all' || row.dataset.category === category)
        && (!noCard || row.dataset.card === 'false')
        && terms.every((t) => text.includes(t));
      row.hidden = !show;
      if (show) n++;
    }
    empty.hidden = n > 0;
    count.textContent = count.dataset.template.replace('{n}', String(n));
    for (const el of visibleCounts) {
      const tpl = live === 1 ? el.dataset.one : el.dataset.other;
      if (tpl) el.textContent = tpl.replace('{n}', String(live));
    }
    for (const chip of chips) chip.setAttribute('aria-pressed', String(chip.dataset.filter === category));
    if (noCardBtn) noCardBtn.setAttribute('aria-pressed', String(noCard));
    syncUrl();
  }

  input.addEventListener('input', apply);
  for (const chip of chips) {
    chip.addEventListener('click', () => { category = chip.dataset.filter; apply(); });
  }
  if (noCardBtn) noCardBtn.addEventListener('click', () => { noCard = !noCard; apply(); });
  document.getElementById('reset').addEventListener('click', () => {
    category = 'all';
    noCard = false;
    input.value = '';
    apply();
    input.focus();
  });

  // ---------- 详情弹窗 ----------
  const dialog = document.getElementById('detail');
  const content = document.getElementById('detail-content');
  let trigger = null;

  if (dialog && typeof dialog.showModal === 'function') {
    list.addEventListener('click', (e) => {
      const link = e.target.closest('a.row');
      if (!link || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      const tpl = document.getElementById(`tpl-${link.dataset.id}`);
      if (!tpl) return;
      e.preventDefault();
      trigger = link;
      content.replaceChildren(tpl.content.cloneNode(true));
      markExpired(content);
      localizeTimes(content);
      dialog.showModal();
      dialog.querySelector('.close').focus();
    });
    dialog.querySelector('.close').addEventListener('click', () => dialog.close());
    // 点击遮罩关闭（内容区有自己的容器，点在容器外才算遮罩）
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
    // Esc 由浏览器原生处理；关闭后焦点回到触发的条目
    dialog.addEventListener('close', () => {
      content.replaceChildren();
      if (trigger) trigger.focus();
      trigger = null;
    });
  }

  // 回到前台时重新检查到期
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    markExpired(document);
    apply();
  });

  apply();
})();
