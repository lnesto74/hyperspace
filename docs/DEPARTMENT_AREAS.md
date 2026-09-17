# Aree di reparto (Treviglio)

Le aree non sono i ROI a striscia da 1,5 m. Sono un raster di 0,25 m proposto dal digital twin e da confermare in negozio. Figura di riferimento: `analysis/journey_lab/out/2026-09-14/pres/R6_aree_reparto.png`.

## Come si costruiscono

1. **Banchi del reparto.** Oggetti `shelf` / `fridge` / `isola` / `banco` / `promo` / `tavolo` il cui poligono sta entro **0,35 m** dalle strisce `SHELF_ENGAGEMENT` di quel reparto. Un ROI senza dipartimento va in *Scaffali senza categoria*.
2. **Area.** Ogni cella di pavimento entro **3,0 m** da un banco del reparto. Il proprietario è il reparto la cui **striscia** è più vicina (non il banco: un frigo può toccare due strisce).
3. **Al banco.** Stessa cella, entro **1,0 m** dai banchi del proprietario, e velocità &lt; 0,4 m/s.
4. **Esclusi.** ROI coda e servizio cassa; ingresso + 1,0 m; strisce personale dietro i banchi (`STAFF_ONLY` / `staff_strips`). Non si usa la griglia di camminabilità di `70_topology.py`.

Codici: indice reparto; `-1` = *Corsie / fuori zona*; `-2` = *Ingresso, casse, retro banchi*.

Il raggio di 3 m e la tolleranza banco–striscia di 0,35 m stanno in `analysis/journey_lab/config/treviglio.json` (`department_areas`). Non cambiarli senza conferma del negozio.

## Personale

I minuti-persona del personale in sala (`staff_on_floor × minuti di fascia`) si tolgono prima dalle Corsie, e il resto da *Scaffali senza categoria* (area e al banco con lo stesso fattore). I reparti freschi non si toccano: il loro personale è già dietro il banco. Dopo la sottrazione la somma deve tornare a `visit_min` (Little) entro l’1 %.

## Cosa si pubblica

| `kpi_id` | Etichetta | Nota |
|---|---|---|
| `minutes_per_customer_by_dept_area` | MEASURED | minuti nell’area ÷ ingressi |
| `minutes_per_customer_by_dept_counter` | MEASURED | di cui al banco |
| `choice_index_by_dept` | MEASURED | al banco ÷ area. &lt; 0,25 attraversato, ≥ 0,4 lavorato |
| `department_area_m2` | MEASURED | celle osservate nel giorno |
| `minutes_per_customer_by_dept` | ESTIMATED | strisce 1,5 m, solo widget *legacy* |
