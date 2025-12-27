import React from 'react';

/**
 * Componente para usar iconos SVG de Cortex
 * 
 * INSTRUCCIONES:
 * 1. Coloca tus archivos SVG en: src/assets/icons/{nombre}.svg
 * 2. Importa el icono directamente donde lo necesites:
 *    import LogoIcon from '@/assets/icons/logo.svg?react';
 * 3. Úsalo como componente:
 *    <LogoIcon width={24} height={24} className="text-blue-500" />
 * 
 * O usa este componente helper (requiere importar los iconos aquí):
 * <CortexIcon name="logo" size={24} />
 */

interface CortexIconProps {
  name: string;
  size?: number | string;
  className?: string;
}

// Importa tus iconos aquí cuando los agregues
// Ejemplo:
// import LogoIcon from '@/assets/icons/logo.svg?react';
// import BrainIcon from '@/assets/icons/brain.svg?react';

// Mapa de iconos - agrega tus iconos aquí
const iconMap: Record<string, React.FC<React.SVGProps<SVGSVGElement>>> = {
  // Ejemplo:
  // logo: LogoIcon,
  // brain: BrainIcon,
};

export function CortexIcon({ name, size = 24, className = '', ...props }: CortexIconProps) {
  const IconComponent = iconMap[name];

  if (!IconComponent) {
    console.warn(
      `Icono Cortex "${name}" no encontrado.\n` +
      `1. Coloca el archivo SVG en: src/assets/icons/${name}.svg\n` +
      `2. Importa el icono en CortexIcon.tsx: import ${name.charAt(0).toUpperCase() + name.slice(1)}Icon from '@/assets/icons/${name}.svg?react';\n` +
      `3. Agrégalo al iconMap: ${name}: ${name.charAt(0).toUpperCase() + name.slice(1)}Icon,`
    );
    
    // Fallback: mostrar un placeholder
    return (
      <span 
        className={`inline-flex items-center justify-center ${className}`} 
        style={{ width: size, height: size }}
        title={`Icono ${name} no encontrado`}
      >
        <svg 
          width={size} 
          height={size} 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor" 
          strokeWidth="2"
          className="text-gray-400"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M9 9h6v6H9z" />
        </svg>
      </span>
    );
  }

  return (
    <IconComponent 
      width={size} 
      height={size} 
      className={className}
      {...props}
    />
  );
}

