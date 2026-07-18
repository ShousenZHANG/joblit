import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./ErrorBoundary";

// The popup body is width-anchored in CSS (Chrome can lock a too-small popup
// before React mounts); the full settings tab must escape that anchor.
if (new URLSearchParams(window.location.search).get("view") === "settings") {
  document.body.classList.add("jl-body-page");
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>,
  );
}
