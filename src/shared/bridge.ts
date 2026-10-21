export interface TraySummary {
  nextRenewal: string;
  pinned: string[];
  reconnectCount: number;
  paused: boolean;
  closeToTray: boolean;
}
export interface DesktopBridge {
  platform: string;
  openExternal(url: string): Promise<void>;
  saveFile(name: string, contents: string): Promise<{ saved: boolean; path?: string }>;
  openFile(): Promise<{ name: string; contents: string; selectionId: string } | null>;
  readSelectedFile(selectionId: string): Promise<string>;
  updateTray(summary: TraySummary): Promise<void>;
  onAction(callback: (action: 'refresh' | 'toggle-pause' | 'settings') => void): () => void;
  quit(): Promise<void>;
}
declare global { interface Window { subcal: DesktopBridge } }
