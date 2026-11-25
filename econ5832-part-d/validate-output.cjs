const fs = require('node:fs');
const path = require('node:path');
const race = Number(process.argv[2]);
const root = process.env.PART_D_OUTPUT_DIR || 'results';
const file = path.join(root, 'part-d-race-' + race + '-prediction.json');
const prediction = JSON.parse(fs.readFileSync(file, 'utf8'));
const total = prediction.runners.reduce((sum, runner) => sum + runner.probability, 0);
if (prediction.race !== race || !prediction.runners.length ||
    Math.abs(total - 1) > 1e-9 ||
    !prediction.runners.every(r => /^[A-Z]\d{3}$/.test(r.horse_id) && r.probability > 0) ||
    !(Date.parse(prediction.capturedAt) < Date.parse(prediction.scheduledPost))) {
  throw Error('Prediction output failed validation');
}
console.log(JSON.stringify({ race, capturedAt: prediction.capturedAt,
  winner: prediction.winner_number, brand: prediction.winner_horse_id, validated: true }));
