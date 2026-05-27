import { createRoot } from "react-dom/client";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import App from "./App";
import { getToken } from "./lib/api";
import "./index.css";

// Wire the generated React Query client so it uses the same admin bearer
// token as the legacy api() helper. Generated request URLs already start
// with /api, so no setBaseUrl call is needed.
setAuthTokenGetter(() => getToken());

createRoot(document.getElementById("root")!).render(<App />);
