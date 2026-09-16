import { expect, test } from '@playwright/test';

/**
 * Visual / interaction check for Cliente medio.
 * Run against the Vite QA page (no auth):
 *   cd frontend && npx vite --port 5173
 *   npx playwright test e2e/cliente-medio.spec.ts
 */
test.describe('Cliente medio dashboard', () => {
  test('shows the six KPI tiles and toggles a table', async ({ page }) => {
    await page.setViewportSize({ width: 1120, height: 900 });
    await page.goto('/cliente-medio-qa.html');
    await expect(page.getByTestId('cliente-medio')).toBeVisible();

    const kpis = page.getByTestId('cm-kpis');
    await expect(kpis.getByText('2.177', { exact: true })).toBeVisible();
    await expect(kpis.getByText('23,5', { exact: false })).toBeVisible();
    await expect(kpis.getByText('71', { exact: true })).toBeVisible();
    await expect(kpis.getByText('0,6', { exact: false })).toBeVisible();
    await expect(kpis.getByText('2.292', { exact: true })).toBeVisible();
    await expect(kpis.getByText('ingressi')).toBeVisible();
    await expect(kpis.getByText('durata media della visita')).toBeVisible();
    await expect(kpis.getByText('persone in negozio in media')).toBeVisible();
    await expect(kpis.getByText('coda per cliente')).toBeVisible();
    await expect(kpis.getByText('passaggi in cassa')).toBeVisible();
    await expect(kpis.getByText('del tempo fuori da ogni zona')).toBeVisible();

    const toggle = page.getByTestId('c_entr-toggle');
    await expect(toggle).toHaveText('Tabella');
    await toggle.click();
    await expect(toggle).toHaveText('Grafico');
    await expect(page.locator('[data-card="c_entr"] table')).toBeVisible();
    await expect(page.locator('[data-card="c_entr"] table')).toContainText('2.177');
  });
});
