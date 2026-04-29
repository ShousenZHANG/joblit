"use client";

import { Plus, Trash2, ChevronDown, Check as CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useResumeContext } from "./ResumeContext";
import { cn } from "@/lib/utils";

const SELECT_PLACEHOLDER_VALUE = "__none__";

/**
 * VersionSelector — picks the active master-resume profile and exposes
 * version-management actions (rename, new from active, blank, delete).
 *
 * Uses Radix Select (via shadcn) instead of a native <select> to deliver
 * the design-system "premium dropdown" feel: animated popover, custom
 * row chrome (emerald active dot + name + Active pill), Check icon on
 * the current selection, and full keyboard / screen-reader support
 * provided by Radix.
 */
export function VersionSelector() {
  const {
    profiles,
    activeProfileId,
    selectedProfileId,
    setSelectedProfileId,
    profileName,
    setProfileName,
    profileSwitching,
    profileCreating,
    profileDeleting,
    handleCreateProfile,
    handleDeleteProfile,
    handleActivateProfile,
    t,
  } = useResumeContext();

  const isBusy = profileSwitching || profileCreating || profileDeleting;
  const selectValue = selectedProfileId ?? SELECT_PLACEHOLDER_VALUE;

  return (
    <div className="flex flex-wrap items-center gap-2 pb-3">
      <Label htmlFor="resume-profile-select" className="sr-only">
        {t("resumeVersion")}
      </Label>

      <Select
        value={selectValue}
        onValueChange={(next) => {
          if (next === SELECT_PLACEHOLDER_VALUE) {
            setSelectedProfileId(null);
            return;
          }
          setSelectedProfileId(next);
          void handleActivateProfile(next);
        }}
        disabled={isBusy}
      >
        <SelectTrigger
          id="resume-profile-select"
          aria-label={t("resumeVersion")}
          className={cn(
            "h-9 min-w-[200px] flex-1 rounded-[10px] bg-card pr-3 pl-3",
            "shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
            "data-[state=open]:border-emerald-500 data-[state=open]:ring-2 data-[state=open]:ring-emerald-500/15",
          )}
        >
          {profiles.length === 0 ? (
            <span className="text-muted-foreground">{t("unsavedVersion")}</span>
          ) : (
            <SelectValue placeholder={t("unsavedVersion")} />
          )}
        </SelectTrigger>
        <SelectContent
          align="start"
          sideOffset={6}
          className="min-w-[240px] rounded-xl border-border/70 bg-popover/98 p-1 shadow-[0_24px_60px_-30px_rgba(15,23,42,0.45)] backdrop-blur"
        >
          {profiles.length === 0 ? (
            <SelectItem
              value={SELECT_PLACEHOLDER_VALUE}
              className="rounded-lg px-3 py-2 text-sm text-muted-foreground"
            >
              {t("unsavedVersion")}
            </SelectItem>
          ) : null}
          {profiles.map((profile) => {
            const isActive = profile.id === activeProfileId;
            const isSelected = profile.id === selectedProfileId;
            return (
              <SelectItem
                key={profile.id}
                value={profile.id}
                className={cn(
                  "group relative cursor-pointer rounded-lg pl-9 pr-3 py-2 text-sm",
                  "data-[highlighted]:bg-emerald-500/8 data-[highlighted]:text-foreground",
                  "data-[state=checked]:font-semibold",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "absolute left-3 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full ring-[3px] transition-shadow",
                    isActive
                      ? "bg-emerald-500 ring-emerald-500/20"
                      : "bg-muted-foreground/35 ring-muted-foreground/15",
                  )}
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-foreground">{profile.name}</span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {isActive ? (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:bg-emerald-500/12 dark:text-emerald-300">
                        {t("active")}
                      </span>
                    ) : null}
                    {isSelected ? (
                      <CheckIcon className="h-4 w-4 text-emerald-600 dark:text-emerald-300" aria-hidden />
                    ) : null}
                  </span>
                </div>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>

      <Input
        id="resume-profile-name"
        value={profileName}
        onChange={(e) => setProfileName(e.target.value)}
        maxLength={80}
        placeholder={t("versionNamePlaceholder")}
        disabled={profileDeleting}
        className="hidden h-9 max-w-[200px] flex-1 rounded-[10px] text-sm sm:block"
      />

      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void handleCreateProfile("copy")}
          disabled={isBusy}
          className="h-9 gap-1 rounded-[10px] px-2.5 text-xs"
        >
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">
            {profileCreating ? t("creating") : t("newVersion")}
          </span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={t("moreVersionActions")}
              disabled={isBusy}
              className="h-9 w-9 rounded-[10px]"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => void handleCreateProfile("copy")}>
              {t("newVersionFromActive")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void handleCreateProfile("blank")}>
              {t("newBlankVersion")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-rose-600 focus:text-rose-700"
              onSelect={() => void handleDeleteProfile()}
              disabled={profiles.length <= 1 || !selectedProfileId}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {t("deleteSelectedVersion")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
