export interface RecognizedLine {
  text: string;
  confidence: number;
}

export interface OcrOutput {
  success: boolean;
  lines: RecognizedLine[];
  fullText: string;
  error?: string;
}

export interface ParsedReceiptData {
  gasStation: string;
  stationNumber?: string;
  trackingNumber: string;
  transaction?: string;
  date: string;
  paymentMethod: string;
  amount: number;
  subtotal?: number;
  iva?: number;
  billingUrl: string;
  rawText: string;
  receiptImageUrl?: string;
  previewUrl?: string;
}

export interface BillingProfile {
  rfc: string;
  razonSocial: string;
  email: string;
  emailConfirm: string;
  codigoPostal: string;
  regimenFiscal: string;
  formaPago: string;
  usoCfdi: string;
  alias?: string;
}

export interface AutomationOptions {
  dryRun?: boolean;
  cdpPort?: number;
  screenshotDir?: string;
  recordVideo?: boolean;
  videoDir?: string;
  timeoutMs?: number;
}

export interface InvoiceResult {
  success: boolean;
  portalId: string;
  receipt: ParsedReceiptData;
  billingProfile: BillingProfile;
  formFilled: boolean;
  submitted: boolean;
  screenshotPath?: string;
  videoPath?: string;
  pdfPath?: string;
  message: string;
  extraData?: Record<string, any>;
}

export interface PortalDescriptor {
  id: string;
  name: string;
  supportedDomains: string[];
  supportedBrands: string[];
}
