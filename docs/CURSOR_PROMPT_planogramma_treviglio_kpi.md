# CURSOR PROMPT — Planogramma Esselunga Treviglio (TEV) nel twin: posizioni, categorie e KPI per categoria/prodotto

**Data:** 16 ottobre 2026 · **Venue:** `55fdd53b-3298-4355-97c0-b4e789b11d06` (TREVIGLIO) · **Layout:** nuovo DWG `180TEV_Schematico` (già importato)
**Non fare deploy.** Lavora in locale e su staging. Il publish lo fai solo dopo l'OK di Luca, come sempre.

---

## 0. Cosa vogliamo ottenere (in una frase)

Ogni prodotto del planogramma Esselunga deve avere un punto preciso sulla pianta del twin e una categoria. In questo modo i KPI di percorso (visite, fermate, tempo nell'area, tempo al banco, scelta, attenzione) si possono leggere per **categoria** e, quando il dato regge, per **singolo prodotto**.

## 1. Input (già nel repo)

Cartella `data/planogram/TEV/2026-10-13/`:

| File | Cosa contiene |
|---|---|
| `Prodotti_TEV_13102026_ORIIENT.xlsx` | Export grezzo Blue Yonder del 13/10/2026: 17.861 righe, 15.963 articoli, 656 sezioni, 13 corsie. Il foglio `SQL` contiene la query che lo genera. |
| `TEV_planogramma_posizioni_categorie.csv` | Le stesse righe con le colonne già calcolate: posizione della sezione e del prodotto in coordinate DWG e venue, macro-categoria, sottocategoria, fonte della categoria, affidabilità. **È il riferimento atteso**: il tuo importer deve riprodurlo. |
| `categorie_mappa.csv` | Le 176 `DESC_CATEGORIA_ESPOSITIVA` con macro-categoria, reparto twin e tipo (merceologica o posizionale). |
| `fit_180TEV.json` | Parametri del fit planogramma → DWG. |

DXF del nuovo layout: `tmp/dwg_update/180TEV_Schematico.dxf`. Unità: cm (`$INSUNITS = 5`). Gondole nel layer `461_SCHEMATICO_0` / `461_*`.
Trasformazione DXF → venue: `tmp/dwg_update/transforms.json` → `new_dxf_m_to_venue = {tx: -48.7784, tz: 119.5685, flipZ: true}`.

### Significato delle colonne del planogramma (verificato sui dati, non indovinato)
- **`NUMERO_CORSIA`**: è il **passaggio**, non la gondola. Ogni corsia ha due colonne di sezioni a circa 240 cm l'una dall'altra, cioè i due fronti che si guardano. La corsia 0 è il perimetro, le avancasse e i self-checkout. La corsia 12 sono i surgelati.
- **`X_SEZIONE`, `Y_SEZIONE`** (cm): punto di partenza del modulo **sulla linea del fronte**. I moduli sono larghi **130 cm**, cioè il passo tra `X_SEZIONE` consecutive.
- **`X_ART`** (cm): **non** si misura dall'inizio del modulo, ma dall'inizio del planogramma della categoria. Arriva fino a 3.106 cm, per esempio nel petfood. Offset del prodotto nel modulo = `X_ART − (SEGMENTO_PLANOGRAM − 1) × 130`, limitato a [0, 130].
- **`Y_ART`** è l'altezza in cm. `ID_RIPIANO` è il ripiano. `LARG_ART × NUMERO_FILE` è l'ingombro frontale.
- **Coordinate intere vs decimali.** Le sezioni con decimali (es. 2309,74) sono agganciate al CAD. Quelle con numeri interi (es. 3025,0) sono state messe a mano in Blue Yonder. Sul vecchio DWG le interi cadevano in aree chiuse; sul nuovo `180TEV` combaciano. Tieni comunque un flag `coord_manual` per sezione.

## 2. Trasformazioni (risultato del fit sul nuovo DWG)

```
Planogramma (cm) → DWG 180TEV (cm):
  X_DWG = Y_SEZIONE + 5258.1
  Y_DWG = −X_SEZIONE + 14350.6        (rotazione 0,00°, nessuna scala, nessuna specchiatura)
DWG (cm) → venue (m):
  X_venue = X_DWG/100 − 48.7784
  Z_venue = −Y_DWG/100 + 119.5685
Posizione del prodotto lungo il fronte (in coordinate planogramma):
  X = X_SEZIONE + offset_nel_modulo + LARG_ART·NUMERO_FILE/2 ;  Y = Y_SEZIONE
```

Qualità del fit:
- distanza mediana dal bordo gondola **2,3 cm**; 90% delle sezioni entro 10 cm;
- tutte le corsie 1–12 sotto 8 cm, comprese 6 e 7, che sul vecchio DWG cadevano nell'area chiusa;
- 38 sezioni oltre 30 cm:
  - avancasse ~64 cm, uno scarto costante: probabilmente l'origine del modulo è diversa da quella del disegno cassa;
  - salse vetrina carne ~82 cm;
  - isola carne e isole piatti pronti ~1,6 m.

Righe per affidabilità: 17.327 ok · 516 da verificare · 18 fuori.

**Non fissare questi numeri nel codice.** Scrivi `scripts/planogram/fit_planogram_to_dxf.py`, che rifà il fit ogni volta dal DXF e dall'export:
- ICP sui bordi dei poligoni `461*`;
- prova le 8 combinazioni di assi/segni e una griglia di traslazioni;
- affinamento con Nelder-Mead e soglia di troncamento decrescente: 200 → 100 → 50 → 30 cm.

Il test deve fallire se la mediana supera 5 cm o se la rotazione supera 0,2°.

> **Attenzione al fit che scivola.** Le gondole sono lunghe 26 m: un fit che guarda solo la distanza perpendicolare può scivolare lungo l'asse senza aumentare l'errore. È già successo una volta: c'era un errore di 3,35 m in Z su un export precedente. Il controllo da fare: **le estremità delle gondole del planogramma devono coincidere con le estremità delle gondole del CAD nel venue**. Oggi le corsie vanno da Z ≈ 12,85 a 38,79 m, e le gondole del twin da 12,8 a 38,8 m. Aggiungi questo test.

## 3. Passi

### Passo 1 — Verifica dell'allineamento LiDAR ↔ layout (solo misura, nessuna modifica)
Ho fatto un controllo veloce sul 28/09 con `track_positions` (campioni da 3 s). I percorsi stanno fuori dalle gondole solo se le gondole si spostano di circa **+1,0 m in X e −0,5 m in Z**: i punti dentro le gondole scendono da circa 22.100 a circa 4.700. Lo stesso spostamento esce sia per il vecchio twin sia per il nuovo, quindi riguarda la `perceptionTransform` (origine x 21,5, ritoccata a mano il 29/05) e non il DWG.
- Ripeti il test sul **grezzo 10 Hz** (`hyperspace-raw-<giorno>.parquet`) di almeno 3 giorni: 14/09, 27/09, 28/09.
- Misura: numero di punti dentro i poligoni delle gondole lunghe al variare di (dx, dz) su una griglia da 0,25 m.
- Scrivi il risultato in `docs/TREVIGLIO_ALLINEAMENTO_LIDAR_LAYOUT.md`.
- **Non cambiare la `perceptionTransform`.** Lo decide Luca.
- Finché non è risolto, i KPI per singolo prodotto sono **STIMATO** (vedi passo 6). I KPI per categoria con raggio 1–3 m sono robusti a un errore di 1 m e vanno bene.

Controlla anche la **copertura LiDAR** della nuova area enoteca/vini a nord: nel venue sta a Z da −4 a 8 m. Nei percorsi del 28/09 i passaggi arrivano solo fino a Z ≈ 0. Se un'area non è coperta, i suoi KPI sono "non misurato", **mai zero**.

### Passo 2 — Catalogo articoli
- Importa gli articoli in `sku_catalogs` / `sku_items`. Esiste già `POST /sku-catalogs/import` in `backend/routes/planogram.js`; prima controlla se ci sono articoli Esselunga da `ScrapeGraphCatalogService` e **unisci per `sku_code = COD_ARTICOLO`**, senza duplicare.
- Campi:
  - `category` = MACRO_CATEGORIA;
  - `subcategory` = DESC_CATEGORIA_ESPOSITIVA;
  - `width_m` / `height_m` / `depth_m` da LARG/ALT/PROF in cm ÷ 100;
  - `meta_json` = `{fonte_categoria, sottocategoria, reparto_twin, planogram_export: "2026-10-13"}`.
- L'importer deve essere **idempotente e versionato** (`planograms.version`). Ogni nuovo export Esselunga va rilanciato senza perdere la storia. Di solito arriva lo stesso SQL del foglio `SQL`.

### Passo 3 — Sezione del planogramma → arredo del twin
- Nuova tabella `planogram_sections`, con migrazione in `backend/database/schema.js`. Colonne:
  - `id`, `planogram_id`, `venue_id`;
  - `corsia`, `posizione_corsia`, `spezzatura`, `categoria_espositiva`;
  - `x_venue`, `z_venue`, `shelf_id` (FK `venue_objects`), `facing`;
  - `along_start_m`, `dist_m`, `coord_manual`, `quality`.
- Per ogni sezione cerca l'arredo del nuovo layout (`venue_objects` con `metadata.source = 'dwg'`) con **il fronte entro 30 cm**.
- Il `facing` (front/back/left/right) si ricava portando il punto nel sistema locale dello scaffale con `worldToShelfLocal` di `backend/services/planogramSlotGeometry.js`.
- **Le gondole hanno due fronti.** Se il modello attuale (`shelf_planograms.slot_facings`, `getSlotFacings` usa solo `facings[0]`) non regge due facce per scaffale, estendilo:
  - aggiungi `facing` in ogni livello o slot di `slots_json`;
  - aggiorna `planogramSlotGeometry` sia nel backend sia nella copia del frontend (`frontend/src/components/planogram/planogramSlotGeometry.ts`);
  - mantieni la compatibilità all'indietro;
  - aggiungi test.
- Sezioni tra 30 cm e 1 m: le colleghi ma con `quality = 'da_verificare'`. Oltre 1 m: non le forzi e le metti in elenco nel report.

### Passo 4 — Riempire i planogrammi degli scaffali
- Crea il planogramma `Esselunga TEV 2026-10-13` (status `published`) per il venue e riempi `shelf_planograms`:
  - `num_levels` = numero di ripiani (`ID_RIPIANO` massimo sul modulo);
  - `slot_width_m = 0.10`;
  - gli slot occupati da ciascun articolo = [offset, offset + LARG_ART·NUMERO_FILE] lungo il fronte;
  - `skuItemId` = l'articolo del passo 2.
- Il resolver che esiste già (`backend/services/ShelfCategoryResolver.js`: prima il planogramma, poi `business_category` dell'oggetto) da qui in poi restituisce le categorie dal planogramma. Verifica che `GET /shelves/:shelfId/categories` le mostri.
- **Il prodotto non ha un ordine certo dentro il modulo.** L'export non contiene l'angolo del modulo (`FX.ANGLE`, `FX.WIDTH`, `FX.DEPTH`), quindi un fronte specchiato invertirebbe l'ordine dentro i 130 cm. L'errore massimo per prodotto è quindi **±130 cm lungo lo scaffale**, mentre il modulo resta giusto. Salva `position_precision_m = 1.3` nei metadati. Quando Esselunga aggiunge quei campi alla query (li abbiamo chiesti), il calcolo diventa esatto: prevedi già le colonne opzionali.

### Passo 5 — KPI per categoria (il risultato principale)
**Regola:** gli algoritmi di riferimento sono quelli **già verificati** del Visitor Journey (Business Reporting → Visitor Journey: `services/dailyKpi/*`, `scripts/daily_kpi/department_areas.py`, la porta del 199). **Non inventare nuove definizioni.** Riusa la stessa pipeline:
- le stesse regole su personale e fantasmi;
- lo stesso orario 08–20 a fasce di 2 ore;
- le stesse definizioni: "tempo nell'area" con `R_AREA = 3.0`, "al banco (tocca e sceglie)" con `R_BANCO = 1.0` e `V_SLOW = 0.4`, fermata ≥ 20 s, indice di scelta;
- gli stessi controlli (`checks.js`).

- **Lo strato reparti attuale non si tocca.** È verificato e alimenta le schede che vedono i clienti, comprese "Scaffali senza categoria" e "Corsie / fuori zona". Non cambiare raggi né ordine di rimozione del personale senza scriverlo in `config/treviglio.json`.
- Aggiungi un **secondo strato, "categoria"**, costruito come il raster reparti (`build_raster`), ma con l'owner della cella = il **segmento di fronte prodotto più vicino** e la sua categoria. Due livelli:
  - **macro** (circa 19 macro-categorie);
  - **categoria espositiva** (176 categorie).

  Nei passaggi da 2,4 m le celle si dividono sulla mezzeria tra i due fronti.
- I reparti freschi (Frutta, Verdura, Carne, Pesce, Pane, Gastronomia, Bar, Salumi al banco) non sono nel planogramma: nello strato categoria restano quelli dello strato reparti.
- **Nuovo controllo `category_areas_sum_equals_little`.** Lo strato categoria è una partizione, quindi la somma dei minuti di tutte le categorie, più corsie e reparti freschi, deve dare `visit_min` per fascia oraria con la stessa tolleranza (1%). Se il controllo fallisce, i KPI di categoria vanno a `unreliable`, come fa già `CHECK_DEPENDENCIES`.
- **Griglia e nuovo layout.** Il raster usa `MAP_X = 80`, `MAP_Z = 75` con origine 0, ma la nuova enoteca arriva a Z ≈ −4. Ricava i limiti dal venue e dagli oggetti, non da costanti, altrimenti `np.clip` schiaccia quelle celle sul bordo. Aggiorna `geometry_hash` e il controllo `raster_hash_matches_twin`.
- Output in `daily_kpi`, una riga per (giorno, fascia, livello, categoria):
  - visite;
  - fermate;
  - quota delle visite diventate fermata;
  - minuti per cliente nell'area;
  - minuti al banco;
  - indice di scelta;
  - persone medie;
  - stato `MISURATO` / `STIMATO` / `unreliable` / `non misurato`.

### Passo 6 — KPI per singolo prodotto
- Esiste già `backend/services/SkuSlotMetricsEngine.js` (Attraction / Attention per slot, `DEFAULT_SKU_PROXIMITY`: dAudience 2,5 m, dAttract 1,2 m, dSlot 0,8 m). Fallo girare sul planogramma TEV.
- Il KPI di un prodotto si mostra **solo se**:
  - la sua categoria ha un campione sufficiente (stesse soglie minime dei reparti);
  - `quality = 'ok'`.
- Finché l'allineamento LiDAR del passo 1 non è risolto e mancano gli angoli dei moduli, tutti i KPI per prodotto sono **STIMATO**. La UI deve dirlo in chiaro e proporre per default la vista per categoria.
- Lo stato si eredita in quest'ordine: categoria `unreliable` → prodotto `unreliable`.

### Passo 7 — Categorie mancanti o "di posizione"
- Tutte le righe hanno una categoria, ma **22 categorie descrivono un posto e non un tipo di prodotto**: AVANCASSA 01–11, SELF-CHECKOUT 01–10, ISOLE PIATTI PRONTI. Per esempio ISOLE PIATTI PRONTI contiene vini e AVANCASSA contiene borse, caramelle e snack.
- Per queste la categoria va **inferita dal nome dell'articolo**. Le regole che ho usato sono nel CSV: `FONTE_CATEGORIA = 'inferita dal nome prodotto'`, 1.226 righe, di cui 129 restano "Impulso avancassa (non classificato)".
- Mettile in `backend/config/planogramCategoryRules.js` (regex → macro, sottocategoria) e coprile con test.
- Ordine di fallback per qualunque articolo senza categoria o con una categoria segnaposto (`isRealCategory` di `ShelfCategoryResolver`):
  1. categoria merceologica del planogramma;
  2. regole sul nome;
  3. categoria del catalogo Esselunga online (`ScrapeGraphCatalogService`), se c'è;
  4. maggioranza dello stesso modulo;
  5. "Non classificato".
- **Una categoria inferita non va mai presentata come data da Esselunga.** Il campo `fonte_categoria` viaggia fino alla UI.
- Avancasse e self-checkout restano anche come **luogo** (zona cassa). La categoria inferita serve solo per i KPI di prodotto/categoria, non per spostare l'area.

### Passo 8 — UI (testi in inglese, come il resto del retail workspace)
- **Visitor Journey: nuova scheda "Categories".**
  - Mostra le macro-categorie con lo stesso formato delle schede reparto: una frase di verdetto, durate come "3 min 12 s", vuoto = vuoto.
  - Si scende alla categoria espositiva e da lì ai prodotti, con il badge MEASURED/ESTIMATED.
  - I nomi delle categorie Esselunga restano come sono (in italiano).
- **Twin / planogram viewport.** Colora i fronti per macro-categoria e aggiungi un'opzione "show planogram sections" con il colore di `quality`. Il riferimento visivo è la mappa `TEV_macro_categorie_venue.png` nella stessa cartella.
- **Media lens / totem.** Il simulatore oggi usa reparti come "Bakery & Breakfast". Aggiungi la scelta della categoria target dal planogramma: per esempio Totem 1 → BISCOTTI COMUNI / BISCOTTI FINI, corsia 6. Così CPM e "in-target viewers" si calcolano sui fronti reali della categoria.
- I widget legacy non si toccano.

### Passo 9 — Verifica e report
- Script `scripts/planogram/verify_tev.py`, che controlla:
  - le stesse righe e colonne del CSV di riferimento (tolleranza 1 cm sulle coordinate DWG, 0,01 m sul venue);
  - la categoria uguale per tutte le 17.861 righe;
  - il conteggio di affidabilità: 17.327 / 516 / 18.
- Test: fit (mediana, rotazione, estremità gondole), importer idempotente, due facce per scaffale, regole di categoria, controllo Little sullo strato categoria.
- Report `docs/TREVIGLIO_PLANOGRAMMA_KPI.md`, in italiano semplice:
  - cosa è stato collegato;
  - quante sezioni e quanti articoli;
  - cosa resta da verificare (avancasse a 64 cm, salse vetrina carne, isole);
  - l'esito del passo 1;
  - KPI per macro-categoria di un giorno (28/09), con lo stato.
- Screenshot della scheda Categories e del twin colorato.

## 4. Regole fisse (non negoziabili)
- Le analisi si fanno sul **grezzo LiDAR 10 Hz**, mai sulle tabelle campionate a 3 s / 10 s. Queste vanno bene solo per controlli rapidi, dichiarati come tali.
- Ogni KPI porta MISURATO o STIMATO. Ciò che non è coperto è "non misurato", non 0.
- Nel materiale per il cliente non si parla di frammentazione dei percorsi.
- Non cambiare la `perceptionTransform`, i raggi dei reparti o il rilevamento del personale senza l'OK di Luca.
- Niente deploy in produzione: preparo io il messaggio di publish dopo l'OK.

## 5. Cosa consegnare
1. Migrazione + `planogram_sections`, con estensione a due facce se serve.
2. `scripts/planogram/fit_planogram_to_dxf.py`, importer (`scripts/planogram/import_tev_planogram.py` o una route), `verify_tev.py`.
3. `backend/config/planogramCategoryRules.js`.
4. Strato categoria in `department_areas.py` / `dailyKpi`, con il nuovo controllo.
5. KPI per prodotto collegati a `SkuSlotMetricsEngine`, con gli stati.
6. UI: scheda Categories, colori del twin, scelta categoria nella media lens.
7. `docs/TREVIGLIO_ALLINEAMENTO_LIDAR_LAYOUT.md` e `docs/TREVIGLIO_PLANOGRAMMA_KPI.md`.
8. Elenco dei file toccati e comandi per rilanciare tutto con un nuovo export.
