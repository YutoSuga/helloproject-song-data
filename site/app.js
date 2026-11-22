import { analyzeCreatorPairs } from "./pair-analysis.js";

const status = document.querySelector("#data-status");
try {
  const response = await fetch(new URL("./data/rankings/G00001.json", import.meta.url));
  if (!response.ok) throw new Error(`Ranking data: ${response.status}`);
  const data = await response.json();
  // Only validate the public reader contract. CSV validation stays in the build.
  for (const id of ["lyrics", "composition", "lyrics_composition", "lyrics_or_composition", "arrangement"]) {
    const category = data.categories?.[id];
    if (typeof category?.label !== "string" || !Array.isArray(category.entries)) throw new Error("Invalid ranking category");
    for (const entry of category.entries) {
      if (typeof entry.creator_name !== "string" || typeof entry.creator_id !== "string" ||
          !Number.isInteger(entry.rank) || !Number.isInteger(entry.work_count) || !Array.isArray(entry.works) ||
          entry.works.some(work => !work || typeof work.title !== "string")) throw new Error("Invalid ranking entry");
    }
  }
  let pairError = "";
  if (data.lyrics_composition_pairs && (!Array.isArray(data.lyrics_composition_pairs.entries) ||
      data.lyrics_composition_pairs.entries.some(entry => !entry || !Number.isInteger(entry.work_count) || !Number.isInteger(entry.rank) ||
      typeof entry.lyricist_creator_id !== "string" || typeof entry.composer_creator_id !== "string" ||
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
  const rankingPanel = document.querySelector("#ranking-panel");
  const pairPanel = document.querySelector("#pair-panel");
  let opener;
  function selectView(view) {
    const showRanking = view === "ranking";
    rankingPanel.hidden = !showRanking;
    pairPanel.hidden = showRanking;
    viewTabs.forEach((tab, index) => {
      const selected = index === (showRanking ? 0 : 1);
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    if (detail.open) detail.close();
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
  viewTabs.forEach((tab, index) => tab.addEventListener("click", () => selectView(index === 0 ? "ranking" : "pairs")));
  wireTabs(viewTabs);
  selectView("ranking");
  function showWorks(name, text, works, button) {
    opener = button;
    document.querySelector("#detail-heading").textContent = name;
    document.querySelector("#detail-summary").textContent = text;
    document.querySelector("#work-list").replaceChildren(...works.map(work => {
      const li = document.createElement("li");
      li.textContent = work.title;
      return li;
    }));
    detail.showModal();
    document.querySelector("#close-detail").focus();
  }
  function showDetail(entry, category, button) {
    showWorks(entry.creator_name, `${category.label}・${entry.work_count}曲`, entry.works, button);
  }
  function showPairDetail(entry, button) {
    showWorks(`${entry.lyricist_name} × ${entry.composer_name}`, `作詞 × 作曲・${entry.work_count}曲`, entry.works, button);
  }
  function createCard(entry, action, pair = false) {
    const card = document.createElement("article");
    card.className = `card ranking-card${entry.rank <= 3 ? " top" : ""}`;
    const rank = document.createElement("span");
    rank.className = "rank";
    rank.textContent = `${entry.rank}位`;
    const name = document.createElement("button");
    name.type = "button";
    name.className = "name";
    name.textContent = pair ? `${entry.lyricist_name} × ${entry.composer_name}` : entry.creator_name;
    name.setAttribute("aria-label", `${name.textContent}、${entry.work_count}曲の集計根拠を表示`);
    name.addEventListener("click", () => action(name));
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
    ranking.replaceChildren(...category.entries.map(entry => createCard(entry, button => showDetail(entry, category, button))));
  }
  for (const [categoryId, category] of Object.entries(data.categories)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tab";
    button.id = `category-${categoryId}`;
    button.dataset.category = categoryId;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", "category-panel");
    button.textContent = category.label;
    button.addEventListener("click", () => selectCategory(categoryId));
    tabs.append(button);
  }
  wireTabs([...tabs.children]);
  selectCategory("lyrics");
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
  const pairDirection = document.querySelector("#pair-direction");
  const pairCreator = document.querySelector("#pair-creator");
  const creatorList = document.querySelector("#pair-creator-options");
  const pairRanking = document.querySelector("#pair-ranking");
  const pairSelfCount = document.querySelector("#pair-self-count");
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

  function selectPairDirection() {
    const direction = pairDirection.value;
    const previousId = selectedCreatorId;
    const creators = new Map();
    if (direction !== "all") {
      for (const entry of pairEntries) {
        const id = direction === "lyricist" ? entry.lyricist_creator_id : entry.composer_creator_id;
        const name = direction === "lyricist" ? entry.lyricist_name : entry.composer_name;
        creators.set(id, name);
      }
    }
    creatorOptions = [...creators].sort(([left], [right]) => left.localeCompare(right, "en"));
    selectedCreatorId = direction === "all" ? previousId : creators.has(previousId) ? previousId : "";
    pairCreator.disabled = direction === "all";
    pairCreator.placeholder = direction === "all" ? "担当を選択してください" : "作家名またはIDで検索";
    const selected = creatorOptions.find(([id]) => id === selectedCreatorId);
    pairCreator.value = selected ? creatorLabel(selected) : "";
    closeCreatorOptions(false);
    showPairs();
  }

  function showPairs() {
    const direction = pairDirection.value;
    const creatorId = selectedCreatorId;
    const { entries, self_work_count: selfCount } = analyzeCreatorPairs(pairEntries, creatorId, direction);
    document.querySelector("#pair-summary").textContent = pairError || !data.lyrics_composition_pairs
      ? pairError || "組み合わせデータはまだ生成されていません。"
      : direction !== "all" && !creatorId ? "作家を検索・選択してください。"
      : `${entries.length}組 / 延べ${entries.reduce((total, entry) => total + entry.work_count, 0)}曲（組み合わせごとの曲数の合計）`;
    pairSelfCount.hidden = direction === "all" || !creatorId;
    if (!pairSelfCount.hidden) {
      pairSelfCount.textContent = `自作詞・自作曲：${selfCount}作品`;
    }
    pairRanking.replaceChildren(...entries.map((entry) => createCard(entry, button => showPairDetail(entry, button), true)));
  }

  pairDirection.addEventListener("change", selectPairDirection);
  pairCreator.addEventListener("focus", () => {
    if (!pairCreator.disabled) renderCreatorOptions();
  });
  pairCreator.addEventListener("click", () => {
    if (!pairCreator.disabled && creatorList.hidden) renderCreatorOptions();
  });
  pairCreator.addEventListener("input", () => renderCreatorOptions(pairCreator.value));
  pairCreator.addEventListener("keydown", (event) => {
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
  selectPairDirection();

  document.addEventListener("pointerdown", (event) => {
    if (!document.querySelector(".creator-combobox").contains(event.target)) closeCreatorOptions();
  });
}
