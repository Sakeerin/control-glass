import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const BoundarySchema = z.object({ pathPrefix: z.string().min(1), forbiddenImports: z.array(z.string().min(1)), description: z.string().optional() });
const FeatureSchema = z.object({
  id: z.string().min(1), name: z.string().min(1), tier: z.enum(["Tier 0", "Tier 1", "Tier 2"]),
  riskReason: z.string(), entrypoints: z.array(z.string()), contracts: z.array(z.string()), tests: z.array(z.string())
});
const FeatureMapSchema = z.object({ architecturalBoundaries: z.record(BoundarySchema).optional(), features: z.array(FeatureSchema).default([]) });
const CommandConfigSchema = z.object({
  staticCheckCommands: z.array(z.string().trim().min(1)).optional(),
  testCommands: z.array(z.string().trim().min(1)).optional(),
  timeoutMs: z.number().int().min(100).max(3_600_000).default(120_000)
}).strict();

export function loadFeatureMap(rootDir: string): z.infer<typeof FeatureMapSchema> {
  const file = path.join(rootDir, "feature-map.json");
  return FeatureMapSchema.parse(fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {});
}

export function loadCommandConfig(rootDir: string): z.infer<typeof CommandConfigSchema> {
  const file = path.join(rootDir, "control-glass.config.json");
  return CommandConfigSchema.parse(fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {});
}
