#!/usr/bin/env node
/**
 * Assemble the four-class waste dataset this project trains on.
 *
 * TrashNet supplies the plastic and paper examples; the organic and background
 * folders are collected separately (organic food waste, and views of the room
 * and table with no item).  The script copies images into one folder per class
 * so train_waste_model.mjs can hold back its own validation split.
 *
 *   node scripts/waste/prepare_waste_dataset.mjs \
 *     --trashnet ~/.cache/village-waste/dataset-resized \
 *     --organic  ~/.cache/village-waste/raw/organic \
 *     --background ~/.cache/village-waste/raw/background \
 *     --out ~/.cache/village-waste/raw-classes
 *
 * TrashNet's `plastic` folder becomes Plastic; `paper` and `cardboard` become
 * Paper.  Its `glass`, `metal` and `trash` folders are deliberately not used:
 * the exhibition has three bins, and teaching a fourth "recyclable" class the
 * app cannot indicate would only produce confident wrong answers.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const LABELS = ['Organic', 'Plastic', 'Paper', 'Background'];
const IMAGE_RE = /\.(jpe?g|png|bmp|gif)$/i;
const SOURCES = {
  Plastic: ['plastic'],
  Paper: ['paper', 'cardboard'],
};

function parseArgs(argv) {
  const args = { trashnet: '', organic: '', background: '', out: '', limit: 0, force: false };
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
  for (const key of ['trashnet', 'organic', 'background', 'out']) {
    if (!args[key]) throw new Error(`--${key} is required`);
    args[key] = path.resolve(args[key].replace(/^~(?=\/|$)/, os.homedir()));
  }
  args.limit = Number(args.limit);
  return args;
}

function imagesIn(dir) {
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
    const held = fs.readdirSync(args.out).filter((name) => fs.statSync(path.join(args.out, name)).isDirectory());
    if (held.length > 0) throw new Error(`${args.out} already holds ${held.join(', ')}; pass --force to rebuild it`);
  }
  fs.mkdirSync(args.out, { recursive: true });

  console.log(`Assembling ${args.out}`);
  const plan = {
    Organic: [{ files: imagesIn(args.organic), prefix: 'organic' }],
    Background: [{ files: imagesIn(args.background), prefix: 'bg' }],
    Plastic: SOURCES.Plastic.map((name) => ({ files: imagesIn(path.join(args.trashnet, name)), prefix: name })),
    Paper: SOURCES.Paper.map((name) => ({ files: imagesIn(path.join(args.trashnet, name)), prefix: name })),
  };

  const counts = {};
  for (const label of LABELS) {
    const outDir = path.join(args.out, label);
    fs.mkdirSync(outDir, { recursive: true });
    let total = 0;
    for (const source of plan[label]) {
      let files = source.files;
      if (args.limit > 0) files = files.slice(0, Math.max(0, args.limit - total));
      total += copyInto(outDir, files, source.prefix, label);
      if (args.limit > 0 && total >= args.limit) break;
    }
    counts[label] = total;
  }

  const empty = LABELS.filter((label) => counts[label] === 0);
  console.log('\nCounts');
  for (const label of LABELS) console.log(`  ${label.padEnd(10)} ${String(counts[label]).padStart(4)}`);
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
