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

// Decap remounts the authentication page when login fails. Without retaining
// this state outside the component, an unavailable local API turns that
// remount cycle into an unbounded stream of login and `/session` requests.
// Reloading the admin page reloads this module and permits a fresh attempt.
const attemptedDevTokens = new Set<string>();

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
    if (attemptedDevTokens.has(token)) return;
    attemptedDevTokens.add(token);
    queueMicrotask(() => this.props.onLogin({ token }));
  }

  render() {
    return null;
  }
}

export default DevAuthenticationPage;
