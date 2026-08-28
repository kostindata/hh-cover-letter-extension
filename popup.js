const MODEL_OPTIONS = {
  openai: ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol", "gpt-4.1-mini"],
  openrouter: ["openai/gpt-4o-mini", "anthropic/claude-sonnet-4.6", "deepseek/deepseek-v4-flash", "google/gemini-2.5-flash"],
  deepseek: ["deepseek-v4-flash", "deepseek-v4-pro"],
  anthropic: ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5"]
};

const PROVIDER_NAMES = { openai: "OpenAI", openrouter: "OpenRouter", deepseek: "DeepSeek", anthropic: "Claude" };
const DEFAULT_API_SETTINGS = {
  provider: "openai",
  configs: {
    openai: { apiKey: "", model: MODEL_OPTIONS.openai[0] },
    openrouter: { apiKey: "", model: MODEL_OPTIONS.openrouter[0] },
    deepseek: { apiKey: "", model: MODEL_OPTIONS.deepseek[0] },
    anthropic: { apiKey: "", model: MODEL_OPTIONS.anthropic[0] }
  }
};

const state = {
  apiSettings: structuredClone(DEFAULT_API_SETTINGS),
  resumes: [],
  lastResumeId: "",
  vacancy: null
};

const $ = (selector) => document.querySelector(selector);
const status = $("#status");
const letterField = $("#letter");

function setStatus(text, type = "") {
  status.textContent = text;
  status.className = `status ${type}`.trim();
}

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === name));
  document.querySelectorAll(".panel").forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === name));
  setStatus("");
}

document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => switchTab(tab.dataset.tab)));

async function getActiveHhTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const supportedPage = /^https:\/\/([a-z0-9-]+\.)?hh\.ru\/(vacancy\/|applicant\/vacancy_response(?:\?|$))/i;
  if (!tab?.id || !supportedPage.test(tab.url || "")) {
    throw new Error("Откройте вакансию или анкету отклика на hh.ru.");
  }
  return tab;
}

async function sendToPage(message) {
  const tab = await getActiveHhTab();
  try { return await chrome.tabs.sendMessage(tab.id, message); }
  catch { throw new Error("Обновите страницу вакансии, чтобы активировать расширение."); }
}

function mergeApiSettings(saved) {
  const settings = structuredClone(DEFAULT_API_SETTINGS);
  if (!saved) return settings;
  if (PROVIDER_NAMES[saved.provider]) settings.provider = saved.provider;
  for (const provider of Object.keys(PROVIDER_NAMES)) {
    settings.configs[provider] = { ...settings.configs[provider], ...(saved.configs?.[provider] || {}) };
  }
  return settings;
}

function rememberVisibleApiFields(provider) {
  state.apiSettings.configs[provider] = {
    apiKey: $("#api-key").value.trim(),
    model: $("#model").value.trim()
  };
}

function renderApiFields() {
  const provider = state.apiSettings.provider;
  const config = state.apiSettings.configs[provider];
  $("#provider").value = provider;
  $("#api-key").value = config.apiKey;
  $("#model").value = config.model;
  $("#model-options").replaceChildren(...MODEL_OPTIONS[provider].map((model) => {
    const option = document.createElement("option");
    option.value = model;
    return option;
  }));
  renderApiSummary();
}

function renderApiSummary() {
  const { provider, configs } = state.apiSettings;
  const config = configs[provider];
  $("#api-summary").textContent = config.apiKey && config.model
    ? `${PROVIDER_NAMES[provider]} · ${config.model}`
    : "Настроить API";
}

$("#provider").addEventListener("change", (event) => {
  rememberVisibleApiFields(state.apiSettings.provider);
  state.apiSettings.provider = event.target.value;
  renderApiFields();
});

$("#api-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  rememberVisibleApiFields(state.apiSettings.provider);
  const config = state.apiSettings.configs[state.apiSettings.provider];
  if (!config.apiKey || !config.model) return setStatus("Укажите API-ключ и модель.", "error");
  await chrome.storage.local.set({ apiSettings: state.apiSettings });
  renderApiSummary();
  setStatus("Настройки API сохранены на этом устройстве.", "success");
});

$("#toggle-key").addEventListener("click", () => {
  const field = $("#api-key");
  const visible = field.type === "text";
  field.type = visible ? "password" : "text";
  $("#toggle-key").textContent = visible ? "Показать" : "Скрыть";
  $("#toggle-key").setAttribute("aria-label", visible ? "Показать API-ключ" : "Скрыть API-ключ");
});

$("#api-summary").addEventListener("click", () => switchTab("api"));

function formatBytes(bytes) {
  return bytes < 1024 ? `${bytes} Б` : `${Math.ceil(bytes / 1024)} КБ`;
}

function renderResumes() {
  const list = $("#resume-list");
  list.replaceChildren();
  for (const resume of state.resumes) {
    const item = document.createElement("article");
    item.className = "resume-item";
    const icon = document.createElement("span");
    icon.className = "file-icon";
    icon.textContent = resume.formatLabel || ResumeParser.formatLabels[resume.format] || "TXT";
    const details = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = resume.name;
    const meta = document.createElement("small");
    meta.textContent = `${formatBytes(new Blob([resume.text]).size)} · ${resume.text.length.toLocaleString("ru-RU")} знаков`;
    details.append(name, meta);
    const remove = document.createElement("button");
    remove.className = "delete-resume";
    remove.type = "button";
    remove.textContent = "Удалить";
    remove.addEventListener("click", () => deleteResume(resume.id));
    item.append(icon, details, remove);
    list.append(item);
  }
  $("#resume-empty").hidden = state.resumes.length > 0;
  $("#resume-count").textContent = String(state.resumes.length);
  renderResumeSelect();
}

function renderResumeSelect() {
  const select = $("#resume-select");
  select.replaceChildren();
  if (!state.resumes.length) {
    select.add(new Option("Сначала загрузите резюме", ""));
    return;
  }
  for (const resume of state.resumes) select.add(new Option(resume.name, resume.id));
  if (!state.resumes.some((resume) => resume.id === state.lastResumeId)) state.lastResumeId = state.resumes[0].id;
  select.value = state.lastResumeId;
}

async function deleteResume(id) {
  const resume = state.resumes.find((item) => item.id === id);
  if (!resume || !confirm(`Удалить резюме «${resume.name}»?`)) return;
  state.resumes = state.resumes.filter((item) => item.id !== id);
  if (state.lastResumeId === id) state.lastResumeId = state.resumes[0]?.id || "";
  await chrome.storage.local.set({ resumes: state.resumes, lastResumeId: state.lastResumeId });
  renderResumes();
  setStatus("Резюме удалено.", "success");
}

$("#resume-file").addEventListener("change", async (event) => {
  const files = [...event.target.files];
  if (!files.length) return;
  try {
    for (const file of files) {
      setStatus(`Читаю «${file.name}»…`);
      const parsed = await ResumeParser.parse(file);
      const text = parsed.text.replace(/\u0000/g, "").trim();
      const totalSize = new Blob([...state.resumes.map((resume) => resume.text), text]).size;
      if (totalSize > 5 * 1024 * 1024) throw new Error("Общий размер резюме не должен превышать 5 МБ.");
      const resume = {
        id: crypto.randomUUID(),
        name: file.name,
        text,
        format: parsed.format,
        formatLabel: parsed.formatLabel,
        updatedAt: Date.now()
      };
      state.resumes.push(resume);
      state.lastResumeId = resume.id;
    }
    await chrome.storage.local.set({ resumes: state.resumes, lastResumeId: state.lastResumeId });
    renderResumes();
    setStatus(`Загружено резюме: ${files.length}.`, "success");
  } catch (error) { setStatus(error.message, "error"); }
  finally { event.target.value = ""; }
});

$("#resume-select").addEventListener("change", async (event) => {
  state.lastResumeId = event.target.value;
  await chrome.storage.local.set({ lastResumeId: state.lastResumeId });
});

function setBusy(busy) {
  $("#generate").disabled = busy;
  $("#generate .button-label").textContent = busy ? "Генерирую письмо…" : "Создать и вставить";
  $("#generate .spinner").hidden = !busy;
}

function showLetter(letter) {
  letterField.value = letter;
  $("#result").hidden = false;
  $("#counter").textContent = `${letter.length} знаков`;
}

$("#generate-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const resume = state.resumes.find((item) => item.id === $("#resume-select").value);
  const { provider, configs } = state.apiSettings;
  const api = { provider, ...configs[provider] };
  if (!resume) return setStatus("Загрузите и выберите TXT-резюме.", "error");
  if (!api.apiKey || !api.model) { switchTab("api"); return setStatus("Настройте API-ключ и модель.", "error"); }

  setBusy(true);
  setStatus("Отправляю вакансию и резюме выбранной модели…");
  try {
    const vacancyResponse = await sendToPage({ type: "GET_VACANCY" });
    if (!vacancyResponse?.ok) throw new Error("Не удалось прочитать вакансию. Обновите страницу hh.ru.");
    state.vacancy = vacancyResponse.vacancy;
    const tone = $("#tone").value;
    const extraInstructions = $("#extra-instructions").value.trim();
    await chrome.storage.local.set({ lastResumeId: resume.id, generationSettings: { tone, extraInstructions } });
    const response = await chrome.runtime.sendMessage({
      type: "GENERATE_WITH_API",
      payload: { api, vacancy: state.vacancy, resume, tone, extraInstructions }
    });
    if (!response?.ok) throw new Error(response?.error || "API не вернул результат.");
    showLetter(response.letter);
    const inserted = await sendToPage({ type: "INSERT_LETTER", letter: response.letter });
    setStatus(inserted?.inserted
      ? `Готово: ${PROVIDER_NAMES[response.provider]}, ${response.model}. Письмо вставлено — проверьте его.`
      : "Письмо готово. Откройте форму отклика и нажмите «Вставить в форму».", inserted?.inserted ? "success" : "");
  } catch (error) { setStatus(error.message, "error"); }
  finally { setBusy(false); }
});

$("#copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(letterField.value); }
  catch { letterField.select(); document.execCommand("copy"); }
  setStatus("Письмо скопировано.", "success");
});

$("#insert").addEventListener("click", async () => {
  try {
    const response = await sendToPage({ type: "INSERT_LETTER", letter: letterField.value });
    if (!response?.inserted) throw new Error("Сначала откройте форму отклика на странице вакансии.");
    setStatus("Письмо вставлено. Проверьте его перед отправкой.", "success");
  } catch (error) { setStatus(error.message, "error"); }
});

letterField.addEventListener("input", () => { $("#counter").textContent = `${letterField.value.length} знаков`; });

async function loadVacancy() {
  const card = $("#vacancy-card");
  try {
    const response = await sendToPage({ type: "GET_VACANCY" });
    if (!response?.ok) throw new Error("Описание вакансии не найдено");
    state.vacancy = response.vacancy;
    card.className = "vacancy-card ready";
    card.querySelector("strong").textContent = response.vacancy.title;
    card.querySelector("small").textContent = response.vacancy.company || "Вакансия hh.ru";
  } catch (error) {
    card.className = "vacancy-card error";
    card.querySelector("strong").textContent = "Вакансия не найдена";
    card.querySelector("small").textContent = error.message;
  }
}

async function init() {
  const saved = await chrome.storage.local.get(["apiSettings", "resumes", "lastResumeId", "generationSettings"]);
  state.apiSettings = mergeApiSettings(saved.apiSettings);
  state.resumes = Array.isArray(saved.resumes) ? saved.resumes : [];
  state.lastResumeId = saved.lastResumeId || "";
  $("#tone").value = saved.generationSettings?.tone || "business";
  $("#extra-instructions").value = saved.generationSettings?.extraInstructions || "";
  renderApiFields();
  renderResumes();
  await loadVacancy();
}

init().catch((error) => setStatus(error.message, "error"));
