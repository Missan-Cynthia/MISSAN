(function (root) {
  'use strict';
  const mainland = ['淘寶', '阿里巴巴／1688', '拼多多', '小紅書'];
  const platforms = ['蝦皮', '實體商店', '網路商店', ...mainland];
  const paymentMethods = ['現金', '信用卡', '轉帳'];
  const overseasMethods = ['支付寶', '信用卡'];
  const pickupPlaces = ['新華路', '7-11', '全家', '東安智取', '蝦皮店到店', '萊爾富', 'OK', '巧巧郎（私人集運）'];
  const domesticPlatforms = ['PCHOME', 'MOMO', '其他官方', '蝦皮', '超商'];
  const convenienceStores = ['7-11', '全家', '萊爾富', 'OK'];
  const shipping = ['待出貨', '配送中', '已到貨', '已領取'];

  function integer(value, label, minimum = 0) {
    const n = Number(value);
    if (String(value ?? '').trim() === '' || !Number.isSafeInteger(n) || n < minimum) {
      throw new Error(label + '須為大於或等於 ' + minimum + ' 的整數。');
    }
    return n;
  }

  function minor(value, label, optional = false) {
    const input = String(value ?? '').trim();
    if (optional && input === '') return null;
    if (!/^\d+(\.\d{1,2})?$/.test(input)) throw new Error(label + '須為非負金額，最多兩位小數。');
    const [whole, decimals = ''] = input.split('.');
    return integer(whole + decimals.padEnd(2, '0'), label);
  }

  function safe(value) {
    if (!Number.isSafeInteger(value)) throw new Error('數量或金額超過可記錄範圍。');
    return value;
  }

  function asAmount(value) {
    return value == null ? '' : (value / 100).toFixed(2);
  }

  function orderTotals(items, adjustments) {
    const subtotal = items.reduce((total, item) => safe(total + item.variants.reduce(
      (sum, variant) => safe(sum + safe(variant.unitMinor * variant.quantity)), 0)), 0);
    const expected = adjustments.reduce((total, fee) =>
      safe(total + (['折扣', '折抵'].includes(fee.type) ? -fee.amountMinor : fee.amountMinor)), subtotal);
    if (expected < 0) throw new Error('核對金額低於零，請檢查折扣及折抵。');
    return { subtotal, expected };
  }

  function allocation(rows, limit) {
    const ids = new Set();
    let count = 0;
    const result = rows.filter(row => row.recipientId).map(row => {
      if (ids.has(row.recipientId)) throw new Error('同一層級請合併相同使用者的分配。');
      ids.add(row.recipientId);
      const quantity = String(row.quantity ?? '').trim() ? integer(row.quantity, '分配數量', 1) : null;
      count = safe(count + (quantity || 0));
      return { recipientId: row.recipientId, quantity };
    });
    if (count > limit) throw new Error('使用者分配數量超過購買數量。');
    return result;
  }

  function normalize(input) {
    const order = structuredClone(input);
    if (order.kind === 'freight') {
      order.paidMinor = minor(order.paidAmount, '總運費');
      if (!order.orderedAt || !Number.isFinite(Number(order.weightKg)) || Number(order.weightKg) <= 0) {
        throw new Error('請填寫回貨日期及大於零的總重量。');
      }
      delete order.paidAmount;
      order.currency = 'TWD';
      order.expected = order.paidMinor;
      return order;
    }
    order.platform = order.platform.trim();
    if (order.region === '國內' && order.platform === '超商' && !convenienceStores.includes(order.storeBrand)) {
      throw new Error('請選擇超商品牌。');
    }
    if (order.region === '國內') {
      if (order.platform !== '超商') delete order.storeBrand;
      if (order.platform !== '其他官方') delete order.platformNote;
    }
    if (typeof order.number === 'string') order.number = order.number.trim();
    if (order.region === '國外' && !['CNY', 'TWD'].includes(order.currency)) throw new Error('請選擇國外訂單幣別。');
    order.currency = order.region === '國內' ? 'TWD' : order.region === '國外' ? order.currency :
      mainland.includes(order.platform) ? 'CNY' : 'TWD';
    if ((!order.platform && !order.region) || !order.orderedAt) throw new Error('請填寫訂單日期及購買平台。');
    if (order.region === '國外' && order.paymentMethod === '信用卡' && Object.hasOwn(order, 'cardFee')) {
      order.cardFeeMinor = minor(order.cardFee, '信用卡手續費', true);
    } else if (order.region) {
      delete order.cardFeeMinor;
    }
    delete order.cardFee;
    if (order.procurement) {
      order.procurement = order.procurement.map(entry => ({
        name: entry.name.trim(),
        ...(entry.notes?.trim() ? { notes: entry.notes.trim() } : {}),
        ...(String(entry.quantity ?? '') !== '' ? { quantity: integer(entry.quantity, '商品數量', 1) } : {}),
        ...(String(entry.unitAmount ?? '') !== '' ? { unitAmount: asAmount(minor(entry.unitAmount, '商品單價')) } : {}),
        labels: entry.labels.filter(label => label.user.trim() || String(label.quantity ?? '') !== '').map(label => {
          const user = label.user.trim();
          const quantity = Number(label.quantity);
          if (!user || !Number.isSafeInteger(quantity) || quantity <= 0) {
            throw new Error('使用者標籤須填寫姓名和正整數數量。');
          }
          return { user, quantity };
        })
      }));
    }
    if (!['轉帳', '銀行轉帳'].includes(order.paymentMethod)) delete order.bank;
    else if (typeof order.bank === 'string') order.bank = order.bank.trim();
    if (!order.items.length) throw new Error('請加入至少一個品項。');
    for (const item of order.items) {
      item.name = item.name.trim();
      if (!item.name || !item.variants.length) throw new Error('請填寫商品名稱並保留至少一個款式。');
      let count = 0;
      for (const variant of item.variants) {
        variant.quantity = integer(variant.quantity, '購買數量', 1);
        variant.unitMinor = minor(variant.unitAmount, '商品單價');
        delete variant.unitAmount;
        variant.recipients = allocation(variant.recipients, variant.quantity);
        count = safe(count + variant.quantity);
      }
      const variantAssigned = item.variants.flatMap(variant => variant.recipients)
        .reduce((total, row) => safe(total + (row.quantity || 0)), 0);
      item.recipients = allocation(item.recipients, count - variantAssigned);
      item.quantity = count;
    }
    order.adjustments = order.adjustments.map(fee => ({
      id: fee.id, type: fee.type, label: fee.label.trim(), amountMinor: minor(fee.amount, fee.type)
    }));
    order.paidMinor = minor(order.paidAmount, '實際付款金額', true);
    delete order.paidAmount;
    Object.assign(order, orderTotals(order.items, order.adjustments));
    if (order.paidMinor !== null && order.paidMinor !== order.expected) {
      throw new Error('金額不符：明細合計 ' + asAmount(order.expected) + '，實際付款 ' + asAmount(order.paidMinor) + '。');
    }
    if (order.paid && order.paidMinor === null) throw new Error('付款前請填寫實際付款金額。');
    if (order.currency === 'CNY' && order.paid && (!order.region || order.paymentMethod === '支付寶')) throw new Error('支付寶帳務尚未接通，請先以未付款保存。');
    if (![...shipping, ...((order.region === '國外' || order.currency === 'CNY') ? ['已上船'] : [])].includes(order.shipping)) {
      throw new Error('請選擇適用的貨運狀態。');
    }
    return order;
  }

  function duplicates(order, saved) {
    const others = saved.filter(previous => !previous.deletedAt && previous.id !== order.id && previous.kind === order.kind);
    const exact = order.number && others.find(previous =>
      previous.platform === order.platform && previous.number === order.number);
    const products = value => value.kind === 'freight'
      ? [value.weightKg, ...(value.sourceOrderIds || []).slice().sort(), ...(value.checklist || []).map(entry => entry.name)].join('|')
      : value.items.map(item => item.name + '×' + item.quantity).sort().join('|');
    const suspected = others.find(previous =>
      order.screenshots.some(image => previous.screenshots.includes(image)) ||
      (previous.platform === order.platform && previous.currency === order.currency && previous.orderedAt.slice(0, 10) === order.orderedAt.slice(0, 10) &&
       order.paidMinor !== null && previous.paidMinor === order.paidMinor && products(previous) === products(order)));
    return { exact, suspected };
  }

  function batchEntries(text, hasFee) {
    return text.split(/\r?\n/).flatMap((line, index) => {
      if (!line.trim()) return [];
      const columns = (line.includes('\t') ? line.split('\t') : line.split(/[|｜]/)).map(value => value.trim());
      const [name, amount, variant = '', fee = ''] = columns;
      try {
        if (!name || columns.length < 2 || columns.length > (hasFee ? 4 : 3)) throw new Error('請依欄位順序貼上明細。');
        minor(amount, '金額');
        if (hasFee) minor(fee, '信用卡手續費', true);
        return [{ name, amount, variant, fee, line: index + 1 }];
      } catch (error) {
        throw new Error('第 ' + (index + 1) + ' 行：' + error.message);
      }
    });
  }

  function templateRows(text, freight, domestic = false) {
    return text.split(/\r?\n/).flatMap((line, index) => {
      if (!line.trim()) return [];
      const columns = line.split('\t').map(value => value.trim());
      const [platform, name, amount, weightKg = '', content = '', platformDetail = ''] = freight
        ? ['', '', columns[1], columns[0], columns[2]] : columns;
      if (columns.length > (freight ? 3 : domestic ? 6 : 5) || (!freight && (!platform || !name))) {
        throw new Error('第 ' + (index + 1) + ' 行：請按欄位順序貼上試算表資料。');
      }
      try {
        minor(amount, freight ? '總運費' : '實付金額');
        if (domestic) domesticSubtotal(amount, weightKg);
        else if ((freight || weightKg) && (!Number.isFinite(Number(weightKg)) || Number(weightKg) <= 0)) {
          throw new Error('重量須大於零。');
        }
      } catch (error) {
        throw new Error('第 ' + (index + 1) + ' 行：' + error.message);
      }
      const fields = domestic
        ? { shippingFee: weightKg, ...(platform === '超商' ? { storeBrand: platformDetail.toUpperCase() }
          : platform === '其他官方' ? { platformNote: platformDetail } : {}) }
        : { weightKg };
      return [{ platform, name, amount, ...fields, content: content.split('／').join('\n') }];
    });
  }

  function templateCost(amount, rate, weight, freightRate) {
    function decimal(value) {
      const match = /^(\d+)(?:\.(\d+))?$/.exec(String(value ?? '').trim());
      if (!match) return null;
      const fraction = match[2] || '';
      return [BigInt(match[1] + fraction), 10n ** BigInt(fraction.length)];
    }
    function multiply(a, b) {
      const left = decimal(a);
      const right = decimal(b);
      return left && right ? [left[0] * right[0], left[1] * right[1]] : null;
    }
    function display(value) {
      if (!value) return '';
      const [n, d] = value;
      const fraction = (n % d).toString().padStart(d.toString().length - 1, '0').replace(/0+$/, '');
      return (n / d).toString() + (fraction ? '.' + fraction : '');
    }
    const goods = multiply(amount, rate);
    const freight = multiply(weight, freightRate);
    let total = '';
    if (goods && freight) {
      const denominator = goods[1] * freight[1];
      const numerator = goods[0] * freight[1] + freight[0] * goods[1];
      total = ((2n * numerator + denominator) / (2n * denominator)).toString();
    }
    return { goods: display(goods), freight: display(freight), total };
  }

  function domesticSubtotal(paid, shippingFee) {
    const fee = minor(shippingFee, '運費', true) ?? 0;
    const subtotal = minor(paid, '實付金額') - fee;
    if (subtotal < 0) throw new Error('運費不得大於實付金額。');
    return asAmount(subtotal);
  }

  function isOverseas(order) {
    return order.region === '國外' || (!order.region && mainland.includes(order.platform));
  }

  function availableFreightOrders(orders, freightId, selected = []) {
    const occupied = new Set(orders.filter(order => order.kind === 'freight' && !order.deletedAt && order.id !== freightId)
      .flatMap(order => order.sourceOrderIds || []));
    return orders.filter(order => isOverseas(order) && ((!order.deletedAt && !occupied.has(order.id)) || selected.includes(order.id)));
  }

  function verifyFreightLinks(order, orders, previous = []) {
    if (order.kind !== 'freight' || !order.sourceOrderIds) return;
    if (!order.sourceOrderIds.length) throw new Error('請從國外訂單選取至少一筆。');
    const available = new Set(availableFreightOrders(orders, order.id, previous).map(entry => entry.id));
    if (order.sourceOrderIds.some(id => !available.has(id))) {
      throw new Error('選取的國外訂單已刪除或已加入其他回貨，請重新選取。');
    }
  }

  const api = { mainland, platforms, paymentMethods, overseasMethods, pickupPlaces, domesticPlatforms, convenienceStores,
    shipping, minor, asAmount, normalize, duplicates, batchEntries, templateRows, templateCost, domesticSubtotal,
    availableFreightOrders, verifyFreightLinks };
  if (typeof module === 'object') module.exports = api;
  else root.MissAnOrders = api;
})(globalThis);
