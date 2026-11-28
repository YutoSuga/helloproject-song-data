import { detailLink, element } from './common.js';

export function rankRow(entry, name, maximum, action) {
  const item = element('li');
  const row = element('div', null, 'lab-rank');
  row.append(element('span', `${entry.rank}位`, 'lab-rank-number'), name, element('span', `${entry.work_count}曲`, 'lab-count'));
  if (action) row.append(action);
  item.append(row);
  if (maximum > 0) {
    const bar = element('div', null, 'lab-bar');
    bar.setAttribute('aria-hidden', 'true');
    bar.style.width = `${100 * entry.work_count / maximum}%`;
    item.append(bar);
  }
  return item;
}

export function pairName(entry, artist) {
  const name = element('strong');
  const left = detailLink('creator', entry.lyricist_creator_id, entry.lyricist_name, artist);
  const right = detailLink('creator', entry.composer_creator_id, entry.composer_name, artist);
  const key = `pair-${entry.lyricist_creator_id}-${entry.composer_creator_id}`;
  left.dataset.restore = key + '-lyrics';
  right.dataset.restore = key + '-composition';
  name.append(left, ' × ', right);
  return name;
}

export const topThree = rows => rows.filter(row => row.rank <= 3);
