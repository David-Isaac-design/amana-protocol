/**
 * Regenerates the error catalog table in docs/api/errors.md from
 * src/errors/errorCatalog.ts. Run: npx tsx scripts/generate-error-catalog.ts
 */
import fs from "fs";
import path from "path";
import {
  ERROR_CATALOG_END,
  ERROR_CATALOG_START,
  renderErrorCatalogMarkdown,
} from "../src/errors/errorCatalog";

const docPath = path.resolve(__dirname, "../../docs/api/errors.md");
const doc = fs.readFileSync(docPath, "utf8");
const start = doc.indexOf(ERROR_CATALOG_START);
const end = doc.indexOf(ERROR_CATALOG_END);
if (start === -1 || end === -1) {
  throw new Error(`error-catalog markers not found in ${docPath}`);
}
const updated =
  doc.slice(0, start) + renderErrorCatalogMarkdown() + doc.slice(end + ERROR_CATALOG_END.length);
fs.writeFileSync(docPath, updated);
console.log(`Updated ${docPath}`);
