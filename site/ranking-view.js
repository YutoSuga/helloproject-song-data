import { detailLink, element, navigationLink } from './common.js';

export function rankRow(entry, name, maximum, countLink) {
  const item = element('li');
  const row = element('div', null, 'lab-rank');
  row.append(element('span', `${entry.rank}位`, 'lab-rank-number'), name,
    countLink ?? element('span', `${entry.work_count}曲`, 'lab-count'));
  item.append(row);
  if (maximum > 0) {
    const bar = element('div', null, 'lab-bar');
    bar.setAttribute('aria-hidden', 'true');
    bar.style.width = `${100 * entry.work_count / maximum}%`;
    item.append(bar);
  }
  return item;
}

export function collaborationLink(first, second, artist, text, focus = `${first}-${second}`) {
  const [creator_id, partner_id] = [first, second].sort();
  return navigationLink(text, '/analysis/detail/', { artist_id: artist, creator_id, partner_id }, 'collaboration-' + focus);
}

function countLink(first, second, artist, count, label, focus) {
  const anchor = collaborationLink(first, second, artist, `${count}曲 ›`, focus);
  anchor.className = 'lab-count';
  anchor.setAttribute('aria-label', `${label}の共同制作楽曲を表示（${count}曲）`);
  return anchor;
}

export function pairRow(entry, artist, maximum) {
  const first = entry.first ?? entry.lyricist_creator_id;
  const second = entry.second ?? entry.composer_creator_id;
  const leftName = entry.first_name ?? entry.lyricist_name;
  const rightName = entry.second_name ?? entry.composer_name;
  const name = element('strong');
  const left = detailLink('creator', first, leftName, artist);
  const right = detailLink('creator', second, rightName, artist);
  left.dataset.restore = `pair-${first}-${second}-left`;
  right.dataset.restore = `pair-${first}-${second}-right`;
  name.append(left, ' × ', right);
  return rankRow(entry, name, maximum, countLink(first, second, artist, entry.work_count, `${leftName} × ${rightName}`));
}

export function collaboratorRow(entry, target, artist, maximum) {
  return rankRow(entry, detailLink('creator', entry.creator_id, entry.creator_name, artist), maximum,
    countLink(target, entry.creator_id, artist, entry.work_count, entry.creator_name));
}

export const topThree = rows => rows.filter(row => row.rank <= 3);
