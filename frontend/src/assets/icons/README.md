# Iconos de Cortex

Esta carpeta contiene los iconos SVG de Cortex para usar en el administrador.

## 📁 Ubicación de los archivos

**Coloca tus archivos SVG aquí:**
```
packages/admin-frontend/src/assets/icons/
```

Ejemplos de nombres:
- `logo.svg` - Logo principal de Cortex
- `brain.svg` - Icono de cerebro/IA
- `agent.svg` - Icono de agente
- `channel.svg` - Icono de canal
- `dashboard.svg` - Icono de dashboard
- etc.

## 🚀 Cómo usar los iconos

### Opción 1: Importación directa (RECOMENDADO)

Esta es la forma más simple y directa:

```tsx
// 1. Importa el icono
import LogoIcon from '@/assets/icons/logo.svg?react';
import BrainIcon from '@/assets/icons/brain.svg?react';

// 2. Úsalo como componente React
function MyComponent() {
  return (
    <div>
      <LogoIcon width={24} height={24} className="text-blue-500" />
      <BrainIcon width={32} height={32} />
    </div>
  );
}
```

**Ventajas:**
- ✅ No requiere configuración adicional
- ✅ TypeScript sabe qué iconos existen
- ✅ Mejor rendimiento (tree-shaking)
- ✅ Autocompletado en el IDE

### Opción 2: Componente CortexIcon (Helper)

Si prefieres usar un componente helper:

```tsx
// 1. Primero importa el icono en CortexIcon.tsx
// En src/components/CortexIcon.tsx:
import LogoIcon from '@/assets/icons/logo.svg?react';
import BrainIcon from '@/assets/icons/brain.svg?react';

const iconMap = {
  logo: LogoIcon,
  brain: BrainIcon,
};

// 2. Luego úsalo en tus componentes
import { CortexIcon } from '@/components/CortexIcon';

<CortexIcon name="logo" size={24} className="text-blue-500" />
```

## 📝 Ejemplo práctico: Reemplazar iconos en Layout

Para reemplazar los iconos de `lucide-react` en el Layout:

```tsx
// En src/components/Layout.tsx

// ANTES:
import { Brain } from 'lucide-react';
<Brain size={20} />

// DESPUÉS:
import BrainIcon from '@/assets/icons/brain.svg?react';
<BrainIcon width={20} height={20} />
```

## ⚙️ Configuración

El proyecto ya está configurado con:
- ✅ `vite-plugin-svgr` - Para importar SVGs como componentes React
- ✅ TypeScript types - Para autocompletado
- ✅ Alias `@/` - Para importaciones más cortas

## 📋 Checklist para agregar un nuevo icono

1. [ ] Coloca el archivo SVG en `src/assets/icons/nombre.svg`
2. [ ] Importa el icono donde lo necesites: `import NombreIcon from '@/assets/icons/nombre.svg?react';`
3. [ ] Úsalo como componente: `<NombreIcon width={24} height={24} />`
4. [ ] (Opcional) Si usas `CortexIcon`, agrégalo al `iconMap` en `CortexIcon.tsx`

## 💡 Tips

- Los SVG deben estar optimizados para web (usa herramientas como SVGO)
- Puedes usar todas las clases de Tailwind CSS en los iconos
- Los iconos heredan el color del texto (`currentColor`) por defecto
- Usa `className="text-blue-500"` para cambiar el color

## 🔍 Troubleshooting

**Problema:** El icono no se muestra
- Verifica que el archivo existe en `src/assets/icons/`
- Verifica que estás usando `?react` al final: `logo.svg?react`
- Verifica que el SVG es válido

**Problema:** Error de TypeScript
- Asegúrate de que `vite-plugin-svgr` está instalado
- Verifica que `vite-env.d.ts` existe con los tipos correctos

