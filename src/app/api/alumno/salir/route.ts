import { NextResponse } from "next/server";
import { COOKIE_ALUMNO, COOKIE_CLAVE_OK } from "@/lib/alumno/jwt-cookies";

export const runtime = "nodejs";

export async function POST() {
	const res = NextResponse.json({ ok: true });
	res.cookies.delete(COOKIE_ALUMNO);
	res.cookies.delete(COOKIE_CLAVE_OK);
	return res;
}
