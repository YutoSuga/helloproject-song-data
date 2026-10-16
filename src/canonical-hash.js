import { createHash } from "node:crypto";

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// RFC 8785 (JCS): UTF-16 key ordering, ECMAScript JSON number/string encoding,
// no whitespace or Unicode normalization. Reject values outside the JSON domain.
export function canonicalJson(value) {
  const ancestors = new Set();
  const string = (value) => {
    if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) {
      throw new TypeError("JCS rejects lone Unicode surrogates");
    }
    return JSON.stringify(value);
  };
  const encode = (item) => {
    if (item === null || typeof item === "boolean") return JSON.stringify(item);
    if (typeof item === "string") return string(item);
    if (typeof item === "number" && Number.isFinite(item)) return JSON.stringify(item);
    if (typeof item !== "object" || item === null || ancestors.has(item)) throw new TypeError("JCS requires acyclic JSON values");
    ancestors.add(item);
    let result;
    if (Array.isArray(item)) {
      // Array.map skips holes; they must be rejected rather than silently hashed.
      result = "[" + Array.from({ length: item.length }, (_, index) => encode(item[index])).join(",") + "]";
    } else {
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) throw new TypeError("JCS requires plain JSON objects");
      if (Object.getOwnPropertySymbols(item).length) throw new TypeError("JCS rejects symbol keys");
      result = "{" + Object.keys(item).sort().map((key) => string(key) + ":" + encode(item[key])).join(",") + "}";
    }
    ancestors.delete(item);
    return result;
  };
  return encode(value);
}

export const hashCanonicalJson = (value) => sha256(Buffer.from(canonicalJson(value), "utf8"));
