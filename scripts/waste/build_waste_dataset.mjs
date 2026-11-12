#!/usr/bin/env node
/**
 * Assemble the improved training tree from the bootstrap dataset, TrashNet's
 * unused `cardboard` class and the extra Commons photos.
 *
 * The bootstrap tree has `train/<Class>/` and `val/<Class>/`.  This script
 * hard-links those files (no rewrite, no change to the original cache) and adds
 * two things the classifier was missing:
 *
 *   - TrashNet's `cardboard` photos, filed under Paper.  Brown cardboard was
 *     being read as electronic waste because Paper had no brown paper at all.
 *     TrashNet ships 403 cardboard photos that the first dataset builder never
 *     copied.
 *   - The object photos downloaded by fetch_extra_images.mjs (bottle caps,
 *     ball pens, paper bags, foam packaging, cans, jars ...).  A slice of each
 *     stays out of training as `probe/<Class>/` so the trainer can report the
 *     result on photos it has never seen.
 *
 * Usage:
 *
 *   node scripts/waste/build_waste_dataset.mjs \
 *     --base ~/.cache/village-waste \
 *     --trashnet ~/.cache/village-waste/dataset-resized \
 *     --extra ~/.cache/village-waste/extra \
 *     --out ~/.cache/village-waste/v2 --force
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CLASSES = [
  'Organic', 'Plastic', 'Paper', 'Glass', 'Metal', 'Textile',
  'Leather', 'Footwear', 'Thermocol', 'Ewaste', 'Background',
];
const IMAGE_RE = /\.(jpe?g|png|bmp|gif|webp)$/i;

function parseArgs(argv) {
  const args = {
    base: path.join(os.homedir(), '.cache', 'village-waste'),
    trashnet: path.join(os.homedir(), '.cache', 'village-waste', 'dataset-resized'),
    extra: path.join(os.homedir(), '.cache', 'village-waste', 'extra'),
    out: path.join(os.homedir(), '.cache', 'village-waste', 'v2'),
    'val-fraction': 0.15,
    'extra-repeat': 1,
    seed: 42,
    force: false,
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
  for (const key of ['base', 'trashnet', 'extra', 'out']) {
    args[key] = path.resolve(args[key].replace(/^~(?=\/|$)/, os.homedir()));
  }
  args['val-fraction'] = Number(args['val-fraction']);
  args['extra-repeat'] = Number(args['extra-repeat']);
  args.seed = Number(args.seed);
  if (!(args['val-fraction'] > 0 && args['val-fraction'] < 0.5)) throw new Error('--val-fraction must be between 0 and 0.5');
  if (!Number.isInteger(args['extra-repeat']) || args['extra-repeat'] < 1) throw new Error('--extra-repeat must be a positive integer');
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

function listImages(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && IMAGE_RE.test(entry.name))
    .map((entry) => path.join(dir, entry.name))
    .sort();
}

function linkOrCopy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.linkSync(from, to);
  } catch {
    fs.copyFileSync(from, to);
  }
}

function shuffle(files, rng) {
  const copy = files.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function addSource(args, rng, label, files, prefix, counts, repeat = 1) {
  if (files.length === 0) return;
  const shuffled = shuffle(files, rng);
  const valCount = Math.max(1, Math.round(shuffled.length * args['val-fraction']));
  shuffled.forEach((file, index) => {
    const split = index < valCount ? 'val' : 'train';
    for (let copy = 0; copy < repeat; copy += 1) {
      const name = `${prefix}r${copy}__${String(index).padStart(4, '0')}${path.extname(file).toLowerCase()}`;
      linkOrCopy(file, path.join(args.out, split, label, name));
      counts[split][label] += 1;
    }
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const rng = mulberry32(args.seed);
  if (fs.existsSync(args.out)) {
    if (!args.force) throw new Error(`${args.out} already exists; pass --force to rebuild it`);
    fs.rmSync(args.out, { recursive: true, force: true });
  }
  for (const split of ['train', 'val', 'probe']) {
    for (const label of CLASSES) fs.mkdirSync(path.join(args.out, split, label), { recursive: true });
  }
  const counts = {
    train: Object.fromEntries(CLASSES.map((label) => [label, 0])),
    val: Object.fromEntries(CLASSES.map((label) => [label, 0])),
    probe: Object.fromEntries(CLASSES.map((label) => [label, 0])),
  };
  const sources = {};

  // 1. The bootstrap tree, without the abandoned Medical class.
  for (const label of CLASSES) {
    for (const split of ['train', 'val']) {
      const files = listImages(path.join(args.base, split, label));
      files.forEach((file, index) => {
        const name = `base__${String(index).padStart(5, '0')}${path.extname(file).toLowerCase()}`;
        linkOrCopy(file, path.join(args.out, split, label, name));
        counts[split][label] += 1;
      });
    }
  }
  sources.base = 'bootstrap train/val tree (TrashNet + organic/background + recycler classes)';

  // 2. TrashNet cardboard -> Paper.  This is the brown-paper fix.
  const cardboard = listImages(path.join(args.trashnet, 'cardboard'));
  addSource(args, rng, 'Paper', cardboard, 'trashnet-cardboard', counts);
  sources.cardboard = `${cardboard.length} TrashNet cardboard photos filed under Paper`;

  // 3. Extra Commons photos, plus their held-out probe slice.  Real-world
  // photos are repeated so the studio photos in the bootstrap tree do not
  // drown them: a bottle cap from a Commons photo is what the venue sees.
  const extraDir = path.join(args.extra, 'images');
  for (const label of CLASSES) {
    const files = listImages(path.join(extraDir, label));
    addSource(args, rng, label, files, 'extra', counts, args['extra-repeat']);
    const probe = listImages(path.join(args.extra, 'probe', label));
    probe.forEach((file) => {
      linkOrCopy(file, path.join(args.out, 'probe', label, path.basename(file)));
      counts.probe[label] += 1;
    });
  }
  sources.extra = path.join(args.extra, 'images');
  sources.probe = path.join(args.extra, 'probe');

  console.log(`\nAssembled ${args.out}\n`);
  console.log(`  ${'class'.padEnd(11)} ${'train'.padStart(6)} ${'val'.padStart(5)} ${'probe'.padStart(6)}`);
  let total = { train: 0, val: 0, probe: 0 };
  for (const label of CLASSES) {
    console.log(`  ${label.padEnd(11)} ${String(counts.train[label]).padStart(6)} ${String(counts.val[label]).padStart(5)} ${String(counts.probe[label]).padStart(6)}`);
    total.train += counts.train[label];
    total.val += counts.val[label];
    total.probe += counts.probe[label];
  }
  console.log(`  ${'total'.padEnd(11)} ${String(total.train).padStart(6)} ${String(total.val).padStart(5)} ${String(total.probe).padStart(6)}`);

  fs.writeFileSync(
    path.join(args.out, 'dataset.json'),
    `${JSON.stringify({ assembledAt: new Date().toISOString(), args, counts, sources }, null, 2)}\n`,
  );
  console.log('\nNext:');
  console.log(`  node scripts/waste/train_waste_model.mjs --data ${args.out} --probe ${path.join(args.out, 'probe')} \\`);
  console.log(`    --modules ~/.cache/village-waste --out models/waste --force`);
}

try {
  main();
} catch (error) {
  console.error(`build_waste_dataset: ${error.message}`);
  process.exit(1);
}
