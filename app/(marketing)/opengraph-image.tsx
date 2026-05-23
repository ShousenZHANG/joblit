import { ImageResponse } from "next/og";

export const alt = "Joblit — AI-tailored resumes for every job you apply to";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          background: "linear-gradient(135deg, #fffefb 0%, #fef7ee 40%, #faf0e1 100%)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {/* Top accent bar */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 6,
            background: "linear-gradient(90deg, #22c55e, #14b8a6, #0ea5e9)",
          }}
        />

        {/* Logo */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 32,
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: "linear-gradient(135deg, #059669 0%, #047857 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="36" height="36" viewBox="0 0 64 64" fill="none">
              <path
                d="M 44 12 L 44 38 a 12 12 0 0 1 -12 12 a 12 12 0 0 1 -12 -12 L 20 36 a 8 8 0 0 0 8 8 a 8 8 0 0 0 8 -8 L 36 22 Z"
                fill="#FFFFFF"
              />
            </svg>
          </div>
          <span style={{ fontSize: 36, fontWeight: 700, color: "#0f172a" }}>
            Joblit
          </span>
        </div>

        {/* Title */}
        <div
          style={{
            fontSize: 52,
            fontWeight: 800,
            color: "#0f172a",
            textAlign: "center",
            lineHeight: 1.2,
            maxWidth: 900,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <span>
            <span style={{ color: "#059669" }}>AI-tailored</span> resumes
          </span>
          <span>for every job you apply to</span>
        </div>

        {/* Subtitle */}
        <div
          style={{
            fontSize: 22,
            color: "#64748b",
            textAlign: "center",
            marginTop: 20,
            maxWidth: 700,
          }}
        >
          Fetch roles, generate custom CVs and cover letters, export PDF.
        </div>

        {/* Badge */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 32,
            padding: "8px 20px",
            borderRadius: 999,
            border: "1.5px solid #d1fae5",
            background: "#ecfdf5",
            fontSize: 16,
            fontWeight: 600,
            color: "#065f46",
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              background: "#22c55e",
            }}
          />
          Powered by 95-score AI Skill Pack
        </div>
      </div>
    ),
    { ...size },
  );
}
