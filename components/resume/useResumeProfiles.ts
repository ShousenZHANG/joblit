"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ResumeProfilePayload, ResumeProfileSummary } from "./types";

interface UseResumeProfilesParams {
  locale: string;
  applyProfileToDraft: (profile: ResumeProfilePayload | null) => void;
  resetDraft: () => void;
  toast: (opts: { title: string; description?: string; variant?: "default" | "destructive" }) => void;
  t: (key: string, values?: Record<string, string | number>) => string;
  setPdfUrl: (updater: (prev: string | null) => string | null) => void;
  setPreviewStatus: (status: "idle" | "loading" | "ready" | "error") => void;
  setPreviewError: (error: string | null) => void;
}

export function useResumeProfiles({
  locale,
  applyProfileToDraft,
  resetDraft: _resetDraft,
  toast,
  t,
  setPdfUrl,
  setPreviewStatus,
  setPreviewError,
}: UseResumeProfilesParams) {
  const [profiles, setProfiles] = useState<ResumeProfileSummary[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState("Custom Blank");
  const [profileSwitching, setProfileSwitching] = useState(false);
  const [profileCreating, setProfileCreating] = useState(false);
  const [profileDeleting, setProfileDeleting] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const hydrateFromResumeApi = useCallback(
    (json: unknown) => {
      const record = (json ?? {}) as Record<string, unknown>;
      const nextProfiles = Array.isArray(record.profiles)
        ? (record.profiles as ResumeProfileSummary[])
        : [];
      const explicitActiveId =
        typeof record.activeProfileId === "string" ? record.activeProfileId : null;
      const inferredActiveId =
        nextProfiles.find((profile) => profile.isActive)?.id ??
        (nextProfiles.length > 0 ? nextProfiles[0].id : null);
      const nextActiveProfileId = explicitActiveId ?? inferredActiveId;

      setProfiles(nextProfiles);
      setActiveProfileId(nextActiveProfileId);
      setSelectedProfileId(nextActiveProfileId);

      const activeSummary =
        nextProfiles.find((profile) => profile.id === nextActiveProfileId) ?? null;
      setProfileName(activeSummary?.name ?? "Custom Blank");

      const activeProfile =
        (record.activeProfile as ResumeProfilePayload | null | undefined) ??
        (record.profile as ResumeProfilePayload | null | undefined) ??
        null;
      applyProfileToDraft(activeProfile);
    },
    [applyProfileToDraft],
  );

  // Initial load — mirrors ExtensionTokenManager.fetchTokens: a failed fetch
  // must surface as an explicit error + retry, not a silent blank form that
  // reads as "no saved resume". `loadError` drives that UI; `retryLoad` lets
  // the surface re-attempt. The per-load AbortSignal prevents a stale locale's
  // response from winning, while `aliveRef` also protects event-triggered
  // retries that resolve after unmount.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const loadProfiles = useCallback(async (signal?: AbortSignal) => {
    setLoadError(false);
    try {
      const res = await fetch(`/api/resume-profile?locale=${locale}`, { signal });
      if (!res.ok) throw new Error(`status=${res.status}`);
      const json = await res.json();
      if (signal?.aborted || !aliveRef.current) return;
      hydrateFromResumeApi(json);
    } catch {
      if (signal?.aborted || !aliveRef.current) return;
      setLoadError(true);
      toast({
        title: t("toastCouldNotLoad"),
        description: t("toastTryAgain"),
        variant: "destructive",
      });
    }
  }, [locale, hydrateFromResumeApi, toast, t]);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) void loadProfiles(controller.signal);
    });
    return () => controller.abort();
  }, [loadProfiles]);

  const resetPreviewState = useCallback(() => {
    setPdfUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setPreviewStatus("idle");
    setPreviewError(null);
  }, [setPdfUrl, setPreviewStatus, setPreviewError]);

  const handleCreateProfile = useCallback(
    async (mode: "copy" | "blank" = "copy") => {
      if (profileCreating || profileSwitching || profileDeleting) return;
      setProfileCreating(true);
      try {
        const res = await fetch("/api/resume-profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "create",
            mode,
            sourceProfileId: activeProfileId ?? selectedProfileId ?? undefined,
            locale,
          }),
        });
        if (!res.ok) {
          const code = (await res.json().catch(() => null))?.error;
          if (code === "MIGRATION_REQUIRED") {
            throw new Error("MIGRATION_REQUIRED");
          }
          throw new Error("Create profile failed");
        }
        const json = await res.json();
        hydrateFromResumeApi(json);
        toast({
          title: t("toastNewVersionCreated"),
          description:
            mode === "copy" ? t("toastNewVersionCopyDesc") : t("toastNewVersionBlankDesc"),
        });
        resetPreviewState();
      } catch {
        toast({
          title: t("toastCouldNotCreateVersion"),
          description: t("toastCouldNotCreateVersionDesc"),
          variant: "destructive",
        });
      } finally {
        setProfileCreating(false);
      }
    },
    [
      profileCreating,
      profileSwitching,
      profileDeleting,
      activeProfileId,
      selectedProfileId,
      locale,
      hydrateFromResumeApi,
      toast,
      t,
      resetPreviewState,
    ],
  );

  const handleDeleteProfile = useCallback(async () => {
    if (!selectedProfileId || profileDeleting || profileCreating || profileSwitching) return;
    if (profiles.length <= 1) {
      toast({
        title: t("toastCannotDeleteOnly"),
        description: t("toastCannotDeleteOnlyDesc"),
        variant: "destructive",
      });
      return;
    }

    setProfileDeleting(true);
    try {
      const res = await fetch("/api/resume-profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", profileId: selectedProfileId, locale }),
      });
      if (!res.ok) {
        const code = (await res.json().catch(() => null))?.error;
        if (code === "LAST_PROFILE") {
          throw new Error("LAST_PROFILE");
        }
        throw new Error("Delete profile failed");
      }
      const json = await res.json();
      hydrateFromResumeApi(json);
      resetPreviewState();
      toast({
        title: t("toastVersionDeleted"),
        description: t("toastVersionDeletedDesc"),
      });
    } catch (error) {
      toast({
        title:
          error instanceof Error && error.message === "LAST_PROFILE"
            ? t("toastCannotDeleteOnly")
            : t("toastCouldNotDeleteVersion"),
        description:
          error instanceof Error && error.message === "LAST_PROFILE"
            ? t("toastCannotDeleteOnlyDesc")
            : t("toastTryAgain"),
        variant: "destructive",
      });
    } finally {
      setProfileDeleting(false);
    }
  }, [
    selectedProfileId,
    profileDeleting,
    profileCreating,
    profileSwitching,
    profiles,
    locale,
    hydrateFromResumeApi,
    toast,
    t,
    resetPreviewState,
  ]);

  const handleActivateProfile = useCallback(
    async (profileId: string) => {
      if (
        !profileId ||
        profileId === activeProfileId ||
        profileSwitching ||
        profileCreating ||
        profileDeleting
      ) {
        return;
      }
      setProfileSwitching(true);
      try {
        const res = await fetch("/api/resume-profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "activate", profileId, locale }),
        });
        if (!res.ok) {
          throw new Error("Activate profile failed");
        }
        const json = await res.json();
        hydrateFromResumeApi(json);
        resetPreviewState();
        toast({
          title: t("toastSwitchedVersion"),
          description: t("toastSwitchedVersionDesc"),
        });
      } catch {
        toast({
          title: t("toastCouldNotSwitchVersion"),
          description: t("toastTryAgain"),
          variant: "destructive",
        });
        setSelectedProfileId(activeProfileId);
      } finally {
        setProfileSwitching(false);
      }
    },
    [
      activeProfileId,
      profileSwitching,
      profileCreating,
      profileDeleting,
      locale,
      hydrateFromResumeApi,
      toast,
      t,
      resetPreviewState,
    ],
  );

  return {
    profiles,
    activeProfileId,
    selectedProfileId,
    setSelectedProfileId,
    profileName,
    setProfileName,
    profileSwitching,
    profileCreating,
    profileDeleting,
    loadError,
    retryLoad: loadProfiles,
    hydrateFromResumeApi,
    handleCreateProfile,
    handleDeleteProfile,
    handleActivateProfile,
  };
}

export type UseResumeProfilesReturn = ReturnType<typeof useResumeProfiles>;
