export const fhaUpfrontRate = 1.75;
const vaFeeTiers = [
  { minimum: 0, first: 2.15, subsequent: 3.30, exempt: 0 },
  { minimum: 5, first: 1.50, subsequent: 1.50, exempt: 0 },
  { minimum: 10, first: 1.25, subsequent: 1.25, exempt: 0 },
];

export function purchaseFinancing({ base, downPercent, program, vaUse }) {
  const tier = vaFeeTiers.findLast(({ minimum }) => downPercent >= minimum);
  const feeRate = program === 'fha' ? fhaUpfrontRate : program === 'va' ? tier[vaUse] : 0;
  const fha = program === 'fha';
  const baseCents = fha ? Math.floor(base) * 100 : Math.round(base * 100);
  const fee = baseCents * Math.round(feeRate * 100) / 10000;
  // FHA mortgages are financed to whole dollars.
  const feeCents = fha ? Math.floor(fee / 100) * 100 : Math.round(fee);
  return { baseLoanAmount: baseCents / 100, loanAmount: (baseCents + feeCents) / 100, feeCents, feeRate };
}

export function estimateIpcLimit({ program, occupancy, purchasePrice, downPercent }) {
  let percent;
  if (program === 'va') percent = 4;
  else if (program === 'fha') percent = 6;
  else if (occupancy === 'investment') percent = 2;
  else if (downPercent >= 25) percent = 9;
  else if (downPercent >= 10) percent = 6;
  else percent = 3;

  // The calculator uses the purchase price as its value estimate.
  const cents = Math.floor(Math.round(purchasePrice * 100) * percent / 100);
  return { percent, cents };
}
