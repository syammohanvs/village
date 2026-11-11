#!/usr/bin/env node
/**
 * Train the waste classifier and export it in the format the dashboard loads.
 *
 * The export is the same shape a Teachable Machine image project produces
 * (model.json + weights.bin + metadata.json) and it is produced by the same
 * library Teachable Machine uses for its own image models: a frozen truncated
 * MobileNet v1 followed by a small dense head.  Nothing here talks to Google;
 * the training runs on this laptop with @tensorflow/tfjs-node.
 *
 * Dataset layout (both accepted):
 *
 *   <data>/Organic/*.jpg          # a single folder per class; --split is used
 *   ...
 *
 * or an already-split tree:
 *
 *   <data>/train/Organic/*.jpg
 *   <data>/val/Organic/*.jpg
 *
 * Usage:
 *
 *   npm install --prefix ~/.cache/village-waste @tensorflow/tfjs-node@4.22.0
 *   node scripts/waste/train_waste_model.mjs \
 *     --data ~/.cache/village-waste \
 *     --modules ~/.cache/village-waste \
 *     --out models/waste
 *
 * Nothing in models/ is committed.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const LABELS = ['Organic', 'Plastic', 'Paper', 'Glass', 'Metal', 'Textile', 'Leather', 'Footwear', 'Thermocol', 'Ewaste', 'Background'];
const IMAGE_SIZE = 224;
const CHECKPOINTS = {
  v1: 'https://storage.googleapis.com/tfjs-models/tfjs/mobilenet_v1_%ALPHA%_224/model.json',
  v2: 'https://storage.googleapis.com/teachable-machine-models/mobilenet_v2_weights_tf_dim_ordering_tf_kernels_%ALPHA%_224_no_top/model.json',
};
const IMAGE_RE = /\.(jpe?g|png|bmp|gif)$/i;

function parseArgs(argv) {
  const args = {
    data: process.env.WASTE_DATA || path.join(os.homedir(), '.cache', 'village-waste'),
    out: path.join(REPO_ROOT, 'models', 'waste'),
    modules: process.env.WASTE_TRAIN_MODULES || '',
    backbone: 'v1',
    alpha: 1.0,
    epochs: 60,
    batch: 16,
    dense: 128,
    'learning-rate': 0.002,
    augment: 2,
    pooling: 'gap',
    split: 0.15,
    seed: 42,
    force: false,
    verify: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`);
    const key = token.slice(2);
    if (key === 'force' || key === 'no-verify') {
      args[key === 'force' ? 'force' : 'verify'] = key === 'force';
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`--${key} needs a value`);
    i += 1;
    args[key] = value;
  }
  args.alpha = Number(args.alpha);
  args.epochs = Number(args.epochs);
  args.batch = Number(args.batch);
  args.dense = Number(args.dense);
  args['learning-rate'] = Number(args['learning-rate']);
  args.augment = Number(args.augment);
  args.split = Number(args.split);
  args.seed = Number(args.seed);
  args.data = path.resolve(args.data.replace(/^~(?=\/|$)/, os.homedir()));
  args.out = path.resolve(args.out);
  if (!['v1', 'v2'].includes(args.backbone)) throw new Error('--backbone must be v1 or v2');
  const alphas = args.backbone === 'v2' ? [0.35, 0.5, 0.75, 1] : [0.25, 0.5, 0.75, 1];
  if (!alphas.includes(args.alpha)) throw new Error(`--alpha must be ${alphas.join(', ')} for ${args.backbone}`);
  if (!Number.isInteger(args.epochs) || args.epochs < 1) throw new Error('--epochs must be a positive integer');
  if (!Number.isInteger(args.augment) || args.augment < 0) throw new Error('--augment must be 0 or more');
  if (!Number.isInteger(args.dense) || args.dense < 1) throw new Error('--dense must be a positive integer');
  if (!(args['learning-rate'] > 0)) throw new Error('--learning-rate must be positive');
  if (!(args.split > 0 && args.split < 1)) throw new Error('--split must be between 0 and 1');
  if (!['gap', 'gapmax'].includes(args.pooling)) throw new Error('--pooling must be gap or gapmax');
  return args;
}

function loadTensorflow(args) {
  const require = createRequire(import.meta.url);
  const candidates = [args.modules, args.data, process.cwd()].filter(Boolean);
  for (const base of candidates) {
    try {
      const resolved = require.resolve('@tensorflow/tfjs-node', { paths: [base] });
      return { tf: require(resolved), resolved };
    } catch {
      /* try the next location */
    }
  }
  throw new Error(
    'Cannot find @tensorflow/tfjs-node. Install it with:\n' +
      `  npm install --prefix ${args.data} @tensorflow/tfjs-node@4.22.0\n` +
      'or point --modules at the directory that holds node_modules.',
  );
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

function canonical(label) {
  const found = LABELS.find((name) => name.toLowerCase() === String(label).trim().toLowerCase());
  return found || null;
}

function listImages(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && IMAGE_RE.test(entry.name))
    .map((entry) => path.join(dir, entry.name))
    .sort();
}

function discoverDataset(dataDir, splitFraction, rng) {
  const train = new Map();
  const val = new Map();
  const nested = fs.existsSync(path.join(dataDir, 'train')) || fs.existsSync(path.join(dataDir, 'val'));

  if (nested) {
    for (const label of LABELS) {
      const trainFiles = listImages(path.join(dataDir, 'train', label));
      const valFiles = listImages(path.join(dataDir, 'val', label));
      if (trainFiles.length === 0 && valFiles.length === 0) continue;
      train.set(label, trainFiles);
      val.set(label, valFiles);
    }
  } else {
    for (const entry of fs.readdirSync(dataDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const label = canonical(entry.name);
      if (!label) continue;
      const files = listImages(path.join(dataDir, entry.name));
      if (files.length === 0) continue;
      const shuffled = files.slice();
      for (let i = shuffled.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      const count = Math.max(1, Math.round(shuffled.length * splitFraction));
      val.set(label, shuffled.slice(0, count));
      train.set(label, shuffled.slice(count));
    }
  }

  const missing = LABELS.filter((label) => (train.get(label) || []).length === 0);
  if (missing.length > 0) {
    throw new Error(`no training images for: ${missing.join(', ')} (looked in ${dataDir})`);
  }
  return { train, val };
}

function isReadableImage(tf, file) {
  try {
    const buffer = fs.readFileSync(file);
    const image = tf.node.decodeImage(buffer, 3);
    image.dispose();
    return true;
  } catch {
    return false;
  }
}

function dropUnreadableImages(tf, dataset) {
  let dropped = 0;
  for (const label of LABELS) {
    for (const split of ['train', 'val']) {
      const files = dataset[split].get(label) || [];
      const readable = files.filter((file) => isReadableImage(tf, file));
      dropped += files.length - readable.length;
      dataset[split].set(label, readable);
    }
  }
  if (dropped > 0) console.warn(`skipped ${dropped} unreadable image file(s)`);
}

function summarise(dataset) {
  return LABELS.map((label) => ({
    label,
    train: (dataset.train.get(label) || []).length,
    val: (dataset.val.get(label) || []).length,
  }));
}

function preprocess(tf, file, rng, augment) {
  const buffer = fs.readFileSync(file);
  return tf.tidy(() => {
    const image = tf.node.decodeImage(buffer, 3);
    const [height, width] = image.shape;
    const shortSide = Math.min(height, width);
    // A little scale jitter keeps the model from memorising the exact framing
    // of a studio photo; validation always uses the plain centre crop.
    const scale = augment ? 0.86 + rng() * 0.14 : 1;
    const side = Math.max(16, Math.round(shortSide * scale));
    const maxX = width - side;
    const maxY = height - side;
    const dx = augment ? Math.floor(rng() * (maxX + 1)) : Math.floor(maxX / 2);
    const dy = augment ? Math.floor(rng() * (maxY + 1)) : Math.floor(maxY / 2);
    let crop = image.slice([dy, dx, 0], [side, side, 3]);
    if (augment && rng() < 0.5) crop = crop.reverse(1);
    let tensor = tf.image.resizeBilinear(crop, [IMAGE_SIZE, IMAGE_SIZE], true).toFloat();
    // Teachable Machine's own capture step normalises to [-1, 1].
    tensor = tensor.div(tf.scalar(127)).sub(tf.scalar(1));
    if (augment) {
      const brightness = 1 + (rng() - 0.5) * 0.18;
      tensor = tensor.mul(tf.scalar(brightness)).clipByValue(-1, 1);
    }
    return tensor;
  });
}

async function extractFeatures(tf, base, entries, batchSize, rng, label) {
  const chunks = [];
  for (let start = 0; start < entries.length; start += batchSize) {
    const slice = entries.slice(start, start + batchSize);
    const batch = tf.tidy(() => tf.stack(slice.map((entry) => preprocess(tf, entry.file, rng, entry.augment))));
    chunks.push(base.predict(batch));
    batch.dispose();
    if (start === 0 || (start / batchSize) % 10 === 0 || start + batchSize >= entries.length) {
      process.stdout.write(`\r  ${label} ${Math.min(start + batchSize, entries.length)} / ${entries.length}`);
    }
  }
  process.stdout.write('\n');
  if (chunks.length === 0) throw new Error(`no ${label} images`);
  return tf.concat(chunks, 0);
}

function toEntries(files, labelIndex, copies, rng) {
  const entries = [];
  for (const file of files) {
    entries.push({ file, label: labelIndex, augment: false });
    for (let copy = 0; copy < copies; copy += 1) entries.push({ file, label: labelIndex, augment: true });
  }
  for (let i = entries.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [entries[i], entries[j]] = [entries[j], entries[i]];
  }
  return entries;
}

function confusion(predictions, truth) {
  const labels = LABELS;
  const matrix = labels.map(() => Object.fromEntries(labels.map((name) => [name, 0])));
  let correct = 0;
  for (let i = 0; i < predictions.length; i += 1) {
    const got = labels[predictions[i]];
    const want = labels[truth[i]];
    matrix[truth[i]][got] += 1;
    if (predictions[i] === truth[i]) correct += 1;
  }
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { tf } = loadTensorflow(args);
  // One deterministic stream for the split, augmentation and head initialisation.
  const rng = mulberry32(args.seed);

  const dataset = discoverDataset(args.data, args.split, rng);
  dropUnreadableImages(tf, dataset);
  const counts = summarise(dataset);
  const totalTrain = counts.reduce((sum, row) => sum + row.train, 0);
  const totalVal = counts.reduce((sum, row) => sum + row.val, 0);
  if (totalVal === 0) {
    throw new Error('no validation images; supply a val/ tree or use more images so --split can hold some back');
  }
  if (args.augment > 0 && totalTrain < 80) {
    console.warn(`warning: only ${totalTrain} training images; augmentation helps but more photos are better`);
  }

  console.log('Waste classifier training');
  console.log(`  data       ${args.data}`);
  console.log(`  output     ${args.out}`);
  console.log(`  MobileNet  ${args.backbone} alpha ${args.alpha} (frozen), image ${IMAGE_SIZE}x${IMAGE_SIZE}, pooling ${args.pooling}`);
  console.log('  classes');
  for (const row of counts) console.log(`    ${row.label.padEnd(10)} train ${String(row.train).padStart(4)}   val ${String(row.val).padStart(3)}`);

  console.log('\nLoading the truncated MobileNet checkpoint...');
  const alphaString = args.alpha === 1 ? '1.0' : args.alpha.toFixed(2);
  const checkpoint = CHECKPOINTS[args.backbone].replace('%ALPHA%', alphaString);
  const mobilenet = await tf.loadLayersModel(checkpoint);
  // Teachable Machine's web export ends in global average pooling.  `gapmax`
  // appends global max pooling as well: the strongest activations carry the
  // edges and reflections that separate a clear plastic bottle from glass.
  const featureLayerName = args.backbone === 'v2' ? 'out_relu' : 'conv_pw_13_relu';
  const featureLayer = mobilenet.getLayer(featureLayerName);
  if (!featureLayer) throw new Error(`the checkpoint has no ${featureLayerName} layer`);
  const featureMap = featureLayer.output;
  const gap = tf.layers.globalAveragePooling2d({ name: 'vbt_gap' }).apply(featureMap);
  let pooled = gap;
  if (args.pooling === 'gapmax') {
    const gmp = tf.layers.globalMaxPooling2d({ name: 'vbt_gmp' }).apply(featureMap);
    pooled = tf.layers.concatenate({ name: 'vbt_pool_concat' }).apply([gap, gmp]);
  }
  const base = tf.model({ inputs: mobilenet.inputs, outputs: pooled });
  base.trainable = false;

  const trainEntries = LABELS.flatMap((label, index) =>
    toEntries(dataset.train.get(label) || [], index, args.augment, rng),
  );
  const valEntries = LABELS.flatMap((label, index) =>
    (dataset.val.get(label) || []).map((file) => ({ file, label: index, augment: false })),
  );

  const existing = ['model.json', 'weights.bin', 'metadata.json'].filter((name) =>
    fs.existsSync(path.join(args.out, name)),
  );
  if (existing.length > 0 && !args.force) {
    throw new Error(
      `${args.out} already holds ${existing.join(', ')}. Pass --force to replace the installed model.`,
    );
  }
  fs.mkdirSync(args.out, { recursive: true });

  console.log('\nComputing MobileNet features (the base is frozen)...');
  const trainX = await extractFeatures(tf, base, trainEntries, args.batch, rng, 'train');
  const valX = await extractFeatures(tf, base, valEntries, args.batch, rng, 'val');
  const trainY = tf.oneHot(tf.tensor1d(trainEntries.map((entry) => entry.label), 'int32'), LABELS.length);
  const valY = tf.oneHot(tf.tensor1d(valEntries.map((entry) => entry.label), 'int32'), LABELS.length);
  console.log(`  features ${trainX.shape[0]} train / ${valX.shape[0]} val, width ${trainX.shape[1]}`);

  const head = tf.sequential({
    layers: [
      tf.layers.dense({
        inputShape: [trainX.shape[1]],
        units: args.dense,
        activation: 'relu',
        kernelInitializer: tf.initializers.varianceScaling({ seed: args.seed }),
      }),
      tf.layers.dropout({ rate: 0.35 }),
      tf.layers.dense({
        units: LABELS.length,
        activation: 'softmax',
        useBias: false,
        kernelInitializer: tf.initializers.varianceScaling({ seed: args.seed + 1 }),
      }),
    ],
  });
  head.compile({
    optimizer: tf.train.adam(args['learning-rate']),
    loss: 'categoricalCrossentropy',
    metrics: ['accuracy'],
  });

  let best = { valAcc: -1, valLoss: Number.POSITIVE_INFINITY, epoch: -1, weights: null };
  let stale = 0;
  console.log('\nTraining the classifier head...');
  // Background has the fewest photos; weighting keeps it from being drowned by
  // the two large classes while still letting the head see every example.
  const trainCounts = new Array(LABELS.length).fill(0);
  for (const entry of trainEntries) trainCounts[entry.label] += 1;
  const classWeight = Object.fromEntries(
    trainCounts.map((count, index) => [index, count > 0 ? trainEntries.length / (LABELS.length * count) : 1]),
  );
  await head.fit(trainX, trainY, {
    epochs: args.epochs,
    batchSize: args.batch,
    shuffle: true,
    classWeight,
    validationData: [valX, valY],
    callbacks: {
      onEpochEnd: async (epoch, logs) => {
        const valLoss = Number(logs.val_loss);
        const valAcc = Number(logs.val_acc);
        console.log(
          `  epoch ${String(epoch + 1).padStart(2)}  loss ${logs.loss.toFixed(4)}  acc ${(logs.acc * 100).toFixed(1)}%  val ${(valAcc * 100).toFixed(1)}%  val_loss ${valLoss.toFixed(4)}`,
        );
        const better = valAcc > best.valAcc || (valAcc === best.valAcc && valLoss < best.valLoss);
        if (better) {
          best = { valAcc, valLoss, epoch, weights: head.getWeights().map((weight) => weight.clone()) };
          stale = 0;
        } else {
          stale += 1;
          if (stale >= 20) {
            console.log(`  early stop: no better validation result after epoch ${best.epoch + 1}`);
            head.stopTraining = true;
          }
        }
      },
    },
  });
  if (best.weights) {
    head.setWeights(best.weights);
    best.weights.forEach((weight) => weight.dispose());
  }

  const logits = head.predict(valX);
  const predicted = Array.from(logits.argMax(1).dataSync());
  logits.dispose();
  const truth = valEntries.map((entry) => entry.label);
  const report = confusion(predicted, truth);
  console.log('\nValidation');
  console.log(`  accuracy ${(report.accuracy * 100).toFixed(1)}% (${report.correct}/${report.total})`);
  for (const row of report.perClass) {
    if (row.total === 0) continue;
    console.log(`    ${row.label.padEnd(10)} ${(row.accuracy * 100).toFixed(1).padStart(5)}%  (${row.correct}/${row.total})`);
  }
  console.log('  confusion (rows are the real class, columns the prediction)');
  console.log('              ' + LABELS.map((label) => label.slice(0, 9).padStart(10)).join(''));
  for (const label of LABELS) {
    const row = report.matrix[label];
    console.log(`    ${label.padEnd(10)}` + LABELS.map((other) => String(row[other]).padStart(10)).join(''));
  }
  const weakest = report.perClass
    .filter((row) => row.total > 0)
    .sort((a, b) => a.accuracy - b.accuracy)[0];
  if (weakest && weakest.accuracy < 0.8) {
    console.log(`\nwarning: ${weakest.label} is only ${(weakest.accuracy * 100).toFixed(1)}% on held-out photos.`);
    console.log('         Add more photos of that class, taken in the same place as the exhibition.');
  }

  const joint = tf.sequential();
  joint.add(base);
  joint.add(head);
  await joint.save(`file://${args.out}`);
  const saved = ['model.json', 'weights.bin'].filter((name) => fs.existsSync(path.join(args.out, name)));
  console.log(`\nSaved ${saved.join(', ')} to ${args.out}`);

  const metadata = {
    tfjsVersion: tf.version.tfjs,
    tmVersion: '2.4.4',
    packageVersion: '0.8.5',
    packageName: '@teachablemachine/image',
    timeStamp: new Date().toISOString(),
    userMetadata: {
      trainedBy: 'scripts/waste/train_waste_model.mjs',
      base: `mobilenet_${args.backbone}_${alphaString}_224_${args.pooling}`,
      validationAccuracy: report.accuracy,
      seed: args.seed,
    },
    modelName: 'waste',
    labels: LABELS,
    imageSize: IMAGE_SIZE,
  };
  fs.writeFileSync(path.join(args.out, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  const trainingReport = {
    trainedAt: metadata.timeStamp,
    data: args.data,
    alpha: args.alpha,
    seed: args.seed,
    epochs: args.epochs,
    augmentCopies: args.augment,
    denseUnits: args.dense,
    pooling: args.pooling,
    learningRate: args['learning-rate'],
    counts,
    validation: report,
    labels: LABELS,
    imageSize: IMAGE_SIZE,
  };
  fs.writeFileSync(path.join(args.out, 'training-report.json'), `${JSON.stringify(trainingReport, null, 2)}\n`);

  if (args.verify) {
    console.log('\nReloading the exported model to prove the files are complete...');
    const reloaded = await tf.loadLayersModel(`file://${path.join(args.out, 'model.json')}`);
    const expectedInput = [null, IMAGE_SIZE, IMAGE_SIZE, 3].join(',');
    const inputShape = reloaded.inputs[0].shape.join(',');
    const outputWidth = reloaded.outputs[0].shape[1];
    if (inputShape !== expectedInput || outputWidth !== LABELS.length) {
      throw new Error(`exported model has input ${inputShape} and output width ${outputWidth}`);
    }
    const sample = valEntries.slice(0, Math.min(8, valEntries.length));
    const sampleX = tf.tidy(() => tf.stack(sample.map((entry) => preprocess(tf, entry.file, rng, false))));
    const sampleOut = reloaded.predict(sampleX);
    const samplePred = Array.from(sampleOut.argMax(1).dataSync());
    sampleOut.dispose();
    sampleX.dispose();
    const sampleCorrect = samplePred.filter((value, index) => value === sample[index].label).length;
    console.log(`  reloaded OK: input ${inputShape}, ${outputWidth} classes, ${sampleCorrect}/${sample.length} sample photos still classified correctly`);
  }

  console.log(`\nBest epoch ${best.epoch + 1}: validation ${(best.valAcc * 100).toFixed(1)}%`);
  console.log('\nInstalled. Check it with:');
  console.log('  curl -s http://127.0.0.1:8010/api/v1/waste/model-status');
}

main().catch((error) => {
  console.error(`\ntrain_waste_model: ${error.message}`);
  process.exit(1);
});
