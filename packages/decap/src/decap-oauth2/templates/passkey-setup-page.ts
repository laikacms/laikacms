/**
 * Passkey Setup Page Template
 *
 * This template provides a page for users to set up passkey (WebAuthn) authentication.
 */

import { defaultMessages, type OAuthMessages, type PasskeyTranslation } from '../i18n/index.js';
import { decapLogo, loginPageStyles, passkeyIcon } from './decap-styles.js';
import { html, type HtmlTemplate, messages, type TemplateVariables } from './html.js';

// Template tag for JavaScript (enables intellisense)
const js = String.raw;
const css = String.raw;

/**
 * Additional styles for passkey setup page
 */
const passkeySetupStyles = css`
  .passkey-illustration {
    display: flex;
    justify-content: center;
    margin: 30px 0;
  }
  .passkey-illustration svg {
    width: 80px;
    height: 80px;
    color: #3a69c7;
  }
  .feature-list {
    list-style: none;
    padding: 0;
    margin: 20px 0;
  }
  .feature-list li {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    margin-bottom: 15px;
    font-size: 14px;
    color: #798291;
  }
  .feature-list li svg {
    width: 20px;
    height: 20px;
    color: #005614;
    flex-shrink: 0;
    margin-top: 2px;
  }
  .passkey-name-input {
    margin-top: 20px;
  }
  .skip-link {
    display: block;
    text-align: center;
    margin-top: 15px;
    color: #798291;
    font-size: 14px;
    text-decoration: none;
  }
  .skip-link:hover {
    color: #313d3e;
    text-decoration: underline;
  }
  .success-icon {
    display: flex;
    justify-content: center;
    margin: 20px 0;
  }
  .success-icon svg {
    width: 60px;
    height: 60px;
    color: #005614;
  }
  .loading-state {
    text-align: center;
    padding: 40px 0;
  }
  .loading-spinner-large {
    display: inline-block;
    width: 40px;
    height: 40px;
    border: 3px solid #dfdfe3;
    border-radius: 50%;
    border-top-color: #3a69c7;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  .loading-text {
    margin-top: 15px;
    font-size: 14px;
    color: #798291;
  }
  .error-box {
    background-color: #fff0f3;
    border: 1px solid #ff003b;
    border-radius: 5px;
    color: #ff003b;
    font-size: 14px;
    padding: 15px;
    margin: 20px 0;
    text-align: center;
  }
  .error-box.hidden {
    display: none;
  }
`;

/**
 * Large passkey icon for illustration
 */
const passkeyLargeIcon =
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
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
 * Success checkmark icon
 */
const successIcon =
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
  <polyline points="22 4 12 14.01 9 11.01"/>
</svg>`;

/**
 * JavaScript for passkey setup (function to inject baseUrl and registration options)
 */
function getPasskeySetupScript(
  baseUrl: string,
  registrationOptionsJson: string,
  passkeyMessages?: PasskeyTranslation,
): string {
  // Use provided messages or defaults
  const browserNotSupportedText = passkeyMessages?.browserNotSupported
    ?? 'Your browser does not support passkeys. Please use a modern browser like Chrome, Safari, or Firefox.';
  const setupFailedText = passkeyMessages?.setupFailed ?? 'Failed to set up passkey. Please try again.';
  const registrationFailedText = passkeyMessages?.registrationFailed ?? 'Registration failed';

  return js`
<script>
(function() {
  const BASE_URL = '${baseUrl}';
  const REGISTRATION_OPTIONS = ${registrationOptionsJson};
  const i18n = {
    browserNotSupported: ${JSON.stringify(browserNotSupportedText)},
    setupFailed: ${JSON.stringify(setupFailedText)},
    registrationFailed: ${JSON.stringify(registrationFailedText)}
  };
  const setupButton = document.getElementById('setup-passkey-btn');
  const loadingState = document.getElementById('loading-state');
  const setupForm = document.getElementById('setup-form');
  const errorBox = document.getElementById('error-box');
  const successState = document.getElementById('success-state');
  
  // Check WebAuthn support
  if (!window.PublicKeyCredential) {
    errorBox.textContent = i18n.browserNotSupported;
    errorBox.classList.remove('hidden');
    setupButton.disabled = true;
    return;
  }
  
  setupButton.addEventListener('click', async function(e) {
    e.preventDefault();
    
    const passkeyName = document.getElementById('passkey-name').value || 'My Passkey';
    
    // Show loading state
    setupForm.style.display = 'none';
    loadingState.style.display = 'block';
    errorBox.classList.add('hidden');
    
    try {
      // Use embedded registration options (already provided by server)
      const options = { ...REGISTRATION_OPTIONS };
      
      // Convert base64url to ArrayBuffer
      options.challenge = base64UrlToBuffer(options.challenge);
      options.user.id = base64UrlToBuffer(options.user.id);
      if (options.excludeCredentials) {
        options.excludeCredentials = options.excludeCredentials.map(cred => ({
          ...cred,
          id: base64UrlToBuffer(cred.id)
        }));
      }
      
      // Create credential
      const credential = await navigator.credentials.create({
        publicKey: options
      });
      
      // Prepare response for server
      const response = {
        setup_token: document.querySelector('input[name="setup_token"]').value,
        redirect_uri: document.querySelector('input[name="redirect_uri"]').value,
        user_id: document.querySelector('input[name="user_id"]').value,
        passkey_name: passkeyName,
        credential: {
          id: credential.id,
          rawId: bufferToBase64Url(credential.rawId),
          type: credential.type,
          response: {
            attestationObject: bufferToBase64Url(credential.response.attestationObject),
            clientDataJSON: bufferToBase64Url(credential.response.clientDataJSON)
          }
        }
      };
      
      // Register with server
      const registerResponse = await fetch(BASE_URL + '/setup/passkey/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(response)
      });
      
      if (!registerResponse.ok) {
        const error = await registerResponse.json();
        throw new Error(error.error || error.error_description || i18n.registrationFailed);
      }
      
      const result = await registerResponse.json();
      
      // Show success state
      loadingState.style.display = 'none';
      successState.style.display = 'block';
      
      // Redirect after a short delay
      setTimeout(() => {
        window.location.href = result.redirectUri || document.querySelector('input[name="redirect_uri"]').value;
      }, 2000);
      
    } catch (error) {
      console.error('Passkey setup error:', error);
      loadingState.style.display = 'none';
      setupForm.style.display = 'block';
      errorBox.textContent = error.message || i18n.setupFailed;
      errorBox.classList.remove('hidden');
    }
  });
  
  // Helper functions
  function base64UrlToBuffer(base64url) {
    const padding = '='.repeat((4 - base64url.length % 4) % 4);
    const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/') + padding;
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
  
  function bufferToBase64Url(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/[+]/g, '-').replace(/[/]/g, '_').replace(/[=]/g, '');
  }
})();
</script>
`;
}

/**
 * WebAuthn registration options type (matches RegistrationOptions.publicKey from passkey module)
 */
export interface WebAuthnRegistrationOptions {
  challenge: string; // base64url
  rp: { id: string, name: string };
  user: { id: string, name: string, displayName: string }; // id is base64url
  pubKeyCredParams: Array<{ type: 'public-key', alg: number }>;
  timeout: number;
  attestation: 'none' | 'indirect' | 'direct';
  authenticatorSelection: {
    authenticatorAttachment?: 'platform' | 'cross-platform',
    residentKey: 'required' | 'preferred' | 'discouraged',
    userVerification: 'required' | 'preferred' | 'discouraged',
  };
  excludeCredentials: Array<
    { type: 'public-key', id: string, transports?: Array<'usb' | 'nfc' | 'ble' | 'internal' | 'hybrid'> }
  >;
}

// Template symbols
const pageTitle = Symbol('pageTitle');
const title = Symbol('title');
const description = Symbol('description');
const setupToken = Symbol('setupToken');
const redirectUri = Symbol('redirectUri');
const userId = Symbol('userId');
const nameLabel = Symbol('nameLabel');
const namePlaceholder = Symbol('namePlaceholder');
const createButton = Symbol('createButton');
const skipLinkHtml = Symbol('skipLinkHtml');
const loadingPrompt = Symbol('loadingPrompt');
const successTitle = Symbol('successTitle');
const successDescription = Symbol('successDescription');
const scriptContent = Symbol('scriptContent');

/**
 * Template variables type for passkey setup page
 */
type PasskeySetupTemplateVariables = TemplateVariables & {
  [pageTitle]: string,
  [title]: string,
  [description]: string,
  [setupToken]: string,
  [redirectUri]: string,
  [userId]: string,
  [nameLabel]: string,
  [namePlaceholder]: string,
  [createButton]: string,
  [skipLinkHtml]: string,
  [loadingPrompt]: string,
  [successTitle]: string,
  [successDescription]: string,
  [scriptContent]: string,
  [messages]: OAuthMessages,
};

/**
 * Passkey setup page template using the html tagged template
 */
const passkeySetupTemplate: HtmlTemplate = html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle}</title>
  <style>${loginPageStyles}${passkeySetupStyles}</style>
</head>
<body>
  <div class="logo">${decapLogo}</div>
  
  <div class="auth-container" style="width: 400px;">
    <div id="error-box" class="error-box hidden"></div>
    
    <!-- Setup Form -->
    <div id="setup-form">
      <div class="passkey-illustration">${passkeyLargeIcon}</div>
      
      <h2 style="text-align: center; color: #313d3e; margin-bottom: 10px;">${title}</h2>
      <p style="text-align: center; color: #798291; font-size: 14px; margin-bottom: 20px;">
        ${description}
      </p>
      
      <form>
        <input type="hidden" name="setup_token" value="${setupToken}" />
        <input type="hidden" name="redirect_uri" value="${redirectUri}" />
        <input type="hidden" name="user_id" value="${userId}" />
        
        <div class="form-group passkey-name-input">
          <label class="form-label" for="passkey-name">${nameLabel}</label>
          <input class="form-input" type="text" id="passkey-name" name="passkey_name" placeholder="${namePlaceholder}" />
        </div>
        
        <div class="button-group">
          <button id="setup-passkey-btn" class="button button-primary button-full" type="button">
            ${passkeyIcon}
            ${createButton}
          </button>
        </div>
      </form>
      
      ${skipLinkHtml}
    </div>
    
    <!-- Loading State -->
    <div id="loading-state" style="display: none;">
      <div class="loading-state">
        <div class="loading-spinner-large"></div>
        <p class="loading-text">${loadingPrompt}</p>
      </div>
    </div>
    
    <!-- Success State -->
    <div id="success-state" style="display: none;">
      <div class="success-icon">${successIcon}</div>
      <h2 style="text-align: center; color: #005614; margin-bottom: 10px;">${successTitle}</h2>
      <p style="text-align: center; color: #798291; font-size: 14px;">
        ${successDescription}
      </p>
    </div>
  </div>
  
  ${scriptContent}
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
  return text.replace(/[&<>"']/g, char => map[char]);
}

/**
 * Options for rendering the passkey setup page
 */
export interface PasskeySetupPageOptions {
  setupToken: string;
  redirectUri: string;
  userId: string;
  required?: boolean;
  baseUrl?: string;
  registrationOptions: WebAuthnRegistrationOptions;
  /**
   * Localized messages for user-facing strings.
   * If not provided, defaults to English messages.
   */
  messages?: OAuthMessages;
}

/**
 * Render passkey setup page
 */
export function renderPasskeySetupPage(options: PasskeySetupPageOptions): string {
  const msgs = options.messages ?? defaultMessages;
  const t = msgs.passkey;
  const base = options.baseUrl || '';

  const skipLink = options.required
    ? ''
    : `<a href="${escapeHtml(options.redirectUri)}" class="skip-link">${escapeHtml(t.skipLink)}</a>`;

  // Serialize registration options for embedding in the page
  const registrationOptionsJson = JSON.stringify(options.registrationOptions);

  const templateValues: PasskeySetupTemplateVariables = {
    [pageTitle]: escapeHtml(t.pageTitle),
    [title]: escapeHtml(t.title),
    [description]: escapeHtml(t.description),
    [setupToken]: options.setupToken,
    [redirectUri]: escapeHtml(options.redirectUri),
    [userId]: escapeHtml(options.userId),
    [nameLabel]: escapeHtml(t.nameLabel),
    [namePlaceholder]: escapeHtml(t.namePlaceholder),
    [createButton]: escapeHtml(t.createButton),
    [skipLinkHtml]: skipLink,
    [loadingPrompt]: escapeHtml(t.loadingPrompt),
    [successTitle]: escapeHtml(t.successTitle),
    [successDescription]: escapeHtml(t.successDescription),
    [scriptContent]: getPasskeySetupScript(base, registrationOptionsJson, t),
    [messages]: msgs,
  };

  return passkeySetupTemplate(templateValues);
}
