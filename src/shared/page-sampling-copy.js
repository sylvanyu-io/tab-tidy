export const PAGE_SAMPLE_ABSOLUTE_COUNT_COPY_THRESHOLD = 8;
export const PAGE_SAMPLE_COVERAGE_COPY_THRESHOLD = 0.4;
export const PAGE_SAMPLE_COVERAGE_MIN_COUNT = 2;

export function shouldShowPageSampleCount(sampledOk, totalTabs) {
  const ok = Math.max(0, Number(sampledOk) || 0);
  const total = Math.max(0, Number(totalTabs) || 0);
  if (!ok) return false;
  if (ok >= PAGE_SAMPLE_ABSOLUTE_COUNT_COPY_THRESHOLD) return true;
  return ok >= PAGE_SAMPLE_COVERAGE_MIN_COUNT && total > 0 && ok / total >= PAGE_SAMPLE_COVERAGE_COPY_THRESHOLD;
}
