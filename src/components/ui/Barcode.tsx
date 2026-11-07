import { code128Widths, isCode128B } from "@/lib/code128";

/**
 * Code128 바코드 (SVG) — 상차지시서·상차확인서 번호. 인쇄해도 선명하도록 벡터로 그리고,
 * 양쪽에 조용한 여백(10모듈)을 둔다. 사람이 읽는 번호는 아래에 함께 적는다.
 */
export function Barcode({ value, height = 56, module = 2, showText = true }: { value: string; height?: number; module?: number; showText?: boolean }) {
  if (!isCode128B(value)) return <span className="mono">{value}</span>;
  const widths = code128Widths(value);
  const quiet = 10;
  const total = widths.reduce((a, b) => a + b, 0) + quiet * 2;
  let x = quiet;
  const bars: { x: number; w: number }[] = [];
  widths.forEach((w, i) => {
    if (i % 2 === 0) bars.push({ x, w });
    x += w;
  });
  const textH = showText ? 16 : 0;
  return (
    <svg
      role="img"
      aria-label={`바코드 ${value}`}
      width={total * module}
      height={height + textH}
      viewBox={`0 0 ${total} ${height + textH}`}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
    >
      <rect x="0" y="0" width={total} height={height + textH} fill="#fff" />
      {bars.map((b) => (
        <rect key={b.x} x={b.x} y="0" width={b.w} height={height} fill="#000" />
      ))}
      {showText && (
        <text x={total / 2} y={height + 13} textAnchor="middle" fontSize="12" fontFamily="var(--font-plex-mono), monospace" fill="#000" textLength={total - quiet * 2} lengthAdjust="spacingAndGlyphs">
          {value}
        </text>
      )}
    </svg>
  );
}
