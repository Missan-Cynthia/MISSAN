const assert = require('node:assert/strict');
const { test } = require('node:test');
const { normalize, duplicates, minor } = require('./orders.js');

function sample() {
  return {
    id: 'order', platform: '蝦皮', number: 'A001', orderedAt: '2026-11-16T16:00',
    paymentMethod: 'LINE Pay', pickupPlace: '新華路', paid: true, paidAmount: '110.01',
    shipping: '配送中', screenshots: ['fingerprint'],
    adjustments: [
      { id: 'discount', type: '折扣', label: '', amount: '9.99' },
      { id: 'postage', type: '平台運費', label: '', amount: '10' }
    ],
    items: [
      { id: 'item-a', name: '襪子', recipients: [{ recipientId: '樂', quantity: '1' }], variants: [
        { id: 'red', unitAmount: '20', quantity: '2', recipients: [{ recipientId: '杰', quantity: '1' }] },
        { id: 'blue', unitAmount: '50', quantity: '1', recipients: [] }
      ] },
      { id: 'item-b', name: '鉛筆', recipients: [], variants: [
        { id: 'plain', unitAmount: '10', quantity: '2', recipients: [{ recipientId: '送人', quantity: '' }] }
      ] }
    ]
  };
}

test('多品項、款式、付款工具及取貨分開保存，費用守恆', () => {
  const order = normalize(sample());
  assert.equal(order.subtotal, 11000);
  assert.equal(order.expected, 11001);
  assert.equal(order.paidMinor, 11001);
  assert.equal(order.paymentMethod, 'LINE Pay');
  assert.equal(order.pickupPlace, '新華路');
  assert.equal(order.items[0].quantity, 3);
  assert.equal(order.items[1].variants[0].recipients[0].quantity, null);
});

test('跨款式與品項的使用者超額分配被阻擋', () => {
  const order = sample();
  order.items[0].recipients[0].quantity = '3';
  assert.throws(() => normalize(order), /超過購買數量/);
});

test('核對不符、已付款但未填實付及未接通的人民幣扣款均被阻擋', () => {
  const order = sample();
  order.paidAmount = '110.02';
  assert.throws(() => normalize(order), /金額不符/);
  order.paidAmount = '';
  assert.throws(() => normalize(order), /實際付款金額/);
  order.platform = '淘寶';
  order.paidAmount = '110.01';
  assert.throws(() => normalize(order), /支付寶/);
  order.paid = false;
  order.shipping = '已上船';
  assert.equal(normalize(order).currency, 'CNY');
});

test('辨識固定編號與疑似重複，排除原單自己', () => {
  const saved = normalize(sample());
  assert.equal(duplicates(saved, [saved]).suspected, undefined);
  const order = { ...saved, id: 'new' };
  assert.equal(duplicates(order, [saved]).exact.id, 'order');
  order.number = 'A002';
  order.screenshots = [];
  assert.equal(duplicates(order, [saved]).suspected.id, 'order');
  order.platform = '其他';
  order.screenshots = ['fingerprint'];
  assert.equal(duplicates(order, [saved]).suspected.id, 'order');
});

test('金額以整數精確處理，拒絕超出小數位數及數值範圍', () => {
  assert.equal(minor('000.09', '金額'), 9);
  assert.throws(() => minor('0.009', '金額'), /小數/);
  assert.throws(() => minor('90071992547410', '金額'), /整數/);
});

test('批次接受跨行試算表與直線分隔，錯誤指出行號', () => {
  const { batchEntries } = require('./orders.js');
  assert.deepEqual(batchEntries('玩具\t7.98\t白色\t2\n\n文具｜10', true), [
    { name: '玩具', amount: '7.98', variant: '白色', fee: '2', line: 1 },
    { name: '文具', amount: '10', variant: '', fee: '', line: 3 }
  ]);
  assert.throws(() => batchEntries('玩具｜8\n文具｜錯誤', false), /第 2 行/);
});

test('國外信用卡可標記已付，台幣手續費獨立於原幣合計', () => {
  const order = { ...sample(), region: '國外', platform: '', paymentMethod: '信用卡', cardFee: '2', currency: 'CNY' };
  const saved = normalize(order);
  assert.equal(saved.paid, true);
  assert.equal(saved.expected, 11001);
  assert.equal(saved.cardFeeMinor, 200);
  assert.throws(() => normalize({ ...order, paymentMethod: '支付寶' }), /支付寶/);
  assert.equal(normalize({ ...order, region: '國內', paymentMethod: '轉帳', bank: ' 某銀行 ' }).bank, '某銀行');
});

test('不同平台筆記和回貨筆記可批次貼上，保留整筆金額與多行內容', () => {
  const { templateRows } = require('./orders.js');
  const orders = templateRows('淘寶\t包邊條\t167.24\t0.7\t米白／漂白／米黃\n1688\t包包\t57\t0.56\t提袋／胸包', false);
  assert.equal(orders.length, 2);
  assert.equal(orders[0].content, '米白\n漂白\n米黃');
  assert.equal(orders[1].amount, '57');
  const [freight] = templateRows('17\t1292\t過年掛件／牙刷', true);
  const saved = normalize({ kind: 'freight', orderedAt: '2026-11-15T00:00', weightKg: freight.weightKg, paidAmount: freight.amount, items: [] });
  assert.equal(saved.expected, 129200);
  assert.equal(saved.items.length, 0);
});

test('人民幣範本只在兩筆小計相加後四捨五入', () => {
  const { templateCost } = require('./orders.js');
  assert.deepEqual(templateCost('167.24', '4.95', '0.7', '75'), { goods: '827.838', freight: '52.5', total: '880' });
  assert.deepEqual(templateCost('17.3', '4.95', '0.46', '75'), { goods: '85.635', freight: '34.5', total: '120' });
  assert.equal(templateCost('0.2', '1', '0.3', '1').total, '1');
  assert.equal(templateCost('57', '4.95', '', '75').total, '');
});

test('採購標籤保留使用者與數量，拒絕未完成標籤', () => {
  const order = sample();
  order.procurement = [{ name: ' 米白 ', labels: [{ user: ' 自用 ', quantity: '2' }] }];
  assert.deepEqual(normalize(order).procurement, [{ name: '米白', labels: [{ user: '自用', quantity: 2 }] }]);
  order.procurement[0].labels[0].quantity = '';
  assert.throws(() => normalize(order), /正整數/);
});

test('商品明細儲存備註、數量、單價與同商品的使用者標籤', () => {
  const order = sample();
  order.procurement = [{ name: '米白', notes: ' 十公尺 ', quantity: '3', unitAmount: '12.8',
    labels: [{ user: '自用', quantity: '2' }] }];
  assert.deepEqual(normalize(order).procurement, [{ name: '米白', notes: '十公尺', quantity: 3, unitAmount: '12.80',
    labels: [{ user: '自用', quantity: 2 }] }]);
});

test('已刪除筆記不阻擋重新建檔', () => {
  const order = normalize(sample());
  const deleted = { ...order, id: 'deleted', deletedAt: '2026-11-17T08:00:00Z' };
  assert.equal(Boolean(duplicates(order, [deleted]).exact), false);
  assert.equal(duplicates(order, [deleted]).suspected, undefined);
});

test('國內運費包含在實付款，超商必須選品牌', () => {
  const { domesticSubtotal, templateRows } = require('./orders.js');
  assert.equal(domesticSubtotal('150', '60'), '90.00');
  assert.throws(() => domesticSubtotal('50', '60'), /大於實付/);
  assert.equal(templateRows('超商\t文具\t150\t60\t\tok', false, true)[0].storeBrand, 'OK');
  assert.throws(() => normalize({ ...sample(), platform: '超商', region: '國內' }), /超商品牌/);
});

test('回貨只接受未加入其他有效回貨的國外訂單', () => {
  const { availableFreightOrders, verifyFreightLinks } = require('./orders.js');
  const overseas = { id: 'a', region: '國外' };
  const local = { id: 'b', region: '國內' };
  const freight = { id: 'f', kind: 'freight', sourceOrderIds: ['a'] };
  assert.deepEqual(availableFreightOrders([overseas, local, freight]), []);
  assert.deepEqual(availableFreightOrders([overseas, local, freight], 'f'), [overseas]);
  assert.throws(() => verifyFreightLinks({ ...freight, id: 'g' }, [overseas, freight]), /已加入/);
  assert.throws(() => verifyFreightLinks({ ...freight, sourceOrderIds: [] }, [overseas]), /至少一筆/);
  assert.doesNotThrow(() => verifyFreightLinks(freight, [overseas]));
});
