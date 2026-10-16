# Cursor prompt 7b — ambiente Python e catena Journey Lab sui tre giorni scaricati

I tre giorni (26, 27, 28 settembre) sono già in `analysis/journey_lab/data/`. Manca solo l'ambiente Python.
Non modificare nessuno script. Non fare commit.

## 1. Crea un ambiente dedicato (una volta sola)

```bash
cd analysis/journey_lab
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install duckdb pandas numpy pyarrow scipy shapely scikit-learn matplotlib
python3 -c "import duckdb, shapely, sklearn, scipy, pyarrow; print('ok')"
```

Se il `python3` di sistema è più vecchio di 3.10, usa `python3.11` o `python3.12` (brew) per creare il venv.

## 2. Lancia la catena su ogni giorno, nello stesso ordine del 14/09

```bash
cd analysis/journey_lab
source .venv/bin/activate
export JL_THREADS=4
for D in 2026-09-26 2026-09-27 2026-09-28; do
  mkdir -p out/$D
  for S in 10_audit 20_rois 30_transform_check 40_tracklets 41_ids_phantoms 42_forensics 43_excess_over_chance \
           45_raw_visits 50_fragmentation_map 60_reconciler 70_topology 80_candidates 90_assign 95_validate \
           160_staff 100_analytics 110_average_journey 150_queue_wait 190_learned_linker 195_dwell_reconciled \
           199_department_areas 201_paths_and_counters 120_behaviour_clusters; do
    echo "=== $D $S $(date +%H:%M)"; python3 $S.py $D 2>&1 | tee logs/${S}_$D.log || echo "!!! $S fallito su $D"
  done
done
```

Regole:
- Non fermarti al primo errore: segna lo script fallito e passa al successivo.
- `30_transform_check` è un cancello PASS/FAIL: se FAIL, dimmelo ma continua.
- Non toccare `out/2026-09-14/`.
- Il sabato (851 MB) è più pesante del 14/09: se un passo supera i 30 minuti o va in out-of-memory, prova con `JL_MEM=3000MB JL_THREADS=2`.

## 3. Alla fine scrivimi in 10 righe

Per ogni giorno: ingressi (`out/<giorno>/10_audit.json`), esito 30, numero di journeys (`90_summary_vj.json`), script falliti con l'ultima riga di errore.
