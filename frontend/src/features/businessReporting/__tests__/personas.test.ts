/**
 * Tests for Business Reporting persona configuration
 */

// @ts-nocheck
// Test file - run with vitest if available
// import { describe, it, expect } from 'vitest';
import { 
  PERSONAS, 
  MAX_KPIS_PER_PERSONA, 
  enforceKpiCap,
  getPersonaById,
  VALID_PERSONA_IDS 
} from '../personas';

describe('Business Reporting Personas', () => {
  describe('KPI Cap Enforcement', () => {
    it('should have MAX_KPIS_PER_PERSONA set to 7', () => {
      expect(MAX_KPIS_PER_PERSONA).toBe(7);
    });

    it('should not exceed KPI cap for any persona', () => {
      for (const persona of PERSONAS) {
        expect(persona.kpis.length).toBeLessThanOrEqual(MAX_KPIS_PER_PERSONA);
      }
    });

    it('should truncate KPIs if exceeding cap', () => {
      const mockPersona = {
        id: 'test',
        name: 'Test',
        description: 'Test persona',
        icon: 'Store',
        color: '#000',
        maxKpis: MAX_KPIS_PER_PERSONA,
        kpis: Array(10).fill({
          id: 'test',
          title: 'Test',
          format: 'int' as const,
          meaning: 'Test',
          action: 'Test',
          tooltip: 'Test',
        }),
      };

      const capped = enforceKpiCap(mockPersona);
      expect(capped.length).toBe(MAX_KPIS_PER_PERSONA);
    });
  });

  describe('Persona Registry', () => {
    it('should have exactly 4 personas', () => {
      expect(PERSONAS.length).toBe(4);
    });

    it('should have valid persona IDs', () => {
      expect(VALID_PERSONA_IDS).toContain('store-manager');
      expect(VALID_PERSONA_IDS).toContain('merchandising');
      expect(VALID_PERSONA_IDS).toContain('retail-media');
      expect(VALID_PERSONA_IDS).toContain('executive');
    });

    it('should return persona by ID', () => {
      const persona = getPersonaById('store-manager');
      expect(persona).toBeDefined();
      expect(persona?.name).toBe('Operations Pulse');
    });

    it('should return undefined for invalid persona ID', () => {
      const persona = getPersonaById('invalid-id');
      expect(persona).toBeUndefined();
    });
  });

  describe('KPI Definitions', () => {
    it('should have required fields for each KPI', () => {
      for (const persona of PERSONAS) {
        for (const kpi of persona.kpis) {
          expect(kpi.id).toBeDefined();
          expect(kpi.title).toBeDefined();
          expect(kpi.format).toBeDefined();
          expect(kpi.meaning).toBeDefined();
          expect(kpi.action).toBeDefined();
          expect(kpi.tooltip).toBeDefined();
        }
      }
    });

    it('should have meaning <= 90 chars', () => {
      for (const persona of PERSONAS) {
        for (const kpi of persona.kpis) {
          expect(kpi.meaning.length).toBeLessThanOrEqual(90);
        }
      }
    });

    it('should have action <= 90 chars', () => {
      for (const persona of PERSONAS) {
        for (const kpi of persona.kpis) {
          expect(kpi.action.length).toBeLessThanOrEqual(90);
        }
      }
    });

    it('should have tooltip <= 160 chars', () => {
      for (const persona of PERSONAS) {
        for (const kpi of persona.kpis) {
          expect(kpi.tooltip.length).toBeLessThanOrEqual(160);
        }
      }
    });
  });

  describe('Store Manager Persona', () => {
    it('should have exactly 7 KPIs', () => {
      const persona = getPersonaById('store-manager');
      expect(persona?.kpis.length).toBe(7);
    });

    it('should include queue KPIs', () => {
      const persona = getPersonaById('store-manager');
      const kpiIds = persona?.kpis.map(k => k.id) || [];
      expect(kpiIds).toContain('avgWaitingTimeMin');
      expect(kpiIds).toContain('abandonRate');
      expect(kpiIds).toContain('currentQueueLength');
    });
  });

  describe('Retail Media Persona', () => {
    it('should have exactly 7 KPIs', () => {
      const persona = getPersonaById('retail-media');
      expect(persona?.kpis.length).toBe(7);
    });

    it('should include PEBLE KPIs', () => {
      const persona = getPersonaById('retail-media');
      const kpiIds = persona?.kpis.map(k => k.id) || [];
      expect(kpiIds).toContain('eal');
      expect(kpiIds).toContain('ces');
      expect(kpiIds).toContain('aqs');
      expect(kpiIds).toContain('aar');
    });
  });
});
