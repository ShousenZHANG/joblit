/** Simple i18n system for the extension. */

export type Locale = "en" | "zh";

const messages: Record<Locale, Record<string, string>> = {
  en: {
    // General
    "app.name": "Jobflow AutoFill",
    "app.loading": "Loading...",

    // Auth
    "auth.connect": "Connect to Jobflow",
    "auth.connectDesc": "Generate an API token from your Jobflow account settings and paste it below.",
    "auth.tokenPlaceholder": "jfext_...",
    "auth.connecting": "Connecting...",
    "auth.connected": "CONNECTED",
    "auth.disconnect": "Disconnect",
    "auth.tokenInvalid": "Token is invalid or expired. Please check and try again.",
    "auth.tokenEmpty": "Please enter your API token",

    // Dashboard
    "dashboard.fillNow": "Fill Current Page",
    "dashboard.toggleWidget": "Toggle Widget",
    "dashboard.noProfile": "No profile found. Create one in Jobflow first.",

    // History
    "history.title": "Submission History",
    "history.empty": "No submissions yet",
    "history.emptyDesc": "Fill a form on any ATS site and your submissions will appear here.",
    "history.fieldsFilled": "{filled}/{total} fields filled",

    // Profile
    "profile.locale": "Resume Locale",
    "profile.active": "ACTIVE PROFILE",
    "profile.noProfile": "No profile found for this locale. Create one in Jobflow.",
    "profile.manageHint": "Manage full profile details on Jobflow web.",

    // Widget
    "widget.fillAll": "Fill All",
    "widget.record": "Record",
    "widget.noFields": "No form fields detected on this page.",

    // Errors
    "error.network": "Network error. Please check your connection.",
    "error.notAuthenticated": "Not authenticated. Please connect your Jobflow account.",
    "error.profileLoad": "Could not load profile. Please check your connection.",
    "error.fillFailed": "Form fill failed. Please try again.",
    "error.unknown": "An unexpected error occurred.",

    // Options
    "options.title": "Settings",
    "options.apiBase": "API Base URL",
    "options.apiBaseDesc": "Change only if using a self-hosted Jobflow instance.",
    "options.autoFill": "Auto-fill on page load",
    "options.showWidget": "Show floating widget",
    "options.saved": "Settings saved",
  },
  zh: {
    "app.name": "Jobflow 自动填充",
    "app.loading": "加载中...",

    "auth.connect": "连接 Jobflow",
    "auth.connectDesc": "从 Jobflow 账户设置中生成 API 令牌，粘贴到下方。",
    "auth.tokenPlaceholder": "jfext_...",
    "auth.connecting": "连接中...",
    "auth.connected": "已连接",
    "auth.disconnect": "断开连接",
    "auth.tokenInvalid": "令牌无效或已过期，请检查后重试。",
    "auth.tokenEmpty": "请输入 API 令牌",

    "dashboard.fillNow": "填充当前页面",
    "dashboard.toggleWidget": "切换悬浮组件",
    "dashboard.noProfile": "未找到简历。请先在 Jobflow 中创建。",

    "history.title": "提交历史",
    "history.empty": "暂无提交记录",
    "history.emptyDesc": "在 ATS 网站填写表单后，提交记录将显示在这里。",
    "history.fieldsFilled": "已填充 {filled}/{total} 个字段",

    "profile.locale": "简历语言",
    "profile.active": "当前简历",
    "profile.noProfile": "未找到该语言的简历，请在 Jobflow 中创建。",
    "profile.manageHint": "在 Jobflow 网页端管理完整简历信息。",

    "widget.fillAll": "全部填充",
    "widget.record": "记录",
    "widget.noFields": "当前页面未检测到表单字段。",

    "error.network": "网络错误，请检查网络连接。",
    "error.notAuthenticated": "未认证，请连接 Jobflow 账户。",
    "error.profileLoad": "无法加载简历，请检查网络连接。",
    "error.fillFailed": "表单填充失败，请重试。",
    "error.unknown": "发生意外错误。",

    "options.title": "设置",
    "options.apiBase": "API 地址",
    "options.apiBaseDesc": "仅在使用自托管 Jobflow 时修改。",
    "options.autoFill": "页面加载时自动填充",
    "options.showWidget": "显示悬浮组件",
    "options.saved": "设置已保存",
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
