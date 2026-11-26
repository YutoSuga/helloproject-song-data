import { CANONICAL_TABLES } from './canonical-schema.js';
import { parseStrictJson } from './strict-json.js';

export const ID_MASTERS = CANONICAL_TABLES.filter(t => t.primaryKey.length === 1 && t.columns.some(c => c.name === t.primaryKey[0] && c.target === t.name));
export const ID_NAMESPACES = [...new Set(ID_MASTERS.flatMap(t => {
  const pattern = t.columns.find(c => c.name === t.primaryKey[0]).pattern;
  return [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].filter(n => pattern.test(`${n}00000`));
}))].sort();
export const MIGRATION_BASE = '14fc448bfb17c4a9de53437f3f3819593da3356b';
export const INITIAL_HIGH_WATER = Object.freeze({ A:0,B:0,C:88,G:3,H:1,J:120,L:136,M:0,O:0,P:17,R:0,T:0,V:0,W:90 });
const fail = message => { throw new Error(`ID_HIGH_WATER_INVALID: ${message}`); };
export function validateHighWater(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== ID_NAMESPACES.join()) fail('exactly all namespaces are required');
  for (const n of ID_NAMESPACES) if (!Number.isInteger(value[n]) || value[n] < 0 || value[n] > 99999) fail(`${n}: expected integer 0..99999`);
  return value;
}
export const parseHighWater = bytes => validateHighWater(parseStrictJson(bytes));
export function validateIdChanges(baseTables, tables, baseWater, water) {
  validateHighWater(baseWater); validateHighWater(water);
  const additions = [], deletions = [], edits = [];
  const expected = { ...baseWater };
  for (const t of ID_MASTERS) {
    const key = t.primaryKey[0], before = new Map(baseTables[t.name].map(row => [row[key], row]));
    const after = new Map(tables[t.name].map(row => [row[key], row]));
    for (const [id, row] of before) {
      if (!after.has(id)) deletions.push({ table:t.name, id });
      else if (JSON.stringify(row) !== JSON.stringify(after.get(id))) edits.push({ table:t.name, id, before:row, after:after.get(id) });
    }
    for (const [id] of after) {
      const n = id[0], number = Number(id.slice(1));
      if (!ID_NAMESPACES.includes(n) || !Number.isInteger(number)) fail(`invalid ID ${id}`);
      if (number > water[n]) fail(`${id}: above candidate high water`);
      if (!before.has(id)) {
        if (number <= baseWater[n]) fail(`${id}: confirmed/deleted ID or consumed gap cannot be reused`);
        additions.push({ table:t.name, id }); expected[n] = Math.max(expected[n], number);
      }
    }
  }
  for (const n of ID_NAMESPACES) if (water[n] !== expected[n]) fail(`${n}: expected ${expected[n]}, got ${water[n]} (decrease, reservation or missing update)`);
  return { additions, deletions, identity_review: edits };
}
