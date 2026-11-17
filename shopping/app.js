'use strict';
if (window.parent !== window && new URLSearchParams(location.search).has('embedded')) {
  document.documentElement.classList.add('embedded-module');
}
const rules = window.MissAnOrders;
const byId = id => document.getElementById(id);
const editor = byId('editor');
const form = byId('orderForm');
const fields = byId('orderFields');
const status = byId('formStatus');
const uuid = () => crypto.randomUUID();
const blank = () => ({ orders: [], tags: [], recipients: [], images: {} });
let state = blank();
let draft;
let pending = {};
let approvedDuplicate = null;
let busy = false;
let objectUrls = [];

const database = new Promise((resolve, reject) => {
  const request = indexedDB.open('miss-an-shopping-development', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('shopping');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

async function transaction(update) {
  const db = await database;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('shopping', update ? 'readwrite' : 'readonly');
    const store = tx.objectStore('shopping');
    const request = store.get('state');
    let result;
    let failure;
    request.onsuccess = () => {
      result = request.result || blank();
      if (!update) return;
      try {
        update(result);
        store.put(result, 'state');
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(failure || tx.error || new Error('儲存失敗。'));
  });
}

function make(tag, text = '') {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

function button(text, action) {
  const node = make('button', text);
  node.type = 'button';
  node.onclick = action;
  return node;
}

function input(target, key, label, options = {}) {
  const wrap = make('label', label);
  if (options.full) wrap.className = 'full';
  const control = make(options.values ? 'select' : options.type === 'textarea' ? 'textarea' : 'input');
  if (control.tagName === 'SELECT') {
    for (const entry of options.values) {
      const [value, name] = Array.isArray(entry) ? entry : [entry, entry];
      control.add(new Option(name || '請選擇', value));
    }
  } else if (control.tagName === 'INPUT') {
    control.type = options.type || 'text';
    if (options.step) control.step = options.step;
    if (options.type === 'number') {
      control.step = options.step || '1';
      control.min = '0';
    }
  }
  if (options.list) control.setAttribute('list', options.list);
  if (options.type === 'checkbox') control.checked = Boolean(target[key]);
  else control.value = target[key] ?? '';
  control.required = Boolean(options.required);
  control.oninput = () => {
    target[key] = options.type === 'checkbox' ? control.checked : control.value;
    if (options.changed) options.changed();
  };
  wrap.append(control);
  return wrap;
}

function grid(...nodes) {
  const section = make('div');
  section.className = 'grid';
  section.append(...nodes);
  return section;
}

function listOptions(id, values) {
  const node = make('datalist');
  node.id = id;
  for (const value of values) node.append(new Option(value));
  return node;
}

function item(orderId) {
  const id = uuid();
  return { id, orderId, name: '', category: '', tags: [], recipients: [], weightKg: '', description: '',
    descriptionImages: [], notes: '', feedback: '', variants: [variant(id)] };
}

function variant(itemId) {
  return { id: uuid(), itemId, name: '', color: '', size: '', quantity: '1',
    unitAmount: '', notes: '', photos: [], recipients: [] };
}

function newOrder() {
  const id = uuid();
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date());
  const { year, month, day, hour, minute, second } = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const localTime = year + '-' + month + '-' + day + 'T' + hour + ':' + minute + ':' + second;
  return { id, platform: '', orderedAt: localTime, paymentMethod: '',
    paidAt: localTime, paid: false, shipping: '待出貨', pickupPlace: '', expectedAt: '',
    paidAmount: '', notes: '', screenshots: [], adjustments: [], items: [item(id)], version: 0,
    dictionary: { tags: [], recipients: [] }, creationDefaults: { orderedAt: localTime, paidAt: localTime } };
}

function start(order) {
  fields.replaceChildren();
  pending = {};
  approvedDuplicate = null;
  status.textContent = '';
  byId('duplicateActions').replaceChildren();
  draft = order ? structuredClone(order) : newOrder();
  byId('deleteOrder').hidden = !order;
  draft.dictionary = {
    tags: structuredClone(state.tags.filter(entry => !entry.archived)),
    recipients: structuredClone(state.recipients.filter(entry => !entry.archived))
  };
  if (order) {
    draft.paidAmount = rules.asAmount(order.paidMinor);
    draft.cardFee = rules.asAmount(order.cardFeeMinor);
    for (const fee of draft.adjustments) fee.amount = rules.asAmount(fee.amountMinor);
    for (const product of draft.items) for (const style of product.variants) style.unitAmount = rules.asAmount(style.unitMinor);
  }
  byId('editorTitle').textContent = order ? '編輯訂單' : '新增訂單';
  render();
  if (!editor.open) editor.showModal();
}

function row(...nodes) {
  const section = make('div');
  section.className = 'row';
  section.append(...nodes);
  return section;
}

function remove(list, value) {
  list.splice(list.indexOf(value), 1);
  render();
}

function allocations(rows, title) {
  const details = make('details');
  details.open = rows.length > 0;
  details.append(make('summary', title), make('p', '數量可留空。已分配的總數不得超過此品項的購買數量。'));
  for (const person of rows) {
    details.append(row(input(person, 'recipientId', '使用者', {
      values: ['', ...draft.dictionary.recipients.map(entry => [entry.id, entry.name])]
    }), input(person, 'quantity', '分配數量', { type: 'number' }), button('移除', () => remove(rows, person))));
  }
  details.append(button('＋ 加入使用者', () => {
    rows.push({ recipientId: '', quantity: '' });
    render();
  }));
  return details;
}

function dictionary(key, label, productId) {
  const details = make('details');
  details.append(make('summary', label + '管理'));
  const value = { name: '' };
  const filter = input({ query: '' }, 'query', '搜尋' + label, { changed: () => {
    const query = filter.querySelector('input').value.trim().toLocaleLowerCase();
    for (const node of entries.children) {
      node.hidden = !node.querySelector('input').value.toLocaleLowerCase().includes(query);
    }
  } });
  const entries = make('section');
  for (const entry of draft.dictionary[key]) {
    const entryRow = row(input(entry, 'name', label), button('移除', () => {
      draft.dictionary[key].splice(draft.dictionary[key].indexOf(entry), 1);
      for (const product of draft.items) {
        if (key === 'tags') product.tags = product.tags.filter(id => id !== entry.id);
        else {
          product.recipients = product.recipients.filter(person => person.recipientId !== entry.id);
          for (const style of product.variants) style.recipients = style.recipients.filter(person => person.recipientId !== entry.id);
        }
      }
      render();
    }));
    entries.append(entryRow);
  }
  details.append(filter, entries, row(input(value, 'name', '新增' + label), button('新增', () => {
    const name = value.name.trim();
    if (!name) return;
    if (draft.dictionary[key].some(entry => entry.name.trim() === name)) {
      status.textContent = '已有相同名稱。';
      return;
    }
    draft.dictionary[key].push({ id: uuid(), name });
    render();
    fields.querySelector('[data-dictionary="' + key + '"][data-product="' + productId + '"]').open = true;
  })));
  details.dataset.dictionary = key;
  details.dataset.product = productId;
  return details;
}

function styleFields(style, product, index) {
  const section = make('div');
  section.className = 'note-variant';
  section.append(
    grid(input(style, 'name', '款式／顏色'),
      input(style, 'quantity', '數量', { type: 'number', required: true, changed: showTotals }),
      input(style, 'unitAmount', '單價', { type: 'number', step: '.01', required: true, changed: showTotals })),
    ...(product.variants.length > 1 ? [button('移除此款式', () => remove(product.variants, style))] : []));
  if (product.variants.length > 1) section.prepend(make('h4', '款式 ' + (index + 1)));
  return section;
}

function disclosure(title, key, ...nodes) {
  const details = make('details');
  details.className = 'note-details';
  details.dataset.disclosure = key;
  details.append(make('summary', title), ...nodes);
  return details;
}

function noteSection(title, ...nodes) {
  const section = make('section');
  section.className = 'note-section';
  section.append(make('h3', title), ...nodes);
  return section;
}

function checklistEditor(order) {
  const list = make('div');
  for (const entry of order.checklist || []) list.append(input(entry, 'checked', entry.name, { type: 'checkbox' }));
  const content = { text: (order.checklist || []).map(entry => entry.name).join('\n') };
  const editor = input(content, 'text', '修改清單（每行一項）', { type: 'textarea', changed: () => {
    order.checklist = checklistFrom(content.text, order.checklist);
    list.replaceChildren(...order.checklist.map(entry => input(entry, 'checked', entry.name, { type: 'checkbox' })));
  } });
  const section = make('div');
  section.append(list, disclosure('編輯清單文字', 'checklist', editor));
  return section;
}

function checklistFrom(text, previous = []) {
  const checked = new Map(previous.map(entry => [entry.name, entry.checked]));
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    .map(name => ({ name, checked: checked.get(name) ?? false }));
}

function freightPicker(record) {
  const list = make('div');
  const options = rules.availableFreightOrders(state.orders, record.id, record.sourceOrderIds || []);
  if (!options.length) list.append(make('p', '目前沒有可選的國外訂單。'));
  for (const order of options) {
    const selected = { checked: (record.sourceOrderIds || []).includes(order.id) };
    const date = order.orderedAt.slice(0, 10);
    const names = order.items.map(item => item.name).join('、');
    list.append(input(selected, 'checked', [date, order.platform, names].join('　'), { type: 'checkbox', changed: () => {
      const ids = (record.sourceOrderIds || []).filter(id => id !== order.id);
      record.sourceOrderIds = selected.checked ? [...ids, order.id] : ids;
    } }));
  }
  return list;
}

function estimateCost(note, amount, weight) {
  const result = rules.templateCost(amount, note.rate, weight, note.freightRate);
  return [
    result.goods && '商品單價 NT$' + result.goods,
    result.freight && '運費小計 NT$' + result.freight,
    result.total && '合計 NT$' + result.total
  ].filter(Boolean).join('　');
}

function procurementFields(note) {
  const section = make('section');
  const body = make('div');
  const redraw = () => {
    body.replaceChildren();
    for (const entry of note.procurement) {
      const labels = entry.labels.map(label => row(input(label, 'user', '使用者'),
        input(label, 'quantity', '數量', { type: 'number' }),
        button('移除標籤', () => { entry.labels.splice(entry.labels.indexOf(label), 1); redraw(); })));
      const product = make('section');
      product.className = 'note-product';
      product.append(grid(input(entry, 'name', '品名'), input(entry, 'notes', '備註'),
        input(entry, 'quantity', '數量', { type: 'number' }),
        input(entry, 'unitAmount', '單價（RMB）', { type: 'number', step: '.01' })), ...labels,
        row(button('＋ 使用者標籤', () => { entry.labels.push({ user: '', quantity: '' }); redraw(); }),
          ...(note.procurement.length > 1 ? [button('移除項目', () => {
            note.procurement.splice(note.procurement.indexOf(entry), 1);
            redraw();
          })] : [])));
      body.append(product);
    }
  };
  section.append(make('h3', '採購明細'), body, button('＋ 加一項', () => {
    note.procurement.push({ name: '', labels: [] });
    redraw();
  }));
  redraw();
  return section;
}

function itemFields(product, index) {
  const tags = make('details');
  tags.append(make('summary', '商品標籤' + (product.tags.length ? '（' + product.tags.length + '）' : '')));
  for (const entry of draft.dictionary.tags) {
    const selected = { active: product.tags.includes(entry.id) };
    tags.append(input(selected, 'active', entry.name, { type: 'checkbox', changed: () => {
      product.tags = product.tags.filter(id => id !== entry.id);
      if (selected.active) product.tags.push(entry.id);
    } }));
  }
  const section = make('section');
  section.className = 'note-product';
  if (draft.items.length > 1) section.append(make('h4', '品項 ' + (index + 1)));
  section.append(input(product, 'name', '品名', { required: true, changed: showTotals }),
    input(product, 'notes', '備註'),
    ...product.variants.map((style, i) => styleFields(style, product, i)),
    allocations(product.recipients, '使用者標籤'),
    disclosure('品項補充', product.id,
      grid(input(product, 'category', '商品類別'),
        ...(draft.items.length > 1 && (draft.region === '國外' || rules.mainland.includes(draft.platform)) ? [weightInput(product)] : []),
        input(product, 'description', '商品說明', { type: 'textarea', full: true }),
        input(product, 'feedback', '商品回饋', { type: 'textarea', full: true })),
      photos(product.descriptionImages, '商品說明截圖', 1600, 500000), tags,
      ...product.variants.map(style => photos(style.photos, '商品照片', 800, 200000)),
      dictionary('tags', '標籤', product.id), dictionary('recipients', '使用者', product.id),
      row(button('＋ 加入款式', () => {
        product.variants.push(variant(product.id));
        render();
      }), ...(draft.items.length > 1 ? [button('移除此品項', () => remove(draft.items, product))] : []))));
  return section;
}

function weightInput(product) {
  return input(product, 'weightKg', '重量（kg，選填）', { type: 'number', step: 'any', changed: showTotals });
}

function domesticPlatformFields(record, onChange, legacy = false) {
  const choices = ['', ...rules.domesticPlatforms];
  if (legacy && record.platform && !choices.includes(record.platform)) choices.push(record.platform);
  const store = input(record, 'storeBrand', '超商品牌', { values: ['', ...rules.convenienceStores] });
  const note = input(record, 'platformNote', '其他官方備註');
  const update = () => {
    store.hidden = record.platform !== '超商';
    store.querySelector('select').required = !store.hidden;
    note.hidden = record.platform !== '其他官方';
  };
  const platform = input(record, 'platform', '平台', { values: choices, required: true, changed: () => {
    update();
    onChange?.();
  } });
  update();
  return [platform, store, note];
}

function domesticFee(order) {
  const field = order.adjustments.find(entry => entry.type === '平台運費') ||
    { id: uuid(), type: '平台運費', label: '運費', amount: '' };
  return { field, control: input(field, 'amount', '運費（台幣）', { type: 'number', step: '.01', changed: () => {
    const index = order.adjustments.indexOf(field);
    if (field.amount === '' && index >= 0) order.adjustments.splice(index, 1);
    if (field.amount !== '' && index < 0) order.adjustments.push(field);
    showTotals();
  } }) };
}

async function imageRecord(file, maxEdge, target) {
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  const id = maxEdge + '-' + hash;
  if (pending[id] || state.images[id]) return { id };
  const url = URL.createObjectURL(file);
  try {
    const picture = new Image();
    picture.src = url;
    await picture.decode();
    const ratio = Math.min(1, maxEdge / Math.max(picture.naturalWidth, picture.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(picture.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(picture.naturalHeight * ratio));
    canvas.getContext('2d').drawImage(picture, 0, 0, canvas.width, canvas.height);
    let blob;
    for (const quality of [.9, .84, .78]) {
      blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
      if (!blob || blob.type !== 'image/webp') throw new Error('瀏覽器無法輸出 WebP。');
      if (blob.size <= target) break;
    }
    return { id, blob };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function setBusy(value) {
  busy = value;
  form.inert = value;
}

function photos(ids, label, maxEdge, target) {
  const section = make('div');
  const picker = make('label', label);
  const upload = make('input');
  upload.type = 'file';
  upload.multiple = true;
  upload.accept = 'image/*';
  upload.onchange = async () => {
    const files = Array.from(upload.files);
    if (!files.length) return;
    setBusy(true);
    const failures = [];
    try {
      for (const file of files) {
        try {
          const { id, blob } = await imageRecord(file, maxEdge, target);
          if (blob) pending[id] = blob;
          if (!ids.includes(id)) ids.push(id);
        } catch (error) {
          failures.push(file.name + '：' + error.message);
        }
      }
      status.textContent = failures.join('\n');
      render();
    } finally {
      setBusy(false);
    }
  };
  picker.append(upload);
  const gallery = make('div');
  gallery.className = 'photos';
  for (const id of ids) {
    const blob = pending[id] || state.images[id];
    if (!blob) continue;
    const figure = make('figure');
    const img = make('img');
    img.alt = label;
    img.src = URL.createObjectURL(blob);
    objectUrls.push(img.src);
    const open = make('a');
    open.href = img.src;
    open.target = '_blank';
    open.rel = 'noopener';
    open.append(img);
    figure.append(open, button('移除', () => remove(ids, id)));
    gallery.append(figure);
  }
  section.append(picker, gallery);
  return section;
}

function showTotals() {
  const node = byId('totals');
  if (!node) return;
  const currency = (draft.region ? draft.currency === 'CNY' : rules.mainland.includes(draft.platform.trim())) ? 'RMB' : 'NT$';
  const paidAmount = draft.paidAmount;
  byId('noteTitle').textContent = [
    draft.orderedAt.slice(5, 10).replace('-', '/'), draft.platform.trim() || draft.region,
    draft.items.map(product => product.name.trim()).filter(Boolean).join('、'),
    paidAmount ? currency + ' ' + paidAmount : ''
  ].filter(Boolean).join('　') || '購物筆記';
  const weights = draft.items.map(product => product.weightKg);
  const estimate = byId('noteEstimate');
  if (estimate) estimate.textContent = estimateCost(draft.estimate, paidAmount, weights.length === 1 ? weights[0] : '');
  byId('noteWeight').textContent = (draft.region === '國外' || rules.mainland.includes(draft.platform)) &&
    weights.length > 1 && weights.every(value => value !== '' && value != null)
    ? '重量 ' + new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 6 }).format(weights.reduce((sum, value) => sum + Number(value), 0)) + ' kg'
    : '';
  try {
    const lines = draft.items.flatMap(product => product.variants);
    const subtotal = lines.reduce((sum, line) => sum + Number(line.quantity) * rules.minor(line.unitAmount, '單價'), 0);
    const expected = draft.adjustments.reduce((sum, fee) => sum +
      (['折扣', '折抵'].includes(fee.type) ? -1 : 1) * rules.minor(fee.amount, fee.type), subtotal);
    if (!Number.isSafeInteger(expected) || !Number.isSafeInteger(subtotal)) throw new Error();
    const paid = rules.minor(draft.paidAmount, '實付', true);
    node.textContent = '合計 ' + currency + ' ' + rules.asAmount(expected) +
      (paid !== null && paid !== expected ? ' · 實付金額不符' : '');
  } catch {
    node.textContent = '';
  }
}

function render() {
  const expanded = new Set([...fields.querySelectorAll('details[data-disclosure][open]')].map(node => node.dataset.disclosure));
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls = [];
  if (draft.kind === 'freight') {
    fields.replaceChildren(noteSection('回貨摘要', grid(
      input(draft, 'orderedAt', '回貨日', { type: 'datetime-local', step: '1', required: true }),
      input(draft, 'weightKg', '總重量（kg）', { type: 'number', step: 'any', required: true }),
      input(draft, 'paidAmount', '總運費（台幣）', { type: 'number', step: '.01', required: true }))),
    noteSection('國外訂單', freightPicker(draft),
      ...(draft.checklist?.length ? [disclosure('原包裹清單', 'legacy-freight', checklistEditor(draft))] : [])),
    noteSection('圖片', photos(draft.screenshots, '附加集運截圖', 1600, 500000)));
    return;
  }
  const shippingInput = input(draft, 'shipping', '貨運狀態', { values: rules.shipping });
  const paidInput = input(draft, 'paid', '已付款', { type: 'checkbox' });
  const expectedAt = input(draft, 'expectedAt', '預計到貨日期', { type: 'date' });
  const accountNote = make('p', '支付寶帳務尚未接通，目前可保存未付款紀錄。');
  const isOverseas = draft.region ? draft.region === '國外' : rules.mainland.includes(draft.platform);
  const acceptedMethods = isOverseas ? rules.overseasMethods : rules.paymentMethods;
  const methods = [...new Set(['', ...acceptedMethods, ...(draft.paymentMethod ? [draft.paymentMethod] : [])])];
  const bank = input(draft, 'bank', '銀行');
  const fee = input(draft, 'cardFee', '信用卡手續費（台幣）', { type: 'number', step: '.01' });
  const updatePlatform = () => {
    const country = draft.region ? draft.region === '國外' : rules.mainland.includes(draft.platform.trim());
    const shipping = shippingInput.querySelector('select');
    shipping.replaceChildren(...[...rules.shipping, ...(country ? ['已上船'] : [])].map(value => new Option(value, value)));
    if (!country && draft.shipping === '已上船') draft.shipping = '待出貨';
    shipping.value = draft.shipping;
    const paid = paidInput.querySelector('input');
    const wallet = country && (!draft.region || draft.paymentMethod === '支付寶') && draft.currency !== 'TWD';
    if (wallet) draft.paid = false;
    if (country) {
      draft.expectedAt = '';
      expectedAt.querySelector('input').value = '';
    }
    paid.checked = draft.paid;
    paid.disabled = wallet;
    expectedAt.hidden = country;
    accountNote.hidden = !wallet;
    bank.hidden = country || !['轉帳', '銀行轉帳'].includes(draft.paymentMethod);
    fee.hidden = !country || draft.paymentMethod !== '信用卡';
    showTotals();
  };
  const total = make('p');
  total.id = 'totals';
  total.setAttribute('aria-live', 'polite');
  const platform = isOverseas ? [input(draft, 'platform', '平台', { list: 'platforms', required: true, changed: updatePlatform })]
    : domesticPlatformFields(draft, updatePlatform, true);
  const postage = isOverseas ? null : domesticFee(draft);
  const dateInput = input(draft, 'orderedAt', '下單日', {
    type: 'datetime-local', step: '1', required: true, changed: showTotals
  });
  const title = make('p');
  title.id = 'noteTitle';
  const weight = make('p');
  weight.id = 'noteWeight';
  const orderSection = disclosure('付款、收貨與費用', 'order',
    grid(
      input(draft, 'paymentMethod', '付款方式', { values: methods, changed: updatePlatform }), bank, fee,
      input(draft, 'paidAt', '付款日期與時間', { type: /^\d{4}-\d{2}-\d{2}$/.test(draft.paidAt) ? 'date' : 'datetime-local', step: '1' }),
      paidInput, shippingInput,
      input(draft, 'pickupPlace', '收貨地址或取貨地點', { list: 'places' }), expectedAt),
    accountNote,
      ...draft.adjustments.filter(fee => fee !== postage?.field).map(fee => row(input(fee, 'type', '類型', {
        values: ['折扣', '平台運費', '其他費用', '折抵'], changed: showTotals
      }), input(fee, 'label', '名稱'), input(fee, 'amount', '金額', {
        type: 'number', step: '.01', required: true, changed: showTotals
      }), button('移除', () => remove(draft.adjustments, fee)))),
      row(button('＋ 加入折扣或費用', () => {
        draft.adjustments.push({ id: uuid(), type: '折扣', label: '', amount: '' });
        render();
      })));
  const cover = make('section');
  cover.className = 'note-cover';
  cover.append(title, grid(dateInput, ...platform,
    ...(draft.procurement ? [input(draft.items[0], 'name', '訂單品名', { required: true, changed: showTotals })] : []),
    input(draft, 'paidAmount', '實付金額', { type: 'number', step: '.01', changed: () => {
      const line = draft.items[0]?.variants[0];
      if (draft.procurement && line && draft.items.length === 1 && draft.items[0].variants.length === 1 &&
          Number(line.quantity) === 1 && !draft.adjustments.length && draft.paidAmount !== '') {
        line.unitAmount = draft.paidAmount;
      }
      showTotals();
    } }),
    ...(postage ? [postage.control] : draft.items.length === 1 ? [weightInput(draft.items[0])] : [])), weight, total);
  if (draft.estimate) {
    const estimated = make('p');
    estimated.id = 'noteEstimate';
    cover.append(grid(
      input(draft.estimate, 'rate', '匯率', { type: 'number', step: 'any', changed: showTotals }),
      input(draft.estimate, 'freightRate', '運費（台幣／kg）', { type: 'number', step: 'any', changed: showTotals })),
    estimated);
  }
  const pictures = noteSection('圖片', photos(draft.screenshots, '附加訂單截圖', 1600, 500000));
  pictures.classList.add('note-pictures');
  fields.replaceChildren(
    listOptions('platforms', isOverseas ? [...rules.mainland, '官方網站'] : rules.platforms),
    listOptions('places', rules.pickupPlaces), cover,
    noteSection('內容', ...(draft.checklist ? [checklistEditor(draft)] : []), ...draft.items.map(itemFields),
      row(button('＋ 加入品項', () => { draft.items.push(item(draft.id)); render(); })),
      input(draft, 'notes', '備註', { type: 'textarea' })),
    pictures, orderSection);
  if (draft.procurement) {
    const content = fields.querySelector('.note-section');
    content.replaceChildren(procurementFields(draft));
    fields.insertBefore(noteSection('回饋', input(draft, 'feedback', '回饋內容', { type: 'textarea' })), orderSection);
  }
  for (const details of fields.querySelectorAll('details[data-disclosure]')) {
    details.open = expanded.has(details.dataset.disclosure);
  }
  updatePlatform();
}

function showOrders() {
  const list = byId('orderList');
  list.replaceChildren();
  if (!state.orders.some(order => !order.deletedAt)) list.append(make('article', '目前沒有訂單。'));
  const trash = make('details');
  trash.append(make('summary', '已刪除的筆記'));
  for (const order of [...state.orders].sort((a, b) => b.orderedAt.localeCompare(a.orderedAt))) {
    const card = make('article');
    const heading = make('div');
    heading.className = 'heading';
    const currency = order.currency === 'CNY' ? 'RMB' : 'NT$';
    const platform = order.platform === '阿里巴巴／1688' ? '1688' : order.platform;
    const title = [order.orderedAt.slice(5, 10).replace('-', '/'), platform || order.region,
      order.kind === 'freight' ? order.weightKg + ' kg' : order.items.map(product => product.name).join('、'),
      currency + ' ' + rules.asAmount(order.paidMinor ?? order.expected) + (order.paidMinor === null ? '（應付）' : '')];
    heading.append(make('h2', title.join('　')),
      order.deletedAt ? button('復原', () => changeDeleted(order, false)) : button('開啟', () => start(order)));
    const freightNames = (order.sourceOrderIds || []).flatMap(id =>
      state.orders.find(source => source.id === id)?.items.map(product => product.name) || []);
    card.append(heading, make('p', order.kind === 'freight' ? [...freightNames, ...(order.checklist || []).map(entry => entry.name)].join('、')
      : order.shipping + ' · ' + (order.paid ? '已付款' : '未付款')));
    (order.deletedAt ? trash : list).append(card);
  }
  if (trash.children.length > 1) list.append(trash);
}

async function changeDeleted(order, deleted) {
  if (busy) return;
  setBusy(true);
  const pageStatus = byId('pageStatus');
  try {
    state = await transaction(latest => {
      const current = latest.orders.find(entry => entry.id === order.id);
      if (!current || current.version !== order.version || Boolean(current.deletedAt) === deleted) {
        throw new Error('這筆筆記已變更，請重新整理後再試。');
      }
      if (!deleted && rules.duplicates(current, latest.orders).exact) {
        throw new Error('已有相同平台訂單編號的筆記，請先處理重複紀錄。');
      }
      if (!deleted) rules.verifyFreightLinks(current, latest.orders);
      const at = new Date().toISOString();
      if (deleted) current.deletedAt = at;
      else delete current.deletedAt;
      current.version++;
      current.history.push({ at, action: deleted ? '刪除筆記' : '復原筆記' });
    });
    if (deleted && editor.open) editor.close();
    showOrders();
    pageStatus.textContent = deleted ? '已刪除，可從「已刪除的筆記」復原。' : '已復原筆記。';
  } catch (error) {
    (editor.open ? status : pageStatus).textContent = error.message;
  } finally {
    setBusy(false);
  }
}

function saveDictionary(latest, dictionary) {
  for (const key of ['tags', 'recipients']) {
    if (JSON.stringify(latest[key]) !== JSON.stringify(state[key])) {
      throw new Error('另一個頁面已變更標籤或使用者。請保留目前內容，重新開啟頁面後核對。');
    }
    const previous = latest[key];
    const names = new Set();
    for (const entry of dictionary[key]) {
      entry.name = entry.name.trim();
      if (!entry.name || names.has(entry.name)) throw new Error('標籤及使用者名稱須填寫且不可重複。');
      names.add(entry.name);
    }
    // Historical orders retain their references. Removed entries stay resolvable in the catalog.
    const active = new Set(dictionary[key].map(entry => entry.id));
    latest[key] = [...dictionary[key], ...previous.filter(entry => !active.has(entry.id))
      .map(entry => ({ ...entry, archived: true }))];
  }
}

function imageIds(order) {
  return [...order.screenshots, ...order.items.flatMap(product =>
    [...product.descriptionImages, ...product.variants.flatMap(style => style.photos)])];
}

form.onsubmit = async event => {
  event.preventDefault();
  if (busy) return;
  status.textContent = '';
  byId('duplicateActions').replaceChildren();
  setBusy(true);
  try {
    const order = rules.normalize(draft);
    const dictionary = order.dictionary;
    delete order.dictionary;
    delete order.creationDefaults;
    state = await transaction(latest => {
      const { exact, suspected } = rules.duplicates(order, latest.orders);
      if (exact || (suspected && approvedDuplicate !== suspected.id)) {
        const error = new Error(exact ? '此平台的訂單編號已存在。' : '這筆資料可能與既有訂單重複，請核對後選擇。');
        error.duplicate = exact || suspected;
        error.exact = Boolean(exact);
        throw error;
      }
      const previous = latest.orders.find(entry => entry.id === order.id);
      rules.verifyFreightLinks(order, latest.orders, previous?.sourceOrderIds);
      if (previous && previous.version !== order.version) {
        throw new Error('另一個頁面已修改這筆訂單。請保留目前內容並核對兩個版本。');
      }
      saveDictionary(latest, dictionary);
      order.version++;
      const at = new Date().toISOString();
      order.history = previous ? [...previous.history, { at, action: '修改', previous: {
        ...previous, history: undefined
      } }] : [{ at, action: '建檔' }];
      for (const id of imageIds(order)) {
        if (pending[id]) latest.images[id] = pending[id];
        if (!latest.images[id]) throw new Error('有圖片尚未保存。');
      }
      for (const key of ['rate', 'freightRate']) {
        const value = order.estimate?.[key];
        if (value && value !== previous?.estimate?.[key]) {
          latest.templateRates ||= {};
          latest.templateRates[key] = value;
        }
      }
      latest.orders = [...latest.orders.filter(entry => entry.id !== order.id), order];
    });
    editor.close();
    showOrders();
    byId('pageStatus').textContent = '已儲存訂單。';
  } catch (error) {
    status.textContent = error.message;
    if (error.duplicate) {
      const duplicate = error.duplicate;
      const actions = byId('duplicateActions');
      actions.append(button('開啟既有訂單並附加截圖', async () => {
        const source = [...draft.screenshots];
        const files = pending;
        setBusy(true);
        try {
          state = await transaction();
          start(state.orders.find(order => order.id === duplicate.id));
          pending = files;
          draft.screenshots = [...new Set([...draft.screenshots, ...source])];
          render();
        } catch (issue) {
          status.textContent = issue.message;
        } finally {
          setBusy(false);
        }
      }));
      if (!error.exact) actions.append(button('確認為不同訂單', () => {
        approvedDuplicate = duplicate.id;
        form.requestSubmit();
      }));
    }
  } finally {
    setBusy(false);
  }
};

form.addEventListener('invalid', event => {
  const section = event.target.closest('details');
  if (section) section.open = true;
}, true);

const batchEditor = byId('batchEditor');
const batchForm = byId('batchForm');
const batchStatus = byId('batchStatus');
const batchDuplicate = byId('batchDuplicate');
const batchNotes = byId('batchNotes');
let batch;
let notes = [];
let rateEditSequence = 0;
let batchBusy = false;
let allowedBatchDuplicate;

function hasNoteInput(note) {
  return Boolean(note.platform || note.name || note.amount || note.weightKg || note.content || note.feedback ||
    note.shippingFee || note.fee || note.files.length || note.sourceOrderIds?.length ||
    note.procurement?.some(entry => entry.name || entry.labels.length));
}

function selectRegion(region) {
  if (batch?.region === region) return;
  if (notes.some(hasNoteInput) &&
      !window.confirm('切換範本會清除這批尚未儲存的筆記。要切換嗎？')) return;
  const overseas = region === '國外';
  const freight = region === '回貨';
  const previous = batch;
  const defaults = newOrder();
  batch = { region, currency: overseas ? 'CNY' : 'TWD', platform: '', paymentMethod: overseas ? '支付寶' : '現金',
    orderedAt: previous?.orderedAt || defaults.orderedAt, paidAt: previous?.paidAt || defaults.paidAt, bank: '', paid: false };
  byId('domestic').setAttribute('aria-pressed', String(!overseas));
  byId('overseas').setAttribute('aria-pressed', String(overseas));
  byId('freight').setAttribute('aria-pressed', String(freight));
  const bank = input(batch, 'bank', '銀行（選填）');
  const bankField = bank.querySelector('input');
  const paid = input(batch, 'paid', '標記已付款', { type: 'checkbox' });
  const paidControl = paid.querySelector('input');
  const updateMethod = () => {
    const wallet = batch.paymentMethod === '支付寶';
    const card = overseas && batch.paymentMethod === '信用卡';
    if (wallet) {
      batch.currency = 'CNY';
      batch.paid = false;
      paidControl.checked = false;
    }
    paid.hidden = wallet;
    bank.hidden = batch.paymentMethod !== '轉帳';
    bankField.disabled = bank.hidden;
    for (const field of batchNotes.querySelectorAll('.batch-fee')) field.hidden = !card;
  };
  const payment = input(batch, 'paymentMethod', '付款方式', {
    values: overseas ? rules.overseasMethods : rules.paymentMethods, changed: updateMethod
  });
  byId('batchOptions').replaceChildren(grid(
    ...(freight ? [] : [payment, bank, paid]),
    ...(!overseas ? [input(batch, 'orderedAt', freight ? '回貨日' : '下單日', { type: 'datetime-local', step: '1', required: true })] : [])),
  listOptions('batchPlatforms', overseas ? rules.mainland : rules.platforms.filter(value => !rules.mainland.includes(value))));
  batchForm.hidden = false;
  byId('pasteFormat').textContent = freight ? '貼上總重量與總運費，再從下方勾選國外訂單。'
    : overseas ? '欄位順序：平台、品名、實付、重量、內容（各項以 ／ 分隔）'
      : '欄位順序：平台、品名、含運實付、運費、內容、超商品牌或其他官方備註（選填）';
  byId('pasteNotes').value = '';
  batchStatus.textContent = '';
  batchDuplicate.replaceChildren();
  allowedBatchDuplicate = null;
  updateMethod();
  notes = [];
  batchNotes.replaceChildren();
  addBatchNote();
}

function addBatchNote(values = {}) {
  const freight = batch.region === '回貨';
  const overseas = batch.region === '國外';
  const note = { platform: '', name: '', amount: '', weightKg: '', shippingFee: '', content: '', fee: '', rate: '', freightRate: '', rateEdits: {}, files: [],
    orderedAt: batch.orderedAt, feedback: '', ...values };
  if (overseas) {
    for (const key of ['rate', 'freightRate']) {
      note[key] = mostRecentRate(notes, key)?.[key] ??
        state.templateRates?.[key] ?? [...state.orders].reverse().find(order => order.estimate?.[key])?.estimate[key] ?? '';
    }
    note.procurement = (note.content ? checklistFrom(note.content) : [{ name: '' }]).map(entry => ({ name: entry.name, labels: [] }));
  }
  notes.push(note);
  const section = make('article');
  const estimate = make('p');
  const refresh = () => {
    estimate.textContent = batch.currency === 'CNY' ? estimateCost(note, note.amount, note.weightKg) : '';
  };
  const fee = input(note, 'fee', '信用卡手續費（台幣）', { type: 'number', step: '.01' });
  fee.className = 'batch-fee';
  fee.hidden = !overseas || batch.paymentMethod !== '信用卡';
  const attachment = make('label', freight ? '集運截圖' : '訂單截圖');
  const platform = overseas
    ? [input(note, 'platform', '平台', { values: ['', '淘寶', '拼多多', ['阿里巴巴／1688', '1688'], '小紅書', '官方網站'], required: true })]
    : freight ? [] : domesticPlatformFields(note);
  if (overseas && note.platform === '1688') {
    note.platform = '阿里巴巴／1688';
    platform[0].querySelector('select').value = note.platform;
  }
  const files = make('input');
  files.type = 'file';
  files.accept = 'image/*';
  files.multiple = true;
  files.onchange = () => { note.files = Array.from(files.files); };
  attachment.append(files);
  section.append(grid(
    ...(freight ? [] : [...platform, input(note, 'name', '品名', { required: true })]),
    ...(overseas ? [input(note, 'orderedAt', '下單日', { type: 'datetime-local', step: '1', required: true })] : []),
    input(note, 'amount', freight ? '總運費（台幣）' : overseas ? '金額（RMB）' : '實付金額（含運）', { type: 'number', step: '.01', required: true, changed: refresh }),
    overseas || freight ? input(note, 'weightKg', freight ? '總重量（kg）' : '重量（kg，選填）', { type: 'number', step: 'any', required: freight, changed: refresh })
      : input(note, 'shippingFee', '運費（台幣）', { type: 'number', step: '.01' }),
    ...(freight ? [] : [fee])),
    ...(overseas ? [grid(
      ...[['rate', '匯率'], ['freightRate', '運費（台幣／kg）']].map(([key, label]) =>
        input(note, key, label, { type: 'number', step: 'any', changed: () => {
          note.rateEdits[key] = ++rateEditSequence;
          refresh();
        } }))), estimate, procurementFields(note)]
      : freight ? [noteSection('國外訂單', freightPicker(note))]
        : [input(note, 'content', '內容（每行一項）', { type: 'textarea' })]),
    attachment, ...(overseas ? [input(note, 'feedback', '回饋', { type: 'textarea' })] : []), button('移除這張', () => {
      if (notes.length === 1) return;
      notes.splice(notes.indexOf(note), 1);
      section.remove();
    }));
  batchNotes.append(section);
  refresh();
}

function mostRecentRate(entries, key) {
  return entries.filter(entry => entry[key] !== '' && entry.rateEdits[key])
    .sort((a, b) => b.rateEdits[key] - a.rateEdits[key])[0];
}

byId('domestic').onclick = () => selectRegion('國內');
byId('overseas').onclick = () => selectRegion('國外');
byId('freight').onclick = () => selectRegion('回貨');
byId('addBatchNote').onclick = () => addBatchNote();
byId('applyPaste').onclick = () => {
  const paste = byId('pasteNotes');
  try {
    const entries = rules.templateRows(paste.value, batch.region === '回貨', batch.region === '國內');
    if (!entries.length) throw new Error('請先貼上資料。');
    if (notes.length === 1 && !hasNoteInput(notes[0])) {
      notes = [];
      batchNotes.replaceChildren();
    }
    entries.forEach(entry => addBatchNote(entry));
    paste.value = '';
    batchStatus.textContent = '';
  } catch (error) {
    batchStatus.textContent = error.message;
  }
};
byId('closeBatch').onclick = () => { if (!batchBusy) batchEditor.close(); };
batchEditor.addEventListener('cancel', event => { if (batchBusy) event.preventDefault(); });

batchForm.onsubmit = async event => {
  event.preventDefault();
  if (batchBusy) return;
  batchStatus.textContent = '';
  batchDuplicate.replaceChildren();
  batchBusy = true;
  batchEditor.inert = true;
  try {
    const batchKey = JSON.stringify([batch, notes.map(({ files, ...entry }) => entry)]);
    const uploads = {};
    const orders = [];
    for (const [index, entry] of notes.entries()) {
      const order = newOrder();
      const product = order.items[0];
      const style = product.variants[0];
      const freight = batch.region === '回貨';
      Object.assign(order, batch, {
        platform: freight ? '回貨' : entry.platform.trim(),
        paidAmount: entry.amount, cardFee: entry.fee,
        checklist: checklistFrom(entry.content)
      });
      if (order.platform === '1688') order.platform = '阿里巴巴／1688';
      if (!order.platform) throw new Error('第 ' + (index + 1) + ' 張請填寫平台。');
      if (order.paymentMethod !== '轉帳') delete order.bank;
      delete order.dictionary;
      delete order.creationDefaults;
      product.name = entry.name;
      product.weightKg = entry.weightKg;
      style.unitAmount = entry.amount;
      if (freight) {
        order.kind = 'freight';
        order.weightKg = entry.weightKg;
        order.items = [];
        order.sourceOrderIds = entry.sourceOrderIds || [];
        delete order.checklist;
        delete order.paymentMethod;
      } else if (batch.region === '國內') {
        style.unitAmount = rules.domesticSubtotal(entry.amount, entry.shippingFee);
        if (entry.shippingFee !== '') {
          order.adjustments.push({ id: uuid(), type: '平台運費', label: '運費', amount: entry.shippingFee });
        }
        if (order.platform === '超商') order.storeBrand = entry.storeBrand;
        if (order.platform === '其他官方') order.platformNote = entry.platformNote?.trim() || '';
      } else if (batch.currency === 'CNY') {
        order.estimate = { rate: entry.rate, freightRate: entry.freightRate };
        order.orderedAt = entry.orderedAt;
        order.feedback = entry.feedback.trim();
        order.procurement = entry.procurement;
      }
      for (const file of entry.files) {
        const { id, blob } = await imageRecord(file, 1600, 500000);
        if (blob) uploads[id] = blob;
        if (!order.screenshots.includes(id)) order.screenshots.push(id);
      }
      let saved;
      try {
        saved = rules.normalize(order);
      } catch (error) {
        throw new Error('第 ' + (index + 1) + ' 張：' + error.message);
      }
      saved.version = 1;
      saved.history = [{ at: new Date().toISOString(), action: '批次建檔' }];
      orders.push(saved);
    }
    state = await transaction(latest => {
      const repeats = [];
      for (const [index, order] of orders.entries()) {
        rules.verifyFreightLinks(order, [...latest.orders, ...orders.slice(0, index)]);
        const { suspected } = rules.duplicates(order, [...latest.orders, ...orders.slice(0, index)]);
        if (suspected) repeats.push('第 ' + (index + 1) + ' 張：' + (notes[index].name || '回貨'));
      }
      const duplicateKey = JSON.stringify([batchKey, repeats]);
      if (repeats.length && allowedBatchDuplicate !== duplicateKey) {
        const error = new Error('可能重複的明細：' + repeats.join('、'));
        error.batchKey = duplicateKey;
        throw error;
      }
      Object.assign(latest.images, uploads);
      if (batch.region === '國外') {
        for (const key of ['rate', 'freightRate']) {
          const lastEdit = mostRecentRate(notes, key);
          if (lastEdit) {
            latest.templateRates ||= {};
            latest.templateRates[key] = lastEdit[key];
          }
        }
      }
      latest.orders.push(...orders);
    });
    batchEditor.close();
    showOrders();
    byId('pageStatus').textContent = '已一次儲存 ' + orders.length + ' 筆訂單。';
  } catch (error) {
    batchStatus.textContent = error.message;
    if (error.batchKey) batchDuplicate.append(button('確認有相同明細，仍儲存整批', () => {
      allowedBatchDuplicate = error.batchKey;
      batchForm.requestSubmit();
    }));
  } finally {
    batchBusy = false;
    batchEditor.inert = false;
  }
};

byId('newOrder').disabled = true;
byId('newOrder').onclick = () => {
  batch = null;
  notes = [];
  batchNotes.replaceChildren();
  pending = {};
  batchForm.hidden = true;
  for (const id of ['domestic', 'overseas', 'freight']) byId(id).setAttribute('aria-pressed', 'false');
  batchEditor.showModal();
};
byId('closeEditor').onclick = () => editor.close();
byId('deleteOrder').onclick = () => changeDeleted(draft, true);
editor.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
editor.addEventListener('close', () => {
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls = [];
});
transaction().then(saved => {
  state = saved;
  showOrders();
  byId('newOrder').disabled = false;
}).catch(error => { byId('pageStatus').textContent = '無法開啟瀏覽器儲存：' + error.message; });
