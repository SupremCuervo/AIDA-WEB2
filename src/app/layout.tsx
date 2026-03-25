import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
	title: "AIDA",
	description: "Sistema de expediente escolar AIDA",
	icons: {
		icon: "/imagenes/Alumno/logo.png",
		apple: "/imagenes/Alumno/logo.png",
	},
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="es">
			<body className="min-h-screen antialiased">{children}</body>
		</html>
	);
}
