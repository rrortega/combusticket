import { GasInvoiceService } from './services/gasInvoiceService.js';
import { ENV } from './config/env.js';

async function main() {
  const args = process.argv.slice(2);
  let imagePath = 'fixtures/receipt_sample.png';
  let dryRun = ENV.DRY_RUN;
  let takeScreenshot = ENV.TAKE_SCREENSHOT;
  let profilePath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--submit') {
      dryRun = false;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--screenshot') {
      takeScreenshot = true;
    } else if (arg === '--no-screenshot') {
      takeScreenshot = false;
    } else if (arg === '--profile' && args[i + 1]) {
      profilePath = args[++i];
    } else if (!arg.startsWith('-')) {
      imagePath = arg;
    }
  }

  const service = await GasInvoiceService.createDefault({
    profilePath,
  });

  try {
    const result = await service.processReceipt(imagePath, undefined, {
      dryRun,
      takeScreenshot,
    });

    console.log('\nFinal Result Summary:');
    console.log(JSON.stringify(
      {
        success: result.success,
        portal: result.portalId,
        trackingNumber: result.receipt.trackingNumber,
        gasStation: result.receipt.gasStation,
        amount: result.receipt.amount,
        submitted: result.submitted,
        screenshot: result.screenshotPath,
        message: result.message,
      },
      null,
      2
    ));

    if (!result.success) {
      process.exit(1);
    }
  } catch (error: any) {
    console.error('\n[FATAL ERROR]:', error.message);
    process.exit(1);
  }
}

main();
