"use client";

import { useState, useEffect, useCallback } from "react";

interface ExtensionToken {
  id: string;
  name: string;
  lastUsedAt: string | null;
  expiresAt: string;
  createdAt: string;
}

interface NewTokenResult {
  id: string;
  rawToken: string;
  expiresAt: string;
}

export function ExtensionTokenManager() {
  const [tokens, setTokens] = useState<ExtensionToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [newToken, setNewToken] = useState<NewTokenResult | null>(null);
  const [creating, setCreating] = useState(false);
  const [tokenName, setTokenName] = useState("");
  const [copied, setCopied] = useState(false);

  const fetchTokens = useCallback(async () => {
    try {
      const res = await fetch("/api/ext/auth/token");
      const json = await res.json();
      if (json.data) setTokens(json.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTokens();
  }, [fetchTokens]);

  const handleCreate = useCallback(async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/ext/auth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: tokenName.trim() || undefined,
          expiryDays: 90,
        }),
      });
      const json = await res.json();
      if (json.data) {
        setNewToken(json.data);
        setTokenName("");
        fetchTokens();
      }
    } finally {
      setCreating(false);
    }
  }, [tokenName, fetchTokens]);

  const handleRevoke = useCallback(
    async (tokenId: string) => {
      await fetch("/api/ext/auth/token", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokenId }),
      });
      fetchTokens();
    },
    [fetchTokens],
  );

  const handleCopy = useCallback(async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  if (loading) {
    return <div className="text-sm text-muted-foreground py-8 text-center">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Generate Token */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-800 mb-3">
          Generate New Token
        </h2>
        <div className="flex gap-2">
          <input
            type="text"
            value={tokenName}
            onChange={(e) => setTokenName(e.target.value)}
            placeholder="Token name (e.g. 'My Laptop Chrome')"
            className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
          <button
            onClick={handleCreate}
            disabled={creating}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {creating ? "Generating..." : "Generate"}
          </button>
        </div>

        {newToken && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs font-semibold text-amber-800 mb-1">
              Copy this token now — it will not be shown again.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded bg-white px-2 py-1 text-xs font-mono border border-amber-200">
                {newToken.rawToken}
              </code>
              <button
                onClick={() => handleCopy(newToken.rawToken)}
                className="shrink-0 rounded bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <p className="text-xs text-amber-700 mt-1">
              Expires: {new Date(newToken.expiresAt).toLocaleDateString()}
            </p>
          </div>
        )}
      </div>

      {/* Token List */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-800 mb-3">
          Active Tokens ({tokens.length})
        </h2>

        {tokens.length === 0 ? (
          <p className="text-sm text-slate-500 py-4 text-center">
            No active tokens. Generate one to connect the extension.
          </p>
        ) : (
          <div className="space-y-2">
            {tokens.map((token) => (
              <div
                key={token.id}
                className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"
              >
                <div>
                  <div className="text-sm font-medium text-slate-700">
                    {token.name || "Unnamed token"}
                  </div>
                  <div className="text-xs text-slate-500">
                    Created {new Date(token.createdAt).toLocaleDateString()}
                    {token.lastUsedAt
                      ? ` · Last used ${new Date(token.lastUsedAt).toLocaleDateString()}`
                      : " · Never used"}
                    {" · Expires "}
                    {new Date(token.expiresAt).toLocaleDateString()}
                  </div>
                </div>
                <button
                  onClick={() => handleRevoke(token.id)}
                  className="rounded bg-red-50 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-100 border border-red-200"
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Setup Instructions */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-800 mb-2">
          Setup Instructions
        </h2>
        <ol className="text-sm text-slate-600 space-y-1 list-decimal list-inside">
          <li>Install the Jobflow AutoFill extension from the Chrome Web Store.</li>
          <li>Click the extension icon in your toolbar.</li>
          <li>Paste the generated token and click Connect.</li>
          <li>Visit any ATS job application page — the extension will auto-detect form fields.</li>
        </ol>
      </div>
    </div>
  );
}
