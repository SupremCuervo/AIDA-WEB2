import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	// Evita que un package-lock.json en carpetas superiores (p. ej. C:\Users\<usuario>) se tome como raíz del workspace al trazar archivos.
	outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
