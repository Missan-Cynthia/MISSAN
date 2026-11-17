const assert = require('node:assert/strict');
const { test } = require('node:test');
const { replayWallet } = require('./wallet.js');
const topups = [
  { id: 'a', at: '2026-11-01T08:00:00+08:00', cnyMinor: 100000, twdPrincipalMinor: 476000, twdFeeMinor: null },
  { id: 'b', at: '2026-11-02T08:00:00+08:00', cnyMinor: 100000, twdPrincipalMinor: 430000, twdFeeMinor: 0 }
];
const payment = { id: 'p', at: '2026-11-03T08:00:00+08:00', cnyMinor: 120000 };

test('跨批 FIFO 先用舊批，補登費用只改成本', () => {
  const before = replayWallet(topups, [payment]);
  assert.equal(before.balance, 80000);
  assert.equal(before.transactions[0].twdMinor, 562000);
  assert.deepEqual(before.transactions[0].allocations.map(line => line.cnyMinor), [100000, 20000]);
  assert.deepEqual(before.batches.map(batch => batch.feeConfirmed), [false, true]);
  const after = replayWallet([{ ...topups[0], twdFeeMinor: 2000 }, topups[1]], [payment]);
  assert.equal(after.balance, before.balance);
  assert.equal(after.transactions[0].twdMinor, 564000);
});

test('歷史重算阻止負餘額及重複交易', () => {
  assert.throws(() => replayWallet(topups, [{ ...payment, at: topups[0].at }]), /餘額不足/);
  assert.throws(() => replayWallet(topups, [payment, payment]), /交易 ID 重複/);
  const order = { ...payment, cnyMinor: 50000, at: '2026-11-01T16:00:00+08:00' };
  const recalculated = replayWallet(topups, [order]);
  assert.equal(recalculated.transactions[0].twdMinor, 238000);
  assert.equal(recalculated.balance, 150000);
});

test('多次小額扣款與剩餘成本合計等於原批成本', () => {
  const lot = { ...topups[0], cnyMinor: 3, twdPrincipalMinor: 10 };
  const payments = ['p1', 'p2', 'p3'].map(id => ({ ...payment, id, cnyMinor: 1 }));
  const ledger = replayWallet([lot], payments);
  assert.deepEqual(ledger.transactions.map(line => line.twdMinor), [3, 4, 3]);
  assert.equal(ledger.batches[0].twdRemainingMinor, 0);
});
