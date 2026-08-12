/**
 * Fetch all current open positions.
 */
import { alpacaFetch } from "./utils.js";

interface AlpacaPosition {
  symbol: string;
  qty: string;
  avg_entry_price: string;
  market_value: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  current_price: string;
  side: "long" | "short";
}

async function main(): Promise<void> {
  try {
    const positions = await alpacaFetch<AlpacaPosition[]>("/v2/positions");
    console.log(JSON.stringify({
      success: true,
      positions: positions.map((p) => ({
        symbol: p.symbol,
        qty: parseFloat(p.qty),
        side: p.side,
        avgEntryPrice: parseFloat(p.avg_entry_price),
        currentPrice: parseFloat(p.current_price),
        marketValue: parseFloat(p.market_value),
        unrealizedPl: parseFloat(p.unrealized_pl),
        unrealizedPlPct: parseFloat(p.unrealized_plpc) * 100,
      })),
      count: positions.length,
    }));
  } catch (e) {
    console.log(JSON.stringify({ success: false, error: (e as Error).message }));
    process.exit(1);
  }
}

main();
