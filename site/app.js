import { analyzeCreatorPairs } from "./pair-analysis.js";

const data = await fetch("./data/rankings/G00001.json").then((response) => {
  if (!response.ok) throw new Error(`Ranking data: ${response.status}`);
  return response.json();
});

const tabs = document.querySelector("#category-tabs");
const ranking = document.querySelector("#ranking");
const heading = document.querySelector("#ranking-heading");
const summary = document.querySelector("#summary");
const detail = document.querySelector("#creator-detail");
const viewTabs = [...document.querySelectorAll(".view-tab")];
const rankingPanel = document.querySelector("#ranking-panel");
const pairPanel = document.querySelector("#pair-panel");
document.querySelector("#artist-name").textContent = data.artist.name;

function selectView(view) {
  const showRanking = view === "ranking";
  rankingPanel.hidden = !showRanking;
  pairPanel.hidden = showRanking;
  for (const tab of viewTabs) {
    const selected = tab.id === (showRanking ? "view-ranking-tab" : "view-pairs-tab");
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  detail.hidden = true;
}

viewTabs.forEach((tab, index) => {
  tab.addEventListener("click", () => selectView(index === 0 ? "ranking" : "pairs"));
  tab.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? viewTabs.length - 1
      : (index + (event.key === "ArrowRight" ? 1 : -1) + viewTabs.length) % viewTabs.length;
    viewTabs[next].focus();
    selectView(next === 0 ? "ranking" : "pairs");
  });
});
selectView("ranking");

function showDetail(entry, category) {
  document.querySelector("#pair-detail-role").hidden = true;
  document.querySelector("#detail-heading").textContent = entry.creator_name;
  document.querySelector("#detail-summary").textContent = `${category.label}・${entry.work_count}作品（${entry.creator_id}）`;
  document.querySelector("#work-list").replaceChildren(...entry.works.map((work) => {
    const item = document.createElement("li");
    const title = document.createElement("strong");
    title.textContent = work.title;
    const evidence = document.createElement("div");
    evidence.className = "evidence";
    evidence.textContent = `song: ${work.song_ids.join(", ")} / role: ${work.roles.join(" + ")}`;
    item.append(document.createElement("code"), " ", title, evidence);
    item.querySelector("code").textContent = work.work_id;
    return item;
  }));
  detail.hidden = false;
  document.querySelector("#close-detail").focus();
}

function showPairDetail(entry) {
  document.querySelector("#pair-detail-role").hidden = false;
  document.querySelector("#detail-heading").textContent = `${entry.lyricist_name} × ${entry.composer_name}`;
  document.querySelector("#detail-summary").textContent = `${entry.work_count}作品（作詞 ${entry.lyricist_creator_id} / 作曲 ${entry.composer_creator_id}）`;
  document.querySelector("#work-list").replaceChildren(...entry.works.map((work) => {
    const item = document.createElement("li");
    const id = document.createElement("code");
    id.textContent = work.work_id;
    const title = document.createElement("strong");
    title.textContent = work.title;
    const evidence = document.createElement("div");
    evidence.className = "evidence";
    evidence.textContent = `pairが成立したsong: ${work.song_ids.join(", ")}`;
    item.append(id, " ", title, evidence);
    return item;
  }));
  detail.hidden = false;
  document.querySelector("#close-detail").focus();
}

function selectCategory(categoryId) {
  const category = data.categories[categoryId];
  heading.textContent = `${category.label}ランキング`;
  summary.textContent = `${category.entries.length}作家 / ${category.entries.reduce((total, entry) => total + entry.work_count, 0)} creator-work pairs`;
  for (const button of tabs.children) button.setAttribute("aria-selected", button.dataset.category === categoryId ? "true" : "false");
  ranking.replaceChildren(...category.entries.map((entry) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `creator${entry.rank <= 3 ? " top" : ""}`;
    button.setAttribute("aria-label", `${entry.rank}位 ${entry.creator_name} ${entry.work_count}作品。集計根拠を表示`);
    button.innerHTML = `<span class="rank">${entry.rank}位</span><span><span class="name"></span><br><span class="id"></span></span><span class="count"><strong>${entry.work_count}</strong> 作品</span>`;
    button.querySelector(".name").textContent = entry.creator_name;
    button.querySelector(".id").textContent = entry.creator_id;
    button.addEventListener("click", () => showDetail(entry, category));
    return button;
  }));
}

for (const [categoryId, category] of Object.entries(data.categories)) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "tab";
  button.dataset.category = categoryId;
  button.setAttribute("role", "tab");
  button.textContent = category.label;
  button.addEventListener("click", () => selectCategory(categoryId));
  tabs.append(button);
}
document.querySelector("#close-detail").addEventListener("click", () => { detail.hidden = true; });
selectCategory("lyrics");

const pairEntries = data.lyrics_composition_pairs?.entries ?? [];
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
  const search = query.trim().toLocaleLowerCase();
  visibleCreatorOptions = creatorOptions.filter(([id, name]) =>
    name.toLocaleLowerCase().includes(search) || id.toLocaleLowerCase().includes(search));
  creatorList.replaceChildren(...visibleCreatorOptions.map(([id, name]) => {
    const option = document.createElement("li");
    option.id = `pair-creator-option-${id}`;
    option.className = "creator-option";
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", "false");
    option.textContent = creatorLabel([id, name]);
    option.addEventListener("mousedown", (event) => event.preventDefault());
    option.addEventListener("click", () => selectCreator(id));
    return option;
  }));
  if (visibleCreatorOptions.length === 0) {
    const empty = document.createElement("li");
    empty.className = "creator-option-empty";
    empty.textContent = "該当するCreatorがありません";
    creatorList.append(empty);
  }
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
  selectedCreatorId = creators.has(previousId) ? previousId : creatorOptions[0]?.[0] ?? "";
  pairCreator.disabled = direction === "all";
  pairCreator.placeholder = direction === "all" ? "担当を選択してください" : "Creator名またはIDで検索";
  const selected = creatorOptions.find(([id]) => id === selectedCreatorId);
  pairCreator.value = selected ? creatorLabel(selected) : "";
  closeCreatorOptions(false);
  showPairs();
}

function showPairs() {
  const direction = pairDirection.value;
  const creatorId = selectedCreatorId;
  const { entries, self_work_count: selfCount } = analyzeCreatorPairs(pairEntries, creatorId, direction);
  document.querySelector("#pair-summary").textContent = data.lyrics_composition_pairs
    ? `${entries.length}組 / ${entries.reduce((total, entry) => total + entry.work_count, 0)} pair-work pairs`
    : "組み合わせデータはまだ生成されていません。";
  pairSelfCount.hidden = direction === "all" || !creatorId;
  if (!pairSelfCount.hidden) {
    pairSelfCount.textContent = `自作詞・自作曲：${selfCount}作品`;
  }
  pairRanking.replaceChildren(...entries.map((entry) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `creator${entry.rank <= 3 ? " top" : ""}`;
    button.setAttribute("aria-label", `${entry.rank}位 作詞 ${entry.lyricist_name}、作曲 ${entry.composer_name} ${entry.work_count}作品。集計根拠を表示`);
    const rankText = document.createElement("span");
    rankText.className = "rank";
    rankText.textContent = `${entry.rank}位`;
    const names = document.createElement("span");
    const role = document.createElement("span");
    role.className = "pair-role";
    role.textContent = "作詞 × 作曲";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = `${entry.lyricist_name} × ${entry.composer_name}`;
    const ids = document.createElement("span");
    ids.className = "id";
    ids.textContent = `${entry.lyricist_creator_id} × ${entry.composer_creator_id}`;
    names.append(role, name, ids);
    const count = document.createElement("span");
    count.className = "count";
    const number = document.createElement("strong");
    number.textContent = entry.work_count;
    count.append(number, " 作品");
    button.append(rankText, names, count);
    button.addEventListener("click", () => showPairDetail(entry));
    return button;
  }));
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
  } else if (event.key === "Enter" && !creatorList.hidden && visibleCreatorOptions.length > 0) {
    event.preventDefault();
    selectCreator(visibleCreatorOptions[activeOptionIndex < 0 ? 0 : activeOptionIndex][0]);
  }
});
pairCreator.addEventListener("blur", () => {
  setTimeout(() => {
    if (!document.querySelector(".creator-combobox").contains(document.activeElement)) closeCreatorOptions();
  }, 0);
});
if (!data.lyrics_composition_pairs) {
  document.querySelector(".pair-controls").hidden = true;
}
selectPairDirection();
