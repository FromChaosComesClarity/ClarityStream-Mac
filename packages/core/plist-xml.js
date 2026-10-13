'use strict';
// Apple's XML property lists, as `plutil -convert xml1` writes them.
//
// Moonlight's preferences cannot go through `plutil -convert json`. Qt stores
// byte arrays (the client's certificate and key, each host's server
// certificate, each host's MAC address) as <data>, JSON has no way to say
// that, and plutil refuses the whole file rather than drop those values. XML
// carries them, and plutil writes it regularly enough that a small reader
// covers it without a dependency.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function unescapeText(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, e) => {
    if (e[0] !== '#') return ENTITIES[e] ?? whole;
    const hex = e[1] === 'x' || e[1] === 'X';
    return String.fromCodePoint(parseInt(e.slice(hex ? 2 : 1), hex ? 16 : 10));
  });
}

// Tags and the text between them, with the prologue, doctype and comments
// gone. Attributes are not needed: the only element that has any is <plist>.
function tokenize(xml) {
  const body = String(xml ?? '').replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>/g, '');
  const out = [];
  const re = /<(\/?)([A-Za-z]+)[^>]*?(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(body))) {
    if (m[4] !== undefined) out.push({ text: m[4] });
    else out.push({ name: m[2], close: m[1] === '/', empty: m[3] === '/' });
  }
  return out;
}

function parse(xml) {
  const t = tokenize(xml);
  let i = 0;

  const skipBlank = () => { while (t[i]?.text !== undefined && !t[i].text.trim()) i++; };

  // The text of an element whose opening tag has just been read. `<string/>`
  // and `<data></data>` are both empty, and plutil writes both.
  const textOf = (tag) => {
    if (tag.empty) return '';
    let s = '';
    while (t[i]?.text !== undefined) s += t[i++].text;
    const end = t[i++];
    if (!end || !end.close || end.name !== tag.name) throw new Error(`<${tag.name}> is not closed`);
    return unescapeText(s);
  };

  const value = () => {
    skipBlank();
    const tag = t[i++];
    if (!tag || tag.text !== undefined || tag.close) throw new Error('expected a value');
    switch (tag.name) {
      case 'string': return textOf(tag);
      case 'integer':
      case 'real': return Number(textOf(tag));
      case 'true': textOf(tag); return true;
      case 'false': textOf(tag); return false;
      case 'date': return new Date(textOf(tag));
      case 'data': return Buffer.from(textOf(tag).replace(/\s+/g, ''), 'base64');
      case 'array': return tag.empty ? [] : list(tag);
      case 'dict': return tag.empty ? Object.create(null) : dict(tag);
      default: throw new Error(`<${tag.name}> is not a property list value`);
    }
  };

  const closes = (tag) => { skipBlank(); return t[i]?.close && t[i].name === tag.name; };

  const list = (tag) => {
    const out = [];
    while (!closes(tag)) {
      if (i >= t.length) throw new Error('<array> is not closed');
      out.push(value());
    }
    i++;
    return out;
  };

  // No prototype, so a key named __proto__ is only a key.
  const dict = (tag) => {
    const out = Object.create(null);
    while (!closes(tag)) {
      const key = t[i++];
      if (!key || key.name !== 'key' || key.close) throw new Error('expected a <key> in <dict>');
      out[textOf(key)] = value();
    }
    i++;
    return out;
  };

  while (i < t.length && !(t[i].name === 'plist' && !t[i].close)) i++;
  if (i >= t.length) throw new Error('no <plist> element');
  i++;
  return value();
}

module.exports = { parse };
