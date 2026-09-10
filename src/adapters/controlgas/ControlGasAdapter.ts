import { Page } from "playwright-core";
import path from "path";
import fs from "fs";
import sharp from "sharp";
import { createWorker } from "tesseract.js";
import { IBillingPortalAdapter } from "../../core/interfaces/IBillingPortalAdapter.js";
import {
  ParsedReceiptData,
  BillingProfile,
  AutomationOptions,
  InvoiceResult,
  PortalDescriptor,
} from "../../core/types.js";
import { Logger } from "../../utils/logger.js";

export class ControlGasAdapter implements IBillingPortalAdapter {
  public readonly descriptor: PortalDescriptor = {
    id: "controlgas",
    name: "LitrosCompletos",
    supportedDomains: [
      "litroscompletos.mx",
      "www.litroscompletos.mx",
      "dyndns.org",
      "ccae04778.dyndns.org",
      "controlgas.com.mx",
    ],
    supportedBrands: [
      "COMBUSTIBLES DE CANCUN",
      "LITROSCOMPLETOS",
      "LITROS COMPLETOS",
      "CONTROLGAS",
      "ATIO",
      "SANDOVAL",
    ],
  };

  public canHandle(receipt: ParsedReceiptData): boolean {
    const url = (receipt.billingUrl || "").toLowerCase();
    const brand = (receipt.gasStation || "").toUpperCase();
    const raw = (receipt.rawText || "").toLowerCase();

    return (
      url.includes("litroscompletos") ||
      url.includes("dyndns.org:8088") ||
      url.includes("ccae04778") ||
      url.includes("controlgasfe") ||
      brand.includes("COMBUSTIBLES DE CANCUN") ||
      brand.includes("LITROSCOMPLETOS") ||
      brand.includes("CONTROLGAS") ||
      raw.includes("litroscompletos.mx") ||
      raw.includes("cca-960310-cs8") ||
      raw.includes("cca960310cs8") ||
      raw.includes("e04778")
    );
  }

  public async execute(
    page: Page,
    receipt: ParsedReceiptData,
    profile: BillingProfile,
    options: AutomationOptions = {},
  ): Promise<InvoiceResult> {
    const dryRun = options.dryRun ?? false;
    const takeScreenshot = options.takeScreenshot ?? true;
    const screenshotDir = path.resolve(options.screenshotDir || "output");
    if (takeScreenshot && !fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const targetUrl = (receipt.billingUrl || "").toLowerCase();
    const isHoldingOrEmpty =
      !targetUrl ||
      targetUrl.includes("litroscompletos") ||
      !targetUrl.includes("dyndns.org");
    const baseUrl = isHoldingOrEmpty
      ? "http://ccae04778.dyndns.org:8088/ControlGasFE/"
      : (receipt.billingUrl || "http://ccae04778.dyndns.org:8088/ControlGasFE/");

    Logger.info("ControlGas", `Navigating to ${baseUrl} to initiate session...`);
    await page.goto(baseUrl, {
      waitUntil: "domcontentloaded",
      timeout: options.timeoutMs || 30000,
    });
    await page.waitForTimeout(1500);

    let activePage = page;
    // Step 1: Click Facturar from root page to create ASP.NET session
    const isAlreadyOnFacturar = activePage.url().includes("facturar.aspx");
    if (!isAlreadyOnFacturar) {
      Logger.info("ControlGas", 'Clicking "Facturar" button on portal home...');
      const [popup] = await Promise.all([
        activePage.context().waitForEvent("page", { timeout: 6000 }).catch(() => null),
        activePage.waitForURL(/facturar\.aspx/i, { timeout: 20000 }).catch(() => {}),
        activePage.click("#facturar").catch(async () => {
          await activePage.click("#imgbtnFacturarLarge").catch(() => {});
        }),
      ]);
      if (popup) {
        activePage = popup;
        await activePage.waitForLoadState("domcontentloaded");
      }
      await activePage.waitForTimeout(1500).catch(() => {});
    }

    // Step 2: Ensure form fields are ready
    await activePage.waitForSelector("#txtDespacho", { timeout: 20000 });

    // Extract Folio and Web ID
    const folio = receipt.folio || this._extractFolioFallback(receipt);
    const webId = receipt.webId || this._extractWebIdFallback(receipt);

    if (!folio || !webId) {
      const missing = [!folio && "Folio", !webId && "Web ID"].filter(Boolean).join(" y ");
      return {
        success: false,
        portalId: this.descriptor.id,
        receipt,
        billingProfile: profile,
        formFilled: false,
        submitted: false,
        message: `Faltan datos requeridos por ControlGas: ${missing}. Revisa el ticket escaneado.`,
      };
    }

    Logger.info("ControlGas", `Filling Folio: "${folio}", Web ID: "${webId}"...`);
    await activePage.fill("#txtDespacho", folio);
    await activePage.fill("#txtIdentificador", webId);

    // Step 3: Solve Captcha and Add Ticket
    Logger.info("ControlGas", "Solving Telerik RadCaptcha...");
    const addResult = await this._solveCaptchaAndAdd(activePage, folio, webId);

    let filledScreenshot: string | undefined;
    if (takeScreenshot) {
      filledScreenshot = path.join(
        screenshotDir,
        `controlgas_filled_${timestamp}.png`,
      );
      await activePage.screenshot({ path: filledScreenshot, fullPage: true }).catch(() => {});
    }

    if (!addResult.success) {
      Logger.warn("ControlGas", `Ticket addition error: "${addResult.message}"`);
      return {
        success: false,
        portalId: this.descriptor.id,
        receipt,
        billingProfile: profile,
        formFilled: true,
        submitted: false,
        message: addResult.message,
        screenshotPath: filledScreenshot,
      };
    }

    // Dry Run check
    if (dryRun) {
      Logger.info("ControlGas", "Dry run active. Ticket validated successfully.");
      return {
        success: true,
        portalId: this.descriptor.id,
        receipt,
        billingProfile: profile,
        formFilled: true,
        submitted: false,
        extraData: { dryRun: true },
        message: `Ticket ${folio} validado y encolado en ControlGas (Modo Simulación).`,
        screenshotPath: filledScreenshot,
      };
    }

    // Step 4: Advance to Fiscal Data (datos_facturacion.aspx)
    Logger.info("ControlGas", "Advancing to customer fiscal data...");
    await Promise.all([
      activePage.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => {}),
      activePage.click("#btnNotaDespacho"),
    ]);
    await activePage.waitForTimeout(2500);

    // Step 5: Fill Fiscal Profile in datos_facturacion.aspx
    await this._fillCustomerFiscalData(activePage, profile);

    let finalScreenshot: string | undefined;
    if (takeScreenshot) {
      finalScreenshot = path.join(
        screenshotDir,
        `controlgas_submitted_${timestamp}.png`,
      );
      await activePage.screenshot({ path: finalScreenshot, fullPage: true }).catch(() => {});
    }

    return {
      success: true,
      portalId: this.descriptor.id,
      receipt,
      billingProfile: profile,
      formFilled: true,
      submitted: true,
      message: `Factura enviada a generar para ticket ${folio} en ControlGas.`,
      screenshotPath: finalScreenshot || filledScreenshot,
    };
  }

  /**
   * Solves Telerik RadCaptcha using Sharp preprocessing + Tesseract OCR with retry loop.
   */
  private async _solveCaptchaAndAdd(
    page: Page,
    folio: string,
    webId: string,
    maxAttempts: number = 8,
  ): Promise<{ success: boolean; message: string }> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        Logger.debug("ControlGas", `Captcha attempt ${attempt}/${maxAttempts}...`);
        const captchaImg = page.locator("#RadCaptcha1_CaptchaImageUP");
        await captchaImg.waitFor({ state: "visible", timeout: 8000 });
        const rawBuffer = await captchaImg.screenshot();

        // High contrast thresholding with sharp
        const processedBuffer = await sharp(rawBuffer)
          .resize({ width: 360 })
          .greyscale()
          .threshold(160)
          .png()
          .toBuffer();

        const worker = await createWorker("eng");
        await worker.setParameters({
          tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
        });
        const ocrRes = await worker.recognize(processedBuffer);
        const captchaText = ocrRes.data.text.trim().replace(/[^A-Za-z0-9]/g, "").toUpperCase();
        await worker.terminate();

        Logger.debug("ControlGas", `Attempt ${attempt}: OCR result "${captchaText}" (len: ${captchaText.length})`);

        if (captchaText.length !== 5) {
          await this._refreshCaptchaImage(page);
          continue;
        }

        // Refill folio and webId in case page refreshed
        await page.fill("#txtDespacho", folio);
        await page.fill("#txtIdentificador", webId);
        await page.fill("#RadCaptcha1_CaptchaTextBox", captchaText);

        await page.click("#btnAgregar");
        await page.waitForTimeout(4000);

        const state = await page.evaluate(() => {
          const err = document.querySelector("#divError")?.textContent?.trim() || "";
          const rows = document.querySelectorAll("#grvTicket tr").length;
          const continueBtn = document.querySelector("#btnNotaDespacho, .continue input, .continue button");
          const hasContinue = continueBtn !== null;
          return { err, rows, hasContinue };
        });

        // If captcha was wrong, refresh and retry
        if (state.err.toLowerCase().includes("captcha incorrecto")) {
          Logger.debug("ControlGas", "Captcha was incorrect, refreshing image...");
          await this._refreshCaptchaImage(page);
          continue;
        }

        // If station returned business error (outside billing period, already invoiced, not found)
        if (state.err) {
          return { success: false, message: state.err };
        }

        // If ticket was successfully added
        if (state.rows > 0 || state.hasContinue) {
          return { success: true, message: "Ticket agregado correctamente." };
        }
      } catch (err: any) {
        Logger.warn("ControlGas", `Error during captcha attempt ${attempt}: ${err.message}`);
        await page.waitForTimeout(1500);
      }
    }

    return {
      success: false,
      message: "No se pudo resolver el captcha de ControlGas tras múltiples intentos.",
    };
  }

  /**
   * Refreshes the captcha image and waits until the new image is completely loaded.
   */
  private async _refreshCaptchaImage(page: Page): Promise<void> {
    try {
      const oldSrc = await page.locator("#RadCaptcha1_CaptchaImageUP").getAttribute("src").catch(() => "");
      await page.click("#btnRefreshImage").catch(() => {});
      await page.waitForFunction(
        (prev) => {
          const img = document.querySelector("#RadCaptcha1_CaptchaImageUP") as HTMLImageElement;
          return img && img.src !== prev && img.complete && img.naturalWidth > 0;
        },
        oldSrc,
        { timeout: 8000 },
      ).catch(() => {});
      await page.waitForTimeout(1000);
    } catch {
      await page.waitForTimeout(2000);
    }
  }

  /**
   * Fills fiscal information on datos_facturacion.aspx.
   */
  private async _fillCustomerFiscalData(page: Page, profile: BillingProfile): Promise<void> {
    try {
      // Check RFC input
      const rfcInput = page.locator("#txtRFC, #txtRfc, input[name*='RFC' i]");
      if (await rfcInput.count() > 0) {
        await rfcInput.first().fill(profile.rfc.trim().toUpperCase());
      }

      // Check Razón Social
      const nameInput = page.locator("#txtRazonSocial, #txtNombre, input[name*='Razon' i]");
      if (await nameInput.count() > 0) {
        await nameInput.first().fill(profile.razonSocial.trim().toUpperCase());
      }

      // Check Postal Code
      const cpInput = page.locator("#txtCP, #txtCodigoPostal, input[name*='Postal' i]");
      if (await cpInput.count() > 0) {
        await cpInput.first().fill(profile.codigoPostal.trim());
      }

      // Check Email
      const emailInput = page.locator("#txtCorreo, #txtEmail, input[name*='Email' i], input[name*='Correo' i]");
      if (await emailInput.count() > 0 && profile.email) {
        await emailInput.first().fill(profile.email.trim());
      }

      await page.waitForTimeout(1000);
    } catch (err: any) {
      Logger.warn("ControlGas", `Could not fill all fiscal fields on datos_facturacion: ${err.message}`);
    }
  }

  private _extractFolioFallback(receipt: ParsedReceiptData): string {
    if (receipt.trackingNumber && /^\d{6,12}$/.test(receipt.trackingNumber)) {
      return receipt.trackingNumber;
    }
    const match = (receipt.rawText || "").match(/(?:FOLIO|Nota\s*#?)[:\s#]*([0-9]{6,12})\b/i);
    return match ? match[1].trim() : "";
  }

  private _extractWebIdFallback(receipt: ParsedReceiptData): string {
    const match = (receipt.rawText || "").match(/(?:WEB\s*ID|WebId|ID\s*Web)[:\s]*([A-Z0-9]{6,10})/i);
    return match ? match[1].trim().toUpperCase() : "";
  }
}
