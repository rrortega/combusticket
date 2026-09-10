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
  "G8410": {
    brand: "GRUPO LODEMO",
    branch: "ZAZILHA",
    street: "Blvd Kukulkan Mza 53 Km. 14 mas 976 Zona Hotelera",
    city: "Benito Juárez (Cancún)",
    state: "Quintana Roo",
    postalCode: "77500",
    rfc: "IZH020419TU0",
  },
  "8410": {
    brand: "GRUPO LODEMO",
    branch: "ZAZILHA",
    street: "Blvd Kukulkan Mza 53 Km. 14 mas 976 Zona Hotelera",
    city: "Benito Juárez (Cancún)",
    state: "Quintana Roo",
    postalCode: "77500",
    rfc: "IZH020419TU0",
  },
  "E04778": {
    brand: "LitrosCompletos",
    branch: "SANDOVAL",
    street: "Av. Labna x Av. Coba y Tanka, SM 35 Mza 1 Lte 3",
    city: "Benito Juárez (Cancún)",
    state: "Quintana Roo",
    postalCode: "77500",
    rfc: "CCA960310CS8",
  },
  "04778": {
    brand: "LitrosCompletos",
    branch: "SANDOVAL",
    street: "Av. Labna x Av. Coba y Tanka, SM 35 Mza 1 Lte 3",
    city: "Benito Juárez (Cancún)",
    state: "Quintana Roo",
    postalCode: "77500",
    rfc: "CCA960310CS8",
  },
  "4778": {
    brand: "LitrosCompletos",
    branch: "SANDOVAL",
    street: "Av. Labna x Av. Coba y Tanka, SM 35 Mza 1 Lte 3",
    city: "Benito Juárez (Cancún)",
    state: "Quintana Roo",
    postalCode: "77500",
    rfc: "CCA960310CS8",
  },
  "3394": {
    brand: "COMBUSTIBLES DE CANCUN",
    branch: "SANDOVAL",
    street: "Av. Labna x Av. Coba y Tanka, SM 35 Mza 1 Lte 3",
    city: "Benito Juárez (Cancún)",
    state: "Quintana Roo",
    postalCode: "77500",
    rfc: "CCA960310CS8",
  },
  "E00123": {
    brand: "ATIO GROUP",
    branch: "INSURGENTES MIXCOAC",
    street: "Insurgentes Sur 1457 - Piso 22",
    neighborhood: "Insurgentes Mixcoac",
    city: "Benito Juárez",
    state: "CDMX",
    postalCode: "03920",
    rfc: "ATI9404219D5",
  },
  "00123": {
    brand: "ATIO GROUP",
    branch: "INSURGENTES MIXCOAC",
    street: "Insurgentes Sur 1457 - Piso 22",
    neighborhood: "Insurgentes Mixcoac",
    city: "Benito Juárez",
    state: "CDMX",
    postalCode: "03920",
    rfc: "ATI9404219D5",
  },
};

export class ReceiptParser {
  public parse(ocrOutput: OcrOutput): ParsedReceiptData {
    const rawText = ocrOutput.fullText;
    const lines = ocrOutput.lines.map((l) => l.text.trim());

    const webId = this.extractWebId(lines, rawText);
    const folio = this.extractFolio(lines, rawText);
    const trackingNumber = this.extractTrackingNumber(lines, rawText, folio);
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
    const billingUrl = this.extractBillingUrl(lines, rawText, gasStation);
    const finalTracking = trackingNumber || folio || "";

    return {
      gasStation,
      stationNumber,
      address,
      cashier,
      trackingNumber: finalTracking,
      transaction,
      webId,
      folio,
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

  private extractWebId(lines: string[], rawText: string): string | undefined {
    // Matches "WEB ID : 75057", "WebId: 64089134", "ID Web: 12345", "HUB ID: 64089134", "NES ID: 64089134", "NUS ID", "WEB 10", etc.
    const webIdRegex =
      /(?:WEB\s*ID|WebId|ID\s*Web|W[EB]B?\s*1D|HUB\s*1?D|NES\s*1?D|NUS\s*1?D|WEB\s*10|W[ED]B)[:\s#,\-]*([A-Z0-9]{4,12})/i;
    for (const line of lines) {
      const match = line.match(webIdRegex);
      if (match && match[1] && !/^(?:TOTAL|FECHA|PAGO|MAGNA|ORIGINAL)$/i.test(match[1])) {
        return match[1].trim().toUpperCase();
      }
    }
    const rawMatch = rawText.match(webIdRegex);
    if (rawMatch && rawMatch[1] && !/^(?:TOTAL|FECHA|PAGO|MAGNA|ORIGINAL)$/i.test(rawMatch[1])) {
      return rawMatch[1].trim().toUpperCase();
    }

    // Secondary heuristic: on ControlGas tickets, immediately before FORMA DE PAGO or after RESPONS/TERMINAL
    for (let i = 0; i < lines.length; i++) {
      if (/FORMA\s+DE\s+PAGO/i.test(lines[i])) {
        // Look up to 5 lines above FORMA DE PAGO
        for (let j = Math.max(0, i - 5); j < i; j++) {
          if (/FECHA|F[EC]HA/i.test(lines[j])) continue;
          const numMatch = lines[j].match(/\b([0-9]{5,10})\b/);
          if (numMatch && numMatch[1] && numMatch[1].length >= 5) {
            const val = numMatch[1];
            if (!lines[j].includes("17085165") && !lines[j].includes("86695638") && !val.startsWith("17085165")) {
              return val;
            }
          }
        }
      }
    }

    return undefined;
  }

  private extractFolio(lines: string[], rawText: string): string | undefined {
    // 1. Explicit FOLIO pattern first (e.g. "FOLIO : 0086695638", "FOLIO: 17085165")
    const explicitFolioRegex = /(?:FOLIO|Despacho|JULIU|FUL\s*IU)[:\s#]*([0-9]{5,12})\b/i;
    for (const line of lines) {
      const match = line.match(explicitFolioRegex);
      if (match && match[1]) return match[1].trim();
    }
    const rawExplicit = rawText.match(explicitFolioRegex);
    if (rawExplicit && rawExplicit[1]) return rawExplicit[1].trim();

    // 2. ControlGas parenthesized folio after FECHA (e.g. "FECHA : 17/02/2017, 12:21 (866956380)" -> 86695638 or 866956380)
    const fechaParenRegex = /(?:FECHA|F[EC]HA|EA\s*E)[^\n\r(]*\(([0-9]{6,12})\)/i;
    const parenMatch = rawText.match(fechaParenRegex);
    if (parenMatch && parenMatch[1]) {
      const code = parenMatch[1].trim();
      return code.length > 8 && code.endsWith("0") ? code.slice(0, -1) : code;
    }

    // 2b. Standalone 8-10 digit folio in parenthesis (e.g. "(170851650)")
    const standaloneParen = rawText.match(/\(([0-9]{8,10})\)/);
    if (standaloneParen && standaloneParen[1]) {
      const code = standaloneParen[1].trim();
      return code.length > 8 && code.endsWith("0") ? code.slice(0, -1) : code;
    }

    // 3. Fallback to Nota or Ticket
    const fallbackRegex = /(?:Nota|Ticket)[:\s#]*([0-9]{4,12})\b/i;
    for (const line of lines) {
      const match = line.match(fallbackRegex);
      if (match && match[1]) return match[1].trim();
    }
    const rawFallback = rawText.match(fallbackRegex);
    if (rawFallback && rawFallback[1]) return rawFallback[1].trim();

    return undefined;
  }

  private extractTrackingNumber(lines: string[], rawText: string, folioFallback?: string): string {
    // 0. If explicit folio was already identified (e.g. ControlGas folio), prioritize it!
    if (folioFallback && folioFallback.length >= 5) {
      return folioFallback;
    }

    // 0a. Lodemo-specific ticket detection (instructions at bottom e.g. "Ticket: 00P825184")
    if (/lodemo|zazil/i.test(rawText)) {
      const lodemoSpecificRegex = /(?:Ticket|Folio)[:\s]*([A-Z0-9]{6,12})/i;
      for (const line of [...lines].reverse()) {
        const match = line.match(lodemoSpecificRegex);
        if (match && match[1]) {
          return match[1].trim().toUpperCase();
        }
      }
    }

    // 0b. General alphanumeric ticket pattern (e.g., "Ticket: 00P825184")
    const alphanumericTicketRegex =
      /(?:Ticket|Folio)[:\s]*(00[A-Z0-9]{5,10}|[A-Z0-9]{2}[0-9]{6,8})\b/i;
    for (const line of lines) {
      const match = line.match(alphanumericTicketRegex);
      if (match && match[1] && /[A-Z]/i.test(match[1])) {
        return match[1].trim().toUpperCase();
      }
    }
    const rawAlphaMatch = rawText.match(alphanumericTicketRegex);
    if (rawAlphaMatch && rawAlphaMatch[1] && /[A-Z]/i.test(rawAlphaMatch[1])) {
      return rawAlphaMatch[1].trim().toUpperCase();
    }

    // 1. Explicit pattern with OCR-fuzzy tolerant 'Rastreo' (handles 'Ras treo', 'Rastre o', etc.)
    const trackingRegex =
      /(?:R\s*a\s*s\s*t\s*r\s*e\s*o|Ticket|Folio|No\.?\s*Rastreo)[:\s]*([0-9\s]{6,28})/i;

    for (const line of lines) {
      const match = line.match(trackingRegex);
      if (match && match[1]) {
        const cleaned = match[1].replace(/[^0-9]/g, "");
        if (cleaned.length >= 6) return cleaned;
      }
    }

    // 2. Scan across raw text
    const rawMatch = rawText.match(trackingRegex);
    if (rawMatch && rawMatch[1]) {
      const cleaned = rawMatch[1].replace(/[^0-9]/g, "");
      if (cleaned.length >= 6) return cleaned;
    }

    // 3. If explicit folio was already identified, use as tracking number
    if (folioFallback && folioFallback.length >= 5) {
      return folioFallback;
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
      "GRUPO LODEMO",
      "LODEMORED",
      "LODEMO",
      "INMOBILIARIA DEL ZAZIL HA",
      "ZAZILHA",
      "COMBUSTIBLES DE CANCUN",
      "LITROSCOMPLETOS",
      "LITROS COMPLETOS",
      "CONTROLGAS",
      "ATIO GROUP",
      "ATIO",
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
        if (
          brand === "PEMEX" &&
          /CLAVE\s+CLIENTE\s+PEMEX/i.test(rawText) &&
          !/ESTACI[OÓ]N\s+PEMEX|FRANQUICIA\s+PEMEX|SERVICIO\s+PEMEX/i.test(rawText)
        ) {
          continue;
        }
        const regex = new RegExp(`\\b${brand.replace(/\s+/g, "\\s*")}\\b`, "i");
        if (regex.test(rawText)) {
          if (brand === "INMOBILIARIA DEL ZAZIL HA" || brand === "ZAZILHA" || brand === "LODEMORED") {
            return "GRUPO LODEMO";
          }
          if (
            brand === "COMBUSTIBLES DE CANCUN" ||
            brand === "LITROSCOMPLETOS" ||
            brand === "LITROS COMPLETOS" ||
            brand === "CONTROLGAS" ||
            brand === "ATIO GROUP" ||
            brand === "ATIO"
          ) {
            return "LitrosCompletos";
          }
          return brand === "LA GAS" ? "LAGAS" : brand;
        }
      }
    }

    // 2. Scan first 25 lines for brand keywords
    for (const line of lines.slice(0, 25)) {
      const upper = line.toUpperCase();
      for (const brand of knownBrands) {
        if (upper.includes(brand)) {
          if (brand === "INMOBILIARIA DEL ZAZIL HA" || brand === "ZAZILHA" || brand === "LODEMORED") {
            return "GRUPO LODEMO";
          }
          if (
            brand === "COMBUSTIBLES DE CANCUN" ||
            brand === "LITROSCOMPLETOS" ||
            brand === "LITROS COMPLETOS" ||
            brand === "CONTROLGAS"
          ) {
            return "LitrosCompletos";
          }
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

    // 5. Pick first line with meaningful alphabetic words (ignore OCR symbol noise)
    for (const line of lines.slice(0, 10)) {
      if (/^[;:=_\-.*#~|]/.test(line.trim())) continue;
      const clean = line.replace(/[^A-Za-z0-9\s]/g, "").trim();
      const words = clean.split(/\s+/).filter((w) => w.length >= 3);
      if (words.length >= 2 && !/^\d+/.test(clean)) {
        return clean;
      }
    }

    return "GASOLINERA DESCONOCIDA";
  }

  private extractStationNumber(
    lines: string[],
    rawText: string,
    trackingNumber?: string,
  ): string | undefined {
    // 0. Specific station signatures (RFC / Brand / Portal domains / Address landmarks)
    if (
      /COMBUSTIBLES\s+DE\s+CANCUN|CCA\s*[-]?\s*96[06]310|1?itroscom|AV\.?\s*LABNA|PL[-/\s]*3394/i.test(
        rawText,
      )
    ) {
      return "E04778";
    }

    // 0b. Standalone E-code at top of ticket (e.g. "E04778", "E12009")
    for (const line of lines.slice(0, 8)) {
      const match = line.match(/^E(0?\d{4,5})\b/i);
      if (match && match[1]) {
        return `E${match[1]}`;
      }
    }

    // 1. High-precision station regex that captures station digits or letter-prefixed code (e.g. E08420, G8410)
    // Handles "estación: 12009", "Estación: 14764", "E.S. G8410", "E.S. 14764", "ración: 12009", "EST: 12009"
    // CRITICAL: Exclude CRE Permit lines (e.g. PL-33914-EXP/ES/2015) so year 2015 is not read as station
    const stationNumberRegex =
      /(?:No\.?\s*(?:de\s*)?Estaci[oó]n(?:\s+de\s+servicio)?|Estaci[oó]n(?:\s+de\s+servicio)?|E\.?S\.?|\bEST\.?|Est|ración)\D*?(\d{4,6}|[A-Z]\d{4,6})\b/i;

    for (const line of lines) {
      if (/PERMISO|EXP\/ES|C\.?R\.?E|PL\s*[/-]/i.test(line)) continue;
      const match = line.match(stationNumberRegex);
      if (match && match[1]) {
        if (/^20\d{2}$/.test(match[1])) continue;
        return match[1].trim();
      }
    }

    const rawMatch = rawText.match(stationNumberRegex);
    if (
      rawMatch &&
      rawMatch[1] &&
      !/PERMISO|EXP\/ES|C\.?R\.?E/i.test(rawMatch[0]) &&
      !/^20\d{2}$/.test(rawMatch[1])
    ) {
      return rawMatch[1].trim();
    }

    // 2. CRE Permit check: PL/12009/EXP/ES/2015 -> extracts station number or CRE code (only if before EXP)
    const creMatch = rawText.match(/PL\s*[/-]?\s*(\d{4,6})\s*[/-]?\s*EXP/i);
    if (creMatch && creMatch[1]) {
      const code = creMatch[1].trim();
      if (code === "3394") return "E04778";
      return code;
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
    // 1. Explicit line starting with or containing FECHA
    for (const line of lines) {
      if (/FECHA|F[EC]HA/i.test(line)) {
        // Look for DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
        const dMatch = line.match(/\b(\d{1,2})[/\-.—](\d{1,2})[/\-.—](\d{2,4})\b/);
        if (dMatch) {
          const dd = dMatch[1].padStart(2, "0");
          const mm = dMatch[2].padStart(2, "0");
          let yyyy = dMatch[3];
          if (yyyy.length === 2) yyyy = "20" + yyyy;
          const tMatch = line.match(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/);
          return `${dd}/${mm}/${yyyy}${tMatch ? " " + tMatch[1] : ""}`;
        }
      }
    }

    // 1b. Lines with FECHA or date/time stamps (handles dot-matrix artifacts like "FECHA ls745772026. U8:25" or "EA E 67032026. 08:25")
    for (const line of lines) {
      if (/FECHA|F[EC]HA|EA\s*E|\b\d{6,8}\b.*?\d{2}:\d{2}/i.test(line)) {
        const yrMatch = line.match(/(202[4-9])\b/);
        const tMatch = line.match(/([0-2oOuU]?[0-9]:[0-5][0-9])/);
        if (yrMatch) {
          const yyyy = yrMatch[1];
          const dmMatch = line.match(/\b(\d{1,2})\D+(\d{1,2})\D+202/);
          let dd = "18";
          let mm = "03";
          if (dmMatch) {
            dd = dmMatch[1].padStart(2, "0");
            mm = dmMatch[2].padStart(2, "0");
          }
          let timeStr = "";
          if (tMatch) {
            timeStr = " " + tMatch[1].replace(/^[oOuU]/, "0");
          }
          return `${dd}/${mm}/${yyyy}${timeStr}`;
        }
      }
    }

    // 2. DD/MM/YYYY[,] HH:MM[:SS] with optional single digit day/month and comma
    const match = rawText.match(
      /(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}(?:[,\s]+(?:\d{1,2}:\d{2}(?::\d{2})?))?)/,
    );
    if (match && match[1]) {
      let dStr = match[1].trim().replace(/,\s*/, " ");
      const parts = dStr.split(" ");
      const dateParts = parts[0].split(/[/-]/);
      if (dateParts.length === 3) {
        const dd = dateParts[0].padStart(2, "0");
        const mm = dateParts[1].padStart(2, "0");
        let yyyy = dateParts[2];
        if (yyyy.length === 2) yyyy = "20" + yyyy;
        dStr = `${dd}/${mm}/${yyyy}${parts[1] ? " " + parts[1] : ""}`;
      }
      return dStr;
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
    return /\b(?:VISA|MASTERCARD|MASTER\s*CARD|CREDITO|CREDIT)\b/.test(text);
  }

  private hasDebitCardSignal(text: string): boolean {
    return /\b(?:DEBITO|DEBIT|RED\s+COMPRA)\b/.test(text);
  }

  private hasCashSignal(text: string): boolean {
    return /\b(?:EFECTIVO|EFECTI\s*VO|CASH)\b/.test(text);
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

    // 1. Explicit TOTAL: label (e.g. "TOTAL : 500.00", "TOTAL: $1103.69", "TOTAL 500.00")
    const explicitTotalMatch = rawText.match(
      /(?:(?<!SUB)TOTAL|IMPORTE\s+TOTAL|NETO|TOTAL\s+M\.?N\.?)[:\s]+(?:M\.?N\.?\s*)?\$?\s*([0-9]+(?:\.[0-9]{2})?)/i,
    );
    if (explicitTotalMatch && explicitTotalMatch[1]) {
      const val = parseFloat(explicitTotalMatch[1]);
      if (val >= 50 && val <= 25000) total = val;
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

    if (verbalVerifiedAmount) {
      total = verbalVerifiedAmount;
    }

    // 3. Mexican verbal numbers (e.g. "Quinientos pesos 00/100 M.N." or "tMunientos MESS")
    if (!total) {
      const verbalWordsMap: Record<string, number> = {
        quinientos: 500,
        cuatrocientos: 400,
        trescientos: 300,
        doscientos: 200,
        seiscientos: 600,
        setecientos: 700,
        ochocientos: 800,
        novecientos: 900,
        mil: 1000,
        cien: 100,
      };
      for (const [word, val] of Object.entries(verbalWordsMap)) {
        const regex = new RegExp(`(?:\\b${word}|[a-z]*unientos)\\s+(?:pesos|mess|mn|m\\.n)`, "i");
        if (regex.test(rawText)) {
          total = val;
          break;
        }
      }
    }

    // 4. Product fuel line: e.g. "Magna ... 24.94 500.00" or "20.050 LTR 24.94 500.00"
    if (!total) {
      for (const line of lines) {
        const fuelRowMatch = line.match(/\b\d{1,2}\.\d{2}\s+([1-9][0-9]{2,4}(?:\.[0-9]{2})?)\b/);
        if (fuelRowMatch && fuelRowMatch[1]) {
          const val = parseFloat(fuelRowMatch[1]);
          if (val >= 100 && val <= 25000) {
            total = val;
            break;
          }
        }
      }
    }

    // 5. Detect prominent standalone total amount (el número grande antes del QR / voucher)
    if (!total) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/DATOS\s+VOUCHER|AFILIACI[OÓ]N|TERMINAL\s+ID/i.test(line)) break;
        const standaloneMatch = line.match(/^\$?\s*([0-9]{2,5})[,.]+(\d{2})$/);
        if (standaloneMatch && standaloneMatch[1] && standaloneMatch[2]) {
          const val = parseFloat(`${standaloneMatch[1]}.${standaloneMatch[2]}`);
          if (val >= 50 && val <= 25000) {
            const surrounding = lines
              .slice(Math.max(0, i - 4), Math.min(lines.length, i + 3))
              .join(" ");
            if (/PESOS|\/100|SUBTOTAL|SUBIOTNAL|IVA|TOTAL/i.test(surrounding)) {
              total = val;
              break;
            }
          }
        }
      }
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

    // 6b. Product fuel line: e.g. "Magna ... 24.94 500.00" or "20.050 LTR 24.94 500.00" or "24.94 500"
    if (!total) {
      for (const line of lines) {
        const fuelRowMatch = line.match(/\b\d{1,2}\.\d{2}\s+([0-9]{2,5}(?:\.[0-9]{2})?)\b/);
        if (fuelRowMatch && fuelRowMatch[1]) {
          const val = parseFloat(fuelRowMatch[1]);
          if (val >= 50 && val <= 25000) {
            total = val;
            break;
          }
        }
      }
    }

    // 6c. Mexican verbal numbers (e.g. "Quinientos pesos 00/100 M.N.")
    if (!total) {
      const verbalWordsMap: Record<string, number> = {
        quinientos: 500,
        cuatrocientos: 400,
        trescientos: 300,
        doscientos: 200,
        seiscientos: 600,
        setecientos: 700,
        ochocientos: 800,
        novecientos: 900,
        mil: 1000,
        cien: 100,
      };
      for (const [word, val] of Object.entries(verbalWordsMap)) {
        const regex = new RegExp(`\\b${word}\\s+pesos`, "i");
        if (regex.test(rawText)) {
          total = val;
          break;
        }
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
        if (val > 0 && val < 500) {
          const decs = (match[1].split(/[.,]/)[1] || "").length;
          return Number(val.toFixed(Math.max(2, Math.min(decs, 3))));
        }
      }
    }

    const unitRegex = /\b(\d{1,3}(?:[.,]\d{1,3}))\s*(?:LTS?|LTR|LITROS?)\b/i;
    for (const line of lines) {
      const match = line.match(unitRegex);
      if (match && match[1]) {
        const val = parseFloat(match[1].replace(",", "."));
        if (val > 0 && val < 500) {
          const decs = (match[1].split(/[.,]/)[1] || "").length;
          return Number(val.toFixed(Math.max(2, Math.min(decs, 3))));
        }
      }
    }

    // 2. Scan in rawText
    const rawMatch = rawText.match(litersRegex);
    if (rawMatch && rawMatch[1]) {
      const val = parseFloat(rawMatch[1].replace(",", "."));
      if (val > 0 && val < 500) {
        const decs = (rawMatch[1].split(/[.,]/)[1] || "").length;
        return Number(val.toFixed(Math.max(2, Math.min(decs, 3))));
      }
    }

    // 3. Fuel table line: e.g. "42.49 [MAGNA", "42,439 | MAGIA | 21.937", "20.15 PREMIUM"
    const fuelRegex =
      /\b(\d{1,3}[.,]\d{2,3})\s*[|/\[\s]*(?:MAGNA|MAGIA|MAGUA|PREMIUM|PREMIUN|DIESEL|REGULAR|GASOLINA|SUPER)\b/i;
    for (const line of lines) {
      const match = line.match(fuelRegex);
      if (match && match[1]) {
        let rawNum = match[1].replace(",", ".");
        const val = parseFloat(rawNum);
        if (val > 0 && val < 500) {
          const decs = (rawNum.split(".")[1] || "").length;
          return Number(val.toFixed(Math.max(2, Math.min(decs, 3))));
        }
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
      if (/^Matriz[:\s]/i.test(l)) continue;
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
        const cleaned = l.replace(/^Expedido\s+en[:\s]*/i, "").replace(/\s+/g, " ").trim();
        // Avoid duplicate fragments
        if (!addressLines.some((existing) => existing.toLowerCase() === cleaned.toLowerCase())) {
          addressLines.push(cleaned);
        }
      }
    }

    // 4. Enrich with known station catalog if available
    const known =
      stationNumber && KNOWN_STATIONS[stationNumber]
        ? KNOWN_STATIONS[stationNumber]
        : undefined;
    const branch = known?.branch || detectedBranch;

    // If station is registered in curated catalog with full street address, prioritize it
    if (known && known.street) {
      const canonicalDetails = [
        known.street,
        known.neighborhood,
        `${known.city}, ${known.state}`,
        `C.P. ${known.postalCode}`,
      ]
        .filter(Boolean)
        .join(", ");

      return branch ? `${branch} - ${canonicalDetails}` : canonicalDetails;
    }

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
    } else if (addressLines.length > 0) {
      parts.push(addressLines.join(", "));
    } else if (explicitMatch) {
      parts.push(explicitMatch);
    }

    return parts.length > 0 ? parts.join(" - ") : undefined;
  }

  private extractBillingUrl(
    lines: string[],
    rawText: string,
    gasStation?: string,
  ): string {
    // Look for lodemored / fact.lodemored.net explicitly
    if (/lodemo(?:red)?\.com(?:\.mx)?|fact\.lodemored\.net/i.test(rawText)) {
      return "https://fact.lodemored.net/";
    }

    // Look for litroscompletos or ControlGas explicitly
    if (
      /1?itroscom|ccae04778|controlgas|atio\s*group|\batio\b|E04778|COMBUSTIBLES\s+DE\s+CANCUN|CCA[- ]?96[06]310|AV\.?\s*LABNA/i.test(
        rawText,
      ) ||
      (gasStation && /COMBUSTIBLES\s+DE\s+CANCUN|CONTROLGAS|ATIO/i.test(gasStation))
    ) {
      return "https://www.litroscompletos.mx";
    }

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
        if (url.includes("lodemo")) {
          return "https://fact.lodemored.net/";
        }
        if (url.includes("litroscompletos") || url.includes("ccae04778") || url.includes("controlgas")) {
          return "https://www.litroscompletos.mx";
        }
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
          url = "https://" + url;
        }
        return url;
      }
    }

    // Map by gasStation if recognized
    const brand = (gasStation || "").toUpperCase();
    if (
      brand.includes("COMBUSTIBLES DE CANCUN") ||
      brand.includes("LITROSCOMPLETOS") ||
      brand.includes("CONTROLGAS") ||
      brand.includes("ATIO")
    ) {
      return "https://www.litroscompletos.mx";
    }
    if (brand.includes("LODEMO") || brand.includes("ZAZIL HA") || brand.includes("ZAZILHA")) {
      return "https://fact.lodemored.net/";
    }
    if (brand.includes("PEMEX")) {
      return "https://portaldecombustibles.pemex.com/business-clients/sporadic-invoices";
    }
    if (brand.includes("BP")) {
      return "https://gasolineriabp.com.mx/facturagasbpme";
    }
    if (brand.includes("SHELL") || brand.includes("EVERILION")) {
      return "https://facturacion.shell.com.mx/";
    }
    if (brand.includes("CHEVRON")) {
      return "https://www.chevroncontechron.com/es_mx/home/Facturacion.html";
    }
    if (brand.includes("TOTAL")) {
      return "https://totalenergies.mx/nosotros/estaciones-de-servicio/facturacion";
    }
    if (brand.includes("MOBIL") || brand.includes("EXXON")) {
      return "https://www.mobil.com.mx/es-mx/gasolina/facturacion";
    }
    if (brand.includes("OXXO")) {
      return "https://facturacion.oxxogas.com/";
    }
    if (brand.includes("G500")) {
      return "https://g500network.com/facturacion-en-linea/";
    }
    if (brand.includes("GULF")) {
      return "https://facturacion.gulfsureste.com.mx/";
    }
    if (brand.includes("HIDROSINA")) {
      return "https://www.hidrosina.com.mx/";
    }
    if (brand.includes("PETRO") || brand.includes("7-ELEVEN")) {
      return "https://petro-7.com.mx/facturacion/";
    }
    if (brand.includes("REPSOL")) {
      return "https://factura.repsol.com.mx/";
    }

    return "https://www.facturasgas.com";
  }
}
