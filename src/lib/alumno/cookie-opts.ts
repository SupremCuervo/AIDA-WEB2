export function opcionesCookieHttp(maxAgeSegundos: number) {
	return {
		httpOnly: true,
		sameSite: "lax" as const,
		path: "/",
		secure: process.env.NODE_ENV === "production",
		maxAge: maxAgeSegundos,
	};
}
