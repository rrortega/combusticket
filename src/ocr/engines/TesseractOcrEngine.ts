import { createWorker } from 'tesseract.js';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { IOcrEngine } from '../../core/interfaces/IOcrEngine.js';
import { OcrOutput, RecognizedLine } from '../../core/types.js';

export class TesseractOcrEngine implements IOcrEngine {
  public readonly name = 'TesseractOcrEngine';
  private worker: any = null;

  public async isAvailable(): Promise<boolean> {
    return true; // Universal cross-platform support (Linux VPS & macOS)
  }

  private async getWorker() {
    if (!this.worker) {
      this.worker = await createWorker('spa');
    }
    return this.worker;
  }

  /**
   * Preprocesses thermal receipt photo using sharp to maximize OCR character recognition:
   * 1. Auto-orient based on camera EXIF data (.rotate())
   * 2. Convert to grayscale (.grayscale())
   * 3. Normalize dynamic range & contrast (.normalize())
   * 4. Sharpen degraded dot-matrix characters (.sharpen())
   */
  private async preprocessImage(input: string | Buffer): Promise<Buffer> {
    let imageBuffer: Buffer;
    if (Buffer.isBuffer(input)) {
      imageBuffer = input;
    } else {
      const resolved = path.resolve(input);
      if (!fs.existsSync(resolved)) {
        throw new Error(`Receipt image file not found at: ${resolved}`);
      }
      imageBuffer = fs.readFileSync(resolved);
    }

    const meta = await sharp(imageBuffer).metadata();
    let img = sharp(imageBuffer).rotate();

    // Scale up mobile photos or lower-res tickets so dot-matrix characters have sufficient x-height (>=20px)
    if (meta.width && meta.width < 1600) {
      img = img.resize({ width: 1600, withoutEnlargement: false });
    }

    return img
      .grayscale()
      .linear(1.25, -15)
      .normalize()
      .sharpen()
      .toBuffer();
  }

  public async recognize(imagePathOrBuffer: string | Buffer): Promise<OcrOutput> {
    try {
      const preprocessed = await this.preprocessImage(imagePathOrBuffer);
      const worker = await this.getWorker();
      const ret = await worker.recognize(preprocessed);

      const lines: RecognizedLine[] = [];
      const textLines = (ret.data.text || '')
        .split('\n')
        .map((l: string) => l.trim())
        .filter(Boolean);

      for (const line of textLines) {
        lines.push({
          text: line,
          confidence: (ret.data.confidence || 0) / 100,
        });
      }

      return {
        success: true,
        lines,
        fullText: ret.data.text,
      };
    } catch (err: any) {
      return {
        success: false,
        lines: [],
        fullText: '',
        error: `[TesseractOcrEngine] Recognition failed: ${err.message}`,
      };
    }
  }

  public async terminate(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
  }
}
