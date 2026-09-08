# FacturaGasolina — Servicio Cloud de Facturación con Obscura y Arquitectura Hexagonal / SOLID

Servicio modular para la extracción de datos fiscales de tickets de gasolina mediante **OCR local/cloud** y navegación desatendida mediante **Obscura** (headless browser anti-fingerprint con stealth para agentes de IA) y **Playwright (CDP)**.

El sistema está diseñado siguiendo **Clean Architecture** y principios **SOLID**, utilizando el patrón **Strategy / Adapter** para soportar de manera desacoplada múltiples portales de gasolineras, con interfaces expuestas tanto por **MCP (Model Context Protocol)** como por **REST API**.

---

## 🏛 Principios de Diseño y Arquitectura SOLID

| Principio | Implementación en este proyecto |
|---|---|
| **S - Single Responsibility** | Cada capa tiene una única razón para cambiar: motores OCR (`IOcrEngine`), parsers (`ReceiptParser`), ciclo de vida del browser (`IBrowserManager`), lógica específica de portal (`IBillingPortalAdapter`) y orquestación (`GasInvoiceService`). |
| **O - Open / Closed** | Para soportar una nueva gasolinera (ej. OXXO Gas, Petro-7, Hidrosina), solo se implementa una nueva clase que cumpla con `IBillingPortalAdapter` y se registra en `BillingPortalRegistry`. No se modifica el orquestador ni los adaptadores existentes. |
| **L - Liskov Substitution** | Todos los adaptadores de portal implementan `IBillingPortalAdapter` de manera polimórfica. El orquestador puede invocar `adapter.execute(...)` sobre cualquier gasolinera sin preocuparse por la implementación interna. |
| **I - Interface Segregation** | Interfaces granulares y desacopladas: `IOcrEngine`, `IBrowserManager`, `IBillingPortalAdapter`. |
| **D - Dependency Inversion** | El orquestador de dominio `GasInvoiceService` depende estrictamente de abstracciones (`IOcrEngine`, `IBrowserManager`, `BillingPortalRegistry`), utilizando un motor cross-platform universal (`TesseractOcrEngine` optimizado con `sharp`) garantizando 100% paridad entre desarrollo local y producción en VPS Linux. |

---

## 📁 Estructura del Proyecto

```
facturagasolina/
├── config/
│   └── billing_profile.json              # Mock de datos de facturación del receptor
├── fixtures/
│   ├── receipt_sample.png                # Recibo de gasolina muestra (GOGAS)
│   └── form_sample.png                   # Captura del formulario a rellenar
├── output/                               # Screenshots de auditoría y evidencia
├── public/                               # Playground Web interactivo (:4000)
├── src/
│   ├── core/
│   │   ├── types.ts                      # Entidades y contratos de dominio
│   │   └── interfaces/
│   │       ├── IOcrEngine.ts             # Contrato de OCR
│   │       ├── IBrowserManager.ts        # Contrato de gestión de browser CDP
│   │       └── IBillingPortalAdapter.ts  # Contrato de portal de gasolinera (Strategy)
│   ├── adapters/
│   │   ├── portalRegistry.ts             # Registro y resolución dinámica de adaptadores
│   │   ├── facturasGas/
│   │   │   └── FacturasGasAdapter.ts     # Adaptador para FacturasGas / GoGas
│   │   └── generic/
│   │       └── GenericGasAdapter.ts      # Adaptador genérico fallback
│   ├── ocr/
│   │   ├── ocrFactory.ts                 # Factory universal de OCR
│   │   ├── receiptParser.ts              # Extractor heurístico resiliente a ruido OCR
│   │   └── engines/
│   │       └── TesseractOcrEngine.ts     # Tesseract.js + preprocesamiento Sharp
│   ├── browser/
│   │   └── obscuraManager.ts             # Daemon de Obscura CDP con stealth
│   ├── services/
│   │   └── gasInvoiceService.ts          # Orquestador del pipeline de facturación
│   ├── interfaces/
│   │   ├── mcp/
│   │   │   └── server.ts                 # Servidor Model Context Protocol (MCP)
│   │   ├── http/
│   │   │   └── server.ts                 # Servidor REST API (Express + Multer)
│   │   └── cli/
│   └── index.ts                          # CLI runner
├── obscura                               # Binario de Obscura (CDP server)
├── package.json
└── tsconfig.json
```

---

## 🔌 Cómo agregar una nueva Gasolinera (Patrón Adapter)

Para dar soporte a un nuevo portal de facturación:

1. Crea tu archivo en `src/adapters/<portal>/<Portal>Adapter.ts`:
```typescript
import { Page } from 'playwright-core';
import { IBillingPortalAdapter } from '../../core/interfaces/IBillingPortalAdapter.js';
import { ParsedReceiptData, BillingProfile, InvoiceResult, PortalDescriptor } from '../../core/types.js';

export class MiGasolineraAdapter implements IBillingPortalAdapter {
  public readonly descriptor: PortalDescriptor = {
    id: 'migasolinera',
    name: 'Mi Gasolinera S.A.',
    supportedDomains: ['migasolinera.com'],
    supportedBrands: ['MIGAS'],
  };

  public canHandle(receipt: ParsedReceiptData): boolean {
    return (
      receipt.billingUrl.includes('migasolinera.com') ||
      receipt.gasStation.toUpperCase().includes('MIGAS')
    );
  }

  public async execute(page: Page, receipt: ParsedReceiptData, profile: BillingProfile): Promise<InvoiceResult> {
    await page.goto(receipt.billingUrl);
    // ... completar formulario ...
    return {
      success: true,
      portalId: this.descriptor.id,
      receipt,
      billingProfile: profile,
      formFilled: true,
      submitted: false,
      message: 'Factura procesada con éxito',
    };
  }
}
```

2. Regístralo en `BillingPortalRegistry`:
```typescript
registry.register(new MiGasolineraAdapter());
```
¡Listo! La resolución es 100% automática en tiempo de ejecución.

---

## 🚀 Modos de Ejecución

### 1. Servidor MCP (Model Context Protocol)
Inicia el servidor MCP para conectar agentes de IA (Claude Desktop, Cursor, Antigravity, etc.):
```bash
npm run mcp
```
**Herramientas expuestas:**
- `invoice_receipt`: extrae datos por OCR y factura mediante Obscura.
- `parse_receipt`: extrae los metadatos del ticket sin levantar el browser.
- `list_supported_portals`: lista los portales soportados.
- `get_billing_profile`: obtiene el perfil fiscal actual.

### 2. Servidor REST API (Cloud Server)
Levanta la API HTTP para microservicios y webhooks:
```bash
npm run api
```
- `POST /api/invoice`: multipart file (`receipt`) o JSON (`{ "imageBase64": "...", "dryRun": true }`).
- `POST /api/ocr`: devuelve los datos extraídos del recibo en JSON.
- `GET /api/portals`: lista los adaptadores activos.
- `GET /health`: estado del servicio.

### 3. CLI Directo
- **Prueba en seco (Dry Run)**:
  ```bash
  npm run invoice -- fixtures/receipt_sample.png
  ```
- **Envío real**:
  ```bash
  npm run invoice:submit -- fixtures/receipt_sample.png
  ```
- **Compilar**:
  ```bash
  npm run build
  ```
# combusticket
