import {test} from 'node:test';
import assert from 'node:assert/strict';
import {empty, locations, locationPath, saveEdit} from './public/core.js';

const save = (state, change, operationId = 'op' + (state.version + 1)) =>
  saveEdit(state, state.version, change, operationId, '2026-11-17T00:00:00.000Z');

test('階層路徑、改名後關聯、版本遞增', () => {
  let state = save(empty(), {id: 'home', name: '家', parentId: null});
  state = save(state, {id: 'closet', name: '衣櫃', parentId: 'home'});
  state = save(state, {id: 'home', name: '家中', parentId: null});
  assert.equal(state.version, 3);
  assert.equal(state.records.closet.parentId, 'home');
  assert.equal(locationPath(state, 'closet'), '家中 › 衣櫃');
});

test('拒絕循環及移除含子項的位置，移除子項保留固定 ID', () => {
  let state = save(empty(), {id: 'home', name: '家', parentId: null});
  state = save(state, {id: 'closet', name: '衣櫃', parentId: 'home'});
  assert.throws(() => save(state, {id: 'home', name: '家', parentId: 'closet'}), /循環/);
  assert.throws(() => save(state, {id: 'home', remove: true}), /下層/);
  state = save(state, {id: 'closet', remove: true});
  assert.ok(state.records.closet.deletedAt);
  assert.deepEqual(locations(state).map(row => row.id), ['home']);
  assert.throws(() => save(state, {id: 'box', name: '箱子', parentId: 'closet'}), /已移除/);
});

test('交易重複執行及過期版本', () => {
  const change = {id: 'home', name: '家', parentId: null};
  const state = save(empty(), change, 'operation-1');
  assert.equal(saveEdit(state, 0, change, 'operation-1', ''), state);
  assert.throws(() => saveEdit(state, 0, {...change, name: '新版'}, 'operation-2', ''), /別處更新/);
  assert.equal(state.records.home.name, '家');
});
