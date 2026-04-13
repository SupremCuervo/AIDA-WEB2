import { NextResponse } from "next/server";
import { COOKIE_ORIENTADOR } from "@/lib/alumno/jwt-cookies";

export const runtime = "nodejs";

export async function POST() {
	const res = NextResponse.json({ ok: true });
	res.cookies.delete(COOKIE_ORIENTADOR);
	return res;
}
