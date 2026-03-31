import type { LocaleProfile } from "./index";

export const zhCN: LocaleProfile = {
  locale: "zh-CN",
  label: "简体中文",
  coverWordRange: { min: 400, max: 600 },
  dateFormat: "YYYY年M月D日",
  dateExample: "2026年2月5日",
  salutationStyle: "收件人称呼，无需「尊敬的」前缀",
  toneRules: [
    "中国职场风格：专业、简练、务实，突出数据和成果。",
    "避免过度谦虚或空洞客套，直接展示与岗位匹配的能力和经验。",
    "使用简体中文书面语，避免口语化和网络用语。",
    "段落结构清晰：主题句开头，证据支撑，结果收尾。",
    "技术关键词可保留英文原文（如 React、Kubernetes），无需翻译。",
    "大厂标准：以证据和匹配度为导向，避免泛泛而谈的自我评价。",
  ],
};
