import { useQuery } from "@tanstack/react-query";
import { useState, useEffect, useRef, useCallback } from "react";
import { createChart, type IChartApi, type ISeriesApi, ColorType, CrosshairMode, type LineData, type Time, LineSeries } from "lightweight-charts";
import {
  type WeightingMode, type TimeRange, type Holding, type PricePoint,
  calculateIndexLine, calculateBenchmarkLine, calculateWeights,
  formatMarketCap, formatPercent,
} from "@/lib/indexCalculations";
import { Loader2 } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";

const TIME_RANGES: TimeRange[] = ["1D", "7D", "1M", "6M", "1Y", "5Y", "10Y"];
const WEIGHTING_MODES: { key: WeightingMode; label: string }[] = [
  { key: "market_cap", label: "Market Cap" },
  { key: "equal_weight", label: "Equal Weight" },
  { key: "capped_25", label: "Capped (25%)" },
];

const COLORS = {
  opht: "#D3F060",
  spy: "#4DB8A4",
  vti: "#5B8DEF",
  background: "#0D1117",
  surface: "#0f2027",
  border: "#1a3040",
  textPrimary: "#F0F6FC",
  textSecondary: "#8B949E",
  textMuted: "#484F58",
};

export default function Home() {
  const isMobile = useIsMobile();
  const [weightingMode, setWeightingMode] = useState<WeightingMode>("market_cap");
  const [timeRange, setTimeRange] = useState<TimeRange>("1Y");
  const [showSpy, setShowSpy] = useState(true);
  const [showVti, setShowVti] = useState(false);
  const [tooltipData, setTooltipData] = useState<{
    date: string;
    opht?: number;
    spy?: number;
    vti?: number;
    ophtReturn?: number;
    spyReturn?: number;
    vtiReturn?: number;
  } | null>(null);

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const ophtSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const spySeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const vtiSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  const statusQuery = useQuery<{ seeded: boolean; lastUpdate: string | null; seedInProgress: boolean }>({
    queryKey: ["/api/status"],
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data && !data.seeded) return 3000;
      if (data && data.seedInProgress) return 3000;
      return false;
    },
  });

  const chartDataQuery = useQuery<Record<string, PricePoint[]>>({
    queryKey: ["/api/chart-data"],
    enabled: statusQuery.data?.seeded === true,
  });

  const holdingsQuery = useQuery<Holding[]>({
    queryKey: ["/api/holdings"],
    enabled: statusQuery.data?.seeded === true,
  });

  // Trigger seed if not yet done
  useEffect(() => {
    if (statusQuery.data && !statusQuery.data.seeded && !statusQuery.data.seedInProgress) {
      fetch("/api/seed");
    }
  }, [statusQuery.data]);

  const ophtLine = chartDataQuery.data && holdingsQuery.data
    ? calculateIndexLine(chartDataQuery.data, holdingsQuery.data, weightingMode, timeRange)
    : [];

  const spyLine = chartDataQuery.data
    ? calculateBenchmarkLine(chartDataQuery.data, "SPY", timeRange)
    : [];

  const vtiLine = chartDataQuery.data
    ? calculateBenchmarkLine(chartDataQuery.data, "VTI", timeRange)
    : [];

  const ophtReturn = ophtLine.length > 1
    ? ((ophtLine[ophtLine.length - 1].value - 100) / 100) * 100
    : null;
  const spyReturn = spyLine.length > 1
    ? ((spyLine[spyLine.length - 1].value - 100) / 100) * 100
    : null;
  const vtiReturn = vtiLine.length > 1
    ? ((vtiLine[vtiLine.length - 1].value - 100) / 100) * 100
    : null;

  const weights = holdingsQuery.data
    ? calculateWeights(holdingsQuery.data, weightingMode)
    : [];

  const handleResize = useCallback(() => {
    if (chartRef.current && chartContainerRef.current) {
      chartRef.current.applyOptions({
        width: chartContainerRef.current.clientWidth,
        height: window.innerWidth < 768 ? 300 : 420,
      });
    }
  }, []);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: COLORS.textSecondary,
        fontFamily: "'DM Sans', 'Inter', sans-serif",
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.04)" },
        horzLines: { color: "rgba(255,255,255,0.04)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "rgba(255,255,255,0.2)", width: 1, style: 2 },
        horzLine: { color: "rgba(255,255,255,0.2)", width: 1, style: 2 },
      },
      rightPriceScale: {
        borderColor: "rgba(255,255,255,0.1)",
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: "rgba(255,255,255,0.1)",
        timeVisible: false,
      },
      width: chartContainerRef.current.clientWidth,
      height: window.innerWidth < 768 ? 300 : 420,
      handleScroll: { mouseWheel: false, pressedMouseMove: true },
      handleScale: { mouseWheel: false, pinch: true },
    });

    const ophtSeries = chart.addSeries(LineSeries, {
      color: COLORS.opht,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
    });

    const spySeries = chart.addSeries(LineSeries, {
      color: COLORS.spy,
      lineWidth: 1,
      lineStyle: 0,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 3,
    });

    const vtiSeries = chart.addSeries(LineSeries, {
      color: COLORS.vti,
      lineWidth: 1,
      lineStyle: 0,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 3,
    });

    chartRef.current = chart;
    ophtSeriesRef.current = ophtSeries;
    spySeriesRef.current = spySeries;
    vtiSeriesRef.current = vtiSeries;

    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.point) {
        setTooltipData(null);
        return;
      }

      const dateStr = param.time as string;
      const ophtVal = param.seriesData.get(ophtSeries) as LineData<Time> | undefined;
      const spyVal = param.seriesData.get(spySeries) as LineData<Time> | undefined;
      const vtiVal = param.seriesData.get(vtiSeries) as LineData<Time> | undefined;

      setTooltipData({
        date: dateStr,
        opht: ophtVal?.value,
        spy: spyVal?.value,
        vti: vtiVal?.value,
        ophtReturn: ophtVal ? ophtVal.value - 100 : undefined,
        spyReturn: spyVal ? spyVal.value - 100 : undefined,
        vtiReturn: vtiVal ? vtiVal.value - 100 : undefined,
      });
    });

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
      chartRef.current = null;
    };
  }, [handleResize]);

  useEffect(() => {
    if (!ophtSeriesRef.current) return;
    ophtSeriesRef.current.setData(ophtLine as LineData<Time>[]);
    if (chartRef.current) chartRef.current.timeScale().fitContent();
  }, [ophtLine]);

  useEffect(() => {
    if (!spySeriesRef.current) return;
    if (showSpy && spyLine.length > 0) {
      spySeriesRef.current.setData(spyLine as LineData<Time>[]);
      spySeriesRef.current.applyOptions({ visible: true });
    } else {
      spySeriesRef.current.setData([]);
      spySeriesRef.current.applyOptions({ visible: false });
    }
  }, [showSpy, spyLine]);

  useEffect(() => {
    if (!vtiSeriesRef.current) return;
    if (showVti && vtiLine.length > 0) {
      vtiSeriesRef.current.setData(vtiLine as LineData<Time>[]);
      vtiSeriesRef.current.applyOptions({ visible: true });
    } else {
      vtiSeriesRef.current.setData([]);
      vtiSeriesRef.current.applyOptions({ visible: false });
    }
  }, [showVti, vtiLine]);

  useEffect(() => {
    handleResize();
  }, [handleResize]);

  if (!statusQuery.data?.seeded) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4" style={{ backgroundColor: COLORS.background }}>
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: COLORS.opht }} />
        <p className="text-lg" style={{ color: COLORS.textSecondary }}>
          Loading market data for the first time...
        </p>
        <p className="text-sm" style={{ color: COLORS.textMuted }}>
          Fetching 10 years of historical data for 28 tickers. This may take a few minutes.
        </p>
      </div>
    );
  }

  if (chartDataQuery.isLoading || holdingsQuery.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: COLORS.background }}>
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: COLORS.opht }} />
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: COLORS.background, color: COLORS.textPrimary }}>
      <div className="max-w-6xl mx-auto px-4 py-6 md:py-10">

        {/* Header */}
        <header className="mb-6 md:mb-8" data-testid="header-section">
          <div className="flex flex-col gap-1">
            <div className="flex items-baseline gap-3 flex-wrap">
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight" data-testid="text-title">
                Ophthalmology Sector ETF
              </h1>
              <span
                className="text-lg md:text-xl font-semibold"
                style={{ color: COLORS.opht }}
                data-testid="text-ticker"
              >
                $OPHT
              </span>
            </div>
            <p className="text-sm md:text-base" style={{ color: COLORS.textSecondary }} data-testid="text-tagline">
              A custom-constructed index tracking publicly traded ophthalmology companies.
            </p>
          </div>
        </header>

        {/* Controls */}
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between" data-testid="controls-section">

          {/* Weighting toggle */}
          <div className="flex rounded-md p-1 gap-1" style={{ backgroundColor: COLORS.surface }} data-testid="weighting-toggle">
            {WEIGHTING_MODES.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setWeightingMode(key)}
                className="px-3 py-2 md:py-1.5 text-xs md:text-sm font-medium rounded-md transition-colors flex-1 md:flex-none"
                style={{
                  backgroundColor: weightingMode === key ? "rgba(211, 240, 96, 0.15)" : "transparent",
                  color: weightingMode === key ? COLORS.opht : COLORS.textSecondary,
                  border: weightingMode === key ? `1px solid rgba(211, 240, 96, 0.3)` : "1px solid transparent",
                }}
                data-testid={`button-weighting-${key}`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Benchmark chips */}
          <div className="flex gap-2" data-testid="benchmark-toggles">
            <span className="text-xs self-center mr-1" style={{ color: COLORS.textMuted }}>Benchmarks:</span>
            <button
              onClick={() => setShowSpy(!showSpy)}
              className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
              style={{
                backgroundColor: showSpy ? "rgba(77, 184, 164, 0.15)" : "transparent",
                color: showSpy ? COLORS.spy : COLORS.textMuted,
                border: showSpy ? `1px solid rgba(77, 184, 164, 0.3)` : `1px solid ${COLORS.border}`,
              }}
              data-testid="button-toggle-spy"
            >
              SPY
            </button>
            <button
              onClick={() => setShowVti(!showVti)}
              className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
              style={{
                backgroundColor: showVti ? "rgba(91, 141, 239, 0.15)" : "transparent",
                color: showVti ? COLORS.vti : COLORS.textMuted,
                border: showVti ? `1px solid rgba(91, 141, 239, 0.3)` : `1px solid ${COLORS.border}`,
              }}
              data-testid="button-toggle-vti"
            >
              VTI
            </button>
          </div>
        </div>

        {/* Chart */}
        <div
          className="rounded-md relative"
          style={{ backgroundColor: COLORS.surface, border: `1px solid ${COLORS.border}` }}
          data-testid="chart-container"
        >
          {/* Tooltip */}
          {tooltipData && (
            <div
              className="absolute top-3 left-3 z-10 rounded-md px-3 py-2 text-xs"
              style={{ backgroundColor: "rgba(13, 17, 23, 0.9)", border: `1px solid ${COLORS.border}` }}
              data-testid="chart-tooltip"
            >
              <div className="font-medium mb-1" style={{ color: COLORS.textPrimary }}>{tooltipData.date}</div>
              {tooltipData.opht !== undefined && (
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: COLORS.opht }} />
                  <span style={{ color: COLORS.opht }}>$OPHT: {tooltipData.opht?.toFixed(1)}</span>
                  <span style={{ color: (tooltipData.ophtReturn ?? 0) >= 0 ? COLORS.opht : "#ef4444" }}>
                    ({formatPercent(tooltipData.ophtReturn ?? 0)})
                  </span>
                </div>
              )}
              {tooltipData.spy !== undefined && showSpy && (
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: COLORS.spy }} />
                  <span style={{ color: COLORS.spy }}>SPY: {tooltipData.spy?.toFixed(1)}</span>
                  <span style={{ color: (tooltipData.spyReturn ?? 0) >= 0 ? COLORS.spy : "#ef4444" }}>
                    ({formatPercent(tooltipData.spyReturn ?? 0)})
                  </span>
                </div>
              )}
              {tooltipData.vti !== undefined && showVti && (
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: COLORS.vti }} />
                  <span style={{ color: COLORS.vti }}>VTI: {tooltipData.vti?.toFixed(1)}</span>
                  <span style={{ color: (tooltipData.vtiReturn ?? 0) >= 0 ? COLORS.vti : "#ef4444" }}>
                    ({formatPercent(tooltipData.vtiReturn ?? 0)})
                  </span>
                </div>
              )}
            </div>
          )}

          <div ref={chartContainerRef} className="w-full" style={{ minHeight: isMobile ? 300 : 420 }} />

          {/* Time range selector */}
          <div className="flex justify-center gap-1 pb-3 pt-2" data-testid="time-range-selector">
            {TIME_RANGES.map(r => (
              <button
                key={r}
                onClick={() => setTimeRange(r)}
                className={`${isMobile ? "px-3 py-2" : "px-2.5 py-1"} text-xs font-medium rounded-md transition-colors`}
                style={{
                  backgroundColor: timeRange === r ? "rgba(211, 240, 96, 0.15)" : "transparent",
                  color: timeRange === r ? COLORS.opht : COLORS.textMuted,
                }}
                data-testid={`button-range-${r}`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {/* Summary Stats Bar */}
        <div
          className="mt-4 rounded-md px-4 py-3 grid grid-cols-3 gap-2 md:flex md:flex-wrap md:gap-8 md:items-center text-sm"
          style={{ backgroundColor: COLORS.surface, border: `1px solid ${COLORS.border}` }}
          data-testid="summary-stats"
        >
          <div className="flex flex-col md:flex-row items-start md:items-center gap-1 md:gap-2">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS.opht }} />
              <span className="text-xs md:text-sm" style={{ color: COLORS.textSecondary }}>$OPHT</span>
            </div>
            <span
              className="font-semibold text-sm md:text-base"
              style={{ color: ophtReturn !== null && ophtReturn >= 0 ? COLORS.opht : "#ef4444" }}
              data-testid="text-opht-return"
            >
              {ophtReturn !== null ? formatPercent(ophtReturn) : "—"}
            </span>
          </div>

          <div className="hidden md:block w-px h-4" style={{ backgroundColor: COLORS.border }} />

          <div className="flex flex-col md:flex-row items-start md:items-center gap-1 md:gap-2">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS.spy }} />
              <span className="text-xs md:text-sm" style={{ color: COLORS.textSecondary }}>SPY</span>
            </div>
            <span
              className="font-semibold text-sm md:text-base"
              style={{
                color: showSpy ? (spyReturn !== null && spyReturn >= 0 ? COLORS.spy : "#ef4444") : COLORS.textMuted,
                opacity: showSpy ? 1 : 0.4,
              }}
              data-testid="text-spy-return"
            >
              {showSpy && spyReturn !== null ? formatPercent(spyReturn) : "—"}
            </span>
          </div>

          <div className="hidden md:block w-px h-4" style={{ backgroundColor: COLORS.border }} />

          <div className="flex flex-col md:flex-row items-start md:items-center gap-1 md:gap-2">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS.vti }} />
              <span className="text-xs md:text-sm" style={{ color: COLORS.textSecondary }}>VTI</span>
            </div>
            <span
              className="font-semibold text-sm md:text-base"
              style={{
                color: showVti ? (vtiReturn !== null && vtiReturn >= 0 ? COLORS.vti : "#ef4444") : COLORS.textMuted,
                opacity: showVti ? 1 : 0.4,
              }}
              data-testid="text-vti-return"
            >
              {showVti && vtiReturn !== null ? formatPercent(vtiReturn) : "—"}
            </span>
          </div>
        </div>

        {/* Holdings Table */}
        <div className="mt-6" data-testid="holdings-section">
          <h2 className="text-lg font-semibold mb-3" data-testid="text-holdings-title">
            Holdings
            <span className="text-xs font-normal ml-2" style={{ color: COLORS.textMuted }}>
              ({WEIGHTING_MODES.find(m => m.key === weightingMode)?.label} weighted)
            </span>
          </h2>
          <div
            className="rounded-md"
            style={{ backgroundColor: COLORS.surface, border: `1px solid ${COLORS.border}` }}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="table-holdings">
                <thead>
                  <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                    <th className="text-left px-3 md:px-4 py-2.5 font-medium" style={{ color: COLORS.textMuted }}>Ticker</th>
                    <th className="text-left px-3 md:px-4 py-2.5 font-medium hidden md:table-cell" style={{ color: COLORS.textMuted }}>Company</th>
                    <th className="text-right px-3 md:px-4 py-2.5 font-medium" style={{ color: COLORS.textMuted }}>Weight</th>
                    <th className="text-right px-3 md:px-4 py-2.5 font-medium" style={{ color: COLORS.textMuted }}>Mkt Cap</th>
                  </tr>
                </thead>
                <tbody>
                  {weights.map((h, i) => (
                    <tr
                      key={h.symbol}
                      style={{ borderBottom: i < weights.length - 1 ? `1px solid rgba(255,255,255,0.04)` : "none" }}
                      data-testid={`row-holding-${h.symbol}`}
                    >
                      <td className="px-3 md:px-4 py-2 md:py-2.5">
                        <span className="font-medium" style={{ color: COLORS.opht }}>{h.symbol}</span>
                        <span className="block text-xs md:hidden truncate max-w-[140px]" style={{ color: COLORS.textMuted }}>{h.companyName}</span>
                      </td>
                      <td className="px-3 md:px-4 py-2 md:py-2.5 hidden md:table-cell" style={{ color: COLORS.textSecondary }}>{h.companyName}</td>
                      <td className="px-3 md:px-4 py-2 md:py-2.5 text-right font-mono" style={{ color: COLORS.textPrimary }}>
                        {(h.weight * 100).toFixed(1)}%
                      </td>
                      <td className="px-3 md:px-4 py-2 md:py-2.5 text-right font-mono" style={{ color: COLORS.textSecondary }}>
                        {formatMarketCap(h.marketCap)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="mt-8 mb-6 text-center text-xs" style={{ color: COLORS.textMuted }} data-testid="footer-section">
          <p className="mb-1">
            Methodology: {weightingMode === "market_cap" ? "Float-adjusted market cap weighted" : weightingMode === "equal_weight" ? "Equal weighted" : "Market cap weighted, capped at 25% per holding"}.
            Daily rebalancing using end-of-day adjusted close prices.
          </p>
          <p className="mb-1">
            This is a custom-constructed index for educational and informational purposes only. Not investment advice.
            Past performance does not guarantee future results.
          </p>
          <p>Built by jwebking</p>
        </footer>
      </div>
    </div>
  );
}
