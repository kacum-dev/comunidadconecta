# Actualizaciones desde el repositorio oficial

El repositorio oficial de Comunidad Conecta es:

`https://github.com/kacum-dev/comunidadconecta`

El objetivo es que el código oficial pueda distribuirse públicamente y que cada instalación conserve una ruta clara para recibir mejoras sin perder sus datos ni sobrescribir personalizaciones.

## 1. Copia estándar sin cambios propios

Si has clonado Comunidad Conecta y no mantienes cambios de código propios, puedes actualizar desde la raíz del proyecto con:

```bash
npm run update:official
```

El comando:

1. comprueba que no existan cambios locales sin guardar;
2. configura el remoto `upstream` con el repositorio oficial si hace falta;
3. descarga `main` y las etiquetas oficiales;
4. comprueba si tu copia está atrasada;
5. aplica únicamente un `fast-forward` seguro.

No fuerza ramas, no reescribe historial y no hace `push`.

Después de actualizar se recomienda ejecutar:

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

Las migraciones de base de datos siguen siendo progresivas. En producción, con `RUN_MIGRATIONS=true`, se aplican al arrancar la nueva versión.

## 2. Fork o instalación personalizada

Una versión personalizada debe conservar dos orígenes conceptuales:

- `origin`: repositorio propio del cliente o integrador;
- `upstream`: `https://github.com/kacum-dev/comunidadconecta.git`.

El mismo comando detecta si la rama tiene cambios propios:

```bash
npm run update:official
```

Si la copia ha divergido, el comando se detiene sin modificar archivos. Para preparar una integración revisable:

```bash
npm run update:official -- --prepare
```

Esto crea una rama `update/comunidad-conecta-...` y prepara el merge del `upstream/main` sin hacer commit ni push automáticamente. Si hay conflictos, quedan visibles en esa rama para resolverlos de forma explícita.

La secuencia recomendada es:

```text
upstream/main
    ↓
rama update/...
    ↓
resolver conflictos si existen
    ↓
typecheck + tests + lint + build
    ↓
Pull Request al repositorio personalizado
    ↓
despliegue
```

## 3. Instalaciones gestionadas por KACUM

Las instalaciones estándar gestionadas por KACUM no deberían depender de hacer `git pull` directamente en producción. KACUM publica una release, la valida y despliega el artefacto correspondiente. Así varias instalaciones pueden avanzar de versión de forma reproducible.

Para una edición personalizada, KACUM conserva el repositorio oficial como `upstream`, pero la sincronización requiere revisión. Una actualización oficial nunca debe sobrescribir automáticamente cambios propios de un cliente.

## 4. Qué no se actualiza desde Git

El código y las migraciones forman parte de la aplicación, pero los datos de cada comunidad viven en su propia PostgreSQL. Actualizar el repositorio no sustituye ni borra la base de datos.

Antes de una actualización de producción deben existir copias de seguridad verificadas y un procedimiento de rollback acorde con el entorno utilizado.
