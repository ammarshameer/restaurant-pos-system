/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_WS_URL: string;
  readonly VITE_PRINT_AGENT_URL?: string;
  readonly VITE_PRINT_AGENT_TOKEN?: string;
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_TURNSTILE_SITE_KEY?: string;
  readonly VITE_DEV_PLATFORM_EMAIL?: string;
  readonly VITE_DEV_PLATFORM_PASSWORD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __APP_VERSION__: string;
