import { OcrOutput } from '../types.js';

export interface IOcrEngine {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  recognize(imagePathOrBuffer: string | Buffer): Promise<OcrOutput>;
}
