import { isCanonicalDate } from './canonical-validator.js';
import { CANONICAL_SCHEMA, ID_PATTERNS } from './canonical-schema.js';

const ascii = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export function validateSongCatalog(data) {
  const check = (condition, path) => { if (!condition) throw new Error(`Song JSON contract: ${path}`); };
  const object = (value, keys, path) => check(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(','), path);
  const string = (value, path) => check(typeof value === 'string' && value.trim().length > 0, path);
  const id = (value, table, path) => check(typeof value === 'string' && ID_PATTERNS[table].test(value), path);
  const date = (value, path) => check(value === null || isCanonicalDate(value), path);
  const ordered = (values, compare, path) => check(values.every((v, i) => i === 0 || compare(values[i - 1], v) < 0), path);
  object(data, ['schema_version', 'artist', 'works'], 'root keys');
  check(data.schema_version === 1, 'schema_version');
  object(data.artist, ['artist_id', 'name'], 'artist');
  id(data.artist.artist_id, 'artists', 'artist.artist_id'); string(data.artist.name, 'artist.name');
  check(Array.isArray(data.works), 'works');
  const songIds = new Set();
  for (const [i, w] of data.works.entries()) {
    const p = `works[${i}]`;
    object(w, ['work_id', 'title', 'title_kana', 'first_release_date', 'date_incomplete', 'search_creator_names', 'songs'], p);
    id(w.work_id, 'works', p + '.work_id'); string(w.title, p + '.title');
    check(w.title_kana === null || typeof w.title_kana === 'string', p + '.title_kana');
    date(w.first_release_date, p + '.first_release_date'); check(typeof w.date_incomplete === 'boolean', p + '.date_incomplete');
    check(Array.isArray(w.search_creator_names), p + '.search_creator_names');
    w.search_creator_names.forEach(n => string(n, p + '.search_creator_names[]'));
    ordered(w.search_creator_names, ascii, p + '.search_creator_names order/duplicate');
    check(Array.isArray(w.songs) && w.songs.length > 0, p + '.songs');
    for (const [j, s] of w.songs.entries()) {
      const q = `${p}.songs[${j}]`;
      object(s, ['song_id', 'title', 'version_name', 'version_type', 'release_date', 'credits'], q);
      id(s.song_id, 'songs', q + '.song_id'); check(!songIds.has(s.song_id), q + '.duplicate song_id'); songIds.add(s.song_id);
      string(s.title, q + '.title'); check(s.version_name === null || typeof s.version_name === 'string', q + '.version_name');
      check(CANONICAL_SCHEMA.songs.columns.find(c => c.name === 'version_type').values.includes(s.version_type), q + '.version_type');
      date(s.release_date, q + '.release_date'); check(Array.isArray(s.credits), q + '.credits');
      const keys = new Set(), orders = new Set();
      for (const [k, c] of s.credits.entries()) {
        const t = `${q}.credits[${k}]`;
        object(c, ['creator_id', 'creator_name', 'credit_name', 'role', 'credit_order'], t);
        id(c.creator_id, 'creators', t + '.creator_id'); string(c.creator_name, t + '.creator_name'); string(c.credit_name, t + '.credit_name');
        check(CANONICAL_SCHEMA.song_creators.columns.find(c => c.name === 'role').values.includes(c.role), t + '.role');
        check(c.credit_order === null || (Number.isSafeInteger(c.credit_order) && c.credit_order > 0), t + '.credit_order');
        const key = `${c.creator_id}/${c.role}`, order = `${c.role}/${c.credit_order}`;
        check(!keys.has(key), t + '.duplicate credit'); keys.add(key);
        if (c.credit_order !== null) { check(!orders.has(order), t + '.duplicate order'); orders.add(order); }
      }
      ordered(s.credits, (a,b) => ascii(a.role,b.role) || (a.credit_order ?? Infinity) - (b.credit_order ?? Infinity) || ascii(a.creator_id,b.creator_id), q + '.credits order');
    }
    ordered(w.songs, (a,b) => ascii(a.release_date ?? '9999-99-99',b.release_date ?? '9999-99-99') || ascii(a.song_id,b.song_id), p + '.songs order');
    check(w.first_release_date === (w.songs.find(s => s.release_date !== null)?.release_date ?? null), p + '.first_release_date derivation');
    check(w.date_incomplete === w.songs.some(s => s.release_date === null), p + '.date_incomplete derivation');
    const names = [...new Set(w.songs.flatMap(s => s.credits.flatMap(c => [c.credit_name,c.creator_name])))].sort(ascii);
    check(JSON.stringify(names) === JSON.stringify(w.search_creator_names), p + '.search_creator_names derivation');
  }
  ordered(data.works, (a,b) => ascii(a.work_id,b.work_id), 'works order/duplicate');
  return data;
}
