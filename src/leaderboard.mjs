export const validName = name => typeof name === 'string' && /^[A-Za-z0-9_]{3,12}$/.test(name);
export const validEntry = item => item && validName(item.name) && Number.isSafeInteger(item.score) && item.score >= 0 &&
  Number.isInteger(item.nights_won) && item.nights_won >= 0 && item.nights_won <= 3 &&
  Number.isSafeInteger(item.seed) && typeof item.achieved_at === 'string' &&
  /(?:Z|[+-]\d\d:\d\d)$/.test(item.achieved_at) && Number.isFinite(Date.parse(item.achieved_at));

export function topEntries(entries) {
  return entries.filter(validEntry).sort((a, b) => b.score - a.score || Date.parse(a.achieved_at) - Date.parse(b.achieved_at)).slice(0, 10);
}
