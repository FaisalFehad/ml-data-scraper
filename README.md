# linkedinScraper

Simple TypeScript LinkedIn job scraper that saves job data to a JSONL file.

## Setup
1. `npm install`
2. `npx playwright install`
3. Copy `config.example.json` to `config.json` and update values.

## Run
`npm run start`

Output: a JSONL file in the project root (default `linkedin_jobs.jsonl`). Each line is one job record. Runs append to the file and skip previously saved job IDs.

## Config highlights
- `jobTitles`: array of job titles to search.
- `locations`: array of locations to search (you can also keep `location` as a single string or string array for backward compatibility).
- `matchMode`: `random` (default) pairs titles and locations randomly; `all` uses every title-location combination.
- `pairsPerLocation`: how many random titles to pick for each location when `matchMode` is `random`.
- `minJobsPerPair` / `maxJobsPerPair`: random range of jobs to save per title-location pair.
- `maxJobsPerTitle`: cap for total jobs saved per title across all locations.
- `maxTotalJobs`: global cap across all pairs.
- `capture`: choose which fields to write to JSONL. For best dedupe across runs, keep `id` or `url` enabled. Optional fields include `applyUrl`, `employmentType`, `seniority`, `workplaceType`, and `salary` when available.
- `exportCsv` / `csvOutputFile`: optionally write a CSV copy after the run completes.
- `stopOnBlocked`: stop immediately if a block/captcha page is detected.
- `stopOnNoData`: stop if job cards load but no jobs can be saved (prevents bad/empty data).
- `stopOnNoCards`: stop if zero job cards are found for a pair (default `false`).
- `manualMode`: force headful mode and pause when a block/captcha is detected so you can solve it (overrides `headless`).
- `pageLoadRetries` / `clickRetries`: retry/backoff for page loads and card clicks.
- `detailMode`: `panel`, `page`, or `both` (default). `both` tries the list panel first, then falls back to the job page if fields are missing.
- `requireFields`: list of fields that must be non-empty before a job is saved (default `["description"]`).
- `minDescriptionLength`: minimum description length when `description` is required.
- `stopOnMissingRequired`: stop the run if required fields are missing; otherwise skip those jobs.
- `autoRestart`: automatically restart after a failure.
- `maxRestarts`: max restart attempts before giving up.
- `restartDelayMs`: wait time between restart attempts.
- `csvDelimiter`: delimiter to use in CSV output (default `,`).
- `csvAlwaysQuote`: always quote CSV fields (default `true`).
- `csvReplaceNewlines`: replace newlines with spaces in CSV fields (default `true`).
- `csvBom`: write UTF-8 BOM for Excel compatibility (default `false`).
- `skipPairsWithExistingJobs`: skip title/location pairs already present in the existing JSONL file (reduces repeats across runs).

## Notes
- This scraper targets publicly visible LinkedIn job search pages. Some fields can be missing or truncated when not signed in.
- It uses polite scraping tactics (random delays, optional headful mode, optional proxy) to reduce detection risk, but detection and blocking are still possible.
- Make sure your usage complies with LinkedIn’s terms and local laws. Refer to [LinkedIn](https://www.linkedin.com) for details.
