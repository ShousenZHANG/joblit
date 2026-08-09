"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { useToast } from "@/hooks/use-toast";

export interface AgentToken {
  id: string;
  name: string;
  lastUsedAt: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface NewTokenResult {
  id: string;
  rawToken: string;
  expiresAt: string;
}

const TOKENS_ENDPOINT = "/api/agent-tokens";

/**
 * Agent credentials, as the nav setup panel needs them.
 *
 * The raw token exists only in this hook's memory, exactly once, mirroring the
 * server contract: Joblit stores a SHA-256 hash and cannot show the value
 * again. Nothing here persists it client-side either.
 */
export function useAgentTokens() {
  const [tokens, setTokens] = useState<AgentToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [newToken, setNewToken] = useState<NewTokenResult | null>(null);
  const [creating, setCreating] = useState(false);
  const { toast } = useToast();
  const t = useTranslations("agent.tokens");

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoadError(false);
    try {
      const res = await fetch(TOKENS_ENDPOINT, { signal });
      if (!res.ok) throw new Error(`status=${res.status}`);
      const json = await res.json();
      if (signal?.aborted) return;
      if (json.data) setTokens(json.data);
    } catch {
      if (signal?.aborted) return;
      // An honest error + retry beats rendering the failure as "No active
      // tokens", which reads as a fact about the account.
      setLoadError(true);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) void refresh(controller.signal);
    });
    return () => controller.abort();
  }, [refresh]);

  const create = useCallback(
    async (name?: string): Promise<NewTokenResult | null> => {
      if (creating) return null;
      setCreating(true);
      try {
        const res = await fetch(TOKENS_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name?.trim() || undefined,
            expiryDays: 90,
          }),
        });
        if (!res.ok) {
          // A 4xx/5xx body is an {error} envelope with no `.data`, so
          // guarding on `json.data` alone would swallow the failure silently.
          const j = await res.json().catch(() => ({}));
          throw new Error(j?.error?.message ?? j?.error ?? "Failed");
        }
        const json = await res.json();
        if (!json.data) return null;
        setNewToken(json.data);
        await refresh();
        toast({
          title: t("toast.createdTitle"),
          description: t("toast.createdDescription"),
        });
        return json.data as NewTokenResult;
      } catch {
        toast({
          title: t("toast.createFailedTitle"),
          description: t("toast.tryAgain"),
          variant: "destructive",
        });
        return null;
      } finally {
        setCreating(false);
      }
    },
    [creating, refresh, toast, t],
  );

  const revoke = useCallback(
    async (token: AgentToken): Promise<boolean> => {
      try {
        const res = await fetch(TOKENS_ENDPOINT, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tokenId: token.id }),
        });
        // Revoke is a security action — a failed DELETE must not report
        // success.
        if (!res.ok) throw new Error(`status=${res.status}`);
        if (newToken?.id === token.id) setNewToken(null);
        await refresh();
        toast({
          title: t("toast.revokedTitle"),
          description: t("toast.revokedDescription", {
            name: token.name || t("unnamed"),
          }),
        });
        return true;
      } catch {
        toast({
          title: t("toast.revokeFailedTitle"),
          description: t("toast.tryAgain"),
          variant: "destructive",
        });
        return false;
      }
    },
    [newToken, refresh, toast, t],
  );

  return { tokens, loading, loadError, newToken, creating, refresh, create, revoke };
}
