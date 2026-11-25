import { readValidatedCanonical } from './canonical-reader.js';
import { CANONICAL_SCHEMA } from './canonical-schema.js';
import { canonicalValueError } from './canonical-validator.js';
import { validateSongCatalog } from './song-catalog-contract.js';

export const SONG_TABLES = ['artists', 'works', 'songs', 'song_artists', 'creators', 'song_creators'];
const ascii = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const nullable = value => value === '' ? null : value;

// Whole-canonical validation precedes this legacy six-table projection.
export async function loadSongTables(root) {
  const { tables } = await readValidatedCanonical(root);
  return Object.fromEntries(SONG_TABLES.map(name => [name, tables[name]]));
}

export function validateSongTables(tables) {
  const fail = (name, index, row, column, message) => {
    const key = CANONICAL_SCHEMA[name].primaryKey.map(c => row?.[c]).join('/');
    throw new Error(`data/${name}.csv record ${index + 2} ID=${key} ${column}: ${message}`);
  };
  for (const name of SONG_TABLES) {
    const schema = CANONICAL_SCHEMA[name], rows = tables[name];
    if (!Array.isArray(rows)) throw new Error(`data/${name}.csv: missing table`);
    const seen = new Set(), orders = new Set();
    rows.forEach((row, i) => {
      for (const column of schema.columns) {
        const error = canonicalValueError(column, row?.[column.name]);
        if (error) fail(name, i, row, column.name, error);
        if (column.type === 'integer' && row[column.name] !== '' && !Number.isSafeInteger(Number(row[column.name]))) fail(name, i, row, column.name, 'integer cannot be represented safely in JSON');
      }
      const key = JSON.stringify(schema.primaryKey.map(c => row[c]));
      if (seen.has(key)) fail(name, i, row, schema.primaryKey.join(','), 'duplicate primary key');
      seen.add(key);
      if (row.credit_order) {
        // song_artists order is per song (formal data specification, D1).
        const scope = name === 'song_artists' ? [row.song_id] : [row.song_id, row.role];
        const key = JSON.stringify([...scope, Number(row.credit_order)]);
        if (orders.has(key)) fail(name, i, row, 'credit_order', 'duplicate order');
        orders.add(key);
      }
      if (schema.period) {
        const [start, end] = schema.period;
        if (row[start] && row[end] && row[start] > row[end]) fail(name, i, row, end, 'precedes start date');
      }
    });
  }
  for (const name of SONG_TABLES) {
    tables[name].forEach((row, i) => {
      for (const fk of CANONICAL_SCHEMA[name].foreignKeys) {
        if (!tables[fk.table].some(target => fk.columns.every((c, j) => row[c] === target[fk.targetColumns[j]]))) fail(name, i, row, fk.columns.join(','), `reference not found in ${fk.table}`);
      }
      if (name === 'songs' && !tables.song_artists.some(a => a.song_id === row.song_id && a.role === 'primary')) fail(name, i, row, 'song_id', 'primary artist missing');
    });
  }
}

export function generateSongCatalog(tables, artistId = 'G00001') {
  validateSongTables(tables);
  const artist = tables.artists.find(a => a.artist_id === artistId);
  if (!artist) throw new Error(`data/artists.csv artist_id=${artistId}: artist not found`);
  const target = new Set(tables.song_artists.filter(a => a.artist_id === artistId && a.role === 'primary').map(a => a.song_id));
  const creators = new Map(tables.creators.map(c => [c.creator_id, c]));
  const groups = new Map();
  for (const song of tables.songs.filter(s => target.has(s.song_id))) {
    const credits = tables.song_creators.filter(c => c.song_id === song.song_id).map(c => ({
      creator_id: c.creator_id, creator_name: creators.get(c.creator_id).name,
      credit_name: c.credit_name, role: c.role, credit_order: c.credit_order === '' ? null : Number(c.credit_order)
    })).sort((a, b) => ascii(a.role, b.role) || (a.credit_order ?? Infinity) - (b.credit_order ?? Infinity) || ascii(a.creator_id, b.creator_id));
    const songs = groups.get(song.work_id) ?? [];
    songs.push({ song_id: song.song_id, title: song.title, version_name: nullable(song.version_name), version_type: song.version_type, release_date: nullable(song.release_date), credits });
    groups.set(song.work_id, songs);
  }
  const works = [...groups].sort(([a], [b]) => ascii(a, b)).map(([id, songs]) => {
    songs.sort((a, b) => ascii(a.release_date ?? '9999-99-99', b.release_date ?? '9999-99-99') || ascii(a.song_id, b.song_id));
    const work = tables.works.find(w => w.work_id === id);
    return { work_id: id, title: work.title, title_kana: nullable(work.title_kana),
      first_release_date: songs.find(s => s.release_date !== null)?.release_date ?? null,
      date_incomplete: songs.some(s => s.release_date === null),
      search_creator_names: [...new Set(songs.flatMap(s => s.credits.flatMap(c => [c.credit_name, c.creator_name])))].sort(ascii), songs };
  });
  const result = { schema_version: 1, artist: { artist_id: artist.artist_id, name: artist.name }, works };
  validateSongCatalog(result);
  return result;
}
