import { OcrOutput, ParsedReceiptData } from '../core/types.js';

export class ReceiptParser {
  public parse(ocrOutput: OcrOutput): ParsedReceiptData {
    const rawText = ocrOutput.fullText;
    const lines = ocrOutput.lines.map((l) => l.text.trim());

    const trackingNumber = this.extractTrackingNumber(lines, rawText);
    const gasStation = this.extractGasStation(lines);
    const stationNumber = this.extractStationNumber(lines, rawText, trackingNumber);
    const cashier = this.extractCashier(lines, rawText);
    const transaction = this.extractTransaction(lines, rawText);
    const date = this.extractDate(lines, rawText);
    const paymentMethod = this.extractPaymentMethod(lines, rawText);
    const { total, subtotal, iva } = this.extractAmounts(lines, rawText);
    const billingUrl = this.extractBillingUrl(lines, rawText);

    return {
      gasStation,
      stationNumber,
      cashier,
      trackingNumber,
      transaction,
      date,
      paymentMethod,
      amount: total,
      subtotal,
      iva,
      billingUrl,
      rawText,
    };
  }

  private extractTrackingNumber(lines: string[], rawText: string): string {
    // 1. Explicit pattern with OCR-fuzzy tolerant 'Rastreo' (handles 'Ras treo', 'Rastre o', etc.)
    const trackingRegex = /(?:R\s*a\s*s\s*t\s*r\s*e\s*o|Ticket|Folio|No\.?\s*Rastreo)[:\s]*([0-9\s]{10,28})/i;
    
    for (const line of lines) {
      const match = line.match(trackingRegex);
      if (match && match[1]) {
        const cleaned = match[1].replace(/[^0-9]/g, '');
        if (cleaned.length >= 10) return cleaned;
      }
    }

    // 2. Scan across raw text
    const rawMatch = rawText.match(trackingRegex);
    if (rawMatch && rawMatch[1]) {
      const cleaned = rawMatch[1].replace(/[^0-9]/g, '');
      if (cleaned.length >= 10) return cleaned;
    }

    // 3. Fallback: 14 to 20 digit consecutive sequence (excluding date/time stamps)
    for (const line of lines) {
      const digitsOnly = line.replace(/[^0-9]/g, '');
      if (digitsOnly.length >= 15 && digitsOnly.length <= 22) {
        // Exclude lines that are timestamps (e.g. 21082026145728)
        if (!/^\d{2}(?:0[1-9]|1[0-2])\d{4}/.test(digitsOnly)) {
          return digitsOnly;
        }
      }
    }

    return '';
  }

  private extractGasStation(lines: string[]): string {
    const knownBrands = [
      'GOGAS',
      'PEMEX',
      'BP',
      'SHELL',
      'OXXO GAS',
      'TOTAL',
      'MOBIL',
      'PETRO SEVEN',
      'PETRO 7',
      'REPSOL',
      'G500',
      'HIDROSINA',
      'GULF',
      'CHEVRON',
    ];

    for (const line of lines.slice(0, 8)) {
      const upper = line.toUpperCase();
      for (const brand of knownBrands) {
        if (upper.includes(brand)) {
          return brand;
        }
      }
    }

    // Check company names
    for (const line of lines.slice(0, 8)) {
      if (/SA\s+DE\s+CV|S\.A\.\s+DE\s+C\.V\./i.test(line)) {
        return line.trim();
      }
    }

    return lines[0] || 'GASOLINERA DESCONOCIDA';
  }

  private extractStationNumber(lines: string[], rawText: string, trackingNumber?: string): string | undefined {
    // 1. Explicit keyword match in lines or rawText
    // Handles "estación: 12009", "ESTACION DE SERVICIO E08420", "Estación: 14764", "E.S. 14764", "No. Estación: 12009", "EST: 12009"
    const stationRegex = /(?:No\.?\s*(?:de\s*)?Estaci[oó]n(?:\s+de\s+servicio)?|Estaci[oó]n(?:\s+de\s+servicio)?|E\.?S\.?|\bEST\.?)[:\s#]+(?:No\.?\s*)?([A-Z0-9\-\/]{3,15})/i;

    for (const line of lines) {
      const match = line.match(stationRegex);
      if (match && match[1]) {
        const cleaned = match[1].replace(/^[^\w]+|[^\w]+$/g, '').trim();
        if (cleaned && !/^(DE|DEL|LA|EL|SAN|LOS|MEX|SUR|NORTE|SERVICIO|SERVICIOS)$/i.test(cleaned)) {
          return cleaned;
        }
      }
    }

    const rawMatch = rawText.match(stationRegex);
    if (rawMatch && rawMatch[1]) {
      const cleaned = rawMatch[1].replace(/^[^\w]+|[^\w]+$/g, '').trim();
      if (cleaned && !/^(DE|DEL|LA|EL|SAN|LOS|MEX|SUR|NORTE|SERVICIO|SERVICIOS)$/i.test(cleaned)) {
        return cleaned;
      }
    }

    // 2. CRE Permit check: PL/12009/EXP/ES/2015 -> extracts station number or CRE code
    const creMatch = rawText.match(/PL\s*[\/-]?\s*(\d{4,6})\s*[\/-]?\s*EXP/i);
    if (creMatch && creMatch[1]) {
      return creMatch[1].trim();
    }

    // 3. Pemex station code pattern: E followed by 4-5 digits (e.g. E08420 or E12009)
    for (const line of lines.slice(0, 10)) {
      const eMatch = line.match(/\b(E\d{4,5})\b/i);
      if (eMatch && eMatch[1]) {
        return eMatch[1].toUpperCase();
      }
    }

    // 4. Fallback from tracking number prefix (ControlGas / GoGas 16-20 digit folios start with station #)
    if (trackingNumber && trackingNumber.length >= 14) {
      const candidate5 = trackingNumber.slice(0, 5);
      const candidate4 = trackingNumber.slice(0, 4);
      for (const line of lines.slice(0, 10)) {
        if (line.includes(candidate5)) return candidate5;
        if (line.includes(candidate4)) return candidate4;
      }
      if (/^1\d{4}$/.test(candidate5)) {
        return candidate5;
      }
    }

    return undefined;
  }

  private extractCashier(lines: string[], rawText: string): string | undefined {
    // Handles "Atendió: ANGEL IVAN CLAU MAY", "Cajero: ...", "Despachador: ...", "Le atendió: ...", "Operador: ...", etc.
    const cashierRegex = /(?:Atendi[oó]|Le\s+atendi[oó]|Atendido\s+por|Cajer[oa](?:\(a\))?|Despachador(?:a|\(a\))?|Despacho\s+por|Despach[oó]|Operador(?:a)?|Vendedor(?:a)?|Empleado)[:\s#]*([^\n\r]+)/i;

    for (const line of lines) {
      const match = line.match(cashierRegex);
      if (match && match[1]) {
        let cleaned = match[1].trim();
        // Remove trailing stop keywords or secondary fields on same line (e.g. "Posición", "Bomba", "Turno", "Fecha", "Caja", "Ticket", "PC")
        cleaned = cleaned.replace(/\s+(?:Posici[oó]n|Bomba|Isla|Turno|Fecha|Hora|Ticket|PC|Caja)[:\s].*$/i, '').trim();
        // Remove leading/trailing symbols
        cleaned = cleaned.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9\.\-]+$/g, '').trim();
        if (cleaned.length >= 2 && !/^(NORMAL|VENTA|EFECTIVO|TARJETA|TOTAL)$/i.test(cleaned)) {
          return cleaned;
        }
      }
    }

    const rawMatch = rawText.match(cashierRegex);
    if (rawMatch && rawMatch[1]) {
      let cleaned = rawMatch[1].trim();
      cleaned = cleaned.replace(/\s+(?:Posici[oó]n|Bomba|Isla|Turno|Fecha|Hora|Ticket|PC|Caja)[:\s].*$/i, '').trim();
      cleaned = cleaned.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9\.\-]+$/g, '').trim();
      if (cleaned.length >= 2 && !/^(NORMAL|VENTA|EFECTIVO|TARJETA|TOTAL)$/i.test(cleaned)) {
        return cleaned;
      }
    }

    return undefined;
  }

  private extractTransaction(lines: string[], rawText: string): string | undefined {
    const match = rawText.match(/(?:Transacci[oó]n|Trans|No\.\s*Trans)[:\s]*([0-9]+)/i);
    if (match && match[1]) {
      return match[1].trim();
    }
    return undefined;
  }

  private extractDate(lines: string[], rawText: string): string {
    // DD/MM/YYYY HH:MM:SS
    const match = rawText.match(/(\d{2}[/-]\d{2}[/-]\d{4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)/);
    if (match && match[1]) {
      return match[1].trim();
    }
    return '';
  }

  private extractPaymentMethod(lines: string[], rawText: string): string {
    const match = rawText.match(/(?:FORMA\s+DE\s+PAGO|M[EÉ]TODO\s+DE\s+PAGO)[:\s]*([^\n\r]+)/i);
    if (match && match[1]) {
      return match[1].trim();
    }

    for (const line of lines) {
      if (/VISA|MASTERCARD|MC|EFECTIVO|TARJETA|DEBITO|CREDITO/i.test(line)) {
        return line.trim();
      }
    }

    return 'EFECTIVO';
  }

  private extractAmounts(lines: string[], rawText: string): { total: number; subtotal?: number; iva?: number } {
    let total = 0;
    let subtotal: number | undefined;
    let iva: number | undefined;

    // Subtotal (handles SUBI?TOTAL)
    const subMatch = rawText.match(/SUBI?TOTAL[:\s]*\$?\s*([0-9]+(?:\.[0-9]{2})?)/i);
    if (subMatch && subMatch[1]) {
      subtotal = parseFloat(subMatch[1]);
    }

    // IVA
    const ivaMatch = rawText.match(/IVA[:\s]*\$?\s*([0-9]+(?:\.[0-9]{2})?)/i);
    if (ivaMatch && ivaMatch[1]) {
      iva = parseFloat(ivaMatch[1]);
    }

    // Cleaned prices with potential comma-dot typos: e.g. $1090,.40 or $1090.40
    for (const line of lines) {
      const match = line.match(/\$?\s*([0-9]{2,6})[,\.]+(\d{2})\b/);
      if (match && match[1] && match[2]) {
        const val = parseFloat(`${match[1]}.${match[2]}`);
        if (val > total) {
          total = val;
        }
      }
    }

    // Also look after TOTAL:
    const totalMatch = rawText.match(/TOTAL[:\s]*[\s\S]*?\$?\s*([0-9]+(?:\.[0-9]{2})?)/i);
    if (totalMatch && totalMatch[1]) {
      const val = parseFloat(totalMatch[1]);
      if (val > total) total = val;
    }

    return { total, subtotal, iva };
  }

  private extractBillingUrl(lines: string[], rawText: string): string {
    // Look for facturasgas explicitly
    if (/facturas\s*gas\.com/i.test(rawText)) {
      return 'https://www.facturasgas.com';
    }

    for (const line of lines) {
      const sanitized = line.replace(/\s+/g, '').toLowerCase();
      const match = sanitized.match(/((?:https?:\/\/)?(?:www\.)?[a-z0-9-]+\.(?:com|mx|com\.mx|net|org)(?:\/[^\s]*)?)/i);
      if (match && match[1]) {
        let url = match[1];
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          url = 'https://' + url;
        }
        return url;
      }
    }

    return 'https://www.facturasgas.com';
  }
}
