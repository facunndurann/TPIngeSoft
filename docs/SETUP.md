# Guía de setup: Supabase y variables de entorno

Esta guía cubre cómo dejar funcionando el backend (Supabase) y los archivos `.env` de las apps, tanto en **local** (recomendado para desarrollo) como en la **nube** (para deployar o compartir).

---

## 1. Supabase local (desarrollo)

El proyecto usa la CLI de Supabase (ya incluida como dependencia del monorepo: se invoca con `pnpm supabase ...`) para levantar un stack completo en Docker: Postgres, Auth, Realtime, Storage y Studio.

### Requisitos

- Docker Desktop (u otro runtime de Docker) **corriendo**.
- Node >= 22 y pnpm >= 10.

### Pasos

```bash
# 1. Instalar dependencias del monorepo
pnpm install

# 2. Levantar el stack (la primera vez descarga las imágenes, ~5 min)
pnpm supabase start

# 3. Aplicar el schema y los datos demo (migraciones + seed)
pnpm supabase db reset
```

`supabase start` imprime las credenciales del stack local. Las importantes:

| Variable | Valor local |
|----------|-------------|
| `API URL` | `http://127.0.0.1:54321` |
| `anon key` | JWT que empieza con `eyJ...` (fijo para el stack local) |
| `Studio` | `http://127.0.0.1:54323` |

> Si las perdiste de vista: `pnpm supabase status` las vuelve a mostrar.

### Datos demo que crea el seed

- **2 restaurantes**: La Esquina Burger (hamburguesería) y Trattoria Nonna (italiana), cada uno con categorías, productos, ingredientes, modificadores, sucursal y mesas.
- **Usuarios admin** (solo existen en tu máquina):
  - `admin@esquina.demo` / `demo1234`
  - `admin@nonna.demo` / `demo1234`
- **QR tokens de mesas demo**: `demo-burger-mesa-1` a `4` y `demo-nonna-mesa-1` a `3`. La URL de una mesa es `http://localhost:5173/m/<token>`.

Para volver a un estado limpio en cualquier momento: `pnpm supabase db reset` (reaplica migraciones + seed).

---

## 2. Archivos .env

Cada app de Vite lee sus variables desde `apps/<app>/.env` (no se versiona; hay un `.env.example` de referencia en cada app).

### `apps/admin/.env`

```bash
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<anon key que imprime supabase start>
# URL base de la app del comensal: se usa para armar los links de los QR
VITE_CUSTOMER_APP_URL=http://localhost:5173
```

### `apps/customer/.env`

```bash
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<anon key que imprime supabase start>
```

Notas:

- La **anon key es pública por diseño** (viaja al navegador). La seguridad la aplican las políticas RLS de la base; la `service_role key` en cambio **nunca** va en un `.env` de frontend.
- Tras cambiar un `.env` hay que reiniciar el dev server de Vite.
- En este repo los `.env` locales ya vienen creados con los valores del stack local, porque son iguales para todos los entornos locales de Supabase.

---

## 3. Supabase en la nube (deploy / demo compartida)

Para usar un proyecto real de Supabase en lugar del local:

1. Crear un proyecto en [supabase.com](https://supabase.com) (plan free alcanza).
2. Loguear la CLI y vincular el proyecto:

   ```bash
   pnpm supabase login
   pnpm supabase link --project-ref <ref-del-proyecto>   # el ref aparece en la URL del dashboard
   ```

3. Aplicar las migraciones al proyecto remoto:

   ```bash
   pnpm supabase db push
   ```

4. **Habilitar sign-ins anónimos** (los usa la app del comensal al escanear el QR): en el dashboard, `Authentication → Sign In / Up → Allow anonymous sign-ins`. En local esto ya está habilitado vía `supabase/config.toml`.

5. Completar los `.env` de las apps con los valores del dashboard (`Settings → API`):
   - `VITE_SUPABASE_URL`: la URL del proyecto (`https://<ref>.supabase.co`)
   - `VITE_SUPABASE_ANON_KEY`: la anon/publishable key

6. Datos iniciales: el `seed.sql` es solo para local (crea usuarios de prueba directo en `auth.users`). En la nube: registrá una cuenta desde el panel admin y usá el onboarding de "Creá tu restaurante", o cargá datos desde Studio.

---

## 4. Problemas frecuentes

| Síntoma | Causa / solución |
|---------|------------------|
| `supabase start` falla con error de Docker | Docker no está corriendo. Abrí Docker Desktop y reintentá. |
| El panel muestra "Faltan las variables VITE_SUPABASE_URL..." | Falta el `.env` de esa app o el dev server no se reinició después de crearlo. |
| Login demo no funciona | El seed no está aplicado: `pnpm supabase db reset`. |
| Cambié el schema y el frontend no tipa | Regenerar tipos: `pnpm db:types`. |
| Puertos 54321-54324 ocupados | Otro proyecto Supabase local corriendo: `pnpm supabase stop --project-id <otro>` o cambiar puertos en `supabase/config.toml`. |
