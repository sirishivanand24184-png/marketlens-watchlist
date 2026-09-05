import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// POST /api/watchlist/:id { symbol } -> add symbol
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { symbol } = await req.json();
  if (!symbol) {
    return NextResponse.json({ error: "symbol required" }, { status: 400 });
  }
  const normalizedSymbol = String(symbol).trim().toUpperCase();
  if (!/^[A-Z0-9.-]{1,16}$/.test(normalizedSymbol)) {
    return NextResponse.json({ error: "symbol must be 1-16 letters, numbers, dots or dashes" }, { status: 400 });
  }
  const item = await prisma.watchlistItem.upsert({
    where: { watchlistId_symbol: { watchlistId: params.id, symbol: normalizedSymbol } },
    create: { watchlistId: params.id, symbol: normalizedSymbol },
    update: {},
  });
  return NextResponse.json(item, { status: 201 });
}

// DELETE /api/watchlist/:id?symbol=AAPL -> remove symbol
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const symbol = req.nextUrl.searchParams.get("symbol");
  if (!symbol) {
    return NextResponse.json({ error: "symbol required" }, { status: 400 });
  }
  const result = await prisma.watchlistItem.deleteMany({
    where: { watchlistId: params.id, symbol: symbol.toUpperCase() },
  });
  return NextResponse.json({ ok: true, removed: result.count });
}
