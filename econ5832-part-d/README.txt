Run this package on your independent computer for ECON5832 Part D.
Meeting: Happy Valley, November 25, 2026, Hong Kong time.

1. Install Node.js 24 and unpack the files in one directory.
2. Run npm install, then npx playwright install --with-deps chromium.
3. Run npm run probe. Verify Race 8, No. 11 maps to M021 if still active.
4. On Linux/macOS run PART_D_OUTPUT_DIR=results npm run collect.
   On Windows use PowerShell:
   $env:PART_D_BROWSER_CHANNEL='chromium'
   $env:PART_D_OUTPUT_DIR='results'
   npm run collect
5. Start by 17:45 HKT and keep the independent host awake and online until
   23:00. The program waits until five minutes before each scheduled post.
6. Return the entire results directory, including event logs, per-race JSON
   predictions, runner probabilities, and combined predictions.csv.
7. Use a persistent process supervisor or independent scheduler to restart
   on failure. Retain the results directory when restarting.

Confirm the live probe and host process, and state exactly where outputs
will persist. Only claim active collection once the independent process is
running. This package prepares local coursework outputs for the user.
