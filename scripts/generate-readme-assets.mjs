import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { chromium } from "@playwright/test";

const rootDir = resolve(".");
const assetDir = resolve(rootDir, "docs/assets");
await mkdir(assetDir, { recursive: true });

const server = createServer(async (request, response) => {
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
const baseUrl = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();

try {
  await renderPanelShot("readme-panel.png", { preview: false });
  await renderPanelShot("readme-preview.png", { preview: true });
  await renderShowcase();
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}

console.log(`Generated README assets in ${assetDir}`);

async function renderPanelShot(filename, { preview }) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 560 },
    deviceScaleFactor: 2,
    colorScheme: "light"
  });
  const page = await context.newPage();
  await installChromeMock(page);
  await page.goto(`${baseUrl}/src/sidepanel/index.html?sourceWindowId=42`);
  await page.evaluate(() => document.fonts?.ready);
  await focusCapturePage(page);
  await waitForPrimaryActionPaint(page, "#analyzeBtn");

  if (preview) {
    await page.locator("#analyzeBtn").click();
    await page.locator("#previewSection").waitFor({ state: "visible" });
    await focusCapturePage(page);
    await waitForPrimaryActionPaint(page, "#applyBtn");
  }

  await page.screenshot({
    path: resolve(assetDir, filename),
    clip: { x: 0, y: 0, width: 390, height: 560 }
  });
  await context.close();
}

async function focusCapturePage(page) {
  await page.bringToFront();
  await page.mouse.move(6, 6);
  await page.evaluate(() => {
    window.focus();
  });
  await page.waitForTimeout(80);
}

async function waitForPrimaryActionPaint(page, selector) {
  const button = page.locator(selector);
  await button.waitFor({ state: "visible" });
  await page.waitForTimeout(160);
}

async function renderShowcase() {
  const context = await browser.newContext({
    viewport: { width: 1180, height: 640 },
    deviceScaleFactor: 2
  });
  const page = await context.newPage();
  await page.setContent(
    `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          * { box-sizing: border-box; }
          body {
            margin: 0;
            min-height: 100vh;
            display: grid;
            place-items: center;
            background: transparent;
            color: #1c1914;
            font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Avenir Next", "Segoe UI", sans-serif;
          }
          .showcase {
            width: 1120px;
            height: 590px;
            display: grid;
            grid-template-columns: 370px 1fr;
            gap: 26px;
            align-items: center;
            padding: 30px;
            border: 3px solid #2a261f;
            border-radius: 34px;
            background: #fffaf0;
            box-shadow: 10px 10px 0 rgba(42, 38, 31, 0.14);
          }
          .copy {
            align-self: stretch;
            display: grid;
            align-content: center;
            gap: 20px;
          }
          .logo {
            width: 340px;
            height: auto;
            display: block;
          }
          h1 {
            margin: 0;
            font-size: 40px;
            line-height: 1.08;
            letter-spacing: 0;
          }
          p {
            margin: 0;
            color: #706755;
            font-size: 18px;
            line-height: 1.38;
            font-weight: 700;
          }
          .principles {
            display: grid;
            gap: 10px;
            max-width: 340px;
          }
          .principle {
            display: grid;
            grid-template-columns: auto 1fr;
            gap: 10px;
            align-items: start;
            padding: 10px 12px;
            border: 2px solid #2a261f;
            border-radius: 16px;
            background: #fffaf0;
            box-shadow: 3px 3px 0 rgba(42, 38, 31, 0.1);
          }
          .principle i {
            display: block;
            width: 24px;
            height: 18px;
            margin-top: 2px;
            border: 2px solid #2a261f;
            border-radius: 8px;
            background: var(--tone);
            box-shadow: 2px 2px 0 rgba(42, 38, 31, 0.12);
          }
          .principle strong {
            display: block;
            color: #1c1914;
            font-size: 16px;
            line-height: 1.15;
            font-weight: 900;
          }
          .principle span {
            display: block;
            margin-top: 3px;
            color: #706755;
            font-size: 13px;
            line-height: 1.25;
            font-weight: 760;
          }
          .shots {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 18px;
            align-items: center;
          }
          .shot {
            width: 100%;
            max-height: 540px;
            object-fit: contain;
            border: 2px solid #2a261f;
            border-radius: 28px;
            box-shadow: 7px 7px 0 rgba(42, 38, 31, 0.14);
            background: #f3efe3;
          }
        </style>
      </head>
      <body>
        <main class="showcase">
          <section class="copy">
            <img class="logo" src="${baseUrl}/docs/assets/logo.svg" alt="TabRecap" />
            <h1>AI 标签整理与工作回顾</h1>
            <p>整理混乱标签页，再从本地活动线索回顾最近主要在忙什么。</p>
            <div class="principles" aria-label="TabRecap principles">
              <div class="principle" style="--tone:#d94a32">
                <i aria-hidden="true"></i>
                <div><strong>自动整理</strong><span>按任务、主题和项目归类标签页</span></div>
              </div>
              <div class="principle" style="--tone:#c9ff4a">
                <i aria-hidden="true"></i>
                <div><strong>回顾线索</strong><span>今天、7 天、30 天，看看主要在做什么</span></div>
              </div>
              <div class="principle" style="--tone:#1f55ff">
                <i aria-hidden="true"></i>
                <div><strong>确认后再动</strong><span>先预览方案，不满意就回退</span></div>
              </div>
            </div>
          </section>
          <section class="shots" aria-label="TabRecap screenshots">
            <img class="shot" src="${baseUrl}/docs/assets/readme-panel.png" alt="TabRecap setup panel" />
            <img class="shot" src="${baseUrl}/docs/assets/readme-preview.png" alt="TabRecap preview panel" />
          </section>
        </main>
      </body>
    </html>`,
    { waitUntil: "load" }
  );
  await page.locator(".showcase").screenshot({
    path: resolve(assetDir, "readme-hero-cn.png"),
    omitBackground: true
  });
  await context.close();
}

async function installChromeMock(page) {
  await page.addInitScript(() => {
    const settings = {
      organizeMode: "consolidate_one_window",
      targetWindowMode: "current_window",
      existingGroupMode: "preserve_existing_groups",
      reviewGroupMode: "create_review_group",
      undoTargetWindowMode: "leave_empty_target_window",
      pageContextMode: "ambiguous_with_permission",
      hostPermissionRequestMode: "ask_for_all_visible_origins",
      pageSamplingConsentMode: "acknowledged_for_session",
      urlPrivacyMode: "sanitized_url",
      includePinnedTabs: false,
      includeIncognitoTabs: false,
      collapseGroupsAfterApply: true,
      continuousPageSummaries: false,
      minConfidenceToApply: 0.65,
      maxTabsPerGroup: 40,
      languageMode: "zh-CN",
      promptPreset: "conservative",
      plannerProvider: "gateway",
      rememberProviderKeys: false,
      gatewayBaseUrl: "",
      gatewayModel: "gpt-5.5",
      gatewayCustomModel: "",
      gatewayThinkingIntensity: "high",
      gatewayApiKey: "",
      customPrompt: "找工作、AI 论文、当前项目分开；拿不准的先放到待分类。"
    };
    const activeJob = {
      operationId: "readme_252_tabs",
      status: "complete",
      phase: "complete",
      progress: 100,
      message: "方案好了，可以先检查",
      tabCount: 252,
      windowCount: 5,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString()
    };
    const job = {
      operationId: activeJob.operationId,
      status: "complete",
      settings,
      validation: { ok: true, warnings: [] },
      preview: {
        languageMode: "zh-CN",
        requiresConfirmation: true,
        groups: [
          { title: "AI 编程与 Agent", reason: "Claude Code、MCP、工具链和调试材料。", tabCount: 39 },
          { title: "模型与论文研究", reason: "LLM、评测、论文和实验记录。", tabCount: 34 },
          { title: "当前项目工作流", reason: "Issue、PR、文档、CI 和本地调试页面。", tabCount: 31 },
          { title: "产品与设计参考", reason: "竞品、截图、交互模式和发布素材。", tabCount: 48 },
          { title: "购物、账单与账户", reason: "购买记录、订阅、支付和账户设置。", tabCount: 42 },
          { title: "旅行与生活资料", reason: "地图、预订、攻略和日常待办。", tabCount: 28 }
        ],
        totalTabsCount: 253,
        eligibleTabsCount: 252,
        windowCount: 5,
        groupedTabsCount: 222,
        reviewTabsCount: 30,
        reviewGroupWillBeCreated: true,
        excludedTabsCount: 1,
        lockedGroupsCount: 0,
        pageSampling: {
          requested: 67,
          ok: 12,
          permissionRequired: 0,
          blocked: 55
        },
        warnings: []
      }
    };
    window.__analysisStarted = false;

    window.chrome = {
      permissions: {
        contains: async () => true,
        request: async () => true
      },
      windows: {
        get: async () => ({ id: 42, type: "normal", tabs: [] }),
        getCurrent: async () => ({ id: 42, type: "normal", tabs: [] }),
        getLastFocused: async () => ({ id: 42, type: "normal", tabs: [] }),
        getAll: async () => Array.from({ length: 5 }, (_, index) => ({ id: index + 1, type: "normal", tabs: [] }))
      },
      runtime: {
        getManifest: () => ({
          optional_permissions: ["scripting"],
          optional_host_permissions: ["https://*/*", "http://*/*"]
        }),
        sendMessage: async (message) => {
          if (message.type === "settings:get") return { ok: true, result: settings };
          if (message.type === "settings:save") return { ok: true, result: { ...settings, ...message.settings } };
          if (message.type === "tabs:startAnalyze") {
            window.__analysisStarted = true;
            return { ok: true, result: { operationId: activeJob.operationId } };
          }
          if (message.type === "tabs:getActiveJob") return { ok: true, result: window.__analysisStarted ? activeJob : null };
          if (message.type === "tabs:getLastJob") return { ok: true, result: job };
          if (message.type === "progressCopy:generate") return { ok: true, result: { messages: [] } };
          return { ok: true, result: null };
        }
      }
    };
  });
}

function contentType(filePath) {
  switch (extname(filePath)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".svg":
      return "image/svg+xml; charset=utf-8";
    case ".png":
      return "image/png";
    default:
      return "application/octet-stream";
  }
}
