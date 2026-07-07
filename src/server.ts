import express from "express";
import { z } from "zod";
import { db } from "./lib/db.js";
import { importPulls } from "./services/ingest.js";
import { ImportFormatError, importJsonPulls } from "./services/jsonImport.js";
import { getCommunityStats, getUserStats } from "./services/stats.js";

const app = express();
// Pull-history exports can run large; default 100kb would reject them.
app.use(express.json({ limit: "5mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

const importSchema = z.object({ token: z.string().min(1) });

app.post("/api/import", async (req, res, next) => {
  try {
    const parsed = importSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "token is required" });
      return;
    }
    res.json(await importPulls(parsed.data.token));
  } catch (err) {
    next(err);
  }
});

const jsonImportSchema = z.object({
  account: z.string().min(1),
  payload: z.unknown(),
});

app.post("/api/import/json", async (req, res, next) => {
  try {
    const parsed = jsonImportSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "account and payload are required" });
      return;
    }
    res.json(await importJsonPulls(parsed.data.account, parsed.data.payload));
  } catch (err) {
    if (err instanceof ImportFormatError) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

app.get("/api/users/:id/stats", async (req, res, next) => {
  try {
    const stats = await getUserStats(req.params.id);
    if (!stats) {
      res.status(404).json({ error: "user not found" });
      return;
    }
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

app.get("/api/community/stats", async (_req, res, next) => {
  try {
    res.json(await getCommunityStats());
  } catch (err) {
    next(err);
  }
});

app.get("/api/banners", async (_req, res, next) => {
  try {
    res.json(await db.banner.findMany({ orderBy: { startAt: "asc" } }));
  } catch (err) {
    next(err);
  }
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "internal error" });
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`arkpulls API listening on http://localhost:${port}`);
});
