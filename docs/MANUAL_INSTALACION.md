# Manual de instalación — AIDA Web

Instalación de **aida-web** (Next.js 15) para desarrollo local y notas para producción. No incluye secretos: configúralos solo en `.env.local` o en el panel de tu proveedor (Vercel, etc.).

---

## 1. Requisitos previos

| Componente | Versión / nota |
|--------------|----------------|
| Node.js | 20 LTS o superior |
| npm | Incluido con Node (u otro gestor compatible) |
| Cuenta Supabase | Proyecto vacío o dedicado a AIDA |
| Git | Para clonar el repositorio |

---

## 2. Obtener el código e instalar dependencias

```bash
cd aida-web
npm install
```

El proyecto fija versiones en `package.json`; no hace falta usar rangos globales en instalación.

---

## 3. Variables de entorno

1. Copia el ejemplo a un archivo local **no versionado**:

	```bash
	copy .env.example .env.local
	```

	En macOS o Linux: `cp .env.example .env.local`.

2. Edita `.env.local` y completa al menos lo siguiente para un entorno funcional.

| Variable | Obligatoriedad | Descripción breve |
|----------|----------------|-------------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Sí | URL del proyecto (Settings → API). |
| `SUPABASE_SERVICE_ROLE_KEY` | Sí | Clave **service_role** (solo servidor). No la expongas al cliente ni a repositorios. |
| `AIDA_JWT_SECRET` | Sí | Cadena aleatoria de **≥ 32 caracteres** para firmar cookies JWT. Debe ser estable entre reinicios; en despliegues con Edge Functions, alinear con los secretos del proyecto según `.env.example`. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Opcional en web | Aparece en `.env.example` para alineación con la app móvil; si solo usas esta web vía API con service role, puede quedar vacía salvo que el código la use. |
| `AIDA_DOCUMENTOS_BUCKET` | Sí para subidas | Nombre del bucket de Storage (crear en Supabase con el mismo nombre). |
| `AIDA_OCR_API_BASE_URL` | Producción: sí | Base URL del servicio OCR (ver comentarios en `.env.example`). En `next dev` puede usarse el comportamiento por defecto según código. |
| `AIDA_OCR_USE_RENDER_DEMO` | Opcional | Solo si fuerzas la demo en producción (no recomendado con datos sensibles). |
| `AIDA_OCR_TIMEOUT_MS` | Opcional | Tiempo máximo de llamada al OCR (por defecto en código si no es válido). |
| `AIDA_FECHA_LIMITE_ZONA` | Opcional | Zona IANA para fechas límite de grupo (por defecto `America/Mexico_City`). |
| `CRON_SECRET` | Solo si usas cron | Valor secreto para `Authorization: Bearer` en `GET /api/cron/promocion-semestre`. |
| `CRON_TZ` | Opcional | Zona para la lógica de promoción de semestre (ver código). |

**Seguridad:** nunca subas `.env.local` a Git. Confirma que `.gitignore` incluye `.env*.local`.

---

## 4. Base de datos (Supabase)

### 4.1 Crear el proyecto

1. En [Supabase](https://supabase.com), crea un proyecto.
2. Anota **Project URL** y las claves en **Settings → API**.

### 4.2 Ejecutar el esquema SQL

Tienes dos enfoques; elige uno según cómo mantenga tu equipo la base.

**Opción recomendada (esquema amplio en un solo archivo):** en el **SQL Editor** de Supabase, ejecuta el contenido completo de:

`supabase/aida_base_completa.sql`

Incluye tablas core, catálogo de secciones, periodos, auditoría, plantillas, RLS y notas al final sobre extensiones opcionales (`cargas_alumnos_extension.sql`, seeds).

**Opción mínima (documentación histórica del README):** ejecutar `supabase/schema.sql` y, si aplica, scripts adicionales que tu entorno requiera (`supabase/auditoria_logs.sql`, cargas, periodos, etc.). Si dudas, prefiere `aida_base_completa.sql` o consulta con quien mantenga el repositorio.

### 4.3 Migraciones incrementales

Los archivos `supabase/migracion_*.sql` sirven para **actualizar** bases ya existentes. No los ejecutes todos a ciegas en un proyecto nuevo: úsalos solo si vienes de una versión anterior y necesitas ese cambio concreto.

### 4.4 Storage

1. **Storage → New bucket** con el mismo nombre que `AIDA_DOCUMENTOS_BUCKET` (por ejemplo `documentos-alumnos`).
2. La aplicación accede con **service role** desde el servidor; no es obligatorio dejar el bucket público.

### 4.5 Primer usuario orientador

La tabla `public.orientadores` guarda `email`, `password_hash` (bcrypt), `nombre`, `estado_acceso`, `rol_panel`.

Genera un hash bcrypt (ejemplo desde la carpeta `aida-web` con Node):

```bash
node -e "console.log(require('bcryptjs').hashSync('TU_CONTRASENA', 10))"
```

Inserta en el SQL Editor (sustituye correo, hash y nombre):

```sql
insert into public.orientadores (email, password_hash, nombre, rol_panel)
values (
	'usuario@cecyteh.edu.mx',
	'$2a$10$...',
	'Nombre visible',
	'jefe'
);
```

El login web valida el dominio de correo según la regla actual en `src/app/api/orientador/acceso/route.ts` (`@cecyteh.edu.mx` y reglas del local). Ajusta datos de prueba a esas reglas o adapta el entorno de desarrollo si tu institución usa otro dominio.

### 4.6 Datos de prueba (alumno)

Ejemplo mínimo (tras tener un `grupo_tokens` y padrón); ver también `README.md`:

```sql
insert into public.grupo_tokens (clave_acceso, grupo, grado)
values ('DEMO-CLAVE-001', 'F', '3');

insert into public.padron_alumnos (grupo_token_id, nombre_completo)
select id, 'Nombre Completo Demo' from public.grupo_tokens where clave_acceso = 'DEMO-CLAVE-001';
```

Puedes usar `supabase/aida_seed_orientador_y_carga_demo.sql` si tu equipo lo mantiene actualizado.

---

## 5. Recursos estáticos

Las imágenes de la interfaz deben existir bajo `public/imagenes/` (por ejemplo `public/imagenes/Inicio/`). Si faltan, copia los assets que indique tu equipo (en el README se menciona origen tipo `../Fotos`).

---

## 6. Ejecutar en desarrollo

```bash
npm run dev
```

Abre `http://localhost:3000`. Comprueba `/orientador` y `/alumno` según los usuarios que hayas creado.

**Pruebas automatizadas:**

```bash
npm test
```

---

## 7. Compilación local (como en producción)

```bash
npm run build
npm run start
```

Revisa que no fallen pasos de build por variables faltantes (en build a veces se evalúan imports que asumen entorno).

---

## 8. Despliegue (resumen)

1. Conecta el repositorio o sube `aida-web` a tu proveedor (Vercel es el caso documentado en `README.md`).
2. Define **las mismas variables** que en `.env.local` en el panel de entorno del proveedor (sin comitear valores).
3. Si programas el cron de promoción de semestre, configura `CRON_SECRET` y llama a `GET /api/cron/promocion-semestre` con `Authorization: Bearer <CRON_SECRET>` desde Vercel Cron, Supabase `pg_cron`, etc.

---

## 9. Comprobación rápida post-instalación

| Paso | Acción |
|------|--------|
| 1 | `GET /` muestra la landing con dos roles. |
| 2 | `POST /api/orientador/acceso` con el orientador creado devuelve `ok` y cookie. |
| 3 | `GET /api/orientador/sesion` con esa cookie devuelve `autenticado: true`. |
| 4 | Flujo alumno: clave válida → acceso → panel (según datos en `grupo_tokens` / `padron_alumnos`). |

Documentación de uso y API: [USO_AIDA_Y_API.md](./USO_AIDA_Y_API.md).

---

## 10. Problemas frecuentes

| Síntoma | Causa probable |
|---------|----------------|
| "Subida de documentos no configurada" | Falta `AIDA_DOCUMENTOS_BUCKET` o el bucket no existe en Supabase. |
| 401 en todas las APIs orientador | Cookie no enviada (`credentials: "include"`) o sesión caducada; falta `AIDA_JWT_SECRET` o cambió entre despliegues. |
| Error al conectar Supabase | `NEXT_PUBLIC_SUPABASE_URL` o `SUPABASE_SERVICE_ROLE_KEY` incorrectos o proyecto pausado. |
| OCR no funciona en producción | Sin `AIDA_OCR_API_BASE_URL` (en desarrollo puede haber fallback; revisa `.env.example`). |
