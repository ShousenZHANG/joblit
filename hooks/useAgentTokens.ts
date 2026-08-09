"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

async function issueCredential(name?: string): Promise<NewTokenResult> {
  const res = await fetch(TOKENS_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: name?.trim() || undefined,
      expiryDays: 90,
    }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json?.error?.message ?? "Failed");
  }
  const json = await res.json();
  if (!json.data?.rawToken) throw new Error("Missing credential value");
  return json.data as NewTokenResult;
}

async function deleteCredential(tokenId: string): Promise<void> {
  const res = await fetch(TOKENS_ENDPOINT, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tokenId }),
  });
  if (!res.ok) throw new Error(`status=${res.status}`);
}

/**
 * Owns the one-time raw credential and keeps replacement availability-safe.
 * A replacement is minted first; old credentials are revoked only after the
 * new raw value is safely in memory. A failed mint therefore never disconnects
 * a working Runner.
 */
export function useAgentTokens() {
  const [tokens, setTokens] = useState<AgentToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [newToken, setNewToken] = useState<NewTokenResult | null>(null);
  const [creating, setCreating] = useState(false);
  const operationInFlight = useRef(false);
  const { toast } = useToast();
  const t = useTranslations("agent.tokens");

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoadError(false);
    try {
      const res = await fetch(TOKENS_ENDPOINT, { signal });
      if (!res.ok) throw new Error(`status=${res.status}`);
      const json = await res.json();
      if (!signal?.aborted && Array.isArray(json.data)) setTokens(json.data);
    } catch {
      if (!signal?.aborted) setLoadError(true);
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

  const rememberIssued = useCallback((issued: NewTokenResult, name: string) => {
    setNewToken(issued);
    setLoadError(false);
    setTokens((current) => [
      {
        id: issued.id,
        name,
        lastUsedAt: null,
        expiresAt: issued.expiresAt,
        createdAt: new Date().toISOString(),
      },
      ...current.filter((token) => token.id !== issued.id),
    ]);
  }, []);

  const create = useCallback(
    async (name = "Joblit Runner"): Promise<NewTokenResult | null> => {
      if (operationInFlight.current) return null;
      operationInFlight.current = true;
      setCreating(true);
      try {
        const issued = await issueCredential(name);
        rememberIssued(issued, name);
        toast({
          title: t("toast.createdTitle"),
          description: t("toast.createdDescription"),
        });
        return issued;
      } catch {
        toast({
          title: t("toast.createFailedTitle"),
          description: t("toast.tryAgain"),
          variant: "destructive",
        });
        return null;
      } finally {
        operationInFlight.current = false;
        setCreating(false);
      }
    },
    [rememberIssued, t, toast],
  );

  const replace = useCallback(
    async (
      previous: AgentToken[],
      name = "Joblit Runner",
    ): Promise<NewTokenResult | null> => {
      if (operationInFlight.current) return null;
      operationInFlight.current = true;
      setCreating(true);
      try {
        const issued = await issueCredential(name);
        // Expose the usable replacement before touching the old credentials.
        rememberIssued(issued, name);

        const revokedIds: string[] = [];
        let revokeFailed = false;
        for (const token of previous) {
          try {
            await deleteCredential(token.id);
            revokedIds.push(token.id);
          } catch {
            revokeFailed = true;
          }
        }
        if (revokedIds.length > 0) {
          setTokens((current) =>
            current.filter((token) => !revokedIds.includes(token.id)),
          );
        }
        toast({
          title: revokeFailed
            ? t("toast.replacePartialTitle")
            : t("toast.replacedTitle"),
          description: revokeFailed
            ? t("toast.replacePartialDescription")
            : t("toast.createdDescription"),
          ...(revokeFailed ? { variant: "destructive" as const } : {}),
        });
        return issued;
      } catch {
        toast({
          title: t("toast.createFailedTitle"),
          description: t("toast.oldCredentialKept"),
          variant: "destructive",
        });
        return null;
      } finally {
        operationInFlight.current = false;
        setCreating(false);
      }
    },
    [rememberIssued, t, toast],
  );

  const revoke = useCallback(
    async (token: AgentToken): Promise<boolean> => {
      if (operationInFlight.current) return false;
      operationInFlight.current = true;
      try {
        await deleteCredential(token.id);
        setTokens((current) => current.filter((item) => item.id !== token.id));
        if (newToken?.id === token.id) setNewToken(null);
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
      } finally {
        operationInFlight.current = false;
      }
    },
    [newToken, t, toast],
  );

  return {
    tokens,
    loading,
    loadError,
    newToken,
    creating,
    refresh,
    create,
    replace,
    revoke,
  };
}
