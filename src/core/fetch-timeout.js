export const DEFAULT_PLANNER_TIMEOUT_MS = 180000;

export async function fetchJsonWithTimeout(
  fetchImpl,
  url,
  options,
  label,
  timeoutMs = DEFAULT_PLANNER_TIMEOUT_MS,
  externalSignal = null
) {
  if (externalSignal?.aborted) {
    throw new Error(`${label} was canceled.`);
  }

  const controller = new AbortController();
  let timeoutId = null;
  let abortedByExternalSignal = false;
  const timeout = Math.max(10, Number(timeoutMs) || DEFAULT_PLANNER_TIMEOUT_MS);
  const abortFromExternalSignal = () => {
    abortedByExternalSignal = true;
    controller.abort();
  };

  externalSignal?.addEventListener?.("abort", abortFromExternalSignal, { once: true });

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new Error(`${label} timed out after ${Math.round(timeout / 1000)} seconds.`));
    }, timeout);
  });

  try {
    return await Promise.race([
      (async () => {
        try {
          const response = await fetchImpl(url, { ...options, signal: controller.signal });
          const data = await response.json();
          return { response, data };
        } catch (error) {
          if (abortedByExternalSignal) {
            throw new Error(`${label} was canceled.`);
          }
          throw error;
        }
      })(),
      timeoutPromise
    ]);
  } finally {
    clearTimeout(timeoutId);
    externalSignal?.removeEventListener?.("abort", abortFromExternalSignal);
  }
}
