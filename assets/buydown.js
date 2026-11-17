import { payment } from './mortgage.js';

export function baseLoanAmount({ loanAmount, price, downPayment, unit }) {
  const amount = price === undefined
    ? loanAmount
    : price - (unit === 'percent' ? price * downPayment / 100 : downPayment);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : 0;
}

export function estimateBuydown({ amount, months, rate, periods }) {
  const duration = periods.reduce((sum, period) => sum + period.months, 0);
  if (months <= duration) return { rate, error: 'The loan term must extend beyond the buydown.' };
  if (rate < 0 || periods.some(period => rate < period.reduction)) {
    return { rate, error: 'This schedule would imply a negative rate.' };
  }

  // Provisional rounding: round each monthly P&I payment to cents before
  // subtracting and use integer cents through the funding calculation.
  const fullPayment = Math.round(payment(amount, rate, months) * 100);
  let elapsed = 0;
  const rows = periods.map(period => {
    const buyer = Math.round(payment(amount, rate - period.reduction, months) * 100);
    const row = { start: elapsed + 1, months: period.months, buyer, subsidy: fullPayment - buyer };
    elapsed += period.months;
    return row;
  });
  const cost = rows.reduce((sum, row) => sum + row.subsidy * row.months, 0);
  rows.push({ start: elapsed + 1, months: months - elapsed, buyer: fullPayment, subsidy: 0 });
  return { rate, cost, fullPayment, rows };
}

export function compareBuydown({ amount, months, noteRate, periods }) {
  return [-0.25, 0, 0.25].map(offset =>
    estimateBuydown({ amount, months, rate: Number((noteRate + offset).toFixed(3)), periods }));
}
