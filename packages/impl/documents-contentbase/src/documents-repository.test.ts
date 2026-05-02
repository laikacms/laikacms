import { describe, expect, it } from 'vitest';
import { ContentBaseDocumentsRepository } from './documents-repository.js';

describe('ContentBaseDocumentsRepository (smoke)', () => {
  it('is exported as a constructor', () => {
    expect(typeof ContentBaseDocumentsRepository).toBe('function');
  });

  it('constructs without performing I/O', () => {
    // Constructor only stores its three references and calls super(); no
    // side effects against storage or settings happen until a method is called.
    const repo = new ContentBaseDocumentsRepository(
      'posts',
      null as never,
      null as never,
    );
    expect(repo).toBeInstanceOf(ContentBaseDocumentsRepository);
  });
});
