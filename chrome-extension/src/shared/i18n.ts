/** Simple i18n system for the extension. */

export type Locale = "en" | "zh";

const messages: Record<Locale, Record<string, string>> = {
  en: {
    // General
    "app.name": "Joblit AutoFill",
    "app.loading": "Loading...",

    // Tabs
    "tab.home": "Home",
    "tab.history": "History",
    "tab.profile": "Profile",
    "tab.settings": "Settings",

    // Auth
    "auth.connect": "Connect to Joblit",
    "auth.connectDesc": "Generate an API token from your Joblit account settings and paste it below.",
    "auth.tokenPlaceholder": "jfext_...",
    "auth.connecting": "Connecting...",
    "auth.connected": "CONNECTED",
    "auth.disconnect": "Disconnect",
    "auth.tokenInvalid": "Token is invalid or expired. Please check and try again.",
    "auth.tokenEmpty": "Please enter your API token",
    "auth.setupHint": "Open Joblit → Settings → Extension to generate a token",
    "auth.apiBaseHint": "For local dev use http://localhost:3000",
    "auth.networkError": "Cannot reach {base}. Check the API Base URL is correct.",

    // Dashboard
    "dashboard.fillNow": "Fill Current Page",
    "dashboard.toggleWidget": "Toggle Widget",
    "dashboard.noProfile": "No profile found. Create one in Joblit first.",

    // History
    "history.title": "Submission History",
    "history.empty": "No submissions yet",
    "history.emptyDesc": "Fill a form on any ATS site and your submissions will appear here.",
    "history.fieldsFilled": "{filled}/{total} fields filled",

    // Profile
    "profile.locale": "Resume Locale",
    "profile.active": "ACTIVE PROFILE",
    "profile.noProfile": "No profile found for this locale. Create one in Joblit.",
    "profile.manageHint": "Manage full profile details on Joblit web.",

    // Widget
    "widget.fillAll": "Fill All",
    "widget.record": "Record",
    "widget.noFields": "No form fields detected on this page.",
    "widget.edit": "Edit value",
    "widget.typeValue": "Type a value...",
    "widget.clickToAdd": "Click to add value",
    "widget.review": "Review",
    "widget.reviewHint": "Review filled fields — edit or add missing values",
    "widget.saveAll": "Save All",
    "widget.looksGood": "Looks Good",
    "widget.ruleSaved": "Saved to knowledge base",

    // Errors
    "error.network": "Network error. Please check your connection.",
    "error.notAuthenticated": "Not authenticated. Please connect your Joblit account.",
    "error.profileLoad": "Could not load profile. Please check your connection.",
    "error.fillFailed": "Form fill failed. Please try again.",
    "error.unknown": "An unexpected error occurred.",

    // Options
    "options.title": "Settings",
    "options.apiBase": "API Base URL",
    "options.apiBaseDesc": "Change only if using a self-hosted Joblit instance.",
    "options.behavior": "Behavior",
    "options.autoFill": "Auto-fill on page load",
    "options.showWidget": "Show floating widget",
    "options.save": "Save Settings",
    "options.saved": "Saved!",
  },
  zh: {
    "app.name": "Joblit 自动填充",
    "app.loading": "加载中...",

    "tab.home": "首页",
    "tab.history": "历史",
    "tab.profile": "简历",
    "tab.settings": "设置",

    "auth.connect": "连接 Joblit",
    "auth.connectDesc": "从 Joblit 账户设置中生成 API 令牌，粘贴到下方。",
    "auth.tokenPlaceholder": "jfext_...",
    "auth.connecting": "连接中...",
    "auth.connected": "已连接",
    "auth.disconnect": "断开连接",
    "auth.tokenInvalid": "令牌无效或已过期，请检查后重试。",
    "auth.tokenEmpty": "请输入 API 令牌",
    "auth.setupHint": "打开 Joblit → 设置 → 扩展 来生成令牌",
    "auth.apiBaseHint": "本地开发请使用 http://localhost:3000",
    "auth.networkError": "无法连接 {base}，请检查 API 地址是否正确。",

    "dashboard.fillNow": "填充当前页面",
    "dashboard.toggleWidget": "切换悬浮组件",
    "dashboard.noProfile": "未找到简历。请先在 Joblit 中创建。",

    "history.title": "提交历史",
    "history.empty": "暂无提交记录",
    "history.emptyDesc": "在 ATS 网站填写表单后，提交记录将显示在这里。",
    "history.fieldsFilled": "已填充 {filled}/{total} 个字段",

    "profile.locale": "简历语言",
    "profile.active": "当前简历",
    "profile.noProfile": "未找到该语言的简历，请在 Joblit 中创建。",
    "profile.manageHint": "在 Joblit 网页端管理完整简历信息。",

    "widget.fillAll": "全部填充",
    "widget.record": "记录",
    "widget.noFields": "当前页面未检测到表单字段。",
    "widget.edit": "编辑",
    "widget.typeValue": "输入值...",
    "widget.clickToAdd": "点击添加",
    "widget.review": "检查",
    "widget.reviewHint": "检查已填字段 — 编辑或补充缺失值",
    "widget.saveAll": "全部保存",
    "widget.looksGood": "确认无误",
    "widget.ruleSaved": "已保存到知识库",

    "error.network": "网络错误，请检查网络连接。",
    "error.notAuthenticated": "未认证，请连接 Joblit 账户。",
    "error.profileLoad": "无法加载简历，请检查网络连接。",
    "error.fillFailed": "表单填充失败，请重试。",
    "error.unknown": "发生意外错误。",

    "options.title": "设置",
    "options.apiBase": "API 地址",
    "options.apiBaseDesc": "仅在使用自托管 Joblit 时修改。",
    "options.behavior": "行为",
    "options.autoFill": "页面加载时自动填充",
    "options.showWidget": "显示悬浮组件",
    "options.save": "保存设置",
    "options.saved": "已保存！",
  },
};

let currentLocale: Locale = "en";

/** Detect the user's preferred locale. */
export function detectLocale(): Locale {
  const lang = navigator.language.toLowerCase();
  if (lang.startsWith("zh")) return "zh";
  return "en";
}

/** Set the current locale. */
export function setLocale(locale: Locale): void {
  currentLocale = locale;
}

/** Get a translated message. Supports {key} placeholder replacement. */
export function t(key: string, params?: Record<string, string | number>): string {
  const msg = messages[currentLocale]?.[key] ?? messages.en[key] ?? key;
  if (!params) return msg;
  return msg.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`));
}

/** Get the current locale. */
export function getLocale(): Locale {
  return currentLocale;
}
