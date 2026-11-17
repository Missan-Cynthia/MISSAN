const assert = require('node:assert/strict');
const { test } = require('node:test');
const { parse } = require('./ocr.js');

test('同訂單多圖重疊只帶入一次，明確標示的平台、日期、金額及商品可擷取', () => {
  const screen = ['蝦 皮', '訂單時間：2026-11-16 09:30', '實付金額：NT$1,200',
    '商 品 名 稱：棉襪', '數量：2', '單價：600'].join('\n');
  const result = parse([screen, screen]);
  assert.deepEqual(result.values, { platform: '蝦皮', paidAmount: '1200', orderedAt: '2026-11-16T09:30:00' });
  assert.deepEqual(result.products, [{ name: '棉襪', quantity: '2', unitAmount: '600' }]);
});

test('衝突金額、無效日期及跨張無歸屬數量不會填入', () => {
  const result = parse(['实付：¥66\n订单时间：2026-02-30 10:00\n商品名称：袜子', '实付：¥60\n数量：2']);
  assert.deepEqual(result.values, {});
  assert.deepEqual(result.conflicts, ['paidAmount']);
  assert.deepEqual(result.products, [{ name: '袜子' }]);
});

test('無商品標籤的淘寶卡片可讀取單價、數量、款式及訂單層實付', () => {
  const text = [
    '07:44', '待 发 货', '承诺明天07:44前发货', '88 VIP 好评率97%',
    '旋转小魔豆魔方盘儿童智力双... ∨ ¥ 7.98', '升级款魔团 (送挂绳) -白色 x 1',
    'TW本地退 极速退款', '实付价 ¥ 6.98 备注',
    '价格明细 实付款 ¥ 7.98', '订单信息 共4项 复制'
  ].join('\n');
  const result = parse([text]);
  assert.deepEqual(result.values, { platform: '淘寶', paidAmount: '7.98', shipping: '待出貨' });
  assert.deepEqual(result.products, [{
    name: '旋转小魔豆魔方盘儿童智力双...', unitAmount: '7.98', quantity: '1', variant: '升级款魔团 (送挂绳) -白色'
  }]);
});

test('不同 OCR 區塊的單價與數量依座標併回各自所在列', () => {
  const { rowsFromTsv } = require('./ocr.js');
  const word = (left, top, value) => [5, 1, 1, 1, 1, 1, left, top, 61, 20, 95, value].join('\t');
  const tsv = ['level', word(500, 100, '¥7.98'), word(150, 101, '玩具'), word(500, 133, 'x1'), word(150, 134, '白色')].join('\n');
  assert.equal(rowsFromTsv(tsv), '玩具 ¥7.98\n白色 x1');
});
