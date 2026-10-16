# Cursor prompt 7 — scarica tre giorni di Treviglio e lancia la catena Journey Lab

Esegui nel terminale del progetto, uno alla volta, SENZA modificare nessuno script.
Serve la rete Tailscale e la chiave SSH del Mac (root@100.76.196.2): se `ssh root@100.76.196.2 echo ok` non risponde, fermati e dimmelo.

## 1. Scarica i tre giorni (sabato, domenica, lunedì)

```bash
cd analysis/journey_lab
for D in 2026-09-26 2026-09-27 2026-09-28; do bash pull_day.sh $D 2>&1 | tee logs/pull_$D.log; done
```

Controllo: in `data/<giorno>/` deve esserci `hyperspace-raw-<giorno>.parquet` (centinaia di MB) e lo sha256 locale deve coincidere con `parquet.sha256`. Se un giorno manca sul droplet (vedi `inventory.txt`), prendi il giorno disponibile più vicino dello stesso tipo (weekend o lunedì) e scrivimelo.

## 2. Lancia la catena completa su ogni giorno, nello stesso ordine del 14/09

```bash
cd analysis/journey_lab
for D in 2026-09-26 2026-09-27 2026-09-28; do
  mkdir -p out/$D
  for S in 10_audit 20_rois 30_transform_check 40_tracklets 41_ids_phantoms 42_forensics 43_excess_over_chance \
           45_raw_visits 50_fragmentation_map 60_reconciler 70_topology 80_candidates 90_assign 95_validate \
           160_staff 100_analytics 110_average_journey 150_queue_wait 190_learned_linker 195_dwell_reconciled \
           199_department_areas 201_paths_and_counters 120_behaviour_clusters; do
    echo "=== $D $S"; python3 $S.py $D 2>&1 | tee logs/${S}_$D.log || echo "!!! $S fallito su $D"
  done
done
```

Regole:
- Non fermarti al primo errore: segna lo script fallito e vai avanti con il successivo.
- `30_transform_check` è un cancello (PASS/FAIL): se dice FAIL su un giorno, dimmelo, ma continua lo stesso.
- Non toccare `out/2026-09-14/`.
- Non fare commit.

## 3. Alla fine scrivimi in 10 righe

Per ogni giorno: righe nel parquet, ingressi (`10_audit.json`), esito 30, numero di journeys in `90_summary_vj.json`, scripts falliti e l'ultima riga di errore di ciascuno.
