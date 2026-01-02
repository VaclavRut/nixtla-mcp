export function getCurrentMonthKey(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function parseMonthKey(monthKey?: string): string {
  if (!monthKey) {
    return getCurrentMonthKey();
  }
  if (!/^\d{4}-\d{2}$/.test(monthKey)) {
    throw new Error('Invalid month format. Expected YYYY-MM');
  }
  return monthKey;
}

export function getISOTimestamp(): string {
  return new Date().toISOString();
}
