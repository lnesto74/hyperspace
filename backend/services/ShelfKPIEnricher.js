/**
 * ShelfKPIEnricher
 * 
 * Enriches shelf KPIs with planogram data (SKU, category, brand information)
 * Provides position-based analytics and category/brand breakdowns
 */

import { shelfPlanogramQueries, skuItemQueries } from '../database/schema.js';

// Position value multipliers based on retail research
const LEVEL_MULTIPLIERS = {
  'eye-level': 1.5,    // Level 2 (typically)
  'waist': 1.0,        // Level 1
  'stretch': 0.7,      // Top level
  'stooping': 0.6,     // Bottom level
};

// Slot position bonuses
const SLOT_POSITION_BONUS = {
  center: 0.2,         // +20% for center slots
  endcap: 0.4,         // +40% for end positions (promotional)
  edge: 0.0,           // No bonus for edge slots
};

export class ShelfKPIEnricher {
  constructor(db) {
    this.db = db;
  }

  /**
   * Get level type based on position
   */
  getLevelType(levelIndex, numLevels) {
    if (numLevels <= 2) {
      return levelIndex === 1 ? 'eye-level' : 'waist';
    }
    
    if (levelIndex === 0) return 'stooping';
    if (levelIndex === numLevels - 1) return 'stretch';
    if (levelIndex === Math.floor(numLevels / 2) || levelIndex === Math.floor(numLevels / 2) + 1) {
      return 'eye-level';
    }
    return 'waist';
  }

  /**
   * Get slot position type
   */
  getSlotPositionType(slotIndex, slotsPerLevel) {
    if (slotsPerLevel <= 2) return 'center';
    
    const centerStart = Math.floor(slotsPerLevel * 0.3);
    const centerEnd = Math.ceil(slotsPerLevel * 0.7);
    
    if (slotIndex === 0 || slotIndex === slotsPerLevel - 1) return 'endcap';
    if (slotIndex >= centerStart && slotIndex < centerEnd) return 'center';
    return 'edge';
  }

  /**
   * Calculate position score for a slot
   */
  calculatePositionScore(levelIndex, slotIndex, numLevels, slotsPerLevel) {
    const levelType = this.getLevelType(levelIndex, numLevels);
    const slotType = this.getSlotPositionType(slotIndex, slotsPerLevel);
    
    const levelMultiplier = LEVEL_MULTIPLIERS[levelType] || 1.0;
    const slotBonus = SLOT_POSITION_BONUS[slotType] || 0;
    
    // Base score of 50, modified by position
    const score = Math.round(50 * levelMultiplier * (1 + slotBonus));
    return Math.min(100, Math.max(0, score));
  }

  /**
   * Get enriched shelf data with SKU details
   */
  getEnrichedShelfData(planogramId, shelfId) {
    const shelfPlanogram = shelfPlanogramQueries.getByShelfId(this.db, planogramId, shelfId);
    if (!shelfPlanogram) return null;

    const { numLevels, slotWidthM, slots } = shelfPlanogram;
    const slotsPerLevel = slots.levels?.[0]?.slots?.length || 0;
    
    // Collect all SKU IDs
    const skuIds = new Set();
    slots.levels?.forEach(level => {
      level.slots?.forEach(slot => {
        if (slot.skuItemId) skuIds.add(slot.skuItemId);
      });
    });

    // Fetch SKU details
    const skuDetails = {};
    skuIds.forEach(id => {
      const item = skuItemQueries.getById(this.db, id);
      if (item) skuDetails[id] = item;
    });

    // Enrich slots with SKU data and position scores
    const enrichedLevels = slots.levels?.map(level => ({
      levelIndex: level.levelIndex,
      levelType: this.getLevelType(level.levelIndex, numLevels),
      slots: level.slots?.map(slot => {
        const sku = slot.skuItemId ? skuDetails[slot.skuItemId] : null;
        return {
          ...slot,
          positionScore: this.calculatePositionScore(level.levelIndex, slot.slotIndex, numLevels, slotsPerLevel),
          slotType: this.getSlotPositionType(slot.slotIndex, slotsPerLevel),
          sku: sku ? {
            id: sku.id,
            skuCode: sku.skuCode,
            name: sku.name,
            brand: sku.brand,
            category: sku.category,
            subcategory: sku.subcategory,
            price: sku.price,
            margin: sku.margin,
          } : null,
        };
      }),
    }));

    return {
      shelfId,
      planogramId,
      numLevels,
      slotWidthM,
      slotsPerLevel,
      totalSlots: numLevels * slotsPerLevel,
      occupiedSlots: Array.from(skuIds).length,
      levels: enrichedLevels,
      skuDetails,
    };
  }

  /**
   * Aggregate shelf data by category
   */
  getCategoryBreakdown(enrichedShelfData) {
    if (!enrichedShelfData) return [];

    const categoryStats = {};

    enrichedShelfData.levels?.forEach(level => {
      level.slots?.forEach(slot => {
        if (!slot.sku) return;
        
        const category = slot.sku.category || 'Uncategorized';
        if (!categoryStats[category]) {
          categoryStats[category] = {
            category,
            slotCount: 0,
            facings: 0,
            totalPositionScore: 0,
            avgPositionScore: 0,
            skus: new Set(),
            brands: new Set(),
            subcategories: new Set(),
            totalPrice: 0,
            totalMargin: 0,
            levels: {},
          };
        }

        const stats = categoryStats[category];
        stats.slotCount++;
        stats.facings += slot.facingSpan || 1;
        stats.totalPositionScore += slot.positionScore;
        stats.skus.add(slot.sku.skuCode);
        if (slot.sku.brand) stats.brands.add(slot.sku.brand);
        if (slot.sku.subcategory) stats.subcategories.add(slot.sku.subcategory);
        if (slot.sku.price) stats.totalPrice += slot.sku.price;
        if (slot.sku.margin) stats.totalMargin += slot.sku.margin;
        
        // Track level distribution
        const levelKey = level.levelType;
        stats.levels[levelKey] = (stats.levels[levelKey] || 0) + 1;
      });
    });

    // Calculate averages and convert Sets to arrays
    return Object.values(categoryStats).map(stats => ({
      category: stats.category,
      slotCount: stats.slotCount,
      facings: stats.facings,
      shareOfShelf: (stats.slotCount / enrichedShelfData.totalSlots) * 100,
      avgPositionScore: stats.slotCount > 0 ? Math.round(stats.totalPositionScore / stats.slotCount) : 0,
      uniqueSkus: stats.skus.size,
      uniqueBrands: stats.brands.size,
      subcategories: Array.from(stats.subcategories),
      avgPrice: stats.slotCount > 0 ? stats.totalPrice / stats.slotCount : 0,
      avgMargin: stats.slotCount > 0 ? stats.totalMargin / stats.slotCount : 0,
      levelDistribution: stats.levels,
    })).sort((a, b) => b.slotCount - a.slotCount);
  }

  /**
   * Aggregate shelf data by brand
   */
  getBrandBreakdown(enrichedShelfData) {
    if (!enrichedShelfData) return [];

    const brandStats = {};

    enrichedShelfData.levels?.forEach(level => {
      level.slots?.forEach(slot => {
        if (!slot.sku) return;
        
        const brand = slot.sku.brand || 'Unknown Brand';
        if (!brandStats[brand]) {
          brandStats[brand] = {
            brand,
            slotCount: 0,
            facings: 0,
            totalPositionScore: 0,
            skus: new Set(),
            categories: new Set(),
            totalPrice: 0,
            totalMargin: 0,
          };
        }

        const stats = brandStats[brand];
        stats.slotCount++;
        stats.facings += slot.facingSpan || 1;
        stats.totalPositionScore += slot.positionScore;
        stats.skus.add(slot.sku.skuCode);
        if (slot.sku.category) stats.categories.add(slot.sku.category);
        if (slot.sku.price) stats.totalPrice += slot.sku.price;
        if (slot.sku.margin) stats.totalMargin += slot.sku.margin;
      });
    });

    return Object.values(brandStats).map(stats => ({
      brand: stats.brand,
      slotCount: stats.slotCount,
      facings: stats.facings,
      shareOfShelf: (stats.slotCount / enrichedShelfData.totalSlots) * 100,
      avgPositionScore: stats.slotCount > 0 ? Math.round(stats.totalPositionScore / stats.slotCount) : 0,
      uniqueSkus: stats.skus.size,
      categories: Array.from(stats.categories),
      avgPrice: stats.slotCount > 0 ? stats.totalPrice / stats.slotCount : 0,
      avgMargin: stats.slotCount > 0 ? stats.totalMargin / stats.slotCount : 0,
    })).sort((a, b) => b.slotCount - a.slotCount);
  }

  /**
   * Generate slot-level heatmap data
   * Can be enriched with actual engagement data when available
   */
  getSlotHeatmap(enrichedShelfData, engagementData = null) {
    if (!enrichedShelfData) return [];

    return enrichedShelfData.levels?.map(level => ({
      levelIndex: level.levelIndex,
      levelType: level.levelType,
      slots: level.slots?.map(slot => ({
        slotIndex: slot.slotIndex,
        slotType: slot.slotType,
        positionScore: slot.positionScore,
        skuCode: slot.sku?.skuCode || null,
        skuName: slot.sku?.name || null,
        category: slot.sku?.category || null,
        brand: slot.sku?.brand || null,
        // Will be enriched with actual engagement data
        engagementCount: engagementData?.[`${level.levelIndex}-${slot.slotIndex}`]?.count || 0,
        dwellTimeMs: engagementData?.[`${level.levelIndex}-${slot.slotIndex}`]?.dwellTimeMs || 0,
      })),
    }));
  }

  /**
   * Calculate enriched shelf KPIs combining zone visits with planogram data
   */
  getEnrichedShelfKPIs(shelfId, planogramId, zoneKPIs, options = {}) {
    const enrichedData = this.getEnrichedShelfData(planogramId, shelfId);
    if (!enrichedData) {
      return {
        error: 'No planogram data found for shelf',
        basicKPIs: zoneKPIs,
      };
    }

    const categoryBreakdown = this.getCategoryBreakdown(enrichedData);
    const brandBreakdown = this.getBrandBreakdown(enrichedData);
    const slotHeatmap = this.getSlotHeatmap(enrichedData);

    // Calculate shelf-specific KPIs
    const totalVisits = zoneKPIs.visits || 0;
    const totalDwells = zoneKPIs.dwellsCumulative || 0;
    const avgDwellTime = zoneKPIs.dwellAvgTime || 0;

    // Browsing rate: dwells / visits
    const browsingRate = totalVisits > 0 ? (totalDwells / totalVisits) * 100 : 0;
    
    // Passby count: visits without dwell
    const passbyCount = Math.max(0, totalVisits - totalDwells);
    
    // Average browse time (same as dwell avg time for now)
    const avgBrowseTime = avgDwellTime * 60; // Convert to seconds

    // Calculate potential revenue metrics
    const avgShelfPrice = categoryBreakdown.reduce((sum, c) => sum + c.avgPrice, 0) / (categoryBreakdown.length || 1);
    const engagementValue = totalDwells * avgShelfPrice * 0.15; // Estimated 15% conversion

    // Category engagement distribution (estimated based on position scores)
    const totalPositionWeight = categoryBreakdown.reduce((sum, c) => sum + (c.avgPositionScore * c.slotCount), 0);
    const categoryEngagement = categoryBreakdown.map(cat => ({
      category: cat.category,
      estimatedEngagementShare: totalPositionWeight > 0 
        ? ((cat.avgPositionScore * cat.slotCount) / totalPositionWeight) * 100 
        : 0,
      estimatedDwells: totalPositionWeight > 0
        ? Math.round(totalDwells * (cat.avgPositionScore * cat.slotCount) / totalPositionWeight)
        : 0,
      estimatedRevenue: totalPositionWeight > 0
        ? engagementValue * (cat.avgPositionScore * cat.slotCount) / totalPositionWeight
        : 0,
    }));

    // Brand efficiency index
    const brandEfficiency = brandBreakdown.map(brand => ({
      brand: brand.brand,
      shareOfShelf: brand.shareOfShelf,
      // Estimate share of engagement based on position quality
      estimatedShareOfEngagement: totalPositionWeight > 0
        ? (brand.avgPositionScore * brand.slotCount / totalPositionWeight) * 100
        : brand.shareOfShelf,
      efficiencyIndex: brand.shareOfShelf > 0
        ? ((brand.avgPositionScore / 50) * 100) / brand.shareOfShelf
        : 0,
    }));

    return {
      shelfId,
      planogramId,
      
      // Basic zone KPIs
      ...zoneKPIs,
      
      // Shelf-specific KPIs
      browsingRate: Math.round(browsingRate * 10) / 10,
      avgBrowseTime: Math.round(avgBrowseTime),
      passbyCount,
      
      // Planogram data
      planogramData: {
        totalSlots: enrichedData.totalSlots,
        occupiedSlots: enrichedData.occupiedSlots,
        occupancyRate: (enrichedData.occupiedSlots / enrichedData.totalSlots) * 100,
        numLevels: enrichedData.numLevels,
        slotsPerLevel: enrichedData.slotsPerLevel,
      },
      
      // Category breakdown
      categoryBreakdown,
      categoryEngagement,
      
      // Brand breakdown
      brandBreakdown,
      brandEfficiency,
      
      // Heatmap
      slotHeatmap,
      
      // Revenue estimates
      revenueMetrics: {
        avgShelfPrice: Math.round(avgShelfPrice * 100) / 100,
        estimatedEngagementValue: Math.round(engagementValue * 100) / 100,
        revenuePerVisit: totalVisits > 0 ? Math.round((engagementValue / totalVisits) * 100) / 100 : 0,
      },
    };
  }

  /**
   * Compare same category across multiple shelves
   */
  compareCategoryAcrossShelves(venueId, planogramId, category) {
    // Get all shelf planograms for this planogram
    const shelfPlanograms = shelfPlanogramQueries.getByPlanogramId(this.db, planogramId);
    
    const comparison = [];
    
    for (const sp of shelfPlanograms) {
      const enrichedData = this.getEnrichedShelfData(planogramId, sp.shelfId);
      if (!enrichedData) continue;
      
      const categoryBreakdown = this.getCategoryBreakdown(enrichedData);
      const categoryData = categoryBreakdown.find(c => c.category === category);
      
      if (categoryData) {
        comparison.push({
          shelfId: sp.shelfId,
          ...categoryData,
        });
      }
    }
    
    return comparison.sort((a, b) => b.avgPositionScore - a.avgPositionScore);
  }

  /**
   * Get SKU-level analytics
   */
  getSkuAnalytics(enrichedShelfData, skuCode) {
    if (!enrichedShelfData) return null;

    const skuPositions = [];
    
    enrichedShelfData.levels?.forEach(level => {
      level.slots?.forEach(slot => {
        if (slot.sku?.skuCode === skuCode) {
          skuPositions.push({
            levelIndex: level.levelIndex,
            levelType: level.levelType,
            slotIndex: slot.slotIndex,
            slotType: slot.slotType,
            positionScore: slot.positionScore,
            facingSpan: slot.facingSpan,
          });
        }
      });
    });

    if (skuPositions.length === 0) return null;

    const sku = Object.values(enrichedShelfData.skuDetails).find(s => s.skuCode === skuCode);
    
    return {
      skuCode,
      name: sku?.name,
      brand: sku?.brand,
      category: sku?.category,
      subcategory: sku?.subcategory,
      price: sku?.price,
      margin: sku?.margin,
      totalFacings: skuPositions.reduce((sum, p) => sum + p.facingSpan, 0),
      positions: skuPositions,
      avgPositionScore: skuPositions.reduce((sum, p) => sum + p.positionScore, 0) / skuPositions.length,
      bestPosition: skuPositions.reduce((best, p) => p.positionScore > best.positionScore ? p : best),
      worstPosition: skuPositions.reduce((worst, p) => p.positionScore < worst.positionScore ? p : worst),
    };
  }
}

export default ShelfKPIEnricher;
