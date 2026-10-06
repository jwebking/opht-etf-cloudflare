export const OPHT_TICKERS: Record<string, string> = {
  ADVM: "Adverum Biotechnologies",
  ALC: "Alcon Inc.",
  APLS: "Apellis Pharmaceuticals",
  BLCO: "Bausch + Lomb Corporation",
  CLSD: "Clearside Biomedical",
  COO: "The Cooper Companies",
  CZMWY: "Carl Zeiss Meditec (ADR)",
  EYPT: "EyePoint Pharmaceuticals",
  GKOS: "Glaukos Corporation",
  HOCPY: "Hoya Corporation (ADR)",
  HROW: "Harrow Inc.",
  IRIX: "IRIDEX Corporation",
  KALA: "Kala Bio",
  KOD: "Kodiak Sciences",
  LENZ: "LENZ Therapeutics",
  LNSR: "LENSAR Inc.",
  OCGN: "Ocugen Inc.",
  OCS: "Oculis Holding",
  OCUL: "Ocular Therapeutix",
  OKYO: "OKYO Pharma",
  RXST: "RxSight Inc.",
  SGHT: "Sight Sciences",
  SGP: "SpyGlass Pharma",
  STAA: "STAAR Surgical Company",
  TARS: "Tarsus Pharmaceuticals",
  VRDN: "Viridian Therapeutics",
};

export const BENCHMARK_TICKERS: Record<string, string> = {
  SPY: "SPDR S&P 500 ETF Trust",
  VTI: "Vanguard Total Stock Market ETF",
};

export const ALL_SYMBOLS = [...Object.keys(OPHT_TICKERS), ...Object.keys(BENCHMARK_TICKERS)];
