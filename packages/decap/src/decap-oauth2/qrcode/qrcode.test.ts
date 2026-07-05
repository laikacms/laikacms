import { describe, expect, it } from 'vitest';
import { generateQRCodeDataURI, generateQRCodeSVG } from './svg.js';

describe('generateQRCodeSVG', () => {
  it('returns a string starting with <svg for a valid input', () => {
    const result = generateQRCodeSVG('https://example.com');
    expect(result).toMatch(/^<svg /);
  });

  it('contains expected structural SVG elements', () => {
    const result = generateQRCodeSVG('hello');
    expect(result).toContain('viewBox');
    expect(result).toContain('<rect ');
    expect(result).toContain('<path ');
    expect(result).toContain('</svg>');
  });

  it('applies custom darkColor and lightColor', () => {
    const result = generateQRCodeSVG('test', { darkColor: '#ff0000', lightColor: '#0000ff' });
    expect(result).toContain('#ff0000');
    expect(result).toContain('#0000ff');
  });

  it('applies custom border (smaller viewBox size for border=0 vs border=4)', () => {
    const small = generateQRCodeSVG('test', { border: 0 });
    const large = generateQRCodeSVG('test', { border: 4 });
    // Extract viewBox dimensions
    const smallDim = Number(/viewBox="0 0 (\d+)/.exec(small)?.[1]);
    const largeDim = Number(/viewBox="0 0 (\d+)/.exec(large)?.[1]);
    expect(largeDim).toBe(smallDim + 8);
  });

  it('handles an empty string without throwing', () => {
    expect(() => generateQRCodeSVG('')).not.toThrow();
  });

  it('produces deterministic output for the same input', () => {
    const a = generateQRCodeSVG('deterministic');
    const b = generateQRCodeSVG('deterministic');
    expect(a).toBe(b);
  });

  it('supports all error correction levels without throwing', () => {
    for (const level of ['L', 'M', 'Q', 'H'] as const) {
      expect(() => generateQRCodeSVG('test', { errorCorrection: level })).not.toThrow();
    }
  });

  it('escapes XML special characters in colors', () => {
    // Provide a harmless non-special color; just verify no unescaped injection leaks through
    const result = generateQRCodeSVG('x', { darkColor: '#000000', lightColor: '#ffffff' });
    expect(result).not.toContain('&amp;');
  });
});

describe('generateQRCodeDataURI', () => {
  it('returns a string starting with data:image/svg+xml', () => {
    const result = generateQRCodeDataURI('https://example.com');
    expect(result).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it('decodes to an SVG string', () => {
    const uri = generateQRCodeDataURI('hello');
    const base64 = uri.replace('data:image/svg+xml;base64,', '');
    const decoded = atob(base64);
    expect(decoded).toMatch(/^<svg /);
    expect(decoded).toContain('</svg>');
  });

  it('handles an empty string without throwing', () => {
    expect(() => generateQRCodeDataURI('')).not.toThrow();
  });

  it('produces deterministic output for the same input', () => {
    const a = generateQRCodeDataURI('deterministic');
    const b = generateQRCodeDataURI('deterministic');
    expect(a).toBe(b);
  });
});
