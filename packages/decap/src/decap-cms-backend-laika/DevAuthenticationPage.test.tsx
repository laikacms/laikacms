import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import DevAuthenticationPage from './DevAuthenticationPage.js';

describe('DevAuthenticationPage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('submits a dev token only once when failed authentication remounts the page rapidly', async () => {
    const onLogin = vi.fn();

    new DevAuthenticationPage({ devToken: 'broken-local-api', onLogin }).componentDidMount();
    new DevAuthenticationPage({ devToken: 'broken-local-api', onLogin }).componentDidMount();
    await Promise.resolve();

    expect(onLogin).toHaveBeenCalledTimes(1);
    expect(onLogin).toHaveBeenCalledWith({ token: 'broken-local-api' });
  });

  it('retries after the cooldown window elapses (transient API unavailability)', async () => {
    const onLogin = vi.fn();

    new DevAuthenticationPage({ devToken: 'slow-api', onLogin }).componentDidMount();
    await Promise.resolve();
    expect(onLogin).toHaveBeenCalledTimes(1);

    // Simulate the cooldown passing and Decap remounting for retry
    vi.advanceTimersByTime(2001);
    new DevAuthenticationPage({ devToken: 'slow-api', onLogin }).componentDidMount();
    await Promise.resolve();

    expect(onLogin).toHaveBeenCalledTimes(2);
  });

  it('still blocks rapid remounts within the cooldown window', async () => {
    const onLogin = vi.fn();

    new DevAuthenticationPage({ devToken: 'api-token', onLogin }).componentDidMount();
    await Promise.resolve();

    vi.advanceTimersByTime(500);
    new DevAuthenticationPage({ devToken: 'api-token', onLogin }).componentDidMount();
    await Promise.resolve();

    expect(onLogin).toHaveBeenCalledTimes(1);
  });
});
