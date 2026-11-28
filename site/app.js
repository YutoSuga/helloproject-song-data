import { analyzeCreatorPairs } from "./pair-analysis.js";
import {
  categoryIds, findCreators, listParams, publishedArtistId, readCreatorRankings, readListState
} from "./creator-catalog-model.js";

const status = document.querySelector("#data-status");
try {
  const response = await fetch(new URL("./data/rankings/G00001.json", import.meta.url));
  if (!response.ok) throw new Error(`Ranking data: ${response.status}`);
  const data = readCreatorRankings(await response.json(), publishedArtistId);
  let pairError = "";
  if (data.lyrics_composition_pairs && (!Array.isArray(data.lyrics_composition_pairs.entries) ||
      data.lyrics_composition_pairs.entries.some(entry => !entry || !Number.isInteger(entry.work_count) || !Number.isInteger(entry.rank) ||
      typeof entry.lyricist_creator_id !== "string" || !entry.lyricist_creator_id.trim() ||
      typeof entry.composer_creator_id !== "string" || !entry.composer_creator_id.trim() ||
      typeof entry.lyricist_name !== "string" || typeof entry.composer_name !== "string" ||
      !Array.isArray(entry.works) || entry.works.some(work => !work || typeof work.title !== "string")))) pairError = "組み合わせデータを表示できません。";
  initialize(data, pairError);
  status.hidden = true;
  document.querySelector("#ranking-content").hidden = false;
} catch {
  status.textContent = "データを表示できません。時間をおいて再読み込みしてください。";
}

function initialize(data, pairError) {
  const tabs = document.querySelector("#category-tabs");
  const ranking = document.querySelector("#ranking");
  const heading = document.querySelector("#ranking-heading");
  const summary = document.querySelector("#summary");
  const detail = document.querySelector("#creator-detail");
  const viewTabs = [...document.querySelectorAll(".view-tab")];
  const search = document.querySelector("#creator-search");
  const searchResults = document.querySelector("#creator-search-results");
  const searchCount = document.querySelector("#creator-search-count");
  const searchEmpty = document.querySelector("#creator-search-empty");
  const state = readListState(new URLSearchParams(location.search));
  let opener;

  function saveListState() {
    const url = new URL(location.href);
    url.search = listParams(state).toString();
    history.replaceState(history.state, "", url);
  }
  function creatorUrl(creatorId) {
    const url = new URL("./creators/detail/", import.meta.url);
    const params = listParams(state);
    params.set("creator_id", creatorId);
    params.set("artist_id", data.artist.artist_id);
    url.search = params.toString();
    return url;
  }
  function renderSearch() {
    const matches = findCreators(data.categories.all.entries, state.q);
    searchResults.replaceChildren(...matches.map(entry => {
      const item = document.createElement("li");
      item.className = "catalog-row";
      const link = document.createElement("a");
      link.href = creatorUrl(entry.creator_id);
      link.className = "creator-result-name";
      link.textContent = entry.creator_name;
      item.append(link);
      return item;
    }));
    searchCount.textContent = `${matches.length}作家`;
    searchEmpty.hidden = matches.length > 0;
  }
  function selectView(view) {
    state.view = view;
    viewTabs.forEach(tab => {
      const selected = tab.dataset.view === view;
      document.getElementById(tab.getAttribute("aria-controls")).hidden = !selected;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    if (detail.open) detail.close();
    if (view === "search") renderSearch();
    if (view === "ranking") selectCategory(state.category);
  }
  function wireTabs(buttons) {
    buttons.forEach((tab, index) => tab.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus();
      buttons[next].click();
    }));
  }
  viewTabs.forEach(tab => tab.addEventListener("click", () => {
    selectView(tab.dataset.view);
    saveListState();
  }));
  wireTabs(viewTabs);
  search.value = state.q;
  search.addEventListener("input", () => {
    state.q = search.value;
    renderSearch();
    saveListState();
  });
  function showPairDetail(entry, button) {
    opener = button;
    document.querySelector("#detail-heading").textContent = `${entry.lyricist_name} × ${entry.composer_name}`;
    document.querySelector("#detail-summary").textContent = `作詞 × 作曲・${entry.work_count}曲`;
    document.querySelector("#work-list").replaceChildren(...entry.works.map(work => {
      const li = document.createElement("li");
      const title = document.createElement("span");
      title.textContent = work.title;
      li.append(title);
      return li;
    }));
    detail.showModal();
    document.querySelector("#close-detail").focus();
  }
  function createCard(entry, action, pair = false) {
    const card = document.createElement("article");
    card.className = `card ranking-card${entry.rank <= 3 ? " top" : ""}`;
    const rank = document.createElement("span");
    rank.className = "rank";
    rank.textContent = `${entry.rank}位`;
    const name = document.createElement(pair ? "button" : "a");
    name.className = "name";
    name.textContent = pair ? `${entry.lyricist_name} × ${entry.composer_name}` : entry.creator_name;
    if (pair) {
      name.type = "button";
      name.setAttribute("aria-label", `${name.textContent}、${entry.work_count}曲の集計根拠を表示`);
      name.addEventListener("click", () => action(name));
    } else {
      name.href = creatorUrl(entry.creator_id);
    }
    const count = document.createElement("span");
    count.className = "count";
    const number = document.createElement("strong");
    number.textContent = entry.work_count;
    count.append(number, " 曲");
    const id = document.createElement("small");
    id.className = "creator-id";
    id.textContent = pair ? `${entry.lyricist_creator_id} × ${entry.composer_creator_id}` : entry.creator_id;
    card.append(rank, name, count, id);
    return card;
  }
  function selectCategory(categoryId) {
    state.category = categoryId;
    const category = data.categories[categoryId];
    heading.textContent = `${category.label}ランキング`;
    summary.textContent = category.entries.length
      ? `${category.entries.length}作家 / 延べ${category.entries.reduce((total, entry) => total + entry.work_count, 0)}曲（作家ごとの曲数の合計）`
      : "表示できるデータがありません。";
    for (const button of tabs.children) {
      const selected = button.dataset.category === categoryId;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    document.querySelector("#category-panel").setAttribute("aria-labelledby", `category-${categoryId}`);
    ranking.replaceChildren(...category.entries.map(entry => createCard(entry)));
  }
  for (const categoryId of categoryIds) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tab";
    button.id = `category-${categoryId}`;
    button.dataset.category = categoryId;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", "category-panel");
    button.textContent = data.categories[categoryId].label;
    button.addEventListener("click", () => {
      selectCategory(categoryId);
      saveListState();
    });
    tabs.append(button);
  }
  wireTabs([...tabs.children]);
  selectView(state.view);
  document.querySelector("#close-detail").addEventListener("click", () => detail.close());
  detail.addEventListener("close", () => opener?.focus());
  detail.addEventListener("keydown", event => {
    if (event.key === "Tab") {
      // The dialog contains only one interactive control.
      event.preventDefault();
      document.querySelector("#close-detail").focus();
    }
  });
  const pairEntries = pairError ? [] : data.lyrics_composition_pairs?.entries ?? [];
  const lyricsCheck = document.querySelector("#pair-lyrics");
  const compositionCheck = document.querySelector("#pair-composition");
  const pairCreator = document.querySelector("#pair-creator");
  const creatorList = document.querySelector("#pair-creator-options");
  const pairRanking = document.querySelector("#pair-ranking");

  let creatorOptions = [];
  let visibleCreatorOptions = [];
  let selectedCreatorId = "";
  let activeOptionIndex = -1;

  const creatorLabel = ([id, name]) => `${name}（${id}）`;

  function setActiveOption(index) {
    activeOptionIndex = index;
    for (const [optionIndex, option] of [...creatorList.children].entries()) {
      const active = optionIndex === index && visibleCreatorOptions.length > 0;
      option.classList.toggle("active", active);
      option.setAttribute("aria-selected", String(active));
    }
    if (index < 0 || visibleCreatorOptions.length === 0) {
      pairCreator.removeAttribute("aria-activedescendant");
    } else {
      const option = creatorList.children[index];
      pairCreator.setAttribute("aria-activedescendant", option.id);
      option.scrollIntoView({ block: "nearest" });
    }
  }

  function renderCreatorOptions(query = "") {
    const search = query.normalize("NFKC").trim().toLocaleLowerCase("ja");
    visibleCreatorOptions = creatorOptions.filter(([id, name]) =>
      name.normalize("NFKC").toLocaleLowerCase("ja").includes(search) || id.toLocaleLowerCase("ja").includes(search));
    creatorList.replaceChildren(...visibleCreatorOptions.map(([id, name]) => {
      const option = document.createElement("li");
      option.id = `pair-creator-option-${id}`;
      option.className = "creator-option";
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");
      option.textContent = creatorLabel([id, name]);
      option.addEventListener("pointerdown", (event) => event.preventDefault());
      option.addEventListener("click", () => selectCreator(id));
      return option;
    }));
    if (visibleCreatorOptions.length === 0) {
      const empty = document.createElement("li");
      empty.className = "creator-option-empty";
      empty.setAttribute("role", "presentation");
      empty.textContent = "該当する作家がありません";
      creatorList.append(empty);
    }
    document.querySelector("#combo-live").textContent = visibleCreatorOptions.length ? `${visibleCreatorOptions.length}件の候補。上下キーで選びEnterで確定します。` : "該当する作家がありません。選択済みの結果は変更しません。";
    setActiveOption(-1);
    creatorList.hidden = false;
    pairCreator.setAttribute("aria-expanded", "true");
  }

  function closeCreatorOptions(restoreLabel = true) {
    creatorList.hidden = true;
    pairCreator.setAttribute("aria-expanded", "false");
    pairCreator.removeAttribute("aria-activedescendant");
    activeOptionIndex = -1;
    if (restoreLabel && !pairCreator.disabled) {
      const selected = creatorOptions.find(([id]) => id === selectedCreatorId);
      pairCreator.value = selected ? creatorLabel(selected) : "";
    }
  }

  function selectCreator(id) {
    selectedCreatorId = id;
    const selected = creatorOptions.find(([optionId]) => optionId === id);
    pairCreator.value = selected ? creatorLabel(selected) : "";
    pairCreator.focus();
    closeCreatorOptions(false);
    document.querySelector("#combo-live").textContent = `${selected?.[1] ?? ""}を選択しました。`;
    showPairs();
  }

  const creators = new Map();
  for (const entry of pairEntries) {
    creators.set(entry.lyricist_creator_id, entry.lyricist_name);
    creators.set(entry.composer_creator_id, entry.composer_name);
  }
  creatorOptions = [...creators].sort(([left], [right]) => left.localeCompare(right, "en"));

  function resetSelection() {
    selectedCreatorId = "";
    pairCreator.value = "";
    lyricsCheck.checked = false;
    compositionCheck.checked = false;
    closeCreatorOptions(false);
    document.querySelector("#combo-live").textContent = "作家選択を解除しました。";
    showPairs();
  }

  function showPairs() {
    const creatorId = selectedCreatorId;
    const { entries } = analyzeCreatorPairs(pairEntries, creatorId, lyricsCheck.checked, compositionCheck.checked);
    document.querySelector("#pair-summary").textContent = pairError || !data.lyrics_composition_pairs
      ? pairError || "組み合わせデータはまだ生成されていません。"
      : entries.length === 0 ? "条件に一致する組み合わせがありません"
      : `${entries.length}組 / 延べ${entries.reduce((total, entry) => total + entry.work_count, 0)}曲（組み合わせごとの曲数の合計）`;
    lyricsCheck.disabled = compositionCheck.disabled = !creatorId;
    document.querySelector("#pair-condition").hidden = Boolean(pairError || !data.lyrics_composition_pairs);
    const name = creators.get(creatorId);
    const role = lyricsCheck.checked && compositionCheck.checked ? "作詞・作曲の両方"
      : lyricsCheck.checked ? "作詞" : compositionCheck.checked ? "作曲" : "作詞、または作曲";
    document.querySelector("#pair-condition").textContent = creatorId
      ? `${name}が${role}を担当した組み合わせ` : "すべての作詞・作曲ペアを表示しています。";
    pairRanking.replaceChildren(...entries.map((entry) => createCard(entry, button => showPairDetail(entry, button), true)));
  }

  lyricsCheck.addEventListener("change", showPairs);
  compositionCheck.addEventListener("change", showPairs);
  document.querySelector("#pair-clear").addEventListener("click", resetSelection);
  pairCreator.addEventListener("focus", () => {
    if (!pairCreator.disabled) renderCreatorOptions();
  });
  pairCreator.addEventListener("click", () => {
    if (!pairCreator.disabled && creatorList.hidden) renderCreatorOptions();
  });
  pairCreator.addEventListener("input", () => {
    if (pairCreator.value === "") resetSelection();
    else renderCreatorOptions(pairCreator.value);
  });
  let composing = false;
  pairCreator.addEventListener("compositionstart", () => { composing = true; });
  pairCreator.addEventListener("compositionend", () => { composing = false; });
  pairCreator.addEventListener("keydown", (event) => {
    if (composing || event.isComposing || event.keyCode === 229) return;
    if (event.key === "Tab") {
      closeCreatorOptions();
      return;
    }
    if (event.key === "Escape") {
      if (!creatorList.hidden) {
        event.preventDefault();
        closeCreatorOptions();
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (creatorList.hidden) renderCreatorOptions();
      if (visibleCreatorOptions.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = activeOptionIndex < 0
        ? (step === 1 ? 0 : visibleCreatorOptions.length - 1)
        : (activeOptionIndex + step + visibleCreatorOptions.length) % visibleCreatorOptions.length;
      setActiveOption(next);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (!creatorList.hidden && activeOptionIndex >= 0) selectCreator(visibleCreatorOptions[activeOptionIndex][0]);
      else document.querySelector("#combo-live").textContent = "候補一覧から作家を選択してください。";
    }
  });
  pairCreator.addEventListener("blur", () => {
    setTimeout(() => {
      if (!document.querySelector(".creator-combobox").contains(document.activeElement)) closeCreatorOptions();
    }, 0);
  });
  if (pairError || !data.lyrics_composition_pairs) {
    document.querySelector(".pair-controls").hidden = true;
  }
  resetSelection();

  document.addEventListener("pointerdown", (event) => {
    if (!document.querySelector(".creator-combobox").contains(event.target)) closeCreatorOptions();
  });
}
