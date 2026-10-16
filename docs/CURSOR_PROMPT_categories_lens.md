# CURSOR PROMPT — Lente "Categories" in Windflow: dati automatici, Visitor Journey come prima

**Data:** 16 ottobre 2026 · **Venue:** `55fdd53b-3298-4355-97c0-b4e789b11d06` (TREVIGLIO)
**Niente deploy** finché Luca non dà l'OK. Lavora in locale.

## 0. Cosa è già fatto (non rifarlo)
La lente esiste già nel working copy `~/CascadeProjects/Hyperspace` (Claude, 16/10). Tutti i 14 test di flowfield passano.
- `frontend/public/flowfield/lenses.js`: nuova lente 05 "Categories" con tre viste (Store / Aisle / Shelf (est.)); le lenti successive sono rinumerate da 06 a 10.
- `frontend/public/flowfield/workspace.js` e `workspace.css`, blocco "Categories · Esselunga planogram on the floor":
  - nastri sui fronti degli scaffali, colorati per macro-categoria, larghezza = KPI scelto;
  - grafico a quadranti, classifiche, vista frontale della corsia;
  - fronti tratteggiati dove la categoria non è misurata.
- Cache `v3-22`.
- `analysis/journey_lab/250_category_pack.py` scrive in `frontend/public/flowfield/categories/`:
  - `sections.json`: geometria dei 654 moduli del planogramma TEV sul pavimento;
  - `<day>.json`: le righe `category_kpi_macro` / `category_kpi_categoria` del giorno, **copiate così come sono** da daily_kpi, più le fermate lungo le corsie ogni 1,3 m;
  - `index.json`.
- Oggi ci sono i dati del 27/09 e del 28/09, presi da `tmp/daily-kpi-stage/...`.

**Non toccare** i KPI di categoria, la pipeline 199c, i raggi, il personale, la `perceptionTransform`, Engagement e Media.

## 1. Visitor Journey: la scheda "Categories" torna nascosta
Luca non la vuole nel Visitor Journey: i KPI di categoria si vedono in Windflow.
- In `frontend/src/features/businessReporting/clienteMedio/ClienteMedioPage.tsx` mostra la scheda solo con il flag `VITE_FEATURE_VJ_CATEGORIES=true` (default **false**). Questo vale sia per la tab sia per il pulsante della riga 273.
- Non cancellare `screens/Categories.tsx` né `lib/categories.ts`, e lasciane passare i test.
- Con il flag spento la pagina deve tornare identica a prima. Fai uno screenshot di controllo.

## 2. Dati della lente generati ogni giorno
Dopo che il job daily KPI ha salvato un giorno con righe `category_kpi_*` in stato ok, genera il file della lente:
```
python3 analysis/journey_lab/250_category_pack.py day <day> --db <sqlite di daily_kpi> [--rows <flow_rows del giorno>]
```
- Aggancialo in `backend/services/dailyKpi/computeDailyKpi.js`, dopo `attachProductKpi`. Un errore qui **non blocca** il giorno, come per i KPI di prodotto.
- `CAT_SITE`:
  - in produzione: `/data/reports/categories/<venue>/`, servita in sola lettura come `/api/windflow/categories/<file>` nella route `backend/routes/windflow.js`;
  - in locale: `frontend/public/flowfield/categories/`.
- **Fermate per modulo**: servono le righe al secondo del giorno (`230_flow_rows.py`). Se il servizio Windflow le ha già, passale con `--rows`, altrimenti salta l'opzione. Senza `modules` la lente mostra la vista frontale senza barre, ed è previsto.
- **Controllo Little**: in modalità `--db`, `250` non legge `checks`. Leggilo dal bundle del giorno, cioè la riga con il payload completo, e mettilo in `check`, così la lente lo mostra nell'evidenza.
- **`sections.json`** cambia solo con un nuovo planogramma: rigeneralo con `250_category_pack.py sections` quando l'importer TEV crea una nuova versione.
- **Frontend**: in `loadCat()` (workspace.js) prova prima `/api/windflow/categories/index.json`, poi il file statico `./categories/`, come già fa `loadReplay`. Non cambiare nient'altro nella lente.

## 3. Test
- Test Python di `250_category_pack.py`:
  - `sections` produce 654 sezioni e 176 categorie;
  - il file del giorno ha 1.162 righe di categoria per il 28/09;
  - le corsie 6 e 7 non hanno fermate: il sensore non le vede, i percorsi del 28/09 non hanno punti tra X 33,5 e 39 m.
- Test backend: un errore di `250` non fa fallire `computeDailyKpi`.
- Tutti i test di flowfield (`for t in frontend/public/flowfield/*.test.mjs; do node $t || exit 1; done`).
- Il typecheck del frontend non deve peggiorare. Gli errori `tsc` che esistono già non sono da sistemare qui.

## 4. Consegna
1. Elenco dei file toccati.
2. Screenshot:
   - Visitor Journey con il flag spento;
   - Windflow → Categories nelle viste Store e Aisle (corsia 4).
3. Una riga per Luca: "PRONTO PER IL DEPLOY" oppure "BLOCCATO · motivo".

Il deploy si fa con il prompt v7.1 (`docs/design/retail-ux-v3/DEPLOY_PROMPT_cursor_v7_all.md`) **dopo l'OK di Luca**. Aggiungi a quel prompt:
- `analysis/journey_lab/250_category_pack.py`;
- `frontend/public/flowfield/categories/`;
- il passo che copia `categories/` nella cartella dei report del droplet.
