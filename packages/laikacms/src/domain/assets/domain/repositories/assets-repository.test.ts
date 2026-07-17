import { describe, expect, it } from 'vitest';

import { collectStream, runTask } from '../../../../shared/core/compat.js';
import { InvalidData, NotImplementedError } from '../../../../shared/core/index.js';
import type { FilteringCapability } from '../../../storage/index.js';
import { SyncToken } from '../../../storage/index.js';

import { AssetsRepository, validateListFilters } from './assets-repository.js';

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

describe('validateListFilters', () => {
  const supported: FilteringCapability = {
    supported: true,
    description: 'Filters apply to resource keys.',
    filters: [{ name: 'search', description: 'Case-insensitive substring match on the key.' }],
  };
  const unsupported: FilteringCapability = {
    supported: false,
    description: 'No filtering.',
  };

  it('returns undefined when no filters are requested', () => {
    expect(validateListFilters(undefined, supported)).toBeUndefined();
    expect(validateListFilters({}, supported)).toBeUndefined();
    // Even when filtering is absent entirely, an empty request is fine.
    expect(validateListFilters(undefined, undefined)).toBeUndefined();
  });

  it('returns undefined when every requested filter name is declared', () => {
    expect(validateListFilters({ search: 'logo' }, supported)).toBeUndefined();
  });

  // Note: identity-based instanceof checks would compare the src copy of
  // InvalidData against the dist copy used inside assets-repository.js (the
  // laikacms/* self-imports resolve to the built dist), so assert on the
  // stable error `code` instead — same style as the change-signal tests above.
  it('returns InvalidData naming the undeclared filter', () => {
    const error = validateListFilters({ bogus: 'x' }, supported);
    expect(error).toMatchObject({ code: InvalidData.CODE });
    expect(error!.message).toContain('bogus');
  });

  it('returns InvalidData for any filter when the capability is absent', () => {
    const error = validateListFilters({ search: 'logo' }, undefined);
    expect(error).toMatchObject({ code: InvalidData.CODE });
    expect(error!.message).toContain('search');
  });

  it('returns InvalidData for any filter when filtering is declared unsupported', () => {
    const error = validateListFilters({ search: 'logo' }, unsupported);
    expect(error).toMatchObject({ code: InvalidData.CODE });
    expect(error!.message).toContain('search');
  });
});
