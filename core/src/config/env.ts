import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  // --- Core service ---
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // --- Gateway / proxy identity ---
  GATEWAY_HOSTNAME: z.string().min(1).default('proxy.kingxtech.name.ng'),

  // --- GCP Service Account handshake (Optional) ---
  GOOGLE_APPLICATION_CREDENTIALS_JSON: z.string().min(1).optional(),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().min(1).optional(),
  GCP_PROJECT_ID: z.string().min(1).optional(),

  // --- Paystack ---
  PAYSTACK_SECRET_KEY: z.string().min(1).optional(),
  PAYSTACK_PLAN_AMOUNT_KOBO: z.coerce.number().int().positive().default(3000000),
  PAYSTACK_CALLBACK_URL: z.string().url().optional(),
  ANTHROPIC_API_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  GEMINI_API_KEY: z.string().min(1),

  // --- Supabase ---
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // --- Vercel domain management ---
  // Server-side only. Never expose these through public/Vite environment variables.
  VERCEL_TOKEN: z.string().min(1).optional(),
  VERCEL_TEAM_ID: z.string().min(1).optional(),

  // --- Agentic tool sandboxing ---
  AGENT_PROJECT_ROOT: z.string().min(1).optional(),

  // --- Subdomain-per-project hosting (optional) ---
  PUBLIC_SITE_BASE_DOMAIN: z.string().min(1).optional(),

  // --- Observability ---
  SENTRY_DSN: z.string().min(1).optional(),

  // --- Open-weights tier ---
  OPENWEIGHTS_PROVIDER: z.enum(['openrouter', 'together']).default('openrouter'),
  OPENWEIGHTS_API_KEY: z.string().min(1).optional(),
  OPENWEIGHTS_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),
  QWEN_MODEL_ID: z.string().min(1).default('qwen/qwen3-coder:free'),
  LLAMA_MODEL_ID: z.string().min(1).default('meta-llama/llama-3.3-70b-instruct:free'),
  NEMOTRON_MODEL_ID: z.string().min(1).default('nvidia/nemotron-3-nano-30b-a3b:free'),
  DEEPSEEK_MODEL_ID: z.string().min(1).default('deepseek/deepseek-chat-v3-0324:free'),
  GEMMA_MODEL_ID: z.string().min(1).default('gemma-4-31b-it'),
  GEMMA_FREE_API_KEY: z.string().min(1).optional(),

  // --- ACME / domain verification ---
  ACME_ENABLED: z.coerce.boolean().default(false),
  ACME_ACCOUNT_EMAIL: z.string().email().optional(),
  ACME_DIRECTORY_URL: z.string().url().default('https://acme-v02.api.letsencrypt.org/directory'),
  ACME_CHALLENGE_TYPE: z.enum(['http-01', 'dns-01']).default('http-01'),

  // --- CORS ---
  ALLOWED_ORIGINS: z.string().default('https://kingxtech.name.ng,https://auth.kingxtech.name.ng').transform((val) => val.split(',').map((s) => s.trim())),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new Error(`[env] Invalid or missing environment configuration:\n${issues}\nCheck your .env file against the required schema in src/config/env.ts`);
  }
  return parsed.data;
}

export const env = loadEnv();

export function getSafeEnvSummary(): Record<string, unknown> {
  return {
    NODE_ENV: env.NODE_ENV,
    PORT: env.PORT,
    GATEWAY_HOSTNAME: env.GATEWAY_HOSTNAME,
    GCP_PROJECT_ID: env.GCP_PROJECT_ID,
    OPENWEIGHTS_PROVIDER: env.OPENWEIGHTS_PROVIDER,
    OPENWEIGHTS_BASE_URL: env.OPENWEIGHTS_BASE_URL,
    QWEN_MODEL_ID: env.QWEN_MODEL_ID,
    DEEPSEEK_MODEL_ID: env.DEEPSEEK_MODEL_ID,
    GEMMA_MODEL_ID: env.GEMMA_MODEL_ID,
    ACME_ENABLED: env.ACME_ENABLED,
    ACME_CHALLENGE_TYPE: env.ACME_CHALLENGE_TYPE,
    ALLOWED_ORIGINS: env.ALLOWED_ORIGINS,
  };
}
