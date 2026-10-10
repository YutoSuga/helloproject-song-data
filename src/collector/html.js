// Focused HTML tree for the server-rendered release pages. Unknown markup is
// tolerated, but the release parsers validate every structure they rely on.
const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export function decode(text) {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === "#") {
      const value = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : match;
    }
    return entities[code.toLowerCase()] ?? match;
  });
}
export function parseHtml(html) {
  const root = { tag: "root", attrs: {}, children: [], parent: null };
  let current = root;
  for (const token of html.match(/<!--[\s\S]*?-->|<![^>]*>|<\/?[a-z][^>]*>|[^<]+/gi) ?? []) {
    if (token.startsWith("<!")) continue;
    if (token.startsWith("</")) {
      const tag = token.match(/^<\/([\w:-]+)/)?.[1].toLowerCase();
      let node = current;
      while (node !== root && node.tag !== tag) node = node.parent;
      if (node !== root) current = node.parent;
    } else if (token.startsWith("<")) {
      const tag = token.match(/^<([\w:-]+)/)?.[1].toLowerCase();
      if (!tag) continue;
      const attrs = {};
      const rest = token.slice(tag.length + 1, token.length - 1);
      for (const match of rest.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
        attrs[match[1].toLowerCase()] = decode(match[2] ?? match[3] ?? match[4] ?? "");
      }
      const node = { tag, attrs, children: [], parent: current };
      current.children.push(node);
      if (!voidTags.has(tag) && !token.endsWith("/>")) current = node;
    } else current.children.push(decode(token));
  }
  return root;
}
export function findAll(node, predicate) {
  const result = [];
  for (const child of node.children ?? []) {
    if (typeof child === "string") continue;
    if (predicate(child)) result.push(child);
    result.push(...findAll(child, predicate));
  }
  return result;
}
export const hasClass = (node, name) => (node.attrs?.class ?? "").split(/\s+/).includes(name);
export const byClass = (node, name) => findAll(node, (item) => hasClass(item, name));
export const firstClass = (node, name) => byClass(node, name)[0];
export function nodeText(node) {
  if (typeof node === "string") return node;
  return (node?.children ?? []).map(nodeText).join("");
}
export const clean = (node) => nodeText(node).replace(/\s+/g, " ").trim();
