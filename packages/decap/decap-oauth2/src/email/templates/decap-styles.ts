/**
 * Decap CMS Design System Constants
 *
 * These values are extracted from the official Decap CMS UI library
 * to ensure consistent styling across all templates.
 */

// ============================================================================
// Colors
// ============================================================================

export const colors = {
  // Raw colors
  white: '#fff',
  grayLight: '#eff0f4',
  gray: '#798291',
  grayDark: '#313d3e',
  blue: '#3a69c7',
  blueLight: '#e8f5fe',
  green: '#005614',
  greenLight: '#caef6f',
  brown: '#754e00',
  yellow: '#ffee9c',
  red: '#ff003b',
  redDark: '#D60032',
  redLight: '#fcefea',
  purple: '#70399f',
  purpleLight: '#f6d8ff',
  teal: '#17a2b8',
  tealDark: '#117888',
  tealLight: '#ddf5f9',

  // Semantic colors
  background: '#eff0f4',
  foreground: '#fff',
  text: '#798291',
  textLead: '#313d3e',
  textFieldBorder: '#dfdfe3',
  controlLabel: '#5D626F',
  button: '#313d3e',
  buttonHover: '#555a65',
  buttonText: '#fff',
  active: '#3a69c7',
  error: '#ff003b',
  errorBackground: '#fcefea',
  success: '#005614',
  successBackground: '#caef6f',
  warning: '#754e00',
  warningBackground: '#ffee9c',

  // Brand
  decapPink: '#FF0082',
} as const;

// ============================================================================
// Typography
// ============================================================================

export const fonts = {
  primary:
    `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"`,
  mono: `'SFMono-Regular', Consolas, "Liberation Mono", Menlo, Courier, monospace`,
} as const;

// ============================================================================
// Spacing & Sizing
// ============================================================================

export const lengths = {
  borderRadius: '5px',
  inputPadding: '10px',
  buttonHeight: '36px',
} as const;

// ============================================================================
// Shadows
// ============================================================================

export const shadows = {
  dropMain: '0 2px 6px 0 rgba(68, 74, 87, 0.05), 0 1px 3px 0 rgba(68, 74, 87, 0.1)',
  dropDeep: '0 4px 12px 0 rgba(68, 74, 87, 0.15), 0 1px 3px 0 rgba(68, 74, 87, 0.25)',
} as const;

// ============================================================================
// Decap CMS Logo SVG
// ============================================================================

export const decapLogoSvg =
  `<svg width="300" height="81" viewBox="0 0 335 90" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M30.73 0.149188L0 2.94919L3.67 43.1592L23.7 41.3292L21.71 19.4692L32.42 18.4892C43.03 17.5192 51.56 26.0192 52.71 38.6792L72.38 36.8892C70.34 14.7192 51.64 -1.75081 30.73 0.149188Z" fill="${colors.decapPink}"/>
  <path d="M73.61 49.5091C73.61 62.2291 65.88 71.4591 55.24 71.4591H44.49V49.4691H24.38V89.8891H55.24C76.26 89.8891 93.36 71.7791 93.36 49.5091C93.36 49.4991 93.36 49.4891 93.36 49.4691H73.61C73.61 49.4691 73.61 49.4891 73.61 49.5091Z" fill="${colors.decapPink}"/>
  <path d="M131.65 23.7092H151.66C166.07 23.7092 175.95 32.7992 175.95 46.7692C175.95 60.7392 166.07 69.8292 151.66 69.8292H131.65V23.7092ZM151.16 61.0592C159.91 61.0592 165.63 55.5892 165.63 46.7692C165.63 37.9492 159.9 32.4792 151.16 32.4792H141.85V61.0692H151.16V61.0592Z" fill="${colors.grayDark}"/>
  <path d="M207.61 58.6891L212.83 64.6191C209.68 68.3691 204.96 70.3491 198.86 70.3491C187.16 70.3491 179.54 62.6391 179.54 52.0991C179.54 41.5591 187.22 33.8491 197.66 33.8491C207.22 33.8491 215.09 40.4391 215.15 51.7691L190.11 56.8391C191.56 60.3291 194.7 62.1091 199.11 62.1091C202.7 62.1091 205.28 60.9891 207.61 58.6791V58.6891ZM189.17 51.0491L205.66 47.6891C204.72 44.0691 201.76 41.6291 197.67 41.6291C192.76 41.6291 189.36 45.0591 189.17 51.0491Z" fill="${colors.grayDark}"/>
  <path d="M218.25 52.0991C218.25 41.4291 226.12 33.8491 237.13 33.8491C244.24 33.8491 249.84 37.0791 252.3 42.8691L244.69 47.1491C242.86 43.7891 240.16 42.2791 237.08 42.2791C232.11 42.2791 228.21 45.8991 228.21 52.0891C228.21 58.2791 232.11 61.8991 237.08 61.8991C240.16 61.8991 242.87 60.4491 244.69 57.0291L252.3 61.3791C249.85 67.0491 244.25 70.3391 237.13 70.3391C226.12 70.3391 218.25 62.7591 218.25 52.0891V52.0991Z" fill="${colors.grayDark}"/>
  <path d="M290.93 34.3791V69.8191H281.55V65.7391C279.1 68.8391 275.51 70.3491 270.98 70.3491C261.41 70.3491 254.05 63.2391 254.05 52.0991C254.05 40.9591 261.41 33.8491 270.98 33.8491C275.13 33.8491 278.66 35.2291 281.11 38.1291V34.3791H290.93ZM281.3 52.0991C281.3 45.9691 277.52 42.2891 272.68 42.2891C267.84 42.2891 264 45.9791 264 52.0991C264 58.2191 267.78 61.9091 272.68 61.9091C277.58 61.9091 281.3 58.2191 281.3 52.0991Z" fill="${colors.grayDark}"/>
  <path d="M334.54 52.0991C334.54 63.2291 327.18 70.3491 317.68 70.3491C313.46 70.3491 310 68.9691 307.49 66.0691V82.5991H297.67V34.3791H307.05V38.4591C309.5 35.3591 313.15 33.8491 317.68 33.8491C327.18 33.8491 334.54 40.9591 334.54 52.0991ZM324.6 52.0991C324.6 45.9691 320.89 42.2891 315.98 42.2891C311.07 42.2891 307.36 45.9791 307.36 52.0991C307.36 58.2191 311.07 61.9091 315.98 61.9091C320.89 61.9091 324.6 58.2191 324.6 52.0991Z" fill="${colors.grayDark}"/>
</svg>`;

/**
 * Smaller logo for email headers (200px wide)
 */
export const decapLogoSvgSmall =
  `<svg width="200" height="54" viewBox="0 0 335 90" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M30.73 0.149188L0 2.94919L3.67 43.1592L23.7 41.3292L21.71 19.4692L32.42 18.4892C43.03 17.5192 51.56 26.0192 52.71 38.6792L72.38 36.8892C70.34 14.7192 51.64 -1.75081 30.73 0.149188Z" fill="${colors.decapPink}"/>
  <path d="M73.61 49.5091C73.61 62.2291 65.88 71.4591 55.24 71.4591H44.49V49.4691H24.38V89.8891H55.24C76.26 89.8891 93.36 71.7791 93.36 49.5091C93.36 49.4991 93.36 49.4891 93.36 49.4691H73.61C73.61 49.4691 73.61 49.4891 73.61 49.5091Z" fill="${colors.decapPink}"/>
  <path d="M131.65 23.7092H151.66C166.07 23.7092 175.95 32.7992 175.95 46.7692C175.95 60.7392 166.07 69.8292 151.66 69.8292H131.65V23.7092ZM151.16 61.0592C159.91 61.0592 165.63 55.5892 165.63 46.7692C165.63 37.9492 159.9 32.4792 151.16 32.4792H141.85V61.0692H151.16V61.0592Z" fill="${colors.grayDark}"/>
  <path d="M207.61 58.6891L212.83 64.6191C209.68 68.3691 204.96 70.3491 198.86 70.3491C187.16 70.3491 179.54 62.6391 179.54 52.0991C179.54 41.5591 187.22 33.8491 197.66 33.8491C207.22 33.8491 215.09 40.4391 215.15 51.7691L190.11 56.8391C191.56 60.3291 194.7 62.1091 199.11 62.1091C202.7 62.1091 205.28 60.9891 207.61 58.6791V58.6891ZM189.17 51.0491L205.66 47.6891C204.72 44.0691 201.76 41.6291 197.67 41.6291C192.76 41.6291 189.36 45.0591 189.17 51.0491Z" fill="${colors.grayDark}"/>
  <path d="M218.25 52.0991C218.25 41.4291 226.12 33.8491 237.13 33.8491C244.24 33.8491 249.84 37.0791 252.3 42.8691L244.69 47.1491C242.86 43.7891 240.16 42.2791 237.08 42.2791C232.11 42.2791 228.21 45.8991 228.21 52.0891C228.21 58.2791 232.11 61.8991 237.08 61.8991C240.16 61.8991 242.87 60.4491 244.69 57.0291L252.3 61.3791C249.85 67.0491 244.25 70.3391 237.13 70.3391C226.12 70.3391 218.25 62.7591 218.25 52.0891V52.0991Z" fill="${colors.grayDark}"/>
  <path d="M290.93 34.3791V69.8191H281.55V65.7391C279.1 68.8391 275.51 70.3491 270.98 70.3491C261.41 70.3491 254.05 63.2391 254.05 52.0991C254.05 40.9591 261.41 33.8491 270.98 33.8491C275.13 33.8491 278.66 35.2291 281.11 38.1291V34.3791H290.93ZM281.3 52.0991C281.3 45.9691 277.52 42.2891 272.68 42.2891C267.84 42.2891 264 45.9791 264 52.0991C264 58.2191 267.78 61.9091 272.68 61.9091C277.58 61.9091 281.3 58.2191 281.3 52.0991Z" fill="${colors.grayDark}"/>
  <path d="M334.54 52.0991C334.54 63.2291 327.18 70.3491 317.68 70.3491C313.46 70.3491 310 68.9691 307.49 66.0691V82.5991H297.67V34.3791H307.05V38.4591C309.5 35.3591 313.15 33.8491 317.68 33.8491C327.18 33.8491 334.54 40.9591 334.54 52.0991ZM324.6 52.0991C324.6 45.9691 320.89 42.2891 315.98 42.2891C311.07 42.2891 307.36 45.9791 307.36 52.0991C307.36 58.2191 311.07 61.9091 315.98 61.9091C320.89 61.9091 324.6 58.2191 324.6 52.0991Z" fill="${colors.grayDark}"/>
</svg>`;

// ============================================================================
// Common CSS Styles
// ============================================================================

/**
 * Base CSS styles for web pages (login, reset password, etc.)
 */
export const pageBaseStyles = `
*,
*:before,
*:after {
  box-sizing: border-box;
}
body {
  font-family: ${fonts.primary};
  font-weight: normal;
  display: flex;
  flex-flow: column nowrap;
  align-items: center;
  justify-content: center;
  gap: 50px;
  min-height: 100vh;
  margin: 0;
  background-color: ${colors.background};
  color: ${colors.text};
}
.logo {
  display: flex;
  align-items: center;
  justify-content: center;
}
.logo svg {
  width: 300px;
  height: auto;
}
.form-container {
  width: 350px;
  margin-top: -30px;
}
.error-message {
  background-color: ${colors.errorBackground};
  color: ${colors.error};
  padding: 12px 15px;
  border-radius: ${lengths.borderRadius};
  font-size: 14px;
  margin-bottom: 20px;
}
.success-message {
  background-color: ${colors.successBackground};
  color: ${colors.success};
  padding: 12px 15px;
  border-radius: ${lengths.borderRadius};
  font-size: 14px;
  margin-bottom: 20px;
}
.form-group {
  margin-bottom: 15px;
}
.form-label {
  display: block;
  font-size: 12px;
  text-transform: uppercase;
  font-weight: 600;
  color: ${colors.controlLabel};
  margin-bottom: 6px;
}
.form-input {
  background-color: ${colors.white};
  border-radius: ${lengths.borderRadius};
  border: solid 2px ${colors.textFieldBorder};
  font-size: 14px;
  padding: ${lengths.inputPadding};
  width: 100%;
  font-family: inherit;
  transition: box-shadow 0.2s ease, border-color 0.2s ease;
}
.form-input:focus {
  outline: none;
  border-color: ${colors.active};
  box-shadow: inset 0 0 0 1px ${colors.active};
}
.submit-button {
  border: 0;
  border-radius: ${lengths.borderRadius};
  cursor: pointer;
  height: ${lengths.buttonHeight};
  line-height: ${lengths.buttonHeight};
  font-weight: 500;
  padding: 0 30px;
  background-color: ${colors.button};
  color: ${colors.buttonText};
  font-size: 14px;
  font-family: inherit;
  display: block;
  margin-top: 20px;
  margin-left: auto;
  box-shadow: ${shadows.dropDeep};
  transition: background-color 0.2s ease;
}
.submit-button:hover {
  background-color: ${colors.buttonHover};
}
.submit-button:focus {
  outline: -webkit-focus-ring-color auto 5px;
}
.submit-button:disabled {
  background-color: ${colors.grayLight};
  color: ${colors.gray};
  cursor: default;
  box-shadow: none;
}
.go-back {
  display: flex;
  align-items: center;
  gap: 8px;
  color: ${colors.text};
  font-size: 14px;
  font-weight: 500;
  text-decoration: none;
  transition: color 0.2s ease;
}
.go-back:hover {
  color: ${colors.textLead};
}
.go-back svg {
  width: 20px;
  height: 20px;
}
.link {
  color: ${colors.active};
  text-decoration: none;
}
.link:hover {
  text-decoration: underline;
}
`;

/**
 * Base CSS styles for HTML emails
 */
export const emailBaseStyles = `
body {
  font-family: ${fonts.primary};
  font-weight: normal;
  background-color: ${colors.background};
  color: ${colors.text};
  margin: 0;
  padding: 40px 20px;
  line-height: 1.6;
}
.email-container {
  max-width: 600px;
  margin: 0 auto;
  background-color: ${colors.white};
  border-radius: ${lengths.borderRadius};
  box-shadow: ${shadows.dropMain};
  overflow: hidden;
}
.email-header {
  background-color: ${colors.white};
  padding: 30px 40px;
  text-align: center;
  border-bottom: 1px solid ${colors.background};
}
.email-logo {
  width: 200px;
  height: auto;
}
.email-body {
  padding: 40px;
}
.email-title {
  font-size: 24px;
  font-weight: 600;
  color: ${colors.textLead};
  margin: 0 0 20px 0;
  letter-spacing: 0.4px;
}
.email-text {
  font-size: 15px;
  color: ${colors.text};
  margin: 0 0 20px 0;
}
.email-button {
  display: inline-block;
  background-color: ${colors.button};
  color: ${colors.buttonText} !important;
  text-decoration: none;
  padding: 12px 30px;
  border-radius: ${lengths.borderRadius};
  font-size: 14px;
  font-weight: 500;
  margin: 20px 0;
  box-shadow: ${shadows.dropDeep};
}
.email-button:hover {
  background-color: ${colors.buttonHover};
}
.email-link {
  color: ${colors.active};
  text-decoration: none;
}
.email-link:hover {
  text-decoration: underline;
}
.email-muted {
  font-size: 13px;
  color: ${colors.text};
}
.email-footer {
  background-color: #f8f9fa;
  padding: 20px 40px;
  text-align: center;
  border-top: 1px solid ${colors.background};
}
.email-footer-text {
  font-size: 12px;
  color: ${colors.text};
  margin: 0;
}
.email-code {
  background-color: ${colors.background};
  padding: 15px 20px;
  border-radius: ${lengths.borderRadius};
  font-family: ${fonts.mono};
  font-size: 14px;
  color: ${colors.textLead};
  word-break: break-all;
  margin: 20px 0;
}
.email-warning {
  background-color: ${colors.warningBackground};
  color: ${colors.warning};
  padding: 15px 20px;
  border-radius: ${lengths.borderRadius};
  font-size: 13px;
  margin: 20px 0;
}
`;
