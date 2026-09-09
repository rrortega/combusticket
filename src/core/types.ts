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
  address?: string;
  cashier?: string;
  trackingNumber: string;
  transaction?: string;
  date: string;
  paymentMethod: string;
  amount: number;
  liters?: number;
  subtotal?: number;
  iva?: number;
  billingUrl: string;
  rawText: string;
  receiptImageUrl?: string;
  receiptJsonUrl?: string;
  receiptBaseName?: string;
  imageFileName?: string;
  fileHash?: string;
  previewUrl?: string;
}

export interface ReceiptTransactionRecord {
  id: string; // e.g. receipt_1788899016033_0
  fileHash: string; // SHA-256
  originalFilename: string;
  imageFileName: string;
  imageUrl: string;
  jsonFileName: string;
  jsonUrl: string;
  rfc: string;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
  completedAt?: string;
  status: "scanned" | "enqueued" | "dry_run" | "completed" | "failed";
  jobId?: string;
  ticket: {
    trackingNumber: string;
    stationNumber?: string;
    address?: string;
    cashier?: string;
    gasStation: string;
    transaction?: string;
    date: string;
    paymentMethod: string;
    amount: number;
    liters?: number;
    subtotal?: number;
    iva?: number;
    billingUrl: string;
  };
  invoiceResult?: {
    submitted: boolean;
    pdfUrl?: string;
    screenshotUrl?: string;
    videoUrl?: string;
    message?: string;
  };
  rawOcr?: {
    fullText: string;
    lines?: RecognizedLine[];
  };
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
  takeScreenshot?: boolean;
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
  screenshotUrl?: string;
  videoPath?: string;
  videoUrl?: string;
  pdfPath?: string;
  pdfUrl?: string;
  xmlPath?: string;
  xmlUrl?: string;
  message: string;
  extraData?: Record<string, unknown>;
}

export interface PortalDescriptor {
  id: string;
  name: string;
  supportedDomains: string[];
  supportedBrands: string[];
}
