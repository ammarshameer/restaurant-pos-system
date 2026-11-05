/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_WS_URL: string;
  readonly VITE_PRINT_HELPER_URL?: string;
  readonly VITE_PRINT_HELPER_TOKEN?: string;
  readonly VITE_PRINT_AGENT_URL?: string;
  // Add other env variables as needed
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __APP_VERSION__: string;

interface ElectronPrintResult {
  ok: boolean;
  message?: string;
  error?: string;
}

interface ElectronPrintStatus {
  ok: boolean;
  app?: string;
  version?: string;
  printerName?: string;
  configured?: boolean;
  platform?: string;
}

interface Window {
  electronAPI?: {
    platform?: string;
    getVersion?: () => Promise<string>;
    print?: {
      status: () => Promise<ElectronPrintStatus>;
      printReceipt: (payload: {
        receipt: unknown;
        mode: 'BOTH' | 'CUSTOMER' | 'KITCHEN';
        openDrawer?: boolean;
        printerName?: string;
      }) => Promise<ElectronPrintResult>;
      testPrint: () => Promise<ElectronPrintResult>;
      listPrinters: () => Promise<string[]>;
      getSettings: () => Promise<Record<string, unknown>>;
      saveSettings: (settings: Record<string, unknown>) => Promise<Record<string, unknown>>;
      openSettings: () => Promise<boolean>;
    };
  };
}
