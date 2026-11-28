import { $, detailLink, element, restorePosition, setupDetail, status, update } from './common.js';
import { breakdown, collaborationIndex, pairKey, selfCollaboration } from './collaborators.js';
import { ALL_ROLE_LABELS } from './creator-roles.js';
import { loadData, loadError, readPairs } from './public-data.js';
import { detailRequestError, isCreatorId } from './site-state.js';

const { artist_id: artist, creator_id: first, partner_id: second } = setupDetail($('detail-back'), 'pairs');
const message = $('data-status');
const params = new URLSearchParams(location.search);
const error = detailRequestError(params, 'creator_id', isCreatorId, '共同制作楽曲')
  || detailRequestError(params, 'partner_id', isCreatorId, '共同制作楽曲');

function describe(pattern, names) {
  const [a, b] = pattern.split(':');
  const labels = [ALL_ROLE_LABELS[a], ALL_ROLE_LABELS[b]];
  const order = Object.keys(ALL_ROLE_LABELS);
  const [i, j] = order.indexOf(a) <= order.indexOf(b) ? [0, 1] : [1, 0];
  return `${labels[i]}：${names[i]} × ${labels[j]}：${names[j]}`;
}

if (error) status(message, error);
else {
  try {
    const self = first === second;
    const [catalog, ranking] = await Promise.all([loadData('songs', artist), self && loadData('rankings', artist)]);
    const { creators, pairs } = collaborationIndex(catalog.works);
    if (!creators.has(first) || !creators.has(second)) status(message, '指定された作家が見つかりません。');
    else {
      update({}, { replace: true });
      const names = [creators.get(first), creators.get(second)];
      const works = self ? selfCollaboration(readPairs(ranking), catalog.works, first)
        : pairs.get(pairKey(first, second))?.works ?? [];
      $('collaboration-artist').textContent = catalog.artist.name;
      const left = detailLink('creator', first, names[0], artist);
      const right = detailLink('creator', second, names[1], artist);
      right.dataset.restore += '-second';
      $('collaboration-creators').append(left, ' × ', right);
      $('collaboration-total').textContent = self
        ? `本人が同じ音源で作詞・作曲を両方担当した作品：${works.length}曲`
        : `共同制作曲数（全担当区分）：${works.length}曲`;
      const patterns = breakdown(works);
      $('collaboration-breakdown').replaceChildren(...patterns.map(([pattern, count]) =>
        element('li', `${describe(pattern, names)}　${count}曲`)));
      $('breakdown-note').hidden = !works.length || self;
      if (!works.length) $('collaboration-breakdown').append(element('li', '該当する内訳はありません。'));
      const ordered = patterns.map(([pattern]) => pattern);
      for (const work of works) {
        const row = element('li');
        row.append(detailLink('work', work.work_id, work.title, artist));
        for (const pattern of ordered) if (work.patterns.has(pattern)) row.append(element('small', describe(pattern, names)));
        $('collaboration-works').append(row);
      }
      $('collaboration-empty').hidden = works.length > 0;
      $('collaboration-content').hidden = false;
      status(message, '');
      restorePosition();
    }
  } catch {
    status(message, loadError);
  }
}
