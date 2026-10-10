export async function fetchPage(url, { fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  const html = await response.text();
  if (!html || !/<html\b/i.test(html)) throw new Error(`Invalid HTML: ${url}`);
  return html;
}
