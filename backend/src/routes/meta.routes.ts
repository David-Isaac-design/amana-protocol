import { Router, Request, Response } from "express";
import { getErrorCatalog } from "../errors/errorCatalog";

export function createMetaRouter(): Router {
  const router = Router();

  // GET /meta/errors — machine-readable error catalog for clients.
  router.get("/errors", (_req: Request, res: Response) => {
    res.set("Cache-Control", "public, max-age=3600");
    res.json({ errors: getErrorCatalog() });
  });

  return router;
}
