import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs';
import path from 'path';
import { GasInvoiceService } from '../../services/gasInvoiceService.js';
import { BillingProfile } from '../../core/types.js';

export async function startMcpServer() {
  const service = await GasInvoiceService.createDefault();

  const server = new Server(
    {
      name: 'gas-invoice-mcp',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'invoice_receipt',
          description:
            'Extracts receipt data via local OCR, connects to Obscura stealth browser, and automates fuel invoice generation on the gas station portal.',
          inputSchema: {
            type: 'object',
            properties: {
              imagePath: {
                type: 'string',
                description: 'Local file path to the gas receipt image',
              },
              imageBase64: {
                type: 'string',
                description: 'Base64 encoded string of receipt image',
              },
              dryRun: {
                type: 'boolean',
                description: 'When true (default), fills and validates form without clicking final submit button',
                default: true,
              },
              profile: {
                type: 'object',
                description: 'Optional custom billing profile. If omitted, uses config/billing_profile.json',
              },
            },
          },
        },
        {
          name: 'parse_receipt',
          description:
            'Extracts structured receipt data (gas station, tracking number, amount, date, payment method, portal URL) using local OCR without launching browser.',
          inputSchema: {
            type: 'object',
            properties: {
              imagePath: {
                type: 'string',
                description: 'Local file path to receipt image',
              },
              imageBase64: {
                type: 'string',
                description: 'Base64 encoded string of receipt image',
              },
            },
          },
        },
        {
          name: 'list_supported_portals',
          description: 'Lists all registered gas station billing portal adapters and supported domains/brands.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'get_billing_profile',
          description: 'Retrieves the currently configured default billing profile.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
      ],
    };
  });

  // Handle tool execution
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    try {
      if (name === 'list_supported_portals') {
        const portals = service.getSupportedPortals();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(portals, null, 2),
            },
          ],
        };
      }

      if (name === 'get_billing_profile') {
        const profile = service.loadBillingProfile();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(profile, null, 2),
            },
          ],
        };
      }

      if (name === 'parse_receipt') {
        let input: string | Buffer;
        if (args.imageBase64 && typeof args.imageBase64 === 'string') {
          input = Buffer.from(args.imageBase64, 'base64');
        } else if (args.imagePath && typeof args.imagePath === 'string') {
          input = path.resolve(args.imagePath);
        } else {
          throw new Error('Either imagePath or imageBase64 must be provided.');
        }

        const data = await service.parseReceiptOnly(input);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      if (name === 'invoice_receipt') {
        let input: string | Buffer;
        if (args.imageBase64 && typeof args.imageBase64 === 'string') {
          input = Buffer.from(args.imageBase64, 'base64');
        } else if (args.imagePath && typeof args.imagePath === 'string') {
          input = path.resolve(args.imagePath);
        } else {
          throw new Error('Either imagePath or imageBase64 must be provided.');
        }

        const dryRun = args.dryRun !== false;
        const profile = args.profile as BillingProfile | undefined;

        const result = await service.processReceipt(input, profile, { dryRun });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      throw new Error(`Unknown tool: ${name}`);
    } catch (err: any) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error executing ${name}: ${err.message}`,
          },
        ],
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[GasInvoice MCP] Server running on stdio');
}

if (process.argv[1]?.endsWith('mcp/server.ts') || process.argv[1]?.endsWith('mcp/server.js')) {
  startMcpServer().catch((err) => {
    console.error('[GasInvoice MCP] Fatal error:', err);
    process.exit(1);
  });
}
