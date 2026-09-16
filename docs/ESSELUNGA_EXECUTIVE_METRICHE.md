# Esselunga Executive — catalogo metriche e calcoli

**Aggiornato 16 settembre 2026.** Le formule sotto il banner «Deprecato» (sezioni 1–…) sono il calcolo precedente su `zone_visits` / `queue_sessions`. Non usarle per il report giornaliero.

---

## 0. Calcolo affidabile (daily_kpi) — vigente

Le tre superfici (tab Esselunga Executive, template Store Director v2, PDF serale) leggono **`daily_kpi`**, calcolato una volta al giorno dal parquet LiDAR 10 Hz con le formule Journey Lab. Non usano `zone_visits`, `queue_sessions` né `ingress_perimeter_crossings`.

| Superficie | Endpoint |
|---|---|
| Tab Esselunga Executive | `GET /api/reporting/daily-kpi?venueId=&day=` |
| Store Director v2 | stesso payload, widget `*-v2` / `department-minutes` / … |
| PDF | `GET /api/reporting/esselunga-executive/pdf` — **solo** `daily_kpi`; 409 se manca o headline `unreliable` |
| Trend | `GET /api/reporting/daily-kpi/range?venueId=&from=&to=` |

Job: `scripts/daily-customer-kpi.py` via `scripts/hyperspace-daily-customer-kpi.sh` alle **04:30 UTC**. Backfill: `hyperspace-daily-customer-kpi.sh FROM TO`. PDF: `scripts/hyperspace-daily-executive-report.sh` **dopo** il job; esce non-zero se `daily_kpi` manca.

Soglie in `analysis/journey_lab/config/treviglio.json` (`phantom_filter`, `checkout_fixed_object`, `daily_kpi_checks`, `known_uncovered_rois`). Non cambiarle senza registrarle lì.

### 0.1 KPI contrattuali

| `kpi_id` | Etichetta | Come si calcola | Controlli |
|---|---|---|---|
| `entrances` | MEASURED | Id VALID (+ STATIC_SUSPECT) con visita grezza nell’ROI ENTRANCE, ore 08:00–20:00 Roma | `phantom_share`, `stream_gap` |
| `visit_min` | ESTIMATED | Persone-minuto in negozio ÷ ingressi (Little) | `little`, `visit_range` |
| `people_mean` | MEASURED | Persone-minuto ÷ 720 | `little`, `visit_range`, `phantom_share`, `stream_gap` |
| `people_max` | MEASURED | Max occupazione media al minuto (parquet); `not_computed` se assente | `phantom_share`, `stream_gap` |
| `presence_per_minute` | MEASURED | Serie 1 min; `not_computed` senza parquet | `phantom_share`, `stream_gap` |
| `entrances_per_15min` | MEASURED | Serie 15 min; `not_computed` senza parquet | — |
| `minutes_per_customer_by_dept` | ESTIMATED | Persone-minuto nel reparto ÷ ingressi della fascia. Include Corsie / fuori zona, Scaffali senza categoria, Coda cassa, Cassa (servizio) | `little`, `zero_observation` |
| `queue_wait_min_per_entrance` | ESTIMATED | WAITING person-min in CHECKOUT_QUEUE ÷ ingressi. Esclusi FIXED (≥600 s o frammento ≤1,2 m) e TRANSIT (≥0,5 m/s) | `fixed_queue` |
| `service_min_per_entrance` | ESTIMATED | Stesso, CHECKOUT_SERVICE | `fixed_queue` |
| `queue_decomposition_per_lane` | MEASURED | FIXED / TRANSIT / WAITING person-min per cassa | `fixed_queue` |
| `first_department_after_entrance` | MEASURED | Transizioni da Ingresso (within-id + link inferiti se presenti) | — |
| `choice_index_by_dept` | MEASURED | Quota tempo fermo < 0,3 m/s; oggi spesso `not_computed` | — |
| `behaviour_share` / `behaviour_mix_by_slot` | ESTIMATED | `120_behaviour_clusters.py`; se troppo pesante: `unreliable` / `not_computed` | — |
| `heat_traffic` / `heat_still` | MEASURED | Griglia 1 m; `not_computed` se assente | — |
| `zero_observation_rois` | MEASURED | Reparti in `roi_dept` senza visite grezze | `zero_observation` |
| `quality` | MEASURED | rows, ids, valid_ids, phantom_rows_pct (41) | `phantom_share`, `stream_gap` |

Classi id (41, invariate): `PHANTOM_STATIC` ≥600 s in box 3 m; `STATIC_SUSPECT` ≥300 s in 1,5 m (tenuti come clienti); `PHANTOM_MICRO`; `FLICKER_SHORT`; `VALID`. In più, regola casse di 150: visita ≥600 s in un ROI cassa, più frammenti ≥60 s entro 1,2 m, esclusi da tutti i KPI.

### 0.2 Controlli (`daily_kpi_checks`)

| `check_id` | Passa se | KPI che diventano `unreliable` se fallisce |
|---|---|---|
| `little` | \|Σ minuti reparto + corsie − visit_min\| < 1 % per fascia | `visit_min`, `minutes_per_customer_by_dept`, `people_mean` |
| `visit_range` | visit_min tra 10 e 60 min | `visit_min`, `people_mean` |
| `phantom_share` | quota fantasmi 10–35 % delle obs in orario | `quality`, `entrances`, `people_mean`, `people_max`, `presence_per_minute` |
| `zero_observation` | nessun ROI/reparto a zero fuori da `known_uncovered_rois` (Pane, Salumi, Gastronomia) | `minutes_per_customer_by_dept`, `zero_observation_rois` |
| `fixed_queue` | contaminazione FIXED residua nel KPI < 5 % (il KPI usa solo WAITING) | coda / servizio / decomposizione |
| `stream_gap` | buco raw ≤ 60 s in orario (skip in assemble-only) | occupancy / ingressi / quality |

Un tile `unreliable` si mostra come **—** con `status_reason` in tooltip. Non si interpola.

### 0.3 Accettazione 2026-09-14 Treviglio (`55fdd53b-3298-4355-97c0-b4e789b11d06`)

Ingressi 2177 ± 1 %; visit_min 23,5 ± 0,2; people_mean 71 ± 1; people_max 117 ± 2 (parquet); coda 0,59 ± 0,02 (fascia 18–20: 0,90 ± 0,03); servizio 0,36 ± 0,02; Verdura 0,60 / Surgelati 0,58 / Frutta 0,53 / Corsie 16,0 (± 0,03); primo reparto Frutta 91 %; zero = {Pane, Salumi, Gastronomia}. Test: `backend/tests/dailyKpi.test.js` (assemble sempre; parquet skip se assente).

---

## Deprecato dal 16 settembre 2026 — calcolo precedente

Quanto segue descrive `computeExecutiveJourney` + widget `legacy-*`. Resta nel registry per confronto. **Non è il report giornaliero.**

Documento di riferimento storico per **Business Reporting → Esselunga Executive**, il template **My dashboards → Store Director**, e il **PDF executive inviato ogni sera**.

Stato allineato al codice precedente (`computeExecutiveJourney` + `EsselungaExecutivePdf`) e al report del 14 settembre 2026.

Le tre superfici **leggevano** lo stesso payload. Il cron serale **non deve più** chiamare `/api/reporting/summary?personaId=esselunga-executive` per il PDF.

| Superficie | Cosa mostra | Endpoint |
|---|---|---|
| Tab **Esselunga Executive** | Report completo (headline, fresco, corsie, casse, floor, insights) | `GET /api/reporting/summary` `personaId=esselunga-executive` |
| **My dashboards → Store Director** | Stesso journey, a widget | Stesso payload (solo i widget del layout) |
| **PDF giornaliero** | Stesso journey, pagine fisse + glossario | `GET /api/reporting/esselunga-executive/pdf` |

Script: `scripts/hyperspace-daily-executive-report.sh`. Finestra: mezzanotte locale → ora di invio, timezone `Europe/Rome`. Destinatario: `REPORT_EMAIL`. Copia su disco: `/data/hyperspace/reports/esselunga-executive-YYYY-MM-DD.pdf`, retention 90 giorni.

---

## 1. Principi che valgono per tutti i numeri

### 1.1 Cosa si misura

Traiettorie LiDAR anonime. **Non** volti, carrelli POS, scontrini (salvo ERP caricato a parte). Un `track_key` è un’identità del tracker, non una persona certificata: il feed perde e riacquisisce lo stesso corpo (vita mediana ~13 s). Per questo i *crossing* sono sempre più dei visitatori veri.

### 1.2 Filtri comuni

- Esclusi i track `cashier*` (personale alle casse).
- Un **crossing** è un ingresso in ROI con `duration_ms ≥ 300` ms (`minVisitMs`).
- Soglie executive lette da `duration_ms` **al momento della query**, non dal flag storico `is_dwell` (a Treviglio quel flag è a 20 s, calibrato sul tick vecchio).

### 1.3 Soglie contrattuali (default Esselunga)

| Soglia | Default | Uso |
|---|---|---|
| Stopping power | **5 s** | Pausa che conta come stop in corsia / crossing |
| Engagement rank | **15 s** | Barra per **ordinare** i fixture (più selettiva del 5 s) |
| Engagement “lungo” | **30 s** (venue) | `engagementVisits` interno; non è il numero in headline |
| Queue floor | **10 s** | Sotto, è un passaggio davanti alla cassa, non una coda |
| Bande dwell | **5 / 10 / 20 / 60 s** | Cinque fasce di durata |
| Crossing minimo | **300 ms** | Rumore sotto questa durata |

Queste soglie **non** coincidono con `venues.default_dwell_threshold_sec` (operativo, 20 s a Treviglio). Cambiare quella colonna ricalcolerebbe funnels, DOOH e replay; il report executive usa i 5 s del brief.

### 1.4 Confronto “vs last week”

- Finestra identica **7 giorni prima** (il traffico è a forma di giorno della settimana).
- Calcolato **solo se la finestra richiesta è ≤ 36 ore**. Su 7 giorni il delta non viene ricalcolato (raddoppierebbe il tempo).
- Se la settimana precedente cade prima del **6 agosto 2026, 00:00 Europe/Rome** (`MEASUREMENT_EPOCH`), i delta sono **omessi**: quel giorno è cambiato sia il dwell (da tick 5 s a frame-rate) sia l’ingest (non dipende più dal browser aperto). Un +118% vs pre-fix sarebbe un artefatto di misura.

Delta: `((oggi − prima) / prima) × 100`, arrotondato a 1 decimale. Per **Checkout wait** `higherIsBetter = false` (salire è un problema).

### 1.5 24 ore vs 7 giorni (stessi tile, orologi diversi)

| | Finestra ≤ 36 h | Finestra > 36 h (7d / 30d) |
|---|---|---|
| Shopping dwell | Sessioni cucite (ingresso → scaffali, 30 s–90 min) | Somma `zone_visits` shopping per `track_key` |
| Category dwell / stopping fresco | Geometria 2,0 m / 0,5 m su `track_positions` | Fallback su episodi / crossing di poligono |
| Occupancy Operations Pulse | Frame LiDAR (`track_positions`) | Snapshot `zone_occupancy` |
| Confronto vs settimana scorsa | Sì | No |

I tile restano gli stessi; su 7 giorni alcuni orologi sono più economici per non far timeout la dashboard.

---

## 2. Headline (riga dei quattro numeri)

Presente su: tab Esselunga, widget **Esselunga headline**, pagina 1 del PDF.

La frase in alto (`headline`) è generata dal server: entranti, stopping power, attesa casse, con i delta. Il tono (`good` / `warn` / `bad`) scatta se gli entranti scendono >10% / >25%, se lo stopping scende >15%, o se l’attesa supera 5 / 10 minuti.

### 2.1 Entrants

| | |
|---|---|
| **Cosa è** | Eventi di attraversamento del perimetro ingresso (Entrance 1121). |
| **Non è** | Visitatori unici. Un andirivieni conta due volte. |
| **Tabella** | `ingress_perimeter_crossings` |
| **Filtro** | `roi_id` delle zone traffico del venue, `crossed_at` nella finestra |
| **Formula** | `COUNT(*)` (eventi). A lato si tiene anche `COUNT(DISTINCT track_key)` ma **non** è il numero in headline. |
| **Metodo** | `perimeter_crossing` — il trail deve tagliare il bordo del rettangolo, non bastare “essere dentro”. |

### 2.2 Stopping power

| | |
|---|---|
| **Cosa è** | Quota di **crossing di corsia grocery** (group `aisles`) con `duration_ms ≥ 5 s`. |
| **Formula** | `dwellVisits / visits × 100` sulle ROI classificate `aisles`. |
| **Visit** | Ogni riga `zone_visits` (non persona). Un shopper frammentato genera più crossing. |
| **Hint UI** | “aisle crossings with a pause over 5s”. |

Non include i banchi fresco (quelli hanno un stopping geometrico, §5).

### 2.3 Shopping dwell

| | |
|---|---|
| **Cosa è** | **Mediana** del tempo passato in zone shopping (corsie + fresco) per visita. |
| **Non è** | Tempo ingresso→uscita del negozio. È un ordine di grandezza più corto. |
| **Unità UI** | minuti (`1.1m`, `2.3m`). |
| **Affidabile se** | almeno 10 visite valide. Altrimenti la tile mostra “—”. |

**≤ 36 h (session stitch)**

1. Si caricano i `zone_visits` del giorno e si cuciono in sessioni ancorate all’ingresso (gap re-ID allargato, ingresso breve ≥ 300 ms).
2. Per ogni sessione si somma `duration_ms` nelle ROI shopping.
3. Si tengono solo totali tra **30 s e 90 min**.
4. Headline = **mediana** di quella lista (non la media). Si calcolano anche p25 / p75.

**> 36 h**

```
SUM(duration_ms) per track_key
  WHERE roi IN (aisles ∪ fresco)
    AND 30s ≤ somma ≤ 90 min
mediana delle somme
```

Metodo esposto: `shopping_zone_sum`.

### 2.4 Checkout wait

| | |
|---|---|
| **Cosa è** | Media delle attese **completate** sulle corsie mappate. |
| **Tabella** | `queue_sessions` |
| **Filtro** | `waiting_time_ms ≥ 10 s`, `queue_entry_time` nella finestra |
| **Media** | solo sessioni `is_abandoned = 0`: `Σ waiting_time_ms / completed` |
| **Display** | secondi se < 60 s (`26s`), altrimenti `Xm YYs`. |

Quattro crossing su cinque della zona cassa durano < 5 s (gente che passa). Senza il floor da 10 s la media crollava a ~4 s e nessun store manager ci credeva.

Headline wait = media **tra i canali** (Traditional, self-checkout, …), non tra le singole lane.

### 2.5 Average basket / Space yield (solo con ERP)

Se è stato caricato un CSV POS/ERP per il periodo:

- **Average basket** = ricavo / transazioni (`€`).
- **Space yield (SPI)** = `ricavo / (m² × ore di dwell)`, dove `ore di dwell = (shoppingDwellMin × entrants) / 60`. Se manca la superficie, fallback `ricavo / shoppingDwellMin`.

Senza ERP queste tile non compaiono.

---

## 3. Store rhythm

Widget **Store rhythm** / grafico “Rhythm of the trading day” nel PDF.

Due serie **indipendenti** (non un funnel):

| Serie | Sorgente | Cosa conta |
|---|---|---|
| **Entrants** | `ingress_perimeter_crossings` | Crossing perimetro per bucket |
| **Stops** | `zone_visits` corsie + fresco con `duration_ms ≥ dwellMs` (5 s) | Stop a scaffale per bucket |

- Finestra ≤ 36 h: barre **orarie** nel TZ del punto (`Europe/Rome`), solo ore di apertura (default 08:00–20:00).
- Finestra più larga: barre **giornaliere**.
- Ogni serie ha il proprio asse Y (così la forma del giorno resta leggibile).
- Hover: entrambi i conteggi + stop rate del bucket.

“In store now” sul floor visual **non** è questa serie: è il conteggio live del frame LiDAR (§8).

---

## 4. Corsie e categorie (Aisle summary / Journey at a glance)

Widget **Aisle summary stats** e anelli PDF “Journey at a glance”.

Tutti i crossing di ROI `classification.group === 'aisles'`, escluso fresco.

| KPI | Formula | Note |
|---|---|---|
| **Stopping power** | `crossing con duration ≥ 5 s / crossing × 100` | Stesso numero della headline |
| **Engagement (held past 15s)** | `crossing con duration ≥ 15 s / crossing × 100` | Per **rankare** i fixture; a 5 s quasi tutte le zone sono uguali |
| **Pass-through** | `100 − stopping power` | Crossing che **non** sono diventati stop |
| **Penetration** | `track_key visti in ingresso ∩ visti in aisle∪fresco / track_key in ingresso × 100` | Affidabile se ≥ 30 track in ingresso |
| **Bypass** | `100 − penetration` | “Mai visti in corsia o fresco” |
| **Mean dwell (per zona)** | `Σ duration_ms / unique track_key` | **Senza** minimo. Limitare ai long-stay alza il numero e appiattisce le differenze |
| **Bande** | quota crossing in `<5s`, `5–10`, `10–20`, `20–60`, `≥60` | Due zone con la stessa media possono avere forme opposte |

### 4.1 Tabella categorie (Category traffic bars)

Per categoria di scaffale (Surgelati, Bar, …), aggregando le ROI aisle taggate:

- **Zones** = ROI mappate.
- **Crossings** = `COUNT(*)` `zone_visits`.
- **Stopping** = stopping power della categoria.
- **Held 15s** = engagement rank.
- **Avg dwell** = mean dwell di cui sopra, oppure (su ≤36 h, se il campione geometrico è ≥ 15 episodi) **mediana del tempo entro 2,0 m** dello scaffale.

Le categorie `Uncategorized` / `No content available` sono filtrate: se compaiono in classifica è un buco dello shelf mapper, non un reparto vero.

### 4.2 Top aisle

Prime 8 ROI aisle per crossing. Usate negli insight (“Top aisle: Shelf 15 – Engagement (Left)”).

---

## 5. Piazza del Fresco

Widget **Piazza del Fresco cards** e tabella PDF pagina 2. Reparti: Verdura, Pane, Carne, Latticini, Pesce, Salumi, …

### 5.1 Come si misura il tempo al banco (≤ 36 h)

Distanza del punto LiDAR all’unione dei poligoni del reparto:

```
        corsia          2,0 m              0,5 m         fronte
   C  pass-by   |  B  category dwell  |  A  engagement  |  SCAFFALE
```

| Orologio | Raggio | Significato |
|---|---|---|
| **Category dwell** | ≤ **2,0 m** | Tempo “nella categoria” (decisione vicina). Lasciare il fronte **non** chiude il dwell. |
| **Engagement** | ≤ **0,5 m** *oppure dentro* il poligono | Tempo al fronte (prendi / leggi). È **annidato** nel category dwell. |
| **Stopping** | un episodio dwell 2 m che ha toccato almeno una volta il raggio 0,5 m | “È arrivato al banco”, non solo ha sfiorato la corsia |

Parametri default (studio Treviglio 11 agosto 2026):

- gap chiusura dwell 3 s, stitch 8 s, durata minima dwell 2 s
- gap engagement 1 s, minimo 0,5 s
- identità: `original_perception_id` (raw), per non gonfiare gli orologi se Luca over-merge

Headline **Category dwell** = mediana del dwell 2 m **solo tra gli episodi che hanno engagement** (i stop). Non la media di chi passa a 2 m.

Su **7 giorni** questa geometria non gira (`track_positions` è troppo pesante). Si ricade su episodi di poligono (frammenti `zone_visits` ricuciti nella stessa ROI).

### 5.2 Colonne della tabella fresco

| Colonna | Calcolo |
|---|---|
| **Crossings** | `COUNT(*)` `zone_visits` nelle ROI del reparto. Il tracker spezza ~1 volta a visita: è **sopra** le visite vere. |
| **Stops** | Episodi (o crossing) che raggiungono il fronte / superano i 5 s nel fallback |
| **Stopping %** | `stops / category-dwell-episodes × 100` (geometria) oppure `dwellVisits / visits` (fallback) |
| **Category dwell** | Mediana secondi a 2,0 m tra gli stop. `null` se < 15 episodi o < 30 crossing |
| **Engagement** | Mediana secondi a 0,5 m |
| **In queue** | `waitingPct` se esistono zone coda del banco; altrimenti “—” |

Un reparto è **reportable** solo con ≥ 30 crossing. Sotto, stopping e dwell restano vuoti (es. Salumi con 1 crossing nel PDF del 14/09).

Durate **quantizzate a 5 s** (pipeline pre-6 agosto): la mediana non è pubblicata (`dwellUnavailableReason = quantised_durations`). Tutti i banchi darebbero 15 s perché il righello aveva tre tacche.

---

## 6. Checkout

Widget **Checkout channels** e blocco casse del PDF.

### 6.1 Canale (Traditional, …)

Da `queue_sessions` con floor 10 s, aggregate per ROI del canale:

| Campo | Formula |
|---|---|
| **Completed / Done** | sessioni `is_abandoned = 0` |
| **Sessions** | tutte le sessioni ≥ 10 s |
| **Avg wait** | `Σ wait_ms_completed / completed` → secondi |
| **Abandon** | `abandoned / sessions × 100` |
| **Friction** | `avgWaitMin / shoppingDwellMin` (es. 0,4 = la coda è il 40% del tempo a scaffale) |
| **In queue now** | occupancy live delle zone Queue (non storico) |

### 6.2 Lane (corsia singola)

Stessa statistica per `queue_zone_id`. Il PDF elenca le lane con attesa più lunga. Ogni riga della tabella “Shoppers queued per lane” è **quante persone sono entrate in quella coda** nel periodo, non la lunghezza istantanea (quella è “N in queue now”).

---

## 7. Insights (“What to act on”)

Massimo 3 card, generate sul server. Non sono LLM: regole fisse.

| Condizione | Titolo | Azione tipica |
|---|---|---|
| Un banco fresco ha `waitingPct > 15` | `{Reparto}: elevated waiting` | Review service counter staffing |
| Un canale cassa ha `abandonPct > 10` | `{Canale} abandon rate high` | Open additional lane or redirect to SCO |
| Penetration < 40% | Shopping-floor reach below target | Review layout and signage |
| SPI < 50 (se ERP) | SPI below benchmark | Cross-reference dwell vs vendite |
| CES media > 50 | Retail media performing well | Extend high-performing placements |

Il PDF del 14/09 mostra il terzo caso: penetration 15,5%, top aisle Shelf 15.

---

## 8. Floor visual (heatmap / people-flow)

Widget **Floor visual**. Nel PDF è l’appendice pagina 3 (tre still: footfall, dwell, streamlines).

| Vista | Cosa è | Cosa non è |
|---|---|---|
| **Heatmap** | Densità 3D di visite / dwell sulle ROI di categoria | Conteggio persone uniche |
| **Flow field** | Campo continuo (densità, dwell, direzione) dalle traiettorie | Conversione a scontrino |
| **In store now** | IDs distinti nel **frame LiDAR corrente** (MQTT `frameOccupancy`, fallback ultimo timestamp di `track_positions`) | Media del periodo. Aggiornamento ~10 s |

Il flow field del PDF è un campo pre-aggregato (giorni di trading, ore 07:00–22:00): “busiest tenth of cells”, coverage del pavimento camminabile, purity direzionale (corsie a doppio senso). I pin sulle still ripetono i numeri fresco / corsia / cassa già in tabella, non una seconda fonte.

---

## 9. My dashboards — catalogo widget e da dove nasce ogni numero

Il template **Store Director** (screenshot “My dashboard”) è un sottoinsieme del journey Esselunga. Gli altri template mischiano Operations Pulse / Executive / PEBLE.

### 9.1 Store Director (allineato alle foto)

| Widget | KPI / elemento | Sorgente di calcolo |
|---|---|---|
| Esselunga headline | Frase + Entrants, Stopping, Shopping dwell, Checkout wait | §2 |
| Floor visual | Heatmap / flow + In store now | §8 |
| Store rhythm | Entrants / Stops per ora o giorno | §3 |
| What to act on | Fino a 3 insight | §7 |
| Aisle summary | Stopping, engagement 15 s, pass-through, bypass / penetration | §4 |
| Checkout channels | Done, wait, abandon, friction, lane bars, in-queue-now | §6 |
| Category traffic bars | Crossing e dwell per categoria | §4.1 |

### 9.2 Altri widget della libreria (se li aggiungi al board)

**Operations Pulse** (non sono nel journey Esselunga; altra query `personaId=store-manager`):

| KPI | Calcolo |
|---|---|
| **In Store Now** | Stesso live frame del §8 |
| **Peak occupancy** | Max IDs distinti per frame (`track_positions`) in orario di apertura; su 7d usa snapshot `zone_occupancy` |
| **Typical shoppers / Avg occupancy** | Media degli stessi frame, solo frame con ≥ 15 ID (scarta heartbeat sparsi) |
| **Avg wait** | Come checkout wait, da `queue_sessions` |
| **Queue length** | `SUM(occupancy)` ultime zone `*Queue*` |
| **Abandon rate** | Abandoned / sessioni coda |
| **P95 wait** | 95° percentile sessioni completate (≥ 5 s in Pulse; ≥ 10 s in Executive) |
| **Throughput** | Sessioni completate / ore del periodo |
| **Space utilization** | Tempo occupato / tempo di apertura sulle aree target |
| **Dead zones** | ROI (no queue/service) con utilization < 1% |
| **Footfall by hour** | Crossing ingresso o occupancy per ora di apertura |

**Executive Summary / PEBLE** (se presenti):

| KPI | Calcolo |
|---|---|
| Store health pillars | Traffico / ops / merch / media dal persona executive |
| CES | Media `ces_score` su `dooh_campaign_kpis` nel periodo (solo campagne con controlli) |
| EAL | Media `lift_rel × 100` (exposure lift) |
| Campaign ranking | CES, EAL, AAR, exposures per campagna |

---

## 10. PDF offline — mappa pagina per pagina

File tipo `esselunga-executive-2026-09-14.pdf`. Stesso `headlineKpis` della dashboard.

**Pagina 1 — trading day**

- Venue, finestra locale, orario di generazione, badge WATCH
- Headline sentence
- 4 KPI (Entrants, Stopping power, Shopping dwell, Checkout wait) + delta
- Rhythm (entrants + shelf stops, ore di negozio)
- Journey at a glance (4 anelli + friction)
- Checkout snapshot per canale
- What to act on

**Pagina 2 — piano e casse**

- Legenda geometria 0,5 m / 2,0 m
- Tabella Piazza del Fresco
- Anelli corsie + bypass
- Tabella categorie
- Checkout per canale + lane più lunghe
- Glossario *How these numbers are defined* (testo fisso, soglie interpolate)

**Pagina 3 — people-flow**

- Footfall / dwell / streamlines sul plan
- Didascalie di concentrazione, soste, direzione

Download dalla UI: stesso renderer, query `mode=board` se si chiede solo i widget pubblicati.

---

## 11. Tassonomia ROI (perché un numero “sparisce”)

Ogni ROI è classificata in `ExecutiveZoneTaxonomy`:

| Group | Esempi Treviglio | Entra in |
|---|---|---|
| `ingress` | Entrance 1121 | Entrants, penetration denominatore |
| `aisles` | Shelf grocery (Surgelati, Bar, …) | Stopping power headline, categorie, pass-through |
| `fresco` | Verdura, Pane, Carne, Pesce, Latticini, Salumi | Tabella banchi, penetration numeratore |
| `checkout` | Queue / till Traditional | Wait, abandon, friction |

A Treviglio ~20 zone “Shelf” sono **fresco**, non grocery. Usare solo le aisle per la reach faceva crollare la penetration a ~14% mentre il piano shopping stava vicino al 58%. Oggi penetration = ingresso ∩ (**aisle ∪ fresco**).

---

## 12. Cosa questi numeri non sono

- **Entrants ≠ persone uniche del giorno.** Sono crossing del cancello.
- **Crossings ≠ visite.** Il tracker spezza; un corpo al banco è 4–5 `zone_visits`.
- **Shopping dwell ≠ tempo in negozio.** È tempo in zone tracciate / a scaffale.
- **Stopping power ≠ conversione a scontrino.** È una pausa ≥ 5 s sul crossing.
- **Penetration sottostima** se il re-ID muore tra porta e scaffale (stesso corpo, due `track_key`).
- **Checkout wait** ignora i passaggi < 10 s. Non è “tutti quelli che hanno toccato la zona cassa”.
- **In store now** è un fotogramma, non un KPI del periodo.
- I delta **7 giorni** in dashboard non esistono (solo finestre ≤ 36 h).

---

## 13. Sorgenti codice

| Pezzo | File |
|---|---|
| Orchestrazione journey | `backend/services/executive/ExecutiveJourneyService.js` |
| Soglie 5 / 15 / 10 s | `resolveExecutiveMetricThresholds` nello stesso file |
| Crossing per ROI | `buildRoiStatsIndex` |
| Entrants perimetro | `backend/lib/ingressPerimeterFootfall.js` |
| Shopping dwell sessioni | `backend/services/executive/ExecutiveSessionAnalytics.js` |
| Geometria 2 m / 0,5 m | `backend/services/executive/CategoryPresenceIndex.js`, `backend/config/categoryPresenceConfig.js` |
| Episodi frammento | `backend/services/executive/ZoneEpisodeIndex.js` |
| Classificazione ROI | `backend/services/executive/ExecutiveZoneTaxonomy.js` |
| Occupancy live | `backend/lib/liveStoreOccupancy.js` |
| PDF | `backend/services/executive/EsselungaExecutivePdf.js` |
| Cron serale | `scripts/hyperspace-daily-executive-report.sh` |
| Tooltip UI | `frontend/src/features/businessReporting/esselunga/kpiTooltips.ts` |
| Widget My dashboard | `frontend/src/features/businessReporting/dashboardBuilder/registry.ts` |
| Template Store Director | `frontend/src/features/businessReporting/dashboardBuilder/templates.ts` |

---

## 14. Esempio numerico (PDF 14 settembre 2026, Treviglio)

Finestra 00:00–23:30 Europe/Rome. Headline: 5.068 entranti (+118,2% vs settimana), stopping 34,5% (era 41,9%), shopping dwell 1,1 min, coda 26 s.

Verifica interna coerente col glossario:

- Pass-through = 100 − 34,5 = **65,5%**
- Bypass = 100 − 15,5 = **84,5%**
- Friction ≈ 26 s / 66 s ≈ **0,4**
- Engagement 15 s sulle aisle = **13,2%** (molto sotto lo stopping a 5 s: è voluto)
- Traditional: 1.701 completed, attesa 26 s, abandon 0%
- Verdura: 11.780 crossing, stopping 70%, category dwell 19 s, engagement 16 s
