(() => {
  "use strict";

  if (window.__hhCoverLetterLoaded) return;
  window.__hhCoverLetterLoaded = true;

  const SELECTORS = {
    title: ["[data-qa='vacancy-title']", "h1"],
    company: ["[data-qa='vacancy-company-name']", "[data-qa='vacancy-company-name'] a"],
    description: ["[data-qa='vacancy-description']", ".vacancy-description"],
    skills: ["[data-qa='skills-element']", "[data-qa='bloko-tag__text']"],
    letter: [
      "textarea[data-qa='vacancy-response-letter-input']",
      "textarea[data-qa='vacancy-response-popup-form-letter-input']",
      "textarea[data-qa*='response-letter']",
      "textarea[data-qa*='letter']",
      "textarea[name='letter']"
    ]
  };

  function firstText(selectors, root = document) {
    for (const selector of selectors) {
      const text = root.querySelector(selector)?.textContent?.replace(/\s+/g, " ").trim();
      if (text) return text;
    }
    return "";
  }

  function allTexts(selectors, root = document) {
    const values = selectors.flatMap((selector) =>
      [...root.querySelectorAll(selector)].map((element) => element.textContent?.replace(/\s+/g, " ").trim())
    );
    return [...new Set(values.filter(Boolean))];
  }

  function getVacancy(root = document, url = location.href) {
    return {
      url,
      title: firstText(SELECTORS.title, root),
      company: firstText(SELECTORS.company, root),
      description: firstText(SELECTORS.description, root),
      skills: allTexts(SELECTORS.skills, root)
    };
  }

  function getVacancyId() {
    const url = new URL(location.href);
    const pathId = url.pathname.match(/^\/vacancy\/(\d+)/)?.[1];
    const queryId = url.searchParams.get("vacancyId");
    const id = pathId || queryId;
    return /^\d+$/.test(id || "") ? id : "";
  }

  function isCompleteVacancy(vacancy) {
    return Boolean(vacancy?.title && vacancy?.description);
  }

  async function cacheVacancy(id, vacancy) {
    if (!id || !isCompleteVacancy(vacancy)) return;
    const { vacancyCache = {} } = await chrome.storage.local.get("vacancyCache");
    vacancyCache[id] = { ...vacancy, savedAt: Date.now() };
    const recentEntries = Object.entries(vacancyCache)
      .sort(([, a], [, b]) => (b.savedAt || 0) - (a.savedAt || 0))
      .slice(0, 20);
    await chrome.storage.local.set({ vacancyCache: Object.fromEntries(recentEntries) });
  }

  async function getCachedVacancy(id) {
    if (!id) return null;
    const { vacancyCache = {} } = await chrome.storage.local.get("vacancyCache");
    return vacancyCache[id] || null;
  }

  async function fetchVacancy(id) {
    if (!id) return null;
    try {
      const url = `https://hh.ru/vacancy/${id}`;
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) return null;
      const root = new DOMParser().parseFromString(await response.text(), "text/html");
      const vacancy = getVacancy(root, url);
      return isCompleteVacancy(vacancy) ? vacancy : null;
    } catch {
      return null;
    }
  }

  async function resolveVacancy() {
    const id = getVacancyId();
    const pageVacancy = getVacancy();
    if (isCompleteVacancy(pageVacancy)) {
      await cacheVacancy(id, pageVacancy);
      return { vacancy: pageVacancy, source: "page" };
    }

    const cachedVacancy = await getCachedVacancy(id);
    if (isCompleteVacancy(cachedVacancy)) return { vacancy: cachedVacancy, source: "cache" };

    const fetchedVacancy = await fetchVacancy(id);
    if (fetchedVacancy) {
      await cacheVacancy(id, fetchedVacancy);
      return { vacancy: fetchedVacancy, source: "vacancy-page" };
    }
    return { vacancy: pageVacancy, source: "page" };
  }

  function findVisibleLetterField() {
    for (const selector of SELECTORS.letter) {
      const field = [...document.querySelectorAll(selector)].find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      if (field) return field;
    }
    return null;
  }

  function insertLetter(letter) {
    const field = findVisibleLetterField();
    if (!field || !letter) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (setter) setter.call(field, letter);
    else field.value = letter;
    field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: letter }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    field.focus();
    field.setSelectionRange(letter.length, letter.length);
    return true;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "GET_VACANCY") {
      resolveVacancy()
        .then(({ vacancy, source }) => sendResponse({ ok: isCompleteVacancy(vacancy), vacancy, source }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    if (message.type === "INSERT_LETTER") {
      sendResponse({ ok: true, inserted: insertLetter(message.letter || "") });
    }
    return false;
  });

  if (location.pathname.startsWith("/vacancy/")) {
    cacheVacancy(getVacancyId(), getVacancy()).catch(() => {});
  }
})();
