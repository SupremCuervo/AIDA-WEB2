"use client";

import { useCallback, useEffect, useState } from "react";
import { DURACION_MENSAJE_EMERGENTE_MS } from "@/lib/ui/duracion-mensaje-emergente-ms";

type CarreraRow = { id: string; codigo: string; nombre: string };

export default function CarrerasSistemaOrientador() {
	const [lista, setLista] = useState<CarreraRow[]>([]);
	const [cargando, setCargando] = useState(true);
	const [errorMsg, setErrorMsg] = useState("");
	const [okMsg, setOkMsg] = useState("");
	const [nuevaNombre, setNuevaNombre] = useState("");
	const [guardandoNueva, setGuardandoNueva] = useState(false);
	const [editId, setEditId] = useState<string | null>(null);
	const [editNombre, setEditNombre] = useState("");
	const [guardandoEdit, setGuardandoEdit] = useState(false);

	const cargar = useCallback(async () => {
		setCargando(true);
		setErrorMsg("");
		try {
			const res = await fetch("/api/orientador/carreras", { credentials: "include" });
			const d = (await res.json()) as { carreras?: CarreraRow[]; error?: string };
			if (!res.ok) {
				setErrorMsg(d.error ?? "No se pudieron cargar las carreras");
				return;
			}
			setLista(d.carreras ?? []);
		} catch {
			setErrorMsg("Error de red al cargar el catálogo.");
		} finally {
			setCargando(false);
		}
	}, []);

	useEffect(() => {
		void cargar();
	}, [cargar]);

	useEffect(() => {
		if (!errorMsg.trim()) {
			return;
		}
		const id = window.setTimeout(() => setErrorMsg(""), DURACION_MENSAJE_EMERGENTE_MS);
		return () => window.clearTimeout(id);
	}, [errorMsg]);

	async function agregar() {
		const n = nuevaNombre.trim();
		if (!n) {
			return;
		}
		setGuardandoNueva(true);
		setErrorMsg("");
		try {
			const res = await fetch("/api/orientador/carreras", {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ nombre: n }),
			});
			const d = (await res.json()) as { error?: string };
			if (!res.ok) {
				setErrorMsg(d.error ?? "No se pudo crear la carrera");
				return;
			}
			setNuevaNombre("");
			setOkMsg("Carrera agregada.");
			setTimeout(() => setOkMsg(""), DURACION_MENSAJE_EMERGENTE_MS);
			await cargar();
		} catch {
			setErrorMsg("Error de red al crear la carrera.");
		} finally {
			setGuardandoNueva(false);
		}
	}

	function iniciarEdicion(c: CarreraRow) {
		setEditId(c.id);
		setEditNombre(c.nombre);
		setErrorMsg("");
	}

	async function guardarEdicion(id: string) {
		const n = editNombre.trim();
		if (!n) {
			return;
		}
		setGuardandoEdit(true);
		setErrorMsg("");
		try {
			const res = await fetch("/api/orientador/carreras", {
				method: "PATCH",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ carreraId: id, nombre: n }),
			});
			const d = (await res.json()) as { error?: string };
			if (!res.ok) {
				setErrorMsg(d.error ?? "No se pudo guardar");
				return;
			}
			setEditId(null);
			setOkMsg("Carrera actualizada.");
			setTimeout(() => setOkMsg(""), DURACION_MENSAJE_EMERGENTE_MS);
			await cargar();
		} catch {
			setErrorMsg("Error de red al guardar.");
		} finally {
			setGuardandoEdit(false);
		}
	}

	return (
		<div className="mx-auto mt-5 max-w-3xl px-4 pb-16">
			<h2 className="text-center text-2xl font-bold text-slate-900">Carreras</h2>
			<p className="mt-3 flex flex-wrap items-center justify-center gap-2 text-center text-sm text-slate-600">

			</p>

			{errorMsg ? (
				<p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-700">{errorMsg}</p>
			) : null}
			{okMsg ? (
				<p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-center text-sm text-emerald-800">{okMsg}</p>
			) : null}

			<div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
				<h3 className="text-lg font-bold text-slate-900">Agregar carrera</h3>
				<div className="mt-4 flex flex-wrap gap-2">
					<input
						type="text"
						value={nuevaNombre}
						onChange={(e) => setNuevaNombre(e.target.value)}
						placeholder="Nombre de la carrera (p. ej. Enfermería)"
						className="min-w-[12rem] flex-1 rounded-xl border border-slate-300 px-3 py-2.5 text-slate-900 outline-none focus:border-[#A78BFA] focus:ring-2 focus:ring-[#EDE9FE]"
					/>
					<button
						type="button"
						disabled={guardandoNueva || !nuevaNombre.trim()}
						onClick={() => void agregar()}
						className="rounded-xl border border-[#7C3AED] bg-[#8B5CF6] px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#7C3AED] disabled:opacity-50"
					>
						{guardandoNueva ? "Guardando…" : "Agregar"}
					</button>
				</div>
			</div>

			<div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
				<h3 className="text-lg font-bold text-slate-900">Carreras registradas</h3>
				{cargando ? (
					<p className="mt-4 text-center text-sm text-slate-500">Cargando…</p>
				) : lista.length === 0 ? (
					<p className="mt-4 text-center text-sm text-slate-500">Aún no hay carreras. Agrega la primera arriba.</p>
				) : (
					<ul className="mt-4 space-y-3">
						{lista.map((c) => (
							<li
								key={c.id}
								className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/80 p-4 sm:flex-row sm:items-center sm:justify-between"
							>
								<div className="min-w-0 flex-1">
									<p className="font-mono text-xs text-slate-500">Código: {c.codigo}</p>
									{editId === c.id ? (
										<input
											type="text"
											value={editNombre}
											onChange={(e) => setEditNombre(e.target.value)}
											className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
										/>
									) : (
										<p className="mt-1 font-semibold text-slate-900">{c.nombre}</p>
									)}
								</div>
								<div className="flex shrink-0 flex-wrap gap-2">
									{editId === c.id ? (
										<>
											<button
												type="button"
												disabled={guardandoEdit}
												onClick={() => {
													setEditId(null);
												}}
												className="rounded-lg border border-slate-400 bg-white px-4 py-2 text-sm font-semibold text-slate-800"
											>
												Cancelar
											</button>
											<button
												type="button"
												disabled={guardandoEdit || !editNombre.trim()}
												onClick={() => void guardarEdicion(c.id)}
												className="rounded-lg border border-[#7C3AED] bg-[#8B5CF6] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
											>
												{guardandoEdit ? "…" : "Guardar"}
											</button>
										</>
									) : (
										<button
											type="button"
											onClick={() => iniciarEdicion(c)}
											className="rounded-lg border border-slate-400 bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-900"
										>
											Editar nombre
										</button>
									)}
								</div>
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}
