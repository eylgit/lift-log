import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { watchForInstallPrompt } from "./install";
import "./styles.css";

// Before anything renders: `beforeinstallprompt` fires early and only once, and
// there is no way to ask for it again (F2.3, and the header of `install.ts`).
watchForInstallPrompt();

const el = document.getElementById("root");
if (!el) throw new Error("#root is missing from index.html");

createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>
);
