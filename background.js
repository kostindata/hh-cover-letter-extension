const PROVIDERS = {
  openai: {
    name: "OpenAI",
    endpoint: "https://api.openai.com/v1/responses",
    headers: (apiKey) => ({ Authorization: `Bearer ${apiKey}` }),
    body: (model, system, prompt) => ({
      model,
      instructions: system,
      input: prompt,
      max_output_tokens: 1200,
      store: false
    }),
    parse: (data) => data.output_text || data.output
      ?.flatMap((item) => item.content || [])
      .filter((item) => item.type === "output_text")
      .map((item) => item.text)
      .join("\n")
  },
  openrouter: {
    name: "OpenRouter",
    endpoint: "https://api.openrouter.ai/api/v1/chat/completions",
    headers: (apiKey) => ({
      Authorization: `Bearer ${apiKey}`,
      "X-Title": "hh.ru Cover Letter"
    }),
    body: (model, system, prompt) => ({
      model,
      messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
      max_tokens: 1200
    }),
    parse: (data) => data.choices?.[0]?.message?.content
  },
  deepseek: {
    name: "DeepSeek",
    endpoint: "https://api.deepseek.com/chat/completions",
    headers: (apiKey) => ({ Authorization: `Bearer ${apiKey}` }),
    body: (model, system, prompt) => ({
      model,
      messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
      max_tokens: 1200,
      stream: false
    }),
    parse: (data) => data.choices?.[0]?.message?.content
  },
  anthropic: {
    name: "Claude",
    endpoint: "https://api.anthropic.com/v1/messages",
    headers: (apiKey) => ({
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    }),
    body: (model, system, prompt) => ({
      model,
      max_tokens: 1200,
      system,
      messages: [{ role: "user", content: prompt }]
    }),
    parse: (data) => data.content?.filter((item) => item.type === "text").map((item) => item.text).join("\n")
  }
};

const SYSTEM_PROMPT = `Ты карьерный консультант и редактор сопроводительных писем.
Создай персональное сопроводительное письмо на русском языке на основе только переданных вакансии и резюме.
Правила:
- не выдумывай опыт, навыки, достижения, должности или сроки;
- выбери 2–4 самых релевантных факта из резюме и свяжи их с требованиями вакансии;
- избегай штампов, пересказа всей вакансии и чрезмерной лести;
- длина 900–1500 знаков, если пользователь не просит иначе;
- не добавляй тему письма, Markdown, комментарии или пояснения;
- верни только готовый текст письма.`;

function cleanText(value, maxLength) {
  return String(value || "").replace(/\u0000/g, "").trim().slice(0, maxLength);
}

function buildPrompt({ vacancy, resume, tone, extraInstructions }) {
  const toneLabels = {
    business: "деловой и уверенный",
    friendly: "дружелюбный и живой",
    concise: "краткий и предметный"
  };
  const vacancyText = [
    `Название: ${cleanText(vacancy.title, 500)}`,
    vacancy.company ? `Компания: ${cleanText(vacancy.company, 500)}` : "",
    `Описание:\n${cleanText(vacancy.description, 30000)}`,
    vacancy.skills?.length ? `Ключевые навыки: ${cleanText(vacancy.skills.join(", "), 4000)}` : ""
  ].filter(Boolean).join("\n\n");

  return `Тон письма: ${toneLabels[tone] || toneLabels.business}.
${extraInstructions ? `Дополнительные пожелания: ${cleanText(extraInstructions, 2000)}\n` : ""}
ВАКАНСИЯ
${vacancyText}

РЕЗЮМЕ КАНДИДАТА
${cleanText(resume.text, 40000)}

Напиши сопроводительное письмо.`;
}

async function generateCoverLetter(payload) {
  const { api, vacancy, resume, tone, extraInstructions } = payload;
  const provider = PROVIDERS[api?.provider];
  if (!provider) throw new Error("Неизвестный API-провайдер.");
  if (!api.apiKey?.trim()) throw new Error(`Укажите API-ключ ${provider.name} в настройках.`);
  if (!api.model?.trim()) throw new Error("Укажите модель для генерации.");
  if (!resume?.text?.trim()) throw new Error("Выберите непустое резюме.");
  if (!vacancy?.description?.trim()) throw new Error("Не удалось прочитать описание вакансии.");

  const prompt = buildPrompt({ vacancy, resume, tone, extraInstructions });
  let response;
  try {
    response = await fetch(provider.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...provider.headers(api.apiKey.trim()) },
      body: JSON.stringify(provider.body(api.model.trim(), SYSTEM_PROMPT, prompt))
    });
  } catch (error) {
    throw new Error(`Не удалось подключиться к ${provider.name}: ${error.message}`);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const apiMessage = data.error?.message || data.error?.type || data.message;
    throw new Error(`${provider.name}: ${apiMessage || `ошибка HTTP ${response.status}`}`);
  }
  const letter = provider.parse(data)?.trim();
  if (!letter) throw new Error(`${provider.name} вернул пустой ответ.`);
  return { letter, provider: api.provider, model: api.model.trim() };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "GENERATE_WITH_API") return false;
  generateCoverLetter(message.payload)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
