/**
 * Auto-login auth component used when the `laika` backend is configured
 * with `dev_token`. Mounts, immediately calls `onLogin({ token })`, and
 * shows nothing visible (the editor navigates away as soon as the
 * subsequent `authenticate()` call resolves).
 *
 * This is a development-only shortcut: it skips the PKCE OAuth dance
 * entirely. The embedded server is expected to be configured with the
 * matching token (see `createEmbeddedLaika({ auth: { mode: 'dev' } })`).
 */
import { Component } from 'react';

// Decap remounts the authentication page when login fails. Track the last
// attempt timestamp per token so rapid remounts (unbounded storm) are
// debounced, but a retry is allowed once the cooldown window has elapsed
// (handles transient failures such as the local API not yet being ready).
// Reloading the admin page resets this module state and permits an
// immediate fresh attempt.
const RETRY_COOLDOWN_MS = 2000;
const lastAttemptMs = new Map<string, number>();

export interface DevAuthPageProps {
  onLogin: (user: unknown) => void;
  inProgress?: boolean;
  // The backend wires this via a factory wrapper; not provided by Decap.
  devToken?: string;
}

class DevAuthenticationPage extends Component<DevAuthPageProps> {
  componentDidMount() {
    const token = this.props.devToken ?? '';
    if (!token) {
      console.warn(
        '[laika dev auth] DevAuthenticationPage mounted without devToken — '
          + 'this should not happen; check createLaikaBackend wiring.',
      );
      return;
    }
    const last = lastAttemptMs.get(token) ?? 0;
    if (Date.now() - last < RETRY_COOLDOWN_MS) return;
    lastAttemptMs.set(token, Date.now());
    queueMicrotask(() => this.props.onLogin({ token }));
  }

  render() {
    return null;
  }
}

export default DevAuthenticationPage;
