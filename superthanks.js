#!/usr/bin/env node
/**
 * ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
 * ┃  YouTube Super Thanks Scraper (Puppeteer)                           ┃
 * ┃  Live console reporting · Decimal/“bin” parsing · JSON only         ┃
 * ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
 *
 * Project Summary
 *  - Headless/Headful Puppeteer crawler for public YouTube video pages
 *  - Scrolls comments reliably (mouse wheel + container + window scroll)
 *  - Detects comment blocks that likely contain “Super Thanks” donations
 *    via keywords + UI badges/aria/title heuristics
 *  - Extracts amounts in multiple formats:
 *      • “2 bin”, “3bin”, “10 bin”
 *      • 2000, 3.000, 10,000, 10 000 (handles NBSP and narrow NBSP)
 *      • Decimals: ₺2.199,99 / €1,234.56 / $5.99
 *  - Streams results to console in real time and maintains per-currency totals
 *  - Writes a single JSON file (no CSV) with a timestamped filename
 *  - Hardens against common pitfalls: cookie/consent overlays, stalled
 *    infinite scroll, container vs window scrolling, duplicate findings,
 *    malformed URLs (e.g., extra params like '&ab_channel=...').
 *
 * IMPORTANT
 *  - This tool parses *public* page content; it is not an official metric.
 *  - Respect YouTube’s Terms of Service. Use responsibly.
 *
 * Usage
 *  npm init -y
 *  npm i puppeteer
 *  node superthanks.js "https://www.youtube.com/watch?v=VIDEO_ID" --seconds 25 --min 0 --out out/super-thanks --headful
 */

/* ──────────────────────────────────────────────────────────────────── */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

/**
 * @typedef {Object} Finding
 * @property {string} currency - ISO-like currency code (TRY, USD, EUR, ...)
 * @property {number} amount  - Numeric amount parsed from the comment
 * @property {string} author  - Comment author (best effort)
 * @property {string} snippet - Comment text snippet (first ~200 chars)
 */

/**
 * @typedef {Map<string, number>} TotalsMap
 */

/* ───────────────────────── CLI & Globals ──────────────────────────── */

/**
 * Parse CLI args with safe defaults. Only uses core Node (no external libs).
 * Recognized flags: --seconds, --min, --out, --headful
 * First non-flag is the URL.
 * @param {string[]} argv
 */
function parseArgs(argv) {
  const out = { url: null, seconds: 25, min: 0, out: 'super-thanks', headful: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--') && out.url === null) { out.url = a; continue; }
    if (a === '--seconds') out.seconds = Number(argv[++i] ?? out.seconds);
    else if (a === '--min') out.min = Number(argv[++i] ?? out.min);
    else if (a === '--out') out.out = String(argv[++i] ?? out.out);
    else if (a === '--headful') out.headful = true;
  }
  return out;
}

const ARGS = parseArgs(process.argv.slice(2));

if (!ARGS.url) {
  console.error('Usage: node superthanks.js "<youtube video url>" [--seconds 25] [--min 0] [--out out/super-thanks] [--headful]');
  process.exit(1);
}

/* ─────────────────────── URL Canonicalization ─────────────────────── */

/**
 * Extract a videoId from a YouTube URL (supports: watch?v=..., youtu.be/..., share links).
 * @param {string} raw
 * @returns {string|null}
 */
function extractVideoId(raw) {
  try {
    const u = new URL(raw);
    if (/youtu\.be$/i.test(u.hostname)) {
      // https://youtu.be/VIDEOID?t=30
      const id = u.pathname.split('/').filter(Boolean)[0];
      return id || null;
    }
    // https://www.youtube.com/watch?v=VIDEOID&...
    // Also handle /live/VIDEOID and /shorts/VIDEOID (canonicalize to watch?v=)
    if (/youtube\.com$/i.test(u.hostname)) {
      if (u.pathname === '/watch') return u.searchParams.get('v');
      const mLive  = u.pathname.match(/^\/live\/([^/?#]+)/);
      const mShort = u.pathname.match(/^\/shorts\/([^/?#]+)/);
      if (mLive)  return mLive[1];
      if (mShort) return mShort[1];
    }
  } catch {} // fallthrough
  return null;
}

/**
 * Build a canonical watch URL with only the “v” parameter, dropping extra params like &ab_channel.
 * This avoids Windows CMD interpreting &param as a new command when not properly quoted.
 * @param {string} raw
 * @returns {{videoId: string, url: string}}
 */
function canonicalWatchUrl(raw) {
  const id = extractVideoId(raw);
  if (!id) {
    throw new Error('Could not extract a valid YouTube video ID from the provided URL.');
  }
  return {
    videoId: id,
    url: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`
  };
}

/* ────────────────────────── Utilities ─────────────────────────────── */

/**
 * @param {string} p
 * @param {string} ext
 * @returns {string}
 */
function ensureExt(p, ext) { return p.toLowerCase().endsWith(ext) ? p : p + ext; }

/**
 * @param {string} dir
 */
function ensureDir(dir) { if (dir && dir !== '.' && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }

/**
 * @param {number} n
 * @returns {number}
 */
function round2(n) { return Math.round(n * 100) / 100; }

/**
 * @param {Date} [d]
 * @returns {string} YYYYMMDD-HHMMSS
 */
function timeStamp(d = new Date()) {
  const z = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}${z(d.getMonth()+1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
}

/**
 * @param {Finding} f
 * @returns {string}
 */
function hashFinding(f) { return `${f.currency}|${f.amount}|${(f.author||'').trim()}|${(f.snippet||'').trim()}`; }

/**
 * Map -> sorted plain object (alphabetical by currency).
 * @param {TotalsMap} map
 */
function mapToSortedObject(map) {
  const obj = {};
  for (const [cur, amt] of [...map.entries()].sort((a,b) => a[0].localeCompare(b[0]))) {
    obj[cur] = round2(amt);
  }
  return obj;
}

/* ────────────────────── Puppeteer Actions ─────────────────────────── */

/**
 * Attempt to accept consent overlays (region/language dependent).
 * @param {import('puppeteer').Page} page
 */
async function acceptConsentIfAny(page) {
  try {
    const selectors = [
      'button[aria-label*="Kabul"]',
      'button:has-text("Kabul ediyorum")',
      'button:has-text("I agree")',
      '#introAgreeButton',
      'button[aria-label*="Accept"]',
      'button:has-text("Tümünü kabul et")',
      'button:has-text("Accept all")'
    ];
    for (const sel of selectors) {
      const btn = await page.$(sel);
      if (btn) { await btn.click().catch(()=>{}); await page.waitForTimeout(600); }
    }
  } catch {}
}

/**
 * Ensure the comments component is mounted and visible.
 * @param {import('puppeteer').Page} page
 */
async function ensureCommentsMounted(page) {
  await page.evaluate(() => {
    const el = document.querySelector('ytd-comments,#comments');
    if (el) el.scrollIntoView({ behavior: 'instant', block: 'center' });
  });
  await page.waitForTimeout(600);

  await page.waitForFunction(() => {
    const c1 = document.querySelector('ytd-comment-thread-renderer,yt-comment-thread-renderer,ytd-comment-view-model');
    const ph = document.querySelector('ytd-item-section-renderer #contents');
    return !!(c1 || ph);
  }, { timeout: 30000 }).catch(() => {});
}

/**
 * Try to switch comment sort to "Newest first" (optional).
 * @param {import('puppeteer').Page} page
 */
async function setSortByNewestIfPossible(page) {
  try {
    const openSort = await page.$('yt-sort-filter-sub-menu-renderer tp-yt-paper-button, #sort-menu');
    if (openSort) { await openSort.click().catch(()=>{}); await page.waitForTimeout(300); }
    await page.evaluate(() => {
      const items = [...document.querySelectorAll('tp-yt-paper-listbox tp-yt-paper-item, #menu #items ytd-menu-service-item-renderer')];
      const target = items.find(i => /en yeni|newest/i.test(i.textContent || ''));
      if (target) (target.querySelector('yt-formatted-string, .label') || target).click();
    });
    await page.waitForTimeout(600);
  } catch {}
}

/**
 * Scroll comments for a period or until a minimum number of blocks are loaded.
 * Uses real mouse wheel + container + window scroll. Calls onTick each loop for live collection.
 * @param {import('puppeteer').Page} page
 * @param {number} seconds
 * @param {number} minBlocks
 * @param {() => Promise<void>|void} [onTick]
 */
async function autoScrollComments(page, seconds = 25, minBlocks = 0, onTick = null) {
  const deadline = Date.now() + seconds * 1000;
  let lastCount = 0;
  let stagnantTicks = 0;

  await ensureCommentsMounted(page);

  while (Date.now() < deadline) {
    await page.mouse.wheel({ deltaY: 2200 });
    await page.waitForTimeout(200);

    await page.evaluate(() => {
      const cont = document.querySelector('ytd-comments #sections, ytd-comments #contents, #comments');
      if (cont) cont.scrollBy(0, 1600);
    });
    await page.waitForTimeout(180);

    await page.evaluate(() => window.scrollBy(0, 1400));
    await page.waitForTimeout(180);

    if (typeof onTick === 'function') {
      await onTick();
    }

    const count = await page.evaluate(() =>
      document.querySelectorAll('ytd-comment-thread-renderer,yt-comment-thread-renderer,ytd-comment-view-model').length
    );

    if (minBlocks && count >= minBlocks) break;

    if (count <= lastCount) {
      stagnantTicks++;
      if (stagnantTicks % 4 === 0) {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(250);
        await page.mouse.wheel({ deltaY: 2400 });
      }
      if (stagnantTicks > 12) {
        await ensureCommentsMounted(page);
        stagnantTicks = 0;
      }
    } else {
      stagnantTicks = 0;
    }
    lastCount = count;
  }
}

/**
 * Expand “Show more replies” buttons opportunistically.
 * @param {import('puppeteer').Page} page
 */
async function expandMoreReplies(page) {
  try {
    const maxClicks = 80;
    for (let i = 0; i < maxClicks; i++) {
      const clicked = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('yt-button-shape button,tp-yt-paper-button,button')];
        const t = btns.find(b => /daha fazla yanıt|more replies|show more replies/i.test(b.textContent || ''));
        if (t) { t.click(); return true; }
        return false;
      });
      if (!clicked) break;
      await page.waitForTimeout(220);
    }
  } catch {}
}

/* ────────────────────── Live Collection Layer ─────────────────────── */

/** @type {Finding[]} */
const findings = [];
/** @type {Set<string>} */
const seen = new Set();
/** @type {TotalsMap} */
let liveTotals = new Map();

/**
 * Print per-currency totals to console in a compact single line.
 * @param {string} [prefix]
 */
function printLiveTotals(prefix = 'Totals') {
  const parts = [];
  for (const [cur, amt] of [...liveTotals.entries()].sort((a,b) => a[0].localeCompare(b[0]))) {
    parts.push(`${cur}: ${round2(amt)}`);
  }
  console.log(`${prefix}: ${parts.join(' | ') || '—'}`);
}

/**
 * Pull findings from page context and stream new items to console.
 * Updates liveTotals incrementally and de-duplicates via a stable hash.
 * @param {import('puppeteer').Page} page
 * @param {{prefix?: string}} [opts]
 */
async function collectAndReport(page, { prefix = 'Found' } = {}) {
  const pageFindings = await page.evaluate(extractFindingsInPage);
  let newCount = 0;
  for (const f of pageFindings) {
    const h = hashFinding(f);
    if (seen.has(h)) continue;
    seen.add(h);
    findings.push(f);
    newCount++;

    // Stream each new finding
    console.log(`${prefix}: ${f.currency} ${f.amount} — ${f.author || ''} | ${f.snippet || ''}`);

    // Update totals
    const prev = liveTotals.get(f.currency) || 0;
    liveTotals.set(f.currency, prev + Number(f.amount || 0));
  }
  if (newCount > 0) {
    printLiveTotals('Live totals');
  }
}

/* ────────────────────── Page.evaluate Payload ─────────────────────── */

/**
 * Runs inside the page context. Avoid non-serializable values.
 * @returns {Finding[]}
 */
/* eslint-disable no-undef */
function extractFindingsInPage() {
  const THANKS_KEYWORDS = [
    'super thanks','super-thanks','superthanks',
    'süper teşekkür','süper teşekkürler','süper-teşekkür'
  ];
  const CURRENCY_SYMBOLS = [
    '₺','TL','TRY','\\$','USD','€','EUR','£','GBP','¥','JPY','₹','INR','₩','KRW','₫','VND','₦','NGN','₱','PHP','R\\$','BRL','A\\$','AUD','C\\$','CAD','HK\\$','NT\\$'
  ];

  // NUM_PATTERN supports:
  //  - 2000
  //  - 3.000 / 10,000 / 10 000 / NBSP (\u00A0) / narrow NBSP (\u202F)
  //  - Decimals: 2.199,99 / 1,234.56 / 5.99
  //  - Textual thousands: 2 bin / 3bin / 10 bin
  const NUM_PATTERN = '(?:\\d+(?:[.,\\u00A0\\u202F\\s]?\\d{3})*(?:[.,]\\d{1,2})?|\\d+\\s*bin)';
  const CURRENCY_RE = new RegExp(
    `(?:(${CURRENCY_SYMBOLS.join('|')}))\\s*(${NUM_PATTERN})|(${NUM_PATTERN})\\s*((${CURRENCY_SYMBOLS.join('|')}))`,
    'gi'
  );

  /** @returns {Element[]} */
  function getCommentBlocks() {
    const arr = [
      ...document.querySelectorAll('ytd-comment-thread-renderer'),
      ...document.querySelectorAll('yt-comment-thread-renderer'),
      ...document.querySelectorAll('ytd-comment-view-model'),
    ];
    return Array.from(new Set(arr));
  }

  /**
   * Heuristic: does this block likely correspond to a Super Thanks purchase?
   * @param {Element} el
   * @param {string} fullText
   */
  function isSuperThanksBlock(el, fullText) {
    const t = (fullText || '').toLowerCase();
    if (THANKS_KEYWORDS.some(k => t.includes(k))) return true;

    const badge = el.querySelector(
      '[aria-label*="Super Thanks"],[title*="Super Thanks"],' +
      '[aria-label*="Süper Teşekkür"],[title*="Süper Teşekkür"],' +
      '[aria-label*="Thanks"],[title*="Thanks"]'
    );
    if (badge) return true;

    if (/[€$£¥₺]|TL|TRY|USD|EUR|GBP|JPY/i.test(fullText) && /\bthanks|teşekkür/i.test(t)) return true;
    return false;
  }

  /** @param {Element} el */
  function getAuthorAndSnippet(el) {
    let author = '';
    let snippet = '';
    const authorEl =
      el.querySelector('#author-text, a#author-text, .ytd-comment-renderer #author-text') ||
      el.querySelector('a.yt-simple-endpoint.style-scope.yt-formatted-string') ||
      el.querySelector('yt-author-text') ||
      el.querySelector('[id*="author"]');
    if (authorEl) author = (authorEl.textContent || '').trim();

    const contentEl =
      el.querySelector('#content-text') ||
      el.querySelector('#comment-content') ||
      el.querySelector('yt-formatted-string#content-text') ||
      el;
    if (contentEl) snippet = (contentEl.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 200);
    else snippet = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 200);

    return { author, snippet };
  }

  /** @param {string} c */
  function normalizeCurrency(c) {
    if (c === '₺' || c === 'TL' || c === 'TRY') return 'TRY';
    if (c === '$'  || c === 'USD') return 'USD';
    if (c === '€'  || c === 'EUR') return 'EUR';
    if (c === '£'  || c === 'GBP') return 'GBP';
    if (c === '¥'  || c === 'JPY') return 'JPY';
    if (c === '₹'  || c === 'INR') return 'INR';
    if (c === '₩'  || c === 'KRW') return 'KRW';
    if (c === '₫'  || c === 'VND') return 'VND';
    if (c === '₦'  || c === 'NGN') return 'NGN';
    if (c === '₱'  || c === 'PHP') return 'PHP';
    if (c === 'R$' || c === 'BRL') return 'BRL';
    if (c === 'A$' || c === 'AUD') return 'AUD';
    if (c === 'C$' || c === 'CAD') return 'CAD';
    if (c === 'HK$') return 'HKD';
    if (c === 'NT$') return 'TWD';
    return c;
  }

  /**
   * Normalize human-entered numeric strings:
   *  - “2 bin”, “3bin”, “10 bin” => x1000
   *  - Thousands separators: dot/comma/space/NBSP/narrow NBSP removed
   *  - Decimal separator inference: last of ('.' or ',') becomes decimal; other separator removed
   * @param {string} str
   * @returns {number}
   */
  function normNumber(str) {
    if (!str) return NaN;
    let s = String(str).toLowerCase().trim();

    // NBSP / narrow NBSP -> normal space
    s = s.replace(/\u00A0|\u202F/g, ' ');

    // “bin” multiplier (attached or separated)
    let multiplier = 1;
    const binMatch = s.match(/^(\d+)\s*bin\b/);
    if (binMatch) {
      s = s.replace(/\s*bin\b/, '').trim();
      multiplier = 1000;
    }

    // Mixed decimal detection
    const lastDot   = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');

    let decimalSep = null;
    if (lastDot !== -1 && lastComma !== -1) {
      decimalSep = lastDot > lastComma ? '.' : ',';
    } else if (lastDot !== -1) {
      if (/\.\d{1,2}$/.test(s)) decimalSep = '.';
    } else if (lastComma !== -1) {
      if (/,\d{1,2}$/.test(s)) decimalSep = ',';
    }

    if (decimalSep) {
      const other = decimalSep === '.' ? ',' : '.';
      s = s.replace(new RegExp(`\\${other}`, 'g'), '');
      if (decimalSep === ',') s = s.replace(/,/g, '.'); // decimal to '.'
      s = s.replace(/\s/g, '');
    } else {
      // only thousands -> strip
      s = s.replace(/[.,\s]/g, '');
    }

    const val = parseFloat(s);
    return isFinite(val) ? val * multiplier : NaN;
  }

  const results = [];
  for (const el of getCommentBlocks()) {
    const text = (el.innerText || el.textContent || '').trim();
    if (!text) continue;
    if (!isSuperThanksBlock(el, text)) continue;

    let m;
    while ((m = CURRENCY_RE.exec(text)) !== null) {
      let currency = (m[1] || m[4] || '').toUpperCase().replace(/\s+/g,'');
      let numStr   = (m[2] || m[3] || '').trim();

      currency = normalizeCurrency(currency);
      const val = normNumber(numStr);
      if (currency && isFinite(val)) {
        const meta = getAuthorAndSnippet(el);
        results.push({ currency, amount: val, author: meta.author, snippet: meta.snippet });
      }
    }
  }
  return results;
}
/* eslint-enable no-undef */

/* ─────────────────────────── Main ─────────────────────────────── */

(async () => {
  // Canonicalize URL to avoid "&ab_channel=..." CLI issues and to standardize navigation.
  let canonical;
  try {
    canonical = canonicalWatchUrl(ARGS.url);
  } catch (e) {
    console.error(`Invalid YouTube URL: ${e.message || e}`);
    process.exit(1);
  }

  // Global live state (so a single run can reuse across page ticks)
  liveTotals = new Map();

  const browser = await puppeteer.launch({
    headless: !ARGS.headful,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--lang=tr-TR,tr,en-US,en',
      '--window-size=1366,900'
    ],
    defaultViewport: { width: 1366, height: 900 }
  });

  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7' });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36');

  try {
    await page.goto(canonical.url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await acceptConsentIfAny(page);
    await ensureCommentsMounted(page);
    await setSortByNewestIfPossible(page).catch(() => {});

    console.log('>>> Scan started\n');

    // First pass
    await autoScrollComments(page, ARGS.seconds, ARGS.min, async () => {
      await collectAndReport(page, { prefix: 'Found' });
    });

    // Expand replies and do a short second pass
    await expandMoreReplies(page);
    await autoScrollComments(page, Math.max(ARGS.seconds * 0.4, 6), 0, async () => {
      await collectAndReport(page, { prefix: 'Found' });
    });

    // Final collection
    await collectAndReport(page, { prefix: 'Final' });

    // Prepare output
    const totalsObj = mapToSortedObject(liveTotals);
    const stamp = timeStamp(); // YYYYMMDD-HHMMSS
    const outPrefix = ARGS.out || 'super-thanks';
    const jsonPath  = ensureExt(`${outPrefix}-${canonical.videoId}-${stamp}.json`, '.json');

    ensureDir(path.dirname(jsonPath));
    fs.writeFileSync(jsonPath, JSON.stringify({
      url: canonical.url,
      videoId: canonical.videoId,
      generatedAt: new Date().toISOString(),
      totals: totalsObj,
      count: findings.length,
      findings
    }, null, 2), 'utf-8');

    // Final summary (visible analysis without opening files)
    console.log('\n=== Summary / Analysis ===');
    if (!Object.keys(totalsObj).length) {
      console.log('Totals: none found.');
    } else {
      for (const [cur, amt] of Object.entries(totalsObj)) {
        console.log(`${cur}: ${Number(amt).toLocaleString('tr-TR', { maximumFractionDigits: 2 })}`);
      }
    }
    console.log(`Matched comments: ${findings.length}`);
    console.log(`JSON saved: ${jsonPath}`);

  } catch (err) {
    console.error('Fatal error:', err?.message || err);
    process.exitCode = 1;
  } finally {
    await browser.close().catch(()=>{});
  }
})();

/* ─────────────────────── Global Safety Nets ─────────────────────── */
process.on('unhandledRejection', err => {
  console.error('Unhandled rejection:', err?.message || err);
  process.exit(1);
});
process.on('uncaughtException', err => {
  console.error('Uncaught exception:', err?.message || err);
  process.exit(1);
});
