// Rules for what the windows may ask the main process to do. Kept free of Electron so they can be tested.

const APP_ORIGIN = 'app://prism/';
// our own pages (dock and settings) - the only ones that may use the IPC API or be navigated to
const isAppUrl = (url) => typeof url === 'string' && url.startsWith(APP_ORIGIN);

// URLs handed to Windows as they are
const SAFE_URL = /^(https?:|mailto:|ms-settings:|ms-screenclip:|ms-clock:|spotify:|outlookcal:|ms-actioncenter:|ms-availablenetworks:)/i;
// Windows search with a query only: other search-ms parameters (crumb=location:\\host\share) can show files from
// a remote share, a known phishing trick
const SEARCH_URL = /^search-ms:query=[^&]*$/i;
// shell folders ("shell:Downloads") and Store apps ("shell:AppsFolder\<AppUserModelID>"), nothing else
const SHELL_URL = /^shell:[\w ]+(\\[\w.!-]+)?$/i;
// a local path the launcher may open: no network shares (\\host\x.exe) and no other URL schemes
const isLocalPath = (p) => typeof p === 'string' && p.length > 0 && !/^\\\\/.test(p) && !/^\/\//.test(p) && !/^[a-z][\w+.-]*:\/\//i.test(p);
// keys of the widget data store: no __proto__, constructor or other odd names
const SAFE_KEY = /^[\w.:-]{1,64}$/;
const isSafeKey = (k) => typeof k === 'string' && SAFE_KEY.test(k) && !['__proto__', 'constructor', 'prototype'].includes(k);

module.exports = { APP_ORIGIN, isAppUrl, SAFE_URL, SEARCH_URL, SHELL_URL, isLocalPath, isSafeKey };
