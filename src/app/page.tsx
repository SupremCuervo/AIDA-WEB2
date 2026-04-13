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
				<p className="max-w-md text-xl font-bold text-slate-700 sm:text-2xl">
					Selecciona tu rol para continuar.
				</p>
			</div>

			<div className="grid w-full max-w-4xl gap-8 sm:grid-cols-2">
				<Link
					href="/orientador"
					className="group flex min-h-[min(100%,22rem)] flex-col items-center justify-center gap-6 rounded-3xl border-2 border-slate-200 bg-white p-10 shadow-sm transition hover:border-violet-400 hover:shadow-lg sm:min-h-[24rem] sm:p-12"
				>
					<div className="relative h-48 w-48 overflow-hidden rounded-2xl border-2 border-slate-200 ring-2 ring-transparent transition group-hover:border-violet-300 group-hover:ring-violet-100 sm:h-56 sm:w-56">
						<Image
							src="/imagenes/Inicio/orientador.png"
							alt="Orientador"
							fill
							className="object-cover"
							sizes="(max-width: 640px) 192px, 224px"
						/>
					</div>
					<span className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
						Orientador
					</span>
				</Link>

				<Link
					href="/alumno"
					className="group flex min-h-[min(100%,22rem)] flex-col items-center justify-center gap-6 rounded-3xl border-2 border-slate-200 bg-white p-10 shadow-sm transition hover:border-sky-400 hover:shadow-lg sm:min-h-[24rem] sm:p-12"
				>
					<div className="relative h-48 w-48 overflow-hidden rounded-2xl border-2 border-slate-200 ring-2 ring-transparent transition group-hover:border-sky-300 group-hover:ring-sky-100 sm:h-56 sm:w-56">
						<Image
							src="/imagenes/Inicio/alu.png"
							alt="Alumno"
							fill
							className="object-cover"
							sizes="(max-width: 640px) 192px, 224px"
						/>
					</div>
					<span className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
						Alumno
					</span>
				</Link>
			</div>
		</main>
	);
}
