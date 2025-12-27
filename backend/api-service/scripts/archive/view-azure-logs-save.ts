#!/usr/bin/env tsx

/**
 * Script para ver logs de Azure relacionados con guardado de conversaciones
 * Busca específicamente logs de:
 * - saveConversationAndMessages
 * - WhatsApp webhooks
 * - Errores de base de datos
 */

import { execSync } from 'child_process';

const RESOURCE_GROUP = process.env.AZURE_RESOURCE_GROUP || 'rg-cortexagenthub-stg-001';
const APP_NAME = process.env.AZURE_APP_NAME || 'app-back-cortexagenthub-stg-001';

console.log('🔍 Buscando logs relacionados con guardado de conversaciones...\n');
console.log(`📋 App Service: ${APP_NAME}`);
console.log(`📋 Resource Group: ${RESOURCE_GROUP}\n`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

try {
  // 1. Logs de saveConversationAndMessages
  console.log('1️⃣ Logs de saveConversationAndMessages:\n');
  try {
    const saveLogs = execSync(
      `az webapp log show --name "${APP_NAME}" --resource-group "${RESOURCE_GROUP}" --lines 500 2>/dev/null | grep -i "saveConversationAndMessages" || echo "No se encontraron logs"`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );
    console.log(saveLogs || 'No se encontraron logs');
  } catch (e: any) {
    console.log('❌ Error al obtener logs:', e.message);
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // 2. Logs de WhatsApp webhooks
  console.log('2️⃣ Logs de WhatsApp webhooks:\n');
  try {
    const whatsappLogs = execSync(
      `az webapp log show --name "${APP_NAME}" --resource-group "${RESOURCE_GROUP}" --lines 500 2>/dev/null | grep -i "whatsapp.*webhook\|webhook.*whatsapp" || echo "No se encontraron logs"`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );
    console.log(whatsappLogs || 'No se encontraron logs');
  } catch (e: any) {
    console.log('❌ Error al obtener logs:', e.message);
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // 3. Logs de errores relacionados con base de datos
  console.log('3️⃣ Errores relacionados con base de datos:\n');
  try {
    const dbErrors = execSync(
      `az webapp log show --name "${APP_NAME}" --resource-group "${RESOURCE_GROUP}" --lines 500 2>/dev/null | grep -iE "database.*error|error.*database|failed.*save|save.*failed|conversation.*error" || echo "No se encontraron errores"`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );
    console.log(dbErrors || 'No se encontraron errores');
  } catch (e: any) {
    console.log('❌ Error al obtener logs:', e.message);
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // 4. Logs de "Database not available"
  console.log('4️⃣ Logs de "Database not available":\n');
  try {
    const dbNotAvailable = execSync(
      `az webapp log show --name "${APP_NAME}" --resource-group "${RESOURCE_GROUP}" --lines 500 2>/dev/null | grep -i "database.*not.*available\|not.*available.*database" || echo "No se encontraron logs"`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );
    console.log(dbNotAvailable || 'No se encontraron logs');
  } catch (e: any) {
    console.log('❌ Error al obtener logs:', e.message);
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // 5. Últimos logs de webhooks en general
  console.log('5️⃣ Últimos logs de webhooks (últimas 20 líneas):\n');
  try {
    const webhookLogs = execSync(
      `az webapp log show --name "${APP_NAME}" --resource-group "${RESOURCE_GROUP}" --lines 200 2>/dev/null | grep -i "webhook" | tail -20 || echo "No se encontraron logs"`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );
    console.log(webhookLogs || 'No se encontraron logs');
  } catch (e: any) {
    console.log('❌ Error al obtener logs:', e.message);
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // 6. Todos los errores recientes
  console.log('6️⃣ Todos los errores recientes (últimas 30 líneas):\n');
  try {
    const allErrors = execSync(
      `az webapp log show --name "${APP_NAME}" --resource-group "${RESOURCE_GROUP}" --lines 500 2>/dev/null | grep -iE "error|ERROR|failed|FAILED" | tail -30 || echo "No se encontraron errores"`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );
    console.log(allErrors || 'No se encontraron errores');
  } catch (e: any) {
    console.log('❌ Error al obtener logs:', e.message);
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('💡 Para ver logs en tiempo real, ejecuta:');
  console.log(`   az webapp log tail --name ${APP_NAME} --resource-group ${RESOURCE_GROUP}\n`);

} catch (error: any) {
  console.error('❌ Error al obtener logs:', error.message);
  console.error('\n💡 Asegúrate de:');
  console.error('   1. Tener Azure CLI instalado y autenticado (az login)');
  console.error('   2. Tener permisos para acceder al App Service');
  console.error('   3. Que el App Service esté activo');
  process.exit(1);
}

