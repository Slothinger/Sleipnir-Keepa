// ==UserScript==
// @name Keepa Preisverlauf (Amazon.de)
// @author Claude
// @version 1.0.3
// @description Zeigt den Keepa-Preisverlauf auf Amazon.de-Produktseiten an. Optimiert fuer grosse Android-Displays wie das Galaxy S25 Ultra.
// @include *
// @include http://*
// @include https://*
// ==/UserScript==

/*
 * Keepa-Preisverlauf fuer Sleipnir Mobile (Android)
 *
 * - Liest die ASIN der Produktseite aus und blendet Keepas Preisverlaufs-Grafik ein.
 * - Zeitraum per Tipp umschaltbar (1 M / 3 M / 1 J / Alle), Auswahl wird gemerkt.
 * - Tipp auf die Grafik: Grossansicht zum seitlichen Wischen (mehr Details).
 * - Passt sich an Displaybreite, Drehung und Variantenwechsel (Farbe/Groesse) an.
 * - Bewusst in ES5 geschrieben, damit es in jeder WebView-Version laeuft.
 * - Nutzt keine SLEX_-APIs (kein "@require api" noetig).
 *
 * 1.0.3: Diagnose-Leiste ausgeschaltet (CONFIG.debug = false).
 * 1.0.2: Gleiche @include-Muster wie die funktionierende Testerweiterung, Amazon-Pruefung
 *        im Skript; Datei rein ASCII, ohne Zeilenkommentare und ohne Raute-/Prozentzeichen
 *        (falls Sleipnir den Code beim Einspielen umformt).
 * 1.0.1: Kopfzeilen ohne Ausrichtungs-Leerzeichen, @include-Muster, die auch greifen,
 *        falls "*" in Sleipnir keine "/" ueberspringt, mehr Wege die ASIN zu finden,
 *        Diagnose-Leiste (CONFIG.debug).
 *
 * Hinweis: graph.keepa.com ist kein offiziell dokumentierter Endpunkt und kann
 * sich jederzeit aendern. Keepa erhaelt beim Laden der Grafik die ASIN (wie beim
 * offiziellen Add-on).
 */

(function () {
  'use strict';

  var VERSION = '1.0.3';

  /* ===================== Einstellungen ===================== */
  var CONFIG = {
    debug: false,           /* true = Diagnose-Leiste unten einblenden, false = aus */
    domainId: 3,            /* Keepa-Marktplatz: 3 = amazon.de */
    series: {               /* 1 = anzeigen, 0 = ausblenden */
      'amazon': 1,          /* Preis von Amazon selbst */
      'new': 1,             /* Neu (Drittanbieter) */
      'used': 0,            /* Gebraucht */
      'salesrank': 0,       /* Verkaufsrang */
      'bb': 0,              /* Buy Box */
      'fba': 0,             /* Neu, Versand durch Amazon */
      'fbm': 0,             /* Neu, Versand durch Verkaeufer */
      'ld': 1,              /* Blitzangebote */
      'wd': 0               /* Amazon Warehouse / Resale */
    },
    ranges: [
      { label: '1 M', days: 31 },
      { label: '3 M', days: 90 },
      { label: '1 J', days: 365 },
      { label: 'Alle', days: 9999 }
    ],
    defaultRange: 90,
    zoomWidth: 1000,        /* Bildbreite der Grossansicht (Keepa erlaubt max. 1000) */
    checkIntervalMs: 1200,  /* Prueft auf Variantenwechsel / neu gezeichnete Seite */
    loadTimeoutMs: 15000
  };
  /* ========================================================= */

  var P = 'slexkp';
  var STORE_KEY = 'slexkp.v1';
  var ASIN_RE = /^[A-Z0-9]{10}$/;
  /* /dp/X, /gp/product/X, /dp/product/X, /gp/aw/d/X, /o/ASIN/X, /exec/obidos/ASIN/X */
  var URL_ASIN_RE = /\/(?:dp|product|d|ASIN)\/([A-Za-z0-9]{10})(?:[\/?\x23&;]|$)/;

  /* Nur im Hauptfenster und nur einmal pro Seite laufen */
  try { if (window.top !== window.self) { return; } } catch (e0) { return; }
  if (!/(^|\.)amazon\.de$/i.test(location.hostname)) { return; }
  if (/^\/(ap|gp\/buy|checkout|gp\/cart|cart|gp\/css|your-account|cpe)(\/|$)/.test(location.pathname)) { return; }
  if (window.__slexKeepaLoaded) { return; }
  window.__slexKeepaLoaded = true;

  var T = {
    title: 'Keepa-Preisverlauf',
    loading: 'Lade Preisverlauf \u2026',
    noData: 'Keine Keepa-Daten f\xfcr dieses Produkt.',
    timeout: 'Keepa antwortet gerade nicht.',
    hintZoom: 'Tippen f\xfcr Gro\xdfansicht',
    hintUnzoom: 'Wischen \u2194 \xb7 Tippen verkleinert',
    open: 'Auf Keepa \xf6ffnen \u203a',
    rangeLabel: 'Zeitraum'
  };

  /* ---------- Diagnose-Leiste ---------- */
  var diag = { asin: 'wird gesucht \u2026', where: '-', img: '-', err: '' };
  var badge = null;
  function browserInfo() {
    var ua = navigator.userAgent || '';
    var s = ua.match(/Sleipnir[^ ;)]*/i);
    var c = ua.match(/Chrome\/\d+/);
    var a = ua.match(/Android [\d.]+/);
    return [(s && s[0]) || '', (a && a[0]) || '', (c && c[0]) || ''].join(' ').replace(/^\s+|\s+$/g, '') || ua.slice(0, 80);
  }
  function report(key, value) {
    diag[key] = value;
    if (!CONFIG.debug || !document.body) { return; }
    try {
      if (!badge) {
        badge = document.createElement('div');
        badge.id = P + '-debug';
        badge.setAttribute('style', 'position:fixed;left:8px;right:8px;bottom:8px;z-index:2147483647;' +
          'background:rgba(35,47,62,.96);color:\x23fff;font:13px/1.4 sans-serif;padding:10px 12px;' +
          'border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.35);text-align:left;' +
          'white-space:pre-line;word-wrap:break-word;-webkit-tap-highlight-color:rgba(0,0,0,0)');
        badge.addEventListener('click', function () { badge.style.display = 'none'; }, false);
        document.body.appendChild(badge);
      }
      var lines = [
        'Keepa-SLEX ' + VERSION + ' l\xe4uft \u2714',
        'Browser: ' + browserInfo(),
        'Seite: ' + location.pathname.slice(0, 70),
        'ASIN: ' + diag.asin,
        'Position: ' + diag.where,
        'Bild: ' + diag.img
      ];
      if (diag.err) { lines.push('FEHLER: ' + diag.err); }
      lines.push('(Tippen blendet aus \xb7 abschalten: CONFIG.debug = false)');
      badge.textContent = lines.join('\n');
    } catch (e) { /* Diagnose darf nie stoeren */ }
  }
  function safe(fn) {
    return function () {
      try { return fn.apply(this, arguments); }
      catch (e) { report('err', (e && (e.message || e.name)) || String(e)); }
    };
  }

  /* ---------- Hilfsfunktionen ---------- */
  function $(sel) { try { return document.querySelector(sel); } catch (e) { return null; } }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function isVisible(el) {
    return !!(el && (el.offsetWidth || el.offsetHeight ||
      (el.getClientRects && el.getClientRects().length)));
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) { n.className = cls; }
    if (text) { n.appendChild(document.createTextNode(text)); }
    return n;
  }
  function hasClass(n, c) { return (' ' + n.className + ' ').indexOf(' ' + c + ' ') > -1; }
  function setClass(n, c, on) {
    var has = hasClass(n, c);
    if (on && !has) { n.className = (n.className ? n.className + ' ' : '') + c; }
    if (!on && has) { n.className = (' ' + n.className + ' ').replace(' ' + c + ' ', ' ').replace(/^\s+|\s+$/g, ''); }
  }

  /* ---------- Einstellungen merken ---------- */
  function validRange(d) {
    for (var i = 0; i < CONFIG.ranges.length; i++) { if (CONFIG.ranges[i].days === d) { return true; } }
    return false;
  }
  var prefs = { range: CONFIG.defaultRange };
  try {
    var raw = window.localStorage ? window.localStorage.getItem(STORE_KEY) : null;
    if (raw) {
      var saved = JSON.parse(raw);
      if (saved && validRange(saved.range)) { prefs.range = saved.range; }
    }
  } catch (e1) { /* Speicher nicht verfuegbar: Standardwerte nutzen */ }
  function savePrefs() {
    try { window.localStorage.setItem(STORE_KEY, JSON.stringify(prefs)); } catch (e) { /* egal */ }
  }

  /* ---------- Produktseite und ASIN erkennen ---------- */
  function canonicalHref() {
    var c = $('link[rel="canonical"]');
    return c ? (c.getAttribute('href') || '') : '';
  }
  function isProductPage() {
    if (URL_ASIN_RE.test(location.pathname)) { return true; }
    if (URL_ASIN_RE.test(canonicalHref())) { return true; }
    return !!($('\x23dp') || $('\x23dp-container') || $('\x23ppd'));
  }
  /* Formularfelder zuerst: Sie folgen dem gewaehlten Artikel (Farbe/Groesse), */
  /* die URL zeigt manchmal nur den Elternartikel. */
  var ASIN_SELECTORS = [
    '\x23addToCart input[name="ASIN"]',
    'input\x23ASIN',
    'input\x23a',
    'input\x23twister-plus-asin',
    'input[name="ASIN"]',
    'input[name="items[0.base][asin]"]'
  ];
  function findAsin() {
    if (!isProductPage()) { return null; }
    for (var i = 0; i < ASIN_SELECTORS.length; i++) {
      var n = $(ASIN_SELECTORS[i]);
      if (n) {
        var v = String(n.value || n.getAttribute('value') || '').toUpperCase();
        if (ASIN_RE.test(v)) { return v; }
      }
    }
    var m = URL_ASIN_RE.exec(location.pathname) || URL_ASIN_RE.exec(canonicalHref());
    return m ? m[1].toUpperCase() : null;
  }

  /* ---------- Einfuegeposition ---------- */
  /* Rang 0 ist die beste Position (unter Preis/Angeboten), hoehere Raenge sind Notloesungen. */
  var TARGETS = [
    { sel: '\x23olpLinkWidget_feature_div', mode: 'after' },
    { sel: '\x23corePrice_mobile_feature_div', mode: 'after' },
    { sel: '\x23corePriceDisplay_mobile_feature_div', mode: 'after' },
    { sel: '\x23apex_mobile_feature_div', mode: 'after' },
    { sel: '\x23corePriceDisplay_desktop_feature_div', mode: 'after' },
    { sel: '\x23corePrice_feature_div', mode: 'after' },
    { sel: '\x23apex_desktop', mode: 'after' },
    { sel: '\x23buybox', mode: 'before' },
    { sel: '\x23mobile_buybox_feature_div', mode: 'before' },
    { sel: '\x23addToCart', mode: 'before' },
    { sel: '\x23title_feature_div', mode: 'after' },
    { sel: '\x23title', mode: 'after' }
  ];
  function findTarget() {
    for (var i = 0; i < TARGETS.length; i++) {
      var n = $(TARGETS[i].sel);
      if (n && n.parentNode && isVisible(n)) { return { node: n, mode: TARGETS[i].mode, rank: i, label: TARGETS[i].sel }; }
    }
    var host = document.getElementById('dp') || document.getElementById('dp-container') || document.body;
    return host ? { node: host, mode: 'prepend', rank: TARGETS.length, label: 'Seitenanfang (Notl\xf6sung)' } : null;
  }
  function mount(card) {
    var t = findTarget();
    if (!t) { report('where', 'kein Einf\xfcgeort gefunden'); return -1; }
    if (t.mode === 'after') { t.node.parentNode.insertBefore(card, t.node.nextSibling); }
    else if (t.mode === 'before') { t.node.parentNode.insertBefore(card, t.node); }
    else { t.node.insertBefore(card, t.node.firstChild); }
    report('where', (t.mode === 'before' ? 'vor ' : (t.mode === 'after' ? 'nach ' : '')) + t.label);
    return t.rank;
  }

  /* ---------- Hell/Dunkel der Seite erkennen ---------- */
  function pageIsDark() {
    var nodes = [document.body, document.documentElement];
    for (var i = 0; i < nodes.length; i++) {
      if (!nodes[i] || !window.getComputedStyle) { continue; }
      var c = window.getComputedStyle(nodes[i], null).backgroundColor || '';
      var m = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?/.exec(c);
      if (!m) { continue; }
      if (m[4] !== undefined && parseFloat(m[4]) < 0.5) { continue; } /* transparent */
      var lum = (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255;
      return lum < 0.35;
    }
    return false;
  }

  /* ---------- Styles ---------- */
  var CSS = [
    '\x23' + P + '-card{box-sizing:border-box!important;display:block;width:auto!important;max-width:100\x25!important;margin:12px 0!important;padding:12px!important;',
    'background:\x23fff!important;border:1px solid \x23d5d9d9!important;border-radius:12px!important;',
    'box-shadow:0 1px 3px rgba(15,17,17,.08)!important;font-family:inherit!important;color:\x230f1111!important;',
    'text-align:left!important;line-height:1.3!important;-webkit-text-size-adjust:100\x25!important;clear:both}',
    '\x23' + P + '-card *{box-sizing:border-box!important}',
    '.' + P + '-head{display:-webkit-box;display:-webkit-flex;display:flex;-webkit-flex-wrap:wrap;flex-wrap:wrap;',
    '-webkit-box-align:center;-webkit-align-items:center;align-items:center;-webkit-box-pack:justify;',
    '-webkit-justify-content:space-between;justify-content:space-between;margin:0 0 10px!important}',
    '.' + P + '-title{font-size:16px!important;font-weight:700!important;margin:0 12px 0 0!important;padding:4px 0!important}',
    '.' + P + '-chips{display:-webkit-box;display:-webkit-flex;display:flex;width:100\x25;margin:8px 0 0!important;',
    'border:1px solid \x23d5d9d9;border-radius:10px;overflow:hidden}',
    '.' + P + '-chip{-webkit-box-flex:1;-webkit-flex:1 1 0;flex:1 1 0;display:block;min-width:52px;height:40px!important;',
    'line-height:40px!important;padding:0 10px!important;margin:0!important;text-align:center!important;font-size:15px!important;',
    'font-weight:600!important;color:\x230f1111!important;background:\x23f0f2f2!important;border-left:1px solid \x23d5d9d9;',
    'cursor:pointer;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:rgba(0,0,0,0);white-space:nowrap}',
    '.' + P + '-chip:first-child{border-left:0}',
    '.' + P + '-chip.' + P + '-on{background:\x23232f3e!important;color:\x23fff!important}',
    '.' + P + '-frame{position:relative;width:100\x25;overflow:hidden;border-radius:8px;background:\x23f7f8f8;',
    '-webkit-overflow-scrolling:touch;-webkit-tap-highlight-color:rgba(0,0,0,0)}',
    '.' + P + '-frame.' + P + '-zoom{overflow-x:auto;overflow-y:hidden}',
    '.' + P + '-img{display:block!important;max-width:none!important;max-height:none!important;margin:0!important;',
    'padding:0!important;border:0!important;cursor:zoom-in}',
    '.' + P + '-zoom .' + P + '-img{cursor:zoom-out}',
    '.' + P + '-msg{position:absolute;left:0;right:0;top:50\x25;margin-top:-10px;padding:0 12px;text-align:center;',
    'font-size:14px!important;line-height:20px!important;color:\x23565959!important}',
    '.' + P + '-foot{display:-webkit-box;display:-webkit-flex;display:flex;-webkit-box-align:center;-webkit-align-items:center;',
    'align-items:center;-webkit-box-pack:justify;-webkit-justify-content:space-between;justify-content:space-between;margin:6px 0 0!important}',
    '.' + P + '-hint{font-size:12px!important;color:\x23565959!important;padding-right:8px}',
    '.' + P + '-link{display:inline-block;font-size:15px!important;font-weight:600!important;color:\x23007185!important;',
    'text-decoration:none!important;padding:10px 0 10px 8px!important;white-space:nowrap}',
    '@media (min-width:600px){.' + P + '-chips{width:auto;min-width:300px;margin:0!important}}',
    /* dunkle Seite */
    '\x23' + P + '-card.' + P + '-dark{background:\x231f1f1f!important;border-color:\x233a3a3a!important;color:\x23e6e6e6!important}',
    '.' + P + '-dark .' + P + '-chips{border-color:\x23444}',
    '.' + P + '-dark .' + P + '-chip{background:\x232b2b2b!important;color:\x23e6e6e6!important;border-left-color:\x23444}',
    '.' + P + '-dark .' + P + '-chip.' + P + '-on{background:\x23ffd814!important;color:\x230f1111!important}',
    '.' + P + '-dark .' + P + '-frame{background:\x231f1f1f}',
    '.' + P + '-dark .' + P + '-msg,.' + P + '-dark .' + P + '-hint{color:\x23b0b0b0!important}',
    '.' + P + '-dark .' + P + '-link{color:\x236fc8d8!important}'
  ].join('');

  function injectStyle() {
    if (document.getElementById(P + '-style')) { return; }
    var s = document.createElement('style');
    s.id = P + '-style';
    s.type = 'text/css';
    s.appendChild(document.createTextNode(CSS));
    (document.head || document.documentElement).appendChild(s);
  }

  /* ---------- Karte bauen ---------- */
  var card, frame, img, msg, hint, link, chips = [];
  var state = { asin: null, src: '', timer: null, rank: -1, ticks: 0, zoom: false, dark: false };

  function buildCard() {
    card = el('div', P + '-card');
    card.id = P + '-card';
    if (state.dark) { setClass(card, P + '-dark', true); }

    var head = el('div', P + '-head');
    head.appendChild(el('span', P + '-title', T.title));
    var bar = el('div', P + '-chips');
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', T.rangeLabel);
    for (var i = 0; i < CONFIG.ranges.length; i++) {
      var c = el('span', P + '-chip', CONFIG.ranges[i].label);
      c.setAttribute('role', 'button');
      c.setAttribute('tabindex', '0');
      c.setAttribute('data-days', String(CONFIG.ranges[i].days));
      c.addEventListener('click', safe(onChip), false);
      c.addEventListener('keydown', safe(onChipKey), false);
      chips.push(c);
      bar.appendChild(c);
    }
    head.appendChild(bar);
    card.appendChild(head);

    frame = el('div', P + '-frame');
    img = el('img', P + '-img');
    img.alt = T.title;
    img.style.visibility = 'hidden';
    img.addEventListener('load', safe(onImgLoad), false);
    img.addEventListener('error', safe(onImgError), false);
    img.addEventListener('click', safe(toggleZoom), false);
    msg = el('div', P + '-msg', T.loading);
    frame.appendChild(img);
    frame.appendChild(msg);
    card.appendChild(frame);

    var foot = el('div', P + '-foot');
    hint = el('span', P + '-hint', T.hintZoom);
    link = el('a', P + '-link', T.open);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    foot.appendChild(hint);
    foot.appendChild(link);
    card.appendChild(foot);

    /* Klicks nicht an Amazons eigene Handler weiterreichen */
    card.addEventListener('click', function (e) { e.stopPropagation(); }, false);
    updateChips();
  }

  function updateChips() {
    for (var i = 0; i < chips.length; i++) {
      var on = parseInt(chips[i].getAttribute('data-days'), 10) === prefs.range;
      setClass(chips[i], P + '-on', on);
      chips[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }
  function onChip(e) {
    var d = parseInt(this.getAttribute('data-days'), 10);
    if (e && e.preventDefault) { e.preventDefault(); }
    if (!validRange(d) || d === prefs.range) { return; }
    prefs.range = d;
    savePrefs();
    updateChips();
    render();
  }
  function onChipKey(e) {
    var k = e.keyCode || e.which;
    if (k === 13 || k === 32) { onChip.call(this, e); }
  }
  function toggleZoom() {
    state.zoom = !state.zoom;
    setClass(frame, P + '-zoom', state.zoom);
    hint.firstChild.nodeValue = state.zoom ? T.hintUnzoom : T.hintZoom;
    if (!state.zoom) { frame.scrollLeft = 0; }
    render();
    if (state.zoom && img.complete && img.naturalWidth > 0) { scrollToLatest(); }
  }
  function scrollToLatest() {
    /* Die neuesten Daten stehen rechts */
    frame.scrollLeft = frame.scrollWidth;
  }

  /* ---------- Bild laden ---------- */
  function showMsg(text) {
    msg.firstChild.nodeValue = text;
    msg.style.display = 'block';
  }
  function hideMsg() { msg.style.display = 'none'; }

  function sizes() {
    var fw = Math.floor(frame.clientWidth || card.clientWidth || ((window.innerWidth || 360) - 24));
    if (fw < 200) { fw = 200; }
    /* Bild 1:1 in CSS-Pixeln anfordern: Keepa zeichnet Schrift in fester Pixelgroesse, */
    /* so bleibt die Beschriftung auf dem Handy gut lesbar. */
    var w = clamp(fw, 300, 1000);
    var h = clamp(Math.round(w * 0.62), 200, 360);
    if (state.zoom) {
      w = Math.max(CONFIG.zoomWidth, w);
      w = clamp(w, 300, 1000);
      h = Math.max(h, 320);
      return { w: w, h: h, dw: w, dh: h };
    }
    return { w: w, h: h, dw: fw, dh: Math.round(h * fw / w) };
  }

  function buildSrc(asin, s) {
    var q = [
      'asin=' + asin,
      'domain=' + CONFIG.domainId,
      'range=' + prefs.range,
      'width=' + s.w,
      'height=' + s.h
    ];
    for (var k in CONFIG.series) {
      if (Object.prototype.hasOwnProperty.call(CONFIG.series, k)) { q.push(k + '=' + (CONFIG.series[k] ? 1 : 0)); }
    }
    if (state.dark) { q.push('cBackground=1f1f1f', 'cFont=e6e6e6'); }
    return 'https://graph.keepa.com/pricehistory.png?' + q.join('&');
  }

  function render() {
    var asin = findAsin();
    if (!asin) { card.style.display = 'none'; state.asin = null; report('asin', 'nicht gefunden'); return; }
    card.style.display = '';
    report('asin', asin);

    var s = sizes();
    img.style.width = s.dw + 'px';
    img.style.height = s.dh + 'px';
    frame.style.height = s.dh + 'px';
    link.href = 'https://keepa.com/\x23!product/' + CONFIG.domainId + '-' + asin;

    var src = buildSrc(asin, s);
    state.asin = asin;
    if (src === state.src) { return; }
    state.src = src;
    img.style.visibility = 'hidden';
    showMsg(T.loading);
    report('img', 'l\xe4dt (' + s.w + '\xd7' + s.h + ') \u2026');
    clearTimeout(state.timer);
    state.timer = setTimeout(function () {
      if (state.src === src && img.style.visibility === 'hidden') {
        hint.style.visibility = 'hidden';
        showMsg(T.timeout);
        report('img', 'keine Antwort nach ' + (CONFIG.loadTimeoutMs / 1000) + ' s');
      }
    }, CONFIG.loadTimeoutMs);
    img.src = src;
  }

  function onImgLoad() {
    if (img.src !== state.src) { return; }
    clearTimeout(state.timer);
    if (img.naturalWidth < 50 || img.naturalHeight < 30) { onImgError(); return; }
    hideMsg();
    img.style.visibility = 'visible';
    hint.style.visibility = 'visible';
    report('img', 'OK (' + img.naturalWidth + '\xd7' + img.naturalHeight + ')');
    if (state.zoom) { scrollToLatest(); }
  }
  function onImgError() {
    if (img.src !== state.src) { return; }
    clearTimeout(state.timer);
    img.style.visibility = 'hidden';
    hint.style.visibility = 'hidden';
    frame.style.height = '64px';   /* kein leerer Riesenkasten ohne Daten */
    showMsg(T.noData);
    report('img', 'Fehler/keine Daten (Keepa nicht erreichbar oder blockiert?)');
  }

  /* ---------- Ueberwachung: Variantenwechsel, neu gezeichnete Seite, Drehung ---------- */
  function tick() {
    if (document.hidden) { return; }
    state.ticks++;
    var attached = card.parentNode && document.documentElement.contains(card);
    if (!attached) {
      state.rank = mount(card);
      if (state.rank < 0) { return; }
      render();
      return;
    }
    /* In den ersten Sekunden: auf bessere Position umziehen, falls sie erst spaeter erscheint */
    if (state.rank > 0 && state.ticks <= 10) {
      var t = findTarget();
      if (t && t.rank < state.rank) {
        card.parentNode.removeChild(card);
        state.rank = mount(card);
        render();
        return;
      }
    }
    if (findAsin() !== state.asin) { render(); }
  }

  var resizeTimer = null;
  var safeRender = safe(render);
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(safeRender, 250);
  }

  function start() {
    if (!findAsin()) {
      report('asin', isProductPage() ? 'wird gesucht \u2026' : 'keine Produktseite');
      /* Inhalte koennen nachladen: noch ein paar Sekunden weiter suchen */
      var tries = 0;
      var wait = setInterval(safe(function () {
        tries++;
        if (findAsin()) { clearInterval(wait); init(); }
        else if (tries > 10) {
          clearInterval(wait);
          report('asin', isProductPage() ? 'nicht gefunden (Produktseite erkannt)' : 'keine Produktseite');
        }
      }), CONFIG.checkIntervalMs);
      return;
    }
    init();
  }

  function init() {
    state.dark = pageIsDark();
    injectStyle();
    buildCard();
    state.rank = mount(card);
    if (state.rank < 0) { return; }
    render();
    setInterval(safe(tick), CONFIG.checkIntervalMs);
    window.addEventListener('resize', onResize, false);
    window.addEventListener('orientationchange', onResize, false);
    window.addEventListener('pageshow', safeRender, false);
  }

  var safeStart = safe(start);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', safeStart, false);
  } else {
    safeStart();
  }
})();
