import { compact, money } from "../lib/shared";

// Grouped bar chart (supports negative values). data: [{label, a, b}] series: [{key,label,color}]
export function BarChart({ data, series, height = 230 }) {
  if (!data.length) return <div className="empty small">No data in this period</div>;
  const W = 760, H = height, pl = 46, pr = 8, pt = 12, pb = 28;
  const vals = data.flatMap(d => series.map(s => d[s.key] || 0));
  const max = Math.max(1, ...vals), min = Math.min(0, ...vals), span = max - min || 1;
  const y = v => pt + ((max - v) / span) * (H - pt - pb);
  const gw = (W - pl - pr) / data.length, bw = Math.max(2, Math.min(26, (gw * 0.78) / series.length));
  const step = Math.ceil(data.length / 9);
  const ticks = [0, 1, 2, 3, 4].map(i => min + (span * i) / 4);
  return <div className="chartwrap"><svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img">
    {ticks.map((t, i) => <g key={i}>
      <line x1={pl} x2={W - pr} y1={y(t)} y2={y(t)} style={{ stroke: "var(--line)" }} />
      <text x={pl - 6} y={y(t) + 4} textAnchor="end" className="ct">{compact(t)}</text>
    </g>)}
    {data.map((d, i) => <g key={i}>
      {series.map((s, j) => {
        const v = d[s.key] || 0, x = pl + i * gw + (gw - bw * series.length) / 2 + j * bw;
        return <rect key={s.key} x={x} y={Math.min(y(v), y(0))} width={bw - 1} height={Math.max(1, Math.abs(y(v) - y(0)))} rx="2" style={{ fill: s.color }}><title>{`${d.label} · ${s.label}: ${money(v)}`}</title></rect>;
      })}
      {i % step === 0 && <text x={pl + i * gw + gw / 2} y={H - 8} textAnchor="middle" className="ct">{d.label}</text>}
    </g>)}
  </svg>
    <div className="legend">{series.map(s => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}</div>
  </div>;
}

// Horizontal bars. rows: [{label, value, sub?, color?}]
export function HBars({ rows, fmt = v => v, color = "var(--gold)" }) {
  if (!rows.length) return <div className="empty small">No data</div>;
  const max = Math.max(1, ...rows.map(r => r.value));
  return <div className="hbars">{rows.map(r => <div key={r.label} className="hbar">
    <div className="hbtop"><span>{r.label}</span><b>{fmt(r.value)}{r.sub ? <small> {r.sub}</small> : null}</b></div>
    <div className="hbtrack"><div className="hbfill" style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, background: r.color || color }} /></div>
  </div>)}</div>;
}

// Donut. parts: [{label,value,color}]
export function Donut({ parts, center }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (!total) return <div className="empty small">No data</div>;
  const R = 52, C = 2 * Math.PI * R;
  let acc = 0;
  return <div className="donutwrap">
    <svg viewBox="0 0 140 140" className="donut">
      <circle cx="70" cy="70" r={R} fill="none" style={{ stroke: "var(--line)" }} strokeWidth="18" />
      {parts.filter(p => p.value > 0).map(p => {
        const len = (p.value / total) * C, el = <circle key={p.label} cx="70" cy="70" r={R} fill="none" strokeWidth="18" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acc} transform="rotate(-90 70 70)" style={{ stroke: p.color }}><title>{`${p.label}: ${p.value}`}</title></circle>;
        acc += len; return el;
      })}
      <text x="70" y="68" textAnchor="middle" className="dc1">{center ?? total}</text>
      <text x="70" y="84" textAnchor="middle" className="ct">total</text>
    </svg>
    <div className="dlegend">{parts.map(p => <div key={p.label}><i style={{ background: p.color }} /><span>{p.label}</span><b>{p.value}</b></div>)}</div>
  </div>;
}
