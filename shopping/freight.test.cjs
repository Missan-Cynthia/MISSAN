const assert = require('node:assert/strict');
const { test } = require('node:test');
const { freightQuote, freightAllocations } = require('./freight.js');

test('規格的十個計費案例以整批重量計算', () => {
  for (const [kg, billed] of [['2.30', 5], ['4.29', 5], ['4.99', 5], ['5', 5], ['5.01', 5.5],
    ['5.51', 6], ['16.50', 16.5], ['16.56', 17], ['16.99', 17], ['17.01', 17.5]]) {
    const result = freightQuote([{ weightKg: kg }], 10000);
    assert.equal(result.billing, billed * 1000);
    assert.equal(result.quoteMinor, billed * 10000);
  }
  assert.equal(freightQuote([{ weightKg: '0.1' }, { weightKg: '5.4' }], 10000).billing, 5500);
});

test('分攤守恆，尾差按餘數與固定 ID 分配', () => {
  const items = [{ id: 'c', weightKg: '1' }, { id: 'a', weightKg: '1' }, { id: 'b', weightKg: '1' }];
  assert.deepEqual(freightAllocations(items, 100).map(line => line.amountMinor), [33, 34, 33]);
  assert.equal(freightAllocations(items, 50009).reduce((sum, line) => sum + line.amountMinor, 0), 50009);
  assert.throws(() => freightAllocations([items[0], items[0]], 100), /只能分攤一次/);
  assert.throws(() => freightQuote([{ weightKg: '' }], 100), /確認商品重量/);
});
