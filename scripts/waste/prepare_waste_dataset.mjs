#!/usr/bin/env node
/**
 * Assemble the waste dataset this project trains on, one folder per class.
 *
 * Every recycler material has its own model class so the classifier can learn
 * its shape and texture, but the dashboard maps all of them to one outcome:
 * hand it to the recycling agent.  The folders are:
 *
 *   Organic  Plastic  Paper  Glass  Metal  Textile  Leather  Footwear
 *   Thermocol  Ewaste  Background
 *
 * TrashNet supplies Plastic, Paper, Glass and Metal.  The other folders are
 * collected separately (see docs/waste-model.md and scripts/waste/README.md).
 *
 * Usage (paths separated by a comma when one class has several sources):
 *
 *   node scripts/waste/prepare_waste_dataset.mjs \
 *     --trashnet ~/.cache/village-waste/dataset-resized \
 *     --organic ~/.cache/village-waste/raw/organic \
 *     --background ~/.cache/village-waste/raw/background \
 *     --textile ~/photos/textile,~/photos/fabric \
 *     --leather ~/photos/leather --footwear ~/photos/footwear \
 *     --thermocol ~/photos/thermocol --ewaste ~/photos/ewaste \
 *     --out ~/.cache/village-waste/raw-classes
 *
 * TrashNet's `trash` folder is deliberately not used: it is a mixture of the
 * classes above, and a mixed label teaches nothing a per-material class does.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CLASSES = [
  'Organic', 'Plastic', 'Paper', 'Glass', 'Metal', 'Textile',
  'Leather', 'Footwear', 'Thermocol', 'Ewaste', 'Background',
];
const IMAGE_RE = /\.(jpe?g|png|bmp|gif)$/i;

function parseArgs(argv) {
  const args = {
    trashnet: '',
    organic: '',
    background: '',
    textile: '',
    leather: '',
    footwear: '',
    thermocol: '',
    ewaste: '',
    out: '',
    limit: 0,
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
  if (!args.trashnet) throw new Error('--trashnet is required (the extracted dataset-resized folder)');
  if (!args.out) throw new Error('--out is required');
  for (const key of ['trashnet', 'organic', 'background', 'textile', 'leather', 'footwear', 'thermocol', 'ewaste', 'out']) {
    if (args[key]) {
      args[key] = args[key]
        .split(',')
        .map((value) => path.resolve(value.trim().replace(/^~(?=\/|$)/, os.homedir())))
        .filter(Boolean);
    }
  }
  args.limit = Number(args.limit);
  return args;
}

function imagesIn(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && IMAGE_RE.test(entry.name))
    .map((entry) => path.join(dir, entry.name))
    .sort();
}

function copyInto(outDir, files, prefix, label) {
  let copied = 0;
  for (const file of files) {
    const target = path.join(outDir, `${prefix}-${path.basename(file)}`);
    if (fs.existsSync(target)) continue;
    fs.copyFileSync(file, target);
    copied += 1;
  }
  console.log(`  ${label.padEnd(10)} ${String(copied).padStart(4)} copied`);
  return copied;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (fs.existsSync(args.out) && !args.force) {
    const held = fs
      .readdirSync(args.out)
      .filter((name) => fs.statSync(path.join(args.out, name)).isDirectory());
    if (held.length > 0) throw new Error(`${args.out} already holds ${held.join(', ')}; pass --force to rebuild it`);
  }
  fs.mkdirSync(args.out, { recursive: true });

  const trashnet = args.trashnet[0];
  const plan = {
    Organic: args.organic,
    Plastic: [path.join(trashnet, 'plastic')],
    Paper: [path.join(trashnet, 'paper')],
    Glass: [path.join(trashnet, 'glass')],
    Metal: [path.join(trashnet, 'metal')],
    Textile: args.textile,
    Leather: args.leather,
    Footwear: args.footwear,
    Thermocol: args.thermocol,
    Ewaste: args.ewaste,
    Background: args.background,
  };

  console.log(`Assembling ${args.out}`);
  const counts = {};
  for (const label of CLASSES) {
    const dirs = plan[label];
    if (!dirs || dirs.length === 0) {
      console.warn(`  ${label.padEnd(10)} no source given; skipped`);
      counts[label] = 0;
      continue;
    }
    const outDir = path.join(args.out, label);
    fs.mkdirSync(outDir, { recursive: true });
    let total = 0;
    for (const dir of dirs) {
      let files = imagesIn(dir);
      if (args.limit > 0) files = files.slice(0, Math.max(0, args.limit - total));
      total += copyInto(outDir, files, path.basename(dir), label);
      if (args.limit > 0 && total >= args.limit) break;
    }
    counts[label] = total;
  }

  console.log('\nCounts');
  for (const label of CLASSES) console.log(`  ${label.padEnd(10)} ${String(counts[label]).padStart(4)}`);
  const empty = CLASSES.filter((label) => counts[label] === 0);
  if (empty.length > 0) {
    console.error(`\nNo images for: ${empty.join(', ')}. Supply those folders before training.`);
    process.exit(1);
  }
  console.log(`\nNext:\n  node scripts/waste/train_waste_model.mjs --data ${args.out} --modules ~/.cache/village-waste --out models/waste --force`);
}

try {
  main();
} catch (error) {
  console.error(`prepare_waste_dataset: ${error.message}`);
  process.exit(1);
}
