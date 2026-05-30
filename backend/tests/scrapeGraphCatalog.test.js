import { describe, it, expect } from 'vitest';
import {
  parseProductPayload,
  normalizeScrapedProducts,
} from '../services/ScrapeGraphCatalogService.js';

describe('ScrapeGraphCatalogService', () => {
  it('parseProductPayload handles nested shapes', () => {
    expect(parseProductPayload({ products: [{ name: 'Milk' }] })).toHaveLength(1);
    expect(parseProductPayload({ json: { products: [{ name: 'Bread' }] } })).toHaveLength(1);
    expect(parseProductPayload([{ name: 'Water' }])).toHaveLength(1);
  });

  it('normalizeScrapedProducts dedupes and maps fields', () => {
    const catalogId = 'cat-1';
    const items = normalizeScrapedProducts([
      { sku_code: 'ESS-001', name: 'Latte', brand: 'Esselunga', price: '1,29', image_url: 'https://img/a.jpg' },
      { sku_code: 'ESS-001', name: 'Latte duplicate' },
      { name: 'Pane', price: 2.5 },
    ], catalogId, 'https://example.com/store');

    expect(items).toHaveLength(2);
    expect(items[0].skuCode).toBe('ESS-001');
    expect(items[0].price).toBe(1.29);
    expect(items[0].imageUrl).toBe('https://img/a.jpg');
    expect(items[1].skuCode).toBe('WEB-3');
    expect(items[1].price).toBe(2.5);
  });
});
