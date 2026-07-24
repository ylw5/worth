import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveApiUrl } from '../src/lib/api-url.ts';

test('prefers and normalizes an explicit API URL', () => {
  assert.equal(
    resolveApiUrl({
      explicitUrl: ' http://10.68.2.143:8000/ ',
      developmentHosts: ['192.168.1.10:8081'],
    }),
    'http://10.68.2.143:8000',
  );
});

test('derives the API port from an Expo development host', () => {
  assert.equal(
    resolveApiUrl({
      developmentHosts: [undefined, '10.68.2.143:8081'],
    }),
    'http://10.68.2.143:8000',
  );
});

test('accepts a host URI that already includes a scheme', () => {
  assert.equal(
    resolveApiUrl({
      developmentHosts: ['exp://192.168.1.20:8081'],
    }),
    'http://192.168.1.20:8000',
  );
});

test('returns undefined when no API location can be determined', () => {
  assert.equal(resolveApiUrl({}), undefined);
});
