import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { resumeContext } = vi.hoisted(() => ({
  resumeContext: {} as Record<string, unknown>,
}));

vi.mock("next/dynamic", () => ({
  default: () => function DynamicPreviewMock() {
    return null;
  },
}));

vi.mock("./ResumeContext", () => ({
  useResumeContext: () => resumeContext,
}));

import { PreviewPanel } from "./PreviewPanel";
import { MobilePreviewDialog } from "./ResumePageLayout";
import { SectionNav } from "./SectionNav";

const translations: Record<string, string> = {
  personalInfo: "个人信息",
  summary: "个人简介",
  experience: "工作经历",
  projects: "项目经历",
  education: "教育背景",
  skills: "技能",
  toastAddDetailsFirst: "请先添加信息",
  saving: "正在保存",
  unsavedChanges: "有未保存的更改",
  toastSaved: "已保存",
  saveSelectedResume: "保存所选简历",
  preview: "预览",
  pdfPreview: "PDF 预览",
  pdfPreviewDesc: "预览会自动刷新",
  sectionsAria: "简历栏目",
  refreshPreview: "刷新预览",
  openPreviewNewTab: "在新标签页打开预览",
  retryPreview: "重试",
  generatingPreview: "正在生成预览…",
  unnamedResumeFilename: "中文简历",
  download: "下载",
  close: "关闭",
  previewFailed: "预览生成失败",
};

beforeEach(() => {
  Object.assign(resumeContext, {
    activeSection: "personal",
    setActiveSection: vi.fn(),
    locale: "zh-CN",
    t: (key: string) => translations[key] ?? key,
    saving: false,
    saveState: "saved",
    handleSave: vi.fn(),
    hasAnyContent: true,
    setPreviewOpen: vi.fn(),
    schedulePreview: vi.fn(),
    isTaskHighlighted: vi.fn(() => false),
    pdfUrl: "blob:resume-preview",
    previewStatus: "error",
    previewError: null,
    basics: { fullName: "张三", title: "平台工程师" },
    previewOpen: true,
  });
});

afterEach(cleanup);

describe("resume navigation accessibility", () => {
  it("uses localized navigation copy and touch targets for hybrid pointer devices", () => {
    render(<SectionNav />);

    const nav = screen.getByRole("navigation", { name: "简历栏目" });
    for (const button of within(nav).getAllByRole("button")) {
      expect(button).toHaveClass("[@media(any-pointer:coarse)]:min-h-11");
    }
  });
});

describe("resume preview accessibility", () => {
  it("localizes toolbar controls and keeps them touch-sized on hybrid pointer devices", () => {
    render(<PreviewPanel />);

    const refresh = screen.getByRole("button", { name: "刷新预览" });
    const open = screen.getByRole("link", { name: "在新标签页打开预览" });
    const retry = screen.getByRole("button", { name: "重试" });

    expect(refresh).toHaveClass("[@media(any-pointer:coarse)]:min-h-11");
    expect(refresh).toHaveClass("[@media(any-pointer:coarse)]:min-w-11");
    expect(open).toHaveClass("[@media(any-pointer:coarse)]:min-h-11");
    expect(open).toHaveClass("[@media(any-pointer:coarse)]:min-w-11");
    expect(retry).toHaveClass("[@media(any-pointer:coarse)]:min-h-11");
  });

  it("localizes the mobile preview loading state", () => {
    Object.assign(resumeContext, {
      pdfUrl: null,
      previewStatus: "loading",
      previewError: null,
    });

    render(<MobilePreviewDialog />);

    expect(screen.getByText("正在生成预览…")).toBeInTheDocument();
    expect(screen.queryByText("Generating preview…")).not.toBeInTheDocument();
  });

  it("localizes mobile preview recovery and keeps Retry touch-sized", () => {
    Object.assign(resumeContext, {
      pdfUrl: null,
      previewStatus: "error",
      previewError: null,
    });

    render(<MobilePreviewDialog />);

    const retry = screen.getByRole("button", { name: "重试" });
    expect(retry).toHaveClass("h-11");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();

    fireEvent.click(retry);
    expect(resumeContext.schedulePreview).toHaveBeenCalledWith(0, false, {
      force: true,
    });
  });

  it("localizes the fallback filename and protects mobile header actions with safe areas", () => {
    Object.assign(resumeContext, {
      pdfUrl: "blob:resume-preview",
      previewStatus: "idle",
      previewError: null,
      basics: { fullName: "", title: "" },
    });

    render(<MobilePreviewDialog />);

    const header = screen.getByTestId("resume-mobile-preview-header");
    expect(header).toHaveClass(
      "pt-[env(safe-area-inset-top)]",
      "pl-[max(0.75rem,env(safe-area-inset-left))]",
      "pr-[max(0.75rem,env(safe-area-inset-right))]",
    );

    const download = screen.getByRole("link", { name: "下载" });
    expect(download).toHaveAttribute("download", "中文简历_CV.pdf");
    expect(download).toHaveClass("min-h-11");

    const close = screen.getByRole("button", { name: "关闭" });
    expect(close).toHaveClass("h-11");
  });
});
