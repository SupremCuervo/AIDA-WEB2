import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cliente: SupabaseClient | null = null;

export function obtenerClienteSupabaseAdmin(): SupabaseClient {
	if (cliente) {
		return cliente;
	}
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) {
		throw new Error(
			"Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno.",
		);
	}
	cliente = createClient(url, key, {
		auth: { persistSession: false, autoRefreshToken: false },
	});
	return cliente;
}
