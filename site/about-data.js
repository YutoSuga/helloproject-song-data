import { readCoverage, readPolicy, readUpdates } from './about-data-model.js';

const loadingError = 'データを表示できません。時間をおいて再読み込みしてください。';
const empty = '表示できるデータがありません。';
const formatDate = date => date.replaceAll('-', '/');

async function fetchData(file) {
  const response = await fetch(new URL(`./data/about/${file}.json`, import.meta.url));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function element(tag, text) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

function dateLabel(date, prefix = '') {
  const time = element('time', prefix + formatDate(date));
  time.dateTime = date;
  return time;
}

function renderSection(id, load, render) {
  const section = document.getElementById(id);
  if (!section) return;
  const status = section.querySelector('[role="status"]');
  const content = section.querySelector('.about-content');
  return load().then(data => {
    const nodes = render(data);
    content.replaceChildren(...nodes);
    status.textContent = nodes.length ? '' : empty;
    status.classList.toggle('visually-hidden', nodes.length > 0);
  }).catch(() => {
    content.replaceChildren();
    status.textContent = loadingError;
    status.classList.remove('visually-hidden');
  });
}

function renderUpdates(updates) {
  if (!updates.length) return [];
  const list = element('ol');
  list.className = 'about-updates';
  list.setAttribute('role', 'list');
  for (const update of updates) {
    const row = element('li');
    row.append(dateLabel(update.date), element('span', update.description));
    list.append(row);
  }
  return [list];
}

function renderCoverage(rows) {
  if (!rows.length) return [];
  const list = element('ul');
  list.className = 'about-coverage';
  list.setAttribute('role', 'list');
  for (const row of rows) {
    const item = element('li');
    const details = element('dl');
    const range = element('dd');
    range.append(row.status === 'unlisted' ? '未収録'
      : row.covered_through ? dateLabel(row.covered_through, 'デビュー ～ ') : '確認中');
    const reflected = element('dd');
    reflected.append(row.status === 'unlisted' ? '—'
      : row.reflected_at ? dateLabel(row.reflected_at) : '確認中');
    details.append(element('dt', '収録範囲'), range, element('dt', 'データ反映日'), reflected);
    item.append(element('h3', row.name), details);
    list.append(item);
  }
  return [list];
}

const updates = document.getElementById('site-updates');
const updatesReady = renderSection('site-updates', async () => readUpdates(await fetchData('updates'))
  .slice(0, updates.dataset.recent === 'true' ? 3 : undefined), renderUpdates);

if (document.getElementById('data-policy')) {
  const policy = fetchData('policy').then(readPolicy);
  const policyReady = renderSection('data-policy', () => policy, ({ sections }) => sections.map(section => {
    const group = element('section');
    group.append(element('h3', section.title), ...section.paragraphs.map(text => element('p', text)));
    return group;
  }));
  const coverageReady = renderSection('artist-coverage', async () => {
    const [coverage, master] = await Promise.all([fetchData('coverage'), fetchData('artists')]);
    return readCoverage(coverage, master);
  }, renderCoverage);
  const noteReady = policy.then(({ coverage_note }) => {
    document.getElementById('coverage-note').textContent = coverage_note;
  }).catch(() => {});

  if (location.hash === '#site-updates') {
    // Above the target, the policy and coverage can grow after native fragment scrolling.
    const navigation = new AbortController();
    for (const event of ['wheel', 'pointerdown', 'keydown']) {
      window.addEventListener(event, () => navigation.abort(), { passive: true, signal: navigation.signal });
    }
    Promise.all([policyReady, coverageReady, noteReady, updatesReady]).then(() => {
      if (!navigation.signal.aborted && location.hash === '#site-updates') updates.scrollIntoView();
      navigation.abort();
    });
  }
}
