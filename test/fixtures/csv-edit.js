import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CANONICAL_TABLES } from '../../src/canonical-schema.js';
const cell = value => /[",\r\n]/.test(value) ? '"'+value.replaceAll('"','""')+'"' : value;
export async function writeCanonicalTables(root, tables = {}) {
  await mkdir(join(root,'data'),{recursive:true});
  for (const t of CANONICAL_TABLES) {
    const rows=(tables[t.name]??[]).map(row=>t.columns.map(c=>cell(String(row[c.name]??''))).join(','));
    await writeFile(join(root,t.path),[t.columns.map(c=>c.name).join(','),...rows].join('\n')+'\n');
  }
}
export function completeRow(table, values) {
  const t=CANONICAL_TABLES.find(t=>t.name===table);
  return Object.fromEntries(t.columns.map(c=>[c.name,values[c.name]??(c.name.endsWith('_at')?'2026-11-25T00:00:00Z':c.name==='source_url'?'https://example.test/source':'')]));
}
export async function writeTitleFixture(root) {
  await writeCanonicalTables(root,{
    artists:[completeRow('artists',{artist_id:'G00001',name:'Group',type:'group'})],
    works:[completeRow('works',{work_id:'W00001',title:'Misery ～愛の天秤～'})],
    songs:[completeRow('songs',{song_id:'H00001',work_id:'W00001',title:'Misery ～愛の天秤～',version_type:'original'})],
    song_artists:[completeRow('song_artists',{song_id:'H00001',artist_id:'G00001',role:'primary'})]
  });
}
