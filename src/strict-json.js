// JSON.parse accepts duplicate members and strips no BOM reliably across decoders.
// Scan member names before parsing; serialization/hashing remains existing JCS.
export function parseStrictJson(bytes) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) throw new SyntaxError('JSON BOM is forbidden');
  const input = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  let i = 0;
  const ws = () => { while (/[\x20\t\r\n]/.test(input[i] ?? '\0')) i++; };
  const string = () => {
    const start = i++;
    while (i < input.length) {
      if (input[i] === '\\') { i += 2; continue; }
      if (input[i++] === '"') return JSON.parse(input.slice(start, i));
    }
    throw new SyntaxError('Unterminated string');
  };
  const value = () => {
    ws();
    if (input[i] === '"') { string(); return; }
    if (input[i] === '{') {
      i++; ws(); const keys = new Set();
      if (input[i] === '}') { i++; return; }
      for (;;) {
        ws(); if (input[i] !== '"') throw new SyntaxError('Expected member');
        const key = string();
        if (keys.has(key)) throw new SyntaxError('Duplicate JSON member');
        keys.add(key); ws(); if (input[i++] !== ':') throw new SyntaxError('Expected colon');
        value(); ws(); const end = input[i++];
        if (end === '}') return;
        if (end !== ',') throw new SyntaxError('Expected comma');
      }
    }
    if (input[i] === '[') {
      i++; ws(); if (input[i] === ']') { i++; return; }
      for (;;) { value(); ws(); const end = input[i++]; if (end === ']') return; if (end !== ',') throw new SyntaxError('Expected comma'); }
    }
    const start = i;
    while (i < input.length && !/[\s,}\]]/.test(input[i])) i++;
    if (i === start) throw new SyntaxError('Expected value');
    JSON.parse(input.slice(start, i));
  };
  value(); ws(); if (i !== input.length) throw new SyntaxError('Trailing JSON');
  return JSON.parse(input);
}
