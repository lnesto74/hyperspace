import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DailyKpiPayload } from '../../dailyKpi/types';
import {
  BEHAVIOUR_SER,
  AREA_DEPT_ORDER,
  DEPT_MIX_ORDER,
  DEPT_ORDER,
  HEAT_DEPTS,
  SERVED_COUNTERS,
  LANE_SER,
  SLOTS,
  buildClienteMedioView,
  formatNextJob,
  mergeBehaviour,
  todayRome,
  type DisplayTile,
} from './adapter';
import {
  columns,
  fint,
  fmt,
  hbars,
  hbars2,
  heat,
  legend,
  stackedH,
  stackedV,
  table,
} from './charts';
import './clienteMedio.css';

function ChartCard({
  id,
  title,
  sub,
  svg,
  tableHtml,
  legendHtml,
  empty,
}: {
  id: string;
  title: string;
  sub: string;
  svg: string;
  tableHtml: string;
  legendHtml?: string;
  empty?: string | null;
}) {
  const [showTable, setShowTable] = useState(false);
  return (
    <div className="cm-card" data-card={id}>
      <div className="ch">
        <div>
          <h3>{title}</h3>
          {sub ? <p>{sub}</p> : null}
        </div>
        {!empty && (
          <button
            className="cm-tbtn"
            type="button"
            data-testid={`${id}-toggle`}
            onClick={() => setShowTable((v) => !v)}
          >
            {showTable ? 'Grafico' : 'Tabella'}
          </button>
        )}
      </div>
      {empty ? (
        <p className="n">{empty}</p>
      ) : (
        <>
          {legendHtml ? <div dangerouslySetInnerHTML={{ __html: legendHtml }} /> : null}
          <div hidden={showTable} dangerouslySetInnerHTML={{ __html: svg }} />
          <div className="cm-tscroll" hidden={!showTable} dangerouslySetInnerHTML={{ __html: tableHtml }} />
        </>
      )}
    </div>
  );
}

function KpiTiles({ tiles, testId }: { tiles: DisplayTile[]; testId: string }) {
  return (
    <div className="cm-kpis" data-testid={testId}>
      {tiles.map((k) => (
        <div className="cm-kpi" key={k.id} data-kpi={k.id} data-tip={k.tip} title={k.tip}>
          <div className="v">
            {k.value}
            {k.unit ? <small>{k.unit}</small> : null}
          </div>
          <div className="l">{k.label}</div>
          <div className="n">{k.note}</div>
        </div>
      ))}
    </div>
  );
}

export function ClienteMedioEmpty({ day, dark = true }: { day: string; dark?: boolean }) {
  const today = todayRome();
  const stillOpen = day >= today;
  return (
    <div className="cm-root" data-theme={dark ? 'dark' : 'light'} data-testid="cliente-medio-empty">
      <div className="cm-empty">
        <h2>Non ancora calcolato per questo giorno</h2>
        {stillOpen ? (
          <p>Il {day} non è ancora chiuso. Il job legge il parquet raw del giorno precedente ogni notte alle 04:30 UTC — non riusiamo i KPI live di zone_visits.</p>
        ) : (
          <p>Il {day} non è in daily_kpi. I giorni calcolati partono dal 14 settembre 2026 — scegline uno dal selettore in alto. Il job gira ogni notte alle 04:30 UTC sul parquet raw del giorno precedente.</p>
        )}
        <p style={{ marginTop: 8 }}>{formatNextJob()}</p>
      </div>
    </div>
  );
}

export default function ClienteMedioDashboard({
  payload,
  venueName = 'Treviglio',
  dark = true,
}: {
  payload: DailyKpiPayload;
  venueName?: string;
  dark?: boolean;
}) {
  const view = useMemo(() => buildClienteMedioView(payload), [payload]);
  const rootRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  const moveTip = useCallback((e: MouseEvent) => {
    const tip = tipRef.current;
    if (!tip || tip.hidden) return;
    const x = e.clientX + 14;
    const y = e.clientY + 14;
    tip.style.left = `${Math.min(x, window.innerWidth - tip.offsetWidth - 8)}px`;
    tip.style.top = `${Math.min(y, window.innerHeight - tip.offsetHeight - 8)}px`;
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    const tip = tipRef.current;
    if (!root || !tip) return;
    const onEnter = (e: Event) => {
      const el = (e.target as Element).closest('[data-tip]') as HTMLElement | null;
      if (!el?.dataset.tip) return;
      tip.textContent = el.dataset.tip;
      tip.hidden = false;
      moveTip(e as MouseEvent);
    };
    const onLeave = () => { tip.hidden = true; };
    root.addEventListener('mouseover', onEnter);
    root.addEventListener('mousemove', moveTip as EventListener);
    root.addEventListener('mouseout', onLeave);
    return () => {
      root.removeEventListener('mouseover', onEnter);
      root.removeEventListener('mousemove', moveTip as EventListener);
      root.removeEventListener('mouseout', onLeave);
    };
  }, [moveTip, payload]);

  const entItems = SLOTS.map((s) => ({ l: s, v: view.entrances[s] ?? 0 }));
  const visitItems = SLOTS.map((s) => ({ l: s, v: view.visitMin[s] ?? 0 }));
  const deptItems = DEPT_ORDER.filter((d) => view.minutes[d]).map((d) => ({
    l: d,
    v: view.minutes[d].giorno ?? 0,
  }));
  const heatRows = HEAT_DEPTS.filter((d) => view.minutes[d]);
  const areaItems = AREA_DEPT_ORDER
    .filter((d) => view.minutesArea[d]?.giorno != null)
    .map((d) => {
      const area = view.minutesArea[d].giorno ?? 0;
      const banco = view.minutesBanco[d]?.giorno ?? 0;
      return { l: d, a: banco, b: Math.max(area - banco, 0), area };
    });
  const areaHeatRows = (areaItems.length ? AREA_DEPT_ORDER : heatRows)
    .filter((d) => (view.minutesArea[d]?.giorno ?? view.minutes[d]?.giorno ?? 0) >= 0.1);
  const fa = view.firstAfter;
  const ftot = fa.reduce((a, b) => a + b.n, 0);
  const queueItems = SLOTS.map((s) => ({ l: s, v: view.queueWait[s] ?? 0 }));

  const beh = view.behaviour;
  const bs = beh ? mergeBehaviour(beh.share) : null;
  const behItems = bs
    ? BEHAVIOUR_SER.map((s) => ({ l: s.label, v: 100 * (bs[s.key] || 0) })).sort((a, b) => b.v - a.v)
    : [];
  const slotMix: Record<string, Record<string, number>> = {};
  if (beh) {
    for (const sl of SLOTS) {
      const row: Record<string, number> = {};
      for (const name of Object.keys(beh.slotMix)) {
        row[name] = beh.slotMix[name]?.[sl] || 0;
      }
      slotMix[sl] = mergeBehaviour(row);
    }
  }
  const deptMix: Record<string, Record<string, number>> = {};
  if (beh) {
    for (const d of DEPT_MIX_ORDER) {
      const row: Record<string, number> = {};
      for (const name of Object.keys(beh.deptMix)) {
        row[name] = beh.deptMix[name]?.[d] || 0;
      }
      deptMix[d] = mergeBehaviour(row);
    }
  }

  const laneRows = view.lanes.map((l) => l.lane);
  const ser = [...BEHAVIOUR_SER];
  const laneSer = [...LANE_SER];
  const adjDepts = AREA_DEPT_ORDER.filter((d) => view.adjacency[d]
    && Object.values(view.adjacency[d]).some((v) => v && v > 0));

  return (
    <div className="cm-root" data-theme={dark ? 'dark' : undefined} ref={rootRef} data-testid="cliente-medio">
      <div className="cm-wrap">
        <header className="cm-header">
          <div className="cm-header-top">
            <div className="cm-eyebrow">Esselunga · {venueName} · LiDAR</div>
            <div className="cm-tags">
              <span className="cm-tag m">MISURATO = visto dai sensori</span>
              <span className="cm-tag s">STIMATO = calcolato, indicato ogni volta</span>
            </div>
          </div>
          <h1>Il cliente medio di {venueName}</h1>
          <p className="lead">
            {view.dayLabel}, {view.hours}. Tutto quello che vedi viene dalle osservazioni grezze dei sensori (10 al secondo). Nessuna persona viene seguita: i valori &quot;per cliente&quot; sono tempo totale misurato diviso ingressi misurati.
          </p>
        </header>

        <KpiTiles tiles={view.tiles} testId="cm-kpis" />

        <section>
          <div className="head"><h2>Quanti entrano e quanto restano</h2><span className="cm-tag m">misurato</span></div>
          <p className="sub">Gli ingressi sono eventi: chi passa dalla porta viene contato una volta, anche se il sensore gli cambia numero dieci volte dopo. La durata della visita è persone presenti × tempo ÷ ingressi.</p>
          <div className="cm-grid2">
            <ChartCard
              id="c_entr"
              title="Ingressi per fascia oraria"
              sub="Persone entrate dalla porta (eventi)."
              svg={columns(entItems, { dec: 0, tipf: (i) => `${i.l}: ${fint(i.v)} ingressi` })}
              tableHtml={table(
                ['Fascia', 'Ingressi'],
                SLOTS.map((s) => [s, view.entrances[s] != null ? fint(view.entrances[s] as number) : '—'])
                  .concat([['Giorno', okTile(view.tiles[0])]]),
              )}
            />
            <ChartCard
              id="c_visit"
              title="Durata media della visita"
              sub="Minuti per cliente, per fascia oraria (legge di Little)."
              svg={columns(visitItems, { dec: 1, color: 'var(--seq-4)', tipf: (i) => `${i.l}: ${fmt(i.v, 1)} minuti a cliente` })}
              tableHtml={table(
                ['Fascia', 'Minuti'],
                SLOTS.map((s) => [s, view.visitMin[s] != null ? fmt(view.visitMin[s] as number, 1) : '—'])
                  .concat([['Giorno', view.tiles[1].value]]),
              )}
            />
          </div>
        </section>

        <section>
          <div className="head">
            <h2>Dove passa i suoi {view.visitRounded} minuti</h2>
            <span className="cm-tag m">misurato ÷ ingressi</span>
          </div>
          <p className="sub">
            Due livelli, entrambi misurati. <b>Nell&apos;area del reparto</b>: il pavimento entro 3 metri dai banchi di quel reparto, assegnato al reparto più vicino (tolti ingresso, casse e retro banchi). <b>Al banco</b>: dentro l&apos;area, entro 1 metro dal banco e fermo o lento, cioè il cliente che tocca e sceglie. Il personale in sala è già tolto. La somma torna sempre alla durata della visita.
          </p>
          <div className="cm-grid2">
            <ChartCard
              id="c_dept"
              title="Minuti per cliente per reparto, giorno intero"
              sub={`Tempo nell'area del reparto ÷ ${okTile(view.tiles[0]) === '—' ? 'ingressi' : `${okTile(view.tiles[0])} ingressi`}. Scuro = al banco (entro 1 m, fermo o lento); chiaro = nel resto dell'area.`}
              legendHtml={'<div class="cm-legend"><span><i style="background:var(--seq-6)"></i>al banco (tocca e sceglie)</span><span><i style="background:var(--seq-3)"></i>resto dell\'area</span></div>'}
              svg={areaItems.length
                ? hbars2(areaItems, {
                  dec: 2,
                  unit: ' min',
                  tipf: (i) => `${i.l}: ${fmt(i.area ?? i.a + i.b, 2)} min nell'area, di cui ${fmt(i.a, 2)} al banco`,
                })
                : hbars(deptItems, {
                  dec: 2,
                  unit: ' min',
                  colorf: (it) => (it.l.startsWith('Corsie') ? 'var(--seq-7)' : 'var(--seq-4)'),
                  tipf: (i) => `${i.l}: ${fmt(i.v, 2)} min per cliente`,
                })}
              tableHtml={table(
                ['Reparto', 'Nell\'area', 'di cui al banco', 'Persone viste per ingresso*', 'Sosta mediana*'],
                (areaItems.length ? areaItems : deptItems).map((i) => {
                  const name = i.l;
                  const stay = view.deptStays[name];
                  const area = 'area' in i ? (i.area ?? 0) : i.v;
                  const banco = 'a' in i ? i.a : 0;
                  return [
                    name,
                    fmt(area, 2),
                    areaItems.length ? fmt(banco, 2) : '—',
                    view.reconOk && stay?.persons_per_entrance != null ? fmt(stay.persons_per_entrance, 1) : '—',
                    view.reconOk && stay?.stay_median_s != null ? `${fmt(stay.stay_median_s, 0)} s` : '—',
                  ];
                }),
              )}
            />
            <ChartCard
              id="c_heat"
              title="Minuti per cliente nell'area, per fascia oraria"
              sub="Stesso calcolo, per fascia. Più scuro = più tempo."
              svg={heat(areaHeatRows, [...SLOTS], (r, c) => view.minutesArea[r]?.[c] ?? view.minutes[r]?.[c] ?? 0, { dec: 2 })}
              tableHtml={table(
                ['Reparto', ...SLOTS],
                areaHeatRows.map((r) => [r, ...SLOTS.map((c) => fmt(view.minutesArea[r]?.[c] ?? view.minutes[r]?.[c] ?? 0, 2))]),
              )}
            />
            <ChartCard
              id="c_banco"
              title="Minuti al banco per cliente, per fascia oraria"
              sub="Solo il tempo fermo o lento entro 1 m dal banco: il cliente che tocca e sceglie."
              svg={heat(areaHeatRows, [...SLOTS], (r, c) => view.minutesBanco[r]?.[c] ?? 0, { dec: 2 })}
              tableHtml={table(
                ['Reparto', ...SLOTS],
                areaHeatRows.map((r) => [r, ...SLOTS.map((c) => fmt(view.minutesBanco[r]?.[c] ?? 0, 2))]),
              )}
            />
          </div>
        </section>

        <section>
          <div className="head"><h2>Casse</h2><span className="cm-tag m">misurato</span></div>
          <p className="sub">La coda costa in media un minuto a cliente, ma quasi il doppio nella pausa pranzo. I valori sono tempo totale in zona coda ÷ ingressi della fascia.</p>
          <div className="cm-grid2">
            <ChartCard
              id="c_queue"
              title="Coda cassa: minuti per cliente"
              sub="Tempo in zona coda ÷ ingressi della fascia."
              svg={columns(queueItems, { dec: 2, color: 'var(--seq-5)', tipf: (i) => `${i.l}: ${fmt(i.v, 2)} min in coda per cliente` })}
              tableHtml={table(
                ['Fascia', 'Coda (min/cliente)', 'Servizio (min/cliente)'],
                SLOTS.map((s) => [
                  s,
                  view.queueWait[s] != null ? fmt(view.queueWait[s] as number, 2) : '—',
                  view.queueService[s] != null ? fmt(view.queueService[s] as number, 2) : '—',
                ]),
              )}
            />
            <ChartCard
              id="c_first"
              title="Primo reparto dopo l'ingresso"
              sub={`Misurato dentro lo stesso numero di traccia (${ftot ? fint(ftot) : '—'} passaggi diretti).`}
              svg={hbars(fa.map((x) => ({ l: x.dept, v: ftot ? 100 * x.n / ftot : 0 })), {
                dec: 0, unit: ' %',
                tipf: (i) => `${i.l}: ${fmt(i.v, 0)} % dei primi passaggi`,
              })}
              tableHtml={table(
                ['Reparto', 'Passaggi', 'Quota'],
                fa.map((x) => [x.dept, fint(x.n), `${fmt(ftot ? 100 * x.n / ftot : 0, 0)} %`]),
              )}
            />
            <ChartCard
              id="c_lanes"
              title="Attesa per cassa"
              sub="Quota del tempo in ogni corsia: in attesa, in transito, oggetto fermo."
              legendHtml={legend(laneSer)}
              svg={laneRows.length
                ? stackedH(laneRows, laneSer, (r, k) => {
                  const lane = view.lanes.find((l) => l.lane === r);
                  return lane ? Number(lane[k as keyof typeof lane] || 0) : 0;
                }, { labelw: 90 })
                : '<svg viewBox="0 0 520 240"></svg>'}
              tableHtml={table(
                ['Cassa', ...LANE_SER.map((s) => s.label)],
                view.lanes.map((l) => [l.lane, ...LANE_SER.map((s) => `${fmt(100 * l[s.key], 0)} %`)]),
              )}
              empty={view.lanes.length ? null : 'Decomposizione per cassa non disponibile.'}
            />
          </div>
        </section>

        <section>
          <div className="head"><h2>Attesa ai banchi serviti</h2><span className="cm-tag m">misurato</span></div>
          <p className="sub">Persone in media ferme o lente nella fascia 2 m davanti al banco. La sosta mediana e il 90° percentile uniscono attesa e servizio: non sono separabili senza l&apos;evento &quot;servito&quot;.</p>
          <div className="cm-grid2">
            <ChartCard
              id="c_wait"
              title="Persone in attesa per fascia"
              sub="Una serie per banco servito. Gastronomia, Salumi e Pane restano senza copertura."
              svg={columns(
                SERVED_COUNTERS.filter((n) => view.counterWait[n]?.giorno != null).map((n) => ({
                  l: n, v: view.counterWait[n].giorno as number,
                })),
                { dec: 2, tipf: (i) => `${i.l}: ${fmt(i.v, 2)} persone in media` },
              )}
              tableHtml={table(
                ['Banco', ...SLOTS, 'Giorno', 'Sosta med.', 'p90', 'Clienti serviti*'],
                SERVED_COUNTERS.map((n) => [
                  n,
                  ...SLOTS.map((s) => (view.counterWait[n]?.[s] != null ? fmt(view.counterWait[n][s] as number, 2) : '—')),
                  view.counterWait[n]?.giorno != null ? fmt(view.counterWait[n].giorno as number, 2) : '—',
                  view.counterStay[n]?.median != null ? `${fmt(view.counterStay[n].median as number, 0)} s` : '—',
                  view.counterStay[n]?.p90 != null ? `${fmt(view.counterStay[n].p90 as number, 0)} s` : '—',
                  view.counterStay[n]?.stays != null ? fint(view.counterStay[n].stays as number) : '—',
                ]),
              )}
              empty={SERVED_COUNTERS.some((n) => view.counterWait[n]?.giorno != null) ? null : 'Attesa ai banchi non calcolata per questo giorno.'}
            />
          </div>
        </section>

        <section>
          <div className="head"><h2>Dove va dopo</h2><span className={view.reconOk ? 'cm-tag s' : 'cm-tag m'}>{view.reconOk ? 'stimato su percorsi ricomposti' : 'stimato'}</span></div>
          <p className="sub">Solo salti adiacenti: una sosta ≥ 3 s in un&apos;area, poi un&apos;altra. Non è un percorso multi-passo. Celle sotto 10 transizioni restano vuote.</p>
          <div className="cm-grid2">
            <ChartCard
              id="c_adj"
              title="Reparto successivo"
              sub={view.transitions != null ? `${fint(view.transitions)} transizioni nel giorno.` : 'Matrice di adiacenza.'}
              svg={adjDepts.length
                ? heat(adjDepts, adjDepts, (r, c) => {
                  const v = view.adjacency[r]?.[c];
                  return v && (view.transitions || 0) ? v : 0;
                }, { dec: 2 })
                : '<svg viewBox="0 0 520 80"></svg>'}
              tableHtml={table(
                ['Da \\ a', ...adjDepts],
                adjDepts.map((r) => [r, ...adjDepts.map((c) => {
                  const v = view.adjacency[r]?.[c];
                  return v != null && v > 0 ? fmt(v, 2) : '—';
                })]),
              )}
              empty={adjDepts.length ? null : 'Matrice di adiacenza non disponibile.'}
            />
            <ChartCard
              id="c_flow"
              title="Direzione di percorrenza"
              sub="Frecce sulle celle 2 m con almeno 200 passaggi e coerenza ≥ 0,3. Lunghezza ∝ coerenza."
              svg={flowSvg(view.flowField)}
              tableHtml={table(
                ['x', 'z', 'angolo', 'r', 'n'],
                view.flowField.filter((c) => c.n >= 200 && c.r >= 0.3).slice(0, 40).map((c) => [
                  fmt(c.x, 1), fmt(c.z, 1), fmt(c.angle, 2), fmt(c.r, 2), fint(c.n),
                ]),
              )}
              empty={view.flowField.length ? null : 'Campo di direzione non calcolato per questo giorno.'}
            />
            <ChartCard
              id="c_promo"
              title="Testate e promo"
              sub="Tempo al banco per 1.000 ingressi, oggetti isola / promo / tavolo / display."
              svg={view.promoSpots.length
                ? hbars(view.promoSpots.slice(0, 12).map((p) => ({ l: p.name, v: p.per1000 ?? p.minutes })), {
                  dec: 1,
                  unit: ' min',
                  tipf: (i) => {
                    const spot = view.promoSpots.find((p) => p.name === i.l);
                    return `${i.l}${spot?.department ? ` · ${spot.department}` : ''}: ${fmt(i.v, 1)} min / 1.000 ingressi`;
                  },
                })
                : '<svg viewBox="0 0 520 80"></svg>'}
              tableHtml={table(
                ['Oggetto', 'Reparto', 'Min / 1.000 ingressi'],
                view.promoSpots.map((p) => [p.name, p.department || '—', fmt(p.per1000 ?? p.minutes, 1)]),
              )}
              empty={view.promoSpots.length ? null : 'Testate e promo non calcolate per questo giorno.'}
            />
          </div>
        </section>

        {view.reconOk && (
          <section>
            <div className="head"><h2>Persone per reparto</h2><span className="cm-tag s">STIMATO</span></div>
            <p className="sub">Su percorsi ricomposti in post-processing; la stessa persona può contare più volte.</p>
            <div className="cm-grid2">
              <ChartCard
                id="c_stays"
                title="Persone viste per ingresso e sosta mediana"
                sub="Solo quando la strategia di riconciliazione in post-processing supera i controlli."
                svg={hbars(AREA_DEPT_ORDER.filter((d) => view.deptStays[d]?.persons_per_entrance != null).map((d) => ({
                  l: d, v: view.deptStays[d].persons_per_entrance as number,
                })), { dec: 1, tipf: (i) => `${i.l}: ${fmt(i.v, 1)} persone per ingresso` })}
                tableHtml={table(
                  ['Reparto', 'Persone / ingresso', 'Sosta mediana'],
                  AREA_DEPT_ORDER.filter((d) => view.deptStays[d]).map((d) => [
                    d,
                    fmt(view.deptStays[d].persons_per_entrance || 0, 1),
                    view.deptStays[d].stay_median_s != null ? `${fmt(view.deptStays[d].stay_median_s as number, 0)} s` : '—',
                  ]),
                )}
              />
            </div>
          </section>
        )}

        <section>
          <div className="head"><h2>Come si comporta la gente in negozio</h2><span className="cm-tag s">stimato su segmenti ricuciti</span></div>
          <p className="sub">
            {beh?.segments
              ? `${fint(beh.segments)} tratti di almeno 20 secondi, ricuciti con confidenza verificata. I gruppi sono stati trovati dai dati e battezzati dopo. Sono modi di comportarsi in un tratto di 30–90 secondi, non tipi di cliente.`
              : 'Mix comportamentale stimato sui tratti ricuciti. Se il job 120 non è stato calcolato, le carte restano vuote.'}
          </p>
          <div className="cm-grid2">
            <ChartCard
              id="c_beh"
              title="Modi di stare in negozio"
              sub={beh?.segments ? `Quota dei ${fint(beh.segments)} tratti di almeno 20 secondi.` : 'Quota dei tratti di almeno 20 secondi.'}
              svg={hbars(behItems, { dec: 0, unit: ' %', tipf: (i) => `${i.l}: ${fmt(i.v, 0)} % dei tratti` })}
              tableHtml={table(
                ['Modo', 'Quota', 'Durata tipica', 'Percorso tipico'],
                BEHAVIOUR_SER.map((s) => {
                  const p = s.key === 'coda_cassa' ? null : beh?.profile[s.key];
                  return [
                    s.label,
                    bs ? `${fmt(100 * (bs[s.key] || 0), 1)} %` : '—',
                    p ? `${fmt(p.dur_s, 0)} s` : '33–45 s',
                    p ? `${fmt(p.path_m, 0)} m` : '8–14 m',
                  ];
                }),
              )}
              empty={bs ? null : view.behaviourReason}
            />
            <ChartCard
              id="c_slotmix"
              title="Mix per fascia oraria"
              sub="Quota dei tratti. Il mix è stabile: cambia quanta gente c'è, non come si comporta."
              legendHtml={legend(ser)}
              svg={stackedV([...SLOTS], ser, (c, k) => slotMix[c]?.[k] || 0)}
              tableHtml={table(
                ['Fascia', ...BEHAVIOUR_SER.map((s) => s.label)],
                SLOTS.map((s) => [s, ...BEHAVIOUR_SER.map((sr) => `${fmt(100 * (slotMix[s]?.[sr.key] || 0), 0)} %`)]),
              )}
              empty={bs ? null : view.behaviourReason}
            />
            <ChartCard
              id="c_deptmix"
              title="Cosa fa la gente in ogni reparto"
              sub="Quota del tempo misurato in ciascuna zona, per modo di comportarsi. Il Bar è banco servito; in Frutta si passa più che scegliere; ai Surgelati e in Verdura si sceglie."
              legendHtml={legend(ser)}
              svg={stackedH(DEPT_MIX_ORDER, ser, (r, k) => deptMix[r]?.[k] || 0)}
              tableHtml={table(
                ['Reparto', ...BEHAVIOUR_SER.map((s) => s.label)],
                DEPT_MIX_ORDER.map((d) => [d, ...BEHAVIOUR_SER.map((sr) => `${fmt(100 * (deptMix[d]?.[sr.key] || 0), 0)} %`)]),
              )}
              empty={bs ? null : view.behaviourReason}
            />
          </div>
        </section>

        <section>
          <div className="head"><h2>Da verificare sul posto</h2></div>
          {view.zeroDepts.length ? (
            <div className="cm-callout">
              <div className="ic" aria-hidden="true">!</div>
              <div>
                <h3>
                  {view.zeroDepts.length === 1 ? 'Un banco' : `${view.zeroDepts.length === 3 ? 'Tre' : view.zeroDepts.length} banchi`}
                  {' '}serviti non {view.zeroDepts.length === 1 ? 'ha' : 'hanno'} nessuna osservazione in tutto il giorno
                </h3>
                <p style={{ marginTop: 4, color: 'var(--ink-2)' }}>
                  Le zone {joinIt(view.zeroDepts)} esistono nel twin, ma nessun punto dei sensori ci cade dentro. O l&apos;area non è coperta, o le zone sono disegnate dietro il banco. Sono le zone a più alto valore: da chiarire prima di qualsiasi KPI di reparto.
                </p>
                <div className="zero">
                  {view.zeroDepts.map((d) => (
                    <div key={d}><b>0</b>{d}</div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <p className="sub">Nessuna zona attiva senza osservazioni in questo giorno.</p>
          )}
        </section>

        <div className="cm-notes">
          <p>
            <b>Come leggere.</b> &quot;Per cliente&quot; = tempo totale misurato in un&apos;area ÷ {okTile(view.tiles[0])} ingressi.
            Le aree di reparto sono proposte dal digital twin (3 m dai banchi) e vanno confermate sul posto; le colonne con * sono STIMATE su percorsi ricomposti in post-processing. Una persona che torna due volte nella stessa zona conta due volte: è una media di tempo, non una quota di persone. L&apos;ordine dei reparti centrali non è ricavabile da questi dati; il primo passo dopo l&apos;ingresso invece è misurato dentro lo stesso numero di traccia.
          </p>
          <p style={{ marginTop: 8 }}>
            <b>Cosa non dice.</b> &quot;Il 40 % dei clienti va in Frutta&quot;, &quot;chi va al Pesce poi va al Bar&quot;, &quot;clienti veloci contro spesa grande&quot;: tutte cose che richiedono di seguire la stessa persona per venti minuti, e oggi i numeri di traccia durano pochi secondi.
          </p>
        </div>
      </div>
      <div className="cm-tip" ref={tipRef} hidden />
    </div>
  );
}

function okTile(tile: DisplayTile): string {
  return tile.value;
}

function joinIt(names: string[]): string {
  if (names.length <= 1) return names[0] || '';
  if (names.length === 2) return `${names[0]} e ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
}

function flowSvg(cells: Array<{ x: number; z: number; angle: number; r: number; n: number }>): string {
  const shown = cells.filter((c) => c.n >= 200 && c.r >= 0.3);
  if (!shown.length) return '<svg viewBox="0 0 520 160"></svg>';
  const xs = shown.map((c) => c.x);
  const zs = shown.map((c) => c.z);
  const minX = Math.min(...xs) - 2;
  const maxX = Math.max(...xs) + 2;
  const minZ = Math.min(...zs) - 2;
  const maxZ = Math.max(...zs) + 2;
  const W = 520, H = 280, P = 16;
  const sx = (x: number) => P + (W - 2 * P) * (x - minX) / Math.max(maxX - minX, 1);
  const sz = (z: number) => P + (H - 2 * P) * (1 - (z - minZ) / Math.max(maxZ - minZ, 1));
  let s = '';
  for (const c of shown) {
    const len = 8 + 18 * c.r;
    const x1 = sx(c.x);
    const y1 = sz(c.z);
    const x2 = x1 + Math.cos(c.angle) * len;
    const y2 = y1 - Math.sin(c.angle) * len;
    s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--seq-6)" stroke-width="1.6"/>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" role="img">${s}</svg>`;
}
