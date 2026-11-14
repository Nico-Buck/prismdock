// What the windows may ask the main process to open or store (src/main/security.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isAppUrl, SAFE_URL, SEARCH_URL, SHELL_URL, isLocalPath, isSafeKey } = require('../src/main/security');

test('only our own pages count as the app', () => {
  assert.ok(isAppUrl('app://prism/dock.html'));
  assert.ok(isAppUrl('app://prism/settings.html?solid#widgets'));
  for (const u of ['https://example.com/', 'app://prism.evil/', 'file:///C:/x.html', 'about:blank', '', null, undefined]) assert.equal(isAppUrl(u), false, String(u));
});

test('Windows search is allowed with a query only', () => {
  assert.ok(SEARCH_URL.test('search-ms:query=report%202026'));
  assert.equal(SEARCH_URL.test('search-ms:query=x&crumb=location:\\\\evil\\share'), false);
  assert.equal(SAFE_URL.test('search-ms:crumb=location:\\\\evil\\share'), false);
});

test('shell URLs: folders and Store apps, nothing else', () => {
  assert.ok(SHELL_URL.test('shell:Downloads'));
  assert.ok(SHELL_URL.test('shell:AppsFolder\\Microsoft.WindowsCalculator_8wekyb3d8bbwe!App'));
  assert.equal(SHELL_URL.test('shell:AppsFolder\\x" /c calc'), false);
  assert.equal(SHELL_URL.test('shell:..\\..\\Windows\\System32\\cmd.exe'), false);
});

test('local paths only: no network shares, no other schemes', () => {
  assert.ok(isLocalPath('C:\\Program Files\\App\\app.exe'));
  assert.ok(isLocalPath('D:\\Music'));
  for (const p of ['\\\\host\\share\\x.exe', '//host/share/x.exe', 'file://host/x.exe', 'smb://host/x', '', 42]) assert.equal(isLocalPath(p), false, String(p));
});

test('data store keys cannot reach the prototype', () => {
  for (const k of ['todos', 'notes', 'pomodoroLog', 'notes:abc']) assert.ok(isSafeKey(k), k);
  for (const k of ['__proto__', 'constructor', 'prototype', '', 'a'.repeat(65), 'a b', 1]) assert.equal(isSafeKey(k), false, String(k));
});
