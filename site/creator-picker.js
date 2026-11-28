import { $, element } from './common.js';
import { normalize } from './song-catalog-model.js';

export function mountCreatorPicker(select) {
  const input = $('pair-creator');
  const list = $('pair-creator-options');
  const live = $('combo-live');
  let creators = new Map();
  let selected;
  let candidates = [];
  let active = -1;
  let composing = false;
  const label = (id, name) => `${name}（${id}）`;

  function close() {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    input.value = selected ? label(selected, creators.get(selected)) : '';
  }

  function highlight(index) {
    active = index;
    [...list.children].forEach((row, position) => {
      if (row.getAttribute('role') === 'option') row.setAttribute('aria-selected', position === index);
    });
    if (index < 0) input.removeAttribute('aria-activedescendant');
    else {
      input.setAttribute('aria-activedescendant', list.children[index].id);
      list.children[index].scrollIntoView({ block: 'nearest' });
    }
  }

  function choose(id) {
    selected = id;
    close();
    live.textContent = `${creators.get(id)}を選択しました。`;
    select(id);
  }

  function show(query = '') {
    const term = normalize(query);
    candidates = [...creators].filter(([id, name]) => normalize(name).includes(term) || normalize(id).includes(term));
    list.replaceChildren(...candidates.map(([id, name]) => {
      const row = element('li', label(id, name));
      row.id = `option-${id}`;
      row.setAttribute('role', 'option');
      row.addEventListener('pointerdown', event => event.preventDefault());
      row.addEventListener('click', () => choose(id));
      return row;
    }));
    if (!candidates.length) {
      const empty = element('li', '該当する作家がありません');
      empty.setAttribute('role', 'presentation');
      list.append(empty);
    }
    highlight(-1);
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    live.textContent = candidates.length ? `${candidates.length}件の候補。上下キーで選びEnterで確定します。`
      : '該当する作家がありません。選択済みの結果は変更しません。';
  }

  input.addEventListener('focus', () => show());
  input.addEventListener('click', () => { if (list.hidden) show(); });
  input.addEventListener('input', () => {
    if (!input.value && selected && !composing) select(undefined);
    else show(input.value);
  });
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { composing = false; show(input.value); });
  input.addEventListener('blur', close);
  input.addEventListener('keydown', event => {
    if (composing || event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape' && !list.hidden) {
      event.preventDefault();
      close();
    }
    if (event.key === 'Enter' && !list.hidden && active >= 0) {
      event.preventDefault();
      choose(candidates[active][0]);
    }
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      if (list.hidden) show();
      if (candidates.length) {
        const next = event.key === 'ArrowDown'
          ? (active + 1) % candidates.length
          : active <= 0 ? candidates.length - 1 : active - 1;
        highlight(next);
      }
    }
  });
  document.addEventListener('pointerdown', event => {
    if (!input.closest('.creator-combobox').contains(event.target) && !list.hidden) close();
  });
  return (options, id) => {
    creators = new Map([...options].sort(([a], [b]) => a.localeCompare(b, 'en')));
    selected = creators.has(id) ? id : undefined;
    input.disabled = !creators.size;
    close();
  };
}
