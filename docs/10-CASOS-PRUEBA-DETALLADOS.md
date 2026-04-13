# 10. Casos de prueba detallados (AIDA Web y ecosistema)

**Versión del paquete de pruebas:** alineado con `aida-web` (Next.js, Vitest).  
**Columnas Resultado real y Observaciones:** rellenar en cada corrida manual o de aceptación.  
**Pruebas automatizadas (Vitest):** complementan lo manual; no sustituyen Login E2E ni RLS en Supabase.

---

## Cómo ejecutar las pruebas automatizadas

En la carpeta `aida-web`:

```bash
npm install
npm run test
```

- `npm run test:watch` deja Vitest en modo observación durante el desarrollo.

Dependencia (versión fija en `package.json`): `vitest@3.0.5`.

---

## Trazabilidad: Vitest ↔ casos ID

| ID (referencia) | Automatizado (Vitest) | Archivo / notas |
|-----------------|----------------------|-----------------|
| L-13 (JWT expirado / inválido) | Parcial | `src/lib/alumno/jwt-cookies.test.ts` — expiración y firma alterada hacen fallar `jwtVerify` |
| CAM-01 / CAM-02 (tipos de archivo aceptados) | Parcial | `src/lib/nombre-archivo.test.ts` — extensiones `pdf`, `png`, `jpg`, `jpeg`, `webp` |
| CAM-03 (tamaño máximo) | No (manual / integración) | La API `subir-documento` usa **15 MB** (`TAMANO_MAX_BYTES`). Ajustar el guion si el doc decía 10 MB. |
| CAM-04 (tipo no permitido) | Parcial | `nombre-archivo.test.ts` — `exe`, `zip` rechazados al armar nombre estándar |
| OCR-01 … OCR-07 | Parcial | `src/lib/ocr/extract-servidor.test.ts`, `config-servidor.test.ts` |
| L-01 … L-12, L-14, L-15, CAM-05 … CAM-15 | Manual o E2E | Requieren navegador, Supabase Auth, Storage, app Flutter, o throttling de red |

---

## 10. Casos de prueba detallados

Esta sección contiene la lista completa de pruebas dividida en tres categorías: **Login / Sesión**, **Cámara / Subida de archivos** y **OCR**. El objetivo es detectar problemas o situaciones imprevistas en cada área antes de la entrega final.

---

### 10.1 Login y sesión (L-01 al L-15)

| ID | Descripción del caso | Precondición | Pasos a seguir | Resultado esperado | Resultado real | Observaciones |
|----|----------------------|--------------|----------------|--------------------|----------------|---------------|
| L-01 | Login orientador con credenciales válidas | App activa, cuenta de orientador existente en Supabase | 1. Abrir panel web 2. Ingresar email y contraseña correctos 3. Presionar Iniciar sesión | Redirige al dashboard del orientador. JWT/cookie guardado en navegador. | Es posible acceder al panel | |
| L-02 | Login orientador con contraseña incorrecta | Cuenta de orientador existente | 1. Ingresar email válido 2. Ingresar contraseña incorrecta 3. Presionar Iniciar sesión | Mensaje de error visible. No redirige. No se guarda sesión. | Credenciales incorrectas es el mensaje que aparece | |
| L-03 | Login orientador con email no registrado | Ninguna cuenta con ese email | 1. Ingresar email inexistente 2. Cualquier contraseña 3. Presionar Iniciar sesión | Mensaje de error: usuario no encontrado. No redirige. | Credenciales incorrectas es el mensaje que aparece | |
| L-04 | Login orientador con campos vacíos | App activa | 1. Dejar email y contraseña en blanco 2. Presionar Iniciar sesión | Validación en formulario: ambos campos obligatorios. No petición al servidor. | Rellena este campos es el valor que aparece | |
| L-05 | Persistencia de sesión al recargar página | Orientador ya inició sesión (L-01 pasado) | 1. Recargar el navegador (F5) 2. Verificar si sigue en el dashboard | El orientador sigue autenticado. No se redirige al login. | Al recargar se manda un mensaje de verificando sección | |
| L-06 | Cierre de sesión (logout) | Orientador con sesión activa | 1. Buscar opción Cerrar sesión 2. Hacer clic | Sesión eliminada. Redirige al login. Cookie/JWT borrado. | Se elimina la sección y si quieres regresar no es posible y manda al login | |
| L-07 | Acceso directo a ruta protegida sin sesión | Sin sesión activa | 1. Escribir directamente URL del dashboard 2. Enter | Redirige automáticamente al login. No muestra datos. | Se redirige al login | |
| L-08 | Flujo alumno: clave de grupo válida | Grupo activo con clave configurada en BD | 1. Abrir app móvil o web alumno 2. Ingresar clave correcta 3. Continuar | Pide número de cuenta. Avanza al siguiente paso. | Verifica si el token es el correcto o existe y por lo cual sigue a la siguiente sección | |
| L-09 | Flujo alumno: clave de grupo incorrecta | App activa | 1. Ingresar clave que no existe 2. Continuar | Error visible: clave inválida. No avanza. | Mensaje de que el token no existe | |
| L-10 | Flujo alumno: grupo con acceso vencido | Grupo con fecha de vencimiento pasada | 1. Ingresar clave del grupo vencido 2. Continuar | Error o mensaje de acceso cerrado. No permite continuar. | Esta clave ya no permite acceso: finalizó la fecha límite configurada para el grupo. | |
| L-11 | Flujo alumno: cuenta correcta dentro del grupo | Clave válida (L-08) | 1. Ingresar número de cuenta registrado 2. Confirmar | Accede al expediente. Lista de documentos. | Entras correctamente al panel del alumno | |
| L-12 | Flujo alumno: cuenta no pertenece al grupo | Clave válida ingresada | 1. Ingresar cuenta que no está en ese grupo 2. Confirmar | Error: cuenta no encontrada en este grupo. No accede. | Tu nombre no coincide con el padrón de este grupo. Debe escribirse tal como registró el orientador. | |
| L-13 | Caducidad del token JWT (expiración) | Sesión antigua o token expirado | 1. Esperar expiración o simular 2. Acción (p. ej. subir doc) | API 401. Mensaje de sesión expirada y redirige al login. | Redirige al login | Cubierto en Vitest: verificación JWT falla con token expirado (`jwt-cookies.test.ts`). |
| L-14 | Login orientador en app móvil Flutter | Build instalado, cuenta activa | 1. Abrir app 2. Rol Orientador 3. Credenciales correctas | Accede al panel en la app. Sesión activa. | Se puede acceder al sistema del orientador correctamente | |
| L-15 | Selección de rol en app móvil (pantalla inicial) | App Flutter instalada | 1. Abrir app 2. Verificar opciones Alumno / Orientador | Ambas opciones claras. Ninguna bloqueada. | Efectivamente se muestran los dos roles | |

---

### 10.2 Cámara / subida de archivos (CAM-01 al CAM-15)

| ID | Descripción del caso | Precondición | Pasos a seguir | Resultado esperado | Resultado real | Observaciones |
|----|----------------------|--------------|----------------|--------------------|----------------|---------------|
| CAM-01 | Subida de documento válido por alumno (PDF) | Alumno con sesión, expediente abierto | 1. Ir a subir documento 2. PDF válido (≤ **15 MB** en API actual) 3. Confirmar | Documento en lista con estado pendiente. Registro en BD. | Se sube correctamente el PDF | Límite técnico: ver `TAMANO_MAX_BYTES` en `subir-documento/route.ts`. |
| CAM-02 | Subida de imagen válida (JPG/PNG/WebP) | Alumno con sesión | 1. Elegir JPG/PNG/WebP 2. Confirmar | Imagen en lista pendiente. | | Mismo `accept` que en panel alumno. |
| CAM-03 | Archivo que excede el límite de tamaño | Alumno con sesión | 1. Subir archivo **> 15 MB** 2. Confirmar | Error: archivo demasiado grande. No se guarda. | | |
| CAM-04 | Tipo de archivo no permitido | Alumno con sesión | 1. Intentar `.exe`, `.zip`, etc. 2. Confirmar | Error o rechazo. No en Storage. | | UI puede filtrar por `accept`; servidor valida extensión al nombrar archivo. |
| CAM-05 | Subida sin seleccionar archivo | Alumno con sesión | 1. Subir sin archivo 2. Confirmar | Validación: debe elegir archivo. | | |
| CAM-06 | Visualización del estado tras subida | Tras CAM-01 | 1. Listado de documentos 2. Ver estado | Estado pendiente visible. | | |
| CAM-07 | Descarga de documento subido | Documento en expediente | 1. Clic en Descargar 2. Verificar archivo | Mismo contenido que se subió. | | |
| CAM-08 | Eliminación de documento por alumno | Documento pendiente | 1. Eliminar 2. Confirmar | Quitado de lista y Storage / coherencia en BD. | | |
| CAM-09 | Orientador sube al expediente | Orientador activo, alumno seleccionado | 1. Expediente 2. Subir desde panel orientador 3. Confirmar | Documento visible; origen orientador si aplica. | | |
| CAM-10 | Orientador sube 5 documentos con adjuntos | Orientador activo | 1. Cinco archivos + adjuntos 2. Confirmar masivo | Los 5 y adjuntos visibles. | | |
| CAM-11 | Validación por orientador | Documento pendiente | 1. Expediente 2. Validar 3. Confirmar | Estado validado; alumno lo ve. | | |
| CAM-12 | Rechazo por orientador | Documento pendiente | 1. Rechazar 2. Motivo 3. Confirmar | Rechazado; motivo visible. | | |
| CAM-13 | Listado en panel orientador | Orientador activo, alumno con documentos | 1. Grupos → alumno → expediente | Listado completo con estados. | | |
| CAM-14 | Red lenta o interrumpida | Alumno activo, DevTools throttling | 1. Red lenta 2. Subir 3. Observar | Indicador de carga; error claro si falla; estado consistente. | | Útil validar respuesta no-JSON (504) y mensajes del cliente. |
| CAM-15 | Acceso al storage sin permiso (RLS) | Sesión alumno A | 1. URL directa de objeto de alumno B 2. Sin token de B | 403 / sin contenido. | | Validar políticas Supabase Storage. |

---

### 10.3 OCR (OCR-01 al OCR-15)

Contrato implementado en `src/lib/ocr/extract-servidor.ts` y uso en `api/alumno/subir-documento`: **primero Storage, luego OCR**; si el OCR falla o no devuelve campos, el archivo puede quedar guardado y el registro con `ocr_error`.

| ID | Descripción del caso | Precondición | Pasos | Resultado esperado | Resultado real | Observaciones |
|----|----------------------|--------------|-------|--------------------|----------------|---------------|
| OCR-01 | Mapeo trámite por tipo de documento | Código desplegado | Revisar o ejecutar Vitest `tramiteOcrDesdeTipoDocumento` | `ine_tutor` → `ine`, `comprobante_domicilio` → `comprobante`, etc. | | `extract-servidor.test.ts` |
| OCR-02 | Sin URL de OCR en producción | `AIDA_OCR_API_BASE_URL` vacío; sin demo | Subir imagen con alumno | `ocr_no_configurado` en resultado; archivo puede persistir según API | | Vitest cubre retorno `ocr_no_configurado`. |
| OCR-03 | Respuesta extract `success: true` con campos | Servicio OCR mock / real | Subir JPG válido | Campos normalizados en BD / respuesta JSON | | Vitest con `fetch` mock. |
| OCR-04 | Respuesta `success: false` | Mock / servicio | Subir archivo | `ok: false`, mensaje en `ocr_error`; **no** implica borrar archivo ya subido | | Alineado con flujo `subir-documento`. |
| OCR-05 | Timeout OCR | Timeout corto o red lenta | Subida grande o servicio lento | Error tipo `timeout_ocr` o MCP abort; documento en Storage si subida previa ok | | `timeoutMsOcrServidor` en `config-servidor.test.ts`. |
| OCR-06 | PDF: pipeline prepare + extract | PDF multipágina | Subir PDF | Prepare luego extract; campos si el servicio responde bien | | Vitest doble `fetch`. |
| OCR-07 | Prepare PDF falla (HTTP error) | PDF inválido o servicio caído | Subir PDF | `ok: false`; archivo en Storage si upload ya hecho | | Manual + logs servidor. |
| OCR-08 | Respuesta no JSON del extract | Proxy incorrecto | Subir | `respuesta_ocr_no_json` | | |
| OCR-09 | Campos vacíos `{}` con `success: true` | Contrato API | — | Campos `{}` persistidos o según normalización | | |
| OCR-10 | Variable `AIDA_OCR_TIMEOUT_MS` inválida | Servidor | — | Debe usar default 90 s | | `config-servidor.test.ts` |
| OCR-11 | Demo Render en dev | Solo desarrollo | Sin `AIDA_OCR_API_BASE_URL` | Puede usar URL demo si `NODE_ENV=development` | | Ver `resolverBaseUrlOcrServidor`. |
| OCR-12 | Alumno ve error OCR en UI | Tras subida con fallo OCR | Panel documentos | Mensaje o sección datos manuales visible | | |
| OCR-13 | Reintento subida misma categoría | Mismo tipo documento | Subir de nuevo | Reemplazo coherente (storage + fila) | | Depende `eliminarArchivosPreviosDelTipo` + upsert. |
| OCR-14 | OCR con imagen muy grande pero bajo límite de MB | Archivo < 15 MB | Subir | Debe completar o fallar OCR sin tumbar upload | | |
| OCR-15 | Registro en BD sin columns OCR antiguas | Migraciones aplicadas | Subida | Sin error de columna; `ocr_campos` / `ocr_error` coherentes | | |

---

## Registro de ejecución (plantilla rápida)

| Fecha | Entorno (dev/staging/prod) | Ejecutor | `npm run test` (sí/no, fallos) | Notas |
|-------|----------------------------|----------|---------------------------------|-------|
| | | | | |

---

*Documento generado para el paquete de aseguramiento de calidad AIDA. Actualizar los límites (MB) y variables de entorno si el despliegue cambia.*
