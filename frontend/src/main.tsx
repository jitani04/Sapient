import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { RouterProvider } from "react-router-dom";

import { router } from "./router";
import "./styles.css";
import { applyTheme, getStoredTheme } from "./theme";
import { applyReadingPrefs } from "./readingPrefs";
import { ReadingPrefsProvider } from "./ReadingPrefsContext";

const queryClient = new QueryClient();
const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
applyTheme(getStoredTheme());
applyReadingPrefs();

const app = (
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ReadingPrefsProvider>
        <RouterProvider router={router} />
      </ReadingPrefsProvider>
    </QueryClientProvider>
  </React.StrictMode>
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  googleClientId ? <GoogleOAuthProvider clientId={googleClientId}>{app}</GoogleOAuthProvider> : app,
);
