import {firebaseConfig} from './config.js';
import {locations, locationPath, modules, previewStore} from './core.js';
import {connect} from './cloud.js';
import {openWardrobe} from './wardrobe.js';

const main = document.querySelector('#main');
const nav = document.querySelector('#nav');
const preview = firebaseConfig === null;
const phone = /iPhone/i.test(navigator.userAgent);
let cloud, store, state, editing, busy, message, account;
let status = preview ? '本機測試 · 不跨裝置同步' : '正在連線…';
const shortcutsKey = 'miss-an:shortcuts:' + (phone ? 'iphone' : 'windows');
if (preview) document.querySelector('footer').append(' · 本機測試');
const shortcuts = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(shortcutsKey));
    if (Array.isArray(saved)) {
      return [...new Set(saved)].map(id => modules.find(module => module.id === id)).filter(Boolean);
    }
  } catch { /* Default to an empty list when storage is unavailable. */ }
  return [];
};
const escape = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const link = (path, label) => `<a class="button" href="#${path}" ${location.hash === '#' + path ? 'aria-current="page"' : ''}>${label}</a>`;
const moduleLink = module => link(module.id, module.name);
const note = () => `<p role="status">${escape(message ?? '')}</p>`;

function home() {
  const date = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', dateStyle: 'full'
  }).format(new Date());
  return `<time>${date}</time><h1>我的家在手裡</h1>
    <div class="grid">
      <section class="panel"><h2>常用模組</h2>
        <div class="actions">${shortcuts().map(moduleLink).join('') || '<p>尚未設定快捷鍵。</p>'}</div>
        <p>${link('modules', '全部模組')} ${link('settings', '管理快捷鍵')}</p>
      </section>
      <section class="panel"><h2>系統狀態</h2>
        <p>資料同步 · ${escape(status)}</p><p>備份 · 尚未啟用</p>
        <p>今日待辦 · 待辦模組尚未啟用</p>
      </section>
    </div>`;
}

function settings() {
  const selected = shortcuts();
  const ordered = [...selected, ...modules.filter(module => !selected.includes(module))];
  return `<h1>設定</h1><section class="panel">
    <h2>${phone ? 'iPhone' : 'Windows'} 常用模組</h2>
    <form id="preferences">
      <ol class="rows" aria-label="快捷鍵順序">${ordered.map(module => `<li>
        <label class="actions"><input class="shortcut-check" type="checkbox" name="module" value="${module.id}" ${selected.includes(module) ? 'checked' : ''}>${module.name}</label>
        <span class="actions"><button type="button" data-action="shortcut-up" aria-label="${module.name}上移">上移</button>
        <button type="button" data-action="shortcut-down" aria-label="${module.name}下移">下移</button></span>
      </li>`).join('')}</ol>
      <div><button>儲存快捷鍵</button></div>
    </form>${note()}
  </section>`;
}

function storage() {
  if (!state) return `<h1>收納位置</h1><section class="panel"><p>${escape(status)}</p><button data-action="refresh">重新載入</button></section>`;
  const rows = locations(state).sort((a,b) => locationPath(state,a.id).localeCompare(locationPath(state,b.id), 'zh-TW'));
  const row = state.records[editing];
  const options = rows.filter(item => item.id !== editing).map(item =>
    `<option value="${item.id}" ${row?.parentId === item.id ? 'selected' : ''}>${escape(locationPath(state,item.id))}</option>`).join('');
  return `<h1>收納位置</h1>
    <section class="panel">
      <h2>${row ? '編輯位置' : '新增位置'}</h2>
      <form class="location-form" id="location-form">
        <label>位置名稱<input name="name" required maxlength="80" value="${escape(row?.name)}"></label>
        <label>上層位置<select name="parent"><option value="">最上層</option>${options}</select></label>
        <div class="actions"><button class="primary" ${busy ? 'disabled' : ''}>儲存</button>
        ${row ? '<button type="button" data-action="cancel">取消</button>' : ''}</div>
      </form>${note()}
    </section>
    <section class="panel"><h2>位置一覽</h2>
      ${rows.length ? `<ul class="rows">${rows.map(item => `<li>
        <span>${escape(locationPath(state,item.id))}</span><span class="actions">
        <button data-action="edit" data-id="${item.id}">編輯</button>
        <button data-action="remove" data-id="${item.id}">移除</button></span></li>`).join('')}</ul>` : '<p>尚無收納位置。</p>'}
      <button data-action="refresh">重新載入</button>
    </section>`;
}

function render() {
  const page = location.hash.slice(1) || 'home';
  nav.innerHTML = store ? [
    link('home', '首頁'), ...shortcuts().map(moduleLink), link('modules', '全部模組'),
    link('locations', '收納位置'), link('settings', '設定'),
    cloud ? '<button data-action="logout">登出</button>' : ''
  ].join('') : '';
  if (!store) {
    main.innerHTML = `<h1>MISS AN</h1><section class="panel"><p role="status">${escape(status)}</p>
      ${cloud && !account ? `<form id="login">
        <label>電子郵件<input name="email" type="email" autocomplete="username" required></label>
        <label>密碼<input name="password" type="password" autocomplete="current-password" required></label>
        <div><button class="primary">登入</button></div>
      </form>` : account ? '<button data-action="logout">登出</button>' : ''}</section>`;
    return;
  }
  const views = {
    home,
    settings,
    locations: storage,
    modules: () => `<h1>全部模組</h1><section class="panel actions">${modules.map(moduleLink).join('')}</section>`,
    'WARDROBE-001': () => '<h1>衣櫃</h1><section class="panel"><p>衣物建檔目前開放本機驗收。</p></section>',
    'SHOPPING-001': () => preview
      ? '<iframe class="module-frame" src="./shopping/?embedded=1" title="購物系統"></iframe>'
      : '<h1>購物</h1><section class="panel"><p>購物模組目前開放本機驗收。</p></section>'
  };
  if (page === 'SHOPPING-001' && main.querySelector('.module-frame')) return;
  if (page === 'WARDROBE-001' && preview) {
    const choices = state ? locations(state).map(row => ({id: row.id, name: locationPath(state, row.id)})) : [];
    openWardrobe(main, choices);
    return;
  }
  main.innerHTML = (Object.hasOwn(views, page) ? views[page] : home)();
}

async function loadLocations() {
  const activeStore = store;
  try {
    const result = await activeStore.read();
    if (activeStore !== store || (state && result.version < state.version)) return;
    state = result;
    if (!preview) status = '已從雲端載入收納位置';
  } catch {
    if (activeStore !== store) return;
    status = '讀取收納位置失敗';
    message = status;
  }
  render();
}

async function changeLocation(change) {
  if (busy || !state) return;
  const activeStore = store;
  busy = true;
  const submit = main.querySelector('#location-form button');
  if (submit) submit.disabled = true;
  try {
    const result = await activeStore.save(state.version, change);
    if (activeStore !== store) return;
    state = result;
    editing = null;
    message = change.remove ? '收納位置已移除。' : '收納位置已儲存。';
    if (!preview) status = '收納位置已儲存至雲端';
  } catch (error) {
    if (activeStore !== store) return;
    const text = error.code ? '儲存失敗，請確認連線及登入狀態。' : error.message;
    const statusLine = main.querySelector('[role="status"]');
    if (statusLine) statusLine.textContent = text;
    if (submit) submit.disabled = false;
    return;
  } finally {
    busy = false;
  }
  render();
}

document.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.target;
  const data = new FormData(form);
  if (form.id === 'preferences') {
    try {
      localStorage.setItem(shortcutsKey, JSON.stringify(data.getAll('module')));
      message = '快捷鍵已儲存。';
    } catch { message = '無法儲存快捷鍵，請確認瀏覽器儲存設定。'; }
    render();
  }
  if (form.id === 'location-form') {
    await changeLocation({id: editing ?? crypto.randomUUID(), name: data.get('name'), parentId: data.get('parent') || null});
  }
  if (form.id === 'login') {
    form.querySelector('button').disabled = true;
    try { await cloud.login(data.get('email'), data.get('password')); }
    catch { status = '登入失敗，請確認帳號、密碼與連線。'; render(); }
  }
});

document.addEventListener('click', async event => {
  const button = event.target.closest('button[data-action]');
  if (!button || busy) return;
  const {action, id} = button.dataset;
  if (action === 'shortcut-up' || action === 'shortcut-down') {
    const row = button.closest('li');
    if (action === 'shortcut-up' && row.previousElementSibling) row.previousElementSibling.before(row);
    if (action === 'shortcut-down' && row.nextElementSibling) row.nextElementSibling.after(row);
    button.focus();
    return;
  }
  if (action === 'logout') {
    try { await cloud.logout(); }
    catch { status = '登出失敗，請重試。'; render(); }
    return;
  }
  if (action === 'refresh') { message = ''; await loadLocations(); return; }
  if (action === 'remove') {
    if (confirm(`移除「${locationPath(state,id)}」？`)) await changeLocation({id, remove: true});
    return;
  }
  editing = action === 'edit' ? id : null;
  message = '';
  render();
  main.querySelector('input[name="name"]')?.focus();
});

window.addEventListener('hashchange', () => { editing = null; message = ''; render(); });

render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.warn);
if (preview) {
  store = previewStore;
  await loadLocations();
} else {
  try {
    cloud = await connect(firebaseConfig);
    cloud.watch(async user => {
      account = user;
      store = state = editing = null;
      status = user ? '正在驗證存取權限…' : '請登入 MISS AN。';
      render();
      if (!user) return;
      try {
        await cloud.authorize(user.uid);
        if (account !== user) return;
        store = cloud.store(user.uid);
        await loadLocations();
      } catch (error) {
        if (account !== user) return;
        status = error.code === 'permission-denied' ? '此帳號沒有 MISS AN 資料存取權限。' : '無法驗證權限，請確認連線後重新登入。';
        render();
      }
    });
  } catch {
    status = '無法啟動 Firebase，請確認設定及網路連線。';
    render();
  }
}
