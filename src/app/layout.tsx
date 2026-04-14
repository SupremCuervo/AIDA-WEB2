import type { Metadata } from "next";
import "./globals.css";

const logoApp = "/imagenes/Alumno/logo.png";

export const metadata: Metadata = {
	title: "AIDA",
	description: "Sistema de expediente escolar AIDA",
	icons: {
		icon: [{ url: logoApp, type: "image/png" }],
		apple: [{ url: logoApp, type: "image/png" }],
		shortcut: logoApp,
	},
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="es" suppressHydrationWarning>
			<body className="min-h-screen antialiased" suppressHydrationWarning>
				{children}
			</body>
		</html>
	);
}
