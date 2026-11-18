import { describe, expect, it } from 'vitest';
import { shareLinkFor } from './shareLink';

/**
 * The hosted link has to carry both facts, or it opens a page that cannot reach
 * the village and cannot say which visit it is.
 */
describe('the shared link for a hosted copy', () => {
  it('names the backend and the visit together', () => {
    expect(
      shareLinkFor('https://village.pages.dev', 'https://village.example.com', 'abc123'),
    ).toBe('https://village.pages.dev/?api=https%3A%2F%2Fvillage.example.com&share=abc123');
  });

  it('tolerates a trailing slash on either address, and a key needing one', () => {
    expect(shareLinkFor('https://village.pages.dev/', 'https://village.example.com/', 'a b')).toBe(
      'https://village.pages.dev/?api=https%3A%2F%2Fvillage.example.com&share=a%20b',
    );
  });

  it('is nothing at all when the page is the backend, or the key is missing', () => {
    // Same origin: the direct link is the right one, and this composition would
    // just repeat it with two extra parameters.
    expect(shareLinkFor('https://village.example.com', '', 'abc123')).toBeNull();
    expect(shareLinkFor('https://village.pages.dev', 'https://village.example.com', '')).toBeNull();
  });
});
