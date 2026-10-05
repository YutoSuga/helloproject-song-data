const data = await fetch("./data/rankings/G00001.json").then((response) => {
  if (!response.ok) throw new Error(`Ranking data: ${response.status}`);
  return response.json();
});

const tabs = document.querySelector("#category-tabs");
const ranking = document.querySelector("#ranking");
const heading = document.querySelector("#ranking-heading");
const summary = document.querySelector("#summary");
const detail = document.querySelector("#creator-detail");
document.querySelector("#artist-name").textContent = data.artist.name;

function showDetail(entry, category) {
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
