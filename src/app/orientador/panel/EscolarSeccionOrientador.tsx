"use client";

import CargasPeriodosOrientador from "./CargasPeriodosOrientador";
import CarrerasSistemaOrientador from "./CarrerasSistemaOrientador";
import SolicitudesAccesoEscolarOrientador from "./SolicitudesAccesoEscolarOrientador";
import { useOrientadorRolPanel } from "./OrientadorPanelRolContext";

export default function EscolarSeccionOrientador() {
	const rolPanel = useOrientadorRolPanel();

	return (
		<div id="sec-escolar" className="mx-auto w-full max-w-none pb-16">
			<div className="mt-10 grid gap-10 lg:grid-cols-2 lg:items-start">
				<section aria-labelledby="escolar-periodos-titulo" className="min-w-0 space-y-0">
					<h3
						id="escolar-periodos-titulo"
						className="mb-4 text-center text-xl font-bold text-slate-900"
					>
						Periodos
					</h3>
					<div className="[&>div]:mt-0">
						<CargasPeriodosOrientador modo="periodos" />
					</div>
					{rolPanel === "jefe" ? (
						<SolicitudesAccesoEscolarOrientador />
					) : null}
				</section>
				<section aria-labelledby="escolar-carreras-titulo" className="min-w-0">
					<h3
						id="escolar-carreras-titulo"
						className="mb-4 text-center text-xl font-bold text-slate-900"
					>
						Carreras
					</h3>
					<div className="[&>div]:mt-0">
						<CarrerasSistemaOrientador variante="incrustado" />
					</div>
				</section>
			</div>
		</div>
	);
}
