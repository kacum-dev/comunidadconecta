# Control de producto y licencias con Kacum

Comunidad Conecta funciona en el servidor de cada comunidad. **Kacum** actúa únicamente como origen oficial del producto y, cuando se configura voluntariamente, como servicio de registro de instalaciones y autoridad de licencias para usos comerciales.

La comunidad conserva su base de datos, sus documentos, su historial y el control de su despliegue. El funcionamiento ordinario de Comunidad Conecta no depende de que los servicios de Kacum estén disponibles.

## Principios

- Todas las funciones de Comunidad Conecta están disponibles para el uso directo de comunidades y entidades sin ánimo de lucro conforme al modelo de uso del proyecto.
- No existen módulos premium desbloqueados de forma remota.
- La explotación comercial por terceros requiere una autorización o licencia emitida por Kacum.
- La clave comercial completa solo se utiliza durante la activación y no se conserva localmente.
- El certificado Ed25519 se verifica localmente y puede seguir validándose aunque el servicio de Kacum no esté disponible.
- La telemetría está desactivada por defecto y puede permanecer completamente deshabilitada.
- Los datos de la comunidad no se transfieren a Kacum por el mero hecho de instalar o actualizar la aplicación.

## Variables

```dotenv
KACUM_CONTROL_PLANE_URL=https://lab.kacum.com
COMMUNITY_CONNECTA_PRODUCT_CODE=comunidad-conecta
APP_VERSION=1.0.0
```

`KACUM_CONTROL_PLANE_URL` es opcional. Solo es necesaria para registrar voluntariamente una instalación, sincronizar telemetría agregada o activar una licencia comercial.

## Datos que pueden enviarse

Cuando la telemetría está habilitada, únicamente se prepara información técnica y agregada como:

- UUID aleatorio de la instalación.
- Versión y tipo de despliegue.
- Finalidad declarada: comunitaria, no lucrativa, demostración, desarrollo o comercial.
- Rangos agregados de viviendas y usuarios activos.
- Indicadores booleanos sobre áreas funcionales utilizadas.
- Estado técnico básico de la base de datos.

No se envían nombres de comunidades, dominios, direcciones IP desde la aplicación, nombres de propietarios, direcciones postales, correos, documentos, incidencias, movimientos, saldos, IBAN, votos ni texto libre.

## Activación comercial

1. Kacum emite una licencia comercial para `comunidad-conecta`.
2. La persona responsable de la instalación recibe una clave de activación.
3. En Comunidad Conecta se abre **Configuración → Licencia y privacidad**.
4. Se introduce la clave y la aplicación solicita el certificado firmado.
5. La clave deja de ser necesaria: la instalación conserva únicamente el certificado y la clave pública necesarias para verificarlo localmente.

La licencia comercial no implica por sí misma hosting, soporte, mantenimiento ni acceso de Kacum a los datos de la comunidad. Esos servicios, cuando existan, se acuerdan por separado.

## Independencia de la instalación

El control de producto no debe convertirse en un punto de dependencia para el funcionamiento diario. Si `KACUM_CONTROL_PLANE_URL` no está configurada, Comunidad Conecta continúa funcionando con normalidad salvo las operaciones que requieren expresamente comunicación con Kacum, como una nueva activación comercial o una sincronización voluntaria.
