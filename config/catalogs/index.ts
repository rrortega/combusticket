import fs from 'fs';
import path from 'path';

function loadJson(filename: string) {
  const filePath = path.resolve(process.cwd(), 'config/catalogs', filename);
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

export const RegimenesFiscalesCatalog = loadJson('regimenes_fiscales.json');
export const UsosCfdiCatalog = loadJson('usos_cfdi.json');
export const FormasPagoCatalog = loadJson('formas_pago.json');
