import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ContextPack } from "./types.js";

export const PACK_SCHEMA_VERSION = "1.0";

export const PACK_SCHEMA_URL =
  "https://raw.githubusercontent.com/ajxdevx/Taskpin/main/schema/context-pack.schema.json";

export type ContextPackBody = Omit<ContextPack, "$schema" | "schema_version">;

export function withSchemaMetadata(pack: ContextPackBody): ContextPack {
  return {
    ...pack,
    schema_version: PACK_SCHEMA_VERSION,
    $schema: PACK_SCHEMA_URL,
  };
}

export function schemaFilePath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, "..", "schema", "context-pack.schema.json");
}

export async function loadPublishedSchema(): Promise<string> {
  return fs.readFile(schemaFilePath(), "utf8");
}
