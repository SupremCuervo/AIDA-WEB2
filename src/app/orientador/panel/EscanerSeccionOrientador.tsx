"use client";

import { useCallback, useState } from "react";
import ModalCapturaEscaner, { type ResultadoCapturaEscaner } from "./escaner/ModalCapturaEscaner";
import ModalDefinirCamposPlantillaEscaner from "./escaner/ModalDefinirCamposPlantillaEscaner";
import ModalSubirExpedienteEscaner from "./escaner/ModalSubirExpedienteEscaner";

export default function EscanerSeccionOrientador() {
	const [capturaPdf, setCapturaPdf] = useState(false);
	const [capturaPlantilla, setCapturaPlantilla] = useState(false);
	const [resultadoPdf, setResultadoPdf] = useState<ResultadoCapturaEscaner | null>(null);
	const [subirAbierto, setSubirAbierto] = useState(false);
	const [plantillaPdf, setPlantillaPdf] = useState<{ blob: Blob; nombre: string } | null>(null);
	const [definirAbierto, setDefinirAbierto] = useState(false);

	const onCrearPdfExpediente = useCallback((r: ResultadoCapturaEscaner) => {
		setCapturaPdf(false);
		setResultadoPdf(r);
		setSubirAbierto(true);
	}, []);

	const onCrearPdfPlantilla = useCallback((r: ResultadoCapturaEscaner) => {
		setCapturaPlantilla(false);
		setPlantillaPdf({ blob: r.pdfBlob, nombre: r.nombre });
		setDefinirAbierto(true);
	}, []);

	return (
		<div className="mx-auto mt-5 flex w-full max-w-5xl flex-col items-center px-4 sm:px-6">
			<h2 className="mb-10 text-center text-2xl font-bold tracking-tight text-[#111827] sm:mb-12 sm:text-3xl">
				Escaneo de archivos mediante cámara
			</h2>

			<div className="grid w-full max-w-4xl grid-cols-1 justify-items-center gap-8 md:grid-cols-2 md:gap-10">
				<button
					type="button"
					onClick={() => setCapturaPdf(true)}
					className="flex aspect-square w-full max-w-[min(100%,20rem)] flex-col items-center justify-center gap-6 rounded-3xl border-[3px] border-[#7C3AED] bg-white p-6 text-center shadow-[0_8px_0_0_#E9D5FF,0_12px_32px_rgba(124,58,237,0.18)] transition hover:translate-y-0.5 hover:shadow-[0_6px_0_0_#E9D5FF,0_10px_28px_rgba(124,58,237,0.14)] active:translate-y-1 active:shadow-none sm:max-w-[22rem] sm:gap-8 sm:rounded-[2rem] sm:p-8 md:max-w-none"
				>
					<span className="max-w-[15rem] text-lg font-bold leading-snug text-[#111827] sm:text-xl md:text-2xl">
						Escanear y crear archivo PDF
					</span>
					<span className="flex flex-col items-center" aria-hidden>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 120 140"
							className="h-32 w-28 sm:h-36 sm:w-32"
							fill="none"
						>
							<path
								d="M20 8h52l28 28v88a8 8 0 0 1-8 8H20a8 8 0 0 1-8-8V16a8 8 0 0 1 8-8z"
								fill="#F3F4F6"
								stroke="#111827"
								strokeWidth="2.5"
							/>
							<path d="M72 8v28h28" fill="#E5E7EB" stroke="#111827" strokeWidth="2.5" />
							<rect x="8" y="98" width="104" height="34" rx="2" fill="#111827" />
							<text
								x="60"
								y="121"
								textAnchor="middle"
								fill="#FFFFFF"
								fontSize="20"
								fontWeight="800"
								fontFamily="system-ui, -apple-system, sans-serif"
							>
								PDF
							</text>
						</svg>
					</span>
				</button>

				<button
					type="button"
					onClick={() => setCapturaPlantilla(true)}
					className="flex aspect-square w-full max-w-[min(100%,20rem)] flex-col items-center justify-center gap-6 rounded-3xl border-[3px] border-[#DC2626] bg-white p-6 text-center shadow-[0_8px_0_0_#FECACA,0_12px_32px_rgba(220,38,38,0.16)] transition hover:translate-y-0.5 hover:shadow-[0_6px_0_0_#FECACA,0_10px_28px_rgba(220,38,38,0.12)] active:translate-y-1 active:shadow-none sm:max-w-[22rem] sm:gap-8 sm:rounded-[2rem] sm:p-8 md:max-w-none"
				>
					<span className="max-w-[15rem] text-lg font-bold leading-snug text-[#111827] sm:text-xl md:text-2xl">
						Escanear y crear plantilla
					</span>
					<span className="flex flex-col items-center" aria-hidden>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 120 140"
							className="h-32 w-28 sm:h-36 sm:w-32"
							fill="none"
						>
							<path
								d="M20 8h52l28 28v88a8 8 0 0 1-8 8H20a8 8 0 0 1-8-8V16a8 8 0 0 1 8-8z"
								fill="#F3F4F6"
								stroke="#111827"
								strokeWidth="2.5"
							/>
							<path d="M72 8v28h28" fill="#E5E7EB" stroke="#111827" strokeWidth="2.5" />
							<path
								d="M32 52h56M32 68h56M32 84h40M32 100h48"
								stroke="#374151"
								strokeWidth="3"
								strokeLinecap="round"
							/>
						</svg>
					</span>
				</button>
			</div>

			<ModalCapturaEscaner
				abierto={capturaPdf}
				titulo="Escanear y Crear un Archivo PDF"
				esPlantilla={false}
				onCerrar={() => setCapturaPdf(false)}
				onCrearPdf={onCrearPdfExpediente}
			/>
			<ModalCapturaEscaner
				abierto={capturaPlantilla}
				titulo="Escanear y Crear Plantilla"
				esPlantilla
				onCerrar={() => setCapturaPlantilla(false)}
				onCrearPdf={onCrearPdfPlantilla}
			/>

			{resultadoPdf ? (
				<ModalSubirExpedienteEscaner
					abierto={subirAbierto}
					pdfBlob={resultadoPdf.pdfBlob}
					nombreArchivo={
						resultadoPdf.nombre.toLowerCase().endsWith(".pdf")
							? resultadoPdf.nombre
							: `${resultadoPdf.nombre}.pdf`
					}
					primeraPaginaJpeg={resultadoPdf.primeraPaginaJpeg}
					onCerrar={() => {
						setSubirAbierto(false);
						setResultadoPdf(null);
					}}
					onExito={() => {
						setResultadoPdf(null);
					}}
				/>
			) : null}

			{plantillaPdf ? (
				<ModalDefinirCamposPlantillaEscaner
					abierto={definirAbierto}
					pdfBlob={plantillaPdf.blob}
					nombreTitulo={plantillaPdf.nombre}
					onCerrar={() => {
						setDefinirAbierto(false);
						setPlantillaPdf(null);
					}}
					onExito={() => {
						setPlantillaPdf(null);
					}}
				/>
			) : null}
		</div>
	);
}
