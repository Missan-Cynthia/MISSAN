'use strict';

function positive(value, message, minimum = 1) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(message);
  return value;
}

function replayWallet(topups, payments) {
  const seen = new Set();
  for (const event of [...topups, ...payments]) {
    if (!event.id || seen.has(event.id)) throw new Error('帳務交易 ID 重複或缺漏。');
    seen.add(event.id);
    if (!Number.isFinite(Date.parse(event.at))) throw new Error('帳務交易日期無效。');
  }
  const events = [...topups.map(entry => ({ ...entry, kind: 0 })),
    ...payments.map(entry => ({ ...entry, kind: 1 }))]
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.kind - b.kind || (a.id < b.id ? -1 : 1));
  const batches = [];
  const transactions = [];
  let first = 0;
  let balance = 0;
  for (const event of events) {
    const amount = positive(event.cnyMinor, '人民幣交易金額無效。', event.kind === 0 ? 1 : 0);
    if (event.kind === 0) {
      const principal = positive(event.twdPrincipalMinor, '儲值本金無效。', 0);
      const fee = event.twdFeeMinor == null ? null : positive(event.twdFeeMinor, '儲值費用無效。', 0);
      const cost = positive(principal + (fee ?? 0), '儲值成本超出可記錄範圍。', 0);
      balance = positive(balance + amount, '帳戶餘額超出可記錄範圍。', 0);
      batches.push({ id: event.id, cnyMinor: amount, remaining: amount, twdCostMinor: cost,
        twdRemainingMinor: cost, feeConfirmed: fee !== null });
      continue;
    }
    if (amount > balance) {
      throw new Error('歷史人民幣餘額不足：' + event.id + '（' + event.at + '）。');
    }
    let needed = amount;
    let cost = 0;
    const allocations = [];
    while (needed > 0) {
      const batch = batches[first];
      const amountUsed = Math.min(needed, batch.remaining);
      const spent = batch.cnyMinor - batch.remaining + amountUsed;
      // Cumulative proportional rounding preserves the full cost of each batch.
      const denominator = BigInt(batch.cnyMinor);
      const costUsed = Number((BigInt(batch.twdCostMinor) * BigInt(spent) + denominator / 2n) / denominator);
      const remainingCost = batch.twdCostMinor - costUsed;
      const allocationCost = batch.twdRemainingMinor - remainingCost;
      batch.twdRemainingMinor = remainingCost;
      batch.remaining -= amountUsed;
      if (batch.remaining === 0) first++;
      needed -= amountUsed;
      cost = positive(cost + allocationCost, '訂單成本超出可記錄範圍。', 0);
      allocations.push({ batchId: batch.id, cnyMinor: amountUsed, twdMinor: allocationCost });
    }
    balance -= amount;
    transactions.push({ id: event.id, at: event.at, cnyMinor: amount, twdMinor: cost, allocations });
  }
  return { balance, batches, transactions };
}

module.exports = { replayWallet };
