export interface IBrowserManager {
  start(): Promise<string>;
  stop(): Promise<void> | void;
  getCdpUrl(): string;
  checkHealth(): Promise<boolean>;
}
