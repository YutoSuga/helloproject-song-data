const versions = ['original', 'new_vocal', 're_recording', 'cover', 'other'];
const roles = ['lyrics', 'english_lyrics', 'composition', 'arrangement', 'brass_arrangement'];
const text = value => typeof value === 'string' && value.length > 0;
const optional = value => value === null || typeof value === 'string';
const date = value => value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value));
// Reader checks only the structure used by this screen. CSV/FK/derivation checks
// belong to FN-005; no canonical data is loaded by the browser.
export function readSongCatalog(data, artistId = 'G00001') {
  if (!data || data.schema_version !== 1 || data.artist?.artist_id !== artistId || !text(data.artist.name) || !Array.isArray(data.works) || !data.works.every(w =>
    w && text(w.work_id) && text(w.title) && date(w.first_release_date) &&
    Array.isArray(w.search_creator_names) && w.search_creator_names.every(text) && Array.isArray(w.songs) && w.songs.length > 0 && w.songs.every(s =>
      s && text(s.song_id) && text(s.title) && optional(s.version_name) && versions.includes(s.version_type) && date(s.release_date) && Array.isArray(s.credits) && s.credits.every(c =>
        c && text(c.creator_id) && text(c.creator_name) && text(c.credit_name) && roles.includes(c.role) && (c.credit_order === null || (Number.isSafeInteger(c.credit_order) && c.credit_order > 0)))))) {
    throw new Error('楽曲データの形式が正しくありません。');
  }
  if (new Set(data.works.map(w => w.work_id)).size !== data.works.length) throw new Error('作品IDが重複しています。');
  return data;
}
const normalize = value => value.normalize('NFKC').toLocaleLowerCase('ja').trim();
const ascii = (a,b) => a < b ? -1 : a > b ? 1 : 0;
const collator = new Intl.Collator('ja', { sensitivity: 'variant' });
export function selectWorks(works, query = '', sort = 'new') {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  return works.filter(w => {
    const fields = [w.title, ...w.search_creator_names].map(normalize);
    return terms.every(term => fields.some(field => field.includes(term)));
  }).sort((a,b) => {
    if (sort === 'title') return collator.compare(a.title.normalize('NFKC'),b.title.normalize('NFKC')) || ascii(a.work_id,b.work_id);
    if (a.first_release_date === null || b.first_release_date === null) return (a.first_release_date === null) - (b.first_release_date === null) || ascii(a.work_id,b.work_id);
    return (sort === 'old' ? 1 : -1) * ascii(a.first_release_date,b.first_release_date) || ascii(a.work_id,b.work_id);
  });
}

// Keep the published array intact; details always use chronological song order.
export function selectSongs(songs) {
  return [...songs].sort((a,b) =>
    ascii(a.release_date ?? '9999-99-99', b.release_date ?? '9999-99-99') || ascii(a.song_id,b.song_id));
}
