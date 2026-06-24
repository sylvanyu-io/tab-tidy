import { expect, test } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

const rootDir = resolve(".");
let server;
let baseUrl;

test.beforeAll(async () => {
  server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      const filePath = resolve(rootDir, pathname.slice(1));
      if (!filePath.startsWith(rootDir)) {
        response.writeHead(403).end();
        return;
      }
      const body = await readFile(filePath);
      response.writeHead(200, { "content-type": contentType(filePath) });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });

  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => {
  await new Promise((resolveClose) => server.close(resolveClose));
});

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 680 });
});

test("floating window renders settings and mock preview", async ({ page }) => {
  await page.goto(`${baseUrl}/src/sidepanel/index.html`);

  await expect(page.getByRole("heading", { name: "Tab Tidy" })).toBeVisible();
  await expect(page.locator(".actions")).toHaveCSS("position", "static");
  await expect(page.locator(".actions")).toHaveCSS("display", "grid");
  await expect(page.locator(".scroll-region")).toHaveCSS("overflow-y", "auto");
  await expect(page.locator("#analyzeBtn")).toHaveCSS("background-color", "rgb(31, 85, 255)");
  await expect(page.locator("#analyzeBtn")).toHaveCSS("border-radius", "10px");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const scrollRegion = document.querySelector(".scroll-region")?.getBoundingClientRect();
        const actions = document.querySelector(".actions")?.getBoundingClientRect();
        return Boolean(scrollRegion && actions && actions.top >= scrollRegion.bottom - 1 && document.body.scrollHeight <= window.innerHeight);
      })
    )
    .toBe(true);
  await expect(page.locator(".segmented")).toHaveCount(0);
  await expect(page.locator("#previewSection")).toBeHidden();
  await expect(page.locator("#samplingRisk")).toBeHidden();
  await expect(page.getByText("整理偏好")).toHaveCount(0);
  await expect(page.getByText("调整", { exact: true })).toHaveCount(0);
  await expect(page.locator("#settingsSummaryBtn")).toHaveCount(0);

  await page.locator("#ackSampling").check();
  await expect(page.locator("#samplingRisk")).toBeVisible();
  await expect(page.locator("#pageContextMode")).toHaveValue("all_granted_origins");
  await expect(page.locator("#hostPermissionRequestMode")).toHaveValue("ask_for_all_visible_origins");
  await expect(page.locator("#pageContextMode option[value='active_tab_only']")).toHaveCount(0);

  await page.getByText("更多选项").click();
  await expect(page.locator("#gatewayBaseUrl")).toHaveValue("");
  await expect(page.locator("#gatewayBaseUrl")).toHaveAttribute("placeholder", "不填则使用默认服务");
  await expect(page.locator("#gatewayApiKey")).toHaveAttribute("placeholder", "默认服务无需填写");
  await expect(page.locator("#gatewayModel")).toHaveValue("gpt-5.5");
  await expect(page.locator("#gatewayCustomModelField")).toBeHidden();
  await page.locator("#gatewayModel").selectOption("custom");
  await expect(page.locator("#gatewayCustomModelField")).toBeVisible();
  await page.locator("#gatewayCustomModel").fill("glm-5.2");
  await expect(page.locator("#gatewayCustomModel")).toHaveValue("glm-5.2");
  await page.locator("#gatewayModel").selectOption("gpt-5.5");
  await expect(page.locator("#gatewayCustomModelField")).toBeHidden();
  await expect(page.locator("#gatewayThinkingIntensity")).toHaveValue("high");
  await expect(page.locator("#languageMode")).toHaveValue("auto");
  await expect(page.locator("#undoTargetWindowMode")).toHaveValue("leave_empty_target_window");
  await expect(page.locator("#hostPermissionRequestMode")).toContainText("一次授权可见站点");
  await expect(page.locator("#existingGroupMode")).toBeHidden();
  await expect(page.locator("#reviewGroupMode")).toBeHidden();
  await expect(page.locator("#undoTargetWindowMode")).toBeHidden();
  await expect(page.locator("#dissolveExistingGroupsToggle")).toBeVisible();
  await expect(page.locator("#createReviewGroupToggle")).toBeVisible();
  await expect(page.locator("#closeEmptyTargetWindowToggle")).toBeVisible();
  await expect(page.locator("#dissolveExistingGroupsToggle")).not.toBeChecked();
  await expect(page.locator("#createReviewGroupToggle")).toBeChecked();
  await expect(page.locator("#closeEmptyTargetWindowToggle")).not.toBeChecked();
  await expect(page.getByText("整理后收起分组")).toBeVisible();
  await expect(page.locator("#collapseGroupsAfterApply")).toBeChecked();

  await page.locator("#dissolveExistingGroupsToggle").check();
  await expect(page.locator("#existingGroupMode")).toHaveValue("dissolve_existing_groups");
  await page.locator("#createReviewGroupToggle").uncheck();
  await expect(page.locator("#reviewGroupMode")).toHaveValue("leave_review_ungrouped");
  await page.locator("#closeEmptyTargetWindowToggle").check();
  await expect(page.locator("#undoTargetWindowMode")).toHaveValue("close_empty_created_target_window");
  await page.getByRole("button", { name: "所有窗口" }).click();
  await expect(page.locator("#targetWindowCurrentToggle")).toBeVisible();
  await expect(page.locator("#targetWindowMode")).toBeHidden();
  await page.locator("#targetWindowCurrentToggle").uncheck();
  await expect(page.locator("#targetWindowMode")).toHaveValue("new_window");
  await page.locator("#targetWindowCurrentToggle").check();
  await expect(page.locator("#targetWindowMode")).toHaveValue("current_window");
  await page.getByRole("button", { name: "当前窗口" }).click();
  await page.locator("#dissolveExistingGroupsToggle").uncheck();
  await expect(page.locator("#existingGroupMode")).toHaveValue("preserve_existing_groups");
  await page.locator("#createReviewGroupToggle").check();
  await expect(page.locator("#reviewGroupMode")).toHaveValue("create_review_group");
  await page.locator("#closeEmptyTargetWindowToggle").uncheck();
  await expect(page.locator("#undoTargetWindowMode")).toHaveValue("leave_empty_target_window");

  await page.getByRole("button", { name: "生成方案" }).click();
  await expect(page.locator(".preview").getByText("AI 研究", { exact: true })).toBeVisible();
  await expect(page.locator(".preview").getByText("当前项目", { exact: true })).toBeVisible();
  await expect(page.locator(".preview").getByText("待分类", { exact: true })).toBeVisible();
  await expect(
    page.locator(".preview").getByText("AI 已梳理 23 个标签页，识别出 2 个主题；20 个已自动归类，3 个留到「待分类」。")
  ).toBeVisible();
  await expect(page.locator(".preview").getByText("页面摘要读到 2/3 个标签页；1 个只参考标题和网址。")).toBeVisible();
  await expect(page.locator(".preview").getByText("另有 1 个固定、无痕或受限标签页未参与整理。")).toBeVisible();
  await expect(page.getByText("待确认")).toHaveCount(0);
  await expect(page.locator(".preview-stats")).toHaveCount(0);
  await expect(page.locator(".stat-chip")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "开始整理" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "撤销" })).toBeHidden();
  await expect(page.getByText("调整", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "重新生成" }).click();
  await expect(page.locator("#previewSection")).toBeHidden();
  await expect(page.locator(".launch-panel")).toBeVisible();
  await expect(page.getByRole("button", { name: "生成方案" })).toBeVisible();
  await expect(page.getByRole("button", { name: "开始整理" })).toBeHidden();

  await page.getByRole("button", { name: "生成方案" }).click();
  await expect(page.locator(".preview").getByText("AI 研究", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "开始整理" }).click();
  await expect(page.getByRole("button", { name: "撤销" })).toBeVisible();

  await page.getByRole("button", { name: "重新生成" }).click();
  await expect(page.locator("#previewSection")).toBeHidden();
  await expect(page.getByRole("button", { name: "生成方案" })).toBeVisible();
  await expect(page.getByRole("button", { name: "撤销" })).toBeVisible();
});

test("preview copy and review group follow the selected result language", async ({ page }) => {
  await page.addInitScript(() => {
    const settings = {
      organizeMode: "current_window",
      targetWindowMode: "current_window",
      existingGroupMode: "preserve_existing_groups",
      reviewGroupMode: "create_review_group",
      undoTargetWindowMode: "leave_empty_target_window",
      pageContextMode: "off",
      hostPermissionRequestMode: "never",
      pageSamplingConsentMode: "not_acknowledged",
      urlPrivacyMode: "sanitized_url",
      languageMode: "en-US",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: true,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      promptPreset: "conservative",
      plannerProvider: "gateway",
      rememberProviderKeys: false,
      gatewayBaseUrl: "",
      gatewayModel: "gpt-5.5",
      gatewayThinkingIntensity: "high",
      gatewayApiKey: "",
      customPrompt: ""
    };
    const activeJob = {
      operationId: "job_en_preview",
      status: "complete",
      phase: "complete",
      progress: 100,
      message: "方案好了，可以先检查",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const job = {
      settings,
      validation: { ok: true, warnings: [] },
      preview: {
        languageMode: "en-US",
        requiresConfirmation: false,
        groups: [{ title: "AI Research", reason: "Models and papers.", tabCount: 2 }],
        eligibleTabsCount: 3,
        groupedTabsCount: 2,
        reviewTabsCount: 1,
        reviewGroupWillBeCreated: true,
        excludedTabsCount: 0,
        lockedGroupsCount: 0,
        warnings: []
      }
    };
    window.chrome = {
      runtime: {
        sendMessage: async (message) => {
          if (message.type === "settings:get") return { ok: true, result: settings };
          if (message.type === "settings:save") return { ok: true, result: message.settings };
          if (message.type === "tabs:getActiveJob") return { ok: true, result: activeJob };
          if (message.type === "tabs:getLastJob") return { ok: true, result: job };
          if (message.type === "tabs:startAnalyze") return { ok: true, result: { operationId: activeJob.operationId } };
          return { ok: true, result: null };
        }
      }
    };
  });

  await page.goto(`${baseUrl}/src/sidepanel/index.html`);
  await expect(page.locator("#languageMode")).toHaveValue("en-US");
  await page.getByRole("button", { name: "生成方案" }).click();
  await expect(page.locator("#previewCount")).toHaveText("2 groups");
  await expect(page.locator(".preview").getByText("AI Research", { exact: true })).toBeVisible();
  await expect(page.locator(".preview").getByText("Needs Review", { exact: true })).toBeVisible();
  await expect(
    page
      .locator(".preview")
      .getByText("AI reviewed 3 tabs, found 1 topic group; 2 tabs will be grouped automatically, with 1 tab set aside for Needs Review.")
  ).toBeVisible();
});

test("floating window shows optimistic progress while waiting for AI", async ({ page }) => {
  await page.addInitScript(() => {
    const settings = {
      organizeMode: "current_window",
      targetWindowMode: "current_window",
      existingGroupMode: "preserve_existing_groups",
      reviewGroupMode: "create_review_group",
      undoTargetWindowMode: "leave_empty_target_window",
      pageContextMode: "off",
      hostPermissionRequestMode: "never",
      pageSamplingConsentMode: "not_acknowledged",
      urlPrivacyMode: "sanitized_url",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: false,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      promptPreset: "conservative",
      plannerProvider: "gateway",
      rememberProviderKeys: false,
      gatewayBaseUrl: "",
      gatewayModel: "gpt-5.5",
      gatewayThinkingIntensity: "high",
      gatewayApiKey: "",
      customPrompt: ""
    };
    const activeJob = {
      operationId: "job_waiting",
      status: "running",
      phase: "planning",
      progress: 45,
      message: "正在请求 AI 规划",
      createdAt: new Date(Date.now() - 12000).toISOString(),
      updatedAt: new Date(Date.now() - 12000).toISOString()
    };
    window.chrome = {
      runtime: {
        sendMessage: async (message) => {
          if (message.type === "settings:get") return { ok: true, result: settings };
          if (message.type === "tabs:getActiveJob") return { ok: true, result: activeJob };
          if (message.type === "settings:save") return { ok: true, result: message.settings };
          return { ok: true, result: null };
        }
      }
    };
  });

  await page.goto(`${baseUrl}/src/sidepanel/index.html`);
  await expect(page.locator("#statusText")).toHaveText(
    /(理解标题线索|寻找相邻任务|避开域名硬分组|检查不确定页|整理分组边界) · \d+秒/
  );
  await expect(page.locator(".actions #progressBar")).toBeVisible();
  await expect(page.locator("#progressLabel")).toHaveText(
    /(理解标题线索|寻找相邻任务|避开域名硬分组|检查不确定页|整理分组边界) · \d+秒/
  );
  await expect(page.locator("#progressPercent")).toContainText("%");
  const displayedProgress = await page.locator("#progressFill").evaluate((element) => Number.parseFloat(element.style.width));
  expect(displayedProgress).toBeGreaterThan(45);
  await expect(page.getByRole("button", { name: "取消" })).toBeVisible();
});

test("default gateway permission request is narrow and compact", async ({ page }) => {
  await page.addInitScript(() => {
    const settings = {
      organizeMode: "current_window",
      targetWindowMode: "current_window",
      existingGroupMode: "preserve_existing_groups",
      reviewGroupMode: "create_review_group",
      undoTargetWindowMode: "leave_empty_target_window",
      pageContextMode: "off",
      hostPermissionRequestMode: "never",
      pageSamplingConsentMode: "not_acknowledged",
      urlPrivacyMode: "sanitized_url",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: false,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      promptPreset: "conservative",
      plannerProvider: "gateway",
      rememberProviderKeys: false,
      gatewayBaseUrl: "",
      gatewayModel: "gpt-5.5",
      gatewayThinkingIntensity: "high",
      gatewayApiKey: "",
      customPrompt: ""
    };
    window.__permissionRequests = [];
    const activeJob = {
      operationId: "job_default_gateway",
      status: "complete",
      phase: "complete",
      progress: 100,
      message: "方案好了，可以先检查",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const job = {
      validation: { ok: true, warnings: [] },
      preview: {
        requiresConfirmation: false,
        groups: [{ title: "资料整理", reason: "Mock plan.", tabCount: 2 }],
        reviewTabsCount: 0,
        excludedTabsCount: 0,
        lockedGroupsCount: 0,
        warnings: []
      }
    };
    window.chrome = {
      permissions: {
        contains: async () => false,
        request: async (request) => {
          window.__permissionRequests.push(request);
          return true;
        }
      },
      windows: {
        getCurrent: async () => ({ id: 999, type: "popup" }),
        getLastFocused: async () => ({ id: 999, type: "popup" })
      },
      runtime: {
        sendMessage: async (message) => {
          if (message.type === "settings:get") return { ok: true, result: settings };
          if (message.type === "settings:save") return { ok: true, result: message.settings };
          if (message.type === "tabs:getActiveJob") return { ok: true, result: activeJob };
          if (message.type === "tabs:getLastJob") return { ok: true, result: job };
          if (message.type === "tabs:startAnalyze") {
            window.__analyzeWindowId = message.windowId;
            return { ok: true, result: { operationId: activeJob.operationId } };
          }
          return { ok: true, result: null };
        }
      }
    };
  });

  await page.goto(`${baseUrl}/src/sidepanel/index.html?sourceWindowId=77`);
  await page.getByRole("button", { name: "生成方案" }).click();
  await expect(page.locator(".preview").getByText("资料整理", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__permissionRequests)).toEqual([{ origins: ["https://cliproxy.sylvanyu.io/*"] }]);
  await expect.poll(() => page.evaluate(() => window.__analyzeWindowId)).toBe(77);
});

test("custom model requires a custom gateway before permission request", async ({ page }) => {
  await page.addInitScript(() => {
    const settings = {
      organizeMode: "current_window",
      targetWindowMode: "current_window",
      existingGroupMode: "preserve_existing_groups",
      reviewGroupMode: "create_review_group",
      undoTargetWindowMode: "leave_empty_target_window",
      pageContextMode: "off",
      hostPermissionRequestMode: "never",
      pageSamplingConsentMode: "not_acknowledged",
      urlPrivacyMode: "sanitized_url",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: true,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      promptPreset: "conservative",
      plannerProvider: "gateway",
      rememberProviderKeys: false,
      gatewayBaseUrl: "",
      gatewayModel: "custom",
      gatewayCustomModel: "glm-5.2",
      gatewayThinkingIntensity: "high",
      gatewayApiKey: "",
      customPrompt: ""
    };
    window.__permissionRequests = [];
    window.__startAnalyzeCalled = false;
    window.chrome = {
      permissions: {
        contains: async () => false,
        request: async (request) => {
          window.__permissionRequests.push(request);
          return true;
        }
      },
      runtime: {
        sendMessage: async (message) => {
          if (message.type === "settings:get") return { ok: true, result: settings };
          if (message.type === "settings:save") return { ok: true, result: message.settings };
          if (message.type === "tabs:getActiveJob") return { ok: true, result: null };
          if (message.type === "tabs:startAnalyze") {
            window.__startAnalyzeCalled = true;
            return { ok: true, result: { operationId: "should_not_start" } };
          }
          return { ok: true, result: null };
        }
      }
    };
  });

  await page.goto(`${baseUrl}/src/sidepanel/index.html`);
  await page.getByRole("button", { name: "生成方案" }).click();
  await expect(page.locator("#statusText")).toHaveText("自定义模型名需要先填写自定义 AI 网关地址。");
  await expect.poll(() => page.evaluate(() => window.__permissionRequests.length)).toBe(0);
  await expect.poll(() => page.evaluate(() => window.__startAnalyzeCalled)).toBe(false);
});

test("current-window generation without sourceWindowId uses the focused normal window", async ({ page }) => {
  await page.addInitScript(() => {
    const settings = {
      organizeMode: "current_window",
      targetWindowMode: "current_window",
      existingGroupMode: "preserve_existing_groups",
      reviewGroupMode: "create_review_group",
      undoTargetWindowMode: "leave_empty_target_window",
      pageContextMode: "off",
      hostPermissionRequestMode: "never",
      pageSamplingConsentMode: "not_acknowledged",
      urlPrivacyMode: "sanitized_url",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: true,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      promptPreset: "conservative",
      plannerProvider: "gateway",
      rememberProviderKeys: false,
      gatewayBaseUrl: "",
      gatewayModel: "gpt-5.5",
      gatewayThinkingIntensity: "high",
      gatewayApiKey: "",
      customPrompt: ""
    };
    const activeJob = {
      operationId: "job_focused_window",
      status: "complete",
      phase: "complete",
      progress: 100,
      message: "方案好了，可以先检查",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const job = {
      validation: { ok: true, warnings: [] },
      preview: {
        requiresConfirmation: false,
        groups: [{ title: "当前窗口", reason: "Mock plan.", tabCount: 2 }],
        reviewTabsCount: 0,
        excludedTabsCount: 0,
        lockedGroupsCount: 0,
        warnings: []
      }
    };
    window.__analyzeWindowId = null;
    window.chrome = {
      windows: {
        getLastFocused: async () => ({ id: 42, type: "normal" }),
        getCurrent: async () => ({ id: 999, type: "popup" })
      },
      runtime: {
        sendMessage: async (message) => {
          if (message.type === "settings:get") return { ok: true, result: settings };
          if (message.type === "settings:save") return { ok: true, result: message.settings };
          if (message.type === "tabs:getActiveJob") return { ok: true, result: activeJob };
          if (message.type === "tabs:getLastJob") return { ok: true, result: job };
          if (message.type === "tabs:startAnalyze") {
            window.__analyzeWindowId = message.windowId;
            return { ok: true, result: { operationId: activeJob.operationId } };
          }
          return { ok: true, result: null };
        }
      }
    };
  });

  await page.goto(`${baseUrl}/src/sidepanel/index.html`);
  await page.getByRole("button", { name: "生成方案" }).click();
  await expect(page.locator(".preview").getByText("当前窗口", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__analyzeWindowId)).toBe(42);
});

test("current-window generation ignores a stale sourceWindowId", async ({ page }) => {
  await page.addInitScript(() => {
    const settings = {
      organizeMode: "current_window",
      targetWindowMode: "current_window",
      existingGroupMode: "preserve_existing_groups",
      reviewGroupMode: "create_review_group",
      undoTargetWindowMode: "leave_empty_target_window",
      pageContextMode: "off",
      hostPermissionRequestMode: "never",
      pageSamplingConsentMode: "not_acknowledged",
      urlPrivacyMode: "sanitized_url",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: true,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      promptPreset: "conservative",
      plannerProvider: "gateway",
      rememberProviderKeys: false,
      gatewayBaseUrl: "",
      gatewayModel: "gpt-5.5",
      gatewayThinkingIntensity: "high",
      gatewayApiKey: "",
      customPrompt: ""
    };
    const activeJob = {
      operationId: "job_stale_source_window",
      status: "complete",
      phase: "complete",
      progress: 100,
      message: "方案好了，可以先检查",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const job = {
      validation: { ok: true, warnings: [] },
      preview: {
        requiresConfirmation: false,
        groups: [{ title: "回退窗口", reason: "Mock plan.", tabCount: 2 }],
        reviewTabsCount: 0,
        excludedTabsCount: 0,
        lockedGroupsCount: 0,
        warnings: []
      }
    };
    window.__analyzeWindowId = null;
    window.chrome = {
      windows: {
        get: async (windowId) => {
          if (windowId === 77) throw new Error("No window with id: 77.");
          return { id: windowId, type: "normal" };
        },
        getLastFocused: async () => ({ id: 42, type: "normal" }),
        getCurrent: async () => ({ id: 999, type: "popup" })
      },
      runtime: {
        sendMessage: async (message) => {
          if (message.type === "settings:get") return { ok: true, result: settings };
          if (message.type === "settings:save") return { ok: true, result: message.settings };
          if (message.type === "tabs:getActiveJob") return { ok: true, result: activeJob };
          if (message.type === "tabs:getLastJob") return { ok: true, result: job };
          if (message.type === "tabs:startAnalyze") {
            window.__analyzeWindowId = message.windowId;
            return { ok: true, result: { operationId: activeJob.operationId } };
          }
          return { ok: true, result: null };
        }
      }
    };
  });

  await page.goto(`${baseUrl}/src/sidepanel/index.html?sourceWindowId=77`);
  await page.getByRole("button", { name: "生成方案" }).click();
  await expect(page.locator(".preview").getByText("回退窗口", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__analyzeWindowId)).toBe(42);
});

test("review-only previews are shown as a pending classification group", async ({ page }) => {
  await page.addInitScript(() => {
    const settings = {
      organizeMode: "current_window",
      targetWindowMode: "current_window",
      existingGroupMode: "preserve_existing_groups",
      reviewGroupMode: "create_review_group",
      undoTargetWindowMode: "leave_empty_target_window",
      pageContextMode: "off",
      hostPermissionRequestMode: "never",
      pageSamplingConsentMode: "not_acknowledged",
      urlPrivacyMode: "sanitized_url",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: true,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      promptPreset: "conservative",
      plannerProvider: "gateway",
      rememberProviderKeys: false,
      gatewayBaseUrl: "",
      gatewayModel: "gpt-5.5",
      gatewayThinkingIntensity: "high",
      gatewayApiKey: "",
      customPrompt: ""
    };
    const activeJob = {
      operationId: "job_review_only",
      status: "complete",
      phase: "complete",
      progress: 100,
      message: "方案好了，可以先检查",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const job = {
      validation: { ok: true, warnings: [] },
      preview: {
        requiresConfirmation: false,
        groups: [],
        reviewTabsCount: 3,
        reviewGroupWillBeCreated: true,
        excludedTabsCount: 0,
        lockedGroupsCount: 0,
        warnings: []
      }
    };
    window.chrome = {
      runtime: {
        sendMessage: async (message) => {
          if (message.type === "settings:get") return { ok: true, result: settings };
          if (message.type === "settings:save") return { ok: true, result: message.settings };
          if (message.type === "tabs:getActiveJob") return { ok: true, result: activeJob };
          if (message.type === "tabs:getLastJob") return { ok: true, result: job };
          if (message.type === "tabs:startAnalyze") return { ok: true, result: { operationId: activeJob.operationId } };
          return { ok: true, result: null };
        }
      }
    };
  });

  await page.goto(`${baseUrl}/src/sidepanel/index.html`);
  await page.getByRole("button", { name: "生成方案" }).click();
  await expect(page.locator("#previewCount")).toHaveText("1 组");
  await expect(page.locator(".preview").getByText("AI 已梳理 3 个标签页，没有找到足够稳定的主题，3 个留到「待分类」。")).toBeVisible();
  await expect(page.locator(".preview").getByText("待分类", { exact: true })).toBeVisible();
  await expect(page.locator(".preview").getByText("AI 暂时拿不准这些页面的共同主题，不会硬塞进其他分组。")).toBeVisible();
  await expect(page.getByText("不会创建新分组")).toHaveCount(0);
  await expect(page.getByText("待确认")).toHaveCount(0);
});

test("page summary main toggle requests scripting and page origins", async ({ page }) => {
  await page.addInitScript(() => {
    let settings = {
      organizeMode: "current_window",
      targetWindowMode: "current_window",
      existingGroupMode: "preserve_existing_groups",
      reviewGroupMode: "create_review_group",
      undoTargetWindowMode: "leave_empty_target_window",
      pageContextMode: "off",
      hostPermissionRequestMode: "never",
      pageSamplingConsentMode: "not_acknowledged",
      urlPrivacyMode: "sanitized_url",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: true,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      promptPreset: "conservative",
      plannerProvider: "gateway",
      rememberProviderKeys: false,
      gatewayBaseUrl: "",
      gatewayModel: "gpt-5.5",
      gatewayThinkingIntensity: "high",
      gatewayApiKey: "",
      customPrompt: ""
    };
    const activeJob = {
      operationId: "job_page_origin_permissions",
      status: "complete",
      phase: "complete",
      progress: 100,
      message: "方案好了，可以先检查",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const job = {
      validation: { ok: true, warnings: [] },
      preview: {
        requiresConfirmation: false,
        groups: [{ title: "需要授权", reason: "Mock plan.", tabCount: 1 }],
        reviewTabsCount: 0,
        excludedTabsCount: 0,
        lockedGroupsCount: 0,
        warnings: []
      }
    };
    window.__permissionRequests = [];
    window.__savedSettings = [];
    window.chrome = {
      permissions: {
        contains: async (request) => Boolean(request.origins?.includes("https://cliproxy.sylvanyu.io/*")),
        request: async (request) => {
          window.__permissionRequests.push(request);
          return true;
        }
      },
      windows: {
        get: async () => ({
          id: 77,
          type: "normal",
          tabs: [
            { id: 10, title: "Login", url: "https://example.com/signin", active: true },
            { id: 11, title: "Specific documentation article with clear title", url: "https://docs.example.org/page" }
          ]
        })
      },
      runtime: {
        sendMessage: async (message) => {
          if (message.type === "settings:get") return { ok: true, result: settings };
          if (message.type === "settings:save") {
            settings = message.settings;
            window.__savedSettings.push(settings);
            return { ok: true, result: settings };
          }
          if (message.type === "tabs:getActiveJob") return { ok: true, result: activeJob };
          if (message.type === "tabs:getLastJob") return { ok: true, result: job };
          if (message.type === "tabs:startAnalyze") return { ok: true, result: { operationId: activeJob.operationId } };
          return { ok: true, result: null };
        }
      }
    };
  });

  await page.goto(`${baseUrl}/src/sidepanel/index.html?sourceWindowId=77`);
  await page.locator("#ackSampling").check();
  await expect.poll(() => page.evaluate(() => window.__savedSettings.at(-1)?.pageContextMode)).toBe("all_granted_origins");
  await expect.poll(() => page.evaluate(() => window.__savedSettings.at(-1)?.hostPermissionRequestMode)).toBe(
    "ask_for_all_visible_origins"
  );

  await page.getByRole("button", { name: "生成方案" }).click();
  await expect(page.locator(".preview").getByText("需要授权", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__permissionRequests)).toContainEqual({
    permissions: ["scripting"],
    origins: ["https://example.com/*", "https://docs.example.org/*"]
  });
});

test("page summary permission denial stops generation", async ({ page }) => {
  await page.addInitScript(() => {
    let settings = {
      organizeMode: "current_window",
      targetWindowMode: "current_window",
      existingGroupMode: "preserve_existing_groups",
      reviewGroupMode: "create_review_group",
      undoTargetWindowMode: "leave_empty_target_window",
      pageContextMode: "off",
      hostPermissionRequestMode: "never",
      pageSamplingConsentMode: "not_acknowledged",
      urlPrivacyMode: "sanitized_url",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: true,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      promptPreset: "conservative",
      plannerProvider: "gateway",
      rememberProviderKeys: false,
      gatewayBaseUrl: "",
      gatewayModel: "gpt-5.5",
      gatewayThinkingIntensity: "high",
      gatewayApiKey: "",
      customPrompt: ""
    };
    window.__permissionRequests = [];
    window.__startAnalyzeCalled = false;
    window.chrome = {
      permissions: {
        contains: async (request) => Boolean(request.origins?.includes("https://cliproxy.sylvanyu.io/*")),
        request: async (request) => {
          window.__permissionRequests.push(request);
          return false;
        }
      },
      windows: {
        get: async () => ({
          id: 77,
          type: "normal",
          tabs: [{ id: 10, title: "Login", url: "https://example.com/signin", active: true }]
        })
      },
      runtime: {
        sendMessage: async (message) => {
          if (message.type === "settings:get") return { ok: true, result: settings };
          if (message.type === "settings:save") {
            settings = message.settings;
            return { ok: true, result: settings };
          }
          if (message.type === "tabs:getActiveJob") return { ok: true, result: null };
          if (message.type === "tabs:startAnalyze") {
            window.__startAnalyzeCalled = true;
            return { ok: true, result: { operationId: "should_not_start" } };
          }
          return { ok: true, result: null };
        }
      }
    };
  });

  await page.goto(`${baseUrl}/src/sidepanel/index.html?sourceWindowId=77`);
  await page.locator("#ackSampling").check();
  await page.getByRole("button", { name: "生成方案" }).click();
  await expect(page.locator("#statusText")).toHaveText("需要授权页面摘要权限，才能读取网页文字摘要。");
  await expect.poll(() => page.evaluate(() => window.__permissionRequests.length)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.__startAnalyzeCalled)).toBe(false);
});

test("generation progress follows the background job after start", async ({ page }) => {
  await page.addInitScript(() => {
    const settings = {
      organizeMode: "current_window",
      targetWindowMode: "current_window",
      existingGroupMode: "preserve_existing_groups",
      reviewGroupMode: "create_review_group",
      undoTargetWindowMode: "leave_empty_target_window",
      pageContextMode: "off",
      hostPermissionRequestMode: "never",
      pageSamplingConsentMode: "not_acknowledged",
      urlPrivacyMode: "sanitized_url",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: false,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      promptPreset: "conservative",
      plannerProvider: "gateway",
      rememberProviderKeys: false,
      gatewayBaseUrl: "",
      gatewayModel: "gpt-5.5",
      gatewayThinkingIntensity: "high",
      gatewayApiKey: "",
      customPrompt: ""
    };
    const runningJob = {
      operationId: "job_background_progress",
      status: "running",
      phase: "planning",
      progress: 40,
      message: "正在生成 AI 方案",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const completeJob = {
      ...runningJob,
      status: "complete",
      phase: "complete",
      progress: 100,
      message: "方案好了，可以先检查"
    };
    const finalJob = {
      validation: { ok: true, warnings: [] },
      preview: {
        requiresConfirmation: false,
        groups: [{ title: "后台进度", reason: "Mock plan.", tabCount: 2 }],
        reviewTabsCount: 0,
        excludedTabsCount: 0,
        lockedGroupsCount: 0,
        warnings: []
      }
    };
    window.__messageTypes = [];
    window.__activeJobPolls = 0;
    window.__started = false;
    window.chrome = {
      runtime: {
        sendMessage: async (message) => {
          window.__messageTypes.push(message.type);
          if (message.type === "settings:get") return { ok: true, result: settings };
          if (message.type === "settings:save") return { ok: true, result: message.settings };
          if (message.type === "tabs:startAnalyze") {
            window.__started = true;
            return { ok: true, result: { operationId: runningJob.operationId } };
          }
          if (message.type === "tabs:getActiveJob") {
            if (!window.__started) return { ok: true, result: null };
            window.__activeJobPolls += 1;
            return { ok: true, result: window.__activeJobPolls < 2 ? runningJob : completeJob };
          }
          if (message.type === "tabs:getLastJob") return { ok: true, result: finalJob };
          return { ok: true, result: null };
        }
      }
    };
  });

  await page.goto(`${baseUrl}/src/sidepanel/index.html`);
  await page.getByRole("button", { name: "生成方案" }).click();
  await expect(page.locator("#progressLabel")).toContainText("正在生成 AI 方案");
  await expect(page.locator("#progressPercent")).not.toHaveText("16%");
  await expect(page.locator(".preview").getByText("后台进度", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__messageTypes.includes("tabs:analyze"))).toBe(false);
});

test("page sampling permission request returns to the floating window flow", async ({ page }) => {
  await page.addInitScript(() => {
    const settings = {
      organizeMode: "current_window",
      targetWindowMode: "current_window",
      existingGroupMode: "preserve_existing_groups",
      reviewGroupMode: "create_review_group",
      undoTargetWindowMode: "leave_empty_target_window",
      pageContextMode: "all_granted_origins",
      hostPermissionRequestMode: "ask_for_all_visible_origins",
      pageSamplingConsentMode: "acknowledged_for_session",
      urlPrivacyMode: "sanitized_url",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: false,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      promptPreset: "conservative",
      plannerProvider: "gateway",
      rememberProviderKeys: false,
      gatewayBaseUrl: "",
      gatewayModel: "gpt-5.5",
      gatewayThinkingIntensity: "high",
      gatewayApiKey: "",
      customPrompt: ""
    };
    window.__permissionRequests = [];
    const activeJob = {
      operationId: "job_page_sampling",
      status: "complete",
      phase: "complete",
      progress: 100,
      message: "方案好了，可以先检查",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const job = {
      validation: { ok: true, warnings: [] },
      preview: {
        requiresConfirmation: false,
        groups: [{ title: "页面摘要辅助", reason: "Mock plan.", tabCount: 1 }],
        reviewTabsCount: 0,
        excludedTabsCount: 0,
        lockedGroupsCount: 0,
        warnings: []
      }
    };
    window.chrome = {
      permissions: {
        contains: async (request) => Boolean(request.origins?.includes("https://cliproxy.sylvanyu.io/*")),
        request: async (request) => {
          window.__permissionRequests.push(request);
          return true;
        }
      },
      runtime: {
        sendMessage: async (message) => {
          if (message.type === "settings:get") return { ok: true, result: settings };
          if (message.type === "settings:save") return { ok: true, result: message.settings };
          if (message.type === "tabs:getActiveJob") return { ok: true, result: activeJob };
          if (message.type === "tabs:getLastJob") return { ok: true, result: job };
          if (message.type === "tabs:startAnalyze") return { ok: true, result: { operationId: activeJob.operationId } };
          return { ok: true, result: null };
        }
      }
    };
  });

  await page.goto(`${baseUrl}/src/sidepanel/index.html`);
  await page.getByRole("button", { name: "生成方案" }).click();
  await expect(page.locator(".preview").getByText("页面摘要辅助", { exact: true })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__permissionRequests.map((request) => request.permissions || [])))
    .toEqual([["scripting"]]);
});

function contentType(filePath) {
  switch (extname(filePath)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}
