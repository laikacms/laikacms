/**
 * QR Code SVG Generator
 * 
 * Generates SVG representations of QR codes using the qrcode.ts library.
 */

import { QrCode, Ecc } from './qrcode.js';

/**
 * Options for QR code SVG generation
 */
export interface QRCodeSVGOptions {
  /** Error correction level: 'L' (7%), 'M' (15%), 'Q' (25%), 'H' (30%). Default: 'M' */
  errorCorrection?: 'L' | 'M' | 'Q' | 'H';
  /** Border size in modules (quiet zone). Default: 4 */
  border?: number;
  /** Color of the dark modules. Default: '#000000' */
  darkColor?: string;
  /** Color of the light modules. Default: '#ffffff' */
  lightColor?: string;
}

/**
 * Maps error correction level strings to Ecc enum values
 */
function getEccLevel(level: 'L' | 'M' | 'Q' | 'H'): Ecc {
  switch (level) {
    case 'L': return Ecc.LOW;
    case 'M': return Ecc.MEDIUM;
    case 'Q': return Ecc.QUARTILE;
    case 'H': return Ecc.HIGH;
  }
}

/**
 * Escapes special XML characters in a string
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generates an SVG string representation of a QR code for the given text.
 * 
 * @param text - The text to encode in the QR code
 * @param options - Optional configuration for the QR code generation
 * @returns An SVG string that can be embedded in HTML or saved to a file
 * 
 * @example
 * ```typescript
 * const svg = generateQRCodeSVG('https://example.com');
 * // Returns an SVG string with default options
 * 
 * const customSvg = generateQRCodeSVG('Hello World', {
 *   errorCorrection: 'H',
 *   border: 2,
 *   darkColor: '#1a1a1a',
 *   lightColor: '#f5f5f5'
 * });
 * ```
 */
export function generateQRCodeSVG(text: string, options: QRCodeSVGOptions = {}): string {
  const {
    errorCorrection = 'M',
    border = 4,
    darkColor = '#000000',
    lightColor = '#ffffff',
  } = options;

  // Generate the QR code
  const ecc = getEccLevel(errorCorrection);
  const qr = QrCode.encodeText(text, ecc);

  // Calculate dimensions
  const size = qr.size + border * 2;

  // Build the SVG path for dark modules
  // Using a single path with multiple rectangles is more efficient than individual rects
  const parts: string[] = [];
  
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.getModule(x, y)) {
        // Add a 1x1 rectangle at position (x + border, y + border)
        parts.push(`M${x + border},${y + border}h1v1h-1z`);
      }
    }
  }

  const pathData = parts.join('');

  // Build the SVG
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">`,
    `<rect width="100%" height="100%" fill="${escapeXml(lightColor)}"/>`,
    `<path d="${pathData}" fill="${escapeXml(darkColor)}"/>`,
    `</svg>`
  ].join('');

  return svg;
}

/**
 * Generates a data URI for a QR code SVG that can be used directly in img src attributes.
 * 
 * @param text - The text to encode in the QR code
 * @param options - Optional configuration for the QR code generation
 * @returns A data URI string (data:image/svg+xml;base64,...)
 * 
 * @example
 * ```typescript
 * const dataUri = generateQRCodeDataURI('https://example.com');
 * // Use in HTML: <img src="${dataUri}" alt="QR Code" />
 * ```
 */
export function generateQRCodeDataURI(text: string, options: QRCodeSVGOptions = {}): string {
  const svg = generateQRCodeSVG(text, options);
  // Use base64 encoding for better compatibility
  const base64 = btoa(svg);
  return `data:image/svg+xml;base64,${base64}`;
}
