import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import { ConfirmProvider, DrawerStackProvider, ThemeProvider, ToastProvider } from "./ui";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <ToastProvider>
        <ConfirmProvider>
          <DrawerStackProvider>
            <App />
          </DrawerStackProvider>
        </ConfirmProvider>
      </ToastProvider>
    </ThemeProvider>
  </React.StrictMode>
);
