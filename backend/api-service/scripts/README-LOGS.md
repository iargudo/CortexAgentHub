# 📋 Guía de Logs de Azure

## 📍 ¿Dónde están los logs?

Los logs de la aplicación están en **Azure App Service**. Hay varias formas de acceder a ellos:

### 1. **Azure Portal (Interfaz Web)** 🌐

1. Ve a [Azure Portal](https://portal.azure.com)
2. Busca tu **Resource Group**: `rg-cortexagenthub-stg-001`
3. Selecciona tu **App Service**: `app-back-cortexagenthub-stg-001`
4. En el menú lateral, busca **"Log stream"** o **"Logs"**
5. Ahí verás los logs en tiempo real

**Ruta completa:**
```
Azure Portal → Resource Groups → rg-cortexagenthub-stg-001 → 
app-back-cortexagenthub-stg-001 → Log stream (o Monitoring → Log stream)
```

### 2. **Azure CLI (Terminal)** 💻

#### Ver logs en tiempo real:
```bash
az webapp log tail \
  --name app-back-cortexagenthub-stg-001 \
  --resource-group rg-cortexagenthub-stg-001
```

#### Ver últimos 100 logs:
```bash
az webapp log show \
  --name app-back-cortexagenthub-stg-001 \
  --resource-group rg-cortexagenthub-stg-001 \
  --lines 100
```

#### Buscar logs de RAG específicamente:
```bash
az webapp log show \
  --name app-back-cortexagenthub-stg-001 \
  --resource-group rg-cortexagenthub-stg-001 \
  --lines 500 | grep -i "RAG\|rag\|knowledge\|embedding"
```

### 3. **Scripts Automatizados** 🤖

He creado scripts para facilitar el acceso:

#### Ver logs de RAG:
```bash
cd packages/api-service
./scripts/view-azure-logs-rag.sh
```

#### Ver logs interactivo:
```bash
cd packages/api-service
./scripts/view-azure-logs.sh
```

## 🔍 ¿Qué buscar en los logs?

Cuando el RAG se ejecuta, verás mensajes como:

### ✅ Logs de éxito:
```
[INFO] Executing RAG search
  flowId: ef35e53e-f940-4727-a74c-d972dc8c7c44
  queryPreview: "precio plan 1000 Mbps"

[INFO] RAG search completed
  chunksFound: 5
  processingTimeMs: 234

[INFO] RAG context added to system prompt
  originalPromptLength: 7578
  enhancedPromptLength: 9523
```

### ⚠️ Logs de advertencia:
```
[WARN] RAG search returned no chunks
  flowId: ef35e53e-f940-4727-a74c-d972dc8c7c44
  queryText: "precio plan 1000 Mbps"
```

### ❌ Logs de error:
```
[ERROR] RAG search failed, continuing without context
  error: "Connection timeout"
  flowId: ef35e53e-f940-4727-a74c-d972dc8c7c44
```

### 🔍 Logs de debug (si están habilitados):
```
[DEBUG] RAG enhancement skipped
  hasRagService: true
  hasFlow: true
  flowId: ef35e53e-f940-4727-a74c-d972dc8c7c44
```

## 📊 Niveles de Log

- **ERROR**: Errores críticos que impiden el funcionamiento
- **WARN**: Advertencias (ej: RAG no encontró chunks)
- **INFO**: Información importante (ej: RAG ejecutado exitosamente)
- **DEBUG**: Información detallada para debugging

## 🎯 Logs Específicos de RAG

Los logs que agregamos incluyen:

1. **`Executing RAG search`** - Cuando comienza la búsqueda RAG
2. **`RAG search completed`** - Cuando termina (con número de chunks)
3. **`RAG context added to system prompt`** - Cuando se agrega el contexto
4. **`RAG search returned no chunks`** - Cuando no encuentra resultados
5. **`RAG search failed`** - Cuando hay un error

## 🔧 Troubleshooting

### Si no ves logs de RAG:

1. **Verifica que el código esté desplegado:**
   - Los logs mejorados están en `webhooks.controller.ts`
   - Asegúrate de que el código actualizado esté en Azure

2. **Verifica que el RAG se esté ejecutando:**
   - Busca "Executing RAG search" en los logs
   - Si no aparece, el RAG no se está llamando

3. **Verifica errores:**
   - Busca "RAG search failed" o "ERROR"
   - Estos te dirán qué está fallando

### Si ves "RAG enhancement skipped":

Significa que:
- El `ragService` no está inicializado, O
- No hay un `flow.id` en el routing result

### Si ves "RAG search returned no chunks":

Significa que:
- El RAG se ejecutó pero no encontró chunks con suficiente similitud
- El umbral de similitud podría ser muy alto
- No hay embeddings en la KB

## 📝 Ejemplo de Uso

```bash
# 1. Ver logs en tiempo real mientras pruebas
az webapp log tail --name app-back-cortexagenthub-stg-001 --resource-group rg-cortexagenthub-stg-001

# 2. En otra terminal, envía un mensaje de WhatsApp

# 3. Observa los logs para ver:
#    - Si el RAG se ejecuta
#    - Cuántos chunks encuentra
#    - Si hay errores
```

## 🔗 Enlaces Útiles

- [Azure Portal](https://portal.azure.com)
- [Azure CLI Documentation](https://docs.microsoft.com/cli/azure/webapp/log)

