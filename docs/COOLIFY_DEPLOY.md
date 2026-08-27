# Despliegue de Comunidad Conecta en Coolify

La aplicación está preparada para desplegarse con el `Dockerfile` del repositorio. La imagen ejecuta Next.js en modo `standalone`, escucha en el puerto `3000`, se ejecuta con un usuario sin privilegios y ofrece el healthcheck `/api/health`.

## 1. Requisitos

- Un repositorio Git accesible desde Coolify.
- Una base PostgreSQL accesible desde el servidor de Coolify.
- Un dominio con HTTPS.
- Copias de seguridad de PostgreSQL antes de aplicar migraciones en una instalación que ya contenga datos.

La base configurada en `DATABASE_URL` debe permitir, como mínimo, ejecutar las migraciones existentes y hacer `SET LOCAL ROLE comunidad_conecta_app`. En una base nueva, la primera migración crea extensiones, funciones, políticas RLS y el rol `comunidad_conecta_app`, por lo que normalmente requiere una cuenta propietaria o administradora de esa base.

## 2. Crear el recurso en Coolify

1. Crea un recurso de tipo **Application** desde el repositorio Git.
2. Selecciona **Dockerfile** como Build Pack.
3. Usa `/Dockerfile` como ruta del Dockerfile y `/` como directorio base.
4. Configura el puerto interno `3000`.
5. Asigna el dominio público y activa HTTPS.
6. No configures secretos como argumentos de construcción. La imagen se construye sin necesitar acceso a PostgreSQL.

## 3. Variables de entorno

Configura estas variables como secretos de ejecución en Coolify:

| Variable | Obligatoria | Valor recomendado | Uso |
| --- | --- | --- | --- |
| `DATABASE_URL` | Sí | URL PostgreSQL completa | Aplicación y migraciones |
| `DATABASE_SSL` | Sí | `true` si el proveedor exige TLS; en otro caso `false` | Conexión PostgreSQL |
| `SESSION_COOKIE_SECURE` | Sí | `true` en producción | Impide enviar la sesión fuera de HTTPS |
| `RUN_MIGRATIONS` | Sí | `true` | Aplica migraciones antes de iniciar Next.js |
| `PORT` | Sí | `3000` | Puerto interno del contenedor |
| `HOSTNAME` | Sí | `0.0.0.0` | Escucha dentro del contenedor |
| `SEED_ADMIN_EMAIL` | Solo para seed | Correo inicial de administración | Creación o actualización de la cuenta inicial |
| `SEED_ADMIN_PASSWORD` | Solo para seed | Secreto de 12 caracteres o más | Contraseña de administración |
| `SEED_DEMO_PASSWORD` | Solo para seed demo | Secreto de 12 caracteres o más | Contraseña de perfiles demostrativos |

No copies `.env.local` al repositorio ni a la configuración de build. Introduce sus valores directamente en la sección de variables de Coolify y márcalos como secretos.

## 4. Migraciones y arranque

El contenedor utiliza este orden:

1. Si `RUN_MIGRATIONS=true`, ejecuta `node scripts/migrate.mjs`.
2. Las migraciones adquieren un bloqueo advisory de PostgreSQL, por lo que dos contenedores no aplican la misma migración simultáneamente.
3. Si una migración falla, el contenedor termina y no publica una versión parcialmente iniciada.
4. Si finalizan correctamente, arranca el servidor standalone de Next.js.

Para desactivar temporalmente las migraciones automáticas usa `RUN_MIGRATIONS=false`. Solo es recomendable si otro proceso de despliegue ya se responsabiliza de aplicarlas.

## 5. Primera carga de usuarios

El seed no se ejecuta automáticamente en cada despliegue porque actualiza las contraseñas de las cuentas iniciales. Para ejecutarlo una vez:

1. Configura `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` y, si quieres perfiles demo, `SEED_DEMO_PASSWORD`.
2. Despliega la aplicación.
3. Abre la terminal del contenedor en Coolify.
4. Ejecuta:

```text
node scripts/seed.mjs
```

En despliegues posteriores no vuelvas a ejecutar el seed salvo que quieras regenerar esas cuentas o contraseñas. Las migraciones sí pueden permanecer activadas.

## 6. Healthcheck

Configura el healthcheck de Coolify con:

```text
Path: /api/health
Port: 3000
Interval: 30 segundos
Timeout: 8 segundos
Retries: 3
Start period: 30 segundos
```

Una respuesta correcta es:

```json
{
  "ok": true,
  "service": "comunidad-conecta",
  "database": "ok"
}
```

El endpoint consulta PostgreSQL. Devuelve HTTP `503` si la aplicación está viva pero no puede acceder a la base, evitando que Coolify dirija tráfico a una instancia no preparada.

## 7. Persistencia y copias de seguridad

Actualmente no hace falta montar un volumen de archivos: sesiones, auditoría, documentos y versiones se almacenan en PostgreSQL. La persistencia y los backups deben centrarse en la base de datos.

Recomendaciones:

- Activa backups automáticos y prueba restauraciones.
- Conserva un backup previo a cada migración importante.
- No uses el sistema de archivos efímero del contenedor para documentos.
- Si en el futuro se migra el archivo documental a almacenamiento de objetos, configura sus credenciales como secretos y documenta su política de backup por separado.

## 8. Comprobación posterior al despliegue

1. Abre `https://tu-dominio/api/health` y confirma HTTP `200`.
2. Abre `https://tu-dominio/login`.
3. Inicia sesión con Administración.
4. Comprueba cambio de comunidad/perfil, listado de viviendas y descarga de documentos.
5. Revisa los logs de arranque para confirmar qué migraciones se aplicaron.
6. Verifica que la cookie `cc_session` aparece con `Secure`, `HttpOnly` y `SameSite=Strict`.

## 9. Actualizaciones y rollback

- Coolify construirá una nueva imagen en cada despliegue.
- Las migraciones son progresivas y no tienen rollback automático. Restaura un backup si una reversión de esquema fuera necesaria.
- Mantén inicialmente una sola réplica. Si escalas horizontalmente, recuerda que cada réplica abre hasta 10 conexiones PostgreSQL y ajusta el límite de la base en consecuencia.
- Las sesiones están en PostgreSQL, por lo que no requieren afinidad de sesión entre réplicas.

## 10. Problemas habituales

### El contenedor no supera el healthcheck

Revisa `DATABASE_URL`, `DATABASE_SSL`, conectividad de red, reglas de firewall y los logs de `/api/health`.

### La migración falla al crear extensiones o roles

La cuenta PostgreSQL no tiene privilegios suficientes para la primera instalación. Ejecuta las migraciones con una cuenta propietaria de la base o solicita al proveedor que habilite `pgcrypto`, `citext` y el rol requerido.

### El login funciona por HTTP pero no detrás del dominio

Comprueba que el dominio utiliza HTTPS, que `SESSION_COOKIE_SECURE=true` y que Coolify transmite `Host` o `X-Forwarded-Host` correctamente.

### Cambié una contraseña seed y no funciona

Reiniciar el contenedor no modifica el hash almacenado. Ejecuta `node scripts/seed.mjs` desde la terminal de Coolify después de cambiar las variables seed.
