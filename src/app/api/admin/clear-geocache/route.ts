import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(req: NextRequest) {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret || req.headers.get("x-admin-secret") !== adminSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const deleted = await prisma.geoCache.deleteMany({ where: { lat: null } });
    const remaining = await prisma.geoCache.count();
    return NextResponse.json({ deleted: deleted.count, remaining });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
