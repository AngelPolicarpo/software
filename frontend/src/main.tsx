import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Inter é a família da spec (§5.5); a variável é auto-hospedada, sem CDN.
import "@fontsource-variable/inter";
import "./index.css";
import { LiveApp } from "./live/LiveApp";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LiveApp />
  </StrictMode>,
);
