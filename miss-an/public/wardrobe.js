const key = 'miss-an:wardrobe:test:v1';
const esc = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
const read = () => JSON.parse(localStorage.getItem(key)) ?? [];
const ownerName = row => row.owner || '未設定';
const format = value => new Date(value).toLocaleString('zh-TW', {timeZone:'Asia/Taipei'});
const options = (values, selected = '') => values.map(value =>
  `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(value)}</option>`).join('');

export function openWardrobe(root, locationChoices) {
  let section = 'active';
  let editing;
  let query = '', owner = '', size = '';
  let message = '';
  let saved = read();
  const panel = document.createElement('div');
  root.replaceChildren(panel);

  function draw(focusFilter) {
    const active = saved.filter(row => row.status === 'active');
    const owners = [...new Set(saved.map(row => row.owner).filter(Boolean))].sort();
    const sizes = [...new Set(saved.map(row => row.size).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'zh-TW', {numeric:true}));
    const shown = saved.filter(row => row.status === section &&
      (!owner || ownerName(row) === owner) && (!size || (row.size || '未設定') === size) &&
      (!query || [row.name, row.owner, row.size].some(value => value?.toLowerCase().includes(query.toLowerCase()))))
      .sort((a,b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
    const item = saved.find(row => row.id === editing);
    const counts = new Map();
    for (const row of active) counts.set(row.size || '未設定', (counts.get(row.size || '未設定') ?? 0) + row.count);
    panel.innerHTML = `<div class="wardrobe-heading"><h1>衣櫃</h1><button class="primary" data-do="new">新增衣物</button></div>
      <section class="panel">
        <h2>現役衣物</h2><p>${active.length} 筆衣物 · 共 ${active.reduce((sum,row) => sum + row.count,0)} 件</p>
        ${counts.size ? `<p>尺寸分布 · ${[...counts].map(([label,n]) => esc(label) + ' × ' + n).join('　')}</p>` : ''}
      </section>
      ${editing ? `<section class="panel"><h2>${item ? '衣物生平' : '新增衣物'}</h2>
        <form id="clothing-form" class="clothing-form">
          <label>衣物名稱<input name="name" required maxlength="120" value="${esc(item?.name)}"></label>
          <label>誰的<input name="owner" list="wardrobe-owners" maxlength="60" placeholder="可留空，也可填共用" value="${esc(item?.owner)}"></label>
          <datalist id="wardrobe-owners">${options([...new Set(['共用', ...owners])])}</datalist>
          <label>尺寸<input name="size" list="wardrobe-sizes" maxlength="40" value="${esc(item?.size)}"></label>
          <datalist id="wardrobe-sizes">${options(sizes)}</datalist>
          <label>數量<input name="count" type="number" min="0" step="1" required value="${item?.count ?? 1}"></label>
          <label>收納位置<select name="location"><option value="">未設定</option>${locationChoices.map(position =>
            `<option value="${esc(position.id)}" ${position.id === item?.location ? 'selected' : ''}>${esc(position.name)}</option>`).join('')}</select></label>
          <label>一般備註<textarea name="notes" rows="3">${esc(item?.notes)}</textarea></label>
          <div class="actions"><button class="primary">儲存衣物</button><button type="button" data-do="cancel">關閉</button></div>
        </form>
        ${item ? `<p>建檔時間 · ${format(item.createdAt)}</p>
          <div class="actions">
            ${item.status === 'trash' ? '<button data-do="restore">還原</button>' :
            `<button data-do="archive">${item.status === 'archive' ? '解除封存' : '封存'}</button>
             <button data-do="trash">移入回收站</button>`}
          </div>
          ${item.history?.length ? `<h3>數量歷史</h3><ul>${item.history.map(entry => `<li>${format(entry.at)} · ${entry.before} → ${entry.after}</li>`).join('')}</ul>` : ''}` : ''}
      </section>` : ''}
      <p role="status">${esc(message)}</p>
      <section class="panel" ${editing ? 'hidden' : ''}>
        <h2>衣物清單</h2>
        <div class="actions" aria-label="衣物狀態">${[['active','現役'],['archive','封存'],['trash','回收站']].map(([id,label]) =>
          `<button data-section="${id}" aria-pressed="${section === id}">${label}</button>`).join('')}</div>
        <div class="clothing-form wardrobe-filters">
          <label>搜尋<input id="wardrobe-search" type="search" value="${esc(query)}" placeholder="衣物名稱、尺寸或誰的"></label>
          <label>誰的<select id="wardrobe-owner"><option value="">全部</option>${options([...new Set([...owners,'未設定'])],owner)}</select></label>
          <label>尺寸<select id="wardrobe-size"><option value="">全部</option>${options([...new Set([...sizes,'未設定'])],size)}</select></label>
        </div>
        ${shown.length ? `<ul class="rows">${shown.map(row => `<li class="garment-row">
          <button data-item="${esc(row.id)}">${esc(row.name)}</button>
          <span>${esc(row.size || '未設定')} × ${row.count}</span>
          <span>${esc(ownerName(row))}</span>
          <span>${esc(locationChoices.find(position => position.id === row.location)?.name || '未設定收納位置')}</span>
        </li>`).join('')}</ul>` : `<p>${saved.length ? '這個範圍沒有衣物。' : '衣櫃目前是空的。用「新增衣物」建立第一筆。'}</p>`}
      </section>`;
    if (focusFilter) {
      const search = panel.querySelector('#wardrobe-search');
      search.focus();
      search.setSelectionRange(query.length, query.length);
    }
  }

  async function persist(update) {
    try {
      saved = await navigator.locks.request(key, () => {
        const next = update(read());
        localStorage.setItem(key, JSON.stringify(next));
        return next;
      });
      message = '已儲存至本機衣櫃。';
    } catch (error) {
      panel.querySelector('[role="status"]').textContent = error.message || '無法儲存衣物。';
      return false;
    }
    return true;
  }

  panel.addEventListener('submit', async event => {
    event.preventDefault();
    const data = new FormData(event.target);
    const id = editing === 'new' ? crypto.randomUUID() : editing;
    const original = saved.find(row => row.id === id);
    const count = Number(data.get('count'));
    const name = data.get('name').trim();
    if (!name || !Number.isSafeInteger(count) || count < 0) {
      panel.querySelector('[role="status"]').textContent = '請輸入衣物名稱和非負整數數量。';
      return;
    }
    const button = event.submitter;
    button.disabled = true;
    const ok = await persist(rows => {
      const current = rows.find(row => row.id === id);
      if (original?.updatedAt !== current?.updatedAt) throw new Error('衣物已在另一個頁面更新，請重新進入衣櫃。');
      const at = new Date().toISOString();
      const history = current?.history ?? [];
      const next = {id, name, count, owner:data.get('owner').trim(), size:data.get('size').trim(),
        location:data.get('location'), notes:data.get('notes'), status:current?.status ?? 'active',
        createdAt:current?.createdAt ?? at, updatedAt:at,
        history:current && count !== current.count ? [...history,{id:crypto.randomUUID(), at, before:current.count, after:count}] : history};
      return [...rows.filter(row => row.id !== id), next];
    });
    if (!ok) { button.disabled = false; return; }
    if (!original) { section = 'active'; query = owner = size = ''; }
    editing = null;
    draw();
  });
  panel.addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button) return;
    const {do: action, item, section: nextSection} = button.dataset;
    if (!action && !item && !nextSection) return;
    message = '';
    if (nextSection) { section = nextSection; editing = null; }
    if (item || action === 'new') editing = item || 'new';
    if (action === 'cancel') editing = null;
    if (['archive','trash','restore'].includes(action)) {
      const target = saved.find(row => row.id === editing);
      if (action === 'trash' && !confirm(`將「${target.name}」移入回收站？`)) return;
      const status = action === 'trash' ? 'trash' :
        action === 'restore' || target.status === 'archive' ? 'active' : 'archive';
      button.disabled = true;
      const ok = await persist(rows => {
        if (rows.find(row => row.id === target.id)?.updatedAt !== target.updatedAt) {
          throw new Error('衣物已在另一個頁面更新，請重新進入衣櫃。');
        }
        return rows.map(row => row.id === target.id ? {...row, status, updatedAt:new Date().toISOString()} : row);
      });
      if (!ok) { button.disabled = false; return; }
      editing = null;
    }
    draw();
    if (item || action === 'new') panel.querySelector('input[name="name"]')?.focus();
  });
  panel.addEventListener('change', event => {
    if (event.target.id === 'wardrobe-owner') { owner = event.target.value; draw(); }
    if (event.target.id === 'wardrobe-size') { size = event.target.value; draw(); }
  });
  panel.addEventListener('input', event => {
    if (event.target.id === 'wardrobe-search') { query = event.target.value; draw(true); }
  });
  draw();
}
