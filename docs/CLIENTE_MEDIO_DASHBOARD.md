# Cliente medio — lettura delle carte

Dashboard giornaliera in **Business Reporting → Cliente medio** (`personaId=esselunga-cliente-medio`). Una sola chiamata: `GET /api/reporting/daily-kpi?venueId=&day=`. Nessun ricalcolo in pagina, nessuna lettura di `zone_visits`, `queue_sessions`, `ingress_perimeter_crossings` o `/api/reporting/summary`.

Il selettore elenca ogni giorno dal 14 settembre 2026 (primo giorno calcolato) e apre sull’ultimo giorno presente in `daily_kpi`. Lo stesso selettore è su **Esselunga Executive → Store Director**. Se il giorno manca: *Non ancora calcolato per questo giorno*, con l’orario del job (04:30 UTC). Un KPI con `status=unreliable` si legge come **—**; il motivo sta nel tooltip.

## Come leggere ogni carta

| Carta | `kpi_id` | Etichetta in pagina | Frase |
| --- | --- | --- | --- |
| Ingressi | `entrances` | ingressi | Persone entrate dalla porta, contate una volta ciascuna (id VALID con visita raw in ingresso). |
| Durata visita | `visit_min` | durata media della visita | Persone-minuto in negozio ÷ ingressi (legge di Little). Stimato. |
| Presenza | `people_mean` (+ `people_max`) | persone in negozio in media | Persone-minuto ÷ 720 minuti di apertura. Il massimo è l’occupazione media al minuto, se il parquet è stato letto. |
| Coda | `queue_wait_min_per_entrance` | coda per cliente | Tempo WAITING in zona coda ÷ ingressi. Transito e oggetti fermi esclusi. |
| Passaggi in cassa | `checkout_passages` | passaggi in cassa | Id distinti visti nella zona servizio. |
| Ortofrutta | `minutes_per_customer_by_dept_area` Frutta+Verdura | in ortofrutta per cliente | Area 3 m; nota «di cui X al banco». |
| Ingressi per fascia | `entrances` per slot | Ingressi per fascia oraria | Stesso conteggio, sulle sei fasce 08–20. |
| Visita per fascia | `visit_min` per slot | Durata media della visita | Little per fascia (persone-minuto della fascia ÷ ingressi della fascia). |
| Minuti due livelli | `minutes_per_customer_by_dept_area` / `_counter` | Minuti per cliente per reparto | `hbars2`: scuro = al banco, chiaro = resto area. Tabella con persone/ingresso* e sosta mediana*. |
| Heatmap area | `minutes_per_customer_by_dept_area` per slot | Minuti nell'area per fascia | Stesso rapporto, reparto × fascia. |
| Heatmap banco | `minutes_per_customer_by_dept_counter` per slot | Minuti al banco per fascia | Solo fermo/lento entro 1 m. |
| Attesa banchi | `counter_wait_people_mean` | Attesa ai banchi serviti | Persone in media per fascia; sosta med/p90 e clienti serviti*. |
| Dove va dopo | `dept_next_area_share` | Matrice | Celle ≥ 10 transizioni. Non è un percorso multi-passo. |
| Direzione | `flow_field` | Frecce sul piano | n ≥ 200 e r ≥ 0,3. |
| Testate e promo | `promo_spot_counter_minutes` | Ranked bars | min / 1.000 ingressi. |
| Persone per reparto | `dept_stay_per_person` | chip STIMATO | Solo se la strategia di riconciliazione in post-processing passa i gate. |
| Coda per fascia | `queue_wait_min_per_entrance` / `service_min_per_entrance` | Coda cassa: minuti per cliente | Coda e servizio, minuti per cliente e per fascia. |
| Primo reparto | `first_department_after_entrance` | Primo reparto dopo l'ingresso | Passaggi misurati dentro lo stesso numero di traccia, in uscita dall’ingresso. |
| Attesa per cassa | `queue_decomposition_per_lane` | Attesa per cassa | Quota del tempo per corsia: in attesa / in transito / oggetto fermo. |
| Modi | `behaviour_share` | Modi di stare in negozio | Quota dei tratti ≥ 20 s (job 120). Stimato. Se manca: — e motivo. |
| Mix per fascia | `behaviour_mix_by_slot` (payload 120) | Mix per fascia oraria | Stessa tassonomia, per fascia. |
| Mix per reparto | `behaviour_share.dept_mix_time_share` | Cosa fa la gente in ogni reparto | Quota del tempo in zona, per modo. |
| Zone a zero | `zero_observation_rois` | Da verificare sul posto | Zone del twin senza nessuna osservazione raw. |

Non mostrati in questa pagina (restano nel payload): qualità del dato, vita media di un numero di traccia, ricuciture.

## Note

- MISURATO = il sensore l’ha visto. STIMATO = deriva da un rapporto (Little, quote).
- “Per cliente” non è “quota di persone”: è tempo totale ÷ ingressi.
- Il job notturno è `scripts/hyperspace-daily-customer-kpi.sh` alle 04:30 UTC.
- `people_max` è MEASURED solo se il job ha letto il parquet (occupazione al minuto). In assemble-only resta non calcolato; il fixture 2026-09-14 della pagina QA usa 117, il valore del canvas.
- QA senza login: `frontend/cliente-medio-qa.html` (`npx vite`, aprire `/cliente-medio-qa.html`). Playwright: `frontend/e2e/cliente-medio.spec.ts`.
