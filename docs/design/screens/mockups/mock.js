"use strict";
// All fixture values come from this page's HTML. No external data loading.
const q=s=>document.querySelector(s), all=s=>[...document.querySelectorAll(s)];
const normalize=s=>s.normalize('NFKC').toLocaleLowerCase('ja').trim();
q('#show-numbers')?.addEventListener('change',e=>document.body.classList.toggle('numbers-off',!e.target.checked));
// Scroll only the artist container, never the page or fixed navigation.
function positionArtists(){if(document.body.classList.contains('page-index'))return;const strip=q('.body-artists .artist-strip');if(!strip)return;const selected=strip.querySelector('[aria-pressed=true]');strip.scrollLeft=selected.offsetLeft-strip.offsetLeft-12;}
requestAnimationFrame(positionArtists);window.addEventListener('resize',positionArtists);
function tabs(selector,activate){const buttons=all(selector);buttons.forEach((b,i)=>{b.addEventListener('click',()=>{buttons.forEach(x=>{x.setAttribute('aria-selected',String(x===b));x.tabIndex=x===b?0:-1});activate(b)});b.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const n=e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(e.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;buttons[n].focus();buttons[n].click()})})}
let view='search',category=0;
const categories=all('[data-category]').map(x=>x.textContent);
let opener;
function openDialog(dialog,button){opener=button;dialog.showModal();dialog.querySelector('.dialog-close').focus()}
all('dialog').forEach(d=>{d.addEventListener('keydown',e=>{if(e.key!=='Tab')return;const nodes=[...d.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),[tabindex="0"]')].filter(x=>!x.hidden);const first=nodes[0],last=nodes.at(-1);if(!first){e.preventDefault();d.focus();return}if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}});d.querySelector('.dialog-close').addEventListener('click',()=>d.close());d.addEventListener('close',()=>opener?.focus())});
function state(){const value=q('#review-state')?.value||'normal';if(!q('#status'))return;q('#status').hidden=value==='normal';q('#status').textContent=({loading:'読み込み中…',empty:'表示できるデータがありません。',error:'データを表示できません。時間をおいて再読み込みしてください。',missing:'組み合わせデータはまだ生成されていません。'})[value]||'';q('#data-panel').hidden=!['normal','missing'].includes(value);if(q('#pair-controls')){q('#pair-controls').hidden=value==='missing';q('#pair-cards').hidden=value==='missing';q('#pair-summary').hidden=value==='missing';q('#pair-condition').hidden=value==='missing'}if(q('#song-summary')){const busy=value==='loading'||value==='error';q('#song-search').disabled=busy;q('#song-sort').disabled=busy;q('#song-summary').hidden=busy;if(value==='loading')q('#status').textContent='データを読み込んでいます。';if(value==='empty')q('#song-summary').textContent='0作品';if(value==='normal')songs();}}
q('#review-state')?.addEventListener('change',state);
// Work-level fixture search/sort; no production JSON or CSV is loaded.
const works=all('.work-card');
function songs(){const terms=normalize(q('#song-search').value).split(/\s+/u).filter(Boolean);const order=q('#song-sort').value;works.sort((a,b)=>{if(order==='title')return a.dataset.title.normalize('NFKC').localeCompare(b.dataset.title.normalize('NFKC'),'ja',{sensitivity:'variant'})||a.dataset.work.localeCompare(b.dataset.work);const ad=a.dataset.date,bd=b.dataset.date;if(!ad||!bd)return ad?-1:bd?1:a.dataset.work.localeCompare(b.dataset.work);return (order==='new'?bd.localeCompare(ad):ad.localeCompare(bd))||a.dataset.work.localeCompare(b.dataset.work)});works.forEach(c=>{c.hidden=!terms.every(t=>normalize(c.dataset.search).includes(t))});const shown=works.filter(c=>!c.hidden);q('#works').append(...works.filter(c=>c.hidden),...shown);q('#song-summary').textContent=((q('#review-state')?.value==='empty')?0:shown.length)+'作品';if((q('#review-state')?.value||'normal')==='normal'){q('#status').hidden=shown.length>0;q('#status').textContent=shown.length?'':'検索結果は0件です。';}}
q('#song-search')?.addEventListener('input',songs);q('#song-sort')?.addEventListener('change',songs);
all('.work-open').forEach(b=>b.addEventListener('click',()=>{q('#song-detail').replaceChildren(b.closest('article').querySelector('template').content.cloneNode(true));openDialog(q('#song-dialog'),b)}));if(works.length)songs();
// Ranking category selection keeps fixtures and competition ranking rules.
tabs('[data-view]',b=>{view=b.dataset.view;q('#search-panel').hidden=view!=='search';q('#ranking-panel').hidden=view!=='ranking';q('#pair-panel').hidden=view!=='pair';q('#evidence-dialog').close();state()});
tabs('[data-category]',b=>{category=Number(b.dataset.category);const cards=all('#ranking-cards article'),counts=cards.map(c=>Number(c.dataset.counts.split(',')[category]));let last=-1,rank=0;cards.forEach((c,i)=>{if(counts[i]!==last)rank=i+1;last=counts[i];c.querySelector('.count').textContent=counts[i]+'作品';c.querySelector('.rank').textContent=rank+'位'});q('#summary').textContent=categories[category]+'：'+cards.length+'作家 / 延べ'+counts.reduce((a,b)=>a+b,0)+'曲（作家ごとの曲数の合計）'});
// Searchable single combobox: draft input never changes the committed result.
const input=q('#creator-query'),list=q('#creator-options');let selected='',visible=[],active=-1;
const candidates=q('#creator-seed')?[...q('#creator-seed').content.querySelectorAll('[data-id]')].map(x=>({id:x.dataset.id,name:x.textContent})):[];
function closeOptions(){if(!list)return;list.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');active=-1;}
function renderOptions(query=input.value){const text=normalize(query);visible=candidates.filter(c=>normalize(c.name+' '+c.id).includes(text));active=-1;list.replaceChildren(...visible.map((c,i)=>{const li=document.createElement('li');li.id='option-'+c.id;li.role='option';li.setAttribute('aria-selected','false');li.textContent=c.name+'（'+c.id+'）';li.addEventListener('mousedown',e=>e.preventDefault());li.addEventListener('click',()=>choose(i));return li}));if(!visible.length){const empty=document.createElement('li');empty.setAttribute('role','presentation');empty.textContent='該当する作家がありません。';list.append(empty)}list.hidden=false;input.setAttribute('aria-expanded','true');input.removeAttribute('aria-activedescendant');q('#combo-live').textContent=visible.length?'候補を選択すると結果が更新されます。':'該当する作家がありません。選択済みの結果は変更しません。';}
function choose(i){const c=visible[i];if(!c)return;selected=c.id;input.value=c.name+'（'+c.id+'）';input.focus();closeOptions();q('#combo-live').textContent='選択済み：'+c.name;pairResults()}
function pairResults(){const lyrics=q('#filter-lyrics').checked,composition=q('#filter-composition').checked;let count=0,total=0,last=-1,rank=0;all('#pair-cards article').forEach(c=>{const L=c.dataset.lyricist===selected,C=c.dataset.composer===selected;const show=!selected||(lyrics&&composition?L&&C:lyrics?L:composition?C:L||C);c.hidden=!show;if(show){count++;const n=Number(c.dataset.works);if(n!==last)rank=count;last=n;c.querySelector('.rank').textContent=rank+'位';total+=n}});q('#pair-summary').textContent=count?count+'組 / 延べ'+total+'曲（組み合わせごとの曲数の合計）':'条件に一致する組み合わせがありません';q('#filter-lyrics').disabled=q('#filter-composition').disabled=!selected;const name=candidates.find(c=>c.id===selected)?.name;const role=lyrics&&composition?'作詞・作曲の両方':lyrics?'作詞':composition?'作曲':'作詞、または作曲';q('#pair-condition').textContent=selected?name+'が'+role+'を担当した組み合わせ':'すべての作詞・作曲ペアを表示しています。';}
function resetCreator(){selected='';input.value='';q('#filter-lyrics').checked=q('#filter-composition').checked=false;closeOptions();pairResults();q('#combo-live').textContent='作家選択を解除しました。'}
q('#filter-lyrics')?.addEventListener('change',pairResults);q('#filter-composition')?.addEventListener('change',pairResults);q('#filter-clear')?.addEventListener('click',resetCreator);
input?.addEventListener('input',()=>{if(input.value==='')resetCreator();else renderOptions()});input?.addEventListener('focus',()=>renderOptions(''));input?.addEventListener('click',()=>{if(list.hidden)renderOptions()});
let composing=false;input?.addEventListener('compositionstart',()=>{composing=true});input?.addEventListener('compositionend',()=>{composing=false});
input?.addEventListener('keydown',e=>{if(composing||e.isComposing||e.keyCode===229)return;if(e.key==='Tab'){closeOptions();return}if(e.key==='Escape'){e.preventDefault();closeOptions();input.value=selected?candidates.find(c=>c.id===selected).name+'（'+selected+'）':'';return}if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();if(list.hidden)renderOptions();if(!visible.length)return;active=active<0?(e.key==='ArrowDown'?0:visible.length-1):(active+(e.key==='ArrowDown'?1:-1)+visible.length)%visible.length;[...list.children].forEach((x,i)=>x.setAttribute('aria-selected',String(i===active)));input.setAttribute('aria-activedescendant',list.children[active].id);list.children[active].scrollIntoView({block:'nearest'})}if(e.key==='Enter'){e.preventDefault();if(!list.hidden&&active>=0)choose(active);else q('#combo-live').textContent='候補一覧から作家を選択してください。'}});
input?.addEventListener('blur',()=>{closeOptions();input.value=selected?candidates.find(c=>c.id===selected).name+'（'+selected+'）':'';q('#combo-live').textContent=selected?'選択済みの結果を保持しています。':'未選択です。'});
all('#pair-cards .creator-open').forEach(button => button.addEventListener('click', () => {
  const card = button.closest('article');
  q('#detail-name').textContent = button.textContent;
  q('#detail-summary').textContent = '作詞 × 作曲・' + card.querySelector('.count').textContent;
  q('#evidence-works').replaceChildren(card.querySelector('[data-pair-evidence]').content.cloneNode(true));
  openDialog(q('#evidence-dialog'), button);
}));

if(input){resetCreator();document.addEventListener('pointerdown',e=>{if(!q('.combobox').contains(e.target))closeOptions()});}

// Creator search and detail use review fixtures embedded in the mock pages.
const creatorParams = new URLSearchParams(location.search);
const creatorSearch = q('#mock-creator-search');
if (creatorSearch) {
  const links = all('#mock-search-results a');
  function updateCreatorSearch() {
    for (const link of links) {
      link.parentElement.hidden = !normalize(link.textContent).includes(normalize(creatorSearch.value));
      const url = new URL(link.href);
      url.searchParams.set('q', creatorSearch.value);
      link.href = url;
    }
    q('#mock-search-empty').hidden = links.some(link => !link.parentElement.hidden);
  }
  creatorSearch.value = creatorParams.get('q') ?? '';
  creatorSearch.addEventListener('input', updateCreatorSearch);
  updateCreatorSearch();
  if (creatorParams.get('view') === 'ranking') {
    q('[data-view="ranking"]').click();
    all('[data-category]').find(button => button.dataset.category === creatorParams.get('category'))?.click();
  }
  all('#ranking-cards a.name').forEach(link => link.addEventListener('click', () => {
    const url = new URL(link.href);
    url.searchParams.set('category', category);
    link.href = url;
  }));
}
if (q('#creator-content')) {
  const samples = all('template[data-sample]');
  const sample = samples.find(item => item.dataset.sample === creatorParams.get('sample')) ?? samples[0];
  const counts = sample.dataset.counts.split(',').map(Number);
  const returnUrl = new URL('creators.html', location.href);
  for (const key of ['view', 'category', 'q']) {
    if (creatorParams.has(key)) returnUrl.searchParams.set(key, creatorParams.get(key));
  }
  q('#creator-back').href = returnUrl;
  q('#creator-heading').textContent = sample.dataset.name;
  q('#creator-overview').textContent = 'Juice=Juice・総担当 ' + counts[0] + '曲';
  const detailCategories = ['すべて', '作詞', '作曲', '作詞 & 作曲', '編曲'];
  counts.forEach((count, column) => {
    const rank = 1 + samples.filter(item => Number(item.dataset.counts.split(',')[column]) > count).length;
    const row = q('#creator-ranks').insertRow();
    const th = document.createElement('th');
    th.scope = 'row';
    th.textContent = detailCategories[column];
    row.append(th);
    row.insertCell().textContent = rank + '位';
    row.insertCell().textContent = count + '曲';
  });
  q('#creator-work-list').replaceChildren(sample.content.cloneNode(true));
  const labels = {lyrics:'作詞', composition:'作曲', arrangement:'編曲', english_lyrics:'英語詞', brass_arrangement:'ブラス編曲'};
  const filters = all('.creator-work-filters button');
  const rows = all('#creator-work-list li');
  rows.forEach(row => {
    const badges = document.createElement('span');
    badges.className = 'role-badges';
    for (const role of row.dataset.roles.split(' ')) {
      const badge = document.createElement('span');
      badge.className = 'role-badge';
      badge.textContent = labels[role];
      badges.append(badge);
    }
    row.append(badges);
  });
  function filterWorks(role) {
    filters.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.role === role)));
    rows.forEach(row => {
      const roles = row.dataset.roles.split(' ');
      row.hidden = role !== 'all' && !(role === 'other'
        ? roles.some(value => !['lyrics', 'composition', 'arrangement'].includes(value))
        : roles.includes(role));
    });
    const count = rows.filter(row => !row.hidden).length;
    q('#creator-work-status').textContent = count ? count + '曲' : '該当する担当楽曲がありません。';
  }
  filters.forEach(button => button.addEventListener('click', () => filterWorks(button.dataset.role)));
  filterWorks('all');
  q('#creator-content').hidden = false;
}
