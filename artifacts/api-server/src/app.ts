import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { handleRobotsTxt, handleSitemapXml } from "./routes/site";
import { logger } from "./lib/logger";

const app: Express = express();

// Trust the Replit/proxy chain so req.ip resolves to the real client IP
// without trusting arbitrary x-forwarded-for headers from clients.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
// Stripe webhook needs the raw request body for signature verification; this
// must be mounted BEFORE express.json() or the body will already be consumed.
app.use(
  "/api/payments/webhook",
  express.raw({ type: "application/json" }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Public SEO routes mounted at the site root so crawlers find them at the
// canonical /robots.txt and /sitemap.xml locations.
app.get("/robots.txt", handleRobotsTxt);
app.get("/sitemap.xml", handleSitemapXml);

export default app;
