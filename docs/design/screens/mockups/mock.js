const params = new URLSearchParams(location.search);
const tabs = Array.from(document.querySelectorAll('[role="tab"]'));

function selectTab(selected) {
  tabs.forEach(tab => {
    const active = tab === selected;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !active;
  });
}

if (tabs.length) {
  selectTab(tabs.find(tab => tab.getAttribute('aria-controls') === params.get('tab')) ?? tabs[0]);
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', event => {
      const destination = {
        Home: 0,
        End: tabs.length - 1,
        ArrowRight: (index + 1) % tabs.length,
        ArrowLeft: (index + tabs.length - 1) % tabs.length
      }[event.key];
      if (destination === undefined) return;
      event.preventDefault();
      selectTab(tabs[destination]);
      tabs[destination].focus();
    });
  });
}

for (const example of document.querySelectorAll('[data-example]')) {
  example.hidden = example.dataset.example !== (params.get('example') === 'single' ? 'single' : 'multiple');
}

const includeSelf = document.getElementById('include-self');
const modes = [...document.querySelectorAll('[data-mode]')];
function restorePairDisplay() {
  const query = new URLSearchParams(location.search);
  const directed = query.get('mode') === 'lyrics_composition' || (!query.has('mode') && query.has('include_self'));
  const self = query.get('include_self') === '1';
  const view = directed ? (includeSelf && self ? 'self' : 'different') : 'all';
  for (const button of modes) button.setAttribute('aria-pressed', button.dataset.mode === (directed ? 'lyrics_composition' : 'all'));
  for (const list of document.querySelectorAll('[data-pair-view]')) list.hidden = list.dataset.pairView !== view;
  if (includeSelf) {
    includeSelf.checked = self;
    document.getElementById('mock-directed').hidden = !directed;
    document.getElementById('pair-display-status').textContent = self ? '同一作家の組み合わせも表示' : '異なる作家の組み合わせを表示';
  }
  const link = document.getElementById('mock-pair-analysis');
  if (link) link.href = 'analysis.html?tab=pairs' + (directed ? '&mode=lyrics_composition' : '');
}

function changePairDisplay(key, value) {
  const url = new URL(location.href);
  if (value) url.searchParams.set(key, value);
  else url.searchParams.delete(key);
  history.pushState(null, '', url);
  restorePairDisplay();
}

for (const button of modes) button.addEventListener('click', () => changePairDisplay('mode', button.dataset.mode));
includeSelf?.addEventListener('change', () => changePairDisplay('include_self', includeSelf.checked ? '1' : null));
if (modes.length) {
  window.addEventListener('popstate', restorePairDisplay);
  restorePairDisplay();
}

const samples = document.getElementById('mock-collaborations');
if (samples) {
  const data = JSON.parse(samples.textContent);
  const key = params.get('pair');
  const row = Object.hasOwn(data, key) ? data[key] : data['C00001-C00002'];
  const link = (text, href) => {
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.textContent = text;
    return anchor;
  };
  const text = (tag, label, className) => {
    const node = document.createElement(tag);
    node.textContent = label;
    if (className) node.className = className;
    return node;
  };
  const creators = document.getElementById('mock-creators');
  creators.append(link(row.names[0], 'creator-detail.html'));
  if (!row.self) creators.append(' × ', link(row.names[1], 'creator-detail.html'));
  document.getElementById('mock-total').textContent = (row.self ? '本人が作詞・作曲を両方担当した作品：' : '共同制作曲数（全担当区分）：') + row.total + '曲';
  for (const [label, count] of row.breakdown) {
    const item = document.createElement('li');
    item.className = 'mock-breakdown-row';
    item.append(text('span', label), text('span', count + '曲'));
    document.getElementById('mock-breakdown').append(item);
  }
  for (const work of row.works) {
    const item = document.createElement('li');
    item.append(link(work.title, 'song-detail.html'));
    if (work.count) item.append(text('span', work.count, 'mock-song-count'));
    for (const group of work.groups) {
      const section = document.createElement('div');
      section.className = 'mock-song-group';
      for (const name of group.names) section.append(text('small', name));
      section.append(text('p', group.credits));
      item.append(section);
    }
    document.getElementById('mock-works').append(item);
  }
}
