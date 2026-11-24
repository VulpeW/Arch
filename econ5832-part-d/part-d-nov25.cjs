const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');
const { chromium } = require('playwright');
const folder = process.env.PART_D_OUTPUT_DIR || __dirname;
fs.mkdirSync(folder, { recursive: true });
const model = JSON.parse(fs.readFileSync(path.join(__dirname, 'odds-only-model.json')));
const roster = JSON.parse(fs.readFileSync(path.join(__dirname, 'happy-valley-2026-11-25-part-d-roster.json')));
const posts = ['18:40','19:10','19:40','20:10','20:40','21:10','21:45','22:15','22:50'];
const logPath = path.join(folder, 'part-d-2026-11-25-events.jsonl');
const probe = process.argv.includes('--probe');
const raceArgument = process.argv.indexOf('--race');
const selectedRace = raceArgument < 0 ? null : Number(process.argv[raceArgument + 1]);
if (selectedRace !== null && (!Number.isInteger(selectedRace) || selectedRace < 1 || selectedRace > 9)) {
  throw Error('--race requires an integer from 1 to 9');
}
function log(event) {
  fs.appendFileSync(logPath, JSON.stringify({ observedAt: new Date().toISOString(), ...event }) + '\n');
}
function saved(race) {
  return fs.existsSync(path.join(folder, 'part-d-race-' + race + '-prediction.json'));
}
async function readOdds(page, race) {
  await page.goto('https://racing.hkjc.com/en-us/local/information/racecard?Racecourse=HV&racedate=2026%2F11%2F25&RaceNo=' + race,
    { waitUntil: 'domcontentloaded', timeout: 25000 });
  const refreshed = await page.evaluate(() => {
    const text = document.body.innerText;
    const runners = Array.from(document.querySelectorAll('tr')).map(row => {
      const cells = Array.from(row.children).filter(cell => cell.tagName === 'TD')
        .map(cell => cell.innerText.trim());
      if (cells.length < 10 || !/^\d+$/.test(cells[0]) || !/^[A-Z]\d{3}$/.test(cells[4])) return null;
      return { runner_number: Number(cells[0]), horse_name: cells[3],
        horse_id: cells[4], handicap_weight_lb: Number(cells[5]), jockey: cells[6] };
    }).filter(Boolean);
    return { text, runners };
  });
  if (!refreshed.text.includes('November 25, 2026') || !refreshed.text.includes('Happy Valley') ||
      !refreshed.text.includes('Race ' + race + ' -') || refreshed.runners.length < 4 ||
      new Set(refreshed.runners.map(r => r.runner_number)).size !== refreshed.runners.length) {
    throw Error('Latest official racecard could not be verified');
  }
  log({ kind: 'roster_verified', race, runners: refreshed.runners });
  await page.goto('https://bet.hkjc.com/en/racing/wp/2026-11-25/HV/' + race,
    { waitUntil: 'commit', timeout: 20000 });
  await page.waitForFunction(() => document.querySelector('[id^="odds_WIN_"]')?.textContent.trim(),
    null, { timeout: 30000 });
  const data = await page.evaluate(() => ({
    text: document.body.innerText,
    horses: Array.from(document.querySelectorAll('tr.rc-odds-row')).map(row => {
      const read = prefix => row.querySelector('[id^="' + prefix + '"]')?.textContent.trim() ?? '';
      return { number: read('runnerNo_'), horse: read('horseName_'), win: read('odds_WIN_'), place: read('odds_PLA_') };
    }).filter(h => /^\d+$/.test(h.number)),
  }));
  if (!data.text.includes('25/11/2026,') || !data.text.includes('Happy Valley') ||
      !data.text.split('\n').some(line => line.trim() === 'Race ' + race)) throw Error('Wrong meeting/race');
  const update = data.text.match(/Last Update:[ \t]*(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})/);
  if (!update) throw Error('Missing feed update timestamp');
  const sourceTime = Date.parse(update[3] + '-' + update[2] + '-' + update[1] + 'T' + update[4] + ':' + update[5] + ':00+08:00');
  if (!probe && (Date.now() - sourceTime > 180000 || sourceTime - Date.now() > 60000)) {
    throw Error('Feed timestamp is stale or in the future');
  }
  const expected = refreshed.runners;
  const runners = data.horses.filter(h => h.win !== 'SCR').map(h => {
    const identity = expected.find(e => e.runner_number === Number(h.number) &&
      e.horse_name.replaceAll('’', "'") === h.horse.replaceAll('’', "'"));
    if (!identity || !/^\d+(\.\d+)?$/.test(h.win) || Number(h.win) <= 0) throw Error('Unverified runner or price');
    return { ...h, horse_id: identity.horse_id };
  });
  if (data.horses.length !== expected.length || !runners.length) throw Error('Incomplete field');
  const weights = runners.map(h => Math.pow(Number(h.win), -model.beta));
  const total = weights.reduce((a,b) => a+b, 0);
  runners.forEach((h,i) => { h.probability = weights[i] / total; });
  runners.sort((a,b) => b.probability-a.probability || Number(a.number)-Number(b.number));
  return { kind: 'prediction', race, capturedAt: new Date().toISOString(),
    model_beta: model.beta, run_host: process.env.GITHUB_RUN_ID ? 'github-actions' : process.platform,
    displayedUpdate: data.text.match(/Last Update:[ \t]*([^\n]+)/)?.[1],
    winner_number: runners[0].number, winner_horse_id: runners[0].horse_id,
    bet_numbers: [runners[0].number], runners };
}
function savePrediction(prediction, post) {
  if (Date.now() >= post) throw Error('Scheduled post reached before saving prediction');
  const target = path.join(folder, 'part-d-race-' + prediction.race + '-prediction.json');
  const temporary = target + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify({ ...prediction, scheduledPost: new Date(post).toISOString() }, null, 2));
  fs.renameSync(temporary, target);
  log({ kind: 'prediction_saved', race: prediction.race, file: target });
  const records = [];
  for (let race = 1; race <= 9; race++) {
    const file = path.join(folder, 'part-d-race-' + race + '-prediction.json');
    if (fs.existsSync(file)) records.push(JSON.parse(fs.readFileSync(file, 'utf8')));
  }
  const summary = ['race,captured_at_utc,winner_runner_number,winner_brand_number,simulated_bet_numbers',
    ...records.map(r => [r.race,r.capturedAt,r.winner_number,r.winner_horse_id,r.bet_numbers.join('|')].join(','))];
  fs.writeFileSync(path.join(folder, 'part-d-2026-11-25-predictions.csv'), summary.join('\n') + '\n');
}
async function run() {
  for (let race = 1; race <= 9; race++) {
    if (selectedRace !== null && race !== selectedRace) continue;
    const post = Date.parse('2026-11-25T' + posts[race-1] + ':00+08:00');
    if (!probe && (saved(race) || Date.now() >= post)) continue;
    if (!probe) while (Date.now() < post - 300000) await sleep(Math.min(30000, post-300000-Date.now()));
    let done = false;
    do {
      let browser;
      try {
        const channel = process.env.PART_D_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : null);
        browser = await chromium.launch(channel ? { channel } : {});
        const page = await browser.newPage({ timezoneId: 'Asia/Hong_Kong', locale: 'en-GB' });
        const prediction = await readOdds(page, race);
        log(prediction);
        if (probe) { console.log(JSON.stringify(prediction)); return; }
        if (Date.now() - Date.parse(prediction.capturedAt) > 60000) throw Error('Observation too old');
        savePrediction(prediction, post);
        done = true;
      } catch (error) {
        log({ kind: 'error', race, message: error.message });
        if (probe) throw error;
        await sleep(10000);
      } finally { await browser?.close().catch(() => {}); }
    } while (!done && Date.now() < post - 15000);
    if (!done) {
      log({ kind: 'missed_prediction', race });
      process.exitCode = 1;
    }
  }
  log({ kind: 'run_complete' });
}
run().catch(error => { log({ kind: 'fatal', message: error.message }); process.exitCode = 1; });

