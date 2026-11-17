import { formatAmount, parseAmount } from './amounts.js';
import { baseLoanAmount, compareBuydown, estimateBuydown } from './buydown.js';
import { describeSchedule, schedules } from './buydown-schedules.js';
import { defaultBuydownRate, defaultConventionalPmi, estimateIpcLimit, purchaseFinancing } from './buydown-programs.js?v=4';
import { estimateFhaMip, fhaMipTerms } from './program-fees.js';

const byId = id => document.getElementById(id);
const form = byId('inputs');
const schedule = byId('schedule');
const paymentPlot = byId('payment-plot');
const paymentColumns = byId('payment-columns');
const breakdown = byId('payment-breakdown');
let openSlice;
let pinnedSlice;
const down = byId('down');
const downPercent = byId('down-percent');
const miRate = byId('mi-rate');
let manualPmiRate;
const buttons = [...document.querySelectorAll('[data-scenario]')];
const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const money = cents => currency.format(cents / 100);
const rateLabel = value => `${value.toFixed(3).replace(/0$/, '')}%`;
const rateInputFormat = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 1, maximumFractionDigits: 3, useGrouping: false,
});
const validRateText = /^\d*(?:\.\d{1,3})?$/;
const marketRateEndpoint = 'https://trupathhomeloans.com/wp-json/trupath-debt/v1/mnd';
const marketRateKeys = { conventional: 'fixed30', fha: 'fha30', va: 'va30' };
let marketRates;
let rateWasEdited = false;
const dollars = id => parseAmount(byId(id).value);
let preview = 1;
let retainedPercent = Number(downPercent.value);
const defaultSchedule = Math.max(0, schedules.findIndex(({ label }) => label === '2-1'));

schedules.forEach(({ label }, index) => schedule.add(new Option(label, index)));
schedule.value = defaultSchedule;

function readPercent() {
  const raw = downPercent.value.trim();
  return /^\d*(?:\.\d+)?$/.test(raw) && Number(raw) < 100 ? Number(raw) : null;
}

function syncPurchaseInputs(target) {
  const price = byId('price');
  const priceRange = byId('price-range');
  const downRange = byId('down-range');
  if (target === priceRange) price.value = formatAmount(Number(priceRange.value));
  if (target === downRange) downPercent.value = downRange.value;

  const purchase = dollars('price');
  if (purchase > 0) priceRange.value = purchase;
  if (target === down) {
    if (!(purchase > 0)) return;
    const amount = dollars('down');
    retainedPercent = amount === null ? null : amount * 100 / purchase;
    downPercent.value = retainedPercent === null ? '' : Number(retainedPercent.toFixed(6));
  } else if (target === downPercent || target === downRange) {
    retainedPercent = readPercent();
  }
  if (target !== down && purchase > 0 && retainedPercent !== null && retainedPercent < 100) {
    down.value = formatAmount(purchase * retainedPercent / 100);
  }
  if (retainedPercent !== null) downRange.value = retainedPercent;
}

function loanInputs() {
  const program = form.elements.program.value;
  const vaUse = byId('va-use').value;
  const price = dollars('price');
  const deposit = dollars('down');
  const validDeposit = price > 0 && deposit !== null && deposit < price && retainedPercent !== null && retainedPercent < 100;
  const percent = validDeposit ? deposit * 100 / price : 0;
  const base = validDeposit ? baseLoanAmount({ price, downPayment: deposit, unit: 'dollars' }) : 0;
  const financing = purchaseFinancing({ base, downPercent: percent, program, vaUse });
  const amount = financing.loanAmount;
  const ltv = validDeposit ? 100 - percent : NaN;
  const rate = byId('rate');
  if (!rateWasEdited && validDeposit) {
    const suggestedRate = defaultBuydownRate({
      program, ltv, benchmark: currentMarketRate(program),
    });
    rate.value = rateInputFormat.format(suggestedRate);
    byId('rate-range').value = suggestedRate;
  }
  const rawRate = rate.value.trim();
  const noteRate = validRateText.test(rawRate) && rawRate !== '' ? Number(rawRate) : NaN;
  const rawTerm = byId('term').value.trim();
  const term = /^\d+$/.test(rawTerm) ? Number(rawTerm) : 0;
  const months = term * 12;
  const { periods } = schedules[Number(schedule.value)];
  byId('schedule-help').textContent = describeSchedule(periods);
  byId('va-settings').hidden = program !== 'va';
  byId('financing').hidden = program === 'conventional';
  byId('fee-label').textContent = program === 'fha' ? `Financed FHA upfront MIP (${rateLabel(financing.feeRate)})`
    : program === 'va' && vaUse === 'exempt' ? 'VA funding fee (exempt)'
    : `Financed VA funding fee (${rateLabel(financing.feeRate)})`;
  byId('fee-amount').textContent = amount ? money(financing.feeCents) : '—';
  byId('financed-total').textContent = amount ? money(amount * 100) : '—';
  let error = '';
  if (!amount) error = 'Enter a purchase price and a down payment below the purchase price.';
  else if (!rawRate) error = 'Enter an interest rate to see your estimate.';
  else if (!(noteRate >= 0 && noteRate <= 40)) error = 'Enter an interest rate from 0% to 40% with up to three decimal places.';
  else if (months < 12 || months > 600) error = 'Enter a whole loan term from 1 to 50 years.';
  return { amount, noteRate, months, periods, error, price, program, percent, ltv, term, financing };
}

function housingCosts(inputs, scenario) {
  const fha = inputs.program === 'fha';
  const applicable = fha || (inputs.program === 'conventional' && inputs.ltv > 80 + 1e-9);
  const miName = fha ? 'FHA mortgage insurance' : 'PMI';
  byId('mi-settings').hidden = !applicable;
  byId('include-mi-label').textContent = `Include ${miName}`;
  byId('mi-rate-label').textContent = fha ? 'Annual FHA MIP rate' : 'Annual PMI rate';
  miRate.disabled = fha;
  const fhaTerms = fha && inputs.price > 0 && inputs.amount > 0
    ? fhaMipTerms(inputs.financing.baseLoanAmount, inputs.financing.baseLoanAmount / inputs.price, inputs.term)
    : null;
  const annualMiRate = fha ? fhaTerms?.annualRate : manualPmiRate ?? defaultConventionalPmi(inputs.ltv);
  const scenarioRate = scenario?.rows ? scenario.rate : inputs.noteRate;
  const effectiveUpfrontRate = inputs.financing.baseLoanAmount > 0
    ? inputs.financing.feeCents / inputs.financing.baseLoanAmount : 0;
  const monthlyMi = fha
    ? estimateFhaMip(inputs.financing, inputs.price, inputs.term, scenarioRate, effectiveUpfrontRate).monthly
    : inputs.amount * annualMiRate / 1200;
  miRate.value = annualMiRate ?? 0;
  miRate.setAttribute('aria-valuetext', annualMiRate === undefined ? 'Unavailable' : rateLabel(annualMiRate));
  byId('mi-rate-value').value = annualMiRate === undefined ? '—' : rateLabel(annualMiRate);
  byId('mi-estimate').textContent = Number.isFinite(monthlyMi)
    ? `${money(Math.round(monthlyMi * 100))}/month estimated${fha ? ' using the first-year premium across the schedule' : ''}.`
    : 'Enter the loan details to estimate mortgage insurance.';

  const missing = [];
  const invalid = [];
  const charges = [];
  if (byId('include-escrow').checked) {
    for (const [id, label] of [['taxes', 'property taxes'], ['insurance', 'homeowners insurance']]) {
      const value = dollars(id);
      if (!byId(id).value.trim()) missing.push(label);
      else if (value === null) invalid.push(label);
      else charges.push({ key: id, label, cents: Math.round(value * 100 / 12) });
    }
  }
  if (applicable && byId('include-mi').checked) {
    if (!Number.isFinite(monthlyMi)) missing.push(miName);
    else charges.push({ key: 'mi', label: miName, cents: Math.round(monthlyMi * 100) });
  }
  const messages = [];
  if (missing.length) messages.push(`Missing ${missing.join(', ')}.`);
  if (invalid.length) messages.push(`Check the amount for ${invalid.join(', ')}.`);
  byId('housing-cost-status').textContent = messages.join(' ');
  byId('housing-cost-status').hidden = messages.length === 0;
  return charges;
}

function periodLabel(row) {
  const end = row.start + row.months - 1;
  if (row.months === 1) return `Month ${row.start}`;
  return `Months ${row.start}–${end}`;
}

function closeBreakdown() {
  openSlice?.setAttribute('aria-expanded', 'false');
  openSlice = undefined;
  pinnedSlice = undefined;
  breakdown.hidden = true;
}

function showBreakdown(slice, period, lines, activeKey) {
  if (openSlice === slice) return;
  openSlice?.setAttribute('aria-expanded', 'false');
  openSlice = slice;
  slice.setAttribute('aria-expanded', 'true');
  byId('breakdown-period').textContent = period;
  byId('breakdown-lines').replaceChildren(...lines.map(({ key, label, cents }) => {
    const line = document.createElement('div');
    if (key) line.classList.add(`payment-${key}`, 'breakdown-component');
    line.classList.toggle('breakdown-selected', key === activeKey);
    line.classList.toggle('breakdown-total', !key);
    const name = document.createElement('dt');
    name.textContent = label;
    const value = document.createElement('dd');
    value.textContent = money(cents);
    line.append(name, value);
    return line;
  }));
  breakdown.hidden = false;
  const plotRect = paymentPlot.getBoundingClientRect();
  const sliceRect = slice.getBoundingClientRect();
  const width = breakdown.offsetWidth;
  const center = sliceRect.left - plotRect.left + sliceRect.width / 2;
  breakdown.style.left = `${Math.max(0, Math.min(center - width / 2, plotRect.width - width))}px`;
  breakdown.classList.toggle('breakdown-below', plotRect.top < breakdown.offsetHeight + 4);
}

function renderPaymentChart(scenario, charges, extras) {
  const abbreviations = { principal: 'P&I', taxes: 'Tax', insurance: 'Ins', subsidy: 'Subsidy' };
  const components = [
    { key: 'principal', label: 'Buyer principal & interest' },
    ...charges.filter(({ cents }) => cents > 0),
    { key: 'subsidy', label: 'Seller subsidy' },
  ];
  byId('payment-key').replaceChildren(...components.map(({ key, label }) => {
    const item = document.createElement('abbr');
    item.className = `payment-${key}`;
    item.title = label;
    item.textContent = key === 'mi' ? (label === 'PMI' ? 'PMI' : 'MIP') : abbreviations[key];
    return item;
  }));


  paymentColumns.replaceChildren(...scenario.rows.map(row => {
    const column = byId('payment-column-template').content.firstElementChild.cloneNode(true);
    const period = periodLabel(row);
    const buyerTotal = row.buyer + extras;
    const pieces = [
      { key: 'principal', label: 'Buyer P&I', cents: row.buyer },
      ...charges,
      { key: 'subsidy', label: 'Seller subsidy', cents: row.subsidy },
    ];
    const lines = [...pieces, { label: 'Buyer pays', cents: buyerTotal }];
    const slices = pieces.filter(({ cents }) => cents > 0).map(({ key, label, cents }) => {
      const slice = document.createElement('button');
      slice.type = 'button';
      slice.className = `payment-slice payment-${key}`;
      slice.style.flexGrow = cents;
      slice.setAttribute('aria-label', `${period}, ${label}, ${money(cents)} per month`);
      slice.setAttribute('aria-controls', 'payment-breakdown');
      slice.setAttribute('aria-expanded', 'false');

      const show = () => showBreakdown(slice, period, lines, key);
      slice.addEventListener('pointerenter', event => {
        if (event.pointerType === 'touch') return;
        if (pinnedSlice !== slice) pinnedSlice = undefined;
        show();
      });
      slice.addEventListener('focus', show);
      slice.addEventListener('click', () => {
        if (pinnedSlice === slice) closeBreakdown();
        else {
          pinnedSlice = slice;
          show();
        }
      });
      return slice;
    });
    column.querySelector('.payment-stack').replaceChildren(...slices);
    column.querySelector('.payment-period').textContent = period;
    column.querySelector('.payment-amount').textContent = money(buyerTotal);
    return column;
  }));
}

function renderPayments(scenario, noteRate, charges) {
  closeBreakdown();
  const ready = scenario?.rows !== undefined;
  const paymentNote = byId('payment-note');
  const exclusions = [
    ['taxes', 'property taxes'],
    ['insurance', 'homeowners insurance'],
    ['mi', 'PMI'],
  ].filter(([key]) => !charges.some(charge => charge.key === key)).map(([, label]) => label);
  const excludedCosts = new Intl.ListFormat('en-US', { type: 'disjunction' }).format(exclusions);
  paymentNote.hidden = !ready || !exclusions.length;
  paymentNote.textContent = exclusions.length ? `Payments exclude ${excludedCosts}.` : '';
  byId('empty-payment').hidden = ready;
  byId('payment-results').hidden = !ready;
  byId('payment-rate').hidden = !ready;
  if (!ready) return;

  byId('payment-rate').textContent = preview === 1
    ? `${rateLabel(noteRate)} interest rate`
    : `${rateLabel(scenario.rate)} preview`;
  const extras = charges.reduce((sum, charge) => sum + charge.cents, 0);
  renderPaymentChart(scenario, charges, extras);

  const rows = scenario.rows.map((row, index) => {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.scope = 'row';
    const final = index === scenario.rows.length - 1;
    th.textContent = final ? 'After buydown' : periodLabel(row);
    if (final) {
      const months = document.createElement('small');
      months.textContent = periodLabel(row);
      th.append(months);
    }
    tr.append(th);
    tr.insertCell().textContent = money(row.buyer + extras);
    tr.insertCell().textContent = money(row.subsidy);
    return tr;
  });
  byId('payments').replaceChildren(...rows);
}

function renderTypeComparison({ amount, months }, scenario) {
  byId('type-comparison').hidden = !scenario;
  if (!scenario) return;
  const { rate } = scenario;
  byId('type-rate').textContent = `At ${rateLabel(rate)} interest`;
  const rows = schedules.map(({ label, periods }, index) => {
    const { cost, error } = estimateBuydown({ amount, months, rate, periods });
    const row = document.createElement('tr');
    const heading = document.createElement('th');
    heading.scope = 'row';
    const selected = index === Number(schedule.value);
    heading.textContent = selected ? `${label} (selected)` : label;
    row.classList.toggle('selected-type', selected);
    row.append(heading);
    row.insertCell().textContent = error ? 'Unavailable' : money(cost);
    return row;
  });
  byId('type-costs').replaceChildren(...rows);
}

function renderIpc({ program, price, percent: downPercent }, scenario) {
  const conventional = program === 'conventional';
  const va = program === 'va';
  const propertyUse = byId('ipc-occupancy');
  const occupancy = propertyUse.value;
  const limit = estimateIpcLimit({ program, occupancy, purchasePrice: price, downPercent });
  byId('ipc-property').hidden = !conventional;

  let tier;
  if (conventional) {
    const downPaymentTiers = { 2: 'Any down payment', 3: '<10% down', 6: '10–24.99% down', 9: '25%+ down' };
    tier = `Conventional · ${propertyUse.selectedOptions[0].textContent} · ${downPaymentTiers[limit.percent]}`;
  } else {
    tier = va ? 'VA · Purchase price as VA value · Normal closing costs separate' : 'FHA · Sales price';
  }
  byId('ipc-tier').textContent = tier;
  byId('ipc-limit').textContent = `${limit.percent}% limit = ${money(limit.cents)}`;

  const over = scenario?.cost > limit.cents;
  const warning = byId('ipc-warning');
  warning.hidden = !over;
  warning.textContent = over
    ? `Buydown exceeds the ${limit.percent}% seller credit limit by ${money(scenario.cost - limit.cents)}.`
    : '';
  return limit;
}

function renderSellerCredit(price, scenario, limit) {
  const entered = byId('seller-credit').value.trim();
  const credit = entered ? dollars('seller-credit') : null;
  const share = byId('seller-credit-share');
  share.hidden = !entered;
  if (credit === null) {
    share.textContent = entered ? 'Enter a valid seller credit amount.' : '';
  } else if (price > 0) {
    share.textContent = `${formatAmount(credit / price * 100)}% of the sales price`;
  } else {
    share.textContent = 'Enter a purchase price to see the percentage.';
  }

  const creditCents = credit === null ? null : Math.round(credit * 100);
  const warning = byId('seller-credit-warning');
  const excess = price > 0 && creditCents !== null ? creditCents - limit.cents : 0;
  warning.hidden = excess <= 0;
  warning.textContent = excess > 0
    ? `Entered seller credit exceeds the ${limit.percent}% limit by ${money(excess)}.`
    : '';

  const balance = byId('credit-balance');
  balance.hidden = creditCents === null || scenario?.cost === undefined;
  if (balance.hidden) return;
  const difference = creditCents - scenario.cost;
  byId('credit-balance-label').textContent = difference < 0
    ? 'Additional seller credit needed'
    : 'Seller credit left after buydown';
  byId('credit-balance-amount').textContent = money(Math.abs(difference));
}

function currentMarketRate(program) {
  if (marketRates?.version !== 1 || marketRates.fallback !== false) return undefined;
  const average = marketRates.rates?.[marketRateKeys[program]];
  const observation = Date.parse(`${average?.observationDate}T00:00:00Z`);
  const checked = Date.parse(marketRates.checkedAt);
  const now = Date.now();
  const current = Number.isFinite(average?.rate) && average.rate > 0 && average.rate <= 30 &&
    checked <= now && now - checked <= 2 * 86400000 &&
    observation <= now && now - observation <= 7 * 86400000;
  return current ? average.rate : undefined;
}

async function loadMarketRates() {
  try {
    const response = await fetch(marketRateEndpoint, {
      credentials: 'omit',
      signal: AbortSignal.timeout(8000),
    });
    if (response.ok) marketRates = await response.json();
  } catch {
    // Keep the editable example rate if the endpoint is unavailable.
  }
  render();
}

function render() {
  const inputs = loanInputs();
  const scenarios = inputs.error ? [] : compareBuydown(inputs);
  buttons.forEach((button, index) => {
    const scenario = scenarios[index];
    button.disabled = !scenario || Boolean(scenario.error);
    button.setAttribute('aria-pressed', String(index === preview));
    button.querySelector('strong').textContent = scenario ? rateLabel(scenario.rate) : '—';
    button.querySelector('small').textContent = scenario
      ? scenario.error ? 'Unavailable' : money(scenario.cost)
      : '—';
  });

  const scenario = scenarios[preview];
  byId('cost').textContent = scenario?.cost === undefined ? '—' : money(scenario.cost);
  byId('cost-note').textContent = inputs.error || scenario?.error ||
    `Seller credit needed for the ${schedules[schedule.value].label} temporary buydown at ${rateLabel(scenario.rate)}`;
  const limit = renderIpc(inputs, scenario);
  renderSellerCredit(inputs.price, scenario, limit);
  renderTypeComparison(inputs, scenario);
  renderPayments(scenario, inputs.noteRate, housingCosts(inputs, scenario));
}

for (const id of ['rate', 'term']) {
  const field = byId(id);
  const slider = byId(`${id}-range`);
  slider.addEventListener('input', () => {
    field.value = id === 'rate' ? rateInputFormat.format(Number(slider.value)) : slider.value;
  });
  field.addEventListener('input', () => {
    if (field.value.trim() && Number.isFinite(Number(field.value))) slider.value = field.value;
  });
}

form.addEventListener('input', ({ target }) => {
  if (target.id === 'rate' || target.id === 'rate-range') rateWasEdited = true;
  if (target === miRate) manualPmiRate = Number(miRate.value);
  if (['price', 'price-range', 'down', 'down-percent', 'down-range'].includes(target.id)) {
    syncPurchaseInputs(target);
  }
  render();
});
form.addEventListener('submit', event => event.preventDefault());
form.addEventListener('focusout', ({ target }) => {
  if (target.id === 'rate') {
    const rate = target.value.trim();
    if (rate && validRateText.test(rate)) target.value = rateInputFormat.format(Number(rate));
  }
  if (target.matches('[data-money]') && target.value.trim()) {
    const value = parseAmount(target.value);
    if (value !== null) target.value = formatAmount(value);
  }
});
buttons.forEach((button, index) => button.addEventListener('click', () => {
  preview = index;
  render();
}));
byId('ipc-occupancy').addEventListener('change', render);
paymentPlot.addEventListener('pointerleave', event => {
  if (event.pointerType === 'touch') return;
  if (pinnedSlice !== openSlice && document.activeElement !== openSlice) closeBreakdown();
});
paymentPlot.addEventListener('pointerover', event => {
  if (event.pointerType !== 'touch' && openSlice && !pinnedSlice &&
      !event.target.closest('.payment-slice, #payment-breakdown') && document.activeElement !== openSlice) {
    closeBreakdown();
  }
});
paymentPlot.addEventListener('focusout', event => {
  if (!paymentPlot.contains(event.relatedTarget)) closeBreakdown();
});
document.addEventListener('pointerdown', event => {
  if (openSlice && !paymentPlot.contains(event.target)) closeBreakdown();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && openSlice) closeBreakdown();
});
render();
loadMarketRates();
