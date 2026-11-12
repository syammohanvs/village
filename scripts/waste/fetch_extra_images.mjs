#!/usr/bin/env node
/**
 * Download extra public-domain / free-licence photos for the waste classes that
 * the bootstrap datasets do not cover well.
 *
 * The problem this fixes is specific.  TrashNet contains studio photos of
 * paper, plastic, glass and metal, but it has no cardboard, no bottle caps and
 * no pens.  A brown cardboard cover therefore looked like a circuit board, a
 * bottle cap looked like e-waste and a plastic pen looked like glass.  A few
 * dozen real photos of those objects in ordinary settings move the decision
 * boundary where it belongs.
 *
 * Images come from Wikimedia Commons through its public API.  Every file is
 * stored with its Commons title, page URL and licence in `sources.json`, and
 * `--probe` keeps a slice out of training so the trainer can measure the
 * change on photos it has never seen.
 *
 * Nothing downloaded here is committed; it lives in the cache beside the rest
 * of the dataset.
 *
 * Usage:
 *
 *   node scripts/waste/fetch_extra_images.mjs \
 *     --out ~/.cache/village-waste/extra \
 *     --per-source 70 --probe 0.2
 *
 * Then assemble a training tree with build_waste_dataset.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const API = 'https://commons.wikimedia.org/w/api.php';
const USER_AGENT = 'VillageWasteTrainer/1.0 (local educational exhibit; non-commercial training data)';
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const SKIP_NAME = /(logo|icon|diagram|drawing|sketch|\bmap\b|chart|graph|poster|stamp|coin|banknote|painting|illustration|cartoon|comic|screenshot|\bsign\b|symbol|silhouette|clipart|\.svg|\.pdf|\bscan\b|engraving|lithograph|advertisement|book cover|label|seal|ticket|receipt|blueprint)/i;

// One entry per Commons category.  `label` is the model class, `slug` names the
// downloaded folder and is written into the filename so a held-out photo can be
// reported by the object it shows.
const SOURCES = [
  // Paper: brown cardboard and paper bags are the item that was read as e-waste.
  { label: 'Paper', slug: 'paper-bags', category: 'Paper bags' },
  { label: 'Paper', slug: 'cardboard-boxes', category: 'Cardboard boxes' },
  { label: 'Paper', slug: 'corrugated-board', category: 'Corrugated fiberboard' },
  { label: 'Paper', slug: 'kraft-paper', category: 'Kraft paper' },
  { label: 'Paper', slug: 'brown-paper', category: 'Brown paper' },
  { label: 'Paper', slug: 'paperboard', category: 'Paperboard' },

  // Plastic: caps and pens were read as e-waste and glass.
  { label: 'Plastic', slug: 'bottle-caps', category: 'Bottle caps' },
  { label: 'Plastic', slug: 'ballpens', category: 'Ballpens' },
  { label: 'Plastic', slug: 'ball-pointed-pens', category: 'Ball-pointed pens' },
  { label: 'Plastic', slug: 'plastic-bottles', category: 'Plastic bottles' },
  { label: 'Plastic', slug: 'plastic-cups', category: 'Plastic cups' },
  { label: 'Plastic', slug: 'plastic-containers', category: 'Plastic containers' },

  // Glass: the held-out confusion was glass read as metal.
  { label: 'Glass', slug: 'glass-jars', category: 'Glass jars' },
  { label: 'Glass', slug: 'drinking-glasses', category: 'Drinking glasses' },
  { label: 'Glass', slug: 'glass-bottles', category: 'Glass bottles' },

  // Metal: same confusion, from the other side.
  { label: 'Metal', slug: 'beverage-cans', category: 'Beverage cans' },
  { label: 'Metal', slug: 'aluminium-cans', category: 'Aluminium cans' },

  // Ewaste: more real boards and devices, so brown cardboard is less like it.
  { label: 'Ewaste', slug: 'electronic-waste', category: 'Electronic waste' },
  { label: 'Ewaste', slug: 'circuit-boards', category: 'Printed circuit boards' },

  // Thermocol was the weakest class (42 photos, 66.7% held out).
  { label: 'Thermocol', slug: 'expanded-polystyrene', category: 'Expanded polystyrene' },
  { label: 'Thermocol', slug: 'foam-cups', category: 'Expanded polystyrene cups' },
  { label: 'Thermocol', slug: 'foam-food-containers', category: 'Expanded polystyrene food containers' },
  { label: 'Thermocol', slug: 'foam-packaging', category: 'Expanded polystyrene packaging' },

  // Ordinary objects a visitor may show are still a *material*, not "nothing".
  // A key fob, phone or watch is electronic waste; a mechanical key or key ring
  // is metal; sunglasses are glass; a wallet is leather (natural or synthetic).
  // The app sends every one of these to the recycling agent, which is why the
  // right material matters for the label but not for the bin action.
  { label: 'Metal', slug: 'automobile-keys', category: 'Automobile keys' },
  { label: 'Ewaste', slug: 'electronic-key-fobs', category: 'Electronic key fobs' },
  { label: 'Ewaste', slug: 'key-fobs-electronic', category: 'Key fobs' },
  { label: 'Ewaste', slug: 'advertising-fobs', category: 'Advertising key fobs' },
  { label: 'Metal', slug: 'key-rings', category: 'Key rings' },
  { label: 'Metal', slug: 'keys', category: 'Keys' },
  { label: 'Ewaste', slug: 'mobile-phones', category: 'Mobile phones' },
  { label: 'Ewaste', slug: 'wristwatches', category: 'Wristwatches' },
  { label: 'Ewaste', slug: 'smartwatches', category: 'Smartwatches' },
  { label: 'Leather', slug: 'wallets', category: 'Wallets' },
  { label: 'Glass', slug: 'sunglasses', category: 'Sunglasses' },
];

const TITLE_FILTERS = {
  'automobile-keys': { match: '(key|cl[ée]|schl[üu]ssel|chiave|llave|chave|nyckel|kl[ií][cč]|fob|remote|keyless|ignition|renault|ford|volvo|seat|fiat|dodge|opel|mercedes|toyota|honda|bmw|audi|truck)' },
  'key-rings': { match: '(key|ring|porte.?cl|schl[üu]sselanh|llavero|llavin|chaveiro)', exclude: '(yubikey|usb|flash|pendrive)' },
  keys: { match: '(key|cl[ée]|schl[üu]ssel|chiave|llave|chave|nyckel|kl[ií][cč])', exclude: '(yubikey|usb|flash|pendrive)' },
  'key-fobs-electronic': { match: '.*' },
  'advertising-fobs': { match: '.*' },
  'mobile-phones': { match: '(phone|mobile|smartphone|iphone|android|cell|telefon|handy|t[ée]l[ée]phone|tel[ée]fono|3g|4g|5g)' },
  smartwatches: { match: '(watch|uhr|montre|reloj|orologio)' },
  wristwatches: { match: '(watch|uhr|montre|reloj|orologio|wrist)' },
  wallets: { match: '(wallet|purse|billfold|porte.?monnaie|geldb[öo]rse|portafoglio|cartera|brieftasche|brustbeutel)' },
  sunglasses: { match: '(sunglass|sun.?glass|eyewear|sonnenbrille|lunettes|gafas|occhiali|glasses)' },
};

function parseArgs(argv) {
  const args = {
    out: path.join(os.homedir(), '.cache', 'village-waste', 'extra'),
    'per-source': 70,
    probe: 0.2,
    seed: 42,
    force: false,
    only: '',
    slug: '',
    'max-requests': 40,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`);
    const key = token.slice(2);
    if (key === 'force') {
      args.force = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`--${key} needs a value`);
    i += 1;
    args[key] = value;
  }
  args.out = path.resolve(args.out.replace(/^~(?=\/|$)/, os.homedir()));
  args['per-source'] = Number(args['per-source']);
  args.probe = Number(args.probe);
  args.seed = Number(args.seed);
  if (!Number.isInteger(args['per-source']) || args['per-source'] < 1) throw new Error('--per-source must be a positive integer');
  if (!(args.probe >= 0 && args.probe < 0.5)) throw new Error('--probe must be between 0 and 0.5');
  return args;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function stripHtml(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function api(params, attempt = 0) {
  const url = `${API}?${new URLSearchParams({ ...params, format: 'json', formatversion: '2', maxlag: '5' })}`;
  try {
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (response.status === 429 || response.status >= 500) {
      throw new Error(`HTTP ${response.status}`);
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (attempt >= 3) throw error;
    const wait = 4000 * (attempt + 1);
    console.warn(`    ${error.message}; retrying in ${wait / 1000}s`);
    await sleep(wait);
    return api(params, attempt + 1);
  }
}

async function listCategory(category, limit) {
  const pages = [];
  let cont = {};
  while (pages.length < limit) {
    const data = await api({
      action: 'query',
      generator: 'categorymembers',
      gcmtitle: `Category:${category}`,
      gcmtype: 'file',
      gcmlimit: '50',
      prop: 'imageinfo',
      iiprop: 'url|mime|size|extmetadata',
      iiurlwidth: '640',
      ...cont,
    });
    if (data.error) throw new Error(data.error.info || data.error.code);
    for (const page of data.query?.pages || []) {
      pages.push(page);
      if (pages.length >= limit) break;
    }
    if (!data.continue) break;
    cont = { gcmcontinue: data.continue.gcmcontinue, continue: data.continue.continue };
    await sleep(1200);
  }
  return pages;
}

function usable(page) {
  const info = page.imageinfo?.[0];
  if (!info) return null;
  if (!ALLOWED_MIME.has(info.mime || '')) return null;
  if (!info.thumburl && !info.url) return null;
  if ((info.width || 0) < 300 || (info.height || 0) < 300) return null;
  if (SKIP_NAME.test(page.title || '')) return null;
  const meta = info.extmetadata || {};
  return {
    title: page.title,
    url: info.thumburl || info.url,
    page: info.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
    license: stripHtml(meta.LicenseShortName?.value) || 'unknown',
    artist: stripHtml(meta.Artist?.value) || '',
    credit: stripHtml(meta.Credit?.value) || '',
    mime: info.mime,
    width: info.width,
    height: info.height,
  };
}

function extensionFor(mime, url) {
  if (mime === 'image/png') return '.png';
  if (mime === 'image/webp') return '.webp';
  const fromUrl = path.extname(new URL(url).pathname).toLowerCase();
  return fromUrl && fromUrl.length <= 5 ? fromUrl : '.jpg';
}

async function download(url, file, attempt = 0) {
  try {
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 2000) throw new Error(`short body (${buffer.length} bytes)`);
    fs.writeFileSync(file, buffer);
    return buffer.length;
  } catch (error) {
    if (attempt >= 4) throw error;
    // Wikimedia's thumbnail hosts throttle bursts hard.  Backing off for
    // longer than the first version did is what keeps a large fetch moving.
    await sleep(15000 * (attempt + 1));
    return download(url, file, attempt + 1);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rng = mulberry32(args.seed);
  const only = new Set(
    String(args.only || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  fs.mkdirSync(args.out, { recursive: true });
  const manifestPath = path.join(args.out, 'sources.json');
  const manifest = fs.existsSync(manifestPath) && !args.force ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : [];
  const keep = new Map(manifest.map((row) => [row.file, row]));

  let pending = 0;
  for (const source of SOURCES) {
    if (only.size > 0 && !only.has(source.label.toLowerCase())) continue;
    if (args.slug && source.slug !== args.slug) continue;
    const want = args['per-source'];
    console.log(`\n${source.label} / ${source.slug}  (Category:${source.category})`);
    let pages;
    try {
      pages = await listCategory(source.category, Math.max(want * 2, 60));
    } catch (error) {
      console.warn(`  skipped: ${error.message}`);
      continue;
    }
    let usablePages = pages.map(usable).filter(Boolean);
    const filter = TITLE_FILTERS[source.slug];
    if (filter?.match) {
      const allow = new RegExp(filter.match, 'i');
      usablePages = usablePages.filter((item) => allow.test(item.title));
    }
    if (filter?.exclude) {
      const deny = new RegExp(filter.exclude, 'i');
      usablePages = usablePages.filter((item) => !deny.test(item.title));
    }
    // Deterministic order, then a seeded shuffle so a rerun picks the same set.
    usablePages.sort((a, b) => a.title.localeCompare(b.title));
    for (let i = usablePages.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [usablePages[i], usablePages[j]] = [usablePages[j], usablePages[i]];
    }
    const picked = usablePages.slice(0, want);
    if (picked.length === 0) {
      console.warn('  no usable photos');
      continue;
    }
    const probeCount = Math.round(picked.length * args.probe);
    let downloaded = 0;
    let skipped = 0;
    for (let i = 0; i < picked.length; i += 1) {
      const item = picked[i];
      const probe = i < probeCount;
      const folder = path.join(args.out, probe ? 'probe' : 'images', source.label);
      fs.mkdirSync(folder, { recursive: true });
      const ext = extensionFor(item.mime, item.url);
      const file = path.join(folder, `${source.slug}__${String(i).padStart(4, '0')}${ext}`);
      const rel = path.relative(args.out, file);
      const row = {
        label: source.label,
        slug: source.slug,
        category: source.category,
        split: probe ? 'probe' : 'train',
        file: rel,
        title: item.title,
        page: item.page,
        license: item.license,
        artist: item.artist,
        credit: item.credit,
      };
      if (fs.existsSync(file) && !args.force) {
        // The file is already on disk from an interrupted run.  Keep the
        // licence row current even when nobody had to download it again.
        keep.set(rel, { ...keep.get(rel), ...row, bytes: fs.statSync(file).size });
        skipped += 1;
        continue;
      }
      try {
        const bytes = await download(item.url, file);
        keep.set(rel, { ...row, bytes });
        downloaded += 1;
      } catch (error) {
        console.warn(`  ${item.title}: ${error.message}`);
        if (fs.existsSync(file)) fs.unlinkSync(file);
      }
      pending += 1;
      if (pending % 20 === 0) {
        fs.writeFileSync(manifestPath, `${JSON.stringify([...keep.values()], null, 2)}\n`);
      }
      await sleep(4000);
    }
    console.log(`  ${downloaded} downloaded, ${skipped} already present, ${picked.length - probeCount} train / ${probeCount} probe`);
    fs.writeFileSync(manifestPath, `${JSON.stringify([...keep.values()], null, 2)}\n`);
    await sleep(1200);
  }
  fs.writeFileSync(manifestPath, `${JSON.stringify([...keep.values()].sort((a, b) => a.file.localeCompare(b.file)), null, 2)}\n`);
  console.log(`\nManifest: ${manifestPath} (${keep.size} files)`);
}

main().catch((error) => {
  console.error(`\nfetch_extra_images: ${error.message}`);
  process.exit(1);
});
