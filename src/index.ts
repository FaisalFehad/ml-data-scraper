import fs from "fs";
import path from "path";
import process from "process";
import readline from "readline";
import { chromium, Browser, BrowserContext, Locator, Page } from "playwright";

type MatchMode = "random" | "all";
type DetailMode = "panel" | "page" | "both";

type CaptureConfig = {
  id?: boolean;
  url?: boolean;
  title?: boolean;
  company?: boolean;
  location?: boolean;
  description?: boolean;
  applyUrl?: boolean;
  employmentType?: boolean;
  seniority?: boolean;
  workplaceType?: boolean;
  salary?: boolean;
  postedAt?: boolean;
  scrapedAt?: boolean;
  searchTitle?: boolean;
  searchLocation?: boolean;
};

type RawScraperConfig = {
  jobTitles: string[];
  location?: string | string[];
  locations?: string[];
  matchMode?: MatchMode;
  pairsPerLocation?: number;
  minJobsPerPair?: number;
  maxJobsPerPair?: number;
  maxJobsPerTitle?: number;
  maxTotalJobs?: number;
  capture?: CaptureConfig;
  exportCsv?: boolean;
  csvOutputFile?: string;
  stopOnBlocked?: boolean;
  stopOnNoData?: boolean;
  stopOnNoCards?: boolean;
  manualMode?: boolean;
  pageLoadRetries?: number;
  clickRetries?: number;
  detailMode?: DetailMode;
  requireFields?: (keyof JobRecord)[];
  minDescriptionLength?: number;
  stopOnMissingRequired?: boolean;
  autoRestart?: boolean;
  maxRestarts?: number;
  restartDelayMs?: number;
  csvDelimiter?: string;
  csvAlwaysQuote?: boolean;
  csvReplaceNewlines?: boolean;
  csvBom?: boolean;
  skipPairsWithExistingJobs?: boolean;
  headless?: boolean;
  slowMoMs?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  navigationTimeoutMs?: number;
  outputFile?: string;
  proxyServer?: string;
  userAgents?: string[];
};

type ResolvedConfig = {
  jobTitles: string[];
  locations: string[];
  matchMode: MatchMode;
  pairsPerLocation: number;
  minJobsPerPair: number;
  maxJobsPerPair: number;
  maxJobsPerTitle: number;
  maxTotalJobs: number;
  capture: Required<CaptureConfig>;
  exportCsv: boolean;
  csvOutputFile: string;
  stopOnBlocked: boolean;
  stopOnNoData: boolean;
  stopOnNoCards: boolean;
  manualMode: boolean;
  pageLoadRetries: number;
  clickRetries: number;
  detailMode: DetailMode;
  requireFields: (keyof JobRecord)[];
  minDescriptionLength: number;
  stopOnMissingRequired: boolean;
  autoRestart: boolean;
  maxRestarts: number;
  restartDelayMs: number;
  csvDelimiter: string;
  csvAlwaysQuote: boolean;
  csvReplaceNewlines: boolean;
  csvBom: boolean;
  skipPairsWithExistingJobs: boolean;
  headless: boolean;
  slowMoMs: number;
  minDelayMs: number;
  maxDelayMs: number;
  navigationTimeoutMs: number;
  outputFile: string;
  proxyServer: string;
  userAgents: string[];
};

type JobRecord = {
  id: string;
  url: string;
  title: string;
  company: string;
  location: string;
  description: string;
  applyUrl: string;
  employmentType: string;
  seniority: string;
  workplaceType: string;
  salary: string;
  postedAt: string;
  scrapedAt: string;
  searchTitle: string;
  searchLocation: string;
};

const PROJECT_ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(PROJECT_ROOT, "config.json");

const DEFAULT_USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5_2) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
];

const SELECTORS = {
  resultsList: "ul.jobs-search__results-list",
  card: "ul.jobs-search__results-list > li",
  cardLink: [
    "a.base-card__full-link",
    "a[data-tracking-control-name=public_jobs_jserp-result_search-card]"
  ],
  cardLinkFallback: ["a[href*=\"/jobs/view/\"]", "a[href*=\"linkedin.com/jobs/view\"]"],
  cardTitle: ["h3.base-search-card__title", "h3"],
  cardCompany: ["h4.base-search-card__subtitle", "h4"],
  cardLocation: [".job-search-card__location", "span"],
  showMoreButton: [
    "button.infinite-scroller__show-more-button",
    "button:has-text(\"See more jobs\")"
  ],
  detailDescription: [
    "div.show-more-less-html__markup",
    "div.description__text",
    "div.jobs-description__content"
  ],
  detailTitle: ["h2.top-card-layout__title", "h1"],
  detailCompany: [
    "a.topcard__org-name-link",
    "span.topcard__flavor",
    "span.top-card-layout__card" // fallback
  ],
  detailApplyLink: [
    "a.top-card-layout__cta",
    "a.topcard__link",
    "a[data-tracking-control-name=public_jobs_topcard-apply-button]"
  ],
  detailPostedAt: [
    "span.posted-time-ago__text",
    "time",
    "span.job-search-card__listdate"
  ],
  criteriaItem: [
    "li.job-criteria__item",
    "li.description__job-criteria-item",
    "li.jobs-unified-top-card__job-insight",
    "li.job-insight"
  ],
  criteriaLabel: [
    "h3",
    ".job-criteria__subheader",
    ".description__job-criteria-subheader",
    ".jobs-unified-top-card__job-insight-header"
  ],
  criteriaValue: [
    ".job-criteria__text",
    ".description__job-criteria-text",
    ".jobs-unified-top-card__job-insight-text",
    "span",
    "p"
  ]
};

function normalizeList(items: string[]): string[] {
  return items
    .map((item) => normalizeText(item))
    .filter((item) => item.length > 0);
}

function normalizeLocations(input?: string | string[]): string[] {
  if (!input) return [];
  if (Array.isArray(input)) return normalizeList(input);
  return normalizeList([input]);
}

function parseMatchMode(input?: MatchMode): MatchMode {
  return input === "all" ? "all" : "random";
}

function loadConfig(): ResolvedConfig {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(
      "Missing config.json. Copy config.example.json to config.json and update values."
    );
  }

  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  const parsed = JSON.parse(raw) as RawScraperConfig;

  if (!Array.isArray(parsed.jobTitles) || parsed.jobTitles.length === 0) {
    throw new Error("config.json must include a non-empty jobTitles array.");
  }
  const jobTitles = normalizeList(parsed.jobTitles);
  const locations = normalizeLocations(parsed.locations ?? parsed.location);

  if (jobTitles.length === 0) {
    throw new Error("config.json must include a non-empty jobTitles array.");
  }
  if (locations.length === 0) {
    throw new Error("config.json must include at least one location.");
  }

  const minJobsPerPair = Math.max(1, Math.floor(parsed.minJobsPerPair ?? 2));
  const maxJobsPerPair = Math.max(
    minJobsPerPair,
    Math.floor(parsed.maxJobsPerPair ?? 8)
  );
  const pairsPerLocation = Math.max(
    1,
    Math.floor(parsed.pairsPerLocation ?? 1)
  );
  const maxJobsPerTitle =
    parsed.maxJobsPerTitle == null
      ? Infinity
      : Math.max(1, Math.floor(parsed.maxJobsPerTitle));
  const exportCsv = parsed.exportCsv ?? Boolean(parsed.csvOutputFile);
  const csvOutputFile = parsed.csvOutputFile ?? "linkedin_jobs.csv";
  const manualMode = parsed.manualMode ?? false;
  const headless = manualMode ? false : parsed.headless ?? true;
  const pageLoadRetries = Math.max(1, Math.floor(parsed.pageLoadRetries ?? 3));
  const clickRetries = Math.max(1, Math.floor(parsed.clickRetries ?? 2));
  const detailMode: DetailMode =
    parsed.detailMode === "page" || parsed.detailMode === "panel"
      ? parsed.detailMode
      : "both";
  const requireFields = Array.isArray(parsed.requireFields)
    ? parsed.requireFields
    : ["description"];
  const minDescriptionLength = Math.max(
    0,
    Math.floor(parsed.minDescriptionLength ?? 200)
  );
  const stopOnMissingRequired = parsed.stopOnMissingRequired ?? false;
  const stopOnNoCards = parsed.stopOnNoCards ?? false;
  const autoRestart = parsed.autoRestart ?? false;
  const maxRestarts = Math.max(0, Math.floor(parsed.maxRestarts ?? 2));
  const restartDelayMs = Math.max(0, Math.floor(parsed.restartDelayMs ?? 30000));
  const csvDelimiter = parsed.csvDelimiter ?? ",";
  const csvAlwaysQuote = parsed.csvAlwaysQuote ?? true;
  const csvReplaceNewlines = parsed.csvReplaceNewlines ?? true;
  const csvBom = parsed.csvBom ?? false;
  const skipPairsWithExistingJobs = parsed.skipPairsWithExistingJobs ?? false;
  const defaultCapture: Required<CaptureConfig> = {
    id: true,
    url: true,
    title: true,
    company: true,
    location: true,
    description: true,
    applyUrl: true,
    employmentType: true,
    seniority: true,
    workplaceType: true,
    salary: true,
    postedAt: true,
    scrapedAt: true,
    searchTitle: true,
    searchLocation: true
  };
  const capture = { ...defaultCapture, ...(parsed.capture ?? {}) };

  return {
    jobTitles,
    locations,
    matchMode: parseMatchMode(parsed.matchMode),
    pairsPerLocation,
    minJobsPerPair,
    maxJobsPerPair,
    maxJobsPerTitle,
    maxTotalJobs: parsed.maxTotalJobs ?? Infinity,
    capture,
    exportCsv,
    csvOutputFile,
    stopOnBlocked: parsed.stopOnBlocked ?? true,
    stopOnNoData: parsed.stopOnNoData ?? true,
    stopOnNoCards,
    manualMode,
    pageLoadRetries,
    clickRetries,
    detailMode,
    requireFields,
    minDescriptionLength,
    stopOnMissingRequired,
    autoRestart,
    maxRestarts,
    restartDelayMs,
    csvDelimiter,
    csvAlwaysQuote,
    csvReplaceNewlines,
    csvBom,
    skipPairsWithExistingJobs,
    headless,
    slowMoMs: parsed.slowMoMs ?? 0,
    minDelayMs: parsed.minDelayMs ?? 800,
    maxDelayMs: parsed.maxDelayMs ?? 1800,
    navigationTimeoutMs: parsed.navigationTimeoutMs ?? 45000,
    outputFile: parsed.outputFile ?? "linkedin_jobs.jsonl",
    proxyServer: parsed.proxyServer ?? "",
    userAgents: parsed.userAgents?.length ? parsed.userAgents : DEFAULT_USER_AGENTS
  };
}

function buildSearchUrl(title: string, location: string): string {
  const params = new URLSearchParams({
    keywords: title,
    location
  });
  return `https://www.linkedin.com/jobs/search/?${params.toString()}`;
}

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInt(min: number, max: number): number {
  if (max <= min) return min;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDelay(minMs: number, maxMs: number): number {
  return randomInt(minMs, maxMs);
}

function shuffleInPlace<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function pickRandomSubset<T>(items: T[], count: number): T[] {
  if (count >= items.length) return shuffleInPlace([...items]);
  return shuffleInPlace([...items]).slice(0, count);
}

function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function normalizeText(input: string): string {
  const trimmed = normalizeWhitespace(input);
  if (!trimmed) return "";
  return trimmed
    .split(" ")
    .map((word) => {
      if (!word) return word;
      if (/\d/.test(word)) return word;
      if (/[a-z].*[A-Z]/.test(word) || /[A-Z].*[a-z].*[A-Z]/.test(word)) {
        return word;
      }
      if (/^[A-Z0-9&+./-]+$/.test(word) && word.length > 1) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

function normalizeLabel(input: string): string {
  return normalizeWhitespace(input.toLowerCase().replace(/[^a-z0-9]+/g, " "));
}

function titlesMatch(a: string, b: string): boolean {
  const left = normalizeLabel(a);
  const right = normalizeLabel(b);
  if (!left || !right) return false;
  if (left === right) return true;
  return left.includes(right) || right.includes(left);
}

function normalizeUrl(url: string): string {
  if (!url) return "";
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("/")) return `https://www.linkedin.com${url}`;
  return url;
}

function pairKey(title: string, location: string): string {
  return `${normalizeText(title)}||${normalizeText(location)}`.toLowerCase();
}

function needsDetailFetch(
  detail: Partial<JobRecord>,
  capture: Required<CaptureConfig>
): boolean {
  if (capture.description && !detail.description) return true;
  if (capture.postedAt && !detail.postedAt) return true;
  if (capture.applyUrl && !detail.applyUrl) return true;
  if (capture.employmentType && !detail.employmentType) return true;
  if (capture.seniority && !detail.seniority) return true;
  if (capture.workplaceType && !detail.workplaceType) return true;
  if (capture.salary && !detail.salary) return true;
  return false;
}

function validateRequiredFields(
  record: JobRecord,
  requireFields: (keyof JobRecord)[],
  minDescriptionLength: number
): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const field of requireFields) {
    const value = record[field];
    if (typeof value !== "string") continue;
    if (!value.trim()) {
      missing.push(field);
      continue;
    }
    if (field === "description" && value.trim().length < minDescriptionLength) {
      missing.push("description");
    }
  }
  return { ok: missing.length === 0, missing };
}

const LOCATOR_TIMEOUT_MS = 2000;

async function safeText(locator: Locator): Promise<string> {
  try {
    const text = await locator.textContent({ timeout: LOCATOR_TIMEOUT_MS });
    return text ? text.trim() : "";
  } catch {
    return "";
  }
}

async function safeAttr(locator: Locator, name: string): Promise<string> {
  try {
    const value = await locator.getAttribute(name, { timeout: LOCATOR_TIMEOUT_MS });
    return value ? value.trim() : "";
  } catch {
    return "";
  }
}

async function firstTextFromSelectors(
  root: Locator,
  selectors: string[]
): Promise<string> {
  for (const selector of selectors) {
    const candidate = root.locator(selector).first();
    if ((await candidate.count()) === 0) continue;
    const text = await safeText(candidate);
    if (text) return text;
  }
  return "";
}

async function firstAttrFromSelectors(
  root: Locator,
  selectors: string[],
  attrName: string
): Promise<string> {
  for (const selector of selectors) {
    const candidate = root.locator(selector).first();
    if ((await candidate.count()) === 0) continue;
    const value = await safeAttr(candidate, attrName);
    if (value) return value;
  }
  return "";
}

async function dismissCookieBanner(page: Page): Promise<void> {
  const selectors = [
    "button[action-type=ACCEPT]",
    "button:has-text(\"Accept cookies\")",
    "button:has-text(\"Accept all\")",
    "button:has-text(\"I Accept\")"
  ];

  for (const selector of selectors) {
    const button = page.locator(selector).first();
    try {
      if (await button.isVisible({ timeout: 1200 })) {
        await button.click({ timeout: 1200 });
        return;
      }
    } catch {
      // ignore
    }
  }
}

async function dismissSignInModal(page: Page): Promise<void> {
  const selectors = [
    "button:has-text(\"Dismiss\")",
    "button:has-text(\"Close\")",
    "button[aria-label=\"Dismiss\"]",
    "button[aria-label=\"Close\"]"
  ];

  for (const selector of selectors) {
    const button = page.locator(selector).first();
    try {
      if (await button.isVisible({ timeout: 1200 })) {
        await button.click({ timeout: 1200 });
        return;
      }
    } catch {
      // ignore
    }
  }
}

async function clickShowMoreIfVisible(page: Page): Promise<boolean> {
  for (const selector of SELECTORS.showMoreButton) {
    const button = page.locator(selector).first();
    try {
      if (await button.isVisible({ timeout: 1200 })) {
        await button.click({ timeout: 1200 });
        return true;
      }
    } catch {
      // ignore
    }
  }
  return false;
}

async function scrollResults(page: Page): Promise<void> {
  await page.evaluate(() => {
    const list = document.querySelector("ul.jobs-search__results-list");
    const target = list || document.scrollingElement || document.body;
    target.scrollTo({
      top: target.scrollHeight,
      behavior: "smooth"
    });
  });
}

async function detectBlock(page: Page): Promise<string | null> {
  const url = page.url().toLowerCase();
  if (url.includes("checkpoint") || url.includes("captcha") || url.includes("challenge")) {
    return `blocked url ${url}`;
  }

  const title = (await page.title().catch(() => "")).toLowerCase();
  if (
    title.includes("captcha") ||
    title.includes("verify") ||
    title.includes("blocked") ||
    title.includes("access denied")
  ) {
    return `blocked title ${title}`;
  }

  const indicators = [
    /captcha/i,
    /verify/i,
    /unusual activity/i,
    /access denied/i,
    /temporarily blocked/i,
    /are you a robot/i
  ];

  for (const pattern of indicators) {
    try {
      const hit = page.getByText(pattern).first();
      if ((await hit.count()) > 0) {
        return `blocked content ${pattern}`;
      }
    } catch {
      // ignore
    }
  }

  return null;
}

async function waitForEnter(message: string): Promise<void> {
  console.log(message);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  await new Promise<void>((resolve) => {
    rl.question("Press Enter to continue...", () => resolve());
  });
  rl.close();
}

async function gotoWithRetry(
  page: Page,
  url: string,
  attempts: number,
  minDelayMs: number,
  maxDelayMs: number
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      await sleep(randomDelay(minDelayMs, maxDelayMs) * attempt);
    }
  }
  throw lastError;
}

async function clickWithRetry(
  target: Locator,
  attempts: number,
  minDelayMs: number,
  maxDelayMs: number
): Promise<boolean> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await target.scrollIntoViewIfNeeded({ timeout: 3000 });
      await target.click({ timeout: 3000 });
      return true;
    } catch {
      if (attempt >= attempts) return false;
      await sleep(randomDelay(minDelayMs, maxDelayMs) * attempt);
    }
  }
  return false;
}

async function waitForDetailPanel(
  page: Page,
  expectedTitle: string,
  timeoutMs = 4000
): Promise<void> {
  const start = Date.now();
  let lastTitle = "";
  const expected = normalizeText(expectedTitle);

  while (Date.now() - start < timeoutMs) {
    const detailRoot = page.locator("body");
    const current = normalizeText(
      await firstTextFromSelectors(detailRoot, SELECTORS.detailTitle)
    );

    if (current && titlesMatch(current, expected)) return;
    if (current && current !== lastTitle && !expected) return;

    lastTitle = current;
    await sleep(200);
  }
}

async function ensureResultsLoaded(
  page: Page,
  minDelayMs: number,
  maxDelayMs: number
): Promise<number> {
  let cardCount = await page.locator(SELECTORS.card).count();
  if (cardCount > 0) return cardCount;

  await page.reload({ waitUntil: "domcontentloaded" });
  await dismissCookieBanner(page);
  await sleep(randomDelay(minDelayMs, maxDelayMs));

  cardCount = await page.locator(SELECTORS.card).count();
  return cardCount;
}

async function loadMoreJobs(
  page: Page,
  maxJobs: number,
  minDelayMs: number,
  maxDelayMs: number
): Promise<void> {
  let previousCount = 0;
  let stableRounds = 0;

  for (let i = 0; i < 40; i += 1) {
    const count = await page.locator(SELECTORS.card).count();
    if (count >= maxJobs) return;

    if (count === previousCount) {
      stableRounds += 1;
    } else {
      stableRounds = 0;
      previousCount = count;
    }

    if (stableRounds >= 3) return;

    await scrollResults(page);
    await clickShowMoreIfVisible(page);
    await sleep(randomDelay(minDelayMs, maxDelayMs));
  }
}

function extractJobId(url: string): string {
  const match = url.match(/jobs\/view\/(\d+)/);
  if (match && match[1]) return match[1];
  return url;
}

function recordKey(record: Partial<JobRecord>): string | null {
  if (record.id) return record.id;
  if (record.url) return extractJobId(record.url);
  return null;
}

async function extractCriteria(
  detailRoot: Locator
): Promise<Pick<JobRecord, "employmentType" | "seniority" | "workplaceType" | "salary">> {
  const criteria = {
    employmentType: "",
    seniority: "",
    workplaceType: "",
    salary: ""
  };

  const items = detailRoot.locator(SELECTORS.criteriaItem.join(","));
  const count = await items.count();
  for (let i = 0; i < count; i += 1) {
    const item = items.nth(i);
    const label = await firstTextFromSelectors(item, SELECTORS.criteriaLabel);
    if (!label) continue;
    let value = await firstTextFromSelectors(item, SELECTORS.criteriaValue);

    if (!value || value === label) {
      const fullText = normalizeWhitespace(await safeText(item));
      if (fullText.length > label.length) {
        value = fullText.replace(label, "").trim();
      }
    }

    const normalizedLabel = normalizeLabel(label);
    if (!value) continue;

    if (normalizedLabel.includes("employment type") || normalizedLabel.includes("job type")) {
      criteria.employmentType = value;
      continue;
    }
    if (normalizedLabel.includes("seniority")) {
      criteria.seniority = value;
      continue;
    }
    if (normalizedLabel.includes("workplace type") || normalizedLabel.includes("remote")) {
      criteria.workplaceType = value;
      continue;
    }
    if (
      normalizedLabel.includes("salary") ||
      normalizedLabel.includes("compensation") ||
      normalizedLabel.includes("pay")
    ) {
      criteria.salary = value;
    }
  }

  return criteria;
}

async function extractDetailFields(
  detailRoot: Locator,
  capture: Required<CaptureConfig>
): Promise<
  Pick<
    JobRecord,
    | "description"
    | "postedAt"
    | "applyUrl"
    | "employmentType"
    | "seniority"
    | "workplaceType"
    | "salary"
    | "title"
    | "company"
  >
> {
  const result = {
    description: "",
    postedAt: "",
    applyUrl: "",
    employmentType: "",
    seniority: "",
    workplaceType: "",
    salary: "",
    title: "",
    company: ""
  };

  result.title = await firstTextFromSelectors(detailRoot, SELECTORS.detailTitle);
  result.company = await firstTextFromSelectors(
    detailRoot,
    SELECTORS.detailCompany
  );

  if (capture.description) {
    result.description = await firstTextFromSelectors(
      detailRoot,
      SELECTORS.detailDescription
    );
  }
  if (capture.postedAt) {
    result.postedAt = await firstTextFromSelectors(
      detailRoot,
      SELECTORS.detailPostedAt
    );
  }
  if (capture.applyUrl) {
    result.applyUrl = normalizeUrl(
      await firstAttrFromSelectors(detailRoot, SELECTORS.detailApplyLink, "href")
    );
  }
  if (
    capture.employmentType ||
    capture.seniority ||
    capture.workplaceType ||
    capture.salary
  ) {
    const criteria = await extractCriteria(detailRoot);
    result.employmentType = criteria.employmentType;
    result.seniority = criteria.seniority;
    result.workplaceType = criteria.workplaceType;
    result.salary = criteria.salary;
  }

  return result;
}

async function extractJobDetails(
  page: Page,
  card: Locator,
  searchTitle: string,
  searchLocation: string,
  minDelayMs: number,
  maxDelayMs: number,
  capture: Required<CaptureConfig>,
  clickRetries: number,
  context: BrowserContext,
  config: ResolvedConfig
): Promise<JobRecord | null> {
  try {
    const title = await firstTextFromSelectors(card, SELECTORS.cardTitle);
    const company = await firstTextFromSelectors(card, SELECTORS.cardCompany);
    const location = await firstTextFromSelectors(card, SELECTORS.cardLocation);

    const primaryLink = await firstAttrFromSelectors(
      card,
      SELECTORS.cardLink,
      "href"
    );
    const fallbackLink = primaryLink
      ? ""
      : await firstAttrFromSelectors(card, SELECTORS.cardLinkFallback, "href");
    const link = primaryLink || fallbackLink;
    const url = link ? normalizeUrl(link.split("?")[0]) : "";
    const id = url ? extractJobId(url) : "";

    if (!url || !title) return null;

    let detailTitle = "";
    let detailCompany = "";
    let description = "";
    let postedAt = "";
    let applyUrl = "";
    let employmentType = "";
    let seniority = "";
    let workplaceType = "";
    let salary = "";

    try {
      const needsDetail =
        capture.description ||
        capture.postedAt ||
        capture.applyUrl ||
        capture.employmentType ||
        capture.seniority ||
        capture.workplaceType ||
        capture.salary ||
        ((capture.title || capture.company) && (!title || !company));

      if (needsDetail && (config.detailMode === "panel" || config.detailMode === "both")) {
        const clicked = await clickWithRetry(card, clickRetries, minDelayMs, maxDelayMs);
        if (!clicked) {
          throw new Error("Card click failed");
        }
        await sleep(randomDelay(minDelayMs, maxDelayMs));
        await dismissSignInModal(page);
        await waitForDetailPanel(page, title);

        const detailRoot = page.locator("body");
        const panelDetails = await extractDetailFields(detailRoot, capture);
        detailTitle = panelDetails.title;
        detailCompany = panelDetails.company;
        description = panelDetails.description;
        postedAt = panelDetails.postedAt;
        applyUrl = panelDetails.applyUrl;
        employmentType = panelDetails.employmentType;
        seniority = panelDetails.seniority;
        workplaceType = panelDetails.workplaceType;
        salary = panelDetails.salary;
      }
    } catch {
      // fall back to card-only data
    }

    if (
      needsDetailFetch(
        {
          description,
          postedAt,
          applyUrl,
          employmentType,
          seniority,
          workplaceType,
          salary
        },
        capture
      ) &&
      (config.detailMode === "page" || config.detailMode === "both")
    ) {
      let detailPage: Page | null = null;
      try {
        detailPage = await context.newPage();
        detailPage.setDefaultNavigationTimeout(config.navigationTimeoutMs);
        await gotoWithRetry(
          detailPage,
          url,
          config.pageLoadRetries,
          minDelayMs,
          maxDelayMs
        );

        let blockedReason = await detectBlock(detailPage);
        if (blockedReason && config.manualMode) {
          console.warn(
            `Block detected on detail page for ${title}. Manual mode enabled.`
          );
          await waitForEnter(
            "Please solve the captcha or unblock in the open browser window."
          );
          blockedReason = await detectBlock(detailPage);
        }

        if (!blockedReason) {
          const detailRoot = detailPage.locator("body");
          const pageDetails = await extractDetailFields(detailRoot, capture);
          detailTitle = detailTitle || pageDetails.title;
          detailCompany = detailCompany || pageDetails.company;
          description = description || pageDetails.description;
          postedAt = postedAt || pageDetails.postedAt;
          applyUrl = applyUrl || pageDetails.applyUrl;
          employmentType = employmentType || pageDetails.employmentType;
          seniority = seniority || pageDetails.seniority;
          workplaceType = workplaceType || pageDetails.workplaceType;
          salary = salary || pageDetails.salary;
        }
      } catch {
        // ignore detail page errors
      } finally {
        if (detailPage) {
          try {
            await detailPage.close();
          } catch {
            // ignore
          }
        }
      }
    }

    const normalizedTitle = normalizeText(detailTitle || title);
    const normalizedLocation = normalizeText(location || searchLocation);

    return {
      id: id || url,
      url,
      title: normalizedTitle || detailTitle || title,
      company: detailCompany || company,
      location: normalizedLocation || location || searchLocation,
      description,
      applyUrl,
      employmentType,
      seniority,
      workplaceType,
      salary,
      postedAt,
      scrapedAt: new Date().toISOString(),
      searchTitle: normalizeText(searchTitle),
      searchLocation: normalizeText(searchLocation)
    };
  } catch {
    return null;
  }
}

type SearchPair = {
  title: string;
  location: string;
};

function buildSearchPairs(config: ResolvedConfig): SearchPair[] {
  const pairs: SearchPair[] = [];

  if (config.matchMode === "all") {
    for (const location of config.locations) {
      for (const title of config.jobTitles) {
        pairs.push({ title, location });
      }
    }
    return shuffleInPlace(pairs);
  }

  for (const location of config.locations) {
    const picks = pickRandomSubset(
      config.jobTitles,
      Math.min(config.pairsPerLocation, config.jobTitles.length)
    );
    for (const title of picks) {
      pairs.push({ title, location });
    }
  }

  return shuffleInPlace(pairs);
}

async function loadExistingState(
  filePath: string
): Promise<{ ids: Set<string>; pairs: Set<string> }> {
  const existing = new Set<string>();
  const pairs = new Set<string>();
  if (!fs.existsSync(filePath)) return { ids: existing, pairs };

  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const record = JSON.parse(trimmed) as Partial<JobRecord>;
      const key = recordKey(record);
      if (key) {
        existing.add(key);
      }
      const title =
        (record.searchTitle as string | undefined) ||
        (record.title as string | undefined) ||
        "";
      const location =
        (record.searchLocation as string | undefined) ||
        (record.location as string | undefined) ||
        "";
      if (title && location) {
        pairs.add(pairKey(title, location));
      }
    } catch {
      // ignore malformed lines
    }
  }

  return { ids: existing, pairs };
}

function buildOutputRecord(
  record: JobRecord,
  capture: Required<CaptureConfig>
): Partial<JobRecord> {
  const output: Partial<JobRecord> = {};
  if (capture.id) output.id = record.id;
  if (capture.url) output.url = record.url;
  if (capture.title) output.title = record.title;
  if (capture.company) output.company = record.company;
  if (capture.location) output.location = record.location;
  if (capture.description) output.description = record.description;
  if (capture.applyUrl) output.applyUrl = record.applyUrl;
  if (capture.employmentType) output.employmentType = record.employmentType;
  if (capture.seniority) output.seniority = record.seniority;
  if (capture.workplaceType) output.workplaceType = record.workplaceType;
  if (capture.salary) output.salary = record.salary;
  if (capture.postedAt) output.postedAt = record.postedAt;
  if (capture.scrapedAt) output.scrapedAt = record.scrapedAt;
  if (capture.searchTitle) output.searchTitle = record.searchTitle;
  if (capture.searchLocation) output.searchLocation = record.searchLocation;
  return output;
}

function captureFieldOrder(capture: Required<CaptureConfig>): (keyof JobRecord)[] {
  const ordered: (keyof JobRecord)[] = [
    "id",
    "url",
    "title",
    "company",
    "location",
    "description",
    "applyUrl",
    "employmentType",
    "seniority",
    "workplaceType",
    "salary",
    "postedAt",
    "scrapedAt",
    "searchTitle",
    "searchLocation"
  ];
  return ordered.filter((field) => capture[field]);
}

function escapeCsv(
  value: unknown,
  delimiter: string,
  alwaysQuote: boolean,
  replaceNewlines: boolean
): string {
  let raw = value == null ? "" : String(value);
  if (replaceNewlines) {
    raw = raw.replace(/\r\n|\n|\r/g, " ");
  }
  const needsQuotes =
    alwaysQuote || raw.includes("\"") || raw.includes("\n") || raw.includes("\r") || raw.includes(delimiter);
  const escaped = raw.replace(/"/g, "\"\"");
  if (!needsQuotes) return escaped;
  return `"${escaped}"`;
}

async function exportJsonlToCsv(
  jsonlPath: string,
  csvPath: string,
  fields: (keyof JobRecord)[],
  delimiter: string,
  alwaysQuote: boolean,
  replaceNewlines: boolean,
  includeBom: boolean
): Promise<void> {
  const outStream = fs.createWriteStream(csvPath, { flags: "w" });
  if (includeBom) {
    outStream.write("\uFEFF");
  }
  outStream.write(`${fields.join(delimiter)}\n`);

  if (!fs.existsSync(jsonlPath)) {
    outStream.end();
    return;
  }

  const stream = fs.createReadStream(jsonlPath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const record = JSON.parse(trimmed) as Partial<JobRecord>;
      const row = fields
        .map((field) =>
          escapeCsv(record[field], delimiter, alwaysQuote, replaceNewlines)
        )
        .join(delimiter);
      outStream.write(`${row}\n`);
    } catch {
      // ignore malformed lines
    }
  }

  outStream.end();
}

async function runOnce(config: ResolvedConfig): Promise<void> {
  const outputPath = path.resolve(PROJECT_ROOT, config.outputFile);
  const existingState = await loadExistingState(outputPath);
  const outStream = fs.createWriteStream(outputPath, { flags: "a" });
  let browser: Browser | null = null;
  let totalJobs = 0;

  const summary = {
    pairsPlanned: 0,
    pairsProcessed: 0,
    pairsSaved: 0,
    pairsSkipped: 0,
    pairsBlocked: 0,
    pairsFailed: 0,
    jobsSaved: 0,
    jobsSkippedMissingRequired: 0
  };

  let pairs = buildSearchPairs(config);
  if (config.skipPairsWithExistingJobs) {
    pairs = pairs.filter(
      (pair) => !existingState.pairs.has(pairKey(pair.title, pair.location))
    );
  }
  summary.pairsPlanned = pairs.length;

  let runError: unknown = null;

  try {
    browser = await chromium.launch({
      headless: config.headless,
      slowMo: config.slowMoMs,
      proxy: config.proxyServer ? { server: config.proxyServer } : undefined
    });

    const seen = existingState.ids;
    const titleCounts = new Map<string, number>();

    for (const pair of pairs) {
      if (totalJobs >= config.maxTotalJobs) break;
      summary.pairsProcessed += 1;

      let context: BrowserContext | null = null;
      let page: Page | null = null;
      let savedForPair = 0;
      let extractedForPair = 0;
      let pairBlocked = false;
      let pairSkipped = false;
      let pairFailed = false;

      try {
        const remainingGlobal = config.maxTotalJobs - totalJobs;
        const titleKey = normalizeText(pair.title);
        const remainingTitle = Number.isFinite(config.maxJobsPerTitle)
          ? Math.max(0, config.maxJobsPerTitle - (titleCounts.get(titleKey) ?? 0))
          : Infinity;

        if (remainingTitle <= 0) {
          console.warn(
            `Skipping ${pair.title} in ${pair.location} because maxJobsPerTitle is reached.`
          );
          pairSkipped = true;
          continue;
        }

        const targetJobs = Math.min(
          randomInt(config.minJobsPerPair, config.maxJobsPerPair),
          remainingGlobal,
          remainingTitle
        );

        if (targetJobs <= 0) {
          pairSkipped = true;
          continue;
        }

        context = await browser.newContext({
          userAgent: pickRandom(config.userAgents),
          viewport: { width: 1280, height: 800 }
        });
        if (!context) {
          throw new Error("Failed to create browser context.");
        }
        page = await context.newPage();
        page.setDefaultNavigationTimeout(config.navigationTimeoutMs);

        const url = buildSearchUrl(pair.title, pair.location);
        console.log(
          `Searching: ${pair.title} in ${pair.location} (target ${targetJobs} jobs)`
        );

        await gotoWithRetry(
          page,
          url,
          config.pageLoadRetries,
          config.minDelayMs,
          config.maxDelayMs
        );
        await dismissCookieBanner(page);
        await sleep(randomDelay(config.minDelayMs, config.maxDelayMs));

        let blockedReason = await detectBlock(page);
        if (blockedReason && config.manualMode) {
          console.warn(
            `Block detected for ${pair.title} in ${pair.location}. Manual mode enabled.`
          );
          await waitForEnter(
            "Please solve the captcha or unblock in the open browser window."
          );
          blockedReason = await detectBlock(page);
        }

        if (blockedReason) {
          pairBlocked = true;
          if (config.stopOnBlocked) {
            throw new Error(
              `Blocked detected for ${pair.title} in ${pair.location}: ${blockedReason}`
            );
          }
          console.warn(
            `Skipping ${pair.title} in ${pair.location} due to block: ${blockedReason}`
          );
          pairSkipped = true;
          continue;
        }

        const initialCount = await ensureResultsLoaded(
          page,
          config.minDelayMs,
          config.maxDelayMs
        );

        if (initialCount === 0) {
          const retryReason = await detectBlock(page);
          const reason = retryReason
            ? `Blocked detected: ${retryReason}`
            : "No job cards found";
          if (config.stopOnNoCards) {
            throw new Error(
              `Stopping because no job cards were found for ${pair.title} in ${pair.location}. ${reason}`
            );
          }
          console.warn(
            `Skipping ${pair.title} in ${pair.location} because no job cards were found. ${reason}`
          );
          pairSkipped = true;
          continue;
        }

        await loadMoreJobs(
          page,
          targetJobs,
          config.minDelayMs,
          config.maxDelayMs
        );

        const cards = page.locator(SELECTORS.card);
        const cardCount = await cards.count();
        console.log(
          `Found ${cardCount} cards for ${pair.title} in ${pair.location}.`
        );

        for (let i = 0; i < cardCount; i += 1) {
          if (totalJobs >= config.maxTotalJobs) break;
          if (savedForPair >= targetJobs) break;

          const card = cards.nth(i);
          const job = await extractJobDetails(
            page,
            card,
            pair.title,
            pair.location,
            config.minDelayMs,
            config.maxDelayMs,
            config.capture,
            config.clickRetries,
            context,
            config
          );

          if (!job) continue;
          extractedForPair += 1;
          if (seen.has(job.id)) continue;

          const validation = validateRequiredFields(
            job,
            config.requireFields,
            config.minDescriptionLength
          );
          if (!validation.ok) {
            summary.jobsSkippedMissingRequired += 1;
            const message = `Missing required fields [${validation.missing.join(
              ", "
            )}] for ${job.title} @ ${job.company}`;
            if (config.stopOnMissingRequired) {
              throw new Error(message);
            }
            console.warn(message);
            continue;
          }

          seen.add(job.id);
          totalJobs += 1;
          savedForPair += 1;
          titleCounts.set(titleKey, (titleCounts.get(titleKey) ?? 0) + 1);
          const output = buildOutputRecord(job, config.capture);
          outStream.write(`${JSON.stringify(output)}\n`);
          console.log(`Saved: ${job.title} @ ${job.company}`);

          await sleep(randomDelay(config.minDelayMs, config.maxDelayMs));
        }

        if (savedForPair === 0 && extractedForPair === 0 && config.stopOnNoData) {
          throw new Error(
            `Stopping because no jobs could be extracted for ${pair.title} in ${pair.location}.`
          );
        }
      } catch (error) {
        pairFailed = true;
        const message =
          error instanceof Error ? error.message : String(error);
        const isBlocked = message.toLowerCase().includes("blocked detected");
        const lowerMessage = message.toLowerCase();
        const isNoData =
          lowerMessage.includes("job data did not load") ||
          lowerMessage.includes("no jobs could be saved") ||
          lowerMessage.includes("no jobs could be extracted");
        const isNoCards = lowerMessage.includes("no job cards were found");
        const isMissingRequired = message
          .toLowerCase()
          .includes("missing required fields");

        if (
          (isBlocked && config.stopOnBlocked) ||
          (isNoData && config.stopOnNoData) ||
          (isNoCards && config.stopOnNoCards) ||
          (isMissingRequired && config.stopOnMissingRequired)
        ) {
          throw error;
        }

        console.warn(
          `Pair failed for ${pair.title} in ${pair.location}: ${message}`
        );
      } finally {
        if (page) {
          try {
            await page.close();
          } catch {
            // ignore
          }
        }
        if (context) {
          try {
            await context.close();
          } catch {
            // ignore
          }
        }
        if (pairBlocked) summary.pairsBlocked += 1;
        if (pairSkipped) summary.pairsSkipped += 1;
        if (pairFailed) summary.pairsFailed += 1;
        if (savedForPair > 0) summary.pairsSaved += 1;
        summary.jobsSaved = totalJobs;
      }
    }
  } catch (error) {
    runError = error;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // ignore
      }
    }
    await new Promise<void>((resolve) => {
      outStream.end(() => resolve());
    });
  }

  if (config.exportCsv) {
    const csvPath = path.resolve(PROJECT_ROOT, config.csvOutputFile);
    const fields = captureFieldOrder(config.capture);
    await exportJsonlToCsv(
      outputPath,
      csvPath,
      fields,
      config.csvDelimiter,
      config.csvAlwaysQuote,
      config.csvReplaceNewlines,
      config.csvBom
    );
    console.log(`CSV saved to ${csvPath}`);
  }

  console.log("Summary:");
  console.log(`Pairs planned: ${summary.pairsPlanned}`);
  console.log(`Pairs processed: ${summary.pairsProcessed}`);
  console.log(`Pairs with saved jobs: ${summary.pairsSaved}`);
  console.log(`Pairs skipped: ${summary.pairsSkipped}`);
  console.log(`Pairs blocked: ${summary.pairsBlocked}`);
  console.log(`Pairs failed: ${summary.pairsFailed}`);
  console.log(`Jobs skipped (missing required): ${summary.jobsSkippedMissingRequired}`);
  console.log(`Jobs saved: ${summary.jobsSaved}`);
  console.log(`Output JSONL: ${outputPath}`);
  if (runError) {
    const message =
      runError instanceof Error ? runError.message : String(runError);
    console.log(`Run aborted: ${message}`);
    throw runError;
  }

  console.log(`Done. Saved ${totalJobs} jobs to ${outputPath}`);
}

async function runWithRestart(): Promise<void> {
  let attempts = 0;

  while (true) {
    const config = loadConfig();
    try {
      if (config.autoRestart) {
        console.log(`Starting run (attempt ${attempts + 1}/${config.maxRestarts + 1})...`);
      } else {
        console.log("Starting run...");
      }
      await runOnce(config);
      return;
    } catch (error) {
      attempts += 1;
      if (!config.autoRestart || attempts > config.maxRestarts) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `Run failed (attempt ${attempts}/${config.maxRestarts}). Restarting in ${config.restartDelayMs}ms. Reason: ${message}`
      );
      await sleep(config.restartDelayMs);
    }
  }
}

runWithRestart().catch((error) => {
  console.error("Scraper failed:", error);
  process.exitCode = 1;
});
