// TruPath can add presets here. Each period starts after the preceding period.
// Reductions are percentage points and durations are whole months.
export const schedules = [
  { label: '1-0', periods: [{ months: 12, reduction: 1 }] },
  { label: '1-1', periods: [{ months: 24, reduction: 1 }] },
  { label: '1.5-0.5', periods: [{ months: 12, reduction: 1.5 }, { months: 12, reduction: 0.5 }] },
  { label: '2-1', periods: [{ months: 12, reduction: 2 }, { months: 12, reduction: 1 }] },
  { label: '3-2-1', periods: [{ months: 12, reduction: 3 }, { months: 12, reduction: 2 }, { months: 12, reduction: 1 }] },
];

export function describeSchedule(periods) {
  const ordinals = ['1st', '2nd', '3rd'];
  let elapsed = 0;
  return periods.map(({ months, reduction }, index) => {
    const start = elapsed + 1;
    elapsed += months;
    let duration;
    if (months === 12 && start <= 25 && (start - 1) % 12 === 0) {
      duration = `the ${ordinals[(start - 1) / 12]} year`;
    } else if (index === 0 && months % 12 === 0) {
      duration = `the first ${months / 12} years`;
    } else {
      duration = months === 1 ? `month ${start}` : `months ${start}–${elapsed}`;
    }
    return `${reduction}% less for ${duration}`;
  }).join(', then ') + '.';
}
