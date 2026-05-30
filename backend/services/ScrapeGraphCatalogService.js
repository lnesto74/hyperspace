import { v4 as uuidv4 } from 'uuid';

/**
 * ScrapeGraphAI catalog extraction for grocery / e-commerce product pages.
 * Uses the v2 REST API (https://docs.scrapegraphai.com) — no SDK required.
 *
 * Set SGAI_API_KEY in backend/.env (free tier: 500 credits at scrapegraphai.com).
 */

const SGAI_API_BASE = process.env.SGAI_API_URL || 'https://v2-api.scrapegraphai.com/api';

const EXTRACT_PROMPT = `Extract every grocery or retail product visible on this page.
For each product include: product name, brand, category, subcategory, pack size,
price as a number (use dot decimal, no currency symbol), SKU/EAN/product code if shown,
and the full image URL. Skip navigation links, ads, and non-product content.`;

export const PRODUCT_LIST_SCHEMA = {
  type: 'object',
  properties: {
    store_name: { type: 'string', description: 'Store or website name if visible' },
    products: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          sku_code: { type: 'string', description: 'SKU, EAN, or product code' },
          name: { type: 'string' },
          brand: { type: 'string' },
          category: { type: 'string' },
          subcategory: { type: 'string' },
          size: { type: 'string', description: 'Pack size, weight, or volume' },
          price: { type: 'number' },
          image_url: { type: 'string', description: 'Absolute URL to product image' },
          product_url: { type: 'string', description: 'Link to product detail page' },
        },
        required: ['name'],
      },
    },
  },
  required: ['products'],
};

function getApiKey() {
  const key = process.env.SGAI_API_KEY;
  if (!key) {
    throw new Error('SGAI_API_KEY is not configured. Sign up free at https://scrapegraphai.com and add the key to backend/.env');
  }
  return key;
}

async function sgaiFetch(path, options = {}) {
  const url = `${SGAI_API_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'SGAI-APIKEY': getApiKey(),
      ...options.headers,
    },
  });

  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }

  if (!res.ok) {
    const msg = body?.error || body?.message || body?.detail || res.statusText;
    throw new Error(`ScrapeGraphAI ${path} failed (${res.status}): ${msg}`);
  }

  return body;
}

function defaultFetchConfig({ stealth = true, renderMode = 'js', scrolls = 5, wait = 3000 } = {}) {
  return {
    mode: renderMode,
    stealth,
    scrolls,
    wait,
    timeout: 60000,
  };
}

/**
 * Parse products from ScrapeGraphAI extract/crawl json output.
 */
export function parseProductPayload(json) {
  if (!json) return [];
  if (Array.isArray(json)) return json;
  if (Array.isArray(json.products)) return json.products;
  if (json.data?.products) return json.data.products;
  if (json.json?.products) return json.json.products;
  return [];
}

/**
 * Normalize raw scraped products into sku_items insert shape.
 */
export function normalizeScrapedProducts(rawProducts, catalogId, sourceUrl) {
  const seen = new Set();
  const items = [];

  for (let i = 0; i < rawProducts.length; i++) {
    const raw = rawProducts[i];
    if (!raw || typeof raw !== 'object') continue;

    const name = String(raw.name || raw.product_name || raw.title || '').trim();
    if (!name) continue;

    const skuCode = String(
      raw.sku_code || raw.sku || raw.ean || raw.code || raw.id || `WEB-${i + 1}`
    ).trim();

    const dedupeKey = skuCode.toLowerCase() || name.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    let price = raw.price;
    if (typeof price === 'string') {
      const parsed = parseFloat(price.replace(/[^\d.,]/g, '').replace(',', '.'));
      price = Number.isFinite(parsed) ? parsed : null;
    } else if (typeof price !== 'number' || !Number.isFinite(price)) {
      price = null;
    }

    const imageUrl = raw.image_url || raw.imageUrl || raw.image || null;
    const productUrl = raw.product_url || raw.url || raw.link || null;

    items.push({
      id: uuidv4(),
      catalogId,
      skuCode,
      name,
      brand: raw.brand ? String(raw.brand) : null,
      category: raw.category ? String(raw.category) : null,
      subcategory: raw.subcategory ? String(raw.subcategory) : null,
      size: raw.size ? String(raw.size) : null,
      widthM: null,
      heightM: null,
      depthM: null,
      price,
      margin: null,
      imageUrl: imageUrl ? String(imageUrl) : null,
      meta: productUrl || sourceUrl
        ? { sourceUrl, productUrl: productUrl ? String(productUrl) : null }
        : null,
    });
  }

  return items;
}

/**
 * Single-page extract — best for product listing pages (5 credits + optional stealth).
 */
export async function extractProductsFromUrl(url, options = {}) {
  const fetchConfig = defaultFetchConfig(options);
  const body = await sgaiFetch('/extract', {
    method: 'POST',
    body: JSON.stringify({
      url,
      prompt: options.prompt || EXTRACT_PROMPT,
      schema: PRODUCT_LIST_SCHEMA,
      fetchConfig,
    }),
  });

  const json = body.json ?? body.data?.json ?? body;
  const storeName = json?.store_name || null;
  const products = parseProductPayload(json);

  return { storeName, products, raw: body };
}

/**
 * Start a multi-page crawl job.
 */
export async function startProductCrawl(url, options = {}) {
  const maxPages = Math.min(Math.max(options.maxPages ?? 10, 1), 50);
  const maxDepth = Math.min(Math.max(options.maxDepth ?? 2, 1), 3);
  const fetchConfig = defaultFetchConfig(options);

  const body = await sgaiFetch('/crawl', {
    method: 'POST',
    body: JSON.stringify({
      url,
      formats: [{
        type: 'json',
        prompt: options.prompt || EXTRACT_PROMPT,
        schema: PRODUCT_LIST_SCHEMA,
      }],
      maxPages,
      maxDepth,
      allowExternal: false,
      fetchConfig,
    }),
  });

  return {
    crawlId: body.id,
    status: body.status,
    total: body.total ?? maxPages,
  };
}

export async function getCrawlStatus(crawlId) {
  return sgaiFetch(`/crawl/${crawlId}`, { method: 'GET' });
}

/**
 * Fetch all crawl pages with resolved scrape results (cursor-paginated).
 */
export async function fetchAllCrawlPages(crawlId) {
  const allPages = [];
  let cursor = 0;

  while (true) {
    const body = await sgaiFetch(`/crawl/${crawlId}/pages?limit=50&cursor=${cursor}`, {
      method: 'GET',
    });

    const batch = body.data || [];
    allPages.push(...batch);

    const nextCursor = body.pagination?.nextCursor;
    if (nextCursor == null || batch.length === 0) break;
    cursor = Number(nextCursor);
  }

  return allPages;
}

/**
 * Collect products from crawl page results.
 */
export function productsFromCrawlPages(pages) {
  const merged = [];
  let storeName = null;

  for (const page of pages) {
    if (page.status !== 'completed') continue;

    const jsonResults = page.scrape?.results?.json;
    const jsonData = jsonResults?.data ?? jsonResults?.json ?? jsonResults;

    let payload = jsonData;
    if (Array.isArray(jsonData) && jsonData.length === 1 && typeof jsonData[0] === 'object') {
      payload = jsonData[0];
    } else if (typeof jsonData === 'string') {
      try {
        payload = JSON.parse(jsonData);
      } catch {
        payload = null;
      }
    }

    if (!payload) continue;
    if (payload.store_name && !storeName) storeName = payload.store_name;
    merged.push(...parseProductPayload(payload));
  }

  return { storeName, products: merged };
}

/**
 * Poll crawl until completed or failed.
 */
export async function waitForCrawl(crawlId, { pollMs = 2000, onProgress, signal } = {}) {
  while (true) {
    if (signal?.aborted) throw new Error('Crawl cancelled');

    const status = await getCrawlStatus(crawlId);
    onProgress?.({
      status: status.status,
      finished: status.finished ?? 0,
      total: status.total ?? 0,
    });

    if (status.status === 'completed') return status;
    if (status.status === 'failed') {
      throw new Error(`Crawl failed: ${status.error || 'unknown error'}`);
    }

    await new Promise((r) => setTimeout(r, pollMs));
  }
}

export default {
  extractProductsFromUrl,
  startProductCrawl,
  getCrawlStatus,
  fetchAllCrawlPages,
  productsFromCrawlPages,
  waitForCrawl,
  normalizeScrapedProducts,
  parseProductPayload,
  PRODUCT_LIST_SCHEMA,
};
