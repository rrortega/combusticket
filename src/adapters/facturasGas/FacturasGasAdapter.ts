import { Page } from 'playwright-core';
import path from 'path';
import fs from 'fs';
import { IBillingPortalAdapter } from '../../core/interfaces/IBillingPortalAdapter.js';
import {
  ParsedReceiptData,
  BillingProfile,
  AutomationOptions,
  InvoiceResult,
  PortalDescriptor,
} from '../../core/types.js';
import { Logger } from '../../utils/logger.js';

export class FacturasGasAdapter implements IBillingPortalAdapter {
  public readonly descriptor: PortalDescriptor = {
    id: 'facturasgas',
    name: 'FacturasGas (GoGas / Red FacturasGas)',
    supportedDomains: ['facturasgas.com', 'www.facturasgas.com'],
    supportedBrands: ['GOGAS', 'SERVICIO SEIS ANEMONAS'],
  };

  public canHandle(receipt: ParsedReceiptData): boolean {
    const url = (receipt.billingUrl || '').toLowerCase();
    const brand = (receipt.gasStation || '').toUpperCase();
    const raw = (receipt.rawText || '').toLowerCase();

    return (
      url.includes('facturasgas.com') ||
      brand.includes('GOGAS') ||
      raw.includes('facturasgas.com')
    );
  }

  public async execute(
    page: Page,
    receipt: ParsedReceiptData,
    profile: BillingProfile,
    options: AutomationOptions = {}
  ): Promise<InvoiceResult> {
    const dryRun = options.dryRun ?? false;
    const screenshotDir = path.resolve(options.screenshotDir || 'output');
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }

    let targetUrl = receipt.billingUrl.replace('://www.', '://');
    if (!targetUrl.includes('autofactura.php')) {
      targetUrl = targetUrl.replace(/\/$/, '') + '/facturacion/autofactura.php';
    }

    Logger.info('FacturasGas', `Navigating to ${targetUrl}...`);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: options.timeoutMs || 30000 });
    await page.waitForTimeout(1200);

    // Suppress Bootstrap popovers, alert banners, and jQuery UI autocomplete dropdowns to prevent layout jumping
    await page.addStyleTag({
      content: '.popover, .ui-autocomplete, .alert, .alert-warning { display: none !important; opacity: 0 !important; visibility: hidden !important; }',
    }).catch(() => {});

    await page.evaluate(`
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
    `).catch(() => {});

    Logger.info('FacturasGas', 'Filling billing profile into form...');
    const paymentCode = this.resolvePaymentMethodCode(receipt.paymentMethod, profile.formaPago);

    // Step 1: Select Dropdowns with realistic pacing
    const selectsToSet = [
      { id: '#CdCfdiRegimen', val: profile.regimenFiscal, label: 'Régimen Fiscal' },
      { id: '#CfdiMetodoPago', val: paymentCode, label: 'Forma de Pago' },
      { id: '#CdUsoCfdi', val: profile.usoCfdi, label: 'Uso de CFDI' },
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
        Logger.debug('FacturasGas', `Set select ${item.label} (${item.id}) to: "${item.val}"`);
        await page.waitForTimeout(350);
      }
    }

    // Step 2: Fill text fields sequentially with visible HTML attribute & event dispatching
    const textFields: Array<{ selector: string; value: string; label: string }> = [
      { selector: '#RFC', value: profile.rfc, label: 'RFC' },
      { selector: '#RazonSocial', value: profile.razonSocial, label: 'Razón Social' },
      { selector: '#Email', value: profile.email, label: 'Email' },
      { selector: '#Email_verif', value: profile.emailConfirm, label: 'Confirmar Email' },
      { selector: '#CP', value: profile.codigoPostal, label: 'Código Postal' },
    ];

    Logger.debug('FacturasGas', 'Profile data to fill:', {
      rfc: profile.rfc,
      razonSocial: profile.razonSocial,
      email: profile.email,
      codigoPostal: profile.codigoPostal,
      regimen: profile.regimenFiscal,
      pago: paymentCode,
      uso: profile.usoCfdi,
    });

    // Pre-assign both Email inputs so the portal validator never detects a temporary mismatch
    await page.evaluate(`
      (() => {
        const e1 = document.querySelector('#Email');
        const e2 = document.querySelector('#Email_verif');
        if (e1) { e1.value = ${JSON.stringify(profile.email)}; e1.setAttribute('value', ${JSON.stringify(profile.email)}); }
        if (e2) { e2.value = ${JSON.stringify(profile.emailConfirm)}; e2.setAttribute('value', ${JSON.stringify(profile.emailConfirm)}); }
      })()
    `).catch(() => {});

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
        Logger.debug('FacturasGas', `Filled ${field.label} (${field.selector}): "${field.value}"`);
        await page.waitForTimeout(350);
      }
    }

    // Step 3: Type Ticket number into #Ticket field
    if (receipt.trackingNumber) {
      await page.evaluate(`
        (() => {
          const el = document.querySelector('#Ticket');
          if (el) {
            el.focus();
            el.value = ${JSON.stringify(receipt.trackingNumber)};
            el.setAttribute('value', ${JSON.stringify(receipt.trackingNumber)});
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        })()
      `);
      Logger.debug('FacturasGas', `Filled Ticket (#Ticket): "${receipt.trackingNumber}"`);
      await page.waitForTimeout(400);
    }

    // Clean up any jQuery UI autocomplete overlays
    await page.evaluate(`
      (() => {
        document.querySelectorAll('.ui-autocomplete').forEach((el) => el.remove());
        if (window.$ && window.$('#RFC') && window.$('#RFC').autocomplete) {
          try {
            window.$('#RFC').autocomplete('close');
          } catch {}
        }
      })()
    `);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);

    // Step 4: Click "Agregar" to register ticket into the invoice list
    Logger.info('FacturasGas', `Registering ticket: ${receipt.trackingNumber}...`);
    await page.click('#Button_Add');
    await page.waitForTimeout(2500);

    const ticketStatus = await page.evaluate(`
      (() => {
        const ticketHelp = document.querySelector('#Ticket_help')?.textContent?.trim() || '';
        const ticketsVal = document.querySelector('#Tickets')?.value || '';
        const showTickets = document.querySelector('#show_tickets')?.innerHTML || '';
        return { ticketHelp, ticketsVal, showTickets };
      })()
    `) as { ticketHelp: string; ticketsVal: string; showTickets: string };

    Logger.info(
      'FacturasGas',
      `Registered tickets: "${ticketStatus.ticketsVal}", Validation status: "${ticketStatus.ticketHelp || 'OK'}"`
    );

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filledScreenshot = path.join(screenshotDir, `facturasgas_${timestamp}.png`);
    await page.screenshot({ path: filledScreenshot, fullPage: true });

    let submitted = false;
    let isSuccess = true;
    let finalMessage = `Formulario verificado para ticket ${receipt.trackingNumber}.`;
    let evidenceScreenshot = filledScreenshot;
    let downloadedPdfPath: string | undefined;

    if (!dryRun) {
      Logger.info('FacturasGas', 'Submitting invoice: Clicking "Solicitar Factura" (#Button_Insert)...');

      // Automatically accept any confirmation dialog
      page.on('dialog', async (dialog) => {
        Logger.info('FacturasGas', `Dialog detected: "${dialog.message()}". Accepting...`);
        await dialog.accept().catch(() => {});
      });

      // Unhide alerts so result/confirmation banners on the resulting page are visible
      await page.addStyleTag({
        content: '.alert, .alert-success, .alert-danger, .alert-warning, .alert-info { display: block !important; opacity: 1 !important; visibility: visible !important; }',
      }).catch(() => {});

      try {
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => null),
          page.click('#Button_Insert', { timeout: 10000 }),
        ]);
      } catch (err: any) {
        Logger.warn('FacturasGas', `Navigation notice on submit: ${err.message}`);
      }

      await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => null);
      await page.waitForLoadState('load', { timeout: 30000 }).catch(() => null);
      await page.waitForTimeout(3000);

      const submittedScreenshot = path.join(screenshotDir, `facturasgas_submitted_${timestamp}.png`);
      try {
        await page.screenshot({ path: submittedScreenshot });
        evidenceScreenshot = submittedScreenshot;
      } catch (e: any) {
        Logger.warn('FacturasGas', `Viewport screenshot notice, retrying after pause: ${e.message}`);
        await page.waitForTimeout(2000);
        try {
          await page.screenshot({ path: submittedScreenshot });
          evidenceScreenshot = submittedScreenshot;
        } catch {}
      }

      // Retry evaluate up to 4 times with delays to prevent navigation context loss
      let pageOutcome: any = null;
      for (let attempt = 1; attempt <= 4; attempt++) {
        try {
          pageOutcome = await page.evaluate(() => {
            const alertElements = Array.from(
              document.querySelectorAll('#dynamic_custom_error, .alert, .alert-warning, .alert-danger, .alert-success, .mensaje, #mensaje, #Ticket_help')
            );
            const alerts = alertElements
              .map((el) => el.textContent?.trim() || '')
              .filter((t) => t.length > 5);

            const bodyText = document.body?.innerText || '';

            const pdfLink = (document.querySelector('a[href*=".pdf"], a[href*="descargar"], a[href*="Descargar"]') as HTMLAnchorElement)?.href || null;
            const xmlLink = (document.querySelector('a[href*=".xml"]') as HTMLAnchorElement)?.href || null;

            // Check for specific rejection / already-billed patterns
            const alreadyBilledRegex = /ya\s*(?:fue|se\s*encuentra|est[aá])\s*facturado|\(743\)|ya\s*ha\s*sido\s*facturado/i;
            const invalidTicketRegex = /ticket.*(?:no\s*es\s*v[aá]lido|no\s*existe|incorrecto|inv[aá]lido)|\(901\)|\(902\)|\(903\)/i;
            const expiredRegex = /periodo.*(?:vencido|cerrado)|fuera\s*de\s*tiempo|mes\s*en\s*curso/i;

            const isAlreadyBilled = alreadyBilledRegex.test(bodyText) || alerts.some((a) => alreadyBilledRegex.test(a));
            const isInvalid = invalidTicketRegex.test(bodyText) || alerts.some((a) => invalidTicketRegex.test(a));
            const isExpired = expiredRegex.test(bodyText) || alerts.some((a) => expiredRegex.test(a));

            // Locate any explicit alert text matching the rejection
            let rejectionMessage = '';
            for (const alert of alerts) {
              if (alreadyBilledRegex.test(alert) || invalidTicketRegex.test(alert) || expiredRegex.test(alert)) {
                rejectionMessage = alert;
                break;
              }
            }

            if (!rejectionMessage && isAlreadyBilled) {
              const match = bodyText.match(/El ticket\s*['"]?[^'"]+['"]?\s*ya fue facturado[^\n.]*(?:\([0-9]+\))?/i);
              if (match) {
                rejectionMessage = match[0];
              }
            }

            const formStillActive = Boolean(document.querySelector('#Button_Insert') || document.querySelector('#RFC'));

            return {
              alerts,
              isAlreadyBilled,
              isInvalid,
              isExpired,
              rejectionMessage,
              formStillActive,
              pdfLink,
              xmlLink,
            };
          });
          if (pageOutcome) break;
        } catch (evalErr: any) {
          Logger.warn('FacturasGas', `Outcome evaluation attempt #${attempt} error: ${evalErr.message}`);
          await page.waitForTimeout(2000);
        }
      }

      Logger.info('FacturasGas', 'Resulting outcome evaluation:', pageOutcome);

      let downloadedPdfPath: string | undefined;

      if (!pageOutcome) {
        submitted = false;
        isSuccess = false;
        finalMessage = 'No se pudo confirmar la generación de la factura en el portal.';
        Logger.warn('FacturasGas', `Evaluation failed closed: "${finalMessage}"`);
      } else if (pageOutcome.isAlreadyBilled || pageOutcome.isInvalid || pageOutcome.isExpired) {
        submitted = false;
        isSuccess = false;
        finalMessage =
          pageOutcome.rejectionMessage ||
          (pageOutcome.isAlreadyBilled
            ? `El ticket '${receipt.trackingNumber}' ya fue facturado previamente en el portal.`
            : `El ticket '${receipt.trackingNumber}' fue rechazado por el portal.`);
        Logger.warn('FacturasGas', `Portal rejection detected: "${finalMessage}"`);
      } else if (pageOutcome.formStillActive && !pageOutcome.pdfLink && !pageOutcome.xmlLink) {
        // Form is still active on screen with no downloads -> submission failed or stayed on form
        submitted = false;
        isSuccess = false;
        finalMessage = pageOutcome.alerts.length > 0
          ? pageOutcome.alerts.join(' | ')
          : `El formulario no avanzó para el ticket ${receipt.trackingNumber}.`;
        Logger.warn('FacturasGas', `Submission did not complete: "${finalMessage}"`);
      } else {
        submitted = true;
        isSuccess = true;
        finalMessage =
          pageOutcome.alerts.length > 0
            ? pageOutcome.alerts.join(' | ')
            : `Factura solicitada con éxito para el ticket ${receipt.trackingNumber}. Evidencia capturada en ${path.basename(submittedScreenshot)}.`;

        // If portal provided a direct PDF download link, fetch and store it locally
        if (pageOutcome.pdfLink) {
          try {
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
              Logger.info('FacturasGas', `PDF invoice downloaded to: ${targetPdfPath}`);
            }
          } catch (pdfErr: any) {
            Logger.warn('FacturasGas', `Could not download PDF file directly: ${pdfErr.message}`);
          }
        }
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
        rejectionReason: !isSuccess ? finalMessage : undefined,
      },
    };
  }

  private resolvePaymentMethodCode(receiptPaymentMethod: string, profilePaymentMethod?: string): string {
    const normalized = (receiptPaymentMethod || '').toUpperCase();
    if (normalized.includes('EFECTIVO')) return '1';
    if (normalized.includes('DEBITO') || normalized.includes('DÉBITO')) return '3';
    if (
      normalized.includes('CREDITO') ||
      normalized.includes('CRÉDITO') ||
      normalized.includes('VISA') ||
      normalized.includes('MC') ||
      normalized.includes('MASTERCARD')
    ) {
      return '2';
    }
    if (normalized.includes('TRANSFERENCIA')) return '10';
    if (normalized.includes('CHEQUE')) return '11';
    return profilePaymentMethod || '2';
  }
}
