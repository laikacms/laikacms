import { PkceAuthenticator } from 'decap-cms-lib-auth';
import { AuthenticationPage, Icon } from 'decap-cms-ui-default';
import React, { Component } from 'react';

interface BackendConfig {
  base_url?: string;
  app_id?: string;
  auth_endpoint?: string;
  auth_token_endpoint?: string;
  auth_token_endpoint_content_type?: string;
  use_oidc?: boolean;
  [key: string]: unknown;
}

interface CMSConfig {
  backend?: BackendConfig;
  logo_url?: string;
  site_url?: string;
  [key: string]: unknown;
}

// Exported so that downstream aggregated exports (e.g. an object containing this component)
// can have a fully nameable type and avoid TS4023 (private type in exported symbol).
// Re-exported interface must be a named export actually exported from this module
// Exporting both type and value namespace (type only) for downstream re-exports.
export interface PKCEAuthPageProps {
  onLogin: (user: unknown) => void; // Upstream expects Credentials-like object
  inProgress?: boolean;
  config?: CMSConfig;
  t?: (key: string) => string;
}

interface PKCEAuthPageState {
  loginError?: string;
}

class PKCEAuthenticationPage extends Component<PKCEAuthPageProps, PKCEAuthPageState> {
  private auth?: PkceAuthenticator;

  constructor(props: PKCEAuthPageProps) {
    super(props);
    this.state = {};
  }

  componentDidMount() {
    const {
      base_url = '',
      app_id = '',
      auth_endpoint = 'oauth2/authorize',
      auth_token_endpoint = 'oauth2/token',
      auth_token_endpoint_content_type = 'application/x-www-form-urlencoded; charset=utf-8',
      use_oidc = false,
    } = this.props.config?.backend || {};

    if (!base_url || !app_id) {
      this.setState({ loginError: 'Missing required configuration: base_url and app_id are required' });
      return;
    }

    this.auth = new PkceAuthenticator({
      base_url,
      auth_endpoint,
      app_id,
      auth_token_endpoint,
      auth_token_endpoint_content_type,
      use_oidc,
    });

    this.auth.completeAuth((err: Error | null, data: unknown) => {
      if (err) {
        this.setState({ loginError: err.toString() });
        return;
      }
      (data as any).token = (data as any).id_token; // Force usage of id_token as token
      if (data) {
        this.props.onLogin(data);
      }
    });
  }

  handleLogin = (e: React.MouseEvent) => {
    e.preventDefault();

    if (!this.auth) {
      this.setState({ loginError: 'Authentication not properly initialized' });
      return;
    }

    const scope = 'openid email profile';

    this.auth.authenticate({ scope }, (err: Error | null, data: unknown) => {
      if (err) {
        this.setState({ loginError: err.toString() });
        return;
      }
      (data as any).token = (data as any).id_token; // Force usage of id_token as token
      if (data) {
        this.props.onLogin(data);
      }
    });
  };

  render() {
    const { inProgress = false, config, t = (key: string) => key } = this.props;
    const { loginError } = this.state;

    return (
      <AuthenticationPage
        onLogin={this.handleLogin}
        loginDisabled={inProgress}
        loginErrorMessage={loginError}
        logoUrl={config?.logo_url}
        // "logo" prop is optional visual override; pass through logoUrl for type satisfaction
        logo={config?.logo_url}
        siteUrl={config?.site_url}
        renderButtonContent={() => (
          <React.Fragment>
            <Icon type="link" /> {inProgress ? t('auth.loggingIn') : t('auth.login')}
          </React.Fragment>
        )}
        renderPageContent={undefined}
        t={t}
      />
    );
  }
}

export default PKCEAuthenticationPage;
