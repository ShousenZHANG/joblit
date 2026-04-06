"use client";

import { Download, ArrowRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type GenerateSuccessProps = {
  target: "resume" | "cover";
  pdfUrl: string;
  pdfFilename: string;
  onGenerateOther: () => void;
  onClose: () => void;
};

export function GenerateSuccess({
  target,
  pdfUrl,
  pdfFilename,
  onGenerateOther,
  onClose,
}: GenerateSuccessProps) {
  const otherTarget = target === "resume" ? "Cover Letter" : "Resume";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* Title with confetti effect */}
      <div className="relative overflow-hidden text-center">
        <ConfettiDots />
        <h3 className="text-lg font-semibold text-slate-900">
          {target === "resume" ? "Resume PDF generated!" : "Cover Letter generated!"}
        </h3>
      </div>

      {/* Inline PDF preview */}
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <iframe
          title={target === "resume" ? "Resume preview" : "Cover letter preview"}
          src={pdfUrl}
          sandbox="allow-scripts allow-same-origin"
          className="h-full w-full"
        />
      </div>

      {/* Action buttons */}
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button
          asChild
          size="sm"
          className="h-10 rounded-xl border border-emerald-500 bg-emerald-500 px-5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:border-emerald-600 hover:bg-emerald-600 active:translate-y-[1px]"
        >
          <a href={pdfUrl} download={pdfFilename}>
            <Download className="mr-1.5 h-4 w-4" />
            Download PDF
          </a>
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onGenerateOther}
          className="h-10 rounded-xl border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 active:translate-y-[1px]"
        >
          Generate {otherTarget}
          <ArrowRight className="ml-1.5 h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="h-10 rounded-xl px-3 text-sm text-slate-500 hover:bg-slate-50 hover:text-slate-700"
        >
          Done
        </Button>
      </div>
    </div>
  );
}

/** CSS-only confetti dots that pop up from the title and fade out */
function ConfettiDots() {
  const dots = [
    { color: "bg-emerald-400", x: -30, delay: "0ms" },
    { color: "bg-sky-400", x: 20, delay: "100ms" },
    { color: "bg-amber-400", x: -15, delay: "200ms" },
    { color: "bg-rose-400", x: 35, delay: "50ms" },
    { color: "bg-violet-400", x: -40, delay: "150ms" },
    { color: "bg-emerald-300", x: 10, delay: "250ms" },
  ];

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center">
      {dots.map((dot, i) => (
        <span
          key={i}
          className={`absolute h-1.5 w-1.5 rounded-full ${dot.color} animate-confetti-pop`}
          style={{
            "--confetti-x": `${dot.x}px`,
            animationDelay: dot.delay,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}
