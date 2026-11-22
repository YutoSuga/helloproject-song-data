const isText = value => typeof value === 'string' && value.trim().length > 0;
const isArtistId = value => typeof value === 'string' && /^G[0-9]{5}$/.test(value);
const hasKeys = (value, keys) => value !== null && typeof value === 'object'
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

function isDate(value) {
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function todayInJapan() {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts();
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type).value).join('-');
}

export function readUpdates(updates, today = todayInJapan()) {
  if (!Array.isArray(updates)) throw new Error('updates.json: expected an array');
  for (const [index, entry] of updates.entries()) {
    if (!hasKeys(entry, ['date', 'description']) || !isDate(entry.date)
      || entry.date > today || !isText(entry.description)) {
      throw new Error(`updates.json: invalid entry at index ${index}`);
    }
  }
  // Stable sort keeps editorial order for entries with the same date.
  return [...updates].sort((a, b) => b.date.localeCompare(a.date));
}

export function readCoverage(coverage, master, today = todayInJapan()) {
  if (!hasKeys(coverage, ['artists']) || !Array.isArray(coverage.artists)) throw new Error('coverage.json: invalid structure');
  if (!Array.isArray(master)) throw new Error('artists.json: expected an array');
  const artistsById = new Map();
  for (const row of master) {
    if (!hasKeys(row, ['artist_id', 'name', 'registered_audio_count']) || !isArtistId(row.artist_id) || !isText(row.name)
      || !Number.isSafeInteger(row.registered_audio_count) || row.registered_audio_count < 0
      || artistsById.has(row.artist_id)) throw new Error('artists.json: invalid artist or duplicate ID');
    artistsById.set(row.artist_id, row);
  }

  const seen = new Set();
  const names = new Set(master.map(row => row.name));
  return coverage.artists.map(entry => {
    if (hasKeys(entry, ['name'])) {
      const { name } = entry;
      if (!isText(name) || names.has(name)) throw new Error('coverage.json: invalid or duplicate pending artist name');
      names.add(name);
      return { name, status: 'unlisted', covered_from: null, covered_through: null, reflected_at: null };
    }

    const keys = ['artist_id', 'status', 'covered_from', 'covered_through', 'reflected_at'];
    if (entry && Object.hasOwn(entry, 'note')) keys.push('note');
    if (!hasKeys(entry, keys)
      || !artistsById.has(entry.artist_id) || seen.has(entry.artist_id)) {
      throw new Error(`coverage.json: invalid or duplicate artist ID ${entry?.artist_id}`);
    }
    const { artist_id, status, covered_from, covered_through, reflected_at } = entry;
    if (!['listed', 'unlisted'].includes(status)
      || (covered_from !== null && (!isDate(covered_from) || covered_from > today))
      || (covered_from !== null && covered_through !== null && covered_from > covered_through)
      || (covered_through !== null && (!isDate(covered_through) || covered_through > today))
      || (reflected_at !== null && (!isDate(reflected_at) || reflected_at > today))
      || (keys.includes('note') && (status !== 'listed' || !isText(entry.note)))
      || (status === 'unlisted' && (covered_from !== null || covered_through !== null || reflected_at !== null))) {
      throw new Error(`coverage.json: invalid status or dates for ${artist_id}`);
    }
    seen.add(artist_id);
    const { name, registered_audio_count } = artistsById.get(artist_id);
    return { ...entry, name, registered_audio_count };
  });
}

export function readPolicy(policy) {
  if (!hasKeys(policy, ['sections', 'coverage_note']) || !isText(policy.coverage_note)
    || !Array.isArray(policy.sections) || !policy.sections.length
    || !policy.sections.every(section => hasKeys(section, ['title', 'paragraphs'])
      && isText(section.title) && Array.isArray(section.paragraphs)
      && section.paragraphs.length > 0 && section.paragraphs.every(isText))) {
    throw new Error('policy.json: invalid structure');
  }
  return policy;
}
