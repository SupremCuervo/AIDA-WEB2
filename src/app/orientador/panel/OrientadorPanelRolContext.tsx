"use client";

import { createContext, useContext, type ReactNode } from "react";

export type RolPanelOrientador = "normal" | "jefe";

const OrientadorRolPanelContext = createContext<RolPanelOrientador>("jefe");

export function OrientadorRolPanelProvider({
	rol,
	children,
}: {
	rol: RolPanelOrientador;
	children: ReactNode;
}) {
	return (
		<OrientadorRolPanelContext.Provider value={rol}>{children}</OrientadorRolPanelContext.Provider>
	);
}

export function useOrientadorRolPanel(): RolPanelOrientador {
	return useContext(OrientadorRolPanelContext);
}
