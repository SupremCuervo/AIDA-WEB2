# AIDA — Web (Next.js)

Landing con selector **Alumno / Orientador**, flujo **alumno** (clave → nombre/contraseña unificado), tablas en **Supabase sin Auth** (cuentas en SQL + sesión JWT en cookies), API de **nombre de archivo**, imágenes en `public/imagenes`.

**Manual de instalación:** [docs/MANUAL_INSTALACION.md](docs/MANUAL_INSTALACION.md).

**Uso de la aplicación y de la API (incluye dónde colocar capturas de pantalla):** [docs/USO_AIDA_Y_API.md](docs/USO_AIDA_Y_API.md).

## Requisitos

- Node.js 20 LTS o superior
- npm (u otro gestor compatible)

## Instalación y desarrollo

En la carpeta `aida-web`:

```bash
npm install
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000).

Copia `.env.example` a `.env.local` y rellena `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y `AIDA_JWT_SECRET` (cadena aleatoria de al menos 32 caracteres).

### Supabase (SQL)

Ejecuta `supabase/schema.sql` en el **SQL Editor** de tu proyecto. Tablas:

- **`grupo_tokens`**: `clave_acceso`, `grupo`, `grado` (una fila por grupo / clave que entrega el orientador).
- **`padron_alumnos`**: alumnos permitidos; `grupo_token_id` enlaza con la clave; `nombre_completo`.
- **`cuentas_alumno`**: `padron_id` único + `password_hash` (bcrypt). **No** usa `auth.users`.

**RLS** activado sin políticas públicas: solo la API Next (service role) accede. No expongas `SUPABASE_SERVICE_ROLE_KEY` al cliente.

Datos de prueba (ejemplo):

```sql
insert into public.grupo_tokens (clave_acceso, grupo, grado)
values ('DEMO-CLAVE-001', 'F', '3');

-- usa el id devuelto o selección:
insert into public.padron_alumnos (grupo_token_id, nombre_completo)
select id, 'Fernando De La Torre Cruz' from public.grupo_tokens where clave_acceso = 'DEMO-CLAVE-001';
```

Flujo: [http://localhost:3000/alumno](http://localhost:3000/alumno) → modal clave → modal nombre/contraseña → [panel](/alumno/panel). Si la contraseña es incorrecta en cuenta existente, aparece el mensaje de acudir con USB.

Las imágenes de diseño viven en `public/imagenes` (copiadas desde `../Fotos`).

## API: nombre estándar de archivo

**Ruta:** `POST /api/archivos/nombre-estandar`

**Cuerpo JSON:**

| Campo | Obligatorio | Descripción |
|--------|-------------|-------------|
| `nombreAlumno` | Sí | Nombre completo tal como en padrón (ej. `Raúl Peña García`) |
| `tipoDocumento` | Sí | Una de: `acta_nacimiento`, `curp`, `ine_tutor`, `comprobante_domicilio`, `certificado_medico` |
| `extension` | No | Por defecto `pdf`. Permitidas: `pdf`, `png`, `jpg`, `jpeg`, `webp` |

**Respuesta 200 (ejemplo):**

```json
{
	"nombreTecnico": "raul_pena_garcia_acta_nacimiento.pdf",
	"slugAlumno": "raul_pena_garcia",
	"slugTipo": "acta_nacimiento",
	"extension": "pdf"
}
```

**Uso desde el cliente (después de subir a Storage):** llama a esta API antes de guardar el objeto en Supabase Storage para obtener el nombre final del objeto; o reutiliza la función `nombreArchivoEstandar` en `src/lib/nombre-archivo.ts` en código servidor.

## Dónde desplegar (recomendado: Vercel)

Next.js incluye las **Route Handlers** (`app/api/...`) como funciones serverless en Vercel. Es el camino más directo y está muy documentado.

Documentación oficial:

- [Desplegar aplicaciones Next.js (Next.js)](https://nextjs.org/docs/app/building-your-application/deploying)
- [Next.js en Vercel](https://vercel.com/docs/frameworks/nextjs)
- [Introducción a Vercel](https://vercel.com/docs)

Pasos resumidos:

1. Cuenta en [vercel.com](https://vercel.com) y conectar el repositorio Git, **o** usar la [CLI de Vercel](https://vercel.com/docs/cli) desde la carpeta `aida-web`.
2. Framework preset: **Next.js** (detección automática).
3. Variables de entorno (cuando integres Supabase): configurarlas en el panel del proyecto en Vercel, no en el código.

Alternativas si no usas Vercel: **Netlify** (adaptador Next), **Railway**, **AWS Amplify**, o un **VPS** con `npm run build` + `npm start` (Node). En VPS debes gestionar tú proceso, dominio y HTTPS.

## Estructura relevante

```
src/
	app/
		api/alumno/                             # validar-clave, paso-clave, acceso, sesion, salir
		api/archivos/nombre-estandar/route.ts
		alumno/FlujoAlumno.tsx                  # modales clave + cuenta
		alumno/panel/page.tsx                   # panel tras sesión
		orientador/page.tsx
		page.tsx                                # landing AIDA
	lib/alumno/                               # JWT cookies, normalización nombre
	lib/supabase/admin.ts                     # cliente service_role (servidor)
	lib/nombre-archivo.ts
supabase/schema.sql
public/imagenes/Inicio/
public/imagenes/Alumno/logo.png
```

## Próximos pasos sugeridos

- Variables `.env.local` para Supabase (no versionar credenciales).
- Autenticación y RLS en Supabase según el diseño AIDA.
