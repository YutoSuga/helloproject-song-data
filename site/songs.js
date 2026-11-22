import { readSongCatalog, selectWorks, selectSongs } from './song-catalog-model.js';

const versions = { original:'オリジナル', new_vocal:'新歌唱', re_recording:'再録', cover:'カバー', other:'その他' };
export async function mountSongCatalog(document, fetchData = fetch) {
  const find = id => document.getElementById(id);
  const search=find('song-search'), sort=find('song-sort'), status=find('songs-status'), summary=find('song-summary'), works=find('works'), dialog=find('song-dialog'), detail=find('song-detail'), close=find('song-close');
  let data, opener;
  const element = (tag, text, className) => {
    const node=document.createElement(tag);
    if (text !== undefined) node.textContent=text;
    if (className) node.className=className;
    return node;
  };
  const message = text => { status.textContent=text;status.hidden=!text; };
  function showDetail(workId, button) {
    // Re-check the consumed detail structure before opening, without doing FK validation.
    const work=data.works.find(w=>w.work_id===workId);
    try { if (!work) throw new Error('missing work');readSongCatalog({ ...data, works:[work] }); }
    catch { message('楽曲詳細を表示できません。ページを再読み込みしてください。');return; }
    detail.replaceChildren();
    detail.append(element('p',`work ID：${work.work_id}`));
    const heading=element('h2',work.title);heading.id='song-dialog-title';detail.append(heading);
    for (const song of selectSongs(work.songs)) {
      const section=element('section',undefined,'song-detail-card');
      section.append(element('p',`song ID：${song.song_id}`),element('h3',song.title),element('p',`Version名：${song.version_name || '表記なし'}／種別：${versions[song.version_type]}`));
      section.append(element('p',`音源初出日：${song.release_date ?? '確認中'}`));
      const names = role => song.credits.filter(c=>c.role===role).map(c=>c.credit_name).join('／');
      for (const [role,label,special,specialLabel] of [['lyrics','作詞','english_lyrics','英語詞'],['composition','作曲'],['arrangement','編曲','brass_arrangement','ブラス編曲']]) {
        section.append(element('p',`${label}：${names(role)||'未登録'}`));
        if (special && names(special)) section.append(element('p',`${specialLabel}：${names(special)}`));
      }
      detail.append(section);
    }
    opener=button;dialog.showModal();close.focus();
  }
  function render() {
    const selected=selectWorks(data.works,search.value,sort.value);
    summary.textContent=`${selected.length}作品`;
    works.replaceChildren();
    message(data.works.length===0 ? '表示できるデータがありません。' : selected.length===0 ? '検索結果は0件です。' : '');
    const fragment=document.createDocumentFragment();
    for(const work of selected) {
      const card=element('article',undefined,'work-card');
      const button=element('button',work.title,'work-open');button.type='button';button.setAttribute('aria-haspopup','dialog');button.addEventListener('click',()=>showDetail(work.work_id,button));
      card.append(button);
      card.append(element('p',`音源初出日：${work.first_release_date ?? '確認中'}`));
      fragment.append(card);
    }
    works.append(fragment);
  }
  search.disabled=true;sort.disabled=true;message('データを読み込んでいます。');
  close.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{detail.replaceChildren();if(opener?.isConnected)opener.focus();});
  dialog.addEventListener('keydown',event=>{
    if(event.key==='Tab') { event.preventDefault();close.focus(); }
  });
  try {
    const response=await fetchData(new URL('./data/songs/G00001.json',import.meta.url));
    if(!response.ok) throw new Error(`HTTP ${response.status}`);
    data=readSongCatalog(await response.json());
    find('songs-scope').textContent=`${data.artist.name}の登録作品（work単位）`;
    search.disabled=false;sort.disabled=false;
    search.addEventListener('input',render);sort.addEventListener('change',render);render();
  } catch { works.replaceChildren();summary.textContent='';message('データを表示できません。時間をおいて再読み込みしてください。'); }
}
if (typeof document !== 'undefined') mountSongCatalog(document);
