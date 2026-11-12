#!/usr/bin/env node
/**
 * Show what an exported waste model predicts for one photo or a folder.
 *
 * Naming a class on a single frame is how an operator reports a mistake
 * ("my car key came out as leather"), so this is the tool for checking that
 * report without opening the camera.
 *
 * Usage:
 *
 *   node scripts/waste/predict_waste_image.mjs \
 *     --model models/waste --modules ~/.cache/village-waste \
 *     --image /tmp/key.jpg
 *
 *   node scripts/waste/predict_waste_image.mjs --folder ~/photos/keys --top 5
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const IMAGE_SIZE = 224;
const IMAGE_RE = /\.(jpe?g|png|bmp|gif|webp)$/i;

function parseArgs(argv) {
  const args = {
    model: path.join(process.cwd(), 'models', 'waste'),
    modules: '',
    image: [],
    folder: '',
    top: 5,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`--${key} needs a value`);
    i += 1;
    if (key === 'image') args.image.push(value);
    else args[key] = value;
  }
  args.model = path.resolve(args.model.replace(/^~(?=\/|$)/, os.homedir()));
  if (args.modules) args.modules = path.resolve(args.modules.replace(/^~(?=\/|$)/, os.homedir()));
  args.folder = args.folder ? path.resolve(args.folder.replace(/^~(?=\/|$)/, os.homedir())) : '';
  args.top = Number(args.top);
  return args;
}

function loadTensorflow(args) {
  const require = createRequire(import.meta.url);
  for (const base of [args.modules, path.dirname(args.model), process.cwd()].filter(Boolean)) {
    let resolved;
    try {
      resolved = require.resolve('@tensorflow/tfjs-node', { paths: [base] });
    } catch {
      continue;
    }
    // Do not swallow a load failure here: "not found" and "found but failed
    // to load" are different problems, and the second one has the real error.
    return require(resolved);
  }
  throw new Error('Cannot find @tensorflow/tfjs-node; pass --modules <dir with node_modules>');
}

function listImages(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return listImages(full);
      return entry.isFile() && IMAGE_RE.test(entry.name) ? [full] : [];
    })
    .sort();
}

function centreCrop(tf, file) {
  const image = tf.node.decodeImage(fs.readFileSync(file), 3);
  return tf.tidy(() => {
    const [height, width] = image.shape;
    const side = Math.min(height, width);
    const y = Math.floor((height - side) / 2);
    const x = Math.floor((width - side) / 2);
    return tf.image
      .resizeBilinear(image.slice([y, x, 0], [side, side, 3]), [IMAGE_SIZE, IMAGE_SIZE], true)
      .toFloat()
      .div(tf.scalar(127))
      .sub(tf.scalar(1));
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tf = loadTensorflow(args);
  const metadata = JSON.parse(fs.readFileSync(path.join(args.model, 'metadata.json'), 'utf8'));
  const labels = metadata.labels.map((item) => (typeof item === 'string' ? item : String(item.name)));
  const model = await tf.loadLayersModel(`file://${path.join(args.model, 'model.json')}`);
  const files = [...args.image, ...listImages(args.folder)];
  if (files.length === 0) throw new Error('pass --image <file> and/or --folder <folder>');

  for (const file of files) {
    const input = tf.tidy(() => centreCrop(tf, file).expandDims(0));
    const logits = model.predict(input);
    const probabilities = Array.from(await logits.data());
    input.dispose();
    logits.dispose();
    const ranked = probabilities
      .map((probability, index) => ({ label: labels[index], probability }))
      .sort((a, b) => b.probability - a.probability)
      .slice(0, args.top);
    console.log(`\n${path.basename(file)}`);
    for (const row of ranked) {
      console.log(`  ${row.label.padEnd(12)} ${(row.probability * 100).toFixed(1).padStart(5)}%`);
    }
  }
}

main().catch((error) => {
  console.error(`predict_waste_image: ${error.message}`);
  process.exit(1);
});
