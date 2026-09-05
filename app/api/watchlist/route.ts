import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// GET /api/watchlist?userId=... -> list watchlists
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }
  const watchlists = await prisma.watchlist.findMany({
    where: { userId },
    include: { items: true },
  });
  return NextResponse.json(watchlists);
}

// POST /api/watchlist { userId, name } -> create watchlist
export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }
  // Upsert-by-convention so the demo frontend can call this before any real
  // auth exists. A production build would replace this with a session-derived
  // userId and drop the auto-create entirely.
  await prisma.user.upsert({
    where: { id: body.userId },
    create: { id: body.userId, email: `${body.userId}@example.com` },
    update: {},
  });

  const watchlist = await prisma.watchlist.create({
    data: { userId: body.userId, name: body.name ?? "My Watchlist" },
  });
  return NextResponse.json(watchlist, { status: 201 });
}
