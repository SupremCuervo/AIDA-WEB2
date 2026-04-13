"use client";

import { createContext, useContext, type ReactNode } from "react";

type ValorPanelAlumno = {
	refrescarSesion: () => Promise<void>;
};

const PanelAlumnoContext = createContext<ValorPanelAlumno | null>(null);

export function PanelAlumnoProvider({
	refrescarSesion,
	children,
}: {
	refrescarSesion: () => Promise<void>;
	children: ReactNode;
}) {
	return (
		<PanelAlumnoContext.Provider value={{ refrescarSesion }}>
			{children}
		</PanelAlumnoContext.Provider>
	);
}

export function useRefrescarSesionAlumno(): () => Promise<void> {
	const ctx = useContext(PanelAlumnoContext);
	if (!ctx) {
		throw new Error("useRefrescarSesionAlumno debe usarse dentro de PanelAlumnoProvider");
	}
	return ctx.refrescarSesion;
}
