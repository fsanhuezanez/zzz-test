import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectHttpFeed, USER_AGENT } from '../src/collectors/http-feed.ts';
import { automationDecision } from '../src/collectors/policy.ts';
import { isPathAllowed } from '../src/collectors/robots.ts';
import type { Source } from '../src/schema/sources.ts';

const ROBOTS = `
# comentario
User-agent: *
Disallow: /admin
Allow: /admin/public
Disallow: /*.json$

User-agent: zzz-meta-knowledge
User-agent: otro-bot
Disallow: /
Allow: /feeds/
`;

test('robots.txt: grupo específico, coincidencia más larga y comodines', () => {
  assert.equal(isPathAllowed(ROBOTS, 'zzz-meta-knowledge', '/feeds/zzz.json'), true);
  assert.equal(isPathAllowed(ROBOTS, 'zzz-meta-knowledge', '/tier-list'), false);
  assert.equal(isPathAllowed(ROBOTS, 'GenericBot', '/admin/x'), false);
  assert.equal(isPathAllowed(ROBOTS, 'GenericBot', '/admin/public/x'), true);
  assert.equal(isPathAllowed(ROBOTS, 'GenericBot', '/data.json'), false);
  assert.equal(isPathAllowed(ROBOTS, 'GenericBot', '/data.json?x=1'), true);
  assert.equal(isPathAllowed('', 'any', '/x'), true);
  assert.equal(isPathAllowed('User-agent: *\nDisallow:\n', 'any', '/x'), true);
});

function source(overrides: Partial<Source['automation']> = {}): Source {
  return {
    id: 'feed', name: 'Feed', kind: 'fixture', homepage: 'https://feed.example.com/', attribution: 'x',
    automation: { status: 'allowed', basis: 'permiso', checkedAt: '2026-10-27', evidenceUrls: ['https://feed.example.com/p'], allowedMethods: ['automated_feed'], ...overrides },
    adapter: { type: 'http_json_feed', url: 'https://feed.example.com/feeds/zzz.json', method: 'automated_feed', minIntervalMs: 1000, timeoutMs: 5000, respectRobotsTxt: true },
    tierScales: [], maxAgeDays: 30,
  };
}

test('política: unknown y disallowed bloquean; allowed exige método y evidencia', () => {
  assert.equal(automationDecision(source({ status: 'unknown' }), 'automated_feed').allowed, false);
  assert.equal(automationDecision(source({ status: 'disallowed' }), 'automated_feed').allowed, false);
  assert.equal(automationDecision(source(), 'automated_api').allowed, false);
  assert.equal(automationDecision(source({ evidenceUrls: [] }), 'automated_feed').allowed, false);
  assert.equal(automationDecision(source(), 'automated_feed').allowed, true);
});

test('feed: respeta robots.txt, se identifica y espera entre peticiones', async () => {
  const calls: { url: string; ua?: string }[] = [];
  const sleeps: number[] = [];
  const fetch = async (url: string, init?: { headers?: Record<string, string> }) => {
    calls.push({ url, ua: init?.headers?.['user-agent'] });
    return { ok: true, status: 200, text: async () => (url.endsWith('robots.txt') ? ROBOTS : '{"submissions":[{"a":1},{"b":2}]}') };
  };
  const r = await collectHttpFeed(source(), { fetch, sleep: async (ms) => { sleeps.push(ms); } });
  assert.equal(r.failure, undefined);
  assert.equal(r.submissions.length, 2);
  assert.deepEqual(calls.map((c) => c.url), ['https://feed.example.com/robots.txt', 'https://feed.example.com/feeds/zzz.json']);
  assert.ok(calls.every((c) => c.ua === USER_AGENT));
  assert.deepEqual(sleeps, [1000]);
});

test('feed: robots.txt que prohíbe o responde 403/5xx → no se accede', async () => {
  for (const [status, body] of [[200, 'User-agent: *\nDisallow: /\n'], [403, ''], [503, '']] as const) {
    const urls: string[] = [];
    const fetch = async (url: string) => {
      urls.push(url);
      return { ok: status === 200, status, text: async () => body };
    };
    const r = await collectHttpFeed(source(), { fetch, sleep: async () => {} });
    assert.ok(r.failure, `status ${status}`);
    assert.equal(urls.length, 1, 'solo se consulta robots.txt');
  }
});

test('feed: sin robots.txt (404) está permitido; política no permitida no hace peticiones', async () => {
  const fetch = async (url: string) => ({ ok: !url.endsWith('robots.txt'), status: url.endsWith('robots.txt') ? 404 : 200, text: async () => '{}' });
  assert.equal((await collectHttpFeed(source(), { fetch, sleep: async () => {} })).failure, undefined);
  let called = false;
  const spy = async () => { called = true; return { ok: true, status: 200, text: async () => '' }; };
  const blocked = await collectHttpFeed(source({ status: 'disallowed' }), { fetch: spy, sleep: async () => {} });
  assert.match(blocked.failure!, /política/);
  assert.equal(called, false);
});
