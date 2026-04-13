"use client";

import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from "react";

export type SeccionOrientadorEnfoque =
	| "expediente"
	| "crear_tabla"
	| "escaner"
	| "plantillas"
	| "cargas"
	| "escolar"
	| "historial";

/** Anclas `id` en el DOM para desplazar la vista al mensaje relevante. */
export const ANCLA_SECCION = {
	expediente: "sec-expediente",
	crear_tabla: "sec-crear-tabla",
	escaner: "sec-escaner",
	plantillas: "sec-plantillas",
	cargas: "sec-cargas",
	escolar: "sec-escolar",
	historial: "sec-historial",
} as const satisfies Record<SeccionOrientadorEnfoque, string>;

function scrollToAnchor(anchorId: string) {
	document.getElementById(anchorId)?.scrollIntoView({ behavior: "smooth", block: "center" });
}

/**
 * Cambia la sección del panel, actualiza `?seccion=` y desplaza al ancla.
 * @param seccionVistaAntes — Valor de `seccionActiva` **antes** de llamar a `setSeccionActiva`.
 */
export function runEnfocarSeccion(
	seccion: SeccionOrientadorEnfoque,
	setSeccionActiva: (s: SeccionOrientadorEnfoque) => void,
	seccionVistaAntes: SeccionOrientadorEnfoque,
	anchorId?: string,
) {
	setSeccionActiva(seccion);
	if (typeof window !== "undefined") {
		const url = new URL(window.location.href);
		url.searchParams.set("seccion", seccion);
		// `url.search` ya incluye el `?` inicial; no anteponer otro o la URL queda como …/panel??seccion=…
		window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
	}
	const destino = anchorId ?? ANCLA_SECCION[seccion];
	if (seccionVistaAntes === seccion) {
		requestAnimationFrame(() => requestAnimationFrame(() => scrollToAnchor(destino)));
	} else {
		window.setTimeout(() => scrollToAnchor(destino), 320);
	}
}

type Ctx = {
	enfocarSeccion: (seccion: SeccionOrientadorEnfoque, anchorId?: string) => void;
};

const OrientadorPanelEnfoqueContext = createContext<Ctx | null>(null);

export function OrientadorPanelEnfoqueProvider({
	seccionActiva,
	setSeccionActiva,
	children,
}: {
	seccionActiva: SeccionOrientadorEnfoque;
	setSeccionActiva: (s: SeccionOrientadorEnfoque) => void;
	children: ReactNode;
}) {
	const seccionRef = useRef(seccionActiva);
	useEffect(() => {
		seccionRef.current = seccionActiva;
	}, [seccionActiva]);

	const enfocarSeccion = useCallback(
		(seccion: SeccionOrientadorEnfoque, anchorId?: string) => {
			const anterior = seccionRef.current;
			runEnfocarSeccion(seccion, setSeccionActiva, anterior, anchorId);
		},
		[setSeccionActiva],
	);

	return (
		<OrientadorPanelEnfoqueContext.Provider value={{ enfocarSeccion }}>
			{children}
		</OrientadorPanelEnfoqueContext.Provider>
	);
}

export function useOrientadorPanelEnfoque(): Ctx {
	const v = useContext(OrientadorPanelEnfoqueContext);
	return v ?? { enfocarSeccion: () => {} };
}
