export const DEFAULT_PLANNER_TIMEOUT_MS = 180000;

export async function fetchJsonWithTimeout(fetchImpl, url, options, label, timeoutMs = DEFAULT_PLANNER_TIMEOUT_MS) {
  const controller = new AbortController();
  let timeoutId = null;
  const timeout = Math.max(10, Number(timeoutMs) || DEFAULT_PLANNER_TIMEOUT_MS);

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new Error(`${label} timed out after ${Math.round(timeout / 1000)} seconds.`));
    }, timeout);
  });

  try {
    return await Promise.race([
      (async () => {
        const response = await fetchImpl(url, { ...options, signal: controller.signal });
        const data = await response.json();
        return { response, data };
      })(),
      timeoutPromise
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}
