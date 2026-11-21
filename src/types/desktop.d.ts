export interface NexusDesktopBridge {
  isDesktop: boolean;
  platform: string;
  pickDirectory: () => Promise<string | null>;
  openExternal: (url: string) => Promise<boolean>;
  openFolder?: (folderPath: string) => Promise<boolean>;
  setOpacity?: (value: number) => Promise<boolean>;
  setTitlebarTheme?: (opts: { color: string; symbolColor: string }) => Promise<boolean>;
}

declare global {
  interface Window {
    nexusDesktop?: NexusDesktopBridge;
  }
}
