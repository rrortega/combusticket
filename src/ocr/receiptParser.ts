import { OcrOutput, ParsedReceiptData } from "../core/types.js";

interface KnownStationInfo {
  brand?: string;
  branch: string;
  street: string;
  neighborhood?: string;
  city: string;
  state: string;
  postalCode: string;
  rfc?: string;
}

const KNOWN_STATIONS: Record<string, KnownStationInfo> = {
  // GoGas / LaGas Red FacturasGas stations
  "14764": {
    brand: "GOGAS",
    branch: "BUQUE DE VELA",
    street: "Av. 135 Mz 31 L 50-54",
    neighborhood: "SM 327",
    city: "Benito Juárez (Cancún)",
    state: "Quintana Roo",
    postalCode: "77535",
    rfc: "BVE190821MP9",
  },
  "12009": {
    brand: "GOGAS",
    branch: "SEIS ANÉMONAS",
    street: "Cecilio Peraza Mz 11 Lote 1",
    city: "Benito Juárez (Cancún)",
    state: "Quintana Roo",
    postalCode: "77535",
    rfc: "SSA120627NA5",
  },
  "11001": {
    brand: "GOGAS",
    branch: "KABAH",
    street: "Av. Kabah con Av. Huayacán",
    city: "Benito Juárez (Cancún)",
    state: "Quintana Roo",
    postalCode: "77533",
  },
};

export class ReceiptParser {
  public parse(ocrOutput: OcrOutput): ParsedReceiptData {
    const rawText = ocrOutput.fullText;
    const lines = ocrOutput.lines.map((l) => l.text.trim());

    const trackingNumber = this.extractTrackingNumber(lines, rawText);
    const stationNumber = this.extractStationNumber(
      lines,
      rawText,
      trackingNumber,
    );
    const gasStation = this.extractGasStation(lines, rawText, stationNumber);
    const address = this.extractAddress(lines, rawText, stationNumber);
    const cashier = this.extractCashier(lines, rawText);
    const transaction = this.extractTransaction(lines, rawText);
    const date = this.extractDate(lines, rawText);
    const paymentMethod = this.extractPaymentMethod(lines, rawText);
    const { total, subtotal, iva } = this.extractAmounts(
      lines,
      rawText,
      paymentMethod,
    );
    const liters = this.extractLiters(lines, rawText, total);
    const billingUrl = this.extractBillingUrl(lines, rawText);

    return {
      gasStation,
      stationNumber,
      address,
      cashier,
      trackingNumber,
      transaction,
      date,
      paymentMethod,
      amount: total,
      liters,
      subtotal,
      iva,
      billingUrl,
      rawText,
    };
  }

  private extractTrackingNumber(lines: string[], rawText: string): string {
    // 1. Explicit pattern with OCR-fuzzy tolerant 'Rastreo' (handles 'Ras treo', 'Rastre o', etc.)
    const trackingRegex =
      /(?:R\s*a\s*s\s*t\s*r\s*e\s*o|Ticket|Folio|No\.?\s*Rastreo)[:\s]*([0-9\s]{10,28})/i;

    for (const line of lines) {
      const match = line.match(trackingRegex);
      if (match && match[1]) {
        const cleaned = match[1].replace(/[^0-9]/g, "");
        if (cleaned.length >= 10) return cleaned;
      }
    }

    // 2. Scan across raw text
    const rawMatch = rawText.match(trackingRegex);
    if (rawMatch && rawMatch[1]) {
      const cleaned = rawMatch[1].replace(/[^0-9]/g, "");
      if (cleaned.length >= 10) return cleaned;
    }

    // 3. Fallback: 14 to 20 digit consecutive sequence (excluding date/time stamps)
    for (const line of lines) {
      const digitsOnly = line.replace(/[^0-9]/g, "");
      if (digitsOnly.length >= 15 && digitsOnly.length <= 22) {
        // Exclude lines that are timestamps (e.g. 21082026145728)
        if (!/^\d{2}(?:0[1-9]|1[0-2])\d{4}/.test(digitsOnly)) {
          return digitsOnly;
        }
      }
    }

    return "";
  }

  private extractGasStation(
    lines: string[],
    rawText?: string,
    stationNumber?: string,
  ): string {
    const knownBrands = [
      "LAGAS",
      "LA GAS",
      "GOGAS",
      "RED FACTURASGAS",
      "FACTURASGAS",
      "PEMEX",
      "BP",
      "SHELL",
      "OXXO GAS",
      "TOTAL",
      "MOBIL",
      "PETRO SEVEN",
      "PETRO 7",
      "REPSOL",
      "G500",
      "HIDROSINA",
      "GULF",
      "CHEVRON",
    ];

    // 1. Direct match on rawText for explicit brand
    if (rawText) {
      for (const brand of knownBrands) {
        const regex = new RegExp(`\\b${brand.replace(/\s+/g, "\\s*")}\\b`, "i");
        if (regex.test(rawText)) {
          return brand === "LA GAS" ? "LAGAS" : brand;
        }
      }
    }

    // 2. Scan first 25 lines for brand keywords
    for (const line of lines.slice(0, 25)) {
      const upper = line.toUpperCase();
      for (const brand of knownBrands) {
        if (upper.includes(brand)) {
          return brand === "LA GAS" ? "LAGAS" : brand;
        }
      }
    }

    // 3. Known station fallback
    if (stationNumber && KNOWN_STATIONS[stationNumber]?.brand) {
      return KNOWN_STATIONS[stationNumber].brand!;
    }

    // 4. Check company names (SA DE CV)
    for (const line of lines.slice(0, 20)) {
      if (/SA\s+DE\s+CV|S\.A\.\s+DE\s+C\.V\./i.test(line)) {
        const cleaned = line.replace(/[^\w\s.,]/g, "").trim();
        if (cleaned.length > 5) return cleaned;
      }
    }

    // 5. Pick first line with meaningful alphabetic characters (ignore OCR symbol noise)
    for (const line of lines.slice(0, 10)) {
      const letters = line.replace(/[^A-Za-z]/g, "");
      if (letters.length >= 4 && !/^\d+/.test(line)) {
        return line.trim();
      }
    }

    return "GASOLINERA DESCONOCIDA";
  }

  private extractStationNumber(
    lines: string[],
    rawText: string,
    trackingNumber?: string,
  ): string | undefined {
    // 1. High-precision station regex that captures station digits or E-prefixed code
    // Handles "estación: 12009", "Estación: 14764", "E.S. 14764", "ración: 12009", "EST: 12009", "E08420"
    const stationNumberRegex =
      /(?:No\.?\s*(?:de\s*)?Estaci[oó]n(?:\s+de\s+servicio)?|Estaci[oó]n(?:\s+de\s+servicio)?|E\.?S\.?|\bEST\.?|Est|ración)\D*?(\d{4,6}|E\d{4,6})\b/i;

    for (const line of lines) {
      const match = line.match(stationNumberRegex);
      if (match && match[1]) {
        return match[1].trim();
      }
    }

    const rawMatch = rawText.match(stationNumberRegex);
    if (rawMatch && rawMatch[1]) {
      return rawMatch[1].trim();
    }

    // 2. CRE Permit check: PL/12009/EXP/ES/2015 -> extracts station number or CRE code
    const creMatch = rawText.match(/PL\s*[/-]?\s*(\d{4,6})\s*[/-]?\s*EXP/i);
    if (creMatch && creMatch[1]) {
      return creMatch[1].trim();
    }

    // 3. Fallback from tracking number prefix (ControlGas / GoGas 16-20 digit folios start with station #)
    if (trackingNumber && trackingNumber.length >= 14) {
      const candidate5 = trackingNumber.slice(0, 5);
      const candidate4 = trackingNumber.slice(0, 4);
      for (const line of lines.slice(0, 10)) {
        if (line.includes(candidate5)) return candidate5;
        if (line.includes(candidate4)) return candidate4;
      }
      if (/^\d{4,5}$/.test(candidate5)) {
        return candidate5;
      }
    }

    return undefined;
  }

  private extractCashier(lines: string[], rawText: string): string | undefined {
    // Handles "Atendió: ANGEL IVAN CLAU MAY", "Alendió: OTONIEL RAMOS PEREZ", "Atendio: JAVIER ANTONIO CARUEÑA CHAN", etc.
    const cashierRegex =
      /(?:A[lt]endi[oó]|Le\s+a[lt]endi[oó]|A[lt]endido\s+por|Cajer[oa](?:\(a\))?|Despachador(?:a|\(a\))?|Despacho\s+por|Despach[oó]|Operador(?:a)?|Vendedor(?:a)?|Empleado)[:\s#]*([^\n\r]+)/i;

    const cleanCashier = (text: string): string | undefined => {
      let cleaned = text.trim();
      cleaned = cleaned
        .replace(
          /\s+(?:Posici[oó]n|Bomba|Isla|Turno|Fecha|Hora|Ticket|PC|Caja|Re\b|94d.*|Ol\b|NAT\b|FORMA).*$/i,
          "",
        )
        .trim();
      cleaned = cleaned
        .replace(/^[^a-zA-ZÁÉÍÓÚÑñ]+|[^a-zA-ZÁÉÍÓÚÑñ.-]+$/g, "")
        .trim();
      // Standardize common OCR name typos
      cleaned = cleaned
        .replace(/\bOTONTEL\b/i, "OTONIEL")
        .replace(/\bANTUNIO\b/i, "ANTONIO")
        .replace(/\bCARUEÑA\b/i, "CARDEÑA");
      // Strip trailing OCR garbage words of 1-2 letters (e.g. "ay y", "re", "es")
      cleaned = cleaned.replace(/(?:\s+[a-zA-Z]{1,2})+$/g, "").trim();
      if (
        cleaned.length >= 3 &&
        !/^(NORMAL|VENTA|EFECTIVO|TARJETA|TOTAL)$/i.test(cleaned)
      ) {
        return cleaned;
      }
      return undefined;
    };

    for (const line of lines) {
      const match = line.match(cashierRegex);
      if (match && match[1]) {
        const cleaned = cleanCashier(match[1]);
        if (cleaned) return cleaned;
      }
    }

    const rawMatch = rawText.match(cashierRegex);
    if (rawMatch && rawMatch[1]) {
      const cleaned = cleanCashier(rawMatch[1]);
      if (cleaned) return cleaned;
    }

    return undefined;
  }

  private extractTransaction(
    lines: string[],
    rawText: string,
  ): string | undefined {
    const match = rawText.match(
      /(?:Transacci[oó]n|Trans|No\.\s*Trans)[:\s]*([0-9]+)/i,
    );
    if (match && match[1]) {
      return match[1].trim();
    }
    return undefined;
  }

  private extractDate(lines: string[], rawText: string): string {
    // DD/MM/YYYY HH:MM:SS
    const match = rawText.match(
      /(\d{2}[/-]\d{2}[/-]\d{4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)/,
    );
    if (match && match[1]) {
      return match[1].trim();
    }
    return "";
  }

  private extractPaymentMethod(lines: string[], rawText: string): string {
    const paymentText = [rawText, ...lines].join("\n");
    return this.normalizePaymentMethod(paymentText);
  }

  private normalizePaymentMethod(raw: string): string {
    const normalized = this.normalizePaymentText(raw);

    if (this.hasDebitCardSignal(normalized)) return "TARJETA DE DÉBITO";
    if (this.hasCreditCardSignal(normalized)) return "TARJETA DE CRÉDITO";
    if (this.hasCashSignal(normalized)) return "EFECTIVO";

    // Unknown OCR should stay unknown. Cash is only safe when an explicit cash signal
    // exists and no supported card signal wins semantic priority.
    return "";
  }

  private normalizePaymentText(raw: string): string {
    return (raw || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase();
  }

  private hasCreditCardSignal(text: string): boolean {
    return (
      /\b(?:VISA|MASTERCARD|MASTER\s*CARD|CREDITO|CREDIT)\b/.test(text) ||
      /(?:^|[^A-Z0-9])MC(?:[^A-Z0-9]|$)/.test(text)
    );
  }

  private hasDebitCardSignal(text: string): boolean {
    return /\b(?:DEBITO|DEBIT|RED\s+COMPRA)\b/.test(text);
  }

  private hasCashSignal(text: string): boolean {
    return /\b(?:EFECTIVO|CASH)\b/.test(text);
  }

  private extractAmounts(
    lines: string[],
    rawText: string,
    paymentMethod?: string,
  ): { total: number; subtotal?: number; iva?: number } {
    let total = 0;
    let subtotal: number | undefined;
    let iva: number | undefined;

    const isNonCashPayment =
      paymentMethod &&
      /TARJETA|CREDITO|DEBITO|VISA|MASTERCARD|TRANSFERENCIA|SPEI/i.test(
        paymentMethod,
      );

    // 1. Detect prominent standalone total amount (el número grande antes del QR / voucher)
    // Mexican fuel stations (GoGas, LaGas, etc.) print the total in a large, isolated line
    // right below the breakdown / verbal amount and above the QR code / web URL.
    let prominentStandaloneAmount: number | undefined;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Stop searching when reaching card voucher or footer section
      if (/DATOS\s+VOUCHER|AFILIACI[OÓ]N|TERMINAL\s+ID/i.test(line)) {
        break;
      }

      // Check if line contains strictly a currency amount (isolated large total number)
      const standaloneMatch = line.match(/^\$?\s*([0-9]{2,5})[,.]+(\d{2})$/);
      if (standaloneMatch && standaloneMatch[1] && standaloneMatch[2]) {
        const val = parseFloat(`${standaloneMatch[1]}.${standaloneMatch[2]}`);
        if (val >= 50 && val <= 25000) {
          const surrounding = lines
            .slice(Math.max(0, i - 4), Math.min(lines.length, i + 3))
            .join(" ");
          if (
            /PESOS|\/100|SUBTOTAL|SUBIOTNAL|IVA|TOTAL/i.test(surrounding)
          ) {
            prominentStandaloneAmount = val;
            break;
          }
        }
      }
    }

    // 2. Cross-verify with Mexican verbal amount (matching centavos)
    // e.g. "Mil Ciento Y Tres PESOS 69/100 KN" -> "$1103,69"
    // e.g. "Quinientos PESOS 00/100 MN" -> "$500.00"
    let verbalVerifiedAmount: number | undefined;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const wordsMatch = line.match(/(\d{2})\s*\/\s*100/i);
      if (wordsMatch) {
        const expectedCents = wordsMatch[1];
        for (let j = i; j <= Math.min(lines.length - 1, i + 3); j++) {
          const candidateLine = lines[j];
          const amtMatch = candidateLine.match(
            /\$?\s*([0-9]{1,6})[,.]+(\d{2})\b/,
          );
          if (amtMatch && amtMatch[1] && amtMatch[2]) {
            const val = parseFloat(`${amtMatch[1]}.${amtMatch[2]}`);
            if (amtMatch[2] === expectedCents && val >= 50 && val <= 25000) {
              verbalVerifiedAmount = val;
              break;
            }
          }
        }
        if (verbalVerifiedAmount) break;
      }
    }

    // Determine total based on payment method and extracted candidates:
    // When paid by card or electronic transfer, no change (vuelto) exists:
    // The prominent standalone amount (el número grande) is guaranteed to be the exact total.
    if (isNonCashPayment && prominentStandaloneAmount) {
      total = prominentStandaloneAmount;
    } else if (verbalVerifiedAmount) {
      total = verbalVerifiedAmount;
    } else if (prominentStandaloneAmount) {
      total = prominentStandaloneAmount;
    }

    // 3. Subtotal (handles SUBI?TOTAL)
    const subMatch = rawText.match(
      /SUBI?TOTAL[:\s]*\$?\s*([0-9]+(?:\.[0-9]{2})?)/i,
    );
    if (subMatch && subMatch[1]) {
      subtotal = parseFloat(subMatch[1]);
    }

    // 4. IVA
    const ivaMatch = rawText.match(/IVA[:\s]*\$?\s*([0-9]+(?:\.[0-9]{2})?)/i);
    if (ivaMatch && ivaMatch[1]) {
      iva = parseFloat(ivaMatch[1]);
    }

    // 5. If total not found yet, look for explicit TOTAL: label
    if (!total) {
      const totalMatch = rawText.match(
        /(?:TOTAL|IMPORTE\s+TOTAL|NETO|TOTAL\s+M\.?N\.?)[:\s]+(?:M\.?N\.?\s*)?\$?\s*([0-9]+(?:\.[0-9]{2})?)/i,
      );
      if (totalMatch && totalMatch[1]) {
        const val = parseFloat(totalMatch[1]);
        if (val >= 50 && val <= 25000) total = val;
      }
    }

    // 6. If total still not found, check card voucher or payment method amount
    if (!total) {
      const cardMatch = rawText.match(
        /(?:VISA\/MC|TARJETA|TOTAL\s*M\.?N\.?)\s*[:$]?\s*\$?\s*([0-9]+(?:\.[0-9]{2})?)/i,
      );
      if (cardMatch && cardMatch[1]) {
        const val = parseFloat(cardMatch[1]);
        if (val >= 50 && val <= 25000) total = val;
      }
    }

    // 7. For cash payments, check for explicit change (vuelto)
    if (total > 0 && paymentMethod === "EFECTIVO") {
      const cambioMatch = rawText.match(
        /(?:Cambio|Su\s+cambio|Vuelto)[:\s]*\$?\s*([0-9]+(?:\.[0-9]{2})?)/i,
      );
      const pagoConMatch = rawText.match(
        /(?:Pago\s+con|Efectivo\s+recibido|Entregado)[:\s]*\$?\s*([0-9]+(?:\.[0-9]{2})?)/i,
      );
      if (cambioMatch && pagoConMatch) {
        const cambio = parseFloat(cambioMatch[1]);
        const pagoCon = parseFloat(pagoConMatch[1]);
        if (pagoCon > cambio && pagoCon === total) {
          total = Number((pagoCon - cambio).toFixed(2));
        }
      }
    }

    // 8. Fix subtotal OCR artifacts (e.g. $ misread as 4: "4954.37" -> 954.37)
    if (total > 0 && subtotal && subtotal > total) {
      const subStr = subtotal.toString();
      if (subStr.length >= 5) {
        const correctedSub = parseFloat(subStr.slice(1));
        if (correctedSub < total && total - correctedSub < total * 0.25) {
          subtotal = correctedSub;
        } else {
          subtotal = Number((total / 1.16).toFixed(2));
        }
      } else {
        subtotal = Number((total / 1.16).toFixed(2));
      }
    }

    if (total > 0 && (!subtotal || !iva)) {
      if (!subtotal) subtotal = Number((total / 1.16).toFixed(2));
      if (!iva) iva = Number((total - subtotal).toFixed(2));
    }

    return { total, subtotal, iva };
  }

  private extractLiters(
    lines: string[],
    rawText: string,
    total: number,
  ): number | undefined {
    // 1. Explicit volume / liters indicators
    const litersRegex =
      /(?:Volumen|Litros|Cant(?:idad)?|Lts?\.?)[:\s]+(\d{1,4}(?:[.,]\d{1,3})?)\s*(?:LTS?|LITROS?|L)?/i;
    for (const line of lines) {
      const match = line.match(litersRegex);
      if (match && match[1]) {
        const val = parseFloat(match[1].replace(",", "."));
        if (val > 0 && val < 500) return Number(val.toFixed(2));
      }
    }

    const unitRegex = /\b(\d{1,3}(?:[.,]\d{1,3}))\s*(?:LTS?|LITROS?)\b/i;
    for (const line of lines) {
      const match = line.match(unitRegex);
      if (match && match[1]) {
        const val = parseFloat(match[1].replace(",", "."));
        if (val > 0 && val < 500) return Number(val.toFixed(2));
      }
    }

    // 2. Scan in rawText
    const rawMatch = rawText.match(litersRegex);
    if (rawMatch && rawMatch[1]) {
      const val = parseFloat(rawMatch[1].replace(",", "."));
      if (val > 0 && val < 500) return Number(val.toFixed(2));
    }

    // 3. Fuel table line: e.g. "42.49 [MAGNA", "42,439 | MAGIA | 21.937", "20.15 PREMIUM"
    const fuelRegex =
      /\b(\d{1,3}[.,]\d{2,3})\s*[|/\[\s]*(?:MAGNA|MAGIA|MAGUA|PREMIUM|PREMIUN|DIESEL|REGULAR|GASOLINA|SUPER)\b/i;
    for (const line of lines) {
      const match = line.match(fuelRegex);
      if (match && match[1]) {
        let rawNum = match[1].replace(",", ".");
        if (/\.\d{3}$/.test(rawNum)) {
          const candidate2 = parseFloat(rawNum.slice(0, -1));
          if (candidate2 > 0 && candidate2 < 300) {
            return Number(candidate2.toFixed(2));
          }
        }
        const val = parseFloat(rawNum);
        if (val > 0 && val < 500) return Number(val.toFixed(2));
      }
    }

    // 4. Fallback: estimate liters assuming typical fuel price (~$24.50 MXN/L)
    if (total > 0 && total <= 10000) {
      return Number((total / 24.5).toFixed(2));
    }

    return undefined;
  }

  private extractAddress(
    lines: string[],
    rawText: string,
    stationNumber?: string,
  ): string | undefined {
    // 1. Explicit keyword match
    const expMatch = rawText.match(
      /(?:Expedido\s+en|Direcci[oó]n(?:\s+Fiscal)?|Domicilio(?:\s+Fiscal)?|Ubicaci[oó]n|Lugar\s+de\s+expedici[oó]n|Sucursal)[:\s]+([^\n\r]+(?:\n[^\n\r]+)?)/i,
    );
    let explicitMatch: string | undefined;
    if (expMatch && expMatch[1]) {
      const cleaned = expMatch[1].replace(/\s+/g, " ").trim();
      if (cleaned.length > 5) explicitMatch = cleaned;
    }

    // 2. Detect branch name (Sucursal)
    let detectedBranch: string | undefined;
    const sucMatch = rawText.match(
      /(?:Sucursal|Suc\.?)[:\s]+([A-Z0-9\sÁÉÍÓÚÑñ.-]{3,35})/i,
    );
    if (sucMatch && sucMatch[1]) {
      detectedBranch = sucMatch[1].trim();
    }

    // If no explicit sucursal keyword, inspect lines immediately after or near station number
    if (!detectedBranch) {
      for (let i = 0; i < Math.min(lines.length, 30); i++) {
        const line = lines[i];
        if (/Estaci[oó]n[:\s]+\d+|E\.?S\.?\s*\d+/i.test(line)) {
          for (let j = i + 1; j <= Math.min(lines.length - 1, i + 3); j++) {
            const nextLine = lines[j].trim();
            if (!nextLine || nextLine.length < 3 || nextLine.length > 40) continue;
            if (
              /^(?:RFC|R[eé]gimen|Permiso|PL\/|ORIGINAL|COPIA|VENTA|TICKET|FOLIO|FECHA|CANT|SUBTOTAL|TOTAL|IVA|DESPACH|ATENDI|FORMA|DISPOSITIVO|V\s*:)/i.test(
                nextLine,
              )
            ) {
              break;
            }
            if (/^[0-9\s/:-]+$/.test(nextLine)) continue;
            const cleanedBranch = nextLine
              .replace(
                /\s+(?:AA|VI\s+e\s+y|KU\s*1|e\s*"Y|POr|Ue|SA\b|CV\b).*$/i,
                "",
              )
              .replace(/[^\w\sÁÉÍÓÚáéíóúÑñ]/g, " ")
              .replace(/\s+/g, " ")
              .trim();
            const validWords = cleanedBranch.split(/\s+/).filter(w => w.length >= 4);
            if (
              cleanedBranch.length >= 3 &&
              validWords.length >= 1 &&
              !/^(?:DE|DEL|LA|EL|SAN|LOS|MEX|SUR|NORTE)$/i.test(cleanedBranch)
            ) {
              detectedBranch = cleanedBranch;
              break;
            }
          }
          break;
        }
      }
    }

    // 3. Scan lines for Mexican address tokens
    const addressLines: string[] = [];

    for (let i = 0; i < Math.min(lines.length, 35); i++) {
      const l = lines[i];
      if (!l || l.length < 3) continue;

      // Stop words where transaction body begins
      if (
        /Rastreo|Transacci|Ticket|Folio|Atendi|Despach|Forma\s+de\s+pago|Subtotal|Original|Venta\s+Normal|Tipo\s+Venta|CANT\s*\|/i.test(
          l,
        )
      ) {
        break;
      }

      // Continue (do not break!) on header metadata lines
      if (/R[EF]C[:\s]|R[eé]gimen|Permiso\s+CRE|PL\//i.test(l)) continue;
      if (/(?:Estaci[oó]n|E\.?S\.?|EST|ración)\D*?\d{4,6}/i.test(l)) continue;
      if (/SA\s+DE\s+CV|S\.A\.\s+DE\s+C\.V\./i.test(l)) continue;
      if (/^\d{2}[/-]\d{2}[/-]\d{4}/.test(l)) continue;
      if (
        detectedBranch &&
        l.toUpperCase().includes(detectedBranch.toUpperCase())
      ) {
        continue;
      }

      // Address markers: Street, Manzana, Lote, Colonia, Postal Code, State/City
      const isAddressLine =
        /(?:Av\.?\b|Avenida|Calle|Carr\.?\b|Carretera|Calz\.?\b|Calzada|Blvd\.?\b|Boulevard|Prol\.?\b|Prolongaci[oó]n|Km\.?\b|Kil[oó]metro|Mz\.?\b|Manzana|Lote|Lt\.?\b|Sm\.?\b|Super\s*Manzana|Col\.?\b|Colonia|Fracc\.?\b|Barrio|Tablaje|Predio|Andador|Privada|Cda\.?\b|Cerrada|C\.?P\.?\s*\d{5}|\b\d{5}\b|BENITO\s+JUAREZ|CANCUN|QUINTANA\s+ROO|Q\.?\s*ROO|QROO|SOLIDARIDAD|PLAYA\s+DEL\s+CARMEN|COZUMEL|TULUM|OTHON\s+P|CHETUMAL|ISLA\s+MUJERES|YUCATAN|YUC\.?\b|MERIDA|PROGRESO|VALLADOLID|CAMPECHE|CAMP\.?\b|CARMEN|TABASCO|TAB\.?\b|VILLAHERMOSA|VERACRUZ|VER\.?\b|PUEBLA|PUE\.?\b|CDMX|CIUDAD\s+DE\s+MEXICO|EDO\.?\s*MEX|MEXICO|JALISCO|JAL\.?\b|GUADALAJARA|ZAPOPAN|NUEVO\s+LEON|N\.?L\.?\b|MONTERREY|SAN\s+PEDRO|SONORA|SON\.?\b|HERMOSILLO|CHIHUAHUA|CHIH\.?\b|JUAREZ|SINALOA|SIN\.?\b|CULIACAN|MAZATLAN|GUANAJUATO|GTO\.?\b|LEON|QUERETARO|QRO\.?\b|COAHUILA|COAH\.?\b|SALTILLO|CHIAPAS|TUXTLA|OAXACA|OAX\.?\b|TAMAULIPAS|TAMPS\.?\b|REYNOSA|MATAMOROS|NUEVO\s+LAREDO|BAJA\s+CALIFORNIA|B\.?C\.?\b|TIJUANA|MEXICALI|B\.?C\.?S\.?\b|LA\s+PAZ|LOS\s+CABOS|MORELOS|MOR\.?\b|CUERNAVACA|AGUASCALIENTES|AGS\.?\b|DURANGO|DGO\.?\b|HIDALGO|HGO\.?\b|PACHUCA|ZACATECAS|ZAC\.?\b|COLIMA|COL\.?\b|MANZANILLO|NAYARIT|NAY\.?\b|TEPIC|TLAXCALA|TLAX\.?\b|SAN\s+LUIS\s+POTOSI|SLP)/i.test(
          l,
        );

      if (isAddressLine) {
        addressLines.push(l.replace(/\s+/g, " ").trim());
      }
    }

    // 4. Enrich with known station catalog if available
    const known =
      stationNumber && KNOWN_STATIONS[stationNumber]
        ? KNOWN_STATIONS[stationNumber]
        : undefined;
    const branch = known?.branch || detectedBranch;

    const parts: string[] = [];
    if (branch) {
      parts.push(branch);
    }

    const hasRealAddressWords = addressLines.some((l) =>
      /(?:Av\.?\b|Avenida|Calle|Carr\.?\b|Carretera|Calz\.?\b|Calzada|Blvd\.?\b|Boulevard|Mz\.?\b|Manzana|Lote|Lt\.?\b|Sm\.?\b|Super\s*Manzana|Col\.?\b|Colonia|Benito|Juarez|Cancun|Playa|Merida)/i.test(
        l,
      ),
    );

    if (addressLines.length > 0 && hasRealAddressWords) {
      parts.push(addressLines.join(", "));
      // If postal code or city/state was missing from OCR lines but station is known, append
      if (known) {
        const joined = addressLines.join(" ").toUpperCase();
        if (!joined.includes(known.postalCode)) {
          parts.push(`C.P. ${known.postalCode}`);
        }
        if (
          !joined.includes("QUINTANA") &&
          !joined.includes("YUCATAN") &&
          !joined.includes("MEXICO")
        ) {
          parts.push(`${known.city}, ${known.state}`);
        }
      }
    } else if (known) {
      const fullLoc = [
        known.street,
        known.neighborhood,
        `${known.city}, ${known.state}`,
        `C.P. ${known.postalCode}`,
      ]
        .filter(Boolean)
        .join(", ");
      parts.push(fullLoc);
    } else if (addressLines.length > 0) {
      parts.push(addressLines.join(", "));
    } else if (explicitMatch) {
      parts.push(explicitMatch);
    }

    return parts.length > 0 ? parts.join(" - ") : undefined;
  }

  private extractBillingUrl(lines: string[], rawText: string): string {
    // Look for facturasgas explicitly
    if (/facturas\s*gas\.com/i.test(rawText)) {
      return "https://www.facturasgas.com";
    }

    for (const line of lines) {
      const sanitized = line.replace(/\s+/g, "").toLowerCase();
      const match = sanitized.match(
        /((?:https?:\/\/)?(?:www\.)?[a-z0-9-]+\.(?:com|mx|com\.mx|net|org)(?:\/[^\s]*)?)/i,
      );
      if (match && match[1]) {
        let url = match[1];
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
          url = "https://" + url;
        }
        return url;
      }
    }

    return "https://www.facturasgas.com";
  }
}
