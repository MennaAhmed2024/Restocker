import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  ACCESS_TOKEN_SECRET: z.string().min(32),
  REFRESH_TOKEN_SECRET: z.string().min(32),
  ACCESS_TOKEN_EXPIRES_IN: z.string().default('15m'),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default('7d'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  EXPOSE_INSTANCE_ID: z.string().default('false').transform((value) => value === 'true'),
  APP_URL: z.string().url().default('http://localhost:8081'),
  SMTP_HOST: z.string().default('mailpit'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_FROM: z.string().default('ReStockr <no-reply@restockr.local>'),
});

export type Config = z.infer<typeof schema>;
export const loadConfig = (source: NodeJS.ProcessEnv = process.env): Config => schema.parse(source);
