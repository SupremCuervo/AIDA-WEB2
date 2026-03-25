# Crear el primer orientador

**Rápido:** ejecuta en el SQL Editor `supabase/seed_orientador_ejemplo.sql` (orientador de prueba; revisa el comentario con la contraseña inicial y cámbiala).

---

1. Genera el hash de la contraseña (desde la carpeta `aida-web`):

```bash
node -e "console.log(require('bcryptjs').hashSync('TU_CONTRASEÑA', 10))"
```

2. En el SQL Editor de Supabase, ejecuta (sustituye correo y hash):

```sql
insert into public.orientadores (email, password_hash, nombre)
values (
  'orientador@tu-escuela.edu',
  'PEGA_AQUI_EL_HASH',
  'Nombre del orientador'
);
```

3. Inicia sesión en `/orientador` con ese correo y contraseña.
