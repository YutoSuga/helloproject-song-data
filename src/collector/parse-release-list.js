import { byClass, clean, firstClass, parseHtml } from "./html.js";

const audioTypes = new Set(["CDシングル", "CDアルバム", "ミニアルバム", "アルバム", "EP", "配信"]);
const excludedTypes = new Set(["写真集", "書籍", "グッズ", "映像", "Blu-ray", "DVD"]);

export function parseReleaseList(html, config) {
  const root = parseHtml(html);
  const cards = byClass(root, "ReleasePanel");
  if (!cards.length) throw new Error("Release list structure changed: no ReleasePanel");
  const releases = new Map();
  const unknownTypes = new Set();
  for (const card of cards) {
    const type = clean(firstClass(card, "StatusLabel--category"));
    const href = card.attrs.href;
    const title = clean(firstClass(card, "ReleasePanel__title"));
    if (!type || !href || !title) throw new Error("Release list card is missing required fields");
    if (excludedTypes.has(type)) continue;
    if (!audioTypes.has(type)) { unknownTypes.add(type); continue; }
    const url = new URL(href, config.releaseUrl);
    if (url.origin !== new URL(config.releaseUrl).origin || !url.pathname.startsWith(`/${config.slug}/release/`)) {
      throw new Error(`Unexpected release URL: ${url}`);
    }
    releases.set(url.href, { url: url.href, title, type });
  }
  if (unknownTypes.size) throw new Error(`Unknown release types require review: ${[...unknownTypes].join(", ")}`);
  return [...releases.values()];
}

// The official list HTML renders only New Release. The same HTML supplies
// Astro's version directory and years for its official year-by-year JSON feed.
export function parseReleaseFeed(html, config) {
  const root = parseHtml(html);
  const island = byClass(root, "ReleasePanel"); // Confirm the list page rendered.
  if (!island.length) throw new Error("Release list HTML missing");
  const components = [];
  const visit = (node) => {
    for (const child of node.children ?? []) {
      if (typeof child === "string") continue;
      if (child.tag === "astro-island" && (child.attrs["component-url"] ?? "").includes("/Release.")) components.push(child);
      visit(child);
    }
  };
  visit(root);
  if (components.length !== 1) throw new Error("Official release feed metadata missing");
  const props = JSON.parse(components[0].attrs.props ?? "{}");
  const versionDir = props.versionDir?.[1];
  const years = props.years?.[1]?.map((entry) => Number(entry[1])).filter((year) => year >= config.firstReleaseYear);
  const groupId = props.fixedFilterProps?.[1]?.selectedGroupIds?.[1]?.[0]?.[1];
  if (!/^[\w-]+$/.test(versionDir ?? "") || !years?.length || groupId !== config.officialGroupId || props.groupSlug?.[1] !== config.slug) {
    throw new Error("Official release feed metadata changed");
  }
  return { versionDir, years };
}

export function parseReleaseFeedYear(payload, config) {
  if (payload?.type !== "release" || !Array.isArray(payload.items)) throw new Error("Invalid official release feed");
  const releases = [];
  const unknownTypes = new Set();
  for (const item of payload.items) {
    if (!item.artistsSearch?.includes(config.officialGroupId)) continue;
    const type = item.categoryLabel;
    if (excludedTypes.has(type)) continue;
    if (!audioTypes.has(type)) { unknownTypes.add(String(type)); continue; }
    if (!Number.isInteger(item.id) || !item.title || item.link !== `/release/${item.id}/`) {
      throw new Error("Official release feed item changed");
    }
    releases.push({ url: new URL(`/${config.slug}/release/${item.id}/`, config.releaseUrl).href, title: item.title, type });
  }
  if (unknownTypes.size) throw new Error(`Unknown release types require review: ${[...unknownTypes].join(", ")}`);
  return releases;
}
