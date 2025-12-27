-- =====================================================
-- Script para borrar una conversación específica
-- =====================================================
-- Uso: Reemplaza :conversation_id con el UUID de la conversación
-- 
-- Ejemplo con psql:
--   psql -v conversation_id="'042c1e10-2518-445f-80ef-d2e2bd86ca81'" -f delete-conversation.sql
--
-- O ejecuta directamente reemplazando el valor:

-- Primero, ver qué se va a borrar
SELECT 'Conversación a borrar:' as info;
SELECT id, channel, channel_user_id, started_at, last_activity, status
FROM conversations 
WHERE id = :conversation_id;

SELECT 'Mensajes a borrar:' as info, COUNT(*) as total 
FROM messages 
WHERE conversation_id = :conversation_id;

SELECT 'Tool executions a borrar:' as info, COUNT(*) as total 
FROM tool_executions 
WHERE message_id IN (
  SELECT id FROM messages WHERE conversation_id = :conversation_id
);

-- Borrar en orden (respetando foreign keys)
DELETE FROM tool_executions 
WHERE message_id IN (
  SELECT id FROM messages WHERE conversation_id = :conversation_id
);

DELETE FROM messages 
WHERE conversation_id = :conversation_id;

DELETE FROM conversations 
WHERE id = :conversation_id;

SELECT 'Conversación eliminada exitosamente' as resultado;
