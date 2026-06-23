import { handleRuntimeMessage } from "../core/controller.js";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleRuntimeMessage(chrome, message, sender)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => {
      console.error(error);
      sendResponse({ ok: false, error: error?.message || String(error) });
    });

  return true;
});
