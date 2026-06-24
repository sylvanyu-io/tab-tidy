export const LANGUAGE_MODES = Object.freeze({
  AUTO: "auto",
  ZH_CN: "zh-CN",
  EN_US: "en-US"
});

export const LANGUAGE_MODE_VALUES = Object.freeze(Object.values(LANGUAGE_MODES));

export function normalizeLanguageMode(value) {
  return LANGUAGE_MODE_VALUES.includes(value) ? value : LANGUAGE_MODES.AUTO;
}

export function wantsEnglish(languageMode) {
  return normalizeLanguageMode(languageMode) === LANGUAGE_MODES.EN_US;
}

export function localizedText(languageMode, zhCN, enUS) {
  return wantsEnglish(languageMode) ? enUS : zhCN;
}

export function languageInstruction(languageMode) {
  const normalized = normalizeLanguageMode(languageMode);
  if (normalized === LANGUAGE_MODES.EN_US) {
    return "Write every user-facing string in English: group titles, bucket titles, reasons, review reasons, and target-window titles. Do not mix languages except for proper nouns from source tabs.";
  }
  if (normalized === LANGUAGE_MODES.ZH_CN) {
    return "Write every user-facing string in Simplified Chinese: group titles, bucket titles, reasons, review reasons, and target-window titles. Proper nouns from source tabs may stay in their original language.";
  }
  return "Choose the user-facing language from the browser-tab context and the user's custom prompt. Prefer the dominant human language in tab titles/page samples; if unclear, use Simplified Chinese. Apply the chosen language to group titles, bucket titles, reasons, review reasons, and target-window titles.";
}

export function reviewGroupTitle(languageMode) {
  return localizedText(languageMode, "待分类", "Needs Review");
}

export function reviewGroupReason(languageMode) {
  return localizedText(
    languageMode,
    "AI 暂时拿不准这些页面的共同主题，不会硬塞进其他分组。",
    "AI was not confident enough to force these tabs into a topic group."
  );
}

export function targetWindowTitle(kind, languageMode) {
  if (kind === "selected_window") return localizedText(languageMode, "选定窗口", "Selected Window");
  if (kind === "current_window") return localizedText(languageMode, "当前窗口", "Current Window");
  return localizedText(languageMode, "AI 整理", "AI Organized");
}
