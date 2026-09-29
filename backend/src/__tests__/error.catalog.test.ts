import fs from "fs";
import path from "path";
import express from "express";
import request from "supertest";
import { ErrorCode } from "../errors/errorCodes";
import {
  ERROR_CATALOG_END,
  ERROR_CATALOG_START,
  getErrorCatalog,
  renderErrorCatalogMarkdown,
} from "../errors/errorCatalog";
import { createMetaRouter } from "../routes/meta.routes";

describe("error catalog", () => {
  it("has an entry for every ErrorCode", () => {
    const codes = getErrorCatalog().map((e) => e.code);
    expect(codes.sort()).toEqual((Object.values(ErrorCode) as string[]).sort());
  });

  it("docs/api/errors.md matches the catalog (run scripts/generate-error-catalog.ts)", () => {
    const doc = fs.readFileSync(path.resolve(__dirname, "../../../docs/api/errors.md"), "utf8");
    const start = doc.indexOf(ERROR_CATALOG_START);
    const end = doc.indexOf(ERROR_CATALOG_END);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(doc.slice(start, end + ERROR_CATALOG_END.length)).toBe(renderErrorCatalogMarkdown());
  });

  it("GET /meta/errors serves the catalog", async () => {
    const app = express();
    app.use("/meta", createMetaRouter());
    const res = await request(app).get("/meta/errors");
    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual(getErrorCatalog());
  });
});
