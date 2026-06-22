const state = {
  manifest: null,
  chunkCache: new Map(),
  allStories: null,
  searchResults: null,
};

const els = {
  totalStories: document.querySelector("#totalStories"),
  pageStatus: document.querySelector("#pageStatus"),
  firstPage: document.querySelector("#firstPage"),
  prevPage: document.querySelector("#prevPage"),
  nextPage: document.querySelector("#nextPage"),
  lastPage: document.querySelector("#lastPage"),
  storyList: document.querySelector("#storyList"),
  loading: document.querySelector("#loading"),
  error: document.querySelector("#error"),
  yearForm: document.querySelector("#yearForm"),
  yearInput: document.querySelector("#yearInput"),
  searchForm: document.querySelector("#searchForm"),
  searchInput: document.querySelector("#searchInput"),
  searchHint: document.querySelector("#searchHint"),
  topRecommendations: document.querySelector("#topRecommendations"),
  recommendationScope: document.querySelector("#recommendationScope"),
  backToTop: document.querySelector("#backToTop"),
};

function parseHash() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  return {
    page: Number(params.get("page") || 1),
    year: Number(params.get("year") || 0),
    q: params.get("q") || "",
  };
}

function setHash(next) {
  const params = new URLSearchParams();
  if (next.page) params.set("page", String(next.page));
  if (next.year) params.set("year", String(next.year));
  if (next.q) params.set("q", next.q);
  window.location.hash = params.toString();
}

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}: ${response.status}`);
  }
  return response.json();
}

async function loadChunk(file) {
  if (!state.chunkCache.has(file)) {
    state.chunkCache.set(file, fetchJson(`chunks/${file}`));
  }
  return state.chunkCache.get(file);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function domainFor(url) {
  if (!url) return "news.ycombinator.com";
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const parts = host.split(".");
    const sliceAt = host.includes(".co.") ? -3 : -2;
    return parts.slice(sliceAt).join(".");
  } catch {
    return "";
  }
}

function storyUrl(story) {
  return story.url || `https://news.ycombinator.com/item?id=${story.objectID}`;
}

async function loadAllStories() {
  if (!state.allStories) {
    const chunks = await Promise.all(state.manifest.chunks.map((chunk) => loadChunk(chunk.file)));
    state.allStories = chunks.flat();
  }
  return state.allStories;
}

function hnItemUrl(story) {
  return `https://news.ycombinator.com/item?id=${story.objectID}`;
}

function formatDate(value) {
  if (!value) return "unknown date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown date";
  return date.toLocaleDateString("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function updatePager(page) {
  const totalPages = state.manifest.totalPages;
  const safePage = Math.max(1, Math.min(totalPages, page));
  const previous = Math.max(1, safePage - 1);
  const next = Math.min(totalPages, safePage + 1);

  els.firstPage.href = "#page=1";
  els.prevPage.href = `#page=${previous}`;
  els.nextPage.href = `#page=${next}`;
  els.lastPage.href = `#page=${totalPages}`;
  els.pageStatus.textContent = `第 ${safePage} / ${totalPages} 页`;

  setDisabled(els.firstPage, safePage === 1);
  setDisabled(els.prevPage, safePage === 1);
  setDisabled(els.nextPage, safePage === totalPages);
  setDisabled(els.lastPage, safePage === totalPages);
}

function setDisabled(element, disabled) {
  element.setAttribute("aria-disabled", disabled ? "true" : "false");
}

function renderStories(stories) {
  const grouped = new Map();
  for (const story of stories) {
    if (!grouped.has(story.year)) grouped.set(story.year, []);
    grouped.get(story.year).push(story);
  }

  let html = "";
  for (const [year, yearStories] of grouped) {
    html += `<section class="year-group" id="year-${year}">`;
    html += `<h2 class="year-label">${year}</h2>`;
    html += '<div class="year-stories">';
    yearStories.forEach((story, index) => {
      const url = storyUrl(story);
      const domain = domainFor(url);
      const itemUrl = hnItemUrl(story);
      const primaryTitle = story.title_zh || story.title;
      const secondaryTitle = story.title_zh ? story.title : "";
      html += `
        <article class="story">
          <div class="story__rank">${index + 1}</div>
          <div>
            <a class="story__title" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(primaryTitle)}</a>
            ${domain ? `<span class="story__domain">(${escapeHtml(domain)})</span>` : ""}
            ${secondaryTitle ? `<span class="story__title-en">${escapeHtml(secondaryTitle)}</span>` : ""}
            <div class="story__meta">
              ${escapeHtml(story.points)} points by
              <a href="https://news.ycombinator.com/user?id=${escapeHtml(story.author)}" target="_blank" rel="noreferrer">${escapeHtml(story.author || "unknown")}</a>
              on <a href="${escapeHtml(itemUrl)}" target="_blank" rel="noreferrer">${formatDate(story.created_at)}</a>
              · <a href="${escapeHtml(itemUrl)}" target="_blank" rel="noreferrer">${escapeHtml(story.num_comments)} comments</a>
            </div>
          </div>
        </article>
      `;
    });
    html += "</div></section>";
  }
  els.storyList.innerHTML = html;
}

function renderTopRecommendations(stories, label) {
  const top = [...stories]
    .sort((a, b) => Number(b.points || 0) - Number(a.points || 0))
    .slice(0, 5);
  els.recommendationScope.textContent = label;
  els.topRecommendations.innerHTML = top.map((story, index) => {
    const title = story.title_zh || story.title;
    const titleEn = story.title_zh ? story.title : "";
    return `
      <article class="top-card">
        <div class="top-card__rank">#${index + 1}</div>
        <a href="${escapeHtml(storyUrl(story))}" target="_blank" rel="noreferrer">${escapeHtml(title)}</a>
        ${titleEn ? `<span class="top-card__en">${escapeHtml(titleEn)}</span>` : ""}
        <div class="top-card__meta">${escapeHtml(story.year)} · ${escapeHtml(story.points)} points</div>
      </article>
    `;
  }).join("");
}

function searchableText(story) {
  return [
    story.title,
    story.title_zh,
    story.story_text,
    story.comment_text,
    story.year,
    story.points,
    storyUrl(story),
    domainFor(storyUrl(story)),
  ].filter(Boolean).join(" ").toLowerCase();
}

async function runSearch(query) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return null;
  const stories = await loadAllStories();
  return stories
    .filter((story) => {
      const haystack = searchableText(story);
      return terms.every((term) => haystack.includes(term));
    })
    .sort((a, b) => (
      Number(b.year || 0) - Number(a.year || 0)
      || Number(b.points || 0) - Number(a.points || 0)
      || String(a.title || "").localeCompare(String(b.title || ""))
    ));
}

function findPageForYear(year) {
  return state.manifest.chunks.findIndex(
    (chunk) => year >= chunk.yearStart && year <= chunk.yearEnd,
  ) + 1;
}

async function renderRoute() {
  if (!state.manifest) return;
  const { page, year, q } = parseHash();
  els.searchInput.value = q;
  if (q) {
    els.loading.hidden = false;
    els.error.hidden = true;
    setDisabled(els.firstPage, true);
    setDisabled(els.prevPage, true);
    setDisabled(els.nextPage, true);
    setDisabled(els.lastPage, true);
    els.pageStatus.textContent = "搜索模式";
    try {
      const results = await runSearch(q);
      renderStories(results);
      renderTopRecommendations(results, `搜索 “${q}” 的最高分 5 篇。`);
      els.searchHint.textContent = `找到 ${results.length.toLocaleString()} 条结果。搜索覆盖标题、中文标题、URL/域名、年份和 HN 文本字段。`;
      els.loading.hidden = true;
      window.scrollTo({ top: 0, behavior: "instant" });
    } catch (error) {
      els.loading.hidden = true;
      els.error.hidden = false;
      els.error.textContent = error.message;
    }
    return;
  }

  const safePage = Math.max(1, Math.min(state.manifest.totalPages, page || 1));
  const chunk = state.manifest.chunks[safePage - 1];

  els.loading.hidden = false;
  els.error.hidden = true;
  updatePager(safePage);

  try {
    const stories = await loadChunk(chunk.file);
    renderStories(stories);
    const recommendationYear = year || chunk.yearStart;
    const allStories = await loadAllStories();
    const yearStories = allStories.filter((story) => Number(story.year) === Number(recommendationYear));
    renderTopRecommendations(yearStories, `${recommendationYear} 年最高分的 5 篇。`);
    els.searchHint.textContent = "输入关键词后会搜索全库标题、中文标题、URL/域名、年份和 HN 文本字段。";
    els.loading.hidden = true;
    if (year) {
      document.querySelector(`#year-${year}`)?.scrollIntoView({ block: "start" });
    } else {
      window.scrollTo({ top: 0, behavior: "instant" });
    }
  } catch (error) {
    els.loading.hidden = true;
    els.error.hidden = false;
    els.error.textContent = error.message;
  }
}

async function init() {
  try {
    state.manifest = await fetchJson("chunks/manifest.json");
    els.totalStories.textContent = state.manifest.total.toLocaleString();
    els.yearInput.min = state.manifest.startYear;
    els.yearInput.max = state.manifest.endYear;
    els.yearInput.placeholder = `${state.manifest.startYear}-${state.manifest.endYear}`;
    await renderRoute();
  } catch (error) {
    els.loading.hidden = true;
    els.error.hidden = false;
    els.error.textContent = error.message;
  }
}

els.yearForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const year = Number(els.yearInput.value);
  if (!year || !state.manifest) return;
  const page = findPageForYear(year);
  if (!page) {
    els.error.hidden = false;
    els.error.textContent = `没有找到 ${year} 年的数据。`;
    return;
  }
  setHash({ page, year });
});

els.searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const q = els.searchInput.value.trim();
  setHash(q ? { q } : { page: 1 });
});

els.backToTop.addEventListener("click", () => {
  document.querySelector("#top").scrollIntoView({ behavior: "auto", block: "start" });
  els.searchInput.focus({ preventScroll: true });
});

window.addEventListener("scroll", () => {
  els.backToTop.classList.toggle("is-visible", window.scrollY > 520);
}, { passive: true });

window.addEventListener("hashchange", renderRoute);

init();
