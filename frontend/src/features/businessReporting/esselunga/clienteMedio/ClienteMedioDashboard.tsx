import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DailyKpiPayload } from '../../dailyKpi/types';
import {
  BEHAVIOUR_SER,
  DEPT_MIX_ORDER,
  DEPT_ORDER,
  HEAT_DEPTS,
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
    <div className={`cm-card${id.endsWith('deptmix') ? ' wide' : ''}`} data-card={id}>
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
          <p className="sub">Minuti per cliente in ogni zona disegnata nel twin. Due terzi del tempo stanno fuori da qualsiasi zona: corsie, passaggi, scaffali senza ROI. La somma torna sempre alla durata della visita.</p>
          <div className="cm-grid2">
            <ChartCard
              id="c_dept"
              title="Minuti per cliente, giorno intero"
              sub={`Tempo misurato in ogni zona ÷ ${okTile(view.tiles[0]) === '—' ? 'ingressi' : `${okTile(view.tiles[0])} ingressi`}. La barra scura è il tempo fuori da qualsiasi zona.`}
              svg={hbars(deptItems, {
                dec: 2,
                unit: ' min',
                colorf: (it) => (it.l.startsWith('Corsie') ? 'var(--seq-7)' : 'var(--seq-4)'),
                tipf: (i) => `${i.l}: ${fmt(i.v, 2)} min per cliente`,
              })}
              tableHtml={table(
                ['Zona', 'Minuti per cliente'],
                deptItems.map((i) => [i.l, fmt(i.v, 2)]).concat([['Totale (Little)', view.tiles[1].value]]),
              )}
            />
            <ChartCard
              id="c_heat"
              title="Minuti per cliente per fascia oraria"
              sub="Stesso calcolo, per fascia. Più scuro = più tempo."
              svg={heat(heatRows, [...SLOTS], (r, c) => view.minutes[r]?.[c] ?? 0, { dec: 2 })}
              tableHtml={table(
                ['Zona', ...SLOTS],
                heatRows.map((r) => [r, ...SLOTS.map((c) => fmt(view.minutes[r]?.[c] ?? 0, 2))]),
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
                dec: 0, unit: ' %', labelw: 170,
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
                }, { labelw: 100, rh: 30 })
                : '<svg viewBox="0 0 520 40"></svg>'}
              tableHtml={table(
                ['Cassa', ...LANE_SER.map((s) => s.label)],
                view.lanes.map((l) => [l.lane, ...LANE_SER.map((s) => `${fmt(100 * l[s.key], 0)} %`)]),
              )}
              empty={view.lanes.length ? null : 'Decomposizione per cassa non disponibile.'}
            />
          </div>
        </section>

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
              svg={hbars(behItems, { dec: 0, unit: ' %', labelw: 180, tipf: (i) => `${i.l}: ${fmt(i.v, 0)} % dei tratti` })}
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
              svg={stackedH(DEPT_MIX_ORDER, ser, (r, k) => deptMix[r]?.[k] || 0, { labelw: 190, W: 1040, rh: 32 })}
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

        <section>
          <div className="head"><h2>Qualità del dato</h2></div>
          <KpiTiles tiles={view.qualityTiles} testId="cm-quality" />
        </section>

        <div className="cm-notes">
          <p>
            <b>Come leggere.</b> &quot;Per cliente&quot; = tempo totale misurato in una zona ÷ {okTile(view.tiles[0])} ingressi.
            Una persona che torna due volte nella stessa zona conta due volte: è una media di tempo, non una quota di persone. L&apos;ordine dei reparti centrali non è ricavabile da questi dati; il primo passo dopo l&apos;ingresso invece è misurato dentro lo stesso numero di traccia.
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
