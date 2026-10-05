import { describe, expect, it } from 'vitest';

import {
  compareGoogleOAuthState,
  createGoogleOAuthState,
  hashGoogleOAuthState,
} from './google-oauth-state.js';

describe('Google OAuth state', () => {
  it('creates a random state and stores only its digest in the record', () => {
    const now = new Date('2025-01-01T00:00:00.000Z');
    const state = createGoogleOAuthState('user-id', now);
    expect(state.value).toHaveLength(43);
    expect(state.hash).toBe(hashGoogleOAuthState(state.value));
    expect(state.hash).not.toContain(state.value);
    expect(state.expiresAt).toEqual(new Date('2025-01-01T00:10:00.000Z'));
  });

  it('compares state digests without accepting a reused or altered value', () => {
    const state = createGoogleOAuthState('user-id');
    expect(compareGoogleOAuthState(state.value, state.hash)).toBe(true);
    expect(compareGoogleOAuthState(`${state.value}altered`, state.hash)).toBe(
      false,
    );
  });
});
