import { Suspense } from "react";
import EditorPlantillaCliente from "./EditorPlantillaCliente";

export default function EditarPlantillaPage() {
	return (
		<Suspense
			fallback={
				<div className="flex min-h-screen items-center justify-center bg-slate-100 text-slate-600">
					Cargando editor…
				</div>
			}
		>
			<EditorPlantillaCliente />
		</Suspense>
	);
}
