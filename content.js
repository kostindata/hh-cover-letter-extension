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

  function createInlineGenerator(field) {
    if (field.__hhCoverGeneratorHost?.isConnected) return;

    const host = document.createElement("div");
    host.dataset.hhCoverGenerator = "true";
    field.__hhCoverGeneratorHost = host;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { display: block; margin: 10px 0; font-family: Arial, sans-serif; }
        .box { display: grid; grid-template-columns: minmax(150px, 1fr) auto; gap: 8px; align-items: end;
          border: 1px solid #ddd; border-radius: 10px; background: #fff; padding: 10px; }
        label { display: grid; gap: 5px; color: #555; font-size: 12px; }
        select, button { min-height: 38px; border: 1px solid #c9c9c9; border-radius: 8px; font: 13px Arial, sans-serif; }
        select { min-width: 0; background: #fff; padding: 0 9px; }
        button { border-color: #d6001c; background: #d6001c; color: #fff; cursor: pointer; padding: 0 16px; font-weight: 700; }
        button:disabled { cursor: wait; opacity: .65; }
        .status { grid-column: 1 / -1; min-height: 15px; color: #666; font-size: 12px; line-height: 1.3; }
        .status.error { color: #b42318; }
        .status.success { color: #167443; }
      </style>
      <div class="box">
        <label>Резюме<select aria-label="Резюме для сопроводительного письма"></select></label>
        <button type="button">Сгенерировать письмо</button>
        <div class="status" role="status"></div>
      </div>`;

    const select = shadow.querySelector("select");
    const button = shadow.querySelector("button");
    const status = shadow.querySelector(".status");
    const setStatus = (text, type = "") => {
      status.textContent = text;
      status.className = `status ${type}`.trim();
    };

    async function loadResumes() {
      const { resumes = [], lastResumeId = "" } = await chrome.storage.local.get(["resumes", "lastResumeId"]);
      select.replaceChildren();
      if (!resumes.length) {
        select.add(new Option("Сначала загрузите резюме в расширение", ""));
        button.disabled = true;
        return;
      }
      for (const resume of resumes) select.add(new Option(resume.name, resume.id));
      select.value = resumes.some((resume) => resume.id === lastResumeId) ? lastResumeId : resumes[0].id;
      button.disabled = false;
    }

    button.addEventListener("click", async () => {
      button.disabled = true;
      setStatus("Генерирую…");
      try {
        const saved = await chrome.storage.local.get(["apiSettings", "resumes", "generationSettings"]);
        const resume = (saved.resumes || []).find((item) => item.id === select.value);
        const provider = saved.apiSettings?.provider;
        const config = saved.apiSettings?.configs?.[provider];
        if (!resume) throw new Error("Выберите загруженное резюме.");
        if (!provider || !config?.apiKey || !config?.model) throw new Error("Сначала настройте API в расширении.");
        const { vacancy } = await resolveVacancy();
        if (!isCompleteVacancy(vacancy)) throw new Error("Не удалось прочитать вакансию.");
        const response = await chrome.runtime.sendMessage({
          type: "GENERATE_WITH_API",
          payload: {
            api: { provider, ...config },
            vacancy,
            resume,
            tone: saved.generationSettings?.tone || "business",
            extraInstructions: saved.generationSettings?.extraInstructions || ""
          }
        });
        if (!response?.ok) throw new Error(response?.error || "API не вернул результат.");
        if (!insertLetter(response.letter)) throw new Error("Поле сопроводительного письма больше не найдено.");
        await chrome.storage.local.set({ lastResumeId: resume.id });
        setStatus("Письмо вставлено в поле. Проверьте текст перед отправкой.", "success");
      } catch (error) {
        setStatus(error.message, "error");
      } finally {
        button.disabled = !select.value;
      }
    });

    field.insertAdjacentElement("afterend", host);
    loadResumes().catch((error) => setStatus(error.message, "error"));
  }

  function mountInlineGenerator() {
    const field = findVisibleLetterField();
    if (field) createInlineGenerator(field);
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

  mountInlineGenerator();
  const observer = new MutationObserver(mountInlineGenerator);
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
