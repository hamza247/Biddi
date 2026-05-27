import { createRoot, hydrateRoot } from "react-dom/client";
import App from "./App";
import { Routes } from "./routes";
import "./index.css";

const container = document.getElementById("root")!;
const initial = window.__BIDDI_INITIAL_DATA__;

if (initial && container.hasChildNodes()) {
  // SSR-rendered output is present: hydrate to attach handlers without
  // re-rendering. SiteProvider is seeded with the same lang/settings used
  // on the server so the markup matches exactly.
  hydrateRoot(
    container,
    <App
      initialLang={initial.lang}
      initialSettings={initial.settings}
      initialPage={initial.page}
      initialSlug={initial.slug}
    >
      <Routes />
    </App>,
  );
} else {
  // Fallback: pure client render (dev mode or empty SSR shell).
  createRoot(container).render(
    <App>
      <Routes />
    </App>,
  );
}
