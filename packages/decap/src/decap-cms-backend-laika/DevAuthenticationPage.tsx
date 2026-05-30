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
import React, { Component } from 'react';

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
    queueMicrotask(() => this.props.onLogin({ token }));
  }

  render() {
    return null;
  }
}

export default DevAuthenticationPage;
