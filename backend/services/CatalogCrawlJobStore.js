import { v4 as uuidv4 } from 'uuid';
import {
  extractProductsFromUrl,
  startProductCrawl,
  waitForCrawl,
  fetchAllCrawlPages,
  productsFromCrawlPages,
  normalizeScrapedProducts,
} from './ScrapeGraphCatalogService.js';
import { skuCatalogQueries, skuItemQueries } from '../database/schema.js';

const JOB_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * In-memory async jobs for ScrapeGraphAI catalog imports.
 * Does not affect existing XLS/CSV import flow.
 */
export class CatalogCrawlJobStore {
  constructor(db) {
    this.db = db;
    /** @type {Map<string, object>} */
    this.jobs = new Map();
  }

  createJob(params) {
    const jobId = uuidv4();
    const job = {
      id: jobId,
      status: 'queued',
      mode: params.mode || 'extract',
      url: params.url,
      name: params.name || null,
      description: params.description || null,
      progress: { finished: 0, total: 0, message: 'Queued…' },
      catalogId: null,
      itemCount: 0,
      categories: [],
      brands: [],
      error: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      abortController: new AbortController(),
    };

    this.jobs.set(jobId, job);
    this._runJob(job, params).catch((err) => {
      job.status = 'failed';
      job.error = err.message;
      job.updatedAt = Date.now();
      console.error(`[CatalogCrawl] Job ${jobId.slice(0, 8)} failed:`, err.message);
    });

    this._cleanupOldJobs();
    return jobId;
  }

  getJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    return this._publicView(job);
  }

  cancelJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    job.abortController.abort();
    job.status = 'cancelled';
    job.error = 'Cancelled by user';
    job.updatedAt = Date.now();
    return true;
  }

  _publicView(job) {
    return {
      id: job.id,
      status: job.status,
      mode: job.mode,
      url: job.url,
      progress: job.progress,
      catalogId: job.catalogId,
      itemCount: job.itemCount,
      categories: job.categories,
      brands: job.brands,
      error: job.error,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }

  async _runJob(job, params) {
    job.status = 'running';
    job.progress.message = 'Connecting to ScrapeGraphAI…';
    job.updatedAt = Date.now();

    const signal = job.abortController.signal;
    const scrapeOptions = {
      stealth: params.stealth !== false,
      renderMode: params.renderMode || 'js',
      scrolls: params.scrolls ?? 5,
      wait: params.wait ?? 3000,
    };

    let rawProducts = [];
    let storeName = null;

    if (job.mode === 'crawl') {
      job.progress.message = 'Starting multi-page crawl…';
      const { crawlId, total } = await startProductCrawl(job.url, {
        ...scrapeOptions,
        maxPages: params.maxPages ?? 10,
        maxDepth: params.maxDepth ?? 2,
      });

      job.progress.total = total;
      job.updatedAt = Date.now();

      await waitForCrawl(crawlId, {
        signal,
        onProgress: ({ status, finished, total }) => {
          job.progress = {
            finished,
            total,
            message: `Crawling… ${finished}/${total} pages (${status})`,
          };
          job.updatedAt = Date.now();
        },
      });

      if (signal.aborted) return;

      job.progress.message = 'Collecting products from crawled pages…';
      const pages = await fetchAllCrawlPages(crawlId);
      const collected = productsFromCrawlPages(pages);
      storeName = collected.storeName;
      rawProducts = collected.products;
    } else {
      job.progress.message = 'Extracting products from page…';
      job.progress.total = 1;
      job.updatedAt = Date.now();

      const result = await extractProductsFromUrl(job.url, scrapeOptions);
      storeName = result.storeName;
      rawProducts = result.products;

      job.progress.finished = 1;
      job.progress.message = 'Processing extracted products…';
      job.updatedAt = Date.now();
    }

    if (signal.aborted) return;

    const catalogId = uuidv4();
    const now = new Date().toISOString();
    const hostname = (() => {
      try {
        return new URL(job.url).hostname.replace(/^www\./, '');
      } catch {
        return 'website';
      }
    })();

    const catalogName = job.name || storeName || `Catalog from ${hostname}`;
    const catalogDescription = job.description
      || `Imported via ScrapeGraphAI from ${job.url} (${job.mode})`;

    skuCatalogQueries.create(this.db, {
      id: catalogId,
      name: catalogName,
      description: catalogDescription,
      createdAt: now,
      updatedAt: now,
    });

    const items = normalizeScrapedProducts(rawProducts, catalogId, job.url);

    if (items.length === 0) {
      skuCatalogQueries.delete(this.db, catalogId);
      throw new Error(
        'No products found on this page. Try crawl mode, enable stealth, or use a product listing URL.'
      );
    }

    skuItemQueries.bulkCreate(this.db, items);

    const categories = [...new Set(items.map((i) => i.category).filter(Boolean))];
    const brands = [...new Set(items.map((i) => i.brand).filter(Boolean))];

    job.catalogId = catalogId;
    job.itemCount = items.length;
    job.categories = categories;
    job.brands = brands;
    job.status = 'completed';
    job.progress = {
      finished: job.progress.total || 1,
      total: job.progress.total || 1,
      message: `Done — ${items.length} products imported`,
    };
    job.updatedAt = Date.now();

    console.log(`[CatalogCrawl] Job ${job.id.slice(0, 8)} completed: ${items.length} SKUs`);
  }

  _cleanupOldJobs() {
    const cutoff = Date.now() - JOB_TTL_MS;
    for (const [id, job] of this.jobs) {
      if (job.updatedAt < cutoff && ['completed', 'failed', 'cancelled'].includes(job.status)) {
        this.jobs.delete(id);
      }
    }
  }
}

let sharedStore = null;

export function getCatalogCrawlJobStore(db) {
  if (!sharedStore) sharedStore = new CatalogCrawlJobStore(db);
  return sharedStore;
}

export default CatalogCrawlJobStore;
