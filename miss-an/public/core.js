export const modules = Object.freeze([
  {id: 'WARDROBE-001', name: '衣櫃'},
  {id: 'SHOPPING-001', name: '購物'}
]);
export const empty = () => ({schemaVersion: 1, version: 0, operationId: '', records: {}});
export const testKey = 'miss-an:m1:test:locations';

export function editLocation(state, {id, name, parentId, remove}, operationId, time) {
  const records = {...state.records};
  const current = records[id];
  if (remove) {
    if (!current || current.deletedAt) throw new Error('收納位置已移除。');
    if (Object.values(records).some(row => !row.deletedAt && row.parentId === id)) {
      throw new Error('請先移動或移除下層位置。');
    }
    records[id] = {...current, updatedAt: time, deletedAt: time};
  } else {
    name = name.trim();
    if (!name) throw new Error('請輸入位置名稱。');
    if (current?.deletedAt) throw new Error('收納位置已移除。');
    const seen = new Set([id]);
    for (let ancestor = parentId; ancestor; ancestor = records[ancestor].parentId) {
      if (seen.has(ancestor)) throw new Error('上層位置不能形成循環。');
      if (!records[ancestor] || records[ancestor].deletedAt) throw new Error('上層位置已移除。');
      seen.add(ancestor);
    }
    records[id] = {id, name, parentId, createdAt: current?.createdAt ?? time, updatedAt: time, deletedAt: null};
  }
  return {...state, records, version: state.version + 1, operationId};
}

export function locations(state) {
  return Object.values(state.records).filter(row => !row.deletedAt);
}

export function locationPath(state, id) {
  const names = [];
  for (let row = state.records[id]; row; row = state.records[row.parentId]) names.unshift(row.name);
  return names.join(' › ');
}

export function saveEdit(current, expected, change, operationId, time) {
  if (current.operationId === operationId) return current;
  if (current.version !== expected) throw new Error('資料已在別處更新。請重新載入後再確認這次修改。');
  return editLocation(current, change, operationId, time);
}

export const previewStore = {
  async read() {
    return JSON.parse(localStorage.getItem(testKey)) ?? empty();
  },
  async save(expected, change) {
    return navigator.locks.request(testKey, async () => {
      const next = saveEdit(await this.read(), expected, change, crypto.randomUUID(), new Date().toISOString());
      localStorage.setItem(testKey, JSON.stringify(next));
      return next;
    });
  }
};
