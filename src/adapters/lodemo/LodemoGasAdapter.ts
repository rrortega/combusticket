import { Page } from "playwright-core";
import path from "path";
import fs from "fs";
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

export class LodemoGasAdapter implements IBillingPortalAdapter {
  public readonly descriptor: PortalDescriptor = {
    id: "lodemo",
    name: "Grupo Lodemo (LodemoRed / Facturación Lodemo)",
    supportedDomains: [
      "lodemored.com.mx",
      "www.lodemored.com.mx",
      "fact.lodemored.net",
      "lodemo.com.mx",
    ],
    supportedBrands: [
      "GRUPO LODEMO",
      "LODEMO",
      "LODEMORED",
      "INMOBILIARIA DEL ZAZIL HA",
      "ZAZILHA",
    ],
  };

  public canHandle(receipt: ParsedReceiptData): boolean {
    const url = (receipt.billingUrl || "").toLowerCase();
    const brand = (receipt.gasStation || "").toUpperCase();
    const raw = (receipt.rawText || "").toLowerCase();

    return (
      url.includes("lodemored") ||
      url.includes("lodemo") ||
      brand.includes("LODEMO") ||
      brand.includes("ZAZIL HA") ||
      brand.includes("ZAZILHA") ||
      raw.includes("lodemored.com.mx") ||
      raw.includes("fact.lodemored.net")
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

    const targetUrl = "https://fact.lodemored.net/";
    Logger.info("LodemoGas", `Navigating to ${targetUrl}...`);
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: options.timeoutMs || 30000,
    });
    await page.waitForTimeout(1500);

    // Wait for the RFC input field to be present
    await page.waitForSelector("#txtRFC", { timeout: 15000 });

    // Step 1: Input RFC and search customer record
    Logger.info("LodemoGas", `Querying RFC "${profile.rfc}"...`);
    await page.fill("#txtRFC", profile.rfc.trim().toUpperCase());
    await page.click("#btnBuscarRFC");

    // Wait for search spinner (#buscar) to disappear or settle
    await page
      .waitForFunction(
        () => {
          const spinner = document.querySelector("#buscar");
          return !spinner || spinner.classList.contains("d-none");
        },
        { timeout: 15000 },
      )
      .catch(() => {});
    await page.waitForTimeout(1200);

    // Step 2: Check if client data needs to be populated
    await this._ensureCustomerData(page, profile);

    // Step 3: Select CFDI usage (Uso CFDI)
    await this._selectUsoCfdi(page, profile.usoCfdi || "G03");

    // Step 4: Register ticket in the portal
    Logger.info(
      "LodemoGas",
      `Registering ticket: "${receipt.trackingNumber}", Amount: $${receipt.amount}, Liters: ${receipt.liters || "N/A"}...`,
    );

    const ticketResult = await this._addTicket(page, receipt);
    if (!ticketResult.success) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      let errorScreenshot: string | undefined;
      if (takeScreenshot) {
        errorScreenshot = path.join(
          screenshotDir,
          `lodemo_error_${timestamp}.png`,
        );
        await page.screenshot({ path: errorScreenshot, fullPage: true }).catch(() => {});
      }

      return {
        success: false,
        portalId: this.descriptor.id,
        receipt,
        billingProfile: profile,
        formFilled: true,
        submitted: false,
        message: ticketResult.message,
        screenshotPath: errorScreenshot,
      };
    }

    // Step 5: Solve Captcha
    Logger.info("LodemoGas", "Resolving visual captcha with OCR...");
    await this._solveAndFillCaptcha(page);

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    let filledScreenshot: string | undefined;
    if (takeScreenshot) {
      filledScreenshot = path.join(
        screenshotDir,
        `lodemo_filled_${timestamp}.png`,
      );
      await page.screenshot({ path: filledScreenshot, fullPage: true }).catch(() => {});
    }

    // If dry-run, finish here without clicking submit
    if (dryRun) {
      Logger.info("LodemoGas", "Dry-run mode: Ticket and profile loaded successfully.");
      return {
        success: true,
        portalId: this.descriptor.id,
        receipt,
        billingProfile: profile,
        formFilled: true,
        submitted: false,
        message: `Simulación exitosa: Formulario y ticket ${receipt.trackingNumber} validados en portal Lodemo.`,
        screenshotPath: filledScreenshot,
      };
    }

    // Step 6: Submit Invoice Generation
    Logger.info("LodemoGas", "Generating invoice...");
    return await this._submitInvoice(
      page,
      receipt,
      profile,
      screenshotDir,
      filledScreenshot,
      options,
    );
  }

  /**
   * Populates client fields if the customer is not registered or fields are missing.
   */
  private async _ensureCustomerData(
    page: Page,
    profile: BillingProfile,
  ): Promise<void> {
    const isNewCustomer = await page.evaluate(() => {
      const isNew = document.querySelector("#inputEsNuevo") as HTMLInputElement;
      const razon = (document.querySelector("#txtRazonSocial") as HTMLInputElement)?.value || "";
      return isNew?.value === "Si" || razon.trim() === "";
    });

    if (!isNewCustomer) {
      Logger.info("LodemoGas", "Customer already registered in Lodemo database.");
      return;
    }

    Logger.info("LodemoGas", "Configuring customer fiscal details...");
    // Enable fields if edit button is active
    await page.evaluate(() => {
      const editBtn = document.querySelector("#lnkBtnEditar");
      if (editBtn && !editBtn.classList.contains("disabled")) {
        (window as any).lnkBtnEditar_onclick?.();
      }
    });
    await page.waitForTimeout(600);

    // Set Razón Social
    await page.fill("#txtRazonSocial", profile.razonSocial.trim().toUpperCase());

    // Set Email & Confirmation
    await page.fill("#txtEmailFac", profile.email.trim());
    await page.fill("#txtEmailFacConfirmar", (profile.emailConfirm || profile.email).trim());

    // Set Postal Code
    if (profile.codigoPostal) {
      await page.fill("#txtCP", profile.codigoPostal.trim());
      await page.evaluate(() => (window as any).txtCP_onchange?.());
      await page.waitForTimeout(800);
    }

    // Set Street and Numbers
    if (profile.calle) {
      await page.fill("#txtCalle", profile.calle.trim().toUpperCase());
    }
    if (profile.numExt) {
      await page.fill("#txtNumExt", profile.numExt.trim().toUpperCase());
    }
    if (profile.numInt) {
      await page.fill("#txtNumInt", profile.numInt.trim().toUpperCase());
    }

    // Set Colonia
    await page.evaluate((coloniaName) => {
      const select = document.querySelector("#ddlColoniaCliente") as HTMLSelectElement;
      const textColonia = document.querySelector("#txtColoniaCliente") as HTMLInputElement;
      const target = (coloniaName || "").trim().toUpperCase();

      if (select && (window as any).$) {
        let matchedValue = "";
        if (target) {
          for (let i = 0; i < select.options.length; i++) {
            const optText = select.options[i].text.toUpperCase();
            if (optText.includes(target) || target.includes(optText)) {
              matchedValue = select.options[i].value;
              break;
            }
          }
        }
        if (!matchedValue && select.options.length > 2) {
          matchedValue = select.options[2].value;
        }

        if (matchedValue) {
          (window as any).$("#ddlColoniaCliente").selectpicker("val", matchedValue);
          (window as any).$("#ddlColoniaCliente").selectpicker("refresh");
          (window as any).ddlColoniaCliente_onchange?.();
        }
      }

      if (textColonia && (!textColonia.classList.contains("d-none") || !textColonia.value)) {
        textColonia.classList.remove("d-none");
        textColonia.value = target || "CENTRO";
      }
    }, profile.colonia || "");

    // Select Fiscal Regime
    if (profile.regimenFiscal) {
      const regCode = profile.regimenFiscal.replace(/\D/g, "");
      await page.evaluate((code) => {
        const select = document.querySelector("#ddlRegimenFiscal") as HTMLSelectElement;
        if (select && (window as any).$) {
          (window as any).$("#ddlRegimenFiscal").selectpicker("val", code);
          (window as any).$("#ddlRegimenFiscal").selectpicker("refresh");
        }
      }, regCode);
    }

    // Save customer record if button is present
    await page.evaluate(() => {
      const saveBtn = document.querySelector("#lnkbtnGuardarCte");
      if (saveBtn && !saveBtn.classList.contains("disabled")) {
        (window as any).lnkbtnGuardarCte_onclick?.();
      }
    });

    // Wait for save spinner to settle
    await page
      .waitForFunction(
        () => {
          const spinner = document.querySelector("#buscar");
          return !spinner || spinner.classList.contains("d-none");
        },
        { timeout: 10000 },
      )
      .catch(() => {});
    await page.waitForTimeout(1000);
  }

  /**
   * Selects the CFDI usage from the bootstrap selectpicker dropdown.
   */
  private async _selectUsoCfdi(page: Page, usoCfdi: string): Promise<void> {
    const code = usoCfdi.toUpperCase().trim();
    await page.evaluate((c) => {
      if ((window as any).$) {
        (window as any).$("#ddlUsoCFDI").selectpicker("val", c);
        (window as any).$("#ddlUsoCFDI").selectpicker("refresh");
      }
    }, code);
  }

  /**
   * Adds the fuel ticket to the portal table.
   */
  private async _addTicket(
    page: Page,
    receipt: ParsedReceiptData,
  ): Promise<{ success: boolean; message: string }> {
    const ticketFolio = receipt.trackingNumber.trim().toUpperCase();
    const formattedDate = this._formatTicketDate(receipt.date);
    const amountStr = receipt.amount.toFixed(2);
    const litersStr = (receipt.liters || 0).toFixed(3);

    await page.fill("#txtTicket", ticketFolio);
    await page.fill("#txtImporte", amountStr);
    await page.fill("#txCantidad", litersStr);

    // Set datepicker value
    await page.evaluate((d) => {
      const dateInput = document.querySelector("#txtFechaIni") as HTMLInputElement;
      if (dateInput) {
        dateInput.value = d;
        if ((window as any).$) {
          (window as any).$("#txtFechaIni").val(d);
        }
      }
    }, formattedDate);

    // Click "Agregar Ticket"
    await page.evaluate(() => {
      const addBtn = document.querySelector("#lnkBtnTicket");
      if (addBtn && !addBtn.classList.contains("disabled")) {
        (window as any).lnkBtnTicket_onclick?.();
      }
    });

    // Wait for network response and UI update
    await page.waitForTimeout(2500);

    // Check if an error banner appeared
    const errorState = await page.evaluate(() => {
      const msgBox = document.querySelector("#mensajeError");
      const isVisible = msgBox && !msgBox.classList.contains("d-none");
      const text = document.querySelector("#lblMensaje")?.textContent?.trim() || "";
      const facturarBtn = document.querySelector("#lnkBtnFacturar");
      const isFacturarEnabled = facturarBtn && !facturarBtn.classList.contains("disabled");
      return { hasError: Boolean(isVisible && text), message: text, isFacturarEnabled };
    });

    if (errorState.hasError) {
      Logger.warn("LodemoGas", `Ticket addition notice: "${errorState.message}"`);
      return { success: false, message: errorState.message };
    }

    return { success: true, message: "Ticket agregado correctamente." };
  }

  /**
   * Solves the graphic alphanumeric captcha and types it into the input.
   */
  private async _solveAndFillCaptcha(page: Page, maxAttempts: number = 3): Promise<string> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const captchaLocator = page.locator("#img_captcha");
        await captchaLocator.waitFor({ state: "visible", timeout: 8000 });
        const captchaBuffer = await captchaLocator.screenshot();

        const worker = await createWorker("eng");
        await worker.setParameters({
          tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
        });

        const { data } = await worker.recognize(captchaBuffer);
        await worker.terminate();

        const cleanCaptcha = (data.text || "").trim().replace(/[^a-zA-Z0-9]/g, "");
        Logger.info("LodemoGas", `[Attempt ${attempt}/${maxAttempts}] OCR Captcha: "${cleanCaptcha}"`);

        if (cleanCaptcha.length >= 4) {
          await page.fill("#txtRecaptcha", cleanCaptcha);
          await page.evaluate(() => (window as any).txtRecaptcha_onchange?.());
          return cleanCaptcha;
        }

        Logger.warn("LodemoGas", `Captcha OCR too short (${cleanCaptcha.length}), refreshing captcha...`);
        await page.click("#lnkBtnCaptcha");
        await page.waitForTimeout(1500);
      } catch (err: any) {
        Logger.warn("LodemoGas", `Error resolving captcha on attempt ${attempt}: ${err.message}`);
        if (attempt < maxAttempts) {
          await page.click("#lnkBtnCaptcha").catch(() => {});
          await page.waitForTimeout(1500);
        }
      }
    }

    return "";
  }

  /**
   * Triggers the invoice generation modal and confirms creation.
   */
  private async _submitInvoice(
    page: Page,
    receipt: ParsedReceiptData,
    profile: BillingProfile,
    screenshotDir: string,
    filledScreenshot?: string,
    options: AutomationOptions = {},
  ): Promise<InvoiceResult> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    // Click "GENERAR FACTURA" which opens #ModalValidaCFDI
    await page.evaluate(() => {
      (window as any).lnkbtnValidarCFDI?.();
    });
    await page.waitForTimeout(1200);

    // Confirm in modal by clicking #lnkbtnAcepto
    const modalVisible = await page.evaluate(() => {
      const modal = document.querySelector("#ModalValidaCFDI");
      return modal && modal.classList.contains("in");
    });

    if (modalVisible) {
      Logger.info("LodemoGas", 'Confirming CFDI in validation modal ("Aceptar")...');
      await page.click("#lnkbtnAcepto");
    } else {
      // Fallback: direct trigger
      await page.evaluate(() => (window as any).lnkBtnFacturar_onclick?.());
    }

    // Wait for the invoice request to process
    await page.waitForTimeout(5000);

    let submittedScreenshot: string | undefined;
    if (options.takeScreenshot ?? true) {
      submittedScreenshot = path.join(
        screenshotDir,
        `lodemo_submitted_${timestamp}.png`,
      );
      await page.screenshot({ path: submittedScreenshot, fullPage: true }).catch(() => {});
    }

    // Inspect outcome: check for success modal (#ModalPDF) or error alerts
    const outcome = await page.evaluate(() => {
      const modalPdf = document.querySelector("#ModalPDF");
      const isSuccess = modalPdf && modalPdf.classList.contains("in");

      const errorMsgBox = document.querySelector("#mensajeError");
      const errorText =
        errorMsgBox && !errorMsgBox.classList.contains("d-none")
          ? document.querySelector("#lblMensaje")?.textContent?.trim() || ""
          : "";

      const captchaError = document.querySelector("#lblCaptcha");
      const isCaptchaError = captchaError && !captchaError.classList.contains("d-none");

      // Extract invoice folio / table details if rendered
      const tableFacturas = document.querySelector(".content-table-facturas")?.textContent?.trim() || "";

      return {
        isSuccess: Boolean(isSuccess || tableFacturas.length > 10),
        errorText,
        isCaptchaError: Boolean(isCaptchaError),
        tableFacturas,
      };
    });

    if (outcome.isSuccess) {
      Logger.info("LodemoGas", "Invoice generated successfully!");
      return {
        success: true,
        portalId: this.descriptor.id,
        receipt,
        billingProfile: profile,
        formFilled: true,
        submitted: true,
        message: `Factura generada exitosamente para ticket ${receipt.trackingNumber}.`,
        screenshotPath: submittedScreenshot || filledScreenshot,
      };
    }

    if (outcome.isCaptchaError) {
      Logger.warn("LodemoGas", "Captcha rejected by portal server.");
      return {
        success: false,
        portalId: this.descriptor.id,
        receipt,
        billingProfile: profile,
        formFilled: true,
        submitted: false,
        message: "El portal rechazó el código Captcha. Intente de nuevo.",
        screenshotPath: submittedScreenshot || filledScreenshot,
      };
    }

    const failureMessage =
      outcome.errorText ||
      `No se pudo confirmar la emisión de la factura para el ticket ${receipt.trackingNumber}.`;

    Logger.warn("LodemoGas", `Invoice generation failed: "${failureMessage}"`);
    return {
      success: false,
      portalId: this.descriptor.id,
      receipt,
      billingProfile: profile,
      formFilled: true,
      submitted: false,
      message: failureMessage,
      screenshotPath: submittedScreenshot || filledScreenshot,
    };
  }

  /**
   * Formats various ticket date representations into YYYY-MM-DD for Lodemo's datepicker.
   */
  private _formatTicketDate(rawDate?: string): string {
    if (!rawDate) {
      return new Date().toISOString().split("T")[0];
    }

    // Match DD/MM/YYYY
    const dmyMatch = rawDate.match(/(\d{2})[/-](\d{2})[/-](\d{4})/);
    if (dmyMatch) {
      const [, day, month, year] = dmyMatch;
      return `${year}-${month}-${day}`;
    }

    // Match YYYY-MM-DD
    const ymdMatch = rawDate.match(/(\d{4})[/-](\d{2})[/-](\d{2})/);
    if (ymdMatch) {
      const [, year, month, day] = ymdMatch;
      return `${year}-${month}-${day}`;
    }

    return new Date().toISOString().split("T")[0];
  }
}
