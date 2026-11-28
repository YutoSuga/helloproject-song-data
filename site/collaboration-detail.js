import { compareCreatorNames, creatorName, creatorReadings } from './creator-name.js';
import { collaborationRecordings, groupRecordings, roleBreakdown, creditName, creditsInRole } from './collaboration-credits.js';
import { $, detailLink, element, restorePosition, setupDetail, status, update } from './common.js';
import { collaborationIndex, pairKey, selfCollaboration } from './collaborators.js';
import { ALL_ROLE_LABELS } from './creator-roles.js';
import { loadData, loadError, readPairs } from './public-data.js';
import { detailRequestError, isCreatorId } from './site-state.js';

const { artist_id: artist, creator_id: first, partner_id: second } = setupDetail($('detail-back'), 'pairs');
const message = $('data-status');
const params = new URLSearchParams(location.search);
const error = detailRequestError(params, 'creator_id', isCreatorId, '共同制作楽曲')
  || detailRequestError(params, 'partner_id', isCreatorId, '共同制作楽曲');

function workRow(work) {
  const row = element('li');
  row.append(detailLink('work', work.work_id, work.title, artist));
  if (work.totalSongs > 1) {
    const count = work.songs.length === work.totalSongs ? `${work.totalSongs}音源`
      : `該当${work.songs.length}音源／全${work.totalSongs}音源`;
    row.append(element('span', count, 'collaboration-song-count'));
  }
  for (const group of groupRecordings(work.songs)) {
    const section = element('div', null, 'collaboration-song-group');
    if (work.totalSongs > 1) {
      const names = element('ul', null, 'collaboration-song-names');
      for (const song of group.songs) {
        const name = song.version_name && !song.title.includes(song.version_name)
          ? `${song.title}（${song.version_name}）` : song.title;
        names.append(element('li', name));
      }
      section.append(names);
    }
    const lines = Object.entries(ALL_ROLE_LABELS).flatMap(([role, label]) => {
      const credits = creditsInRole(group.credits, role);
      return credits.length ? [`${label}：${credits.map(creditName).join('、')}`] : [];
    });
    section.append(element('p', lines.join(' ／ '), 'collaboration-credits'));
    row.append(section);
  }
  return row;
}

if (error) status(message, error);
else {
  try {
    const self = first === second;
    const rankings = loadData('rankings', artist);
    const [catalog, ranking] = await Promise.all([
      loadData('songs', artist), self ? rankings : rankings.catch(() => null)
    ]);
    const { creators, pairs } = collaborationIndex(catalog.works);
    if (!creators.has(first) || !creators.has(second)) status(message, '指定された作家が見つかりません。');
    else {
      update({}, { replace: true });
      const works = self ? selfCollaboration(readPairs(ranking), catalog.works, first)
        : pairs.get(pairKey(first, second))?.works ?? [];
      $('collaboration-artist').textContent = catalog.artist.name;
      const readings = creatorReadings(ranking);
      const authors = [...new Set([first, second])].map(id => creatorName(id, creators.get(id), readings)).sort(compareCreatorNames);
      const heading = $('collaboration-creators');
      for (const [index, author] of authors.entries()) {
        if (index) heading.append(' × ');
        heading.append(detailLink('creator', author.creator_id, author.creator_name, artist));
      }
      $('collaboration-total').textContent = self
        ? `本人が同じ音源で作詞・作曲を両方担当した作品：${works.length}曲`
        : `共同制作曲数（全担当区分）：${works.length}曲`;
      const recordings = collaborationRecordings(catalog.works, works);
      const patterns = roleBreakdown(recordings, [first, second]);
      $('collaboration-breakdown').replaceChildren(...patterns.map(({ credits, count }) => {
        const row = element('li');
        const label = element('span');
        for (const [index, credit] of credits.entries()) {
          if (index) label.append(' × ');
          label.append(element('span', `${ALL_ROLE_LABELS[credit.role]}：${creators.get(credit.creator_id)}`, 'collaboration-credit-part'));
        }
        row.append(label, element('span', `${count}曲`, 'lab-count'));
        return row;
      }));
      $('breakdown-note').hidden = !works.length;
      if (!works.length) $('collaboration-breakdown').append(element('li', '該当する内訳はありません。'));
      $('collaboration-works').replaceChildren(...recordings.map(workRow));
      $('collaboration-empty').hidden = works.length > 0;
      $('collaboration-content').hidden = false;
      status(message, '');
      restorePosition();
    }
  } catch {
    status(message, loadError);
  }
}
