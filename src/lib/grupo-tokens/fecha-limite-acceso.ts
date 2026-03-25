/**
 * Fecha límite en grupo_tokens (YYYY-MM-DD). Sin fecha = el acceso no caduca por calendario.
 * El día indicado es el último día válido; desde el día siguiente el token deja de admitir acceso.
 */
export function zonaHorariaFechaLimite(): string {
	const z = process.env.AIDA_FECHA_LIMITE_ZONA?.trim();
	return z && z.length > 0 ? z : "America/Mexico_City";
}

export function ymdHoyEnZona(zona: string): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: zona,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(new Date());
}

export function esGrupoAccesoCerradoPorFecha(fechaLimiteEntrega: string | null | undefined): boolean {
	if (fechaLimiteEntrega == null || String(fechaLimiteEntrega).trim() === "") {
		return false;
	}
	const limite = String(fechaLimiteEntrega).trim().slice(0, 10);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(limite)) {
		return false;
	}
	const hoy = ymdHoyEnZona(zonaHorariaFechaLimite());
	return hoy > limite;
}
