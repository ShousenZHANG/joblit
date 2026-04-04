import { useState, useEffect } from "react";
import { t } from "@ext/shared/i18n";

interface SubmissionRecord {
  id: string;
  pageDomain: string;
  pageUrl: string;
  atsProvider: string;
  formSignature: string;
  fieldCount: number;
  filledCount: number;
  createdAt: string;
}

export function History() {
  const [submissions, setSubmissions] = useState<SubmissionRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    chrome.runtime.sendMessage(
      { type: "GET_SUBMISSIONS", params: { limit: 50 } },
      (response) => {
        setLoading(false);
        if (response?.success && Array.isArray(response.data)) {
          setSubmissions(response.data);
        }
      },
    );
  }, []);

  if (loading) {
    return <div style={{ textAlign: "center", padding: 24, color: "#888" }}>{t("app.loading")}</div>;
  }

  if (submissions.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: 32, color: "#888" }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>{t("history.empty")}</div>
        <div style={{ fontSize: 13 }}>
          {t("history.emptyDesc")}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: 13, color: "#666", marginBottom: 8 }}>
        {submissions.length} {t("history.title").toLowerCase()}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {submissions.map((sub) => (
          <SubmissionCard key={sub.id} submission={sub} />
        ))}
      </div>
    </div>
  );
}

function SubmissionCard({ submission }: { submission: SubmissionRecord }) {
  const date = new Date(submission.createdAt);
  const timeAgo = getRelativeTime(date);

  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        padding: 10,
        background: "#fafafa",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontWeight: 600, fontSize: 13, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {submission.pageDomain}
        </div>
        <span
          style={{
            fontSize: 11,
            padding: "2px 6px",
            background: "#e0f2fe",
            color: "#0369a1",
            borderRadius: 4,
          }}
        >
          {submission.atsProvider}
        </span>
      </div>
      <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>
        {t("history.fieldsFilled", {
          filled: submission.filledCount,
          total: submission.fieldCount,
        })} &middot; {timeAgo}
      </div>
    </div>
  );
}

function getRelativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}
