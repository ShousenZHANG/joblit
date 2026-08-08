"use client";

import { useState } from "react";
import Image from "next/image";
import { Github, Globe, Linkedin, User, X, Youtube } from "lucide-react";
import { useTranslations } from "next-intl";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { GhostAddRow } from "../GhostAddRow";
import { SectionShell } from "../SectionShell";
import {
  detectLinkBrand,
  isPlausibleEmail,
  isPlausibleUrl,
  suggestLinkLabel,
  type LinkBrand,
} from "../linkBrand";
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

const BRAND_ICONS: Partial<Record<LinkBrand, typeof Globe>> = {
  linkedin: Linkedin,
  github: Github,
  youtube: Youtube,
};

/** The mark shown at the head of a link row once its host is recognised. */
function LinkGlyph({ url }: { url: string }) {
  const brand = detectLinkBrand(url);
  const Icon = BRAND_ICONS[brand] ?? Globe;
  return (
    <span
      aria-hidden
      className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border bg-muted/40 text-muted-foreground"
    >
      <Icon className="h-4 w-4" />
    </span>
  );
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
  // Validation hints appear on blur, never while typing: flagging an email as
  // invalid at the third keystroke is noise, not help.
  const [touched, setTouched] = useState<{ email?: boolean }>({});
  const [touchedLinks, setTouchedLinks] = useState<ReadonlySet<number>>(new Set());
  const emailInvalid = touched.email && !isPlausibleEmail(basics.email);

  return (
    <SectionShell
      id="personal"
      icon={User}
      title={t("personalInfo")}
      description={t("personalInfoDesc")}
    >
      <div className="space-y-5">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="resume-full-name">{t("fullName")}</Label>
            <Input
              id="resume-full-name"
              value={basics.fullName}
              onChange={(e) => updateBasics("fullName", e.target.value)}
              placeholder={t("fullNamePlaceholder")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="resume-title">{t("title")}</Label>
            <Input
              id="resume-title"
              value={basics.title}
              onChange={(e) => updateBasics("title", e.target.value)}
              placeholder={t("titlePlaceholder")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="resume-email">{t("email")}</Label>
            <Input
              id="resume-email"
              type="email"
              inputMode="email"
              value={basics.email}
              aria-invalid={emailInvalid ? true : undefined}
              aria-describedby={emailInvalid ? "resume-email-hint" : undefined}
              onChange={(e) => updateBasics("email", e.target.value)}
              onBlur={() => setTouched((prev) => ({ ...prev, email: true }))}
              placeholder={t("emailPlaceholder")}
              className={emailInvalid ? "border-destructive/60" : undefined}
            />
            {emailInvalid ? (
              <p id="resume-email-hint" className="text-xs text-destructive">
                {t("emailHint")}
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="resume-phone">{t("phone")}</Label>
            <Input
              id="resume-phone"
              type="tel"
              inputMode="tel"
              value={basics.phone}
              onChange={(e) => updateBasics("phone", e.target.value)}
              placeholder={t("phonePlaceholder")}
            />
          </div>
        </div>

        {locale === "zh-CN" && (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
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
            <div className="space-y-1.5">
              <Label htmlFor="resume-identity">身份</Label>
              <Input
                id="resume-identity"
                value={basics.identity ?? ""}
                onChange={(e) => updateBasics("identity", e.target.value)}
                placeholder="如: 大四学生 / 3年经验"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="resume-availability-month">到岗（YYYY-MM）</Label>
              <Input
                id="resume-availability-month"
                value={basics.availabilityMonth ?? ""}
                onChange={(e) => updateBasics("availabilityMonth", e.target.value)}
                placeholder="如: 2026-03"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="resume-wechat">微信</Label>
              <Input
                id="resume-wechat"
                value={basics.wechat ?? ""}
                onChange={(e) => updateBasics("wechat", e.target.value)}
                placeholder="微信号"
              />
            </div>
            <div className="space-y-1.5">
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

        <div className="space-y-2">
          <div className="min-w-0">
            <h3 className="text-[13px] font-semibold text-foreground">{t("links")}</h3>
            <p className="text-xs text-muted-foreground">{t("linksDesc")}</p>
          </div>
          {/* One row per link: recognised mark, label, URL, remove. Pasting a
              known host fills the label for you, so the common case is a
              single paste. */}
          <div className="space-y-2">
            {links.map((link, index) => {
              const urlInvalid = touchedLinks.has(index) && !isPlausibleUrl(link.url);
              return (
                <div key={`link-${index}`} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <LinkGlyph url={link.url} />
                    <Input
                      aria-label={`${t("label")} ${index + 1}`}
                      value={link.label}
                      onChange={(e) => updateLink(index, "label", e.target.value)}
                      placeholder={t("linkLabelPlaceholder")}
                      className="w-[8.5rem] shrink-0"
                    />
                    <Input
                      aria-label={`${t("url")} ${index + 1}`}
                      value={link.url}
                      inputMode="url"
                      aria-invalid={urlInvalid ? true : undefined}
                      onChange={(e) => {
                        const nextUrl = e.target.value;
                        updateLink(index, "url", nextUrl);
                        // Fill an empty label from the recognised host. Never
                        // overwrite something the user typed themselves.
                        if (!link.label.trim()) {
                          const suggested = suggestLinkLabel(nextUrl);
                          if (suggested) updateLink(index, "label", suggested);
                        }
                      }}
                      onBlur={() =>
                        setTouchedLinks((prev) => new Set(prev).add(index))
                      }
                      placeholder={t("linkUrlPlaceholder")}
                      className={
                        "min-w-0 flex-1" + (urlInvalid ? " border-destructive/60" : "")
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`${t("remove")} ${link.label || index + 1}`}
                      disabled={links.length <= 1}
                      onClick={() => removeLink(index)}
                      className="shrink-0 text-muted-foreground hover:text-destructive disabled:opacity-30"
                    >
                      <X className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                  {urlInvalid ? (
                    <p className="pl-11 text-xs text-destructive">{t("urlHint")}</p>
                  ) : null}
                </div>
              );
            })}
          </div>
          <GhostAddRow label={t("addLink")} onClick={addLink} />
        </div>
      </div>
    </SectionShell>
  );
}
