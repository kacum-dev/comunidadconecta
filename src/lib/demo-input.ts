import { z } from "zod";
import { DEMO_ROLE_KEYS } from "./demo-types";

export const demoSessionInputSchema = z.object({
  role: z.enum(DEMO_ROLE_KEYS),
  accessCode: z.string().trim().max(128).optional().default("")
}).strict();

export const demoSettingsInputSchema = z.object({
  enabled: z.boolean(),
  title: z.string().trim().min(4).max(100),
  description: z.string().trim().min(10).max(320),
  enabledRoles: z.array(z.enum(DEMO_ROLE_KEYS)).min(1).max(DEMO_ROLE_KEYS.length),
  sessionDurationMinutes: z.number().int().min(15).max(240),
  expiresAt: z.string().datetime({ offset: true }).nullable(),
  accessCode: z.union([z.string().trim().min(6).max(128), z.null()]).optional()
}).strict();

export type DemoSettingsInput = z.infer<typeof demoSettingsInputSchema>;
