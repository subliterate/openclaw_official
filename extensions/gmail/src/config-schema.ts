import { z } from "zod";

const GmailAccountSchemaBase = z
  .object({
    name: z.string().optional(),
    enabled: z.boolean().optional(),
    clientId: z.string().optional(),
    clientSecret: z.string().optional(),
    refreshToken: z.string().optional(),
    dmPolicy: z.enum(["open", "pairing", "allowlist", "disabled"]).optional(),
    allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
    pollIntervalSec: z.number().int().positive().optional(),
    maxResults: z.number().int().positive().optional(),
    label: z.string().optional(),
    query: z.string().optional(),
    textChunkLimit: z.number().int().positive().optional(),
    mediaMaxMb: z.number().positive().optional(),
  })
  .strict();

const GmailAccountSchema = GmailAccountSchemaBase.optional();

export const GmailConfigSchema = GmailAccountSchemaBase.extend({
  accounts: z.record(z.string(), GmailAccountSchema).optional(),
}).superRefine((value, ctx) => {
  if (value.dmPolicy === "open" && !value.allowFrom?.includes("*")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["allowFrom"],
      message: 'channels.gmail.dmPolicy="open" requires channels.gmail.allowFrom to include "*"',
    });
  }
});
