import { normalize } from './song-catalog-model.js';

const japanese = new Intl.Collator('ja', { sensitivity: 'variant' });
const latin = new Intl.Collator('en', { sensitivity: 'base' });

export function normalizeCreatorName(value) {
  return normalize(value).replace(/[ァ-ヶヽヾ]/g, char => String.fromCharCode(char.charCodeAt(0) - 0x60));
}

function group(name) {
  if (/^[\p{Script=Latin}]/u.test(name)) return 1;
  if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(name)) return 0;
  return 2;
}

export function compareCreatorNames(a, b) {
  const left = normalizeCreatorName(a.creator_name);
  const right = normalizeCreatorName(b.creator_name);
  const type = group(left);
  const other = group(right);
  if (type !== other) return type - other;
  const kanaA = normalizeCreatorName(a.name_kana ?? '');
  const kanaB = normalizeCreatorName(b.name_kana ?? '');
  const primary = type === 0
    ? Number(!kanaA) - Number(!kanaB) || japanese.compare(kanaA, kanaB)
    : type === 1 ? latin.compare(left, right) : 0;
  return primary || japanese.compare(left, right) || a.creator_id.localeCompare(b.creator_id, 'en');
}

export function searchCreators(entries, query) {
  const term = normalizeCreatorName(query);
  return entries.filter(entry => [entry.creator_name, entry.name_kana ?? '']
    .some(value => normalizeCreatorName(value).includes(term))).sort(compareCreatorNames);
}

export function creatorReadings(rankings) {
  return new Map((rankings?.categories.all.entries ?? []).map(row => [row.creator_id, row.name_kana]));
}

export function creatorName(creator_id, creator_name, readings) {
  return { creator_id, creator_name, name_kana: readings?.get(creator_id) };
}
