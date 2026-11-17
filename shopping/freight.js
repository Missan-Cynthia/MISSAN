(function (root) {
  'use strict';

  const safe = value => {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('數字超過可記錄範圍。');
    return value;
  };

  function weightGrams(value) {
    const text = String(value ?? '').trim();
    if (!/^\d+(\.\d{1,3})?$/.test(text)) throw new Error('請確認商品重量，公斤最多三位小數。');
    const [whole, part = ''] = text.split('.');
    return safe(Number(whole + part.padEnd(3, '0')));
  }

  function freightQuote(items, pricePerKgMinor) {
    const actual = items.reduce((sum, item) => safe(sum + weightGrams(item.weightKg)), 0);
    if (!items.length || actual === 0) throw new Error('請確認本批回貨商品及實際重量。');
    const halfKilos = Math.max(10, Math.floor((actual - 1) / 500) + 1);
    const billing = safe(halfKilos * 500);
    const price = BigInt(safe(pricePerKgMinor));
    return { actual, billing, quoteMinor: safe(Number((BigInt(halfKilos) * price + 1n) / 2n)) };
  }

  function freightAllocations(items, totalMinor) {
    const amount = BigInt(safe(totalMinor));
    const weight = items.reduce((sum, item) => sum + BigInt(weightGrams(item.weightKg)), 0n);
    if (weight === 0n) throw new Error('請確認本批回貨商品及實際重量。');
    if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('同一品項只能分攤一次。');
    let left = amount;
    const lines = items.map(item => {
      const grams = BigInt(weightGrams(item.weightKg));
      const numerator = amount * grams;
      const minor = numerator / weight;
      left -= minor;
      return { itemId: item.id, grams: Number(grams), minor, remainder: numerator % weight };
    });
    const sorted = [...lines].sort((a, b) => a.remainder === b.remainder
      ? (a.itemId < b.itemId ? -1 : 1) : a.remainder > b.remainder ? -1 : 1);
    for (let i = 0; left > 0n; i++, left--) sorted[i].minor++;
    return lines.map(line => ({ itemId: line.itemId, grams: line.grams, amountMinor: Number(line.minor) }));
  }

  const api = { weightGrams, freightQuote, freightAllocations };
  if (typeof module === 'object') module.exports = api;
  else root.MissAnFreight = api;
})(globalThis);
