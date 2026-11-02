import { Page } from "playwright-core";
import path from "path";
import fs from "fs";
import { IBillingPortalAdapter } from "../../core/interfaces/IBillingPortalAdapter.js";
import {
  ParsedReceiptData,
  BillingProfile,
  AutomationOptions,
  InvoiceResult,
  PortalDescriptor,
} from "../../core/types.js";
import { Logger } from "../../utils/logger.js";

export class FacturasGasAdapter implements IBillingPortalAdapter {
  public readonly descriptor: PortalDescriptor = {
    id: "facturasgas",
    name: "FacturasGas (GoGas / Red FacturasGas)",
    supportedDomains: ["facturasgas.com", "www.facturasgas.com"],
    supportedBrands: ["GOGAS", "SERVICIO SEIS ANEMONAS"],
  };

  public canHandle(receipt: ParsedReceiptData): boolean {
    const url = (receipt.billingUrl || "").toLowerCase();
    const brand = (receipt.gasStation || "").toUpperCase();
    const raw = (receipt.rawText || "").toLowerCase();

    return (
      url.includes("facturasgas.com") ||
      brand.includes("GOGAS") ||
      raw.includes("facturasgas.com")
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

    let targetUrl = receipt.billingUrl.replace("://www.", "://");
    if (!targetUrl.includes("autofactura.php")) {
      targetUrl = targetUrl.replace(/\/$/, "") + "/facturacion/autofactura.php";
    }

    Logger.info("FacturasGas", `Navigating to ${targetUrl}...`);
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: options.timeoutMs || 30000,
    });
    await page.waitForTimeout(1200);

    // Suppress Bootstrap popovers, alert banners, and jQuery UI autocomplete dropdowns to prevent layout jumping
    await page
      .addStyleTag({
        content:
          ".popover, .ui-autocomplete, .alert, .alert-warning { display: none !important; opacity: 0 !important; visibility: hidden !important; }",
      })
      .catch(() => {});

    await page
      .evaluate(`
      (() => {
        try {
          if (window.$) {
            window.$('[data-toggle="popover"]').popover('dispose');
            window.$('.popover').remove();
            if (window.$('#RFC').data && window.$('#RFC').data('ui-autocomplete')) {
              window.$('#RFC').autocomplete('destroy');
            }
          }
        } catch {}
      })()
    `)
      .catch(() => {});

    Logger.info("FacturasGas", "Filling billing profile into form...");
    const paymentCode = this.resolvePaymentMethodCode(
      receipt.paymentMethod,
      profile.formaPago,
    );

    // Attempt to fill form + register ticket, retrying on timeout (up to 3 times)
    const MAX_FORM_ATTEMPTS = 3;
    for (let attempt = 1; attempt <= MAX_FORM_ATTEMPTS; attempt++) {
      if (attempt > 1) {
        Logger.warn(
          "FacturasGas",
          `[Attempt ${attempt}/${MAX_FORM_ATTEMPTS}] Reloading portal page and retrying form fill...`,
        );
        try {
          await page.goto(targetUrl, {
            waitUntil: "domcontentloaded",
            timeout: options.timeoutMs || 30000,
          });
          await page.waitForTimeout(1500);
          // Re-apply style suppression after reload
          await page
            .addStyleTag({
              content:
                ".popover, .ui-autocomplete, .alert, .alert-warning { display: none !important; opacity: 0 !important; visibility: hidden !important; }",
            })
            .catch(() => {});
        } catch (reloadErr: any) {
          Logger.warn("FacturasGas", `Reload failed on attempt ${attempt}: ${reloadErr.message}`);
        }
      }

      try {
        await this._fillAndRegisterTicket(page, receipt, profile, paymentCode, options);
        break; // success — exit retry loop
      } catch (fillErr: any) {
        const isTimeout = fillErr.message?.includes("Timeout") || fillErr.message?.includes("timeout");
        if (isTimeout && attempt < MAX_FORM_ATTEMPTS) {
          Logger.warn(
            "FacturasGas",
            `[Attempt ${attempt}/${MAX_FORM_ATTEMPTS}] Timeout on form interaction, will retry: ${fillErr.message.split("\n")[0]}`,
          );
          continue;
        }
        // Last attempt or non-timeout error: re-throw
        throw fillErr;
      }
    }

    const ticketStatus = (await page.evaluate(`
      (() => {
        const ticketHelp = document.querySelector('#Ticket_help')?.textContent?.trim() || '';
        const ticketsVal = document.querySelector('#Tickets')?.value || '';
        const showTickets = document.querySelector('#show_tickets')?.innerHTML || '';
        return { ticketHelp, ticketsVal, showTickets };
      })()
    `)) as { ticketHelp: string; ticketsVal: string; showTickets: string };

    Logger.info(
      "FacturasGas",
      `Registered tickets: "${ticketStatus.ticketsVal}", Validation status: "${ticketStatus.ticketHelp || "OK"}"`,
    );

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    let filledScreenshot: string | undefined;
    if (takeScreenshot) {
      filledScreenshot = path.join(
        screenshotDir,
        `facturasgas_${timestamp}.png`,
      );
      try {
        await page.screenshot({ path: filledScreenshot, fullPage: true });
      } catch (err: any) {
        Logger.warn(
          "FacturasGas",
          `Could not capture filled screenshot: ${err.message}`,
        );
      }
    }

    // STRICT PRE-CHECK: Fail-closed if ticket was not registered in the portal grid
    const hasTicketsRegistered = Boolean(
      ticketStatus.ticketsVal && ticketStatus.ticketsVal.trim().length > 0,
    );
    if (!hasTicketsRegistered || Boolean(ticketStatus.ticketHelp)) {
      const rejectReason =
        ticketStatus.ticketHelp ||
        `El portal no admitió el ticket '${receipt.trackingNumber}'. Verifique que el número de rastreo sea correcto y corresponda al mes en curso.`;
      Logger.warn(
        "FacturasGas",
        `Pre-submit validation failed: "${rejectReason}"`,
      );

      return {
        success: false,
        portalId: this.descriptor.id,
        receipt,
        billingProfile: profile,
        formFilled: true,
        submitted: false,
        screenshotPath: filledScreenshot,
        message: rejectReason,
        extraData: {
          ...ticketStatus,
          rejected: true,
          rejectionReason: rejectReason,
        },
      };
    }

    let submitted = false;
    let isSuccess = false;
    let finalMessage = `Formulario y ticket verificados para ${receipt.trackingNumber}.`;
    let evidenceScreenshot: string | undefined = filledScreenshot;
    let downloadedPdfPath: string | undefined;

    if (dryRun) {
      submitted = false;
      isSuccess = true;
      finalMessage = `Simulación completada con éxito. Formulario y ticket verificados para ${receipt.trackingNumber}.`;
    } else {
      Logger.info(
        "FacturasGas",
        'Submitting invoice: Clicking "Solicitar Factura" (#Button_Insert)...',
      );

      let dialogMessageReceived: string | undefined;
      // Capture any confirmation or alert dialog
      page.on("dialog", async (dialog) => {
        dialogMessageReceived = dialog.message();
        Logger.info(
          "FacturasGas",
          `Dialog detected: "${dialogMessageReceived}". Accepting...`,
        );
        await dialog.accept().catch(() => {});
      });

      // Unhide alerts so result/confirmation banners on the resulting page are visible
      await page
        .addStyleTag({
          content:
            ".alert, .alert-success, .alert-danger, .alert-warning, .alert-info { display: block !important; opacity: 1 !important; visibility: visible !important; }",
        })
        .catch(() => {});

      try {
        await Promise.all([
          page
            .waitForNavigation({
              waitUntil: "domcontentloaded",
              timeout: 60000,
            })
            .catch(() => null),
          page.click("#Button_Insert", { timeout: 10000 }),
        ]);
      } catch (err: any) {
        Logger.warn(
          "FacturasGas",
          `Navigation notice on submit: ${err.message}`,
        );
      }

      await page
        .waitForLoadState("domcontentloaded", { timeout: 30000 })
        .catch(() => null);
      await page.waitForLoadState("load", { timeout: 30000 }).catch(() => null);
      await page.waitForTimeout(3000);

      // Re-apply style to ensure alerts on the new page are unhidden
      await page
        .addStyleTag({
          content:
            ".alert, .alert-success, .alert-danger, .alert-warning, .alert-info { display: block !important; opacity: 1 !important; visibility: visible !important; }",
        })
        .catch(() => {});

      if (takeScreenshot) {
        const submittedScreenshot = path.join(
          screenshotDir,
          `facturasgas_submitted_${timestamp}.png`,
        );
        try {
          await page.screenshot({ path: submittedScreenshot });
          evidenceScreenshot = submittedScreenshot;
        } catch (e: any) {
          Logger.warn(
            "FacturasGas",
            `Viewport screenshot notice, retrying after pause: ${e.message}`,
          );
          await page.waitForTimeout(2000);
          try {
            await page.screenshot({ path: submittedScreenshot });
            evidenceScreenshot = submittedScreenshot;
          } catch {}
        }
      }

      // Retry evaluate up to 4 times with delays to prevent navigation context loss
      let pageOutcome: any = null;
      for (let attempt = 1; attempt <= 4; attempt++) {
        try {
          pageOutcome = await page.evaluate(() => {
            const alertElements = Array.from(
              document.querySelectorAll(
                "#dynamic_custom_error, .alert, .alert-warning, .alert-danger, .alert-success, .mensaje, #mensaje, #Ticket_help",
              ),
            );
            const alerts = alertElements
              .map((el) => el.textContent?.trim() || "")
              .filter((t) => t.length > 5);

            const bodyText = document.body?.innerText || "";

            const pdfLink =
              (
                document.querySelector(
                  'a[href*=".pdf"], a[href*="descargar"], a[href*="Descargar"]',
                ) as HTMLAnchorElement
              )?.href || null;
            const xmlLink =
              (document.querySelector('a[href*=".xml"]') as HTMLAnchorElement)
                ?.href || null;

            // Positive confirmation signals
            const successRegex =
              /factura\s*(?:generada|emitida|creada|enviada|con\s*éxito)|se\s*(?:ha\s*)?enviado\s*(?:a\s*su\s*correo|satisfactoriamente)|comprobante\s*fiscal\s*(?:digital\s*)?generado|folio\s*fiscal|uuid/i;
            const isExplicitSuccess =
              successRegex.test(bodyText) ||
              alerts.some((a) => successRegex.test(a)) ||
              Boolean(pdfLink || xmlLink);

            // Check for specific rejection / already-billed patterns
            const alreadyBilledRegex =
              /ya\s*(?:fue|se\s*encuentra|est[aá])\s*facturado|\(743\)|ya\s*ha\s*sido\s*facturado/i;
            const invalidTicketRegex =
              /ticket.*(?:no\s*es\s*v[aá]lido|no\s*existe|incorrecto|inv[aá]lido)|\(901\)|\(902\)|\(903\)/i;
            const expiredRegex =
              /periodo.*(?:vencido|cerrado)|fuera\s*de\s*tiempo|mes\s*en\s*curso/i;
            const fiscalErrorRegex =
              /c[oó]digo\s*postal|r[eé]gimen|rfc\s*no\s*v[aá]lido|error\s*al\s*timbrar|pac/i;

            const isAlreadyBilled =
              alreadyBilledRegex.test(bodyText) ||
              alerts.some((a) => alreadyBilledRegex.test(a));
            const isInvalid =
              invalidTicketRegex.test(bodyText) ||
              alerts.some((a) => invalidTicketRegex.test(a));
            const isExpired =
              expiredRegex.test(bodyText) ||
              alerts.some((a) => expiredRegex.test(a));
            const isFiscalError =
              fiscalErrorRegex.test(bodyText) ||
              alerts.some((a) => fiscalErrorRegex.test(a));

            // Locate any explicit alert text matching the rejection
            let rejectionMessage = "";
            for (const alert of alerts) {
              if (
                alreadyBilledRegex.test(alert) ||
                invalidTicketRegex.test(alert) ||
                expiredRegex.test(alert) ||
                fiscalErrorRegex.test(alert)
              ) {
                rejectionMessage = alert;
                break;
              }
            }

            if (!rejectionMessage && isAlreadyBilled) {
              const match = bodyText.match(
                /El ticket\s*['"]?[^'"]+['"]?\s*ya fue facturado[^\n.]*(?:\([0-9]+\))?/i,
              );
              if (match) {
                rejectionMessage = match[0];
              }
            }

            const formStillActive = Boolean(
              document.querySelector("#Button_Insert") ||
                document.querySelector("#RFC"),
            );

            return {
              alerts,
              isExplicitSuccess,
              isAlreadyBilled,
              isInvalid,
              isExpired,
              isFiscalError,
              rejectionMessage,
              formStillActive,
              pdfLink,
              xmlLink,
            };
          });
          if (pageOutcome) break;
        } catch (evalErr: any) {
          Logger.warn(
            "FacturasGas",
            `Outcome evaluation attempt #${attempt} error: ${evalErr.message}`,
          );
          await page.waitForTimeout(2000);
        }
      }

      Logger.info("FacturasGas", "Resulting outcome evaluation:", pageOutcome);

      if (!pageOutcome) {
        submitted = false;
        isSuccess = false;
        finalMessage =
          "No se pudo confirmar la generación de la factura en el portal.";
        Logger.warn(
          "FacturasGas",
          `Evaluation failed closed: "${finalMessage}"`,
        );
      } else if (
        pageOutcome.isAlreadyBilled ||
        pageOutcome.isInvalid ||
        pageOutcome.isExpired ||
        pageOutcome.isFiscalError
      ) {
        submitted = false;
        isSuccess = false;
        finalMessage = pageOutcome.isAlreadyBilled
          ? "Este ticket ya había sido facturado"
          : (pageOutcome.rejectionMessage || `El portal rechazó la solicitud del ticket '${receipt.trackingNumber}'.`);
        Logger.warn(
          "FacturasGas",
          `Portal rejection detected: "${finalMessage}"`,
        );
      } else if (
        dialogMessageReceived &&
        !pageOutcome.isExplicitSuccess &&
        !dialogMessageReceived.includes("¿Desea crear la Factura")
      ) {
        submitted = false;
        isSuccess = false;
        finalMessage = `Alerta del portal: ${dialogMessageReceived}`;
        Logger.warn(
          "FacturasGas",
          `Portal dialog rejected submission: "${finalMessage}"`,
        );
      } else if (
        pageOutcome.formStillActive &&
        !pageOutcome.pdfLink &&
        !pageOutcome.xmlLink
      ) {
        // Form is still active on screen with no downloads -> submission failed or stayed on form
        submitted = false;
        isSuccess = false;
        finalMessage =
          pageOutcome.alerts.length > 0
            ? pageOutcome.alerts.join(" | ")
            : `El formulario no avanzó para el ticket ${receipt.trackingNumber}.`;
        Logger.warn(
          "FacturasGas",
          `Submission did not complete: "${finalMessage}"`,
        );
      } else if (pageOutcome.isExplicitSuccess) {
        submitted = true;
        isSuccess = true;
        finalMessage =
          pageOutcome.alerts.length > 0
            ? pageOutcome.alerts.join(" | ")
            : `Factura solicitada con éxito para el ticket ${receipt.trackingNumber}.${evidenceScreenshot ? ` Evidencia capturada en ${path.basename(evidenceScreenshot)}.` : ""}`;

        // If portal provided a direct PDF download link, fetch and store it locally
        if (pageOutcome.pdfLink) {
          try {
            if (!fs.existsSync(screenshotDir)) {
              fs.mkdirSync(screenshotDir, { recursive: true });
            }
            const pdfFileName = `factura_${receipt.trackingNumber || timestamp}.pdf`;
            const targetPdfPath = path.join(screenshotDir, pdfFileName);
            const pdfBuffer = await page.evaluate(async (url) => {
              const resp = await fetch(url);
              const arrayBuffer = await resp.arrayBuffer();
              return Array.from(new Uint8Array(arrayBuffer));
            }, pageOutcome.pdfLink);
            if (pdfBuffer && pdfBuffer.length > 0) {
              fs.writeFileSync(targetPdfPath, Buffer.from(pdfBuffer));
              downloadedPdfPath = targetPdfPath;
              Logger.info(
                "FacturasGas",
                `PDF invoice downloaded to: ${targetPdfPath}`,
              );
            }
          } catch (pdfErr: any) {
            Logger.warn(
              "FacturasGas",
              `Could not download PDF file directly: ${pdfErr.message}`,
            );
          }
        }
      } else {
        // Fail-closed fallback: Form navigated away or changed, but no positive proof of invoice generation
        submitted = false;
        isSuccess = false;
        finalMessage =
          pageOutcome.alerts.length > 0
            ? pageOutcome.alerts.join(" | ")
            : "El portal no devolvió confirmación ni comprobante descargable de la factura.";
        Logger.warn(
          "FacturasGas",
          `Fail-closed fallback: No positive invoice confirmation found: "${finalMessage}"`,
        );
      }
    }

    return {
      success: isSuccess,
      portalId: this.descriptor.id,
      receipt,
      billingProfile: profile,
      formFilled: true,
      submitted,
      screenshotPath: evidenceScreenshot,
      pdfPath: downloadedPdfPath,
      message: finalMessage,
      extraData: {
        ...ticketStatus,
        rejected: !isSuccess,
        rejectionReason: isSuccess ? undefined : finalMessage,
      },
    };
  }

  /**
   * Fills the billing profile form and clicks #Button_Add to register the ticket.
   * Extracted so the retry loop in execute() can call it multiple times cleanly.
   */
  private async _fillAndRegisterTicket(
    page: Page,
    receipt: ParsedReceiptData,
    profile: BillingProfile,
    paymentCode: string,
    options: AutomationOptions,
  ): Promise<void> {
    // Step 1: Select Dropdowns with realistic pacing
    const selectsToSet = [
      { id: "#CdCfdiRegimen", val: profile.regimenFiscal, label: "Régimen Fiscal" },
      { id: "#CfdiMetodoPago", val: paymentCode, label: "Forma de Pago" },
      { id: "#CdUsoCfdi", val: profile.usoCfdi, label: "Uso de CFDI" },
    ];

    for (const item of selectsToSet) {
      if (item.val) {
        await page.evaluate(`
          (() => {
            const el = document.querySelector(${JSON.stringify(item.id)});
            if (el) {
              el.value = ${JSON.stringify(item.val)};
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
          })()
        `);
        Logger.debug("FacturasGas", `Set select ${item.label} (${item.id}) to: "${item.val}"`);
        await page.waitForTimeout(350);
      }
    }

    // Step 2: Fill text fields sequentially
    Logger.debug("FacturasGas", "Profile data to fill:", {
      rfc: profile.rfc,
      razonSocial: profile.razonSocial,
      email: profile.email,
      codigoPostal: profile.codigoPostal,
      regimen: profile.regimenFiscal,
      pago: paymentCode,
      uso: profile.usoCfdi,
    });

    // Pre-assign both Email inputs so the portal validator never detects a temporary mismatch
    await page
      .evaluate(`
      (() => {
        const e1 = document.querySelector('#Email');
        const e2 = document.querySelector('#Email_verif');
        if (e1) { e1.value = ${JSON.stringify(profile.email)}; e1.setAttribute('value', ${JSON.stringify(profile.email)}); }
        if (e2) { e2.value = ${JSON.stringify(profile.emailConfirm)}; e2.setAttribute('value', ${JSON.stringify(profile.emailConfirm)}); }
      })()
    `)
      .catch(() => {});

    const textFields = [
      { selector: "#RFC", value: profile.rfc, label: "RFC" },
      { selector: "#RazonSocial", value: profile.razonSocial, label: "Razón Social" },
      { selector: "#Email", value: profile.email, label: "Email" },
      { selector: "#Email_verif", value: profile.emailConfirm, label: "Confirmar Email" },
      { selector: "#CP", value: profile.codigoPostal, label: "Código Postal" },
    ];

    for (const field of textFields) {
      if (field.value) {
        await page.evaluate(`
          (() => {
            const el = document.querySelector(${JSON.stringify(field.selector)});
            if (el) {
              el.focus();
              el.value = ${JSON.stringify(field.value)};
              el.setAttribute('value', ${JSON.stringify(field.value)});
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              el.blur();
            }
          })()
        `);
        Logger.debug("FacturasGas", `Filled ${field.label} (${field.selector}): "${field.value}"`);
        await page.waitForTimeout(350);
      }
    }

    // Step 3: Resolve and auto-heal ticket number against FacturasGas validation endpoint
    const trackingToUse = await this._resolveAndHealTrackingNumber(page, receipt);

    if (trackingToUse) {
      await page.evaluate(`
        (() => {
          const el = document.querySelector('#Ticket');
          if (el) {
            el.focus();
            el.value = ${JSON.stringify(trackingToUse)};
            el.setAttribute('value', ${JSON.stringify(trackingToUse)});
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        })()
      `);
      Logger.debug("FacturasGas", `Filled Ticket (#Ticket): "${trackingToUse}"`);
      await page.waitForTimeout(400);
    }

    // Clean up jQuery UI autocomplete overlays
    await page.evaluate(`
      (() => {
        document.querySelectorAll('.ui-autocomplete').forEach((el) => el.remove());
        if (window.$ && window.$('#RFC') && window.$('#RFC').autocomplete) {
          try { window.$('#RFC').autocomplete('close'); } catch {}
        }
      })()
    `);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);

    // Step 4: Click "Agregar" to register ticket and wait for data_check.php AJAX callback to finish
    Logger.info("FacturasGas", `Registering ticket: ${trackingToUse}...`);
    const ajaxValidationPromise = page
      .waitForResponse((res) => res.url().includes("data_check.php"), {
        timeout: 8000,
      })
      .catch(() => null);

    await page.click("#Button_Add", { timeout: options.timeoutMs || 30000 });
    await ajaxValidationPromise;
    // Allow onreadystatechange callback (removeTicket / ticketAlert) to finish DOM updates
    await page.waitForTimeout(800);

    // Ensure DOM state has settled if AJAX took longer or was cached
    const startWait = Date.now();
    while (Date.now() - startWait < 3000) {
      const state = await page.evaluate(() => {
        const ticketHelp = document.querySelector("#Ticket_help")?.textContent?.trim() || "";
        const ticketsVal = (document.querySelector("#Tickets") as HTMLInputElement)?.value || "";
        return { ticketHelp, ticketsVal };
      });
      if (state.ticketHelp.length > 0 || state.ticketsVal.length > 0) {
        break;
      }
      await page.waitForTimeout(250);
    }
  }

  /**
   * Actively resolves and heals OCR digit confusions in GoGas/FacturasGas tracking numbers
   * by testing candidates against the portal's own ticketValidate endpoint before form submission.
   */
  private async _resolveAndHealTrackingNumber(
    page: Page,
    receipt: ParsedReceiptData,
  ): Promise<string> {
    const rawDigits = (receipt.trackingNumber || "").replace(/\D/g, "");
    if (!rawDigits || rawDigits.length < 12) {
      return receipt.trackingNumber || "";
    }

    const KNOWN_GOGAS_STATIONS = ["14764", "12009", "11001", "10549"];
    const textContext = `${receipt.address || ""} ${receipt.rawText || ""}`;

    let resolvedStation = (receipt.stationNumber || "").replace(/\D/g, "");
    if (/BUQUE\s*DE\s*VELA|BVE190821/i.test(textContext)) {
      resolvedStation = "14764";
    } else if (/DELFINES|SDE070824/i.test(textContext)) {
      resolvedStation = "10549";
    } else if (/AN[EÉ]MONAS|SSA120627/i.test(textContext)) {
      resolvedStation = "12009";
    } else if (/KABAH/i.test(textContext)) {
      resolvedStation = "11001";
    }

    const hammingDistance = (a: string, b: string): number => {
      if (a.length !== b.length) return 99;
      let d = 0;
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) d++;
      }
      return d;
    };

    const candidates: string[] = [];
    const addCandidate = (c: string) => {
      if (c && c.length >= 12 && !candidates.includes(c)) {
        candidates.push(c);
      }
    };

    const prefix5 = rawDigits.slice(0, 5);

    // 1. Station-prefixed candidate first if station has 5 digits and differs by <= 2 digits
    if (
      resolvedStation.length === 5 &&
      !rawDigits.startsWith(resolvedStation) &&
      hammingDistance(prefix5, resolvedStation) <= 2
    ) {
      addCandidate(resolvedStation + rawDigits.slice(5));
    }

    // 2. Original tracking number
    addCandidate(rawDigits);

    // 3. Any known GoGas 5-digit station within Hamming distance <= 2 of the prefix
    for (const st of KNOWN_GOGAS_STATIONS) {
      if (hammingDistance(prefix5, st) <= 2) {
        addCandidate(st + rawDigits.slice(5));
      }
    }

    // 4. Single-digit OCR confusion variants of top base candidates
    const confusionMap: Record<string, string[]> = {
      "0": ["6", "8", "9"],
      "6": ["0", "8", "5"],
      "8": ["0", "6", "3"],
      "5": ["6"],
      "1": ["7"],
      "7": ["1", "2"],
      "2": ["7"],
      "3": ["8"],
      "4": ["9"],
      "9": ["4", "0"],
    };

    const baseList = [...candidates];
    for (const base of baseList) {
      // First vary the 5-digit station prefix positions, then the remaining positions
      for (let i = 0; i < base.length; i++) {
        const swaps = confusionMap[base[i]];
        if (!swaps) continue;
        for (const replacement of swaps) {
          addCandidate(base.slice(0, i) + replacement + base.slice(i + 1));
          if (candidates.length >= 48) break;
        }
        if (candidates.length >= 48) break;
      }
      if (candidates.length >= 48) break;
    }

    const defaultCandidate = candidates[0] || rawDigits;

    try {
      const probeResult = await page.evaluate(async (candidateList: string[]) => {
        let alreadyBilledCandidate: string | null = null;
        const batchSize = 6;
        for (let i = 0; i < candidateList.length; i += batchSize) {
          const batch = candidateList.slice(i, i + batchSize);
          const results = await Promise.all(
            batch.map(async (candidate) => {
              try {
                const url = `../ria/data_check.php?f_name=ticketValidate&ticket=${encodeURIComponent(
                  candidate,
                )}&tickets_all=${encodeURIComponent(candidate)}&apc=QVVU`;
                const resp = await fetch(url, { method: "POST" });
                const data: any = await resp.json();
                return { candidate, data };
              } catch {
                return { candidate, data: null };
              }
            }),
          );

          for (const item of results) {
            if (!item.data) continue;
            if (Number(item.data.ret) === 1 || Number(item.data.msg_id) === 100) {
              return {
                validCandidate: item.candidate,
                alreadyBilledCandidate,
              };
            }
            if (Number(item.data.msg_id) === 743 && !alreadyBilledCandidate) {
              alreadyBilledCandidate = item.candidate;
            }
          }
        }
        return { validCandidate: null, alreadyBilledCandidate };
      }, candidates);

      if (probeResult?.validCandidate) {
        if (probeResult.validCandidate !== receipt.trackingNumber) {
          Logger.info(
            "FacturasGas",
            `Auto-healed tracking number from "${receipt.trackingNumber}" to "${probeResult.validCandidate}" (verified by portal)`,
          );
        }
        receipt.trackingNumber = probeResult.validCandidate;
        return probeResult.validCandidate;
      }

      if (probeResult?.alreadyBilledCandidate) {
        if (probeResult.alreadyBilledCandidate !== receipt.trackingNumber) {
          Logger.info(
            "FacturasGas",
            `Auto-healed tracking number from "${receipt.trackingNumber}" to "${probeResult.alreadyBilledCandidate}" (already billed on portal)`,
          );
        }
        receipt.trackingNumber = probeResult.alreadyBilledCandidate;
        return probeResult.alreadyBilledCandidate;
      }
    } catch (err: any) {
      Logger.debug(
        "FacturasGas",
        `Ticket auto-heal probe skipped/failed: ${err.message}`,
      );
    }

    if (defaultCandidate !== receipt.trackingNumber) {
      Logger.warn(
        "FacturasGas",
        `Reconciled tracking number prefix from "${receipt.trackingNumber}" to "${defaultCandidate}"`,
      );
      receipt.trackingNumber = defaultCandidate;
    }

    return defaultCandidate;
  }

  private resolvePaymentMethodCode(
    receiptPaymentMethod: string,
    profilePaymentMethod?: string,
  ): string {
    const normalized = this.normalizePaymentText(receiptPaymentMethod);
    if (this.hasDebitCardSignal(normalized)) return "3";
    if (this.hasCreditCardSignal(normalized)) return "2";
    if (this.hasCashSignal(normalized)) return "1";
    if (/\b(?:SERVICIO|VALE)\b/.test(normalized)) return "4";
    if (/\bTRANSFERENCIA\b/.test(normalized)) return "10";
    if (/\bCHEQUE\b/.test(normalized)) return "11";
    return profilePaymentMethod || "2";
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
}
