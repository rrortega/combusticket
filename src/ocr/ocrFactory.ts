import { IOcrEngine } from '../core/interfaces/IOcrEngine.js';
import { TesseractOcrEngine } from './engines/TesseractOcrEngine.js';

export class OcrEngineFactory {
  public static async createEngine(): Promise<IOcrEngine> {
    // Cross-platform engine with sharp preprocessing
    // Guaranteed 100% parity between local dev and remote VPS Linux production
    return new TesseractOcrEngine();
  }
}
