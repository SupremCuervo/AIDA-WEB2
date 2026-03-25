import type { ReactNode } from "react";
import { Suspense } from "react";
import OrientadorPanelShell from "./OrientadorPanelShell";

export default function OrientadorPanelLayout({ children }: { children: ReactNode }) {
	return (
		<OrientadorPanelShell>
			<Suspense fallback={<div className="p-8 text-center text-slate-600">Cargando…</div>}>{children}</Suspense>
		</OrientadorPanelShell>
	);
}
