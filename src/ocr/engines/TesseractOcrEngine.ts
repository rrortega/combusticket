import { createWorker } from 'tesseract.js';
import sharp, { Region } from 'sharp';
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
  private async findPaperBounds(imageBuffer: Buffer): Promise<Region | null> {
    try {
      const thumbW = 100;
      const thumbH = 160;
      const { data } = await sharp(imageBuffer)
        .rotate()
        .resize(thumbW, thumbH, { fit: "fill" })
        .grayscale()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const colB = new Array(thumbW).fill(0);
      for (let x = 0; x < thumbW; x++) {
        for (let y = 0; y < thumbH; y++) colB[x] += data[y * thumbW + x];
        colB[x] /= thumbH;
      }
      const minB = Math.min(...colB);
      const maxB = Math.max(...colB);

      // Distinct contrast between bright receipt and dark surface (>40 luminance diff)
      if (maxB - minB > 40) {
        const thresh = minB + (maxB - minB) * 0.35;
        let leftCol = 0;
        while (leftCol < thumbW && colB[leftCol] < thresh) leftCol++;
        let rightCol = thumbW - 1;
        while (rightCol > 0 && colB[rightCol] < thresh) rightCol--;

        // If receipt paper only occupies a central slice and not the whole width
        if (leftCol < rightCol && (leftCol > 5 || rightCol < thumbW - 6)) {
          const meta = await sharp(imageBuffer).rotate().metadata();
          const origW = meta.width!;
          const pad = Math.floor(origW * 0.02);
          const left = Math.max(0, Math.floor((leftCol / thumbW) * origW) - pad);
          const right = Math.min(origW, Math.ceil(((rightCol + 1) / thumbW) * origW) + pad);
          return { left, top: 0, width: right - left, height: meta.height! };
        }
      }
    } catch {
      // Fallback to uncropped if analysis fails
    }
    return null;
  }

  /**
   * Preprocesses thermal receipt photo using sharp to maximize OCR character recognition
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

    let img = sharp(imageBuffer).rotate();
    const bounds = await this.findPaperBounds(imageBuffer);
    if (bounds) {
      img = img.extract(bounds);
    }

    return img
      .resize({ width: 2000, withoutEnlargement: false })
      .grayscale()
      .normalize()
      .sharpen()
      .toBuffer();
  }

  public async recognize(imagePathOrBuffer: string | Buffer): Promise<OcrOutput> {
    try {
      let imageBuffer: Buffer;
      if (Buffer.isBuffer(imagePathOrBuffer)) {
        imageBuffer = imagePathOrBuffer;
      } else {
        const resolved = path.resolve(imagePathOrBuffer);
        imageBuffer = fs.readFileSync(resolved);
      }

      const preprocessed = await this.preprocessImage(imageBuffer);
      const worker = await this.getWorker();
      const ret = await worker.recognize(preprocessed);
      let fullText = ret.data.text || '';

      // If primary pass lacks folio/webId/amount or detects ControlGas dot-matrix keywords,
      // run dot-matrix enhancement pass (slight blur to connect dot matrices + threshold 180)
      const needsDotMatrixPass =
        fullText.length < 250 ||
        !/(?:WEB\s*ID|WebId|NUS\s*1?D)/i.test(fullText) ||
        (!/Rastreo|00P/i.test(fullText) && /COMBUSTIBLES|CONTROLGAS|ATIO|FECHA|1itros/i.test(fullText));

      if (needsDotMatrixPass) {
        try {
          let s2 = sharp(imageBuffer).rotate();
          const bounds = await this.findPaperBounds(imageBuffer);
          if (bounds) s2 = s2.extract(bounds);

          const croppedBuf = await s2.toBuffer();

          // Pass A: Gamma contrast (preserves faint folio, CRE permit, dates)
          const gammaBuf = await sharp(croppedBuf)
            .resize({ width: 2000, withoutEnlargement: false })
            .grayscale()
            .gamma(1.5)
            .normalize()
            .sharpen()
            .toBuffer();
          const retGamma = await worker.recognize(gammaBuf);
          if (retGamma.data.text) {
            fullText = `${fullText}\n--- GAMMA PASS ---\n${retGamma.data.text}`;
          }

          // Pass B: Dot threshold (joins disconnected dots for numbers, Web ID, and Amount)
          const dotBuf = await sharp(croppedBuf)
            .resize({ width: 2200, withoutEnlargement: false })
            .grayscale()
            .blur(0.8)
            .threshold(180)
            .toBuffer();
          const retDot = await worker.recognize(dotBuf);
          if (retDot.data.text) {
            fullText = `${fullText}\n--- DOT MATRIX PASS ---\n${retDot.data.text}`;
          }
        } catch (passErr) {
          console.warn('[TesseractOcrEngine] Secondary pass error:', passErr);
        }
      }

      const lines: RecognizedLine[] = [];
      const textLines = fullText
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
        fullText,
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
