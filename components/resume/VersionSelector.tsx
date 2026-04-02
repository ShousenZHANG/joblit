"use client";

import { Plus, Trash2, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useResumeContext } from "./ResumeContext";

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

  return (
    <div className="flex flex-wrap items-center gap-2 py-2">
      <Label htmlFor="resume-profile-select" className="sr-only">
        {t("resumeVersion")}
      </Label>
      <select
        id="resume-profile-select"
        value={selectedProfileId ?? ""}
        onChange={(e) => {
          const nextId = e.target.value || null;
          setSelectedProfileId(nextId);
          if (nextId) {
            void handleActivateProfile(nextId);
          }
        }}
        disabled={isBusy}
        className="min-h-9 min-w-[140px] flex-1 rounded-lg border border-slate-300 bg-white px-2.5 text-sm text-slate-900 shadow-sm transition hover:border-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 disabled:cursor-not-allowed disabled:bg-slate-100"
      >
        {profiles.length === 0 ? (
          <option value="">{t("unsavedVersion")}</option>
        ) : null}
        {profiles.map((profile) => (
          <option key={profile.id} value={profile.id}>
            {profile.name}
            {profile.id === activeProfileId ? ` (${t("active")})` : ""}
          </option>
        ))}
      </select>
      <Input
        id="resume-profile-name"
        value={profileName}
        onChange={(e) => setProfileName(e.target.value)}
        maxLength={80}
        placeholder={t("versionNamePlaceholder")}
        disabled={profileDeleting}
        className="hidden sm:block h-9 max-w-[200px] flex-1 text-sm"
      />
      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void handleCreateProfile("copy")}
          disabled={isBusy}
          className="h-9 gap-1 px-2.5 text-xs"
        >
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{profileCreating ? t("creating") : t("newVersion")}</span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={t("moreVersionActions")}
              disabled={isBusy}
              className="h-9 w-9"
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
