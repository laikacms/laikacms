import { describe, expect, it } from 'vitest';

import { collectStream, runTask } from '../../../../shared/core/compat.js';
import { NotImplementedError } from '../../../../shared/core/index.js';
import { SyncToken } from '../../../storage/index.js';

import { AssetsRepository } from './assets-repository.js';

// A subclass that implements none of the change-signal surface: the
// non-abstract base defaults must kick in. Object.create skips the abstract
// members without having to stub all of them.
const bareRepo = (): AssetsRepository => Object.create(AssetsRepository.prototype) as AssetsRepository;

describe('AssetsRepository change-signal defaults', () => {
  it('getSyncToken fails with NotImplementedError by default', async () => {
    await expect(runTask(bareRepo().getSyncToken())).rejects.toMatchObject({
      code: NotImplementedError.CODE,
    });
  });

  it('listChanges fails with NotImplementedError by default', async () => {
    await expect(
      collectStream(bareRepo().listChanges({ since: SyncToken.make('0') })),
    ).rejects.toMatchObject({ code: NotImplementedError.CODE });
  });
});
