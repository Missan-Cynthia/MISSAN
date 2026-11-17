(function (root) {
  'use strict';
  const money = String.raw`([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)`;
  const unitAtEnd = new RegExp(String.raw`(?:[¥￥$]|\bCNY\s*)\s*${money}\s*$`, 'i');
  const quantityAtEnd = /[x×✕]\s*(\d+)\s*$/i;
  const clean = text => text.replace(/\s+/g, '');
  const taobaoLayout = page => {
    const text = clean(page.join(''));
    return /88VIP/i.test(text) && /[价價]格明[细細]/.test(text) && /[订訂][单單](?:信息|資訊)/.test(text);
  };

  function cardProducts(page) {
    const products = [];
    let end = page.findIndex(line => /[价價]格明[细細]|[订訂][单單](?:信息|資訊)/.test(clean(line)));
    if (end < 0) end = page.length;
    for (let i = 0; i < end - 1; i++) {
      const title = page[i];
      const price = title.match(unitAtEnd);
      if (!price) continue;
      const name = title.slice(0, price.index).trim().replace(/[⌄∨▼>›]+$/, '').trim()
        .replace(/(?<=\p{Script=Han})\s+(?=\p{Script=Han})/gu, '');
      if (!/\p{Script=Han}/u.test(name) || /^(?:[实實]付|[单單][价價]|[运運][费費]|商品[總总]額|[优優]惠)/.test(clean(name))) continue;
      const following = [];
      for (const line of page.slice(i + 1, Math.min(i + 5, end))) {
        if (unitAtEnd.test(line) || /^(?:TW本地退|[实實]付)/i.test(clean(line))) break;
        following.push(line);
      }
      const specLine = following.find(line => quantityAtEnd.test(line)) ||
        following.find(line => /(?:[升昇]级款|升級款|[颜顏]色|尺[寸碼]|白色|黑色)/.test(clean(line)));
      const quantity = specLine?.match(quantityAtEnd);
      if (!quantity && !taobaoLayout(page)) continue;
      const variant = (quantity ? specLine.slice(0, quantity.index) : specLine || '').trim()
        .replace(/(?<=\p{Script=Han})\s+(?=\p{Script=Han})/gu, '');
      products.push({ name, unitAmount: price[1].replace(/,/g, ''),
        ...(quantity ? { quantity: quantity[1] } : {}), ...(variant ? { variant } : {}) });
      if (specLine) i = page.indexOf(specLine, i + 1);
    }
    return products;
  }

  function rowsFromTsv(tsv) {
    const words = String(tsv ?? '').trim().split(/\r?\n/).slice(1).flatMap(line => {
      const columns = line.split('\t');
      if (columns[0] !== '5' || !columns[11]?.trim()) return [];
      const [left, top, width, height] = columns.slice(6, 10).map(Number);
      return [{ left, right: left + width, center: top + height / 2, height, text: columns[11].trim() }];
    }).sort((a, b) => b.height - a.height);
    const rows = [];
    for (const word of words) {
      const row = rows.filter(entry => Math.abs(word.center - entry.center) <= entry.height * .46)
        .sort((a, b) => Math.abs(word.center - a.center) - Math.abs(word.center - b.center))[0];
      if (row) row.words.push(word);
      else rows.push({ center: word.center, height: word.height, words: [word] });
    }
    rows.sort((a, b) => a.center - b.center);
    const rowText = words => words.map(word => word.text).join(' ');
    for (const row of rows) row.words.sort((a, b) => a.left - b.left);
    const lines = rows.map(row => rowText(row.words));
    const hasPriceDetails = lines.some(line => /[价價]格明[细細]/.test(clean(line)));
    if (!hasPriceDetails) return lines.join('\n');
    const edge = words.reduce((max, word) => Math.max(max, word.right), 0);
    return rows.map((row, index) => {
      const line = lines[index];
      if (!unitAtEnd.test(line) || /[价價]格明[细細]|[实實]付/.test(clean(line))) return line;
      const card = row.words.filter(word => word.left >= edge * .28);
      return card.length && /\p{Script=Han}/u.test(rowText(card)) ? rowText(card) : line;
    }).join('\n');
  }

  function parse(texts) {
    const pages = texts.map(text => text.normalize('NFKC').split(/\r?\n/)
      .map(line => line.trim()).filter(Boolean));
    const lines = pages.flat();
    const compact = lines.map(line => clean(line).replace(/(?<=\d)[·•](?=\d{2}(?:\D|$))/g, '.'));
    const values = {};
    const conflicts = [];
    function choose(key, candidates) {
      const unique = [...new Set(candidates.filter(Boolean))];
      if (unique.length === 1) values[key] = unique[0];
      if (unique.length > 1) conflicts.push(key);
    }
    const platforms = [
      [/蝦皮|虾皮|shopee/i, '蝦皮'], [/淘寶|淘宝/, '淘寶'],
      [/1688|阿里巴巴/, '阿里巴巴／1688'], [/拼多多/, '拼多多'], [/小紅書|小红书/, '小紅書']
    ].filter(([pattern]) => compact.some(line => pattern.test(line))).map(([, platform]) => platform);
    if (pages.some(taobaoLayout)) platforms.push('淘寶');
    choose('platform', platforms);
    const amount = /(?:實際付款|实际付款|實付金額|实付金额|付款金額|付款金额|實付款|实付款|^實付|^实付):?(?:NT\$|TWD|RMB|CNY|[¥￥$])?([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)(?:元)?$/i;
    const explicitTotals = compact.map(line => line.match(amount)?.[1]).filter(Boolean);
    const cardTotals = platforms.includes('淘寶') ? compact.flatMap(line => {
      if (!/^[价價]格明[细細]/.test(line)) return [];
      return [line.match(unitAtEnd)?.[1]].filter(Boolean);
    }) : [];
    choose('paidAmount', (explicitTotals.length ? explicitTotals : cardTotals).map(value => value.replace(/,/g, '')));
    choose('shipping', compact.filter(line => /^待[发發][货貨]$/.test(line)).map(() => '待出貨'));
    const date = /^(?:訂單時間|订单时间|下單時間|下单时间|訂單日期|订单日期|付款時間|付款时间):?(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
    for (const [key, label] of [['orderedAt', /^(?:訂單|订单|下單|下单)/], ['paidAt', /^付款/]]) {
      choose(key, compact.filter(line => label.test(line)).map(line => {
        const result = line.match(date);
        if (!result) return null;
        const [, year, month, day, hour, minute, second = '00'] = result;
        const value = [year, month.padStart(2, '0'), day.padStart(2, '0')].join('-') + 'T' +
          [hour.padStart(2, '0'), minute, second].join(':');
        const check = new Date(value + 'Z');
        return Number.isFinite(check.getTime()) && check.toISOString().slice(0, 19) === value ? value : null;
      }));
    }
    const distinct = new Map();
    for (const page of pages) {
      const products = [];
      let product;
      for (const line of page) {
        const name = line.match(/^商\s*品\s*名\s*[稱称]\s*:\s*(.+)$/);
        if (name) {
          product = { name: name[1].trim() };
          products.push(product);
          continue;
        }
        if (!product) continue;
        const normalized = line.replace(/\s+/g, '');
        const quantity = normalized.match(/^[數数]量:(\d+)$/);
        const unit = normalized.match(/^[單单][價价]:(?:NT\$|[¥$])?(\d+(?:\.\d{1,2})?)$/);
        if (quantity) product.quantity = quantity[1];
        if (unit) product.unitAmount = unit[1];
      }
      const occurrences = new Map();
      for (const entry of products.length ? products : cardProducts(page)) {
        const signature = JSON.stringify(entry);
        const index = occurrences.get(signature) ?? 0;
        occurrences.set(signature, index + 1);
        distinct.set(signature + ':' + index, entry);
      }
    }
    return { values, conflicts, products: [...distinct.values()], lines: [...new Set(lines)] };
  }
  if (typeof module === 'object') module.exports = { parse, rowsFromTsv };
  else root.MissAnOcr = { parse, rowsFromTsv };
})(globalThis);
