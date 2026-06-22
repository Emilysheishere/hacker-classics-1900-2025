const state = {
  manifest: null,
  chunkCache: new Map(),
  allStories: null,
  searchResults: null,
  visibleStories: [],
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
  pawLayer: document.querySelector("#pawLayer"),
  shibaCompanion: document.querySelector("#shibaCompanion"),
  shibaButton: document.querySelector("#shibaButton"),
  shibaBubble: document.querySelector("#shibaBubble"),
  shibaBubbleText: document.querySelector("#shibaBubbleText"),
  shibaBubbleLink: document.querySelector("#shibaBubbleLink"),
};

const shibaState = {
  lastPawAt: 0,
  bubbleTimer: null,
  isPointerFine: window.matchMedia("(hover: hover) and (pointer: fine)").matches,
  lastRecommendedAt: 0,
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
  state.visibleStories = stories;
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

function setShibaBubble(text, story = null) {
  if (!els.shibaBubble || !els.shibaBubbleText) return;
  els.shibaBubbleText.textContent = text;
  if (story && els.shibaBubbleLink) {
    els.shibaBubbleLink.hidden = false;
    els.shibaBubbleLink.href = storyUrl(story);
  } else if (els.shibaBubbleLink) {
    els.shibaBubbleLink.hidden = true;
    els.shibaBubbleLink.removeAttribute("href");
  }
  els.shibaBubble.hidden = false;
  window.clearTimeout(shibaState.bubbleTimer);
  shibaState.bubbleTimer = window.setTimeout(() => {
    els.shibaBubble.hidden = true;
  }, story ? 7600 : 3600);
}

function leavePawPrint(x, y, force = false) {
  if (!els.pawLayer || !shibaState.isPointerFine) return;
  const now = Date.now();
  if (!force && now - shibaState.lastPawAt < 520) return;
  shibaState.lastPawAt = now;

  const paw = document.createElement("span");
  paw.className = "paw-print";
  paw.style.left = `${x}px`;
  paw.style.top = `${y}px`;
  paw.style.setProperty("--paw-rotate", `${Math.round(Math.random() * 42 - 21)}deg`);
  paw.style.setProperty("--paw-size", `${Math.round(24 + Math.random() * 18)}px`);
  els.pawLayer.appendChild(paw);
  paw.addEventListener("animationend", () => paw.remove(), { once: true });
}

function updateShibaPosition(event) {
  if (!els.shibaCompanion || !shibaState.isPointerFine) return;
  const currentRect = els.shibaButton?.getBoundingClientRect();
  if (currentRect) {
    const centerX = currentRect.left + currentRect.width / 2;
    const centerY = currentRect.top + currentRect.height / 2;
    const distance = Math.hypot(event.clientX - centerX, event.clientY - centerY);
    if (distance < 150) {
      leavePawPrint(event.clientX, event.clientY);
      return;
    }
  }
  const xRatio = (event.clientX / window.innerWidth - 0.5) * 2;
  const yRatio = (event.clientY / window.innerHeight - 0.5) * 2;
  const companionWidth = 118;
  const companionHeight = 118;
  const offsetX = event.clientX < window.innerWidth - 220 ? 58 : -150;
  const offsetY = event.clientY < window.innerHeight - 190 ? 40 : -142;
  const left = Math.max(12, Math.min(window.innerWidth - companionWidth - 12, event.clientX + offsetX));
  const top = Math.max(12, Math.min(window.innerHeight - companionHeight - 12, event.clientY + offsetY));
  els.shibaCompanion.style.setProperty("--shiba-left", `${Math.round(left)}px`);
  els.shibaCompanion.style.setProperty("--shiba-top", `${Math.round(top)}px`);
  els.shibaCompanion.style.setProperty("--shiba-x", `${Math.round(xRatio * 4)}px`);
  els.shibaCompanion.style.setProperty("--shiba-y", `${Math.round(yRatio * 3)}px`);
  els.shibaCompanion.style.setProperty("--shiba-tilt", `${(xRatio * -5).toFixed(1)}deg`);
  leavePawPrint(event.clientX, event.clientY);
}

function recommendFromShiba() {
  const now = Date.now();
  if (now - shibaState.lastRecommendedAt < 900 && !els.shibaBubble?.hidden) return;
  shibaState.lastRecommendedAt = now;
  const pool = state.visibleStories.length ? state.visibleStories : (state.allStories || []);
  if (!pool.length) {
    setShibaBubble("档案还没打开，等我闻一闻数据味道。");
    return;
  }
  const shortlist = [...pool]
    .sort((a, b) => Number(b.points || 0) - Number(a.points || 0))
    .slice(0, Math.min(40, pool.length));
  const story = shortlist[Math.floor(Math.random() * shortlist.length)];
  const title = story.title_zh || story.title;
  setShibaBubble(`你的小可爱叼来一篇：${title}`, story);
}

function hideShibaBubbleSoon() {
  window.clearTimeout(shibaState.bubbleTimer);
  shibaState.bubbleTimer = window.setTimeout(() => {
    if (els.shibaBubble) els.shibaBubble.hidden = true;
  }, 900);
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

window.addEventListener("pointermove", updateShibaPosition, { passive: true });
window.addEventListener("pointerdown", (event) => {
  leavePawPrint(event.clientX, event.clientY, true);
}, { passive: true });

els.shibaButton?.addEventListener("pointerenter", (event) => {
  const rect = els.shibaButton.getBoundingClientRect();
  leavePawPrint(rect.left + rect.width * 0.42, rect.top + rect.height * 0.72, true);
  recommendFromShiba();
});

els.shibaButton?.addEventListener("pointerleave", hideShibaBubbleSoon);
els.shibaBubble?.addEventListener("pointerenter", () => {
  window.clearTimeout(shibaState.bubbleTimer);
});
els.shibaBubble?.addEventListener("pointerleave", hideShibaBubbleSoon);
els.shibaButton?.addEventListener("focus", recommendFromShiba);
els.shibaButton?.addEventListener("blur", hideShibaBubbleSoon);
els.shibaButton?.addEventListener("click", (event) => {
  event.preventDefault();
  event.currentTarget.blur();
});

window.addEventListener("scroll", () => {
  els.backToTop.classList.toggle("is-visible", window.scrollY > 520);
}, { passive: true });

window.addEventListener("hashchange", renderRoute);

init();
