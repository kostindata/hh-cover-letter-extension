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
      "textarea[name='letter']"
    ]
  };

  function firstText(selectors) {
    for (const selector of selectors) {
      const text = document.querySelector(selector)?.textContent?.replace(/\s+/g, " ").trim();
      if (text) return text;
    }
    return "";
  }

  function allTexts(selectors) {
    const values = selectors.flatMap((selector) =>
      [...document.querySelectorAll(selector)].map((element) => element.textContent?.replace(/\s+/g, " ").trim())
    );
    return [...new Set(values.filter(Boolean))];
  }

  function getVacancy() {
    return {
      url: location.href,
      title: firstText(SELECTORS.title),
      company: firstText(SELECTORS.company),
      description: firstText(SELECTORS.description),
      skills: allTexts(SELECTORS.skills)
    };
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
      const vacancy = getVacancy();
      sendResponse({ ok: Boolean(vacancy.title && vacancy.description), vacancy });
    }
    if (message.type === "INSERT_LETTER") {
      sendResponse({ ok: true, inserted: insertLetter(message.letter || "") });
    }
  });
})();
