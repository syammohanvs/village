#!/usr/bin/env node
/**
 * Score an exported waste model on a folder of photos.
 *
 * The trainer prints these numbers for the model it just built.  This script
 * does the same for any exported model, which is what makes a comparison
 * honest: the old and the new model are scored on exactly the same photos by
 * exactly the same code.
 *
 * Usage:
 *
 *   node scripts/waste/evaluate_waste_model.mjs \
 *     --model models/waste \
 *     --data ~/.cache/village-waste/v2 \
 *     --probe ~/.cache/village-waste/v2/probe \
 *     --modules ~/.cache/village-waste
 *
 * `--data` must contain `val/<Class>/`.  `--probe` must contain `<Class>/`
 * with files named `<object>__<n>.<ext>` so the report can group them.
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
    data: '',
    probe: '',
    modules: '',
    batch: 32,
    report: '',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`--${key} needs a value`);
    i += 1;
    args[key] = value;
  }
  for (const key of ['model', 'data', 'probe', 'report']) {
    if (args[key]) args[key] = path.resolve(args[key].replace(/^~(?=\/|$)/, os.homedir()));
  }
  args.batch = Number(args.batch);
  return args;
}

function loadTensorflow(args) {
  const require = createRequire(import.meta.url);
  const candidates = [args.modules, path.dirname(args.model), process.cwd()].filter(Boolean);
  for (const base of candidates) {
    try {
      const resolved = require.resolve('@tensorflow/tfjs-node', { paths: [base] });
      return require(resolved);
    } catch {
      /* try the next location */
    }
  }
  throw new Error('Cannot find @tensorflow/tfjs-node; pass --modules <dir with node_modules>');
}

function listImages(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && IMAGE_RE.test(entry.name))
    .map((entry) => path.join(dir, entry.name))
    .sort();
}

function centreCrop(tf, file) {
  const image = tf.node.decodeImage(fs.readFileSync(file), 3);
  return tf.tidy(() => {
    const [height, width] = image.shape;
    const side = Math.min(height, width);
    const crop = image.slice([Math.floor((height - side) / 2), Math.floor((width - side) / 2), 0], [side, side, 3]);
    return tf.image
      .resizeBilinear(crop, [IMAGE_SIZE, IMAGE_SIZE], true)
      .toFloat()
      .div(tf.scalar(127))
      .sub(tf.scalar(1));
  });
}

async function predict(tf, model, entries, batch) {
  const out = [];
  for (let start = 0; start < entries.length; start += batch) {
    const slice = entries.slice(start, start + batch);
    const input = tf.tidy(() => tf.stack(slice.map((entry) => centreCrop(tf, entry.file))));
    const logits = model.predict(input);
    out.push(...Array.from(logits.argMax(1).dataSync()));
    input.dispose();
    logits.dispose();
  }
  return out;
}

function confusion(labels, predictions, truth) {
  const matrix = labels.map(() => Object.fromEntries(labels.map((name) => [name, 0])));
  let correct = 0;
  predictions.forEach((got, index) => {
    matrix[truth[index]][labels[got]] += 1;
    if (got === truth[index]) correct += 1;
  });
  const perClass = labels.map((label, index) => {
    const row = matrix[index];
    const total = Object.values(row).reduce((sum, value) => sum + value, 0);
    return { label, total, correct: row[label], accuracy: total > 0 ? row[label] / total : null };
  });
  return {
    accuracy: predictions.length > 0 ? correct / predictions.length : null,
    correct,
    total: predictions.length,
    perClass,
    matrix: Object.fromEntries(labels.map((label, index) => [label, matrix[index]])),
  };
}

function objectReport(labels, predictions, entries) {
  const byObject = new Map();
  entries.forEach((entry, index) => {
    const source = path.basename(entry.file).split('__')[0];
    const row = byObject.get(source) || { source, class: entry.labelName, total: 0, correct: 0, wrong: new Map() };
    row.total += 1;
    if (labels[predictions[index]] === entry.labelName) {
      row.correct += 1;
    } else {
      const got = labels[predictions[index]];
      row.wrong.set(got, (row.wrong.get(got) || 0) + 1);
    }
    byObject.set(source, row);
  });
  return [...byObject.values()]
    .map((row) => ({
      source: row.source,
      class: row.class,
      total: row.total,
      correct: row.correct,
      accuracy: row.correct / row.total,
      wrong: Object.fromEntries([...row.wrong.entries()].sort((a, b) => b[1] - a[1])),
    }))
    .sort((a, b) => a.source.localeCompare(b.source));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tf = loadTensorflow(args);
  const metadata = JSON.parse(fs.readFileSync(path.join(args.model, 'metadata.json'), 'utf8'));
  const labels = metadata.labels.map((item) => (typeof item === 'string' ? item : String(item.name)));
  const model = await tf.loadLayersModel(`file://${path.join(args.model, 'model.json')}`);
  console.log(`model ${args.model}`);
  console.log(`labels ${labels.join(', ')}`);

  const report = { model: args.model, labels };
  if (args.data) {
    const entries = [];
    for (const label of labels) {
      for (const file of listImages(path.join(args.data, 'val', label))) {
        entries.push({ file, labelName: label });
      }
    }
    if (entries.length > 0) {
      const predictions = await predict(tf, model, entries, args.batch);
      const truth = entries.map((entry) => labels.indexOf(entry.labelName));
      const result = confusion(labels, predictions, truth);
      report.validation = result;
      console.log(`\nvalidation ${(result.accuracy * 100).toFixed(1)}% (${result.correct}/${result.total})`);
      for (const row of result.perClass) {
        if (row.total === 0) continue;
        console.log(`  ${row.label.padEnd(10)} ${(row.accuracy * 100).toFixed(1).padStart(5)}%  (${row.correct}/${row.total})`);
      }
    }
  }

  if (args.probe) {
    const entries = [];
    for (const label of labels) {
      for (const file of listImages(path.join(args.probe, label))) {
        entries.push({ file, labelName: label });
      }
    }
    if (entries.length > 0) {
      const predictions = await predict(tf, model, entries, args.batch);
      const truth = entries.map((entry) => labels.indexOf(entry.labelName));
      const result = confusion(labels, predictions, truth);
      report.probe = { ...result, objects: objectReport(labels, predictions, entries) };
      console.log(`\nprobe ${(result.accuracy * 100).toFixed(1)}% (${result.correct}/${result.total})`);
      for (const row of result.perClass) {
        if (row.total === 0) continue;
        console.log(`  ${row.label.padEnd(10)} ${(row.accuracy * 100).toFixed(1).padStart(5)}%  (${row.correct}/${row.total})`);
      }
      for (const row of report.probe.objects) {
        const wrong = Object.entries(row.wrong)
          .map(([label, count]) => `${label} ${count}`)
          .join(', ');
        console.log(
          `  ${row.source.padEnd(24)} ${(row.accuracy * 100).toFixed(1).padStart(5)}%  (${row.correct}/${row.total})${wrong ? `   misread as: ${wrong}` : ''}`,
        );
      }
    }
  }

  if (args.report) {
    fs.mkdirSync(path.dirname(args.report), { recursive: true });
    fs.writeFileSync(args.report, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\nwrote ${args.report}`);
  }
}

main().catch((error) => {
  console.error(`evaluate_waste_model: ${error.message}`);
  process.exit(1);
});
