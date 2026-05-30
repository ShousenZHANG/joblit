"use client";

import Image from "next/image";
import { Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { SectionShell } from "../SectionShell";
import type { ResumeBasics, ResumeLink } from "../types";

interface PersonalInfoSectionProps {
  basics: ResumeBasics;
  links: ResumeLink[];
  locale: string;
  updateBasics: (field: keyof ResumeBasics, value: string) => void;
  updateLink: (index: number, field: keyof ResumeLink, value: string) => void;
  addLink: () => void;
  removeLink: (index: number) => void;
}

export function PersonalInfoSection({
  basics,
  links,
  locale,
  updateBasics,
  updateLink,
  addLink,
  removeLink,
}: PersonalInfoSectionProps) {
  const t = useTranslations("resumeForm");
  const { toast } = useToast();

  return (
    <SectionShell title={t("personalInfo")} description={t("personalInfoDesc")}>
      <div className="space-y-5">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="resume-full-name">{t("fullName")}</Label>
            <Input
              id="resume-full-name"
              value={basics.fullName}
              onChange={(e) => updateBasics("fullName", e.target.value)}
              placeholder={t("fullNamePlaceholder")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="resume-title">{t("title")}</Label>
            <Input
              id="resume-title"
              value={basics.title}
              onChange={(e) => updateBasics("title", e.target.value)}
              placeholder={t("titlePlaceholder")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="resume-email">{t("email")}</Label>
            <Input
              id="resume-email"
              value={basics.email}
              onChange={(e) => updateBasics("email", e.target.value)}
              placeholder={t("emailPlaceholder")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="resume-phone">{t("phone")}</Label>
            <Input
              id="resume-phone"
              value={basics.phone}
              onChange={(e) => updateBasics("phone", e.target.value)}
              placeholder={t("phonePlaceholder")}
            />
          </div>
        </div>

        {locale === "zh-CN" && (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label>证件照</Label>
              <div className="flex items-center gap-2">
                {basics.photoUrl ? (
                  <>
                    <Image
                      src={basics.photoUrl}
                      alt="证件照"
                      width={48}
                      height={64}
                      className="h-16 w-12 rounded border object-cover"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        fetch(`/api/resume-photo?url=${encodeURIComponent(basics.photoUrl!)}`, {
                          method: "DELETE",
                        });
                        updateBasics("photoUrl", "");
                      }}
                    >
                      删除
                    </Button>
                  </>
                ) : (
                  <label className="cursor-pointer rounded-md border border-dashed px-4 py-2 text-sm text-muted-foreground hover:bg-muted/50">
                    点击上传
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        if (file.size > 2 * 1024 * 1024) {
                          toast({ title: "照片不能超过 2 MB", variant: "destructive" });
                          return;
                        }
                        try {
                          const res = await fetch("/api/resume-photo", {
                            method: "POST",
                            headers: { "content-type": file.type },
                            body: file,
                          });
                          if (!res.ok) throw new Error("upload failed");
                          const json = await res.json();
                          updateBasics("photoUrl", json.url);
                        } catch {
                          toast({ title: "上传失败，请重试", variant: "destructive" });
                        }
                        e.target.value = "";
                      }}
                    />
                  </label>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="resume-identity">身份</Label>
              <Input
                id="resume-identity"
                value={basics.identity ?? ""}
                onChange={(e) => updateBasics("identity", e.target.value)}
                placeholder="如: 大四学生 / 3年经验"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="resume-availability-month">到岗（YYYY-MM）</Label>
              <Input
                id="resume-availability-month"
                value={basics.availabilityMonth ?? ""}
                onChange={(e) => updateBasics("availabilityMonth", e.target.value)}
                placeholder="如: 2026-03"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="resume-wechat">微信</Label>
              <Input
                id="resume-wechat"
                value={basics.wechat ?? ""}
                onChange={(e) => updateBasics("wechat", e.target.value)}
                placeholder="微信号"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="resume-qq">QQ</Label>
              <Input
                id="resume-qq"
                value={basics.qq ?? ""}
                onChange={(e) => updateBasics("qq", e.target.value)}
                placeholder="QQ号"
              />
            </div>
          </div>
        )}

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-foreground">{t("links")}</h3>
              <p className="text-sm text-muted-foreground">{t("linksDesc")}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 gap-1.5"
              onClick={addLink}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t("addLink")}
            </Button>
          </div>
          {/* Compact one-row-per-link layout (LinkedIn/Notion style): label +
              URL inline, no repeated per-row text labels, icon-only remove.
              The grid uses underscore separators — `grid-cols-[a,b,c]` with
              commas is invalid Tailwind and silently collapses to a stacked
              full-width column. */}
          <div className="space-y-2">
            {links.map((link, index) => (
              <div
                key={`link-${index}`}
                className="grid items-center gap-2 sm:grid-cols-[minmax(0,150px)_minmax(0,1fr)_auto]"
              >
                <Input
                  aria-label={`${t("label")} ${index + 1}`}
                  value={link.label}
                  onChange={(e) => updateLink(index, "label", e.target.value)}
                  placeholder={t("linkLabelPlaceholder")}
                />
                <Input
                  aria-label={`${t("url")} ${index + 1}`}
                  value={link.url}
                  onChange={(e) => updateLink(index, "url", e.target.value)}
                  placeholder={t("linkUrlPlaceholder")}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`${t("remove")} ${link.label || index + 1}`}
                  disabled={links.length <= 1}
                  onClick={() => removeLink(index)}
                  className="justify-self-end text-muted-foreground hover:text-destructive disabled:opacity-30"
                >
                  <X className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </SectionShell>
  );
}
