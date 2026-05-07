# Maersk Rate Scraper — Replit Build Guide
**Oneport 365 · May 2026 · v1.0**

Build a Playwright scraper that logs into maersk.com, navigates to the Instant Price page, fills in a route and date, extracts the rate breakdown (Freight + Origin + Destination charges), and saves the result to the database — triggered on demand from the RFQ screen.

---

## Quick Reference

| Item | Detail |
|---|---|
| Target URL | `maersk.com/instantPrice/` |
| Auth required | Yes — free maersk.com account (register once) |
| Rate validity | Indicative only unless booked. Refreshes daily. |
| Data returned | Freight charge + Origin charges + Destination charges, per container type |
| Trigger | `POST /api/rates/maersk-scrape` — called from RFQ "Get spot rates" button |
| Tech stack | Node.js + Playwright (Chromium headless) |
| Credentials | Replit Secrets — never in source code |

---

## Section 1 — Prerequisites & Setup

### 1.1 Register a Maersk account

This is the account Playwright will log in with. Use an Oneport 365 company email — not a personal one.

- **Step 1:** Go to `maersk.com/portaluser/register`
- **Step 2:** Fill in — Company name: Oneport 365 Ltd, Country: Nigeria, Email: ops@oneport365.com
- **Step 3:** Click the verification link in the confirmation email
- **Step 4:** Log in manually, click **Prices** in the top nav → **Instant Prices** → run a test query for NGAPP → CNSHA to confirm the account works
- **Step 5:** Save credentials to Replit Secrets immediately (see Section 2)

> **Important:** Use a company email, not personal. If the person leaves, credentials can be changed without losing integration access.

---

### 1.2 The exact Maersk page flow Playwright replicates

Understand this manually before building. The confirmed flow from maersk.com support docs:

| Step | What happens | URL / action |
|---|---|---|
| 1 | Log in with email + password | `maersk.com/portaluser/login` |
| 2 | Land on Maersk homepage — logged in | `maersk.com` |
| 3 | Click **Prices** in top navigation | Reveals dropdown |
| 4 | Click **Instant Prices** under Ocean/Maersk Spot box | `maersk.com/instantPrice/` |
| 5 | Fill origin port (autocomplete) | Type LOCODE or city, select suggestion |
| 6 | Fill destination port (autocomplete) | Type LOCODE or city, select suggestion |
| 7 | Select container type from dropdown | 20' Dry / 40' Dry / 40' High Cube |
| 8 | Select estimated shipping date | Date picker |
| 9 | Click **Look up** button | Submits form |
| 10 | Wait for results to load | Spinner → rate cards appear |
| 11 | Read Freight charge, Origin charges, Destination charges | From result cards |

> **Key:** Maersk Instant Price is a React single-page app. Everything happens on the same URL. Playwright must wait for dynamic content to render, not just for the page to load.

---

### 1.3 Install dependencies on Replit

Run these commands in the **Replit Shell** tab:

```bash
# Install Playwright Node library
npm install playwright

# Download Chromium browser binary
npx playwright install chromium

# Install system dependencies Chromium needs (MANDATORY on Replit)
npx playwright install-deps chromium

# Verify
npx playwright --version
# Should print: Version 1.x.x
```

> **Warning:** The `install-deps` step is mandatory on Replit. Without it Chromium won't launch. If you see `browserType.launch: Failed to launch chromium` — this step was skipped.

---

## Section 2 — Credentials & Secrets

Never put login credentials in source code. Use Replit Secrets.

### 2.1 Add secrets in Replit

1. Open your Replit project
2. Click **Secrets** in the left sidebar (padlock icon)
3. Add these two secrets:

| Secret Key | Value |
|---|---|
| `MAERSK_EMAIL` | ops@oneport365.com |
| `MAERSK_PASSWORD` | your-password-here |

### 2.2 Access in code

```javascript
// Access like this — never hardcode
const email    = process.env.MAERSK_EMAIL;
const password = process.env.MAERSK_PASSWORD;
```

---

## Section 3 — File Structure

Create these new files:

```
your-replit-project/
├── server/
│   ├── scrapers/
│   │   ├── maersk.js              ← Main scraper (CREATE THIS)
│   │   └── maersk-selectors.js    ← CSS selectors config (CREATE THIS)
│   ├── routes/
│   │   └── rates.js               ← Add new endpoint here (already exists)
│   └── index.js                   ← Register scraper route (already exists)
└── package.json                   ← Already exists — no changes needed
```

---

## Section 4 — maersk-selectors.js

Create this file at `server/scrapers/maersk-selectors.js`.

This file holds all CSS selectors separately from the scraper logic. When Maersk updates their UI, only this file needs to change.

> **IMPORTANT:** These selectors must be verified by inspecting the live maersk.com pages in Chrome DevTools BEFORE running. See Section 8 for how to do this.

```javascript
// server/scrapers/maersk-selectors.js

module.exports = {

  // ── LOGIN PAGE (maersk.com/portaluser/login) ──────────────────────────────
  login: {
    emailInput:    'input[type="email"], #email, input[name="email"]',
    passwordInput: 'input[type="password"], #password, input[name="password"]',
    submitButton:  'button[type="submit"], button:has-text("Log in")',
    loggedInCheck: '[data-testid="user-menu"], .user-avatar, .account-menu',
  },

  // ── PRICES NAVIGATION ─────────────────────────────────────────────────────
  pricesMenu: {
    pricesNavLink:       'a:has-text("Prices"), [data-testid="prices-nav"]',
    instantPricesButton: 'a:has-text("Instant prices"), [data-testid="instant-prices-btn"]',
  },

  // ── INSTANT PRICE FORM (maersk.com/instantPrice/) ─────────────────────────
  form: {
    originInput: [
      '[data-testid="origin-port-input"]',
      '[placeholder*="origin" i]',
      '[placeholder*="from" i]',
      '#origin',
    ].join(', '),

    originSuggestion: [
      '[data-testid="port-suggestion"]:first-child',
      '.port-suggestion:first-child',
      '.autocomplete-option:first-child',
      '.suggestion-list li:first-child',
    ].join(', '),

    destInput: [
      '[data-testid="destination-port-input"]',
      '[placeholder*="destination" i]',
      '[placeholder*="to" i]',
      '#destination',
    ].join(', '),

    destSuggestion: [
      '[data-testid="port-suggestion"]:first-child',
      '.port-suggestion:first-child',
      '.autocomplete-option:first-child',
      '.suggestion-list li:first-child',
    ].join(', '),

    containerType: [
      '[data-testid="container-type-select"]',
      'select[name*="container" i]',
      '.container-type-selector',
    ].join(', '),

    dateInput: [
      '[data-testid="shipping-date"]',
      'input[type="date"]',
      '[placeholder*="date" i]',
    ].join(', '),

    lookupButton: [
      'button:has-text("Look up")',
      '[data-testid="lookup-button"]',
      'button[type="submit"]',
    ].join(', '),
  },

  // ── RESULTS PAGE ──────────────────────────────────────────────────────────
  results: {
    loadingSpinner: '.loading-spinner, [data-testid="loading"], .skeleton',

    rateCard: [
      '[data-testid="rate-offer-card"]',
      '[data-testid="spot-rate-card"]',
      '.rate-offer-card',
      '.price-card',
    ].join(', '),

    noResults: [
      '[data-testid="no-results"]',
      '.no-rates-found',
      'p:has-text("no prices")',
    ].join(', '),

    // Within each card:
    totalAmount:   '.total-price, [data-testid="total-amount"], .freight-total',
    currency:      '.currency-code, [data-testid="currency"]',
    freightCharge: '.freight-charge, [data-testid="freight-amount"]',
    originCharges: '.origin-charges, [data-testid="origin-charges"]',
    destCharges:   '.destination-charges, [data-testid="dest-charges"]',
    vesselName:    '.vessel-name, [data-testid="vessel"]',
    departureDate: '.etd, .departure-date, [data-testid="etd"]',
    arrivalDate:   '.eta, .arrival-date, [data-testid="eta"]',
    transitDays:   '.transit-time, [data-testid="transit"]',
  },

  // ── CONTAINER TYPE MAP ────────────────────────────────────────────────────
  // Maps Oneport 365 equipment codes to Maersk's display labels
  containerTypeMap: {
    '20FT': "20' Dry",
    '40FT': "40' Dry",
    '40HC': "40' High Cube",
  },
};
```

---

## Section 5 — maersk.js (Main Scraper)

Create this file at `server/scrapers/maersk.js`:

```javascript
// server/scrapers/maersk.js
const { chromium } = require('playwright');
const S = require('./maersk-selectors');

async function scrapeMaerskRate({ pol, pod, equip, date }) {
  const browser = await chromium.launch({
    headless: true,           // set false during development to see browser
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',          // required on Replit
      '--disable-setuid-sandbox',
    ],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
               'AppleWebKit/537.36 (KHTML, like Gecko) ' +
               'Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
  });

  const page = await context.newPage();

  // Block images and fonts — speeds up scraping
  await page.route('**/*.{png,jpg,jpeg,gif,svg,woff,woff2}', r => r.abort());

  try {

    // ── STEP 1: Login ──────────────────────────────────────────────────────
    console.log('[Maersk] Navigating to login...');
    await page.goto('https://www.maersk.com/portaluser/login', {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    await page.fill(S.login.emailInput,    process.env.MAERSK_EMAIL);
    await humanDelay(500, 1000);
    await page.fill(S.login.passwordInput, process.env.MAERSK_PASSWORD);
    await humanDelay(300, 700);
    await page.click(S.login.submitButton);

    await page.waitForSelector(S.login.loggedInCheck, {
      timeout: 20000,
      state: 'visible',
    });
    console.log('[Maersk] Login successful.');

    // ── STEP 2: Navigate to Instant Prices ────────────────────────────────
    console.log('[Maersk] Navigating to Instant Price page...');
    await page.goto('https://www.maersk.com/instantPrice/', {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    await page.waitForSelector(S.form.originInput, {
      state: 'visible',
      timeout: 15000,
    });

    // ── STEP 3: Fill origin port ───────────────────────────────────────────
    console.log(`[Maersk] Filling origin: ${pol}`);
    await page.click(S.form.originInput);
    await humanDelay(300, 600);
    await page.type(S.form.originInput, pol, { delay: 80 });

    await page.waitForSelector(S.form.originSuggestion, {
      state: 'visible',
      timeout: 8000,
    });
    await humanDelay(400, 800);
    await page.click(S.form.originSuggestion);
    console.log('[Maersk] Origin selected.');

    // ── STEP 4: Fill destination port ─────────────────────────────────────
    console.log(`[Maersk] Filling destination: ${pod}`);
    await page.click(S.form.destInput);
    await humanDelay(300, 600);
    await page.type(S.form.destInput, pod, { delay: 80 });

    await page.waitForSelector(S.form.destSuggestion, {
      state: 'visible',
      timeout: 8000,
    });
    await humanDelay(400, 800);
    await page.click(S.form.destSuggestion);
    console.log('[Maersk] Destination selected.');

    // ── STEP 5: Select container type ─────────────────────────────────────
    const maerskLabel = S.containerTypeMap[equip] || "40' High Cube";
    console.log(`[Maersk] Selecting container: ${maerskLabel}`);
    await page.click(S.form.containerType);
    await humanDelay(200, 500);
    try {
      await page.selectOption(S.form.containerType, { label: maerskLabel });
    } catch {
      await page.click(`text="${maerskLabel}"`);
    }

    // ── STEP 6: Set date ──────────────────────────────────────────────────
    console.log(`[Maersk] Setting date: ${date}`);
    await page.fill(S.form.dateInput, date);
    await humanDelay(200, 500);

    // ── STEP 7: Click Look up ─────────────────────────────────────────────
    console.log('[Maersk] Clicking Look up...');
    await page.click(S.form.lookupButton);

    // ── STEP 8: Wait for results ──────────────────────────────────────────
    // Wait for loading spinner to disappear first
    try {
      await page.waitForSelector(S.results.loadingSpinner, {
        state: 'hidden',
        timeout: 5000,
      });
    } catch { /* spinner may not appear — that's fine */ }

    // Then wait for rate cards or no-results message
    const resultSelector = `${S.results.rateCard}, ${S.results.noResults}`;
    await page.waitForSelector(resultSelector, { timeout: 25000 });

    // ── STEP 9: Check for no results ──────────────────────────────────────
    const noResults = await page.$(S.results.noResults);
    if (noResults) {
      console.log('[Maersk] No rates found for this route.');
      return {
        carrier: 'Maersk',
        rates: [],
        status: 'no_rates_found',
        pol, pod, equip, date,
      };
    }

    // ── STEP 10: Extract rate data ────────────────────────────────────────
    console.log('[Maersk] Extracting rates...');
    const rates = await page.evaluate((sel) => {
      const cards = document.querySelectorAll(sel.rateCard);
      return [...cards].map(card => ({
        totalAmount:   parseFloat(
          card.querySelector(sel.totalAmount)
              ?.innerText?.replace(/[^0-9.]/g, '') || '0'
        ),
        currency:      card.querySelector(sel.currency)
                           ?.innerText?.trim() || 'USD',
        freightCharge: card.querySelector(sel.freightCharge)
                           ?.innerText?.trim() || null,
        originCharges: card.querySelector(sel.originCharges)
                           ?.innerText?.trim() || null,
        destCharges:   card.querySelector(sel.destCharges)
                           ?.innerText?.trim() || null,
        vesselName:    card.querySelector(sel.vesselName)
                           ?.innerText?.trim() || null,
        departureDate: card.querySelector(sel.departureDate)
                           ?.innerText?.trim() || null,
        arrivalDate:   card.querySelector(sel.arrivalDate)
                           ?.innerText?.trim() || null,
        transitDays:   card.querySelector(sel.transitDays)
                           ?.innerText?.trim() || null,
        rateId:        card.getAttribute('data-rate-id') || null,
      }));
    }, S.results);

    console.log(`[Maersk] Extracted ${rates.length} rate(s).`);
    return {
      carrier: 'Maersk',
      rates,
      status: 'success',
      pol, pod, equip, date,
      scrapedAt: new Date().toISOString(),
    };

  } catch (err) {
    console.error('[Maersk] Scrape failed:', err.message);
    // Screenshot on failure for debugging
    await page.screenshot({ path: `/tmp/maersk-error-${Date.now()}.png` });
    return {
      carrier: 'Maersk',
      rates: [],
      status: 'error',
      error: err.message,
      pol, pod, equip, date,
    };
  } finally {
    await browser.close();
  }
}

// Random human-like delay between actions
function humanDelay(minMs, maxMs) {
  const ms = Math.floor(Math.random() * (maxMs - minMs) + minMs);
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { scrapeMaerskRate };
```

---

## Section 6 — API Endpoint

Add to `server/routes/rates.js`:

```javascript
const { scrapeMaerskRate } = require('../scrapers/maersk');

// POST /api/rates/maersk-scrape
router.post('/api/rates/maersk-scrape', authMiddleware, async (req, res) => {
  const { pol, pod, equip, date } = req.body;

  if (!pol || !pod || !equip || !date) {
    return res.status(400).json({
      error: 'Missing required fields: pol, pod, equip, date'
    });
  }

  if (!['20FT', '40FT', '40HC'].includes(equip)) {
    return res.status(400).json({ error: 'equip must be 20FT, 40FT, or 40HC' });
  }

  try {
    const result = await scrapeMaerskRate({ pol, pod, equip, date });

    // Save to DB if successful
    if (result.status === 'success' && result.rates.length > 0) {
      for (const rate of result.rates) {
        await saveRateToDb(rate, pol, pod, equip);
      }
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save scraped rate to ocean_freight_rates table
async function saveRateToDb(rate, pol, pod, equip) {
  const existing = await db.query(
    `SELECT id FROM ocean_freight_rates
     WHERE carrier='Maersk' AND pol_code=$1 AND pod_code=$2
     AND equipment_type=$3 AND source='MAERSK_SCRAPE'
     AND expiry_date >= CURRENT_DATE`,
    [pol, pod, equip]
  );

  if (existing.rows.length > 0) {
    await db.query(
      `UPDATE ocean_freight_rates
       SET amount_20ft=$1, amount_40ft=$2, amount_40hc=$3,
           expiry_date=CURRENT_DATE + INTERVAL '7 days',
           updated_at=NOW()
       WHERE id=$4`,
      [
        equip === '20FT' ? rate.totalAmount : null,
        equip === '40FT' ? rate.totalAmount : null,
        equip === '40HC' ? rate.totalAmount : null,
        existing.rows[0].id
      ]
    );
  } else {
    await db.query(
      `INSERT INTO ocean_freight_rates
       (carrier, pol_code, pod_code, equipment_type, currency,
        amount_20ft, amount_40ft, amount_40hc,
        rate_type, commodity_type, expiry_date, source, created_at, updated_at)
       VALUES ('Maersk',$1,$2,$3,$4,$5,$6,$7,
               'Spot','General',
               CURRENT_DATE + INTERVAL '7 days',
               'MAERSK_SCRAPE',NOW(),NOW())`,
      [
        pol, pod, equip, rate.currency,
        equip === '20FT' ? rate.totalAmount : null,
        equip === '40FT' ? rate.totalAmount : null,
        equip === '40HC' ? rate.totalAmount : null,
      ]
    );
  }
}
```

---

## Section 7 — Frontend (RFQ Page)

Add to your RFQ page component:

```javascript
const [maerskRate, setMaerskRate]   = useState(null);
const [scraping, setScraping]       = useState(false);
const [scrapeError, setScrapeError] = useState(null);

async function getMaerskRate() {
  setScraping(true);
  setScrapeError(null);
  setMaerskRate(null);

  try {
    const res = await fetch('/api/rates/maersk-scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        pol:   rfq.polCode,
        pod:   rfq.podCode,
        equip: rfq.equipType,  // '20FT' | '40FT' | '40HC'
        date:  rfq.shipDate,   // YYYY-MM-DD
      }),
    });

    const data = await res.json();

    if (data.status === 'success') {
      setMaerskRate(data);
    } else if (data.status === 'no_rates_found') {
      setScrapeError('No Maersk rates available for this route on that date.');
    } else {
      setScrapeError('Maersk scrape failed: ' + data.error);
    }
  } catch (err) {
    setScrapeError('Network error: ' + err.message);
  } finally {
    setScraping(false);
  }
}
```

```jsx
{/* Button */}
<button onClick={getMaerskRate} disabled={scraping}>
  {scraping ? 'Fetching Maersk rate...' : 'Get Maersk spot rate'}
</button>

{/* Error state */}
{scrapeError && <p style={{ color: 'red' }}>{scrapeError}</p>}

{/* Results */}
{maerskRate?.rates?.length > 0 && (
  <div className="maersk-rate-result">
    <h4>Maersk Live Rate — {maerskRate.pol} → {maerskRate.pod}</h4>
    {maerskRate.rates.map((rate, i) => (
      <div key={i} className="rate-card">
        <span className="total">{rate.currency} {rate.totalAmount?.toLocaleString()}</span>
        <span className="vessel">{rate.vesselName}</span>
        <span className="etd">ETD: {rate.departureDate}</span>
        <span className="transit">{rate.transitDays}</span>
        <button onClick={() => applyRateToRFQ(rate)}>Use this rate</button>
      </div>
    ))}
    <small>Scraped at {new Date(maerskRate.scrapedAt).toLocaleTimeString()}</small>
  </div>
)}
```

---

## Section 8 — Finding the Real Selectors (MANDATORY)

The selectors in `maersk-selectors.js` are starting points. **Verify every selector against the live page before going live.**

### Step-by-step

1. Log into maersk.com manually with the Oneport 365 account
2. Navigate to `maersk.com/instantPrice/`
3. Open Chrome DevTools — press `F12`
4. Click the element picker (cursor icon, top-left of DevTools)
5. Click each form field on the page
6. Look for `id=`, `data-testid=`, or a unique class name in the highlighted HTML
7. Test your selector in the **Console** tab:

```javascript
// In Chrome DevTools Console:
document.querySelector('[your-selector-here]')
// Returns element = ✅ works
// Returns null     = ❌ wrong selector
```

8. Update `maersk-selectors.js` with confirmed selectors
9. Repeat for every field: origin input, origin suggestion, destination input, destination suggestion, container type, date, submit button, result cards

> **Pro tip:** Search for `data-testid` in the Elements panel — these are added by developers for automation and are far more stable than class names.

### Development mode — see the browser

```javascript
// In maersk.js — while debugging:
const browser = await chromium.launch({
  headless: false,   // ← shows the browser window
  slowMo: 500,       // ← slows each action by 500ms
});
// Change back to headless: true before deploying
```

---

## Section 9 — DB Migration

Run this once before testing:

```sql
-- Add source column if not already added from previous spec
ALTER TABLE ocean_freight_rates
  ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'MANUAL';

-- MANUAL        = entered by ops team
-- MAERSK_SCRAPE = inserted by this scraper
-- USDA_AUTO     = inserted by the weekly USDA sync job
```

---

## Section 10 — Testing Checklist

Run through all 15 tests before going live:

| # | Test | Expected result | Pass? |
|---|---|---|---|
| 1 | `npm install playwright` and `npx playwright install chromium` | No errors | [ ] |
| 2 | `npx playwright install-deps chromium` | No errors | [ ] |
| 3 | MAERSK_EMAIL and MAERSK_PASSWORD added to Replit Secrets | Visible in sidebar | [ ] |
| 4 | Run scraper in headed mode (`headless: false`) for NGAPP → CNSHA 40HC | Browser opens and navigates | [ ] |
| 5 | Login selector works | Logged-in state detected, no timeout | [ ] |
| 6 | Origin autocomplete triggers suggestions | Dropdown appears when typing NGAPP | [ ] |
| 7 | Destination autocomplete triggers suggestions | Dropdown appears when typing CNSHA | [ ] |
| 8 | Container type selection works | 40' High Cube selected without error | [ ] |
| 9 | Look up button triggers results | Rate cards appear within 25 seconds | [ ] |
| 10 | Rate extraction returns non-null totalAmount | `rates[0].totalAmount` is a number > 0 | [ ] |
| 11 | Test a route with no Maersk service | `status: 'no_rates_found'` returned cleanly | [ ] |
| 12 | Test `POST /api/rates/maersk-scrape` via Postman | JSON with `status: 'success'` and rates array | [ ] |
| 13 | Scraped rate saved to DB with `source='MAERSK_SCRAPE'` | Row visible in DB with correct data | [ ] |
| 14 | Run same route twice — no duplicate DB rows | Still only one row after second run | [ ] |
| 15 | Switch to `headless: true` — scraper still works | Runs without visible browser | [ ] |

---

## Section 11 — Common Errors & Fixes

| Error | Likely cause | Fix |
|---|---|---|
| `browserType.launch: Failed to launch chromium` | install-deps not run | `npx playwright install-deps chromium` |
| Timeout waiting for selector | Selector wrong or page changed | Inspect live page in DevTools, update `maersk-selectors.js` |
| Login failed / redirect loop | Wrong credentials or account locked | Check Replit Secrets, verify login works manually first |
| `net::ERR_BLOCKED_BY_RESPONSE` | Maersk blocked the request | Add `humanDelay` between actions, check userAgent string |
| `page.fill: Element not found` | Form not loaded yet | Increase `waitForSelector` timeout or add extra wait |
| `rates` array is empty | Result card selectors wrong | Inspect result page in DevTools, update `S.results` selectors |
| `Cannot read property of null` | Rate card missing expected child | All `querySelector` calls already use `?.` — check selector is finding the right parent card |

---

*End of guide — Oneport 365 · May 2026*
*Selector verification against live maersk.com pages is mandatory before deployment.*
