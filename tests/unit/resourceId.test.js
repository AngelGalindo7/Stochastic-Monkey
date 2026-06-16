import { describe, it, expect } from 'vitest';
import { extractResourceId } from '../../src/perception/resourceId.js';

describe('extractResourceId — basic resource paths', () => {
  it('integer id: /api/items/42', () => {
    expect(extractResourceId('http://app/api/items/42')).toEqual({ collection: 'items', id: '42' });
  });

  it('UUID id: /api/users/<uuid>', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    expect(extractResourceId(`http://app/api/users/${uuid}`)).toEqual({ collection: 'users', id: uuid });
  });

  it('path-only string (no scheme): /products/99', () => {
    expect(extractResourceId('/products/99')).toEqual({ collection: 'products', id: '99' });
  });

  it('query string stripped: /items/7?include=meta', () => {
    expect(extractResourceId('/items/7?include=meta')).toEqual({ collection: 'items', id: '7' });
  });

  it('hash fragment stripped: /items/7#top', () => {
    expect(extractResourceId('/items/7#top')).toEqual({ collection: 'items', id: '7' });
  });
});

describe('extractResourceId — version prefix handling', () => {
  it('/api/v1/items/42 — v1 skipped, returns items/42', () => {
    expect(extractResourceId('http://app/api/v1/items/42')).toEqual({ collection: 'items', id: '42' });
  });

  it('/api/v10/items/42 — v10 skipped', () => {
    expect(extractResourceId('http://app/api/v10/items/42')).toEqual({ collection: 'items', id: '42' });
  });

  // KEY REGRESSION: hardcoded Set stopping at v10 would treat v11 as a collection name
  it('/api/v11/items/42 — v11 skipped (regex covers v11+)', () => {
    expect(extractResourceId('http://app/api/v11/items/42')).toEqual({ collection: 'items', id: '42' });
  });

  it('/api/v999/orders/1 — large version number skipped', () => {
    expect(extractResourceId('http://app/api/v999/orders/1')).toEqual({ collection: 'orders', id: '1' });
  });

  it('V2 uppercase is also skipped', () => {
    expect(extractResourceId('http://app/api/V2/items/5')).toEqual({ collection: 'items', id: '5' });
  });
});

describe('extractResourceId — nested (parent) resource paths', () => {
  it('/users/1/posts/99 — primary is posts/99, parent is users/1', () => {
    expect(extractResourceId('http://app/users/1/posts/99')).toEqual({
      collection: 'posts',
      id: '99',
      parentCollection: 'users',
      parentId: '1',
    });
  });

  it('/api/v2/orgs/5/members/12 — version stripped, two levels resolved', () => {
    expect(extractResourceId('http://app/api/v2/orgs/5/members/12')).toEqual({
      collection: 'members',
      id: '12',
      parentCollection: 'orgs',
      parentId: '5',
    });
  });
});

describe('extractResourceId — returns null for non-resource paths', () => {
  it('collection-only (no id): /api/items', () => {
    expect(extractResourceId('http://app/api/items')).toBeNull();
  });

  it('bare integer with no preceding collection: /42', () => {
    expect(extractResourceId('/42')).toBeNull();
  });

  it('static asset: /static/bundle.js', () => {
    expect(extractResourceId('http://app/static/bundle.js')).toBeNull();
  });

  it('image asset: /images/logo.png', () => {
    expect(extractResourceId('/images/logo.png')).toBeNull();
  });

  it('meta endpoint: /api/health', () => {
    expect(extractResourceId('http://app/api/health')).toBeNull();
  });

  it('meta endpoint: /api/ping', () => {
    expect(extractResourceId('/api/ping')).toBeNull();
  });

  it('meta endpoint: /status', () => {
    expect(extractResourceId('/status')).toBeNull();
  });

  it('favicon: /favicon.ico', () => {
    expect(extractResourceId('http://app/favicon.ico')).toBeNull();
  });

  it('root path: /', () => {
    expect(extractResourceId('/')).toBeNull();
  });

  it('empty string', () => {
    expect(extractResourceId('')).toBeNull();
  });

  it('action segment after collection (no id): /api/items/create', () => {
    expect(extractResourceId('http://app/api/items/create')).toBeNull();
  });
});

describe('extractResourceId — PostgREST query-param fallback', () => {
  it('DELETE /rest/v1/items?id=eq.42 → integer id', () => {
    expect(extractResourceId('https://abc.supabase.co/rest/v1/items?id=eq.42'))
      .toEqual({ collection: 'items', id: '42' });
  });

  it('PATCH /rest/v1/posts?id=eq.<uuid>', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    expect(extractResourceId(`https://abc.supabase.co/rest/v1/posts?id=eq.${uuid}`))
      .toEqual({ collection: 'posts', id: uuid });
  });

  it('uuid column name: ?uuid=eq.<uuid>', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    expect(extractResourceId(`https://abc.supabase.co/rest/v1/items?uuid=eq.${uuid}`))
      .toEqual({ collection: 'items', id: uuid });
  });

  it('ignores non-eq operators: ?id=gt.5 → null', () => {
    expect(extractResourceId('https://abc.supabase.co/rest/v1/items?id=gt.5')).toBeNull();
  });

  it('ignores non-id columns: ?name=eq.foo → null', () => {
    expect(extractResourceId('https://abc.supabase.co/rest/v1/items?name=eq.foo')).toBeNull();
  });

  it('path-based id still wins when present (no fallback triggered)', () => {
    expect(extractResourceId('https://abc.supabase.co/rest/v1/items/42?select=*'))
      .toEqual({ collection: 'items', id: '42' });
  });

  it('collection-only URL with select param stays null: /rest/v1/items?select=*', () => {
    expect(extractResourceId('https://abc.supabase.co/rest/v1/items?select=*')).toBeNull();
  });
});

describe('extractResourceId — malformed / edge inputs', () => {
  it('null does not throw, returns null', () => {
    expect(extractResourceId(null)).toBeNull();
  });

  it('undefined does not throw, returns null', () => {
    expect(extractResourceId(undefined)).toBeNull();
  });

  it('non-string number does not throw, returns null', () => {
    expect(extractResourceId(42)).toBeNull();
  });

  it('completely malformed string does not throw', () => {
    expect(() => extractResourceId(':::not a url:::')).not.toThrow();
  });
});
