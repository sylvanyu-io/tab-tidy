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

test("popup renders settings and mock preview", async ({ page }) => {
  await page.goto(`${baseUrl}/src/sidepanel/index.html`);

  await expect(page.getByRole("heading", { name: "Tab Tidy" })).toBeVisible();
  await expect(page.locator(".segmented")).toHaveCount(0);
  await expect(page.locator("#previewSection")).toBeHidden();
  await expect(page.locator("#samplingRisk")).toBeHidden();
  await expect(page.getByText("整理偏好")).toHaveCount(0);

  await page.locator("#ackSampling").check();
  await expect(page.locator("#samplingRisk")).toBeVisible();

  await page.getByText("更多选项").click();
  await expect(page.locator("#gatewayBaseUrl")).toHaveValue("");
  await expect(page.locator("#gatewayBaseUrl")).toHaveAttribute("placeholder", "不填则使用默认服务");
  await expect(page.locator("#gatewayApiKey")).toHaveAttribute("placeholder", "默认服务无需填写");
  await expect(page.locator("#gatewayModel")).toHaveValue("gpt-5.5");
  await expect(page.locator("#gatewayThinkingIntensity")).toHaveValue("high");
  await expect(page.locator("#undoTargetWindowMode")).toHaveValue("leave_empty_target_window");
  await expect(page.locator("#hostPermissionRequestMode")).toContainText("一次授权可见站点");

  await page.getByRole("button", { name: "生成方案" }).click();
  await expect(page.locator(".preview").getByText("AI 研究", { exact: true })).toBeVisible();
  await expect(page.locator(".preview").getByText("当前项目", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "开始整理" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "撤销" })).toBeHidden();

  await page.getByRole("button", { name: "开始整理" }).click();
  await expect(page.getByRole("button", { name: "撤销" })).toBeVisible();
});

test("popup shows optimistic progress while waiting for AI", async ({ page }) => {
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
    /(理解标题线索|寻找相邻任务|避开域名硬分组|检查待确认页|整理分组边界) · \d+秒/
  );
  const displayedProgress = await page.locator("#progressFill").evaluate((element) => Number.parseFloat(element.style.width));
  expect(displayedProgress).toBeGreaterThan(45);
  await expect(page.getByRole("button", { name: "取消" })).toBeVisible();
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
