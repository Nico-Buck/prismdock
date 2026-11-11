// Minimal DOM patcher. Widgets render to HTML strings; instead of replacing a container's
// innerHTML on every data update (which re-creates every node, restarts images, drops hover
// state and makes charts flicker), the new markup is parsed once and only the differences
// are applied: changed text, changed attributes, added or removed nodes.
// Nodes are matched by position and tag; an optional data-key keeps identity in lists.

const tpl = document.createElement('template');

export function morph(container, html) {
  tpl.innerHTML = html;
  patchChildren(container, tpl.content);
  tpl.innerHTML = '';
}

function sameKind(a, b) {
  if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) return false;
  return a.nodeType !== 1 || (a.getAttribute('data-key') ?? null) === (b.getAttribute('data-key') ?? null);
}

function patchChildren(target, source) {
  let cur = target.firstChild;
  let next = source.firstChild;
  while (next) {
    const following = next.nextSibling;
    if (!cur) {
      target.appendChild(next); // moves the parsed node over, no clone needed
    } else if (sameKind(cur, next)) {
      patchNode(cur, next);
      cur = cur.nextSibling;
    } else {
      const replaced = cur; cur = cur.nextSibling;
      target.replaceChild(next, replaced);
    }
    next = following;
  }
  while (cur) { const n = cur.nextSibling; target.removeChild(cur); cur = n; }
}

function patchNode(a, b) {
  if (a.nodeType === 3 || a.nodeType === 8) { if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue; return; }
  if (a.nodeType !== 1) return;
  // attributes
  for (const { name, value } of b.attributes) if (a.getAttribute(name) !== value) a.setAttribute(name, value);
  for (let i = a.attributes.length - 1; i >= 0; i--) { const n = a.attributes[i].name; if (!b.hasAttribute(n)) a.removeAttribute(n); }
  // form state lives in properties, not attributes
  if (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT') {
    if (a === document.activeElement && a.type !== 'range') return; // never fight the user's typing
    if (a.type === 'checkbox' || a.type === 'radio') a.checked = b.hasAttribute('checked');
    else if (b.hasAttribute('value') && a.value !== b.getAttribute('value')) a.value = b.getAttribute('value');
    if (a.tagName !== 'SELECT') return;
  }
  patchChildren(a, b);
}
