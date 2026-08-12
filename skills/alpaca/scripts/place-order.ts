/**
 * Place a single order. Defaults to a market, day-in-force order.
 * Params: --symbol=... --qty=... --side=buy|sell [--type=market|limit|stop|stop_limit] [--limitPrice=...]
 */
import { parseArgs, alpacaFetch } from "./utils.js";

interface AlpacaOrder {
  id: string;
  symbol: string;
  qty: string;
  side: string;
  type: string;
  status: string;
  submitted_at: string;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const symbol = args.symbol?.toUpperCase();
  const qty = args.qty ? Number(args.qty) : undefined;
  const side = args.side as "buy" | "sell" | undefined;
  const type = (args.type as "market" | "limit" | "stop" | "stop_limit") || "market";
  const limitPrice = args.limitPrice ? Number(args.limitPrice) : undefined;

  if (!symbol || !qty || !side) {
    console.log(JSON.stringify({ success: false, error: "symbol, qty, and side are required" }));
    process.exit(1);
  }
  if (side !== "buy" && side !== "sell") {
    console.log(JSON.stringify({ success: false, error: 'side must be "buy" or "sell"' }));
    process.exit(1);
  }

  const body: Record<string, unknown> = {
    symbol,
    qty: String(qty),
    side,
    type,
    time_in_force: type === "market" ? "day" : "gtc",
  };
  if (limitPrice !== undefined) body.limit_price = String(limitPrice);

  try {
    const order = await alpacaFetch<AlpacaOrder>("/v2/orders", {
      method: "POST",
      body: JSON.stringify(body),
    });
    console.log(JSON.stringify({
      success: true,
      orderId: order.id,
      symbol: order.symbol,
      qty: parseFloat(order.qty),
      side: order.side,
      type: order.type,
      status: order.status,
      submittedAt: order.submitted_at,
    }));
  } catch (e) {
    console.log(JSON.stringify({ success: false, error: (e as Error).message }));
    process.exit(1);
  }
}

main();
