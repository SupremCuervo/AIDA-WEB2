import Image from "next/image";
import Link from "next/link";

export default function HomePage() {
	return (
		<main className="flex min-h-screen flex-col items-center justify-center gap-10 bg-slate-50 px-6 py-12">
			<div className="flex flex-col items-center gap-4 text-center">
				<Image
					src="/imagenes/Inicio/NameLogo.png"
					alt="AIDA"
					width={280}
					height={120}
					priority
					className="h-auto w-auto max-w-[min(100%,280px)]"
				/>
				<p className="max-w-md text-sm text-slate-600">
					Selecciona tu rol para continuar.
				</p>
			</div>

			<div className="grid w-full max-w-2xl gap-6 sm:grid-cols-2">
				<Link
					href="/alumno"
					className="group flex flex-col items-center gap-4 rounded-2xl border-2 border-slate-200 bg-white p-8 shadow-sm transition hover:border-sky-400 hover:shadow-md"
				>
					<div className="relative h-40 w-40 overflow-hidden rounded-xl border-2 border-slate-200 ring-2 ring-transparent transition group-hover:border-sky-300 group-hover:ring-sky-100">
						<Image
							src="/imagenes/Inicio/alumno.png"
							alt="Alumno"
							fill
							className="object-cover"
							sizes="160px"
						/>
					</div>
					<span className="text-lg font-semibold text-slate-800">Alumno</span>
				</Link>

				<Link
					href="/orientador"
					className="group flex flex-col items-center gap-4 rounded-2xl border-2 border-slate-200 bg-white p-8 shadow-sm transition hover:border-emerald-400 hover:shadow-md"
				>
					<div className="relative h-40 w-40 overflow-hidden rounded-xl border-2 border-slate-200 ring-2 ring-transparent transition group-hover:border-emerald-300 group-hover:ring-emerald-100">
						<Image
							src="/imagenes/Inicio/orientador.png"
							alt="Orientador"
							fill
							className="object-cover"
							sizes="160px"
						/>
					</div>
					<span className="text-lg font-semibold text-slate-800">Orientador</span>
				</Link>
			</div>
		</main>
	);
}
