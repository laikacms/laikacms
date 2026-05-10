/**
 * Decap CMS Design System Styles
 *
 * This file contains the CSS styles matching Decap CMS's official design system.
 * Colors, fonts, shadows, and component styles are derived from:
 * - packages/decap-cms-ui-default/src/styles.js
 * - packages/decap-cms-ui-auth/src/NetlifyAuthenticationPage.js
 */

// Template tag functions for intellisense support
const css = String.raw;
const html = String.raw;

// ============================================================================
// Design Tokens
// ============================================================================

/**
 * Decap CMS Color Palette
 */
export const colors = {
  // Primary colors
  blue: '#3a69c7',
  blueLight: '#e8f5fe',
  green: '#005614',
  greenLight: '#caef6f',
  brown: '#754e00',
  purple: '#70399f',
  teal: '#17a2b8',

  // Grays
  grayLight: '#eff0f4',
  gray: '#798291',
  grayDark: '#313d3e',

  // UI colors
  textPrimary: '#313d3e',
  textSecondary: '#798291',
  textMuted: '#5D626F',
  background: '#eff0f4',
  surface: '#ffffff',
  border: '#dfdfe3',
  borderHover: '#c4c4c4',

  // Status colors
  error: '#ff003b',
  errorLight: '#fff0f3',
  success: '#005614',
  warning: '#754e00',

  // Button colors
  buttonPrimary: '#313d3e',
  buttonPrimaryHover: '#555a65',
  buttonDisabled: '#eff0f4',
} as const;

/**
 * Decap CMS Typography
 */
export const fonts = {
  primary:
    'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"',
  mono: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, Courier, monospace',
} as const;

/**
 * Decap CMS Spacing & Sizing
 */
export const lengths = {
  borderRadius: '5px',
  inputPadding: '10px',
  buttonHeight: '36px',
  inputBorderWidth: '2px',
} as const;

/**
 * Decap CMS Shadows
 */
export const shadows = {
  button: '0 4px 12px 0 rgba(68, 74, 87, 0.15), 0 1px 3px 0 rgba(68, 74, 87, 0.25)',
  dropShadow: '0 2px 6px 0 rgba(68, 74, 87, 0.05), 0 1px 3px 0 rgba(68, 74, 87, 0.1)',
  inputFocus: 'inset 0 0 0 1px #3a69c7',
} as const;

// ============================================================================
// CSS Styles
// ============================================================================

/**
 * Base reset and body styles
 */
export const baseStyles = css`
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
    color: ${colors.textSecondary};
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
`;

/**
 * Logo styles
 */
export const logoStyles = css`
  .logo {
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .logo svg {
    width: 300px;
    height: auto;
  }
`;

/**
 * Form container styles
 */
export const containerStyles = css`
  .auth-container {
    width: 350px;
    margin-top: -30px;
  }
  .auth-form {
    display: block;
  }
  .auth-form.hidden {
    display: none;
  }
`;

/**
 * Error message styles
 */
export const errorStyles = css`
  .error-message {
    background-color: ${colors.errorLight};
    border: 1px solid ${colors.error};
    border-radius: ${lengths.borderRadius};
    color: ${colors.error};
    font-size: 14px;
    padding: 10px 15px;
    margin-bottom: 15px;
  }
  .error-message:empty {
    display: none;
  }
`;

/**
 * Form input styles
 */
export const formStyles = css`
  .form-group {
    margin-bottom: 15px;
  }
  .form-label {
    display: block;
    font-size: 12px;
    text-transform: uppercase;
    font-weight: 600;
    color: ${colors.textMuted};
    margin-bottom: 6px;
  }
  .form-input {
    background-color: ${colors.surface};
    border-radius: ${lengths.borderRadius};
    border: solid ${lengths.inputBorderWidth} ${colors.border};
    font-size: 14px;
    padding: ${lengths.inputPadding};
    width: 100%;
    font-family: inherit;
    transition: box-shadow 0.2s ease, border-color 0.2s ease;
  }
  .form-input:focus {
    outline: none;
    border-color: ${colors.blue};
    box-shadow: ${shadows.inputFocus};
  }
  .form-input:disabled {
    background-color: #f5f5f5;
    cursor: not-allowed;
  }
`;

/**
 * Button styles
 */
export const buttonStyles = css`
  .button {
    border: 0;
    border-radius: ${lengths.borderRadius};
    cursor: pointer;
    height: ${lengths.buttonHeight};
    line-height: ${lengths.buttonHeight};
    font-weight: 500;
    padding: 0 30px;
    font-size: 14px;
    font-family: inherit;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    transition: background-color 0.2s ease;
  }
  .button-primary {
    background-color: ${colors.buttonPrimary};
    color: ${colors.surface};
    box-shadow: ${shadows.button};
  }
  .button-primary:hover {
    background-color: ${colors.buttonPrimaryHover};
  }
  .button-secondary {
    background-color: ${colors.surface};
    color: ${colors.textPrimary};
    border: 2px solid ${colors.border};
  }
  .button-secondary:hover {
    background-color: #f5f5f5;
    border-color: ${colors.borderHover};
  }
  .button:focus {
    outline: -webkit-focus-ring-color auto 5px;
  }
  .button:disabled {
    background-color: ${colors.buttonDisabled};
    color: ${colors.textSecondary};
    cursor: default;
    box-shadow: none;
    border-color: ${colors.border};
  }
  .button-full {
    width: 100%;
  }
  .button-group {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 20px;
  }
`;

/**
 * Divider styles
 */
export const dividerStyles = css`
  .divider {
    display: flex;
    align-items: center;
    gap: 15px;
    margin: 20px 0;
    color: ${colors.textSecondary};
    font-size: 12px;
    text-transform: uppercase;
  }
  .divider::before,
  .divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background-color: ${colors.border};
  }
`;

/**
 * Passkey-specific styles
 */
export const passkeyStyles = css`
  .passkey-icon {
    width: 20px;
    height: 20px;
  }
`;

/**
 * TOTP-specific styles
 */
export const totpStyles = css`
  .totp-input {
    width: 100%;
    height: 48px;
    text-align: center;
    font-size: 24px;
    font-weight: 600;
    letter-spacing: 0.5em;
    background-color: ${colors.surface};
    border-radius: ${lengths.borderRadius};
    border: solid ${lengths.inputBorderWidth} ${colors.border};
    font-family: inherit;
    transition: box-shadow 0.2s ease, border-color 0.2s ease;
    margin-bottom: 20px;
  }
  .totp-input:focus {
    outline: none;
    border-color: ${colors.blue};
    box-shadow: ${shadows.inputFocus};
  }
  .totp-input::placeholder {
    letter-spacing: normal;
    font-weight: normal;
    font-size: 14px;
    color: ${colors.textSecondary};
  }
  .totp-description {
    text-align: center;
    font-size: 14px;
    margin-bottom: 20px;
    line-height: 1.5;
  }
  .backup-link {
    display: block;
    text-align: center;
    margin-top: 15px;
    color: ${colors.blue};
    font-size: 14px;
    text-decoration: none;
  }
  .backup-link:hover {
    text-decoration: underline;
  }
`;

/**
 * Forgot password link styles
 */
export const forgotPasswordStyles = css`
  .forgot-password-link {
    display: block;
    text-align: right;
    margin-top: 8px;
    color: ${colors.blue};
    font-size: 13px;
    text-decoration: none;
  }
  .forgot-password-link:hover {
    text-decoration: underline;
  }
`;

/**
 * Back button styles
 */
export const backButtonStyles = css`
  .back-button {
    display: flex;
    align-items: center;
    gap: 8px;
    color: ${colors.textSecondary};
    font-size: 14px;
    font-weight: 500;
    text-decoration: none;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    margin-bottom: 20px;
  }
  .back-button:hover {
    color: ${colors.textPrimary};
  }
  .back-button svg {
    width: 20px;
    height: 20px;
  }
`;

/**
 * Loading spinner styles
 */
export const spinnerStyles = css`
  .loading-spinner {
    display: inline-block;
    width: 16px;
    height: 16px;
    border: 2px solid ${colors.surface};
    border-radius: 50%;
    border-top-color: transparent;
    animation: spin 0.8s linear infinite;
  }
  .button-secondary .loading-spinner {
    border-color: ${colors.textPrimary};
    border-top-color: transparent;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
`;

/**
 * Utility styles
 */
export const utilityStyles = css`
  .hidden {
    display: none !important;
  }
`;

/**
 * Combined styles for the login page
 * Import this for a complete stylesheet
 */
export const loginPageStyles = [
  baseStyles,
  logoStyles,
  containerStyles,
  errorStyles,
  formStyles,
  buttonStyles,
  dividerStyles,
  passkeyStyles,
  totpStyles,
  forgotPasswordStyles,
  backButtonStyles,
  spinnerStyles,
  utilityStyles,
].join('\n');

// ============================================================================
// SVG Assets
// ============================================================================

/**
 * Decap CMS Logo SVG
 */
export const decapLogo =
  html`<svg width="300" height="81" viewBox="0 0 335 90" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M30.73 0.149188L0 2.94919L3.67 43.1592L23.7 41.3292L21.71 19.4692L32.42 18.4892C43.03 17.5192 51.56 26.0192 52.71 38.6792L72.38 36.8892C70.34 14.7192 51.64 -1.75081 30.73 0.149188Z" fill="#FF0082"/>
  <path d="M73.61 49.5091C73.61 62.2291 65.88 71.4591 55.24 71.4591H44.49V49.4691H24.38V89.8891H55.24C76.26 89.8891 93.36 71.7791 93.36 49.5091C93.36 49.4991 93.36 49.4891 93.36 49.4691H73.61C73.61 49.4691 73.61 49.4891 73.61 49.5091Z" fill="#FF0082"/>
  <path d="M131.65 23.7092H151.66C166.07 23.7092 175.95 32.7992 175.95 46.7692C175.95 60.7392 166.07 69.8292 151.66 69.8292H131.65V23.7092ZM151.16 61.0592C159.91 61.0592 165.63 55.5892 165.63 46.7692C165.63 37.9492 159.9 32.4792 151.16 32.4792H141.85V61.0692H151.16V61.0592Z" fill="#313d3e"/>
  <path d="M207.61 58.6891L212.83 64.6191C209.68 68.3691 204.96 70.3491 198.86 70.3491C187.16 70.3491 179.54 62.6391 179.54 52.0991C179.54 41.5591 187.22 33.8491 197.66 33.8491C207.22 33.8491 215.09 40.4391 215.15 51.7691L190.11 56.8391C191.56 60.3291 194.7 62.1091 199.11 62.1091C202.7 62.1091 205.28 60.9891 207.61 58.6791V58.6891ZM189.17 51.0491L205.66 47.6891C204.72 44.0691 201.76 41.6291 197.67 41.6291C192.76 41.6291 189.36 45.0591 189.17 51.0491Z" fill="#313d3e"/>
  <path d="M218.25 52.0991C218.25 41.4291 226.12 33.8491 237.13 33.8491C244.24 33.8491 249.84 37.0791 252.3 42.8691L244.69 47.1491C242.86 43.7891 240.16 42.2791 237.08 42.2791C232.11 42.2791 228.21 45.8991 228.21 52.0891C228.21 58.2791 232.11 61.8991 237.08 61.8991C240.16 61.8991 242.87 60.4491 244.69 57.0291L252.3 61.3791C249.85 67.0491 244.25 70.3391 237.13 70.3391C226.12 70.3391 218.25 62.7591 218.25 52.0891V52.0991Z" fill="#313d3e"/>
  <path d="M290.93 34.3791V69.8191H281.55V65.7391C279.1 68.8391 275.51 70.3491 270.98 70.3491C261.41 70.3491 254.05 63.2391 254.05 52.0991C254.05 40.9591 261.41 33.8491 270.98 33.8491C275.13 33.8491 278.66 35.2291 281.11 38.1291V34.3791H290.93ZM281.3 52.0991C281.3 45.9691 277.52 42.2891 272.68 42.2891C267.84 42.2891 264 45.9791 264 52.0991C264 58.2191 267.78 61.9091 272.68 61.9091C277.58 61.9091 281.3 58.2191 281.3 52.0991Z" fill="#313d3e"/>
  <path d="M334.54 52.0991C334.54 63.2291 327.18 70.3491 317.68 70.3491C313.46 70.3491 310 68.9691 307.49 66.0691V82.5991H297.67V34.3791H307.05V38.4591C309.5 35.3591 313.15 33.8491 317.68 33.8491C327.18 33.8491 334.54 40.9591 334.54 52.0991ZM324.6 52.0991C324.6 45.9691 320.89 42.2891 315.98 42.2891C311.07 42.2891 307.36 45.9791 307.36 52.0991C307.36 58.2191 311.07 61.9091 315.98 61.9091C320.89 61.9091 324.6 58.2191 324.6 52.0991Z" fill="#313d3e"/>
</svg>`;

/**
 * Passkey (fingerprint) icon SVG
 */
export const passkeyIcon =
  html`<svg class="passkey-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M2 12C2 6.5 6.5 2 12 2a10 10 0 0 1 8 4"/>
  <path d="M5 19.5C5.5 18 6 15 6 12c0-.7.12-1.37.34-2"/>
  <path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/>
  <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/>
  <path d="M8.65 22c.21-.66.45-1.32.57-2"/>
  <path d="M14 13.12c0 2.38 0 6.38-1 8.88"/>
  <path d="M2 16h.01"/>
  <path d="M21.8 16c.2-2 .131-5.354 0-6"/>
  <path d="M9 6.8a6 6 0 0 1 9 5.2c0 .47 0 1.17-.02 2"/>
</svg>`;

/**
 * Back arrow icon SVG
 */
export const backIcon =
  html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M19 12H5M12 19l-7-7 7-7"/>
</svg>`;
