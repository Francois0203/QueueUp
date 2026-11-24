/// <reference types="vite/client" />

declare const __FIREBASE__: {
  config: { apiKey: string; authDomain: string; projectId: string; appId?: string };
  emulators: boolean;
  appCheckKey: string;
  publicUrl: string;
};
