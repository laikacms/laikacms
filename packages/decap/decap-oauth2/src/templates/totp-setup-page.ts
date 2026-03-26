/**
 * TOTP Setup Page Template
 *
 * This template provides a page for users to set up TOTP 2FA.
 * Shows a QR code and manual entry key for authenticator apps.
 */

import { defaultMessages, type OAuthMessages, type TotpTranslation } from '../i18n/index.js';
import { decapLogo, loginPageStyles } from './decap-styles.js';
import { html, type HtmlTemplate, messages, type TemplateVariables, getMessages } from './html.js';

// Template tag for JavaScript (enables intellisense)
const js = String.raw;
const css = String.raw;

/**
 * Additional styles for TOTP setup page
 */
const totpSetupStyles = css`
  .qr-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin: 20px 0;
  }
  .qr-code {
    width: 200px;
    height: 200px;
    background-color: #fff;
    border: 2px solid #dfdfe3;
    border-radius: 5px;
    padding: 10px;
  }
  .manual-key {
    margin-top: 15px;
    text-align: center;
  }
  .manual-key-label {
    font-size: 12px;
    text-transform: uppercase;
    font-weight: 600;
    color: #5D626F;
    margin-bottom: 6px;
  }
  .manual-key-value {
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, Courier, monospace;
    font-size: 14px;
    background-color: #f5f5f5;
    padding: 8px 12px;
    border-radius: 5px;
    letter-spacing: 2px;
    user-select: all;
    cursor: pointer;
  }
  .manual-key-value:hover {
    background-color: #e8e8e8;
  }
  .step-indicator {
    display: flex;
    justify-content: center;
    gap: 10px;
    margin-bottom: 25px;
  }
  .step {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    font-weight: 600;
  }
  .step.active {
    background-color: #3a69c7;
    color: #fff;
  }
  .step.completed {
    background-color: #005614;
    color: #fff;
  }
  .step.pending {
    background-color: #dfdfe3;
    color: #798291;
  }
  .step-line {
    width: 40px;
    height: 2px;
    background-color: #dfdfe3;
    align-self: center;
  }
  .step-line.completed {
    background-color: #005614;
  }
  .instructions {
    font-size: 14px;
    color: #798291;
    line-height: 1.6;
    margin-bottom: 20px;
  }
  .instructions ol {
    padding-left: 20px;
    margin: 10px 0;
  }
  .instructions li {
    margin-bottom: 8px;
  }
  .totp-single-input {
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, Courier, monospace;
    font-size: 24px;
    text-align: center;
    letter-spacing: 8px;
    padding: 12px 16px;
    width: 100%;
    box-sizing: border-box;
  }
  .totp-single-input::placeholder {
    color: #ccc;
    letter-spacing: 8px;
  }
`;

/**
 * JavaScript for TOTP setup page
 */
const totpSetupScript = js`
<script>
(function() {
  // TOTP single input handling
  const totpInput = document.getElementById('totp-code');
  if (totpInput) {
    totpInput.addEventListener('input', function(e) {
      // Only allow digits
      this.value = this.value.replace(/[^0-9]/g, '').slice(0, 6);
    });
  }

  // Copy manual key
  const manualKey = document.querySelector('.manual-key-value');
  if (manualKey) {
    manualKey.addEventListener('click', function() {
      navigator.clipboard.writeText(this.textContent.replace(/\\s/g, '')).then(() => {
        const original = this.textContent;
        this.textContent = 'Copied!';
        setTimeout(() => { this.textContent = original; }, 1500);
      });
    });
  }

})();
</script>
`;

// Template symbols
const pageTitle = Symbol('pageTitle');
const title = Symbol('title');
const setupStep1 = Symbol('setupStep1');
const setupStep2 = Symbol('setupStep2');
const setupStep3 = Symbol('setupStep3');
const qrCodeDataUrl = Symbol('qrCodeDataUrl');
const qrCodeAlt = Symbol('qrCodeAlt');
const manualKeyLabel = Symbol('manualKeyLabel');
const formattedSecret = Symbol('formattedSecret');
const baseUrl = Symbol('baseUrl');
const setupToken = Symbol('setupToken');
const redirectUri = Symbol('redirectUri');
const enterVerificationCode = Symbol('enterVerificationCode');
const inputPlaceholder = Symbol('inputPlaceholder');
const inputLabel = Symbol('inputLabel');
const verifyAndContinue = Symbol('verifyAndContinue');

/**
 * Template variables type for TOTP setup page
 */
type TotpSetupTemplateVariables = TemplateVariables & {
  [pageTitle]: string;
  [title]: string;
  [setupStep1]: string;
  [setupStep2]: string;
  [setupStep3]: string;
  [qrCodeDataUrl]: string;
  [qrCodeAlt]: string;
  [manualKeyLabel]: string;
  [formattedSecret]: string;
  [baseUrl]: string;
  [setupToken]: string;
  [redirectUri]: string;
  [enterVerificationCode]: string;
  [inputPlaceholder]: string;
  [inputLabel]: string;
  [verifyAndContinue]: string;
  [messages]: OAuthMessages;
};

/**
 * TOTP setup page template using the html tagged template
 */
const totpSetupTemplate: HtmlTemplate = html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle}</title>
  <style>${loginPageStyles}${totpSetupStyles}</style>
</head>
<body>
  <div class="logo">${decapLogo}</div>
  
  <div class="auth-container" style="width: 400px;">
    <div class="step-indicator">
      <div class="step active">1</div>
      <div class="step-line"></div>
      <div class="step pending">2</div>
    </div>
    
    <h2 style="text-align: center; color: #313d3e; margin-bottom: 10px;">${title}</h2>
    
    <div class="instructions">
      <ol>
        <li>${setupStep1}</li>
        <li>${setupStep2}</li>
        <li>${setupStep3}</li>
      </ol>
    </div>
    
    <div class="qr-container">
      <img class="qr-code" src="${qrCodeDataUrl}" alt="${qrCodeAlt}" />
      <div class="manual-key">
        <div class="manual-key-label">${manualKeyLabel}</div>
        <div class="manual-key-value" title="Click to copy">${formattedSecret}</div>
      </div>
    </div>
    
    <form method="POST" action="${baseUrl}/setup/totp/verify">
      <input type="hidden" name="setup_token" value="${setupToken}" />
      <input type="hidden" name="redirect_uri" value="${redirectUri}" />
      
      <div class="form-group">
        <label class="form-label" for="totp-code">${enterVerificationCode}</label>
        <input type="text" id="totp-code" name="totp_code" class="form-input totp-single-input" maxlength="6" inputmode="numeric" pattern="[0-9]{6}" placeholder="${inputPlaceholder}" autocomplete="one-time-code" autofocus aria-label="${inputLabel}" />
      </div>
      
      <div class="button-group">
        <button class="button button-primary button-full" type="submit">${verifyAndContinue}</button>
      </div>
    </form>
  </div>
  
  ${totpSetupScript}
</body>
</html>`;

/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (char) => map[char]);
}

/**
 * Options for rendering the TOTP setup page
 */
export interface TotpSetupPageOptions {
  qrCodeDataUrl: string;
  secret: string;
  issuer: string;
  email: string;
  setupToken: string;
  redirectUri: string;
  baseUrl?: string;
  /**
   * Localized messages for user-facing strings.
   * If not provided, defaults to English messages.
   */
  messages?: OAuthMessages;
}

/**
 * Render TOTP setup page - Step 1: Show QR code
 */
export function renderTotpSetupPage(options: TotpSetupPageOptions): string {
  const msgs = options.messages ?? defaultMessages;
  const t = msgs.totp;
  const base = options.baseUrl || '';
  
  // Format secret for display (groups of 4)
  const formatted = options.secret.match(/.{1,4}/g)?.join(' ') || options.secret;
  
  // Replace {{issuer}} placeholder in qrCodeAlt
  const qrCodeAltText = t.qrCodeAlt.replace('{{issuer}}', options.issuer);

  const templateValues: TotpSetupTemplateVariables = {
    [pageTitle]: escapeHtml(t.setupPageTitle),
    [title]: escapeHtml(t.setupTitle),
    [setupStep1]: escapeHtml(t.setupStep1),
    [setupStep2]: escapeHtml(t.setupStep2),
    [setupStep3]: escapeHtml(t.setupStep3),
    [qrCodeDataUrl]: options.qrCodeDataUrl,
    [qrCodeAlt]: escapeHtml(qrCodeAltText),
    [manualKeyLabel]: escapeHtml(t.manualKeyLabel),
    [formattedSecret]: formatted,
    [baseUrl]: base,
    [setupToken]: options.setupToken,
    [redirectUri]: escapeHtml(options.redirectUri),
    [enterVerificationCode]: escapeHtml(t.enterVerificationCode),
    [inputPlaceholder]: escapeHtml(t.inputPlaceholder),
    [inputLabel]: escapeHtml(t.inputLabel),
    [verifyAndContinue]: escapeHtml(t.verifyAndContinue),
    [messages]: msgs,
  };

  return totpSetupTemplate(templateValues);
}
