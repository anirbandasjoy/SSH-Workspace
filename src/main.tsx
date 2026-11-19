import { createRoot } from "react-dom/client";
import { ThemeProvider, BaseStyles } from "@primer/react";
import "@primer/primitives/dist/css/functional/themes/light.css";
import "@primer/primitives/dist/css/functional/themes/dark.css";
import "@primer/primitives/dist/css/functional/typography/typography.css";
import { useEffect, useState } from "react";
import App from "./App";
import "./style.css";

type Mode = "system" | "light" | "dark";
function Root() {
  const [mode, setMode] = useState<Mode>(() => {
    const value = localStorage.getItem("workspace-theme");
    return value === "dark" || value === "light" ? value : "system";
  });
  useEffect(() => {
    document.documentElement.dataset.appearance = mode;
    localStorage.setItem("workspace-theme", mode);
  }, [mode]);
  return (
    <ThemeProvider
      colorMode={mode === "system" ? "auto" : mode === "dark" ? "night" : "day"}
      dayScheme="light"
      nightScheme="dark"
    >
      <BaseStyles>
        <App mode={mode} onMode={setMode} />
      </BaseStyles>
    </ThemeProvider>
  );
}
createRoot(document.getElementById("root")!).render(<Root />);
