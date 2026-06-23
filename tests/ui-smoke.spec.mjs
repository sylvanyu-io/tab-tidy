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

test("side panel renders settings and mock preview", async ({ page }) => {
  await page.goto(`${baseUrl}/src/sidepanel/index.html`);

  await expect(page.getByRole("heading", { name: "Tab Tidy" })).toBeVisible();
  await expect(page.locator("#previewSection")).toBeHidden();
  await expect(page.locator("#samplingRisk")).toBeHidden();

  await page.getByText("整理偏好").click();
  await page.locator("#ackSampling").check();
  await expect(page.locator("#samplingRisk")).toBeVisible();

  await page.getByText("更多选项").click();
  await expect(page.locator("#openaiBaseUrl")).toHaveValue("https://api.openai.com/v1");

  await page.getByRole("button", { name: "生成方案" }).click();
  await expect(page.locator(".preview").getByText("AI 研究", { exact: true })).toBeVisible();
  await expect(page.locator(".preview").getByText("当前项目", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "开始整理" })).toBeEnabled();
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
