import { describe, expect, it, vi } from 'vitest';

import DevAuthenticationPage from './DevAuthenticationPage.js';

describe('DevAuthenticationPage', () => {
  it('submits a dev token only once when failed authentication remounts the page', async () => {
    const onLogin = vi.fn();

    new DevAuthenticationPage({ devToken: 'broken-local-api', onLogin }).componentDidMount();
    new DevAuthenticationPage({ devToken: 'broken-local-api', onLogin }).componentDidMount();
    await Promise.resolve();

    expect(onLogin).toHaveBeenCalledTimes(1);
    expect(onLogin).toHaveBeenCalledWith({ token: 'broken-local-api' });
  });
});
