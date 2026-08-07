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
 * The one source of truth for agent credentials on the Agent page.
 *
 * Both the onboarding stepper (quick-create, raw-token injection into the
 * setup snippet) and the token manager (list, named create, revoke) consume
 * this hook, so a credential minted in one place is instantly visible in the
 * other. The raw token exists only in this hook's memory, exactly once, the
 * same as the server contract: it is never persisted anywhere client-side.
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

export type AgentTokensApi = ReturnType<typeof useAgentTokens>;
