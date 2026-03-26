/**
 * Login Page Template
 *
 * This template provides an enhanced login page with passkey and TOTP support.
 */

import { defaultMessages, type AuthTranslation, type OAuthMessages, type TotpTranslation } from '../i18n/index.js';
import { html, type HtmlTemplate, messages, processCustomLogo, type TemplateVariables } from './html.js';
import { backIcon, decapLogo, loginPageStyles, passkeyIcon } from './decap-styles.js';

// Template tag for JavaScript (enables intellisense)
const js = String.raw;

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
 * Passkey authentication options interface
 */
export interface PasskeyAuthOptions {
  challenge: string;
  rpId: string;
  timeout: number;
  userVerification: string;
  allowCredentials?: Array<{ type: string; id: string; transports?: string[]; }>;
}

/**
 * Generate WebAuthn JavaScript with embedded options for passkey authentication.
 * Options are embedded directly in the script to avoid an extra round-trip.
 * If options with allowCredentials are provided, the script will automatically attempt passkey login.
 *
 * @param passkeyOptions - The WebAuthn authentication options (publicKey object)
 * @param verifyUrl - The URL to POST the authentication response to
 * @param authMessages - Optional localized messages for the script
 */
export function generateWebAuthnScript(
  passkeyOptions: PasskeyAuthOptions | null,
  verifyUrl: string,
  authMessages?: AuthTranslation,
): string {
  const msgs = authMessages ?? defaultMessages.auth;
  // Serialize options to JSON for embedding in script
  const optionsJson = passkeyOptions ? JSON.stringify(passkeyOptions) : 'null';
  // Serialize messages for use in JavaScript
  const messagesJson = JSON.stringify({
    authenticating: msgs.authenticating,
    passkeyOptionsNotAvailable: msgs.passkeyOptionsNotAvailable,
    passkeyAuthFailed: msgs.passkeyAuthFailed,
    noCredentialReturned: msgs.noCredentialReturned,
    authenticationFailed: msgs.authenticationFailed,
    signingInWithPasskey: msgs.signingInWithPasskey,
  });

  return js`
<script>
(function() {
  // Embedded passkey options (pre-generated on server)
  var embeddedOpts = ${optionsJson};
  var verifyUrl = ${JSON.stringify(verifyUrl)};
  var i18n = ${messagesJson};
  
  // Check if WebAuthn is supported
  var isWebAuthnSupported = window.PublicKeyCredential !== undefined;
  
  // DOM elements
  var passkeySection = document.getElementById('passkey-section');
  var passkeyButton = document.getElementById('passkey-button');
  var loginForm = document.getElementById('login-form');
  var totpForm = document.getElementById('totp-form');
  var backButton = document.getElementById('back-button');
  var errorDiv = document.getElementById('error-message');
  
  // Show/hide passkey option based on browser support
  if (passkeySection && isWebAuthnSupported) {
    passkeySection.classList.remove('hidden');
  }
  
  // Helper functions
  function base64UrlToBuffer(base64url) {
    var padding = '='.repeat((4 - base64url.length % 4) % 4);
    var base64 = base64url.replace(/-/g, '+').replace(/_/g, '/') + padding;
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
  
  function bufferToBase64Url(buffer) {
    var bytes = new Uint8Array(buffer);
    var binary = '';
    for (var i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/[+]/g, '-').replace(/[/]/g, '_').replace(/[=]/g, '');
  }
  
  function showError(message) {
    if (errorDiv) {
      errorDiv.textContent = message;
      errorDiv.style.display = 'block';
    }
  }
  
  // Perform passkey authentication with embedded options
  async function authenticateWithPasskey(opts, showUI) {
    // Convert base64url strings to ArrayBuffers
    var publicKeyOpts = {
      challenge: base64UrlToBuffer(opts.challenge),
      rpId: opts.rpId,
      timeout: opts.timeout,
      userVerification: opts.userVerification
    };
    
    if (opts.allowCredentials && opts.allowCredentials.length > 0) {
      publicKeyOpts.allowCredentials = opts.allowCredentials.map(function(c) {
        return {
          type: c.type,
          id: base64UrlToBuffer(c.id),
          transports: c.transports
        };
      });
    }
    
    // Get credential
    var cred = await navigator.credentials.get({
      publicKey: publicKeyOpts,
      mediation: showUI ? 'optional' : 'conditional'
    });
    
    if (!cred) {
      throw new Error(i18n.noCredentialReturned);
    }
    
    // Build response
    var resp = {
      id: cred.id,
      rawId: bufferToBase64Url(cred.rawId),
      type: cred.type,
      response: {
        authenticatorData: bufferToBase64Url(cred.response.authenticatorData),
        clientDataJSON: bufferToBase64Url(cred.response.clientDataJSON),
        signature: bufferToBase64Url(cred.response.signature),
        userHandle: cred.response.userHandle ? bufferToBase64Url(cred.response.userHandle) : null
      }
    };
    
    // Verify with server
    var verRes = await fetch(verifyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: resp })
    });
    
    if (!verRes.ok) {
      var err = await verRes.json();
      throw new Error(err.error_description || i18n.authenticationFailed);
    }
    
    var result = await verRes.json();
    if (result.redirect_uri) {
      window.location.href = result.redirect_uri;
    }
    
    return result;
  }
  
  // Passkey button click handler
  if (passkeyButton && isWebAuthnSupported) {
    passkeyButton.addEventListener('click', async function(e) {
      e.preventDefault();
      
      var originalText = passkeyButton.innerHTML;
      passkeyButton.innerHTML = '<span class="loading-spinner"></span> ' + i18n.authenticating;
      passkeyButton.disabled = true;
      
      try {
        if (!embeddedOpts) {
          throw new Error(i18n.passkeyOptionsNotAvailable);
        }
        await authenticateWithPasskey(embeddedOpts, true);
      } catch (error) {
        console.error('Passkey authentication error:', error);
        // Don't show alert for user cancellation
        if (error.name !== 'NotAllowedError') {
          showError(error.message || i18n.passkeyAuthFailed);
        }
        passkeyButton.innerHTML = originalText;
        passkeyButton.disabled = false;
      }
    });
  }
  
  // Auto-login: If passkey options are available with allowCredentials,
  // automatically attempt passkey authentication
  if (isWebAuthnSupported && embeddedOpts && embeddedOpts.allowCredentials && embeddedOpts.allowCredentials.length > 0) {
    // Check if conditional mediation is supported for seamless auto-login
    if (window.PublicKeyCredential.isConditionalMediationAvailable) {
      window.PublicKeyCredential.isConditionalMediationAvailable().then(function(available) {
        if (available) {
          // Use conditional UI - browser will show passkey option in autofill
          authenticateWithPasskey(embeddedOpts, false).catch(function(err) {
            // Silent fail for conditional mediation - user can still click button
            console.log('Conditional passkey auth not completed:', err.message);
          });
        } else {
          // Fallback: attempt immediate authentication
          attemptAutoLogin();
        }
      });
    } else {
      // Browser doesn't support conditional mediation, try auto-login
      attemptAutoLogin();
    }
  }
  
  function attemptAutoLogin() {
    // Small delay to let the page render first
    setTimeout(function() {
      // Show auto-login indicator
      if (loginForm) {
        var autoLoginDiv = document.createElement('div');
        autoLoginDiv.className = 'passkey-auto-login';
        autoLoginDiv.id = 'passkey-auto-login';
        autoLoginDiv.innerHTML = '<span class="loading-spinner"></span><br>' + i18n.signingInWithPasskey;
        loginForm.insertBefore(autoLoginDiv, loginForm.firstChild);
      }
      
      authenticateWithPasskey(embeddedOpts, true).catch(function(err) {
        // Remove auto-login indicator on failure
        var indicator = document.getElementById('passkey-auto-login');
        if (indicator) indicator.remove();
        
        // Only log, don't alert - user can manually click button or use password
        console.log('Auto passkey login not completed:', err.message);
      });
    }, 100);
  }
  
  // TOTP input handling - single input field
  var totpInput = document.getElementById('totp-code');
  if (totpInput) {
    totpInput.addEventListener('input', function(e) {
      // Only allow digits
      this.value = this.value.replace(/[^0-9]/g, '');
    });
  }
  
  // Back button handling
  if (backButton) {
    backButton.addEventListener('click', function(e) {
      e.preventDefault();
      if (totpForm) totpForm.classList.add('hidden');
      if (loginForm) loginForm.classList.remove('hidden');
    });
  }
})();
</script>
`;
}

// Template symbols
const pageTitle = Symbol('pageTitle');
const authorizeUrl = Symbol('authorizeUrl');
const emailLabel = Symbol('emailLabel');
const emailPlaceholder = Symbol('emailPlaceholder');
const passwordLabel = Symbol('passwordLabel');
const passwordPlaceholder = Symbol('passwordPlaceholder');
const signInButton = Symbol('signInButton');
const dividerOr = Symbol('dividerOr');
const signInWithPasskey = Symbol('signInWithPasskey');
const backText = Symbol('backText');
const totpDescription = Symbol('totpDescription');
const totpInputLabel = Symbol('totpInputLabel');
const totpVerifyButton = Symbol('totpVerifyButton');
const forgotPasswordLinkHtml = Symbol('forgotPasswordLinkHtml');
const errorMessageHtml = Symbol('errorMessageHtml');
const passkeyScriptHtml = Symbol('passkeyScriptHtml');
const logoHtml = Symbol('logoHtml');

/**
 * Template variables type for enhanced login page
 */
type EnhancedLoginTemplateVariables = TemplateVariables & {
  [pageTitle]: string;
  [authorizeUrl]: string;
  [emailLabel]: string;
  [emailPlaceholder]: string;
  [passwordLabel]: string;
  [passwordPlaceholder]: string;
  [signInButton]: string;
  [dividerOr]: string;
  [signInWithPasskey]: string;
  [backText]: string;
  [totpDescription]: string;
  [totpInputLabel]: string;
  [totpVerifyButton]: string;
  [forgotPasswordLinkHtml]: string;
  [errorMessageHtml]: string;
  [passkeyScriptHtml]: string;
  [logoHtml]: string;
  [messages]: OAuthMessages;
};

/**
 * Enhanced login page template with passkey and TOTP support
 */
const enhancedLoginPageTemplate: HtmlTemplate = html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle}</title>
  <style>${loginPageStyles}
    .passkey-auto-login {
      text-align: center;
      padding: 20px;
      color: #798291;
      font-size: 14px;
    }
    .passkey-auto-login .loading-spinner {
      margin-bottom: 10px;
    }
  </style>
</head>
<body>
  <div class="logo">${logoHtml}</div>
  
  <div class="auth-container">
    <div id="error-message" class="error-message">${errorMessageHtml}</div>
    
    <!-- Login Form -->
    <form id="login-form" class="auth-form" method="POST" action="${authorizeUrl}">
      <div class="form-group">
        <label class="form-label" for="email">${emailLabel}</label>
        <input class="form-input" type="email" id="email" name="email" required autocomplete="email webauthn" placeholder="${emailPlaceholder}" />
      </div>
      <div class="form-group">
        <label class="form-label" for="password">${passwordLabel}</label>
        <input class="form-input" type="password" id="password" name="password" required autocomplete="current-password" placeholder="${passwordPlaceholder}" />
        ${forgotPasswordLinkHtml}
      </div>
      
      <div class="button-group">
        <button class="button button-primary button-full" type="submit">${signInButton}</button>
      </div>
      
      <!-- Passkey Section (shown if supported) -->
      <div id="passkey-section" class="hidden">
        <div class="divider">${dividerOr}</div>
        <button id="passkey-button" class="button button-secondary button-full" type="button">
          ${passkeyIcon}
          ${signInWithPasskey}
        </button>
      </div>
    </form>
    
    <!-- TOTP Verification Form (shown after password verification if 2FA enabled) -->
    <form id="totp-form" class="auth-form hidden" method="POST" action="${authorizeUrl}">
      <button type="button" id="back-button" class="back-button">
        ${backIcon}
        ${backText}
      </button>
      
      <p class="totp-description">
        ${totpDescription}
      </p>
      
      <label for="totp-code" class="visually-hidden">${totpInputLabel}</label>
      <input type="text" class="totp-input" id="totp-code" name="totp_code" maxlength="6" inputmode="numeric" pattern="[0-9]{6}" autocomplete="one-time-code" placeholder="000000" aria-label="${totpInputLabel}" />
      <input type="hidden" name="totp_session" id="totp-session" />
      
      <div class="button-group">
        <button class="button button-primary button-full" type="submit">${totpVerifyButton}</button>
      </div>
    </form>
  </div>
  
  ${passkeyScriptHtml}
</body>
</html>`;

/**
 * Options for rendering the enhanced login page
 */
export interface EnhancedLoginPageOptions {
  /** The OAuth authorize URL for form submission */
  authorizeUrl: string;
  /** Optional error message to display */
  error?: string;
  /** Passkey authentication options (embedded in script for auto-login) */
  passkeyOptions?: PasskeyAuthOptions | null;
  /** URL to POST passkey authentication response to */
  passkeyVerifyUrl?: string;
  /** URL for forgot password page (if password reset is enabled) */
  forgotPasswordUrl?: string;
  /** Custom logo HTML or URL (defaults to Decap CMS logo) */
  customLogo?: string;
  /** Localized messages for the login page */
  messages?: OAuthMessages;
}

/**
 * Result of rendering the enhanced login page
 */
export interface EnhancedLoginPageResult {
  /** The rendered HTML string */
  html: string;
  /** Additional img-src values to add to CSP (for external logo URLs) */
  imgSrc: string[];
}

/**
 * Render the enhanced login page with actual values
 * @returns Object with html string and imgSrc array for CSP
 */
export function renderEnhancedLoginPage(options: EnhancedLoginPageOptions): EnhancedLoginPageResult {
  const msgs = options.messages ?? defaultMessages;
  const authMsgs = msgs.auth;
  const totpMsgs = msgs.totp;
  const commonMsgs = msgs.common;

  // Generate the passkey script with embedded options and messages
  const passkeyScript = generateWebAuthnScript(
    options.passkeyOptions || null,
    options.passkeyVerifyUrl || '',
    authMsgs,
  );

  // Build forgot password link HTML if URL is provided
  const forgotPasswordLink = options.forgotPasswordUrl
    ? `<a href="${escapeHtml(options.forgotPasswordUrl)}" class="forgot-password-link">${escapeHtml(authMsgs.forgotPasswordLink)}</a>`
    : '';

  // Build error message HTML if error is provided
  const errorHtml = options.error ? escapeHtml(options.error) : '';

  // Process custom logo (handles URL vs HTML)
  const processedLogo = processCustomLogo(options.customLogo);

  const templateValues: EnhancedLoginTemplateVariables = {
    [pageTitle]: escapeHtml(authMsgs.pageTitle),
    [authorizeUrl]: options.authorizeUrl,
    [emailLabel]: escapeHtml(authMsgs.emailLabel),
    [emailPlaceholder]: escapeHtml(authMsgs.emailPlaceholder),
    [passwordLabel]: escapeHtml(authMsgs.passwordLabel),
    [passwordPlaceholder]: escapeHtml(authMsgs.passwordPlaceholder),
    [signInButton]: escapeHtml(authMsgs.signInButton),
    [dividerOr]: escapeHtml(authMsgs.dividerOr),
    [signInWithPasskey]: escapeHtml(authMsgs.signInWithPasskey),
    [backText]: escapeHtml(commonMsgs.back),
    [totpDescription]: escapeHtml(totpMsgs.description),
    [totpInputLabel]: escapeHtml(totpMsgs.inputLabel),
    [totpVerifyButton]: escapeHtml(totpMsgs.verifyButton),
    [forgotPasswordLinkHtml]: forgotPasswordLink,
    [errorMessageHtml]: errorHtml,
    [passkeyScriptHtml]: passkeyScript,
    [logoHtml]: processedLogo.html,
    [messages]: msgs,
  };

  return {
    html: enhancedLoginPageTemplate(templateValues),
    imgSrc: processedLogo.imgSrc,
  };
}

export { backIcon, decapLogo, loginPageStyles, passkeyIcon } from './decap-styles.js';
