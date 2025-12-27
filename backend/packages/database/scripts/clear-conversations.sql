-- ================================================================
-- Script para limpiar todas las conversaciones y datos relacionados
-- ================================================================
-- Este script elimina:
-- 1. Todas las conversaciones (conversations)
-- 2. Todos los mensajes (messages) - se eliminan automáticamente por CASCADE
-- 3. Todas las ejecuciones de herramientas (tool_executions) - se eliminan automáticamente por CASCADE
-- 4. Todo el contexto de sesiones (context_store)
-- 5. Logs del sistema relacionados (system_logs) - se limpia la referencia a conversaciones
-- 6. Eventos de analytics (analytics_events)
--
-- ⚠️ ADVERTENCIA: Este script elimina TODOS los datos de conversaciones.
-- Asegúrate de hacer un backup antes de ejecutar este script.
-- ================================================================

BEGIN;

-- Mostrar conteo antes de eliminar
DO $$
DECLARE
    conv_count INTEGER;
    msg_count INTEGER;
    tool_exec_count INTEGER;
    context_count INTEGER;
    log_count INTEGER;
    analytics_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO conv_count FROM conversations;
    SELECT COUNT(*) INTO msg_count FROM messages;
    SELECT COUNT(*) INTO tool_exec_count FROM tool_executions;
    SELECT COUNT(*) INTO context_count FROM context_store;
    SELECT COUNT(*) INTO log_count FROM system_logs WHERE conversation_id IS NOT NULL;
    SELECT COUNT(*) INTO analytics_count FROM analytics_events;
    
    RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
    RAISE NOTICE '📊 RESUMEN ANTES DE LIMPIAR:';
    RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
    RAISE NOTICE 'Conversaciones: %', conv_count;
    RAISE NOTICE 'Mensajes: %', msg_count;
    RAISE NOTICE 'Ejecuciones de herramientas: %', tool_exec_count;
    RAISE NOTICE 'Contextos de sesión: %', context_count;
    RAISE NOTICE 'Logs con conversación: %', log_count;
    RAISE NOTICE 'Eventos de analytics: %', analytics_count;
    RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
END $$;

-- 1. Eliminar eventos de analytics (no tiene FK, se elimina primero)
DO $$
BEGIN
    TRUNCATE TABLE analytics_events CASCADE;
    RAISE NOTICE '✅ Eventos de analytics eliminados';
END $$;

-- 2. Limpiar referencias de conversaciones en system_logs
DO $$
BEGIN
    UPDATE system_logs SET conversation_id = NULL WHERE conversation_id IS NOT NULL;
    RAISE NOTICE '✅ Referencias de conversaciones en logs limpiadas';
END $$;

-- 3. Eliminar contextos de sesión
DO $$
BEGIN
    TRUNCATE TABLE context_store CASCADE;
    RAISE NOTICE '✅ Contextos de sesión eliminados';
END $$;

-- 4. Eliminar conversaciones (esto eliminará automáticamente mensajes y tool_executions por CASCADE)
DO $$
BEGIN
    TRUNCATE TABLE conversations CASCADE;
    RAISE NOTICE '✅ Conversaciones eliminadas (mensajes y ejecuciones de herramientas también)';
END $$;

-- Verificar que todo se eliminó
DO $$
DECLARE
    conv_count INTEGER;
    msg_count INTEGER;
    tool_exec_count INTEGER;
    context_count INTEGER;
    log_count INTEGER;
    analytics_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO conv_count FROM conversations;
    SELECT COUNT(*) INTO msg_count FROM messages;
    SELECT COUNT(*) INTO tool_exec_count FROM tool_executions;
    SELECT COUNT(*) INTO context_count FROM context_store;
    SELECT COUNT(*) INTO log_count FROM system_logs WHERE conversation_id IS NOT NULL;
    SELECT COUNT(*) INTO analytics_count FROM analytics_events;
    
    RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
    RAISE NOTICE '✅ RESUMEN DESPUÉS DE LIMPIAR:';
    RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
    RAISE NOTICE 'Conversaciones: %', conv_count;
    RAISE NOTICE 'Mensajes: %', msg_count;
    RAISE NOTICE 'Ejecuciones de herramientas: %', tool_exec_count;
    RAISE NOTICE 'Contextos de sesión: %', context_count;
    RAISE NOTICE 'Logs con conversación: %', log_count;
    RAISE NOTICE 'Eventos de analytics: %', analytics_count;
    RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
    
    IF conv_count = 0 AND msg_count = 0 AND tool_exec_count = 0 AND context_count = 0 AND log_count = 0 AND analytics_count = 0 THEN
        RAISE NOTICE '✅ ¡Limpieza completada exitosamente!';
    ELSE
        RAISE WARNING '⚠️ Algunos datos aún permanecen. Revisa manualmente.';
    END IF;
END $$;

COMMIT;

-- ================================================================
-- NOTAS:
-- ================================================================
-- - Las tablas que NO se tocan (se mantienen intactas):
--   * channel_configs (configuraciones de canales)
--   * llm_configs (configuraciones de LLMs)
--   * orchestration_flows (flujos de orquestación)
--   * tool_definitions (definiciones de herramientas)
--   * routing_rules (reglas de routing)
--   * knowledge_bases (bases de conocimiento)
--   * knowledge_base_documents (documentos)
--   * knowledge_base_embeddings (embeddings)
--   * embedding_models (modelos de embedding)
--   * flow_knowledge_bases (asignaciones de KB a flows)
--   * system_logs (se mantienen pero sin referencia a conversaciones)
-- ================================================================

