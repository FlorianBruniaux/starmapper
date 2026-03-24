import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST() {
  try {
    const deleted = await prisma.geoCache.deleteMany({ where: { lat: null } });
    const remaining = await prisma.geoCache.count();
    return NextResponse.json({ deleted: deleted.count, remaining });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
