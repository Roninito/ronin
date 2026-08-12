/**
 * Fetch account health metrics: buying power, margin used, and equity.
 */
import { alpacaFetch } from "./utils.js";

interface AlpacaAccount {
  status: string;
  currency: string;
  cash: string;
  portfolio_value: string;
  buying_power: string;
  equity: string;
  last_equity: string;
  long_market_value: string;
  short_market_value: string;
  daytrade_count: number;
  pattern_day_trader: boolean;
}

async function main(): Promise<void> {
  try {
    const account = await alpacaFetch<AlpacaAccount>("/v2/account");
    const equity = parseFloat(account.equity);
    const lastEquity = parseFloat(account.last_equity);
    const dayPnl = equity - lastEquity;
    const dayPnlPct = lastEquity !== 0 ? (dayPnl / lastEquity) * 100 : 0;
    const marketValue = parseFloat(account.long_market_value) + Math.abs(parseFloat(account.short_market_value));
    const marginUsed = equity !== 0 ? (marketValue / equity) * 100 : 0;

    console.log(JSON.stringify({
      success: true,
      status: account.status,
      currency: account.currency,
      cash: parseFloat(account.cash),
      equity,
      buyingPower: parseFloat(account.buying_power),
      dayPnl: parseFloat(dayPnl.toFixed(2)),
      dayPnlPct: parseFloat(dayPnlPct.toFixed(2)),
      marginUsedPct: parseFloat(marginUsed.toFixed(2)),
      dayTradeCount: account.daytrade_count,
      patternDayTrader: account.pattern_day_trader,
    }));
  } catch (e) {
    console.log(JSON.stringify({ success: false, error: (e as Error).message }));
    process.exit(1);
  }
}

main();
