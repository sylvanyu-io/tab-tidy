import { BUILTIN_GATEWAY_BASE_URL, GATEWAY_CUSTOM_MODEL_VALUE } from "../shared/settings.js";
import { isReviewLikeGroup, localizedText, reviewGroupReason, reviewGroupTitle } from "../shared/language.js";
import { shouldShowPageSampleCount } from "../shared/page-sampling-copy.js";

const UI_LANGUAGE_STORAGE_KEY = "tabTidy.uiLanguage";
const UI_LANGUAGES = Object.freeze(["zh-CN", "en-US"]);
const UI_COPY = Object.freeze({
  "zh-CN": {
    "document.title": "Tab Tidy",
    "status.default": "AI 标签页整理",
    "status.saved": "偏好已保存",
    "status.requestingPageSummaryPermission": "正在请求页面摘要权限",
    "status.pageSummaryEnabled": "页面摘要已开启",
    "status.preparing": "正在准备整理",
    "status.checkingPermissions": "正在检查权限",
    "status.checkingPageSummaryPermissions": "正在检查页面摘要权限",
    "status.resolvingWindow": "正在确认当前窗口",
    "status.startingBackground": "正在启动后台整理",
    "status.planReady": "方案好了，可以先检查",
    "status.planNeedsReview": "方案需要检查",
    "status.canceled": "已取消整理。",
    "status.canceling": "正在取消整理",
    "status.organizing": "正在整理标签页",
    "status.organizingChanged": "正在整理变化后的标签页",
    "status.undoing": "正在撤销",
    "status.previousFailed": "上次生成失败，请重新生成",
    "status.previousCanceled": "上次整理已取消",
    "status.noTabs": "没有可整理的标签页。",
    "status.generatedButMissingPreview": "方案已生成，但预览数据没有保存成功。",
    "status.backgroundNotStarted": "后台整理任务没有启动，请重试。",
    "status.anotherJobRunning": "后台已有另一个整理任务，请先取消或等待它完成。",
    "status.notComplete": "整理没有完成。",
    "status.permissionAiGateway": "需要授权这个 AI 服务地址，才能发送整理请求。",
    "status.permissionContinuousSummary": "需要授权网页读取权限后，才能持续积累页面摘要。",
    "status.permissionPageSummary": "需要授权页面摘要权限，才能读取网页文字摘要。",
    "status.permissionFirstEnablePageSummary": "需要先打开「需要时补读页面摘要」并完成授权，才能读取页面摘要。",
    "status.unsupportedContinuousSummary": "当前安装包没有开启长期页面摘要。",
    "status.unsupportedPageSummary": "当前安装包没有开启页面摘要。",
    "status.customModelNeedsGateway": "自定义模型名需要先填写自定义 AI 网关地址。",
    "status.customModelMissing": "请填写自定义模型名，或者选择一个预设模型。",
    "status.applyChanged": "已创建 {groupCount} 个分组；已处理 {changedTabs} 个变化标签页{reviewText}",
    "status.applyDone": "已创建 {groupCount} 个分组",
    "status.applyReviewSuffix": "，{reviewCount} 个放进「{reviewTitle}」",
    "status.undoDone": "已恢复 {count} 个标签页",
    "status.noPlanToApply": "还没有可应用的方案，请先生成方案。",
    "status.noRollback": "还没有可回退的记录。",
    "status.invalidPlan": "当前方案不可用，请重新生成。",
    "status.progressCopyFailed": "提示文案生成失败，请稍后重试。",
    "button.generate": "生成方案",
    "button.regenerate": "重新生成",
    "button.cancel": "取消",
    "button.apply": "开始整理",
    "button.undo": "撤销",
    "button.language": "EN",
    "button.languageAria": "切换界面为英文",
    "scope.label": "范围",
    "scope.currentWindow": "当前窗口",
    "scope.allWindows": "所有窗口",
    "scope.nativeLabel": "整理范围",
    "scope.optionCurrent": "只整理当前窗口",
    "scope.optionAll": "合并并整理所有窗口",
    "sampling.title": "需要时补读页面摘要",
    "sampling.subtitle": "读取少量网页文字，帮助 AI 判断主题",
    "sampling.tooltip": "会把标题、描述、标题层级和页面上的正文或讨论摘录发送给 AI 用于整理；不会读取密码、表单内容、Cookie、本地存储或完整 HTML。休眠标签页不会被唤醒。",
    "sampling.aria": "页面摘要说明",
    "continuous.title": "长期积累页面摘要",
    "continuous.subtitle": "本机保存短摘要，之后整理和回顾更准",
    "continuous.tooltip": "开启后浏览器会请求网页读取权限；之后会在后台给打开过的、未休眠、非无痕页面保存短摘要。整理时，相关摘要会发送给 AI 辅助归类；不会主动唤醒标签页。",
    "continuous.aria": "持续摘要说明",
    "activity.summary": "清理助手",
    "activity.title": "先找出可能不再需要的标签页",
    "activity.subtitle": "按时间、分组和页面内容给出建议，你来决定关不关。",
    "activity.rangeAria": "清理建议时间范围",
    "activity.day": "1 天",
    "activity.week": "7 天",
    "activity.month": "30 天",
    "activity.empty": "还没有清理建议。",
    "activity.loading": "正在判断哪些标签页值得回头看",
    "activity.none": "还没有足够记录。打开一段时间后，这里会更准。",
    "activity.coverage": "已看过 {total} 个打开的标签页，整理出 {stale} 个可以先检查的页面。",
    "activity.focus": "近期线索",
    "activity.sites": "常见站点",
    "activity.recent": "最近页面",
    "activity.stale": "建议先检查",
    "activity.staleHint": "这些只是建议；Tab Tidy 不会替你关闭标签页。",
    "activity.noStale": "暂时没有明显该清理的标签页。",
    "activity.focusTab": "去看看",
    "activity.focusTabAria": "定位标签页：{title}",
    "activity.focused": "已定位标签页",
    "activity.focusFailed": "标签页可能已经关闭，请刷新清理建议。",
    "activity.firstSeen": "首次见到 {age}",
    "activity.lastActive": "最近活跃 {age}",
    "activity.seenCount": "记录 {count} 次",
    "activity.group": "分组：{group}",
    "activity.noGroup": "未分组",
    "activity.summaryClue": "线索：{text}",
    "activity.aiReason": "为什么：{text}",
    "activity.priority.high": "优先看",
    "activity.priority.medium": "可以看",
    "activity.priority.low": "低优先级",
    "customPrompt.label": "自定义要求",
    "customPrompt.placeholder": "例如：找工作、AI 论文、当前项目分开；拿不准的先放到待分类。",
    "advanced.summary": "更多选项",
    "switch.dissolve.title": "重新整理已有分组",
    "switch.dissolve.subtitle": "已有分组也会纳入这次整理",
    "switch.review.title": "使用待分类分组",
    "switch.review.subtitle": "拿不准的页面先集中放好",
    "switch.pinned.title": "包含固定标签页",
    "switch.pinned.subtitle": "会参与移动和分组",
    "switch.incognito.title": "包含无痕标签页",
    "switch.incognito.subtitle": "只在浏览器允许时生效",
    "switch.collapse.title": "整理后收起分组",
    "switch.collapse.subtitle": "新分组默认折叠",
    "field.urlPrivacy": "发送给 AI 的网址信息",
    "field.pageContext": "页面摘要读取范围",
    "field.hostPermission": "站点授权",
    "field.resultLanguage": "结果语言",
    "field.promptPreset": "整理方式",
    "field.gatewayModel": "AI 模型",
    "field.thinking": "思考强度",
    "field.customModel": "自定义模型名",
    "field.gatewayUrl": "AI 网关地址（可选）",
    "field.gatewayKey": "AI 网关密钥（可选）",
    "field.rememberKey": "记住自定义密钥",
    "field.rememberKeyHint": "只保存在这台电脑",
    "field.minConfidence": "最低置信度",
    "field.maxTabs": "单组最大数量",
    "placeholder.customModel": "例如：glm-5.2、deepseek-v4-pro",
    "placeholder.gatewayUrl": "不填则使用默认服务",
    "placeholder.gatewayKey": "默认服务无需填写",
    "option.newWindow": "新窗口",
    "option.currentWindow": "当前窗口",
    "option.preserveGroups": "保留",
    "option.dissolveGroups": "重新整理",
    "option.reviewCreate": "使用待分类分组",
    "option.reviewUngrouped": "放入最接近主题",
    "option.leaveEmpty": "保留空窗口",
    "option.closeEmpty": "关闭本次创建的空窗口",
    "option.urlTitleOnly": "只发标题",
    "option.urlSanitized": "精简网址",
    "option.urlFull": "完整网址",
    "option.pageOff": "不补读页面摘要",
    "option.pageAmbiguous": "只读拿不准的页面",
    "option.pageGranted": "尽量读取已授权页面",
    "option.permissionNever": "整理时不弹授权",
    "option.permissionOrigin": "按站点询问",
    "option.permissionVisible": "一次授权可见站点",
    "option.langAuto": "跟随界面",
    "option.langZh": "简体中文",
    "option.langEn": "English",
    "option.presetConservative": "智能整理",
    "option.presetMedia": "媒体类型",
    "option.presetReadLater": "稍后阅读",
    "option.presetAggressive": "强力归纳",
    "option.customModel": "自定义模型名",
    "option.thinkingLow": "低",
    "option.thinkingMedium": "中",
    "option.thinkingHigh": "高",
    "option.thinkingUltra": "超高",
    "preview.step": "整理预览",
    "preview.heading": "即将创建的分组",
    "preview.pending": "待生成",
    "preview.empty": "还没有方案。",
    "preview.error": "出错",
    "error.heading": "生成失败",
    "error.retryHint": "检查提示后可以重新生成。",
    "preview.emptyCount": "空",
    "details.summary": "诊断信息",
    "confirm.applyMultiWindow": "这会移动多个窗口里的标签页，并创建浏览器分组。确认开始整理吗？",
    "confirm.changedHeader": "标签页在预览后发生了变化。",
    "confirm.newToReview": "{count} 个新增标签页会放进「{reviewTitle}」。",
    "confirm.newUngrouped": "{count} 个新增标签页会放进最接近的分组。",
    "confirm.changedContent": "{count} 个页面内容已变化，会按当前状态重新纳入整理。",
    "confirm.removed": "{count} 个已关闭的标签页会跳过。",
    "confirm.duplicate": "{count} 个重复引用会跳过。",
    "confirm.continue": "确认继续整理吗？",
    "aiWait.planning": ["理解标题线索", "寻找相邻任务", "避开域名硬分组", "检查不确定页", "整理分组边界"],
    "aiWait.coarse_planning": ["快速扫一遍", "寻找跨窗口主题", "拆出主题方向", "标记模糊标签"],
    "aiWait.refining": ["拆开过大的组", "复核模糊边界", "合并同一任务", "保留原始顺序"],
    "aiWait.retrying": ["修正校验问题", "补齐遗漏标签", "移除重复分配", "重新检查结构"]
  },
  "en-US": {
    "document.title": "Tab Tidy",
    "status.default": "AI tab organizer",
    "status.saved": "Preferences saved",
    "status.requestingPageSummaryPermission": "Requesting page-summary access",
    "status.pageSummaryEnabled": "Page summaries enabled",
    "status.preparing": "Preparing organization",
    "status.checkingPermissions": "Checking permissions",
    "status.checkingPageSummaryPermissions": "Checking page-summary access",
    "status.resolvingWindow": "Finding the current window",
    "status.startingBackground": "Starting background organization",
    "status.planReady": "Plan ready to review",
    "status.planNeedsReview": "Plan needs review",
    "status.canceled": "Organization canceled.",
    "status.canceling": "Canceling organization",
    "status.organizing": "Organizing tabs",
    "status.organizingChanged": "Organizing changed tabs",
    "status.undoing": "Undoing changes",
    "status.previousFailed": "Last generation failed. Try again.",
    "status.previousCanceled": "Last organization run was canceled",
    "status.noTabs": "No tabs to organize.",
    "status.generatedButMissingPreview": "The plan finished, but the preview was not saved.",
    "status.backgroundNotStarted": "The background organization did not start. Try again.",
    "status.anotherJobRunning": "Another organization run is active. Cancel it or wait for it to finish.",
    "status.notComplete": "Organization did not finish.",
    "status.permissionAiGateway": "Allow access to this AI gateway before sending the organization request.",
    "status.permissionContinuousSummary": "Allow page-reading access before accumulating page summaries.",
    "status.permissionPageSummary": "Allow page-summary access before reading page text summaries.",
    "status.permissionFirstEnablePageSummary": "Turn on page summaries and grant access before reading page summaries.",
    "status.unsupportedContinuousSummary": "This installation does not include page memory.",
    "status.unsupportedPageSummary": "This installation does not include page summaries.",
    "status.customModelNeedsGateway": "Custom model names require a custom AI gateway URL.",
    "status.customModelMissing": "Enter a custom model name, or choose a preset model.",
    "status.applyChanged": "Created {groupCount} groups; handled {changedTabs} changed tabs{reviewText}",
    "status.applyDone": "Created {groupCount} groups",
    "status.applyReviewSuffix": ", {reviewCount} added to \"{reviewTitle}\"",
    "status.undoDone": "Restored {count} tabs",
    "status.noPlanToApply": "No plan is ready yet. Generate one first.",
    "status.noRollback": "No rollback snapshot is available yet.",
    "status.invalidPlan": "This plan is not ready to apply. Generate a new one.",
    "status.progressCopyFailed": "Progress captions could not be generated. Try again later.",
    "button.generate": "Generate plan",
    "button.regenerate": "Regenerate",
    "button.cancel": "Cancel",
    "button.apply": "Organize",
    "button.undo": "Undo",
    "button.language": "中",
    "button.languageAria": "Switch UI to Chinese",
    "scope.label": "Scope",
    "scope.currentWindow": "Current window",
    "scope.allWindows": "All windows",
    "scope.nativeLabel": "Organization scope",
    "scope.optionCurrent": "Organize current window only",
    "scope.optionAll": "Merge and organize all windows",
    "sampling.title": "Read page summaries when useful",
    "sampling.subtitle": "Reads a little page text so AI can judge topics",
    "sampling.tooltip": "Sends titles, descriptions, headings, and visible article or discussion excerpts to AI for organization. It will not read passwords, form values, cookies, local storage, or full HTML. Sleeping tabs are not awakened.",
    "sampling.aria": "Page summary details",
    "continuous.title": "Build page memory",
    "continuous.subtitle": "Saves short local summaries for better future runs",
    "continuous.tooltip": "Chrome will ask for page-reading access. After that, Tab Tidy saves short summaries for opened, awake, non-incognito pages in the background. Related summaries are sent to AI during organization. It will not wake sleeping tabs.",
    "continuous.aria": "Accumulated summary details",
    "activity.summary": "Cleanup helper",
    "activity.title": "Find tabs you may no longer need",
    "activity.subtitle": "Uses time, groups, and page clues. You decide what to close.",
    "activity.rangeAria": "Cleanup suggestion range",
    "activity.day": "1 day",
    "activity.week": "7 days",
    "activity.month": "30 days",
    "activity.empty": "No cleanup suggestions yet.",
    "activity.loading": "Finding tabs worth a second look",
    "activity.none": "Not enough local records yet. This gets better after Tab Tidy has observed more tabs.",
    "activity.coverage": "Checked {total} open tabs and found {stale} pages worth reviewing first.",
    "activity.focus": "Recent clues",
    "activity.sites": "Common sites",
    "activity.recent": "Recent pages",
    "activity.stale": "Start here",
    "activity.staleHint": "Suggestions only. Tab Tidy will never close tabs for you.",
    "activity.noStale": "No obvious cleanup suggestions right now.",
    "activity.focusTab": "Open",
    "activity.focusTabAria": "Find tab: {title}",
    "activity.focused": "Tab focused",
    "activity.focusFailed": "The tab may already be closed. Refresh suggestions.",
    "activity.firstSeen": "First seen {age}",
    "activity.lastActive": "Last active {age}",
    "activity.seenCount": "Seen {count} times",
    "activity.group": "Group: {group}",
    "activity.noGroup": "Ungrouped",
    "activity.summaryClue": "Clue: {text}",
    "activity.aiReason": "Why: {text}",
    "activity.priority.high": "High",
    "activity.priority.medium": "Medium",
    "activity.priority.low": "Low",
    "customPrompt.label": "Custom instructions",
    "customPrompt.placeholder": "Example: keep job search, AI papers, and current projects separate; put uncertain pages in review.",
    "advanced.summary": "More options",
    "switch.dissolve.title": "Regroup existing groups",
    "switch.dissolve.subtitle": "Existing groups are included in this run",
    "switch.review.title": "Use Needs Review group",
    "switch.review.subtitle": "Set unclear pages aside instead of forcing them",
    "switch.pinned.title": "Include pinned tabs",
    "switch.pinned.subtitle": "They may be moved and grouped",
    "switch.incognito.title": "Include incognito tabs",
    "switch.incognito.subtitle": "Only when the browser allows it",
    "switch.collapse.title": "Collapse groups after organizing",
    "switch.collapse.subtitle": "New groups start collapsed",
    "field.urlPrivacy": "URLs sent to AI",
    "field.pageContext": "Page summary reading range",
    "field.hostPermission": "Site access",
    "field.resultLanguage": "Result language",
    "field.promptPreset": "Organization mode",
    "field.gatewayModel": "AI model",
    "field.thinking": "Reasoning effort",
    "field.customModel": "Custom model name",
    "field.gatewayUrl": "AI gateway URL (optional)",
    "field.gatewayKey": "AI gateway key (optional)",
    "field.rememberKey": "Remember custom key",
    "field.rememberKeyHint": "Stored only on this computer",
    "field.minConfidence": "Minimum confidence",
    "field.maxTabs": "Max tabs per group",
    "placeholder.customModel": "Example: glm-5.2, deepseek-v4-pro",
    "placeholder.gatewayUrl": "Leave blank to use the default service",
    "placeholder.gatewayKey": "Default service does not need a key",
    "option.newWindow": "New window",
    "option.currentWindow": "Current window",
    "option.preserveGroups": "Preserve",
    "option.dissolveGroups": "Regroup",
    "option.reviewCreate": "Use Needs Review group",
    "option.reviewUngrouped": "Use closest topic",
    "option.leaveEmpty": "Keep empty window",
    "option.closeEmpty": "Close the empty window created this time",
    "option.urlTitleOnly": "Titles only",
    "option.urlSanitized": "Short URLs",
    "option.urlFull": "Full URLs",
    "option.pageOff": "Do not read page summaries",
    "option.pageAmbiguous": "Only unclear pages",
    "option.pageGranted": "Read authorized pages when possible",
    "option.permissionNever": "Do not ask while organizing",
    "option.permissionOrigin": "Ask per site",
    "option.permissionVisible": "Allow visible sites once",
    "option.langAuto": "Follow UI",
    "option.langZh": "Simplified Chinese",
    "option.langEn": "English",
    "option.presetConservative": "Smart organize",
    "option.presetMedia": "Media type",
    "option.presetReadLater": "Read later",
    "option.presetAggressive": "Bold grouping",
    "option.customModel": "Custom model name",
    "option.thinkingLow": "Low",
    "option.thinkingMedium": "Medium",
    "option.thinkingHigh": "High",
    "option.thinkingUltra": "Ultra",
    "preview.step": "Preview",
    "preview.heading": "Groups to be created",
    "preview.pending": "Pending",
    "preview.empty": "No plan yet.",
    "preview.error": "Error",
    "error.heading": "Generation failed",
    "error.retryHint": "Review the message, then generate again.",
    "preview.emptyCount": "Empty",
    "details.summary": "Diagnostics",
    "confirm.applyMultiWindow": "This will move tabs across windows and create browser tab groups. Continue?",
    "confirm.changedHeader": "Tabs changed after the preview.",
    "confirm.newToReview": "{count} new tabs will be added to \"{reviewTitle}\".",
    "confirm.newUngrouped": "{count} new tabs will be placed in the closest group.",
    "confirm.changedContent": "{count} changed tabs will be handled from their current state.",
    "confirm.removed": "{count} closed tabs will be skipped.",
    "confirm.duplicate": "{count} duplicate references will be skipped.",
    "confirm.continue": "Continue organizing?",
    "aiWait.planning": ["Reading title clues", "Finding neighboring tasks", "Avoiding domain-only groups", "Checking uncertain pages", "Tightening group edges"],
    "aiWait.coarse_planning": ["Scanning the tab set", "Finding cross-window topics", "Shaping topic lanes", "Marking fuzzy tabs"],
    "aiWait.refining": ["Breaking up large groups", "Reviewing fuzzy edges", "Merging one task", "Keeping tab order"],
    "aiWait.retrying": ["Fixing validation issues", "Filling missing tabs", "Removing duplicates", "Checking structure again"]
  }
});

const fields = {
  organizeMode: document.querySelector("#organizeMode"),
  targetWindowMode: document.querySelector("#targetWindowMode"),
  existingGroupMode: document.querySelector("#existingGroupMode"),
  reviewGroupMode: document.querySelector("#reviewGroupMode"),
  undoTargetWindowMode: document.querySelector("#undoTargetWindowMode"),
  urlPrivacyMode: document.querySelector("#urlPrivacyMode"),
  pageContextMode: document.querySelector("#pageContextMode"),
  hostPermissionRequestMode: document.querySelector("#hostPermissionRequestMode"),
  languageMode: document.querySelector("#languageMode"),
  promptPreset: document.querySelector("#promptPreset"),
  plannerProvider: document.querySelector("#plannerProvider"),
  gatewayBaseUrl: document.querySelector("#gatewayBaseUrl"),
  gatewayModel: document.querySelector("#gatewayModel"),
  gatewayCustomModel: document.querySelector("#gatewayCustomModel"),
  gatewayThinkingIntensity: document.querySelector("#gatewayThinkingIntensity"),
  gatewayApiKey: document.querySelector("#gatewayApiKey"),
  rememberProviderKeys: document.querySelector("#rememberProviderKeys"),
  customPrompt: document.querySelector("#customPrompt"),
  includePinnedTabs: document.querySelector("#includePinnedTabs"),
  includeIncognitoTabs: document.querySelector("#includeIncognitoTabs"),
  collapseGroupsAfterApply: document.querySelector("#collapseGroupsAfterApply"),
  continuousPageSummaries: document.querySelector("#continuousPageSummaries"),
  minConfidenceToApply: document.querySelector("#minConfidenceToApply"),
  maxTabsPerGroup: document.querySelector("#maxTabsPerGroup"),
  ackSampling: document.querySelector("#ackSampling")
};

const settingSwitches = [
  {
    field: "existingGroupMode",
    input: document.querySelector("#dissolveExistingGroupsToggle"),
    offValue: "preserve_existing_groups",
    onValue: "dissolve_existing_groups"
  },
  {
    field: "reviewGroupMode",
    input: document.querySelector("#createReviewGroupToggle"),
    offValue: "leave_review_ungrouped",
    onValue: "create_review_group"
  }
];

const AI_WAIT_PHASES = new Set(["planning", "coarse_planning", "refining", "retrying"]);
const AI_WAIT_RAMP_MS = 45000;
const AI_WAIT_COPY_INTERVAL_SECONDS = 4;
const ACTIVE_JOB_POLL_MS = 600;
const GENERATED_COPY_CACHE_LIMIT = 4;

const nodes = {
  appShell: document.querySelector(".app-shell"),
  statusText: document.querySelector("#statusText"),
  samplingRisk: document.querySelector("#samplingRisk"),
  continuousSummaryRisk: document.querySelector("#continuousSummaryRisk"),
  hostPermissionField: document.querySelector("#hostPermissionField"),
  progressBar: document.querySelector("#progressBar"),
  progressFill: document.querySelector("#progressFill"),
  progressLabel: document.querySelector("#progressLabel"),
  progressPercent: document.querySelector("#progressPercent"),
  uiLanguageToggle: document.querySelector("#uiLanguageToggle"),
  actions: document.querySelector(".actions"),
  analyzeBtn: document.querySelector("#analyzeBtn"),
  cancelBtn: document.querySelector("#cancelBtn"),
  applyBtn: document.querySelector("#applyBtn"),
  undoBtn: document.querySelector("#undoBtn"),
  previewSection: document.querySelector("#previewSection"),
  previewCount: document.querySelector("#previewCount"),
  previewRoot: document.querySelector("#previewRoot"),
  detailsRoot: document.querySelector("#detailsRoot"),
  detailsText: document.querySelector("#detailsText"),
  gatewayCustomModelField: document.querySelector("#gatewayCustomModelField"),
  activityPanel: document.querySelector(".activity-panel"),
  activityResult: document.querySelector("#activityResult")
};

let uiLanguage = readStoredUiLanguage() || browserUiLanguage();
let currentStatus = { key: "status.default", params: {}, text: "", isError: false };
let lastPreview = null;
let lastError = null;
let lastCanApply = false;
let canUndo = false;
let pageSamplingOriginCache = { origins: [], refreshedAt: 0 };
let pageSamplingOriginRefreshTimer = null;
let progressPollTimer = null;
let mockActiveJob = null;
let mockLastJob = null;
let panelWindowId = null;
const generatedCopyByOperation = new Map();
const generatedCopyRequests = new Set();

init().catch((error) => setStatus(error.message, true));

async function init() {
  applyUiLanguage();
  panelWindowId = await resolveInvocationWindowId();
  bindEvents();
  bindSettingSwitches();
  bindChoiceGroups();

  const settings = await sendMessage({ type: "settings:get" });
  writeSettings(settings);
  updateConditionalUi();
  schedulePageSamplingOriginRefresh();
  await hydrateActiveJob();
  await hydrateUndoState();
  syncActionState();
}

function bindEvents() {
  for (const element of Object.values(fields)) {
    if (element === fields.ackSampling || element === fields.continuousPageSummaries) continue;
    element.addEventListener("change", persistSettings);
  }
  fields.ackSampling.addEventListener("change", async () => {
    if (fields.ackSampling.checked) {
      if (fields.pageContextMode.value === "off" || fields.pageContextMode.value === "active_tab_only") {
        fields.pageContextMode.value = "ambiguous_with_permission";
      }
      if (fields.hostPermissionRequestMode.value === "never") {
        fields.hostPermissionRequestMode.value = "ask_for_all_visible_origins";
      }
      updateConditionalUi();
      setStatusKey("status.requestingPageSummaryPermission");
      try {
        await ensurePageSamplingPermissions(readSettings({ effectiveForAnalysis: true }), { requestMissing: true });
      } catch (error) {
        fields.ackSampling.checked = false;
        fields.hostPermissionRequestMode.value = "never";
        updateConditionalUi();
        await persistSettings();
        setStatus(error.message, true);
        return;
      }
      await persistSettings();
      setStatusKey("status.pageSummaryEnabled");
      return;
    }
    await persistSettings();
  });
  fields.continuousPageSummaries.addEventListener("change", async () => {
    if (fields.continuousPageSummaries.checked) {
      try {
        await ensureContinuousSummaryPermissions();
      } catch (error) {
        fields.continuousPageSummaries.checked = false;
        await persistSettings();
        setStatus(error.message, true);
        return;
      }
    }
    await persistSettings();
  });
  fields.customPrompt.addEventListener("input", debounce(persistSettings, 250));
  fields.gatewayCustomModel.addEventListener("input", debounce(persistSettings, 250));
  fields.pageContextMode.addEventListener("change", updateConditionalUi);
  fields.organizeMode.addEventListener("change", updateConditionalUi);
  fields.plannerProvider.addEventListener("change", updateConditionalUi);
  fields.gatewayModel.addEventListener("change", updateConditionalUi);

  nodes.analyzeBtn.addEventListener("click", handleAnalyzeClick);
  nodes.cancelBtn.addEventListener("click", cancelAnalyze);
  nodes.applyBtn.addEventListener("click", applyLastPlan);
  nodes.undoBtn.addEventListener("click", undoLastApply);
  nodes.uiLanguageToggle?.addEventListener("click", toggleUiLanguage);
  document.querySelectorAll("[data-activity-range]").forEach((button) => {
    button.addEventListener("click", () => loadActivityOverview(Number(button.dataset.activityRange)));
  });
}

function t(key, params = {}) {
  const template = UI_COPY[uiLanguage]?.[key] ?? UI_COPY["zh-CN"][key] ?? key;
  if (Array.isArray(template)) return template;
  return String(template).replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ""));
}

function readStoredUiLanguage() {
  try {
    const stored = localStorage.getItem(UI_LANGUAGE_STORAGE_KEY);
    return UI_LANGUAGES.includes(stored) ? stored : null;
  } catch {
    return null;
  }
}

function browserUiLanguage() {
  const languages = [navigator.language, ...(navigator.languages || [])].filter(Boolean);
  return languages.some((language) => String(language).toLowerCase().startsWith("zh")) ? "zh-CN" : "en-US";
}

function toggleUiLanguage() {
  uiLanguage = uiLanguage === "zh-CN" ? "en-US" : "zh-CN";
  try {
    localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, uiLanguage);
  } catch {}
  applyUiLanguage();
}

function applyUiLanguage() {
  document.documentElement.lang = uiLanguage;
  document.title = t("document.title");
  setText(".control-group .control-label span", t("scope.label"));
  setText('.choice-card[data-value="current_window"] .button-label', t("scope.currentWindow"));
  setText('.choice-card[data-value="consolidate_one_window"] .button-label', t("scope.allWindows"));
  setAttribute("#organizeMode", "aria-label", t("scope.nativeLabel"));
  setOptionText("#organizeMode", "current_window", t("scope.optionCurrent"));
  setOptionText("#organizeMode", "consolidate_one_window", t("scope.optionAll"));

  setSwitchText("#ackSampling", "sampling.title", "sampling.subtitle");
  setSwitchText("#continuousPageSummaries", "continuous.title", "continuous.subtitle");
  setTooltip("#ackSampling", "sampling.tooltip");
  setTooltip("#continuousPageSummaries", "continuous.tooltip");
  setAttribute("#samplingRisk", "aria-label", t("sampling.aria"));
  setAttribute("#continuousSummaryRisk", "aria-label", t("continuous.aria"));
  setText(".activity-panel > summary", t("activity.summary"));
  setText(".activity-copy strong", t("activity.title"));
  setText(".activity-copy small", t("activity.subtitle"));
  setAttribute(".activity-range", "aria-label", t("activity.rangeAria"));
  setText('[data-activity-range="86400000"]', t("activity.day"));
  setText('[data-activity-range="604800000"]', t("activity.week"));
  setText('[data-activity-range="2592000000"]', t("activity.month"));
  if (nodes.activityResult?.classList.contains("empty")) nodes.activityResult.textContent = t("activity.empty");

  setText('label[for="customPrompt"]', t("customPrompt.label"));
  setAttribute("#customPrompt", "placeholder", t("customPrompt.placeholder"));
  setText(".advanced-settings > summary", t("advanced.summary"));

  setSwitchText("#dissolveExistingGroupsToggle", "switch.dissolve.title", "switch.dissolve.subtitle");
  setSwitchText("#createReviewGroupToggle", "switch.review.title", "switch.review.subtitle");
  setSwitchText("#includePinnedTabs", "switch.pinned.title", "switch.pinned.subtitle");
  setSwitchText("#includeIncognitoTabs", "switch.incognito.title", "switch.incognito.subtitle");
  setSwitchText("#collapseGroupsAfterApply", "switch.collapse.title", "switch.collapse.subtitle");

  setText('label[for="urlPrivacyMode"]', t("field.urlPrivacy"));
  setText('label[for="pageContextMode"]', t("field.pageContext"));
  setText('label[for="hostPermissionRequestMode"]', t("field.hostPermission"));
  setText('label[for="languageMode"]', t("field.resultLanguage"));
  setText('label[for="promptPreset"]', t("field.promptPreset"));
  setText('label[for="gatewayModel"]', t("field.gatewayModel"));
  setText('label[for="gatewayThinkingIntensity"]', t("field.thinking"));
  setText('label[for="gatewayCustomModel"]', t("field.customModel"));
  setText('label[for="gatewayBaseUrl"]', t("field.gatewayUrl"));
  setText('label[for="gatewayApiKey"]', t("field.gatewayKey"));
  setText(".secret-remember-row strong", t("field.rememberKey"));
  setText(".secret-remember-row small", t("field.rememberKeyHint"));
  setText('label[for="minConfidenceToApply"]', t("field.minConfidence"));
  setText('label[for="maxTabsPerGroup"]', t("field.maxTabs"));
  setAttribute("#gatewayCustomModel", "placeholder", t("placeholder.customModel"));
  setAttribute("#gatewayBaseUrl", "placeholder", t("placeholder.gatewayUrl"));
  setAttribute("#gatewayApiKey", "placeholder", t("placeholder.gatewayKey"));

  setOptionText("#targetWindowMode", "current_window", t("option.currentWindow"));
  setOptionText("#existingGroupMode", "preserve_existing_groups", t("option.preserveGroups"));
  setOptionText("#existingGroupMode", "dissolve_existing_groups", t("option.dissolveGroups"));
  setOptionText("#reviewGroupMode", "create_review_group", t("option.reviewCreate"));
  setOptionText("#reviewGroupMode", "leave_review_ungrouped", t("option.reviewUngrouped"));
  setOptionText("#undoTargetWindowMode", "leave_empty_target_window", t("option.leaveEmpty"));
  setOptionText("#urlPrivacyMode", "title_only", t("option.urlTitleOnly"));
  setOptionText("#urlPrivacyMode", "sanitized_url", t("option.urlSanitized"));
  setOptionText("#urlPrivacyMode", "full_url", t("option.urlFull"));
  setOptionText("#pageContextMode", "off", t("option.pageOff"));
  setOptionText("#pageContextMode", "ambiguous_with_permission", t("option.pageAmbiguous"));
  setOptionText("#pageContextMode", "all_granted_origins", t("option.pageGranted"));
  setOptionText("#hostPermissionRequestMode", "never", t("option.permissionNever"));
  setOptionText("#hostPermissionRequestMode", "ask_per_origin", t("option.permissionOrigin"));
  setOptionText("#hostPermissionRequestMode", "ask_for_all_visible_origins", t("option.permissionVisible"));
  setOptionText("#languageMode", "auto", t("option.langAuto"));
  setOptionText("#languageMode", "zh-CN", t("option.langZh"));
  setOptionText("#languageMode", "en-US", t("option.langEn"));
  setOptionText("#promptPreset", "conservative", t("option.presetConservative"));
  setOptionText("#promptPreset", "media_type", t("option.presetMedia"));
  setOptionText("#promptPreset", "read_later", t("option.presetReadLater"));
  setOptionText("#promptPreset", "aggressive_cleanup", t("option.presetAggressive"));
  setOptionText("#gatewayModel", "custom", t("option.customModel"));
  setOptionText("#gatewayThinkingIntensity", "low", t("option.thinkingLow"));
  setOptionText("#gatewayThinkingIntensity", "medium", t("option.thinkingMedium"));
  setOptionText("#gatewayThinkingIntensity", "high", t("option.thinkingHigh"));
  setOptionText("#gatewayThinkingIntensity", "ultra", t("option.thinkingUltra"));

  setText(".step-label", t("preview.step"));
  setText(".section-heading h2", t("preview.heading"));
  setText("#detailsRoot > summary", t("details.summary"));
  setButtonLabel(nodes.cancelBtn, t("button.cancel"));
  setButtonLabel(nodes.applyBtn, t("button.apply"));
  setButtonLabel(nodes.undoBtn, t("button.undo"));
  if (nodes.uiLanguageToggle) {
    nodes.uiLanguageToggle.setAttribute("aria-label", t("button.languageAria"));
    nodes.uiLanguageToggle.setAttribute("title", t("button.languageAria"));
  }
  if (lastPreview) {
    renderPreview({ preview: lastPreview, validation: { ok: lastCanApply }, settings: { languageMode: currentResultLanguageMode() } });
  } else if (lastError) {
    renderError(lastError);
  } else {
    nodes.previewCount.textContent = t("preview.pending");
    nodes.previewRoot.textContent = t("preview.empty");
  }
  syncActionState();
  renderStatus();
}

function setText(selector, text) {
  const element = document.querySelector(selector);
  if (element) element.textContent = text;
}

function setAttribute(selector, name, value) {
  const element = document.querySelector(selector);
  if (element) element.setAttribute(name, value);
}

function setOptionText(selectSelector, value, text) {
  const option = document.querySelector(`${selectSelector} option[value="${value}"]`);
  if (option) option.textContent = text;
}

function setSwitchText(inputSelector, titleKey, subtitleKey) {
  const label = document.querySelector(inputSelector)?.closest("label");
  if (!label) return;
  const strong = label.querySelector("strong");
  const helpTip = strong?.querySelector(".help-tip") || null;
  if (strong) {
    strong.replaceChildren(document.createTextNode(t(titleKey)));
    if (helpTip) strong.append(" ", helpTip);
  }
  const small = label.querySelector("small");
  if (small) small.textContent = t(subtitleKey);
}

function setTooltip(inputSelector, tooltipKey) {
  const label = document.querySelector(inputSelector)?.closest("label");
  const tooltip = t(tooltipKey);
  if (label) label.dataset.tooltip = tooltip;
  const helpTip = label?.querySelector(".help-tip");
  if (helpTip) helpTip.dataset.tooltip = tooltip;
}

function currentResultLanguageMode() {
  return fields.languageMode.value === "auto" ? uiLanguage : fields.languageMode.value;
}

function effectiveResultLanguageMode(languageMode) {
  return languageMode === "auto" ? uiLanguage : languageMode;
}

function bindChoiceGroups() {
  document.querySelectorAll("[data-choice-for]").forEach((group) => {
    const field = fields[group.dataset.choiceFor];
    if (!field) return;

    group.querySelectorAll("button[data-value]").forEach((button) => {
      button.addEventListener("click", () => {
        field.value = button.dataset.value;
        syncChoiceGroups();
        field.dispatchEvent(new Event("change", { bubbles: true }));
      });
    });
  });
}

function bindSettingSwitches() {
  for (const settingSwitch of settingSwitches) {
    if (!settingSwitch.input || !fields[settingSwitch.field]) continue;
    settingSwitch.input.addEventListener("change", () => {
      const field = fields[settingSwitch.field];
      field.value = settingSwitch.input.checked ? settingSwitch.onValue : settingSwitch.offValue;
      field.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
}

function readSettings(options = {}) {
  const effectiveForAnalysis = Boolean(options.effectiveForAnalysis);
  const contentAccessAvailable = hasContentAccessFeature();
  const selectedPageContextMode = normalizePanelPageContextMode(fields.pageContextMode.value);
  const pageSummaryEnabled = contentAccessAvailable && fields.ackSampling.checked;
  const effectivePageContextMode = effectiveForAnalysis
    ? effectivePageContextModeForRun(selectedPageContextMode, pageSummaryEnabled)
    : selectedPageContextMode;
  const continuousPageSummaries = contentAccessAvailable && fields.continuousPageSummaries.checked;
  const effectiveHostPermissionRequestMode =
    effectiveForAnalysis &&
    pageSummaryEnabled &&
    fields.hostPermissionRequestMode.value === "never"
      ? "ask_for_all_visible_origins"
      : fields.hostPermissionRequestMode.value;
  return {
    organizeMode: fields.organizeMode.value,
    existingGroupMode: fields.existingGroupMode.value,
    targetWindowMode: "current_window",
    reviewGroupMode: fields.reviewGroupMode.value,
    undoTargetWindowMode: "leave_empty_target_window",
    urlPrivacyMode: fields.urlPrivacyMode.value,
    pageContextMode: effectivePageContextMode,
    hostPermissionRequestMode: effectiveHostPermissionRequestMode,
    pageSamplingConsentMode:
      continuousPageSummaries
        ? "acknowledged_persistently"
        : pageSummaryEnabled
        ? "acknowledged_for_session"
        : "not_acknowledged",
    languageMode: fields.languageMode.value,
    promptPreset: fields.promptPreset.value,
    plannerProvider: fields.plannerProvider.value || "gateway",
    rememberProviderKeys: Boolean(fields.rememberProviderKeys.checked && fields.gatewayBaseUrl.value.trim() && fields.gatewayApiKey.value.trim()),
    gatewayBaseUrl: fields.gatewayBaseUrl.value,
    gatewayModel: fields.gatewayModel.value,
    gatewayCustomModel: fields.gatewayCustomModel.value,
    gatewayThinkingIntensity: fields.gatewayThinkingIntensity.value,
    gatewayApiKey: fields.gatewayApiKey.value,
    customPrompt: fields.customPrompt.value,
    includePinnedTabs: fields.includePinnedTabs.checked,
    includeIncognitoTabs: fields.includeIncognitoTabs.checked,
    collapseGroupsAfterApply: fields.collapseGroupsAfterApply.checked,
    continuousPageSummaries,
    minConfidenceToApply: fields.minConfidenceToApply.value,
    maxTabsPerGroup: fields.maxTabsPerGroup.value
  };
}

function effectivePageContextModeForRun(selectedPageContextMode, pageSummaryEnabled) {
  if (!pageSummaryEnabled) return "off";
  return selectedPageContextMode === "off" ? "ambiguous_with_permission" : selectedPageContextMode;
}

function writeSettings(settings) {
  const displaySettings = {
    ...settings,
    targetWindowMode: "current_window",
    undoTargetWindowMode: "leave_empty_target_window",
    pageContextMode: normalizePanelPageContextMode(settings.pageContextMode)
  };
  for (const [key, element] of Object.entries(fields)) {
    if (key === "ackSampling") {
      element.checked =
        hasContentAccessFeature() &&
        displaySettings.pageContextMode !== "off" &&
        displaySettings.pageSamplingConsentMode !== "not_acknowledged";
    } else if (key === "plannerProvider") {
      element.value = allowInternalFakeProvider() && displaySettings[key] === "fake" ? "fake" : "gateway";
    } else if (element.type === "checkbox") {
      element.checked = Boolean(displaySettings[key]);
    } else if (displaySettings[key] !== undefined) {
      element.value = displaySettings[key];
    }
  }
  syncSettingSwitches();
  syncChoiceGroups();
}

function syncSettingSwitches() {
  for (const settingSwitch of settingSwitches) {
    const field = fields[settingSwitch.field];
    if (!settingSwitch.input || !field) continue;
    settingSwitch.input.checked = field.value === settingSwitch.onValue;
  }
}

function normalizePanelPageContextMode(value) {
  return value === "active_tab_only" ? "all_granted_origins" : value;
}

function allowInternalFakeProvider() {
  return Boolean(globalThis.__semanticTabAgentAllowFakeProvider);
}

async function persistSettings() {
  const settings = await sendMessage({ type: "settings:save", settings: readSettings() });
  writeSettings(settings);
  updateConditionalUi();
  setStatusKey("status.saved");
}

function updateConditionalUi() {
  const contentAccessAvailable = hasContentAccessFeature();
  nodes.appShell.dataset.contentAccess = contentAccessAvailable ? "on" : "off";
  const samplingEnabled = contentAccessAvailable && (fields.ackSampling.checked || fields.pageContextMode.value !== "off");
  nodes.samplingRisk.hidden = !contentAccessAvailable;
  nodes.continuousSummaryRisk.hidden = !contentAccessAvailable;
  nodes.hostPermissionField.hidden =
    !samplingEnabled || fields.pageContextMode.value === "off";
  nodes.gatewayCustomModelField.hidden = fields.gatewayModel.value !== GATEWAY_CUSTOM_MODEL_VALUE;
  const canRememberCustomKey = Boolean(fields.gatewayBaseUrl.value.trim() && fields.gatewayApiKey.value.trim());
  fields.rememberProviderKeys.disabled = !canRememberCustomKey;
  if (!canRememberCustomKey) fields.rememberProviderKeys.checked = false;
  syncChoiceGroups();
  schedulePageSamplingOriginRefresh();
}

async function handleAnalyzeClick() {
  if (lastPreview) {
    await clearAnalysisState();
    resetToSetup();
    setStatusKey("status.default");
    return;
  }
  analyze();
}

async function analyze() {
  setBusy(true, t("status.preparing"), { cancelable: true, progress: 4 });
  try {
    const persistedSettings = readSettings();
    const settings = readSettings({ effectiveForAnalysis: true });
    settings.languageMode = effectiveResultLanguageMode(settings.languageMode);
    validateGatewaySettingsForAnalyze(settings);
    updateLocalProgress(t("status.checkingPermissions"), 8);
    await ensurePlannerHostPermission(settings);
    if (settings.pageContextMode !== "off" && settings.pageSamplingConsentMode !== "not_acknowledged") {
      updateLocalProgress(t("status.checkingPageSummaryPermissions"), 12);
      await ensurePageSamplingPermissions(settings, { requestMissing: false });
      settings.hostPermissionRequestMode = "never";
    }
    updateLocalProgress(t("status.resolvingWindow"), 14);
    const windowId = await resolveInvocationWindowId();
    updateLocalProgress(t("status.startingBackground"), 16);
    const started = await sendMessage({ type: "tabs:startAnalyze", settings, persistedSettings, windowId });
    const job = await waitForAnalysisCompletion(started?.operationId);
    lastPreview = job.preview;
    lastCanApply = Boolean(job.validation?.ok);
    renderPreview(job);
    renderDetails(job);
    nodes.applyBtn.disabled = !lastCanApply;
    syncActionState();
    setStatusKey(job.validation?.ok ? "status.planReady" : "status.planNeedsReview", {}, !job.validation?.ok);
  } catch (error) {
    if (isCancellationError(error)) {
      setStatusKey("status.canceled");
    } else {
      const message = friendlyErrorMessage(error);
      setStatus(message, true);
      renderError(new Error(message));
    }
  } finally {
    stopProgressPolling();
    setBusy(false);
  }
}

function validateGatewaySettingsForAnalyze(settings) {
  if (settings.plannerProvider !== "gateway" || settings.gatewayModel !== GATEWAY_CUSTOM_MODEL_VALUE) return;
  if (!settings.gatewayBaseUrl.trim()) {
    throw new Error(t("status.customModelNeedsGateway"));
  }
  if (!settings.gatewayCustomModel.trim()) {
    throw new Error(t("status.customModelMissing"));
  }
}

function isCancellationError(error) {
  return /已取消整理|Cleanup canceled|canceled/i.test(String(error?.message || ""));
}

function friendlyErrorMessage(error) {
  const message = String(error?.message || "").trim();
  if (!message) return t("status.default");
  if (/No analyzed plan is available/i.test(message)) return t("status.noPlanToApply");
  if (/No rollback snapshot is available/i.test(message)) return t("status.noRollback");
  if (/Cannot apply an invalid plan/i.test(message)) return t("status.invalidPlan");
  if (/Progress copy generation returned invalid JSON/i.test(message)) return t("status.progressCopyFailed");
  return message;
}

async function cancelAnalyze() {
  nodes.cancelBtn.disabled = true;
  setStatusKey("status.canceling");
  try {
    const result = await sendMessage(scopedWindowMessage({ type: "tabs:cancelActiveJob" }));
    if (result?.job) updateProgressFromJob(result.job);
    if (result?.job?.status === "canceled") {
      stopProgressPolling();
      setBusy(false);
      setStatusKey("status.canceled");
    }
  } catch (error) {
    setStatus(friendlyErrorMessage(error), true);
    nodes.cancelBtn.disabled = false;
  }
}

async function applyLastPlan() {
  let confirmMultiWindow = false;
  if (lastPreview?.requiresConfirmation) {
    const confirmed = confirm(t("confirm.applyMultiWindow"));
    if (!confirmed) return;
    confirmMultiWindow = true;
  }

  setBusy(true, t("status.organizing"));
  try {
    let result = await sendMessage(scopedWindowMessage({ type: "tabs:applyLastPlan", confirmMultiWindow }));
    if (result?.requiresMultiWindowConfirmation) {
      const confirmed = confirm(t("confirm.applyMultiWindow"));
      if (!confirmed) {
        setStatusKey("status.canceled");
        return;
      }
      confirmMultiWindow = true;
      result = await sendMessage(scopedWindowMessage({ type: "tabs:applyLastPlan", confirmMultiWindow }));
    }
    if (result?.requiresChangedTabsConfirmation) {
      const confirmed = confirm(changedTabsConfirmationText(result.rebasedPlan));
      if (!confirmed) {
        setStatusKey("status.canceled");
        return;
      }
      setStatusKey("status.organizingChanged");
      result = await sendMessage(scopedWindowMessage({
        type: "tabs:applyLastPlan",
        confirmChangedTabs: true,
        confirmationToken: result.rebasedPlan?.confirmationToken || "",
        confirmMultiWindow
      }));
      if (result?.requiresChangedTabsConfirmation) {
        setStatusKey("status.previousFailed", {}, true);
        renderError(new Error(changedTabsConfirmationText(result.rebasedPlan)));
        return;
      }
    }
    canUndo = true;
    const status = applyResultStatus(result);
    await clearAnalysisState();
    resetToSetup();
    setStatus(status);
  } catch (error) {
    setStatus(friendlyErrorMessage(error), true);
  } finally {
    setBusy(false);
  }
}

function changedTabsConfirmationText(summary = {}) {
  const newCount = [...(summary.skippedNewTabIds || []), ...(summary.addedReviewTabIds || [])].length;
  const changedContentCount = (summary.changedContentTabIds || []).length;
  const removedCount = (summary.removedTabIds || []).length;
  const duplicateCount = (summary.duplicateTabIds || []).length;
  const reviewTitle = reviewGroupTitle(currentResultLanguageMode());
  const lines = [t("confirm.changedHeader")];

  if (newCount) {
    if (fields.reviewGroupMode.value === "create_review_group") {
      lines.push(t("confirm.newToReview", { count: newCount, reviewTitle }));
    } else {
      lines.push(t("confirm.newUngrouped", { count: newCount }));
    }
  }
  if (changedContentCount) lines.push(t("confirm.changedContent", { count: changedContentCount, reviewTitle }));
  if (removedCount) lines.push(t("confirm.removed", { count: removedCount }));
  if (duplicateCount) lines.push(t("confirm.duplicate", { count: duplicateCount }));
  lines.push(t("confirm.continue"));
  return lines.join("\n");
}

function applyResultStatus(result) {
  const groupCount = result.createdGroupIds?.length || 0;
  const changedTabs = result.rebasedPlan?.changedTabsCount || 0;
  if (changedTabs) {
    const reviewCount = result.rebasedPlan?.addedReviewTabIds?.length || 0;
    const reviewText = reviewCount && fields.reviewGroupMode.value === "create_review_group"
      ? t("status.applyReviewSuffix", { reviewCount, reviewTitle: reviewGroupTitle(currentResultLanguageMode()) })
      : "";
    return t("status.applyChanged", { groupCount, changedTabs, reviewText });
  }
  return t("status.applyDone", { groupCount });
}

async function undoLastApply() {
  setBusy(true, t("status.undoing"));
  try {
    const result = await sendMessage(scopedWindowMessage({ type: "tabs:undoLastApply" }));
    canUndo = false;
    setStatus(t("status.undoDone", { count: result.restoredTabs || 0 }));
    renderDetails({ undoResult: result });
  } catch (error) {
    setStatus(friendlyErrorMessage(error), true);
  } finally {
    setBusy(false);
  }
}

function renderPreview(job) {
  lastError = null;
  nodes.previewSection.hidden = false;
  setText(".step-label", t("preview.step"));
  setText(".section-heading h2", t("preview.heading"));
  const preview = job.preview;
  const resultLanguageMode = preview.languageMode || job.settings?.languageMode || currentResultLanguageMode();
  const groups = orderPreviewGroups(preview.groups || [], resultLanguageMode);
  const reviewTabsCount = preview.reviewTabsCount || 0;
  const reviewGroupWillBeCreated = Boolean(preview.reviewGroupWillBeCreated && reviewTabsCount);
  const visibleGroupCount = groups.length + (reviewGroupWillBeCreated ? 1 : 0);
  const groupedTabsCount = Number.isFinite(Number(preview.groupedTabsCount))
    ? Number(preview.groupedTabsCount)
    : groups.reduce((sum, group) => sum + (Number(group.tabCount) || 0), 0);
  const summaryPreview = {
    ...preview,
    groupedTabsCount,
    eligibleTabsCount: Number.isFinite(Number(preview.eligibleTabsCount))
      ? Number(preview.eligibleTabsCount)
      : groupedTabsCount + reviewTabsCount
  };

  if (!groups.length && !reviewTabsCount && !preview.lockedGroupsCount) {
    nodes.previewRoot.className = "empty";
    nodes.previewRoot.textContent = t("status.noTabs");
    nodes.previewCount.textContent = t("preview.emptyCount");
    return;
  }

  nodes.previewRoot.className = "preview-list";
  nodes.previewCount.textContent = localizedText(uiLanguage, `${visibleGroupCount} 组`, formatCount(visibleGroupCount, "group"));
  nodes.previewRoot.replaceChildren(
    previewSummary(summaryPreview, groups.length, reviewTabsCount, reviewGroupWillBeCreated, resultLanguageMode),
    ...groups.map((group, index) => groupRow(group, swatchForIndex(index), uiLanguage)),
    ...(reviewGroupWillBeCreated ? [reviewGroupRow(reviewTabsCount, resultLanguageMode, preview)] : [])
  );
}

function orderPreviewGroups(groups) {
  const normalGroups = [];
  const reviewLikeGroups = [];

  for (const group of groups) {
    if (isReviewLikeGroup(group)) {
      reviewLikeGroups.push(group);
    } else {
      normalGroups.push(group);
    }
  }

  return [...normalGroups, ...reviewLikeGroups];
}

function previewSummary(preview, groupCount, reviewTabsCount, reviewGroupWillBeCreated, languageMode) {
  const summary = document.createElement("div");
  summary.className = "preview-summary";
  const main = document.createElement("span");
  main.textContent = previewSummaryText(preview, groupCount, reviewTabsCount, reviewGroupWillBeCreated, languageMode);
  summary.append(main, pageSamplingLine(preview), excludedTabsLine(preview));
  return summary;
}

function previewSummaryText(preview, groupCount, reviewTabsCount, reviewGroupWillBeCreated, resultLanguageMode) {
  const handledTabs = preview.eligibleTabsCount || (preview.groupedTabsCount || 0) + reviewTabsCount;
  const groupedTabs = preview.groupedTabsCount || 0;

  if (!handledTabs) {
    return t("status.noTabs");
  }

  if (uiLanguage === "en-US") {
    const subjectText = groupCount ? `found ${formatCount(groupCount, "topic group")}` : "found no stable topic groups";
    const reviewTitle = preview.reviewGroupTitle || reviewGroupTitle(resultLanguageMode);
    const reviewText = reviewTabsCount
      ? reviewGroupWillBeCreated
        ? `, with ${formatCount(reviewTabsCount, "tab")} set aside for "${reviewTitle}"`
        : `, with ${formatCount(reviewTabsCount, "tab")} left ungrouped`
      : "";

    if (!groupCount && reviewTabsCount) {
      return `AI reviewed ${formatCount(handledTabs, "tab")}, ${subjectText}${reviewText}.`;
    }

    return `AI reviewed ${formatCount(handledTabs, "tab")}, ${subjectText}; ${formatCount(groupedTabs, "tab")} will be grouped automatically${reviewText}.`;
  }

  const subjectText = groupCount ? `识别出 ${groupCount} 个主题` : "没有找到足够稳定的主题";
  const reviewText = reviewTabsCount
    ? reviewGroupWillBeCreated
      ? `，${reviewTabsCount} 个留到「${preview.reviewGroupTitle || reviewGroupTitle(resultLanguageMode)}」`
      : `，${reviewTabsCount} 个暂不归类`
    : "";

  if (!groupCount && reviewTabsCount) {
    return `AI 已梳理 ${handledTabs} 个标签页，${subjectText}${reviewText}。`;
  }

  return `AI 已梳理 ${handledTabs} 个标签页，${subjectText}；${groupedTabs} 个已自动归类${reviewText}。`;
}

function pageSamplingLine(preview) {
  const line = document.createElement("small");
  const pageSampling = preview?.pageSampling;
  if (!pageSampling?.requested || !pageSampling.ok) return line;

  const totalTabsForCopy = preview?.eligibleTabsCount || preview?.totalTabsCount || pageSampling.requested;
  const shouldShowCount = shouldShowPageSampleCount(pageSampling.ok, totalTabsForCopy);
  line.textContent =
    uiLanguage === "en-US"
      ? shouldShowCount
        ? `Referenced ${pageSampling.ok} page summaries plus titles, URLs, and tab order.`
        : "Added extra page context where available, then organized with titles, URLs, and tab order."
      : shouldShowCount
        ? `已参考 ${pageSampling.ok} 个页面摘要，并结合标题、网址和原始顺序整理。`
        : "已补充部分页面线索，并结合标题、网址和原始顺序整理。";
  return line;
}

function excludedTabsLine(preview) {
  const line = document.createElement("small");
  if (!preview?.excludedTabsCount) return line;
  line.textContent = localizedText(
    uiLanguage,
    `另有 ${preview.excludedTabsCount} 个固定、无痕或受限标签页未参与整理。`,
    `${preview.excludedTabsCount} pinned, incognito, or restricted tabs were not included.`
  );
  return line;
}

function groupRow(group, swatchColor, languageMode = "auto") {
  const row = document.createElement("div");
  row.className = "group-row";
  row.style.setProperty("--swatch", swatchColor);

  const swatch = document.createElement("div");
  swatch.className = "group-swatch";

  const body = document.createElement("div");
  const title = document.createElement("div");
  title.className = "group-title";
  title.textContent = group.title;
  const meta = document.createElement("div");
  meta.className = "group-meta";
  meta.textContent = group.reason || group.groupKey;
  body.append(title, meta);

  const badge = document.createElement("div");
  badge.className = "badge";
  badge.textContent = localizedText(languageMode, `${group.tabCount} 个`, formatCount(group.tabCount, "tab"));

  row.append(swatch, body, badge);
  return row;
}

function formatCount(count, noun) {
  const numeric = Number(count) || 0;
  return `${numeric} ${noun}${numeric === 1 ? "" : "s"}`;
}

function reviewGroupRow(tabCount, resultLanguageMode, preview) {
  return groupRow(
    {
      title: preview.reviewGroupTitle || reviewGroupTitle(resultLanguageMode),
      reason: preview.reviewGroupReason || reviewGroupReason(resultLanguageMode),
      tabCount
    },
    "var(--muted)",
    uiLanguage
  );
}

function swatchForIndex(index) {
  return ["var(--group-a)", "var(--group-b)", "var(--group-c)", "var(--group-d)", "var(--group-e)", "var(--group-f)"][
    index % 6
  ];
}

function renderDetails(payload) {
  nodes.detailsRoot.hidden = false;
  nodes.detailsText.textContent = JSON.stringify(payload, replacerForDetails, 2);
}

function renderError(error) {
  lastError = error instanceof Error ? error : new Error(String(error?.message || error || t("status.previousFailed")));
  lastPreview = null;
  lastCanApply = false;
  nodes.previewSection.hidden = false;
  setText(".step-label", t("preview.error"));
  setText(".section-heading h2", t("error.heading"));
  nodes.previewCount.textContent = t("preview.error");
  nodes.previewRoot.className = "error-panel";
  nodes.previewRoot.replaceChildren(errorPanelContent(lastError));
  nodes.detailsRoot.hidden = false;
  nodes.detailsText.textContent = JSON.stringify({ error: lastError.message }, null, 2);
  syncActionState();
}

async function loadActivityOverview(rangeMs) {
  if (!nodes.activityResult) return;
  nodes.activityResult.className = "activity-result";
  nodes.activityResult.textContent = t("activity.loading");
  setBusy(true, t("activity.loading"), { progress: 12 });
  try {
    const settings = readSettings({ effectiveForAnalysis: true });
    settings.languageMode = effectiveResultLanguageMode(settings.languageMode);
    validateGatewaySettingsForAnalyze(settings);
    updateLocalProgress(t("status.checkingPermissions"), 18);
    await ensurePlannerHostPermission(settings);
    if (settings.pageContextMode !== "off" && settings.pageSamplingConsentMode !== "not_acknowledged") {
      updateLocalProgress(t("status.checkingPageSummaryPermissions"), 24);
      await ensurePageSamplingPermissions(settings, { requestMissing: false });
      settings.hostPermissionRequestMode = "never";
    }
    updateLocalProgress(t("activity.loading"), 36);
    const result = await sendMessage({ type: "activity:analyzeCleanup", settings, rangeMs, windowId: panelWindowId });
    renderActivityOverview(result);
    setStatusKey("status.default");
  } catch (error) {
    nodes.activityResult.className = "activity-result error-panel";
    const message = friendlyErrorMessage(error);
    nodes.activityResult.textContent = message;
    setStatus(message, true);
  } finally {
    setBusy(false);
  }
}

function renderActivityOverview(payload = {}) {
  const overview = payload.overview || payload;
  const cleanup = payload.cleanup || null;
  const recap = overview.recap || {};
  if (!cleanup && !recap.entries) {
    nodes.activityResult.className = "activity-result empty";
    nodes.activityResult.textContent = t("activity.none");
    return;
  }

  const candidates = cleanup?.candidates || overview.staleTabs || [];
  const cleanupSummary = cleanup?.summary ? [activityLine(cleanup.summary, "p")] : [];
  const wrapper = document.createElement("div");
  wrapper.className = "activity-result-content";
  wrapper.append(
    activityLine(
      t("activity.coverage", {
        total: overview.openTabs?.total || 0,
        tracked: overview.openTabs?.tracked || 0,
        stale: candidates.length
      }),
      "strong"
    ),
    ...cleanupSummary,
    activityStaleSection(candidates),
    activitySection(t("activity.focus"), (recap.topTerms || []).map((item) => item.value).join(" · ")),
    activitySection(t("activity.sites"), (recap.topHosts || []).map((item) => item.value).join(" · ")),
    activityList(t("activity.recent"), (recap.recentPages || []).slice(0, 5).map((page) => `${page.title}${page.hostname ? ` · ${page.hostname}` : ""}`))
  );
  nodes.activityResult.className = "activity-result";
  nodes.activityResult.replaceChildren(wrapper);
}

function activityLine(text, tagName = "p") {
  const element = document.createElement(tagName);
  element.textContent = text;
  return element;
}

function activitySection(title, text) {
  const section = document.createElement("div");
  section.className = "activity-section";
  section.append(activityLine(title, "strong"), activityLine(text || "—", "span"));
  return section;
}

function activityList(title, items) {
  const section = document.createElement("div");
  section.className = "activity-section";
  const list = document.createElement("ul");
  for (const item of items.length ? items : ["—"]) {
    const li = document.createElement("li");
    li.textContent = item;
    list.append(li);
  }
  section.append(activityLine(title, "strong"), list);
  return section;
}

function activityStaleSection(staleTabs) {
  const section = document.createElement("div");
  section.className = "activity-section stale-section";
  const hint = document.createElement("small");
  hint.textContent = t("activity.staleHint");
  const list = document.createElement("ul");
  list.className = "cleanup-candidate-list";
  const items = staleTabs.slice(0, 12);
  if (!items.length) {
    const empty = document.createElement("li");
    empty.textContent = t("activity.noStale");
    list.append(empty);
  } else {
    for (const tab of items) {
      list.append(cleanupCandidateRow(tab));
    }
  }
  section.append(activityLine(t("activity.stale"), "strong"), hint, list);
  return section;
}

function cleanupCandidateRow(tab) {
  const row = document.createElement("li");
  row.className = "cleanup-candidate";

  const body = document.createElement("div");
  body.className = "cleanup-candidate-body";
  const title = document.createElement("strong");
  title.textContent = tab.title || tab.hostname || "Untitled";
  const host = document.createElement("small");
  host.textContent = [tab.hostname, tab.currentGroupTitle ? t("activity.group", { group: tab.currentGroupTitle }) : t("activity.noGroup")]
    .filter(Boolean)
    .join(" · ");
  const meta = document.createElement("div");
  meta.className = "cleanup-candidate-meta";
  meta.append(cleanupPriorityChip(tab.priority), cleanupMetaChip(t("activity.seenCount", { count: tab.activeCount || 0 })));
  if (tab.ageMs) meta.append(cleanupMetaChip(t("activity.firstSeen", { age: formatAgo(tab.ageMs) })));
  if (tab.idleMs) meta.append(cleanupMetaChip(t("activity.lastActive", { age: formatAgo(tab.idleMs) })));
  body.append(title, host, meta);

  if (tab.reason) {
    const reasonLine = document.createElement("small");
    reasonLine.className = "cleanup-candidate-clue";
    reasonLine.textContent = t("activity.aiReason", { text: tab.reason });
    body.append(reasonLine);
  }

  if (Array.isArray(tab.evidence) && tab.evidence.length) {
    const evidence = document.createElement("div");
    evidence.className = "cleanup-candidate-meta cleanup-evidence";
    for (const item of tab.evidence.slice(0, 3)) {
      evidence.append(cleanupMetaChip(item));
    }
    body.append(evidence);
  }

  const clue = cleanupSummaryClue(tab);
  if (clue) {
    const clueLine = document.createElement("small");
    clueLine.className = "cleanup-candidate-clue";
    clueLine.textContent = t("activity.summaryClue", { text: clue });
    body.append(clueLine);
  }

  const action = document.createElement("button");
  action.className = "candidate-action";
  action.type = "button";
  action.textContent = t("activity.focusTab");
  action.setAttribute("aria-label", t("activity.focusTabAria", { title: tab.title || tab.hostname || "" }));
  action.addEventListener("click", () => focusActivityTab(tab));
  row.append(body, action);
  return row;
}

function cleanupMetaChip(text) {
  const chip = document.createElement("span");
  chip.textContent = text;
  return chip;
}

function cleanupPriorityChip(priority) {
  const value = ["high", "medium", "low"].includes(priority) ? priority : "medium";
  const chip = cleanupMetaChip(t(`activity.priority.${value}`));
  chip.dataset.priority = value;
  return chip;
}

function cleanupSummaryClue(tab) {
  const summary = tab.summary || {};
  return [summary.metaDescription, ...(summary.headings || []), summary.title]
    .map((item) => String(item || "").trim())
    .filter(Boolean)[0]?.slice(0, 120) || "";
}

async function focusActivityTab(tab) {
  try {
    await sendMessage({ type: "activity:focusTab", tabId: tab.tabId, windowId: tab.windowId, languageMode: uiLanguage });
    setStatusKey("activity.focused");
  } catch (error) {
    setStatus(friendlyErrorMessage(error) || t("activity.focusFailed"), true);
  }
}

function resetToSetup() {
  lastPreview = null;
  lastError = null;
  lastCanApply = false;
  nodes.previewSection.hidden = true;
  setText(".step-label", t("preview.step"));
  setText(".section-heading h2", t("preview.heading"));
  nodes.previewCount.textContent = t("preview.pending");
  nodes.previewRoot.className = "empty";
  nodes.previewRoot.textContent = t("preview.empty");
  nodes.detailsRoot.hidden = true;
  nodes.detailsText.textContent = "";
  syncActionState();
}

function errorPanelContent(error) {
  const wrapper = document.createElement("div");
  const message = document.createElement("strong");
  message.textContent = String(error?.message || t("status.previousFailed"));
  const hint = document.createElement("small");
  hint.textContent = t("error.retryHint");
  wrapper.append(message, hint);
  return wrapper;
}

async function clearAnalysisState() {
  await sendMessage({ type: "tabs:clearAnalysisState" }).catch(() => null);
}

function replacerForDetails(key, value) {
  if (key === "gatewayApiKey") return "";
  if (key === "inventory" && value?.tabs) {
    return {
      ...value,
      tabs: `${value.tabs.length} tab(s)`,
      plannerTabs: `${value.plannerTabs?.length || 0} planner tab(s)`,
      excludedTabs: `${value.excludedTabs?.length || 0} excluded tab(s)`
    };
  }
  return value;
}

function setBusy(isBusy, label = "", options = {}) {
  nodes.analyzeBtn.disabled = isBusy;
  nodes.undoBtn.disabled = isBusy;
  nodes.applyBtn.disabled = isBusy || !lastPreview || !lastCanApply;
  nodes.cancelBtn.hidden = !(isBusy && options.cancelable);
  nodes.cancelBtn.disabled = false;
  nodes.actions.dataset.busy = isBusy ? "true" : "false";
  nodes.progressBar.hidden = !isBusy;
  showProgress(isBusy ? options.progress || 8 : 0);
  if (isBusy && label) {
    setStatus(label);
    setProgressLabel(label);
  }
  syncActionState();
}

async function hydrateActiveJob() {
  const job = await sendMessage(scopedWindowMessage({ type: "tabs:getActiveJob" })).catch(() => null);
  if (!job) return;
  if (isLiveJob(job)) {
    updateProgressFromJob(job);
    setBusy(true, localizeKnownMessage(job.message || t("status.organizing")), { cancelable: true, progress: job.progress || 8 });
    startProgressPolling();
  } else if (job.status === "complete") {
    await restoreCompletedJob(job);
  } else if (job.status === "error" || job.status === "canceled") {
    restoreTerminalJob(job);
  }
}

async function hydrateUndoState() {
  const result = await sendMessage(scopedWindowMessage({ type: "tabs:canUndo" })).catch(() => null);
  canUndo = Boolean(result?.canUndo);
}

async function restoreCompletedJob(activeJob = {}) {
  stopProgressPolling();
  const job = await sendMessage(scopedWindowMessage({ type: "tabs:getLastJob" })).catch(() => null);
  if (!job?.preview) {
    const message = t("status.generatedButMissingPreview");
    setStatusKey("status.generatedButMissingPreview", {}, true);
    renderError(new Error(message));
    setBusy(false);
    return;
  }
  if (activeJob.operationId && job.operationId && activeJob.operationId !== job.operationId) {
    return;
  }

  lastPreview = job.preview;
  lastCanApply = Boolean(job.validation?.ok);
  renderPreview(job);
  renderDetails(job);
  nodes.applyBtn.disabled = !lastCanApply;
  setStatusKey(job.validation?.ok ? "status.planReady" : "status.planNeedsReview", {}, !job.validation?.ok);
  setBusy(false);
}

function restoreTerminalJob(job = {}) {
  stopProgressPolling();
  setBusy(false);
  const isError = job.status === "error";
  const message = job.message || t(isError ? "status.previousFailed" : "status.previousCanceled");
  setStatus(message, isError);
  if (isError) renderError(new Error(message));
}

function startProgressPolling() {
  stopProgressPolling();
  pollActiveJob();
  progressPollTimer = setInterval(pollActiveJob, ACTIVE_JOB_POLL_MS);
}

function stopProgressPolling() {
  if (!progressPollTimer) return;
  clearInterval(progressPollTimer);
  progressPollTimer = null;
}

async function pollActiveJob() {
  try {
    const job = await sendMessage(scopedWindowMessage({ type: "tabs:getActiveJob" }));
    updateProgressFromJob(job);
    if (job?.status === "complete") {
      await restoreCompletedJob(job);
    } else if (job?.status === "error" || job?.status === "canceled") {
      restoreTerminalJob(job);
    } else if (!isLiveJob(job)) {
      stopProgressPolling();
    }
  } catch {
    stopProgressPolling();
  }
}

async function waitForAnalysisCompletion(operationId) {
  while (true) {
    const activeJob = await sendMessage(scopedWindowMessage({ type: "tabs:getActiveJob" }));
    updateProgressFromJob(activeJob);

    if (!activeJob) {
      throw new Error(t("status.backgroundNotStarted"));
    }
    if (operationId && activeJob.operationId && activeJob.operationId !== operationId) {
      throw new Error(t("status.anotherJobRunning"));
    }
    if (activeJob.status === "complete") {
      const job = await sendMessage(scopedWindowMessage({ type: "tabs:getLastJob" }));
      if (!job?.preview) throw new Error(t("status.generatedButMissingPreview"));
      return job;
    }
    if (activeJob.status === "error" || activeJob.status === "canceled") {
      throw new Error(activeJob.message || t("status.notComplete"));
    }

    await delay(ACTIVE_JOB_POLL_MS);
  }
}

function updateProgressFromJob(job) {
  if (!job) return;
  requestGeneratedProgressCopy(job);
  if (typeof job.progress === "number") {
    nodes.progressBar.hidden = false;
    showProgress(displayProgressForJob(job));
  }
  if (job.message) {
    const message = displayMessageForJob(job);
    setStatus(message, job.status === "error");
    setProgressLabel(message);
  }
  if (job.status === "canceling") {
    nodes.cancelBtn.hidden = false;
    nodes.cancelBtn.disabled = true;
  }
  if (job.status === "canceled" || job.status === "error" || job.status === "complete") {
    nodes.cancelBtn.hidden = true;
  }
}

function showProgress(value) {
  const progress = Number.isFinite(Number(value)) ? Math.max(0, Math.min(100, Number(value))) : 0;
  nodes.progressFill.style.width = `${progress}%`;
  nodes.progressPercent.textContent = `${Math.round(progress)}%`;
}

function setProgressLabel(text) {
  if (nodes.progressLabel) nodes.progressLabel.textContent = localizeKnownMessage(text);
}

function updateLocalProgress(label, progress) {
  nodes.progressBar.hidden = false;
  showProgress(progress);
  setProgressLabel(label);
  setStatus(label);
}

function displayProgressForJob(job) {
  const baseProgress = clampProgress(job.progress);
  if (!isLiveAiWait(job)) return baseProgress;

  const cap = optimisticProgressCap(job, baseProgress);
  const elapsedMs = elapsedSinceJobUpdate(job);
  const ramp = 1 - Math.exp(-elapsedMs / AI_WAIT_RAMP_MS);
  return Math.max(baseProgress, Math.min(cap, Math.round(baseProgress + (cap - baseProgress) * ramp)));
}

function displayMessageForJob(job) {
  if (!isLiveAiWait(job)) return job.message;
  const elapsedSeconds = Math.floor(elapsedSinceJobUpdate(job) / 1000);
  if (elapsedSeconds < 3) return localizeKnownMessage(job.message);
  return `${aiWaitCopy(job, elapsedSeconds)} · ${formatElapsedSeconds(elapsedSeconds)}`;
}

function optimisticProgressCap(job, baseProgress) {
  if (job.phase === "coarse_planning") return Math.max(baseProgress, 54);
  if (job.phase === "refining") return Math.max(baseProgress, Math.min(85, baseProgress + 12));
  if (job.phase === "retrying") return Math.max(baseProgress, 93);
  return Math.max(baseProgress, 80);
}

function elapsedSinceJobUpdate(job) {
  const startedAt = Date.parse(job.updatedAt || job.createdAt || "");
  if (!Number.isFinite(startedAt)) return 0;
  return Math.max(0, Date.now() - startedAt);
}

function clampProgress(value) {
  return Number.isFinite(Number(value)) ? Math.max(0, Math.min(100, Number(value))) : 0;
}

function isLiveAiWait(job) {
  return isLiveJob(job) && AI_WAIT_PHASES.has(job.phase);
}

function aiWaitCopy(job, elapsedSeconds) {
  const copies = generatedProgressCopyForJob(job) || t(`aiWait.${job.phase}`) || t("aiWait.planning");
  const index = Math.floor(elapsedSeconds / AI_WAIT_COPY_INTERVAL_SECONDS) % copies.length;
  return copies[index];
}

function requestGeneratedProgressCopy(job) {
  if (!isLiveAiWait(job)) return;
  const operationId = progressCopyOperationId(job);
  if (generatedCopyByOperation.has(operationId) || generatedCopyRequests.has(operationId)) return;

  generatedCopyRequests.add(operationId);
  sendMessage({
    type: "progressCopy:generate",
    operationId,
    phase: job.phase,
    tabCount: job.tabCount || 0,
    windowCount: job.windowCount || 0,
    languageMode: uiLanguage
  })
    .then((result) => {
      const messages = Array.isArray(result?.messages) ? result.messages.filter(Boolean) : [];
      if (messages.length) rememberGeneratedProgressCopy(operationId, messages);
    })
    .catch(() => {})
    .finally(() => {
      generatedCopyRequests.delete(operationId);
    });
}

function generatedProgressCopyForJob(job) {
  return generatedCopyByOperation.get(progressCopyOperationId(job)) || null;
}

function progressCopyOperationId(job) {
  return job.operationId || `${job.phase || "planning"}:${job.createdAt || ""}`;
}

function scopedWindowMessage(message) {
  return Number.isInteger(panelWindowId) ? { ...message, windowId: panelWindowId } : message;
}

function rememberGeneratedProgressCopy(operationId, messages) {
  if (!generatedCopyByOperation.has(operationId) && generatedCopyByOperation.size >= GENERATED_COPY_CACHE_LIMIT) {
    const oldestKey = generatedCopyByOperation.keys().next().value;
    generatedCopyByOperation.delete(oldestKey);
  }
  generatedCopyByOperation.set(operationId, messages);
}

function formatElapsedSeconds(totalSeconds) {
  if (totalSeconds < 60) return uiLanguage === "en-US" ? `${totalSeconds}s` : `${totalSeconds}秒`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (uiLanguage === "en-US") return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  return seconds ? `${minutes}分${seconds}秒` : `${minutes}分`;
}

function formatAgo(ms) {
  const days = Math.max(0, Math.floor(Number(ms || 0) / (24 * 60 * 60 * 1000)));
  if (days >= 1) return uiLanguage === "en-US" ? `${days}d ago` : `约 ${days} 天前`;
  const hours = Math.max(1, Math.floor(Number(ms || 0) / (60 * 60 * 1000)));
  return uiLanguage === "en-US" ? `${hours}h ago` : `约 ${hours} 小时前`;
}

function isLiveJob(job) {
  return job?.status === "running" || job?.status === "canceling";
}

function setStatusKey(key, params = {}, isError = false) {
  currentStatus = { key, params, text: "", isError };
  renderStatus();
}

function setStatus(text, isError = false) {
  currentStatus = { key: "", params: {}, text: String(text || ""), isError };
  renderStatus();
}

function renderStatus() {
  const text = currentStatus.key ? t(currentStatus.key, currentStatus.params) : localizeKnownMessage(currentStatus.text);
  nodes.statusText.textContent = text;
  nodes.statusText.dataset.tone = currentStatus.isError ? "error" : "";
}

function localizeKnownMessage(message = "") {
  const text = String(message || "");
  if (uiLanguage !== "en-US") return text;

  const exact = new Map([
    ["正在准备整理", t("status.preparing")],
    ["正在保存偏好", "Saving preferences"],
    ["正在读取标签页", "Reading tabs"],
    ["正在生成 AI 方案", "Building AI plan"],
    ["正在生成预览", "Preparing preview"],
    ["方案好了，可以先检查", t("status.planReady")],
    ["方案需要检查", t("status.planNeedsReview")],
    ["已取消整理。", t("status.canceled")],
    ["后台任务已停止，请重新生成。", t("status.previousFailed")],
    ["正在校验 AI 方案", "Checking AI plan"],
    ["方案未通过校验，正在要求 AI 修正", "Asking AI to fix the plan"],
    ["正在校验修正方案", "Checking the revised plan"],
    ["页面摘要已关闭", "Page summaries are off"],
    ["没有需要补充页面线索", "No extra page clues needed"],
    ["正在补充页面线索", "Adding page clues"],
    ["使用已缓存页面线索", "Using cached page clues"],
    ["已补充部分页面线索", "Added some page clues"],
    ["继续参考标题、网址和原始顺序", "Continuing with titles, URLs, and tab order"],
    ["正在请求 AI 规划", "Asking AI to plan"],
    ["AI 已返回，正在解析方案", "AI returned a plan; parsing it"],
    ["正在快速粗分标签页", "Quickly grouping tabs"],
    ["正在细分不确定标签页", "Refining uncertain tabs"],
    ["不确定标签页已细分", "Uncertain tabs refined"],
    ["正在合并精分结果", "Merging refined results"],
    ["正在取消整理", t("status.canceling")]
  ]);
  if (exact.has(text)) return exact.get(text);

  let match = text.match(/^已读取 (\d+) 个可整理标签页$/);
  if (match) return `Read ${match[1]} tabs to organize`;
  match = text.match(/^使用已缓存页面摘要 (\d+) 个$/);
  if (match) return `Using ${match[1]} cached page summaries`;
  match = text.match(/^正在补充页面线索，已补充 (\d+) 个$/);
  if (match) return `Adding page clues, ${match[1]} added`;
  match = text.match(/^已补充 (\d+) 个页面摘要$/);
  if (match) return `Added ${match[1]} page summaries`;
  match = text.match(/^已找到 (\d+) 个主题方向$/);
  if (match) return `Found ${match[1]} topic lanes`;
  match = text.match(/^正在精分「(.+)」$/);
  if (match) return `Refining "${match[1]}"`;
  match = text.match(/^已精分「(.+)」$/);
  if (match) return `Refined "${match[1]}"`;
  return text;
}

function syncChoiceGroups() {
  document.querySelectorAll("[data-choice-for]").forEach((group) => {
    const field = fields[group.dataset.choiceFor];
    if (!field) return;
    group.querySelectorAll("button[data-value]").forEach((button) => {
      const selected = button.dataset.value === field.value;
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    });
  });
}

function syncActionState() {
  nodes.appShell.dataset.flowState = lastPreview || lastError ? "preview" : "setup";
  nodes.actions.dataset.state = lastPreview ? "preview" : lastError ? "error" : "idle";
  nodes.actions.dataset.canUndo = canUndo ? "true" : "false";
  nodes.applyBtn.hidden = !lastPreview;
  nodes.undoBtn.hidden = !canUndo;
  setButtonLabel(nodes.analyzeBtn, t(lastPreview ? "button.regenerate" : "button.generate"));
  nodes.applyBtn.dataset.role = lastPreview && lastCanApply ? "primary" : "";
}

function setButtonLabel(button, text) {
  const label = button.querySelector(".button-label");
  if (label) {
    label.textContent = text;
  } else {
    button.textContent = text;
  }
}

async function ensurePlannerHostPermission(settings) {
  if (settings.plannerProvider !== "gateway") return;
  if (!globalThis.chrome?.permissions?.contains || !globalThis.chrome?.permissions?.request) return;

  const pattern = providerPermissionPattern(settings.gatewayBaseUrl || BUILTIN_GATEWAY_BASE_URL);
  if (!pattern) return;

  const hasPermission = await chrome.permissions.contains({ origins: [pattern] });
  if (hasPermission) return;

  const granted = await chrome.permissions.request({ origins: [pattern] });
  if (!granted) {
    throw new Error(t("status.permissionAiGateway"));
  }
}

async function ensureContinuousSummaryPermissions() {
  if (!hasContentAccessFeature()) {
    throw new Error(t("status.unsupportedContinuousSummary"));
  }
  if (!globalThis.chrome?.permissions?.contains || !globalThis.chrome?.permissions?.request) return;

  await requireOptionalPermission(
    {
      permissions: ["scripting"],
      origins: continuousSummaryOrigins()
    },
    t("status.permissionContinuousSummary")
  );
}

function continuousSummaryOrigins() {
  const optionalOrigins = globalThis.chrome?.runtime?.getManifest?.().optional_host_permissions || [];
  const broadOrigins = optionalOrigins.filter((origin) => origin === "https://*/*" || origin === "http://*/*");
  return broadOrigins.length ? broadOrigins : ["https://*/*", "http://*/*"];
}

async function ensurePageSamplingPermissions(settings, options = {}) {
  if (settings.pageContextMode === "off" || settings.pageSamplingConsentMode === "not_acknowledged") return;
  if (!hasContentAccessFeature()) {
    throw new Error(t("status.unsupportedPageSummary"));
  }
  if (!globalThis.chrome?.permissions?.contains || !globalThis.chrome?.permissions?.request) return;
  const requestMissing = Boolean(options.requestMissing);

  const shouldRequestHostOrigins =
    settings.pageContextMode !== "active_tab_only" && settings.hostPermissionRequestMode !== "never";
  if (shouldRequestHostOrigins && !pageSamplingOriginCache.origins.length) {
    await refreshPageSamplingOriginCache();
  }
  const origins = shouldRequestHostOrigins ? pageSamplingOriginCache.origins : [];
  const missingPermissions = [];
  const hasScripting = await chrome.permissions.contains({ permissions: ["scripting"] });
  if (!hasScripting) missingPermissions.push("scripting");
  const missingOrigins = await getMissingOrigins(origins);

  if (!requestMissing) {
    if (missingPermissions.length) {
      throw new Error(t("status.permissionFirstEnablePageSummary"));
    }
    return;
  }

  if (settings.hostPermissionRequestMode === "ask_per_origin" && missingOrigins.length > 1) {
    const [firstOrigin, ...remainingOrigins] = missingOrigins;
    await requireOptionalPermission(
      {
        permissions: missingPermissions,
        origins: firstOrigin ? [firstOrigin] : []
      },
      t("status.permissionPageSummary")
    );
    for (const origin of remainingOrigins) {
      await requireOptionalPermission({ origins: [origin] }, t("status.permissionPageSummary"));
    }
    return;
  }

  if (missingPermissions.length || missingOrigins.length) {
    await requireOptionalPermission(
      {
        permissions: missingPermissions,
        origins: missingOrigins
      },
      t("status.permissionPageSummary")
    );
  }
}

function schedulePageSamplingOriginRefresh() {
  clearTimeout(pageSamplingOriginRefreshTimer);
  pageSamplingOriginRefreshTimer = setTimeout(() => {
    refreshPageSamplingOriginCache().catch(() => {
      pageSamplingOriginCache = { origins: [], refreshedAt: Date.now() };
      globalThis.__semanticTabAgentPageSamplingOrigins = pageSamplingOriginCache;
    });
  }, 50);
}

function hasContentAccessFeature() {
  const manifest = globalThis.chrome?.runtime?.getManifest?.();
  if (!manifest) return true;
  return Boolean(
    (manifest.optional_permissions || []).includes("scripting") &&
      (manifest.optional_host_permissions || []).some((origin) => origin === "https://*/*" || origin === "http://*/*")
  );
}

async function refreshPageSamplingOriginCache() {
  if (!hasContentAccessFeature()) {
    pageSamplingOriginCache = { origins: [], refreshedAt: Date.now() };
    globalThis.__semanticTabAgentPageSamplingOrigins = pageSamplingOriginCache;
    return;
  }
  const settings = readSettings({ effectiveForAnalysis: true });
  const shouldCollect =
    settings.pageContextMode !== "off" &&
    settings.pageSamplingConsentMode !== "not_acknowledged" &&
    settings.pageContextMode !== "active_tab_only" &&
    settings.hostPermissionRequestMode !== "never";
  const windowId = shouldCollect ? await resolveInvocationWindowId() : null;
  const origins = shouldCollect ? await collectPageSamplingOrigins(settings, windowId) : [];
  pageSamplingOriginCache = { origins, refreshedAt: Date.now() };
  globalThis.__semanticTabAgentPageSamplingOrigins = pageSamplingOriginCache;
}

async function getMissingOrigins(origins) {
  const missing = [];
  for (const origin of origins) {
    const hasPermission = await chrome.permissions.contains({ origins: [origin] });
    if (!hasPermission) missing.push(origin);
  }
  return missing;
}

async function requestOptionalPermission(request) {
  const permissionRequest = compactPermissionRequest(request);
  if (!permissionRequest) return true;

  const hasPermission = await chrome.permissions.contains(permissionRequest);
  if (hasPermission) return true;
  return chrome.permissions.request(permissionRequest);
}

async function requireOptionalPermission(request, errorMessage) {
  const granted = await requestOptionalPermission(request);
  if (!granted) {
    throw new Error(errorMessage || t("status.permissionPageSummary"));
  }
}

function compactPermissionRequest(request = {}) {
  const permissions = request.permissions?.filter(Boolean) || [];
  const origins = request.origins?.filter(Boolean) || [];
  if (!permissions.length && !origins.length) return null;
  return {
    ...(permissions.length ? { permissions } : {}),
    ...(origins.length ? { origins } : {})
  };
}

async function collectPageSamplingOrigins(settings, windowId) {
  const tabs = await collectVisibleTabs(settings, windowId);
  return [
    ...new Set(
      tabs
        .filter((tab) => isEligibleForPageSampling(tab, settings))
        .filter((tab) => settings.pageContextMode !== "ambiguous_with_permission" || isAmbiguousTab(tab))
        .map((tab) => hostPermissionPattern(tab.url || tab.pendingUrl || ""))
        .filter(Boolean)
    )
  ];
}

async function collectVisibleTabs(settings, windowId) {
  if (!globalThis.chrome?.windows) return [];
  if (settings.organizeMode === "consolidate_one_window") {
    const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
    return windows.flatMap((window) => window.tabs || []);
  }

  const targetWindow =
    Number.isInteger(windowId)
      ? await chrome.windows.get(windowId, { populate: true })
      : await chrome.windows.getCurrent({ populate: true });
  return targetWindow?.tabs || [];
}

function isEligibleForPageSampling(tab, settings) {
  if (!tab || typeof tab.id !== "number") return false;
  if (tab.pinned && !settings.includePinnedTabs) return false;
  if (tab.incognito && !settings.includeIncognitoTabs) return false;
  return Boolean(hostPermissionPattern(tab.url || tab.pendingUrl || ""));
}

function isAmbiguousTab(tab) {
  const title = String(tab.title || "").trim().toLowerCase();
  return !title || title.length < 18 || ["home", "new tab", "untitled", "login", "sign in"].some((term) => title.includes(term));
}

function providerPermissionPattern(baseUrl) {
  return hostPermissionPattern(baseUrl);
}

function hostPermissionPattern(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!["https:", "http:"].includes(url.protocol)) return "";
    return `${url.protocol}//${url.hostname}/*`;
  } catch {
    return "";
  }
}

async function sendMessage(message) {
  const payload = shouldAttachWindowId(message) && !Number.isInteger(message?.windowId) && Number.isInteger(panelWindowId)
    ? { ...message, windowId: panelWindowId }
    : message;
  if (!globalThis.chrome?.runtime?.sendMessage) {
    return mockMessage(payload);
  }

  const response = await chrome.runtime.sendMessage(payload);
  if (!response?.ok) {
    throw new Error(response?.error || "Extension request failed.");
  }
  return response.result;
}

function shouldAttachWindowId(message) {
  if (!message?.type) return false;
  return message.type.startsWith("tabs:") || message.type.startsWith("activity:") || message.type === "progressCopy:generate";
}

async function resolveInvocationWindowId() {
  const sourceWindowId = sourceWindowIdFromUrl();
  if (Number.isInteger(sourceWindowId)) {
    if (!globalThis.chrome?.windows?.get) return sourceWindowId;
    const sourceWindow = await chrome.windows.get(sourceWindowId).catch(() => null);
    if (sourceWindow?.type === "normal") return sourceWindowId;
  }

  const activeTabWindowId = await lastFocusedActiveTabWindowId();
  if (Number.isInteger(activeTabWindowId)) return activeTabWindowId;

  if (!globalThis.chrome?.windows?.getCurrent) return null;
  try {
    if (globalThis.chrome?.windows?.getLastFocused) {
      const focusedNormalWindow = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
      if (Number.isInteger(focusedNormalWindow?.id)) return focusedNormalWindow.id;
    }
    const currentWindow = await chrome.windows.getCurrent();
    return currentWindow?.id ?? null;
  } catch {
    return null;
  }
}

async function lastFocusedActiveTabWindowId() {
  if (!globalThis.chrome?.tabs?.query) return null;
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
  if (!Number.isInteger(activeTab?.windowId)) return null;
  if (!globalThis.chrome?.windows?.get) return activeTab.windowId;

  const window = await chrome.windows.get(activeTab.windowId).catch(() => null);
  return window?.type === "normal" ? activeTab.windowId : null;
}

function sourceWindowIdFromUrl() {
  try {
    const rawSourceWindowId = new URL(globalThis.location.href).searchParams.get("sourceWindowId");
    if (!rawSourceWindowId) return null;

    const sourceWindowId = Number(rawSourceWindowId);
    return Number.isInteger(sourceWindowId) && sourceWindowId > 0 ? sourceWindowId : null;
  } catch {
    return null;
  }
}

async function mockMessage(message) {
  if (message.type === "settings:get") {
    return {
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
      languageMode: "auto",
      promptPreset: "conservative",
      plannerProvider: "gateway",
      rememberProviderKeys: false,
      gatewayBaseUrl: "",
      gatewayModel: "gpt-5.5",
      gatewayCustomModel: "",
      gatewayThinkingIntensity: "high",
      gatewayApiKey: "",
      customPrompt: ""
    };
  }
  if (message.type === "settings:save") {
    return message.settings || {};
  }
  if (message.type === "tabs:startAnalyze") {
    mockLastJob = mockAnalysisJob();
    mockActiveJob = {
      operationId: "mock_job",
      status: "complete",
      phase: "complete",
      progress: 100,
      message: "方案好了，可以先检查",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString()
    };
    return { operationId: mockActiveJob.operationId };
  }
  if (message.type === "tabs:analyze") {
    return mockAnalysisJob();
  }
  if (message.type === "tabs:getLastJob") return mockLastJob || mockAnalysisJob();
  if (message.type === "tabs:applyLastPlan") return { createdGroupIds: [1, 2] };
  if (message.type === "tabs:undoLastApply") return { restoredTabs: 20 };
  if (message.type === "tabs:getActiveJob") return mockActiveJob;
  if (message.type === "tabs:canUndo") return { canUndo };
  if (message.type === "tabs:clearAnalysisState") {
    mockActiveJob = null;
    mockLastJob = null;
    return { cleared: true };
  }
  if (message.type === "tabs:cancelActiveJob") return { canceled: false, job: mockActiveJob };
  if (message.type === "activity:focusTab") return { focused: true, tabId: message.tabId, windowId: message.windowId };
  if (message.type === "activity:getOverview" || message.type === "activity:analyzeCleanup") {
    const overview = {
      rangeMs: message.rangeMs || 604800000,
      generatedAt: new Date().toISOString(),
      cache: { entries: 18, sampledEntries: 7 },
      openTabs: { total: 24, tracked: 18, staleCandidates: 2 },
      recap: {
        entries: 18,
        sampledEntries: 7,
        topHosts: [
          { value: "github.com", count: 5 },
          { value: "developer.chrome.com", count: 3 }
        ],
        topTerms: [
          { value: "extensions", count: 4 },
          { value: "tabs", count: 3 },
          { value: "agent", count: 2 }
        ],
        recentPages: [
          { title: "Chrome extensions API", hostname: "developer.chrome.com", seenCount: 3, hasSummary: true },
          { title: "Current project issues", hostname: "github.com", seenCount: 2, hasSummary: false }
        ]
      },
      staleTabs: [
        {
          tabId: 31,
          windowId: 1,
          title: "Old comparison notes",
          hostname: "example.com",
          currentGroupTitle: "Research",
          ageMs: 16 * 24 * 60 * 60 * 1000,
          idleMs: 9 * 24 * 60 * 60 * 1000,
          activeCount: 1,
          summary: { metaDescription: "Comparison notes for an earlier investigation", headings: ["Old direction"] }
        },
        {
          tabId: 32,
          windowId: 1,
          title: "Previous research",
          hostname: "example.org",
          currentGroupTitle: "",
          ageMs: 22 * 24 * 60 * 60 * 1000,
          idleMs: 18 * 24 * 60 * 60 * 1000,
          activeCount: 0
        }
      ]
    };
    if (message.type === "activity:getOverview") return overview;
    return {
      overview,
      cleanup: {
        summary: "这 2 个标签页看起来更像旧任务遗留，可以先从它们开始。",
        candidates: [
          {
            tabId: 31,
            windowId: 1,
            title: "Old comparison notes",
            hostname: "example.com",
            currentGroupTitle: "Research",
            ageMs: 16 * 24 * 60 * 60 * 1000,
            idleMs: 9 * 24 * 60 * 60 * 1000,
            activeCount: 1,
            priority: "high",
            reason: "它像是上一轮对比调研留下的页面，时间较久且近期没有再打开。",
            evidence: ["首次见到约 16 天前", "最近活跃约 9 天前", "当前分组 Research"],
            summary: { metaDescription: "Comparison notes for an earlier investigation", headings: ["Old direction"] }
          },
          {
            tabId: 32,
            windowId: 1,
            title: "Previous research",
            hostname: "example.org",
            currentGroupTitle: "",
            ageMs: 22 * 24 * 60 * 60 * 1000,
            idleMs: 18 * 24 * 60 * 60 * 1000,
            activeCount: 0,
            priority: "medium",
            reason: "标题显示是旧研究资料，且没有归属到当前分组。",
            evidence: ["未分组", "长期未活跃"]
          }
        ]
      }
    };
  }
  throw new Error(`Mock does not implement ${message.type}`);
}

function mockAnalysisJob() {
  return {
      validation: { ok: true, warnings: [] },
      preview: {
        requiresConfirmation: false,
        groups: [
          { title: "AI 研究", reason: "模型、论文和文档", tabCount: 12 },
          { title: "当前项目", reason: "Issue、PR 和本地应用", tabCount: 8 }
        ],
        totalTabsCount: 24,
        eligibleTabsCount: 23,
        windowCount: 1,
        groupedTabsCount: 20,
        reviewTabsCount: 3,
        reviewGroupWillBeCreated: true,
        excludedTabsCount: 1,
        lockedGroupsCount: 0,
        pageSampling: {
          requested: 3,
          ok: 2,
          permissionRequired: 1,
          blocked: 0
        },
        warnings: []
      }
  };
}

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
