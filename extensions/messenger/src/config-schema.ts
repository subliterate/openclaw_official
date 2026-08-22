import { z } from "zod";

const MessengerAccountSchemaBase = z
  .object({
    name: z.string().optional(),
    enabled: z.boolean().optional(),
    pageAccessToken: z.string().optional(),
    appSecret: z.string().optional(),
    verifyToken: z.string().optional(),
    webhookPath: z.string().optional(),
    dmPolicy: z.enum(["open", "pairing", "allowlist", "disabled"]).optional(),
    allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
    textChunkLimit: z.number().int().positive().optional(),
    mediaMaxMb: z.number().positive().optional(),
  })
  .strict();

const MessengerAccountSchema = MessengerAccountSchemaBase.optional();

export const MessengerConfigSchema = MessengerAccountSchemaBase.extend({
  accounts: z.record(z.string(), MessengerAccountSchema).optional(),
}).superRefine((value, ctx) => {
  if (value.dmPolicy === "open" && !value.allowFrom?.includes("*")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["allowFrom"],
      message:
        'channels.messenger.dmPolicy="open" requires channels.messenger.allowFrom to include "*"',
    });
  }
});
