import type { AuthTranslation, OAuthMessages } from '../i18n/index.js';
import { decapLogo, loginPageStyles, passkeyIcon } from './decap-styles.js';
import {
  authorizeUrl,
  captchaScript,
  captchaWidget,
  forgotPasswordSection,
  html,
  HtmlTemplate,
  logoHtml,
  passkeyScript,
  passkeySection,
  passkeyStyles,
  processCustomLogo,
  templateVars,
} from './html.js';

const PASSKEY_STYLES_FRAGMENT = `
    .divider {
      display: flex;
      align-items: center;
      gap: 15px;
      margin: 20px 0;
      color: #798291;
      font-size: 12px;
      text-transform: uppercase;
    }
    .divider::before,
    .divider::after {
      content: '';
      flex: 1;
      height: 1px;
      background-color: #dfdfe3;
    }
    .passkey-button {
      border: 2px solid #dfdfe3;
      border-radius: 5px;
      cursor: pointer;
      height: 36px;
      line-height: 32px;
      font-weight: 500;
      padding: 0 20px;
      background-color: #fff;
      color: #313d3e;
      font-size: 14px;
      font-family: inherit;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: 100%;
      transition: background-color 0.2s ease, border-color 0.2s ease;
    }
    .passkey-button:hover {
      background-color: #f5f5f5;
      border-color: #c4c4c4;
    }
    .passkey-button:disabled {
      background-color: #eff0f4;
      color: #798291;
      cursor: default;
    }
    .passkey-icon {
      width: 20px;
      height: 20px;
    }
    .loading-spinner {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid #313d3e;
      border-radius: 50%;
      border-top-color: transparent;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    .passkey-auto-login {
      text-align: center;
      padding: 20px;
      color: #798291;
      font-size: 14px;
    }
    .passkey-auto-login .loading-spinner {
      margin-bottom: 10px;
    }
`;

const getPasskeySectionFragment = (signInWithPasskeyText: string) => `
    <div class="divider">or</div>
    <button id="passkey-button" class="passkey-button" type="button">
      <svg class="passkey-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M2 12C2 6.5 6.5 2 12 2a10 10 0 0 1 8 4"/>
        <path d="M5 19.5C5.5 18 6 15 6 12c0-.7.12-1.37.34-2"/>
        <path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/>
        <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/>
        <path d="M8.65 22c.21-.66.45-1.32.57-2"/>
        <path d="M14 13.12c0 2.38 0 6.38-1 8.88"/>
        <path d="M2 16h.01"/>
        <path d="M21.8 16c.2-2 .131-5.354 0-6"/>
        <path d="M9 6.8a6 6 0 0 1 9 5.2c0 .47 0 1.17-.02 2"/>
      </svg>
      ${signInWithPasskeyText}
    </button>
`;

// Keep backward compatibility
const PASSKEY_SECTION_FRAGMENT = getPasskeySectionFragment('Sign in with Passkey');

export interface AuthPagePasskeyOptions {
  challenge: string;
  rpId: string;
  timeout: number;
  userVerification: string;
  allowCredentials?: Array<{ type: string; id: string; transports?: string[]; }>;
}

export function generatePasskeyScript(
  passkeyOptions: AuthPagePasskeyOptions | null,
  verifyUrl: string,
  messages?: AuthTranslation,
): string {
  const optionsJson = passkeyOptions ? JSON.stringify(passkeyOptions) : 'null';

  // Use provided messages or defaults
  const authenticatingText = messages?.authenticating ?? 'Authenticating...';
  const signingInWithPasskeyText = messages?.signingInWithPasskey ?? 'Signing in with passkey...';
  const passkeyAuthFailedText = messages?.passkeyAuthFailed ?? 'Passkey authentication failed';
  const passkeyOptionsNotAvailableText = messages?.passkeyOptionsNotAvailable ?? 'Passkey options not available';
  const noCredentialReturnedText = messages?.noCredentialReturned ?? 'No credential returned';
  const authenticationFailedText = messages?.authenticationFailed ?? 'Authentication failed';

  return `
  <script>
    (function() {
      var verifyUrl = ${JSON.stringify(verifyUrl)};
      var embeddedOpts = ${optionsJson};
      var i18n = {
        authenticating: ${JSON.stringify(authenticatingText)},
        signingInWithPasskey: ${JSON.stringify(signingInWithPasskeyText)},
        passkeyAuthFailed: ${JSON.stringify(passkeyAuthFailedText)},
        passkeyOptionsNotAvailable: ${JSON.stringify(passkeyOptionsNotAvailableText)},
        noCredentialReturned: ${JSON.stringify(noCredentialReturnedText)},
        authenticationFailed: ${JSON.stringify(authenticationFailedText)}
      };
      
      if (!window.PublicKeyCredential) {
        var btn = document.getElementById('passkey-button');
        if (btn) btn.style.display = 'none';
        var divider = document.querySelector('.divider');
        if (divider) divider.style.display = 'none';
        return;
      }
      
      function b64ToArr(b64) {
        var pad = '='.repeat((4 - b64.length % 4) % 4);
        var s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + pad);
        var arr = new Uint8Array(s.length);
        for (var i = 0; i < s.length; i++) arr[i] = s.charCodeAt(i);
        return arr.buffer;
      }
      
      function arrToB64(buf) {
        var arr = new Uint8Array(buf);
        var s = '';
        for (var i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
        return btoa(s).replace(/[+]/g, '-').replace(/[/]/g, '_').replace(/=/g, '');
      }
      
      async function authenticateWithPasskey(opts, showUI) {
        var publicKeyOpts = {
          challenge: b64ToArr(opts.challenge),
          rpId: opts.rpId,
          timeout: opts.timeout,
          userVerification: opts.userVerification
        };
        
        if (opts.allowCredentials && opts.allowCredentials.length > 0) {
          publicKeyOpts.allowCredentials = opts.allowCredentials.map(function(c) {
            return {
              type: c.type,
              id: b64ToArr(c.id),
              transports: c.transports
            };
          });
        }
        
        var cred = await navigator.credentials.get({
          publicKey: publicKeyOpts,
          mediation: showUI ? 'optional' : 'conditional'
        });
        
        if (!cred) {
          throw new Error(i18n.noCredentialReturned);
        }
        
        var resp = {
          id: cred.id,
          rawId: arrToB64(cred.rawId),
          type: cred.type,
          response: {
            authenticatorData: arrToB64(cred.response.authenticatorData),
            clientDataJSON: arrToB64(cred.response.clientDataJSON),
            signature: arrToB64(cred.response.signature),
            userHandle: cred.response.userHandle ? arrToB64(cred.response.userHandle) : null
          }
        };
        
        var verRes = await fetch(verifyUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(resp)
        });
        
        if (!verRes.ok) {
          var err = await verRes.json();
          throw new Error(err.error_description || i18n.authenticationFailed);
        }
        
        var result = await verRes.json();
        
        if (result.requires_totp && result.totp_session && result.authorize_url) {
          var totpUrl = new URL(result.authorize_url);
          totpUrl.searchParams.set('totp_session', result.totp_session);
          window.location.href = totpUrl.toString();
          return result;
        }
        
        if (result.redirect_uri) {
          window.location.href = result.redirect_uri;
        }
        
        return result;
      }
      
      var btn = document.getElementById('passkey-button');
      
      if (btn) {
        btn.addEventListener('click', async function(e) {
          e.preventDefault();
          var orig = btn.innerHTML;
          btn.innerHTML = '<span class="loading-spinner"></span> ' + i18n.authenticating;
          btn.disabled = true;
          
          try {
            if (!embeddedOpts) {
              throw new Error(i18n.passkeyOptionsNotAvailable);
            }
            await authenticateWithPasskey(embeddedOpts, true);
          } catch (err) {
            if (err.name !== 'NotAllowedError') {
              alert(err.message || i18n.passkeyAuthFailed);
            }
            btn.innerHTML = orig;
            btn.disabled = false;
          }
        });
      }
      
      if (embeddedOpts && embeddedOpts.allowCredentials && embeddedOpts.allowCredentials.length > 0) {
        if (window.PublicKeyCredential.isConditionalMediationAvailable) {
          window.PublicKeyCredential.isConditionalMediationAvailable().then(function(available) {
            if (available) {
              authenticateWithPasskey(embeddedOpts, false).catch(function(err) {
                console.log('Conditional passkey auth not completed:', err.message);
              });
            } else {
              attemptAutoLogin();
            }
          });
        } else {
          attemptAutoLogin();
        }
      }
      
      function attemptAutoLogin() {
        setTimeout(function() {
          var form = document.querySelector('.auth-form');
          if (form) {
            var autoLoginDiv = document.createElement('div');
            autoLoginDiv.className = 'passkey-auto-login';
            autoLoginDiv.id = 'passkey-auto-login';
            autoLoginDiv.innerHTML = '<span class="loading-spinner"></span><br>' + i18n.signingInWithPasskey;
            form.insertBefore(autoLoginDiv, form.firstChild);
          }
          
          authenticateWithPasskey(embeddedOpts, true).catch(function(err) {
            var indicator = document.getElementById('passkey-auto-login');
            if (indicator) indicator.remove();
            console.log('Auto passkey login not completed:', err.message);
          });
        }, 100);
      }
    })();
  </script>
`;
}

export const defaultAuthorizationPageTemplate: HtmlTemplate = html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sign In - Decap CMS</title>
  <style>
    *,
    *:before,
    *:after {
      box-sizing: border-box;
    }
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol";
      font-weight: normal;
      display: flex;
      flex-flow: column nowrap;
      align-items: center;
      justify-content: center;
      gap: 50px;
      min-height: 100vh;
      margin: 0;
      background-color: #eff0f4;
      color: #798291;
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
    .auth-form {
      width: 350px;
      margin-top: -30px;
    }
    .error-message {
      color: #ff003b;
      font-size: 14px;
      margin-bottom: 10px;
    }
    .form-group {
      margin-bottom: 15px;
    }
    .form-label {
      display: block;
      font-size: 12px;
      text-transform: uppercase;
      font-weight: 600;
      color: #5D626F;
      margin-bottom: 6px;
    }
    .form-input {
      background-color: #fff;
      border-radius: 5px;
      border: solid 2px #dfdfe3;
      font-size: 14px;
      padding: 10px;
      width: 100%;
      font-family: inherit;
      transition: box-shadow 0.2s ease, border-color 0.2s ease;
    }
    .form-input:focus {
      outline: none;
      border-color: #3a69c7;
      box-shadow: inset 0 0 0 1px #3a69c7;
    }
    .login-button {
      border: 0;
      border-radius: 5px;
      cursor: pointer;
      height: 36px;
      line-height: 36px;
      font-weight: 500;
      padding: 0 30px;
      background-color: #313d3e;
      color: #fff;
      font-size: 14px;
      font-family: inherit;
      display: block;
      margin-top: 20px;
      margin-left: auto;
      box-shadow: 0 4px 12px 0 rgba(68, 74, 87, 0.15), 0 1px 3px 0 rgba(68, 74, 87, 0.25);
      transition: background-color 0.2s ease;
    }
    .login-button:hover {
      background-color: #555a65;
    }
    .login-button:focus {
      outline: -webkit-focus-ring-color auto 5px;
    }
    .login-button:disabled {
      background-color: #eff0f4;
      color: #798291;
      cursor: default;
      box-shadow: none;
    }
    .go-back {
      display: flex;
      align-items: center;
      gap: 8px;
      color: #798291;
      font-size: 14px;
      font-weight: 500;
      text-decoration: none;
      transition: color 0.2s ease;
    }
    .go-back:hover {
      color: #313d3e;
    }
    .go-back svg {
      width: 20px;
      height: 20px;
    }
    .forgot-password-link {
      display: block;
      text-align: right;
      margin-top: 8px;
      font-size: 13px;
      color: #3a69c7;
      text-decoration: none;
      transition: color 0.2s ease;
    }
    .forgot-password-link:hover {
      color: #2a4a8f;
      text-decoration: underline;
    }
    ${passkeyStyles}
  </style>
  ${captchaScript}
</head>
<body>
  <div class="logo">
    ${logoHtml}
  </div>
  <form class="auth-form" method="POST" action="${authorizeUrl}">
    <div class="form-group">
      <label class="form-label" for="email">Email</label>
      <input class="form-input" type="email" id="email" name="email" required autocomplete="email" placeholder="Email" />
    </div>
    <div class="form-group">
      <label class="form-label" for="password">Password</label>
      <input class="form-input" type="password" id="password" name="password" required autocomplete="current-password" placeholder="Password" />
      ${forgotPasswordSection}
    </div>
    ${captchaWidget}
    <button class="login-button" type="submit">Login</button>
    ${passkeySection}
  </form>
  ${passkeyScript}
</body>
</html>`;

export interface AuthorizationPageOptions {
  passkeyEnabled?: boolean;
  passkeyOptions?: AuthPagePasskeyOptions | null;
  passkeyVerifyUrl?: string;
  forgotPasswordUrl?: string;
  /** CAPTCHA widget HTML to render in the form (e.g., reCAPTCHA, hCaptcha, Turnstile div) */
  captchaWidgetHtml?: string;
  /** CAPTCHA script HTML to load in the head (e.g., reCAPTCHA, hCaptcha, Turnstile script tag) */
  captchaScriptHtml?: string;
  /** Custom logo HTML or URL (defaults to Decap CMS logo) */
  customLogo?: string;
  /**
   * Localized messages for user-facing strings.
   * If not provided, defaults to English messages.
   */
  messages?: OAuthMessages;
}

/**
 * Result of rendering the authorization page
 */
export interface AuthorizationPageResult {
  /** The rendered HTML string */
  html: string;
  /** Additional img-src values to add to CSP (for external logo URLs) */
  imgSrc: string[];
}

const FORGOT_PASSWORD_SECTION_FRAGMENT = (url: string, text: string) => `
      <a href="${url}" class="forgot-password-link">${text}</a>
`;

// Default English messages for backward compatibility
const defaultAuthMessages: AuthTranslation = {
  pageTitle: 'Sign In - Decap CMS',
  emailLabel: 'Email',
  emailPlaceholder: 'Email',
  passwordLabel: 'Password',
  passwordPlaceholder: 'Password',
  signInButton: 'Sign In',
  loginButton: 'Login',
  forgotPasswordLink: 'Forgot password?',
  dividerOr: 'or',
  signInWithPasskey: 'Sign in with Passkey',
  authenticating: 'Authenticating...',
  signingInWithPasskey: 'Signing in with passkey...',
  passkeyAuthFailed: 'Passkey authentication failed. Please try again or use password.',
  passkeyOptionsNotAvailable: 'Passkey options not available',
  noCredentialReturned: 'No credential returned',
  authenticationFailed: 'Authentication failed',
};

/**
 * Get the authorization page HTML with custom logo support
 * @returns Object with html string and imgSrc array for CSP
 */
export function getAuthorizationPageHTML(authUrl: string, options?: AuthorizationPageOptions): AuthorizationPageResult {
  // Get messages with fallback to defaults
  const auth = options?.messages?.auth ?? defaultAuthMessages;

  const passkeyScriptContent = options?.passkeyEnabled
    ? generatePasskeyScript(options.passkeyOptions || null, options.passkeyVerifyUrl || '', auth)
    : '';

  // Generate passkey section with localized text
  const passkeySectionContent = options?.passkeyEnabled
    ? getPasskeySectionFragment(auth.signInWithPasskey)
    : '';

  // Process custom logo (handles URL vs HTML)
  const processedLogo = processCustomLogo(options?.customLogo);

  const html = defaultAuthorizationPageTemplate({
    [authorizeUrl]: authUrl,
    [passkeyStyles]: options?.passkeyEnabled ? PASSKEY_STYLES_FRAGMENT : '',
    [passkeySection]: passkeySectionContent,
    [passkeyScript]: passkeyScriptContent,
    [forgotPasswordSection]: options?.forgotPasswordUrl
      ? FORGOT_PASSWORD_SECTION_FRAGMENT(options.forgotPasswordUrl, auth.forgotPasswordLink)
      : '',
    [captchaWidget]: options?.captchaWidgetHtml || '',
    [captchaScript]: options?.captchaScriptHtml || '',
    [logoHtml]: processedLogo.html,
  });

  return {
    html,
    imgSrc: processedLogo.imgSrc,
  };
}
