# Diseño del Sidebar - CortexAgentHub

## Descripción General

El sidebar es un componente de navegación lateral colapsable que proporciona acceso a todas las secciones principales de la aplicación de administración. Está diseñado con un esquema de colores oscuro (dark theme) y se integra con un header superior que contiene información del usuario.

## Estructura del Componente

### Layout Principal

El sidebar forma parte de un layout de dos columnas:
- **Columna izquierda**: Sidebar (ancho variable según estado)
- **Columna derecha**: Contenido principal con header y área de contenido

```
┌─────────────┬─────────────────────────────┐
│             │  Header (usuario, título)   │
│  Sidebar    ├─────────────────────────────┤
│  (64/256px) │                             │
│             │  Contenido Principal        │
│             │  (Outlet de React Router)   │
│             │                             │
└─────────────┴─────────────────────────────┘
```

## Estados del Sidebar

### Estado Expandido
- **Ancho**: `256px` (clase Tailwind: `w-64`)
- **Padding horizontal**: `24px` (clase: `px-6`)
- **Muestra**: Logo completo, texto de navegación, información de versión

### Estado Colapsado
- **Ancho**: `80px` (clase Tailwind: `w-20`)
- **Padding horizontal**: `16px` (clase: `px-4`)
- **Muestra**: Solo iconos, tooltips al hover

### Transición
- **Duración**: `300ms` (clase: `transition-all duration-300`)
- **Aplicado a**: Ancho, padding, visibilidad de texto

## Componentes del Sidebar

### 1. Botón de Toggle (Colapsar/Expandir)

**Posición**: Absoluta, flotando sobre el borde derecho del sidebar
- **Posición**: `absolute -right-3 top-6`
- **Estilo**:
  - Fondo: `bg-gray-800`
  - Hover: `bg-gray-700`
  - Color de texto: `text-white`
  - Padding: `p-1.5`
  - Border radius: `rounded-full`
  - Border: `border-2 border-gray-900`
  - Sombra: `shadow-lg`
  - Z-index: `z-10`

**Iconos**:
- Expandido: `ChevronLeft` (16px)
- Colapsado: `ChevronRight` (16px)

### 2. Header del Sidebar (Logo y Título)

**Contenedor**:
- Padding: `p-6` (expandido) o `px-4` (colapsado)
- Flexbox: `flex flex-col items-center text-center`
- Margin bottom: `mb-2`

**Logo**:
- Imagen: `logo.png` desde `@/assets/icons/logo.png`
- Tamaño expandido: `w-12 h-12` (48px)
- Tamaño colapsado: `w-10 h-10` (40px)
- Object fit: `object-contain`
- Margin bottom: `mb-3`
- Transición: `transition-all`

**Título** (solo visible cuando expandido):
- Texto: "CortexAgentHub"
- Estilo: `text-2xl font-bold`
- Subtítulo: "Admin Panel"
- Estilo subtítulo: `text-sm text-gray-400 mt-1`

### 3. Navegación Principal

**Contenedor**:
- Margin top: `mt-6`
- Lista de elementos de navegación ordenados por categorías

**Estructura de Navegación**:

```typescript
const navigation = [
  // 1. Vista General
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  
  // 2. Recursos Base (LLMs y Embeddings)
  { name: 'LLMs', href: '/llms', icon: Brain },
  { name: 'Embedding Models', href: '/embedding-models', icon: Database },
  
  // 3. Conocimiento
  { name: 'Knowledge Bases', href: '/knowledge-bases', icon: Book },
  
  // 4. Herramientas
  { name: 'Tools', href: '/tools', icon: Wrench },
  
  // 5. Canales de Comunicación
  { name: 'Channels', href: '/channels', icon: MessageSquare },
  { name: 'Widgets', href: '/widgets', icon: Code },
  
  // 6. Orquestación (Agentes)
  { name: 'Agents', href: '/agents', icon: Bot },
  
  // 7. Testing y Monitoreo
  { name: 'Playground', href: '/playground', icon: Activity },
  { name: 'Conversations', href: '/conversations', icon: MessageCircle },
  { name: 'Logs', href: '/logs', icon: FileText },
  { name: 'Queues', href: '/queues', icon: Layers },
  
  // 8. Administración
  { name: 'Usuarios Admin', href: '/admin-users', icon: Users },
];
```

**Elementos de Navegación**:

**Estado Normal**:
- Display: `flex items-center gap-3`
- Padding vertical: `py-3`
- Padding horizontal: `px-6` (expandido) o `px-4 justify-center` (colapsado)
- Tamaño de texto: `text-sm font-medium`
- Color: `text-gray-300`
- Hover: `hover:bg-gray-800 hover:text-white`
- Transición: `transition-colors`

**Estado Activo**:
- Fondo: `bg-gray-800`
- Color de texto: `text-white`
- Border izquierdo:
  - Expandido: `border-l-4 border-primary-500`
  - Colapsado: `border-l-2 border-primary-500`

**Iconos**:
- Tamaño: `20px`
- Siempre visibles en ambos estados

**Texto**:
- Visible solo cuando expandido
- Oculto cuando colapsado

**Tooltip** (solo cuando colapsado):
- Posición: `absolute left-full ml-2`
- Estilo: `px-2 py-1 bg-gray-800 text-white text-sm rounded`
- Visibilidad: `opacity-0 group-hover:opacity-100`
- Transición: `transition-opacity`
- Z-index: `z-50`
- No interactivo: `pointer-events-none`
- Sin wrap: `whitespace-nowrap`

### 4. Footer del Sidebar

**Posición**: Absoluta en la parte inferior
- Posición: `absolute bottom-0`
- Ancho: Dinámico según estado (`w-20` o `w-64`)
- Padding: `p-6`
- Border superior: `border-t border-gray-800`
- Transición: `transition-all`

**Contenido** (solo visible cuando expandido):
- Versión: "Version 1.0.0"
- Copyright: "© 2025 CortexAgentHub"
- Estilo: `text-xs text-gray-500`
- Espaciado: `mt-1` entre líneas

## Esquema de Colores

### Sidebar
- **Fondo principal**: `bg-gray-900` (#111827)
- **Fondo hover/activo**: `bg-gray-800` (#1f2937)
- **Texto normal**: `text-gray-300` (#d1d5db)
- **Texto activo**: `text-white` (#ffffff)
- **Borde activo**: `border-primary-500` (#0ea5e9 - azul)
- **Bordes divisores**: `border-gray-800` (#1f2937)

### Botón Toggle
- **Fondo**: `bg-gray-800`
- **Hover**: `bg-gray-700`
- **Borde**: `border-gray-900`

### Tooltips
- **Fondo**: `bg-gray-800`
- **Texto**: `text-white`

## Comportamiento Interactivo

### Toggle del Sidebar
- Click en el botón toggle cambia el estado `isCollapsed`
- Estado persistido en componente (no en localStorage)
- Transición suave de 300ms

### Navegación
- Cada elemento es un `Link` de React Router
- Estado activo determinado por `location.pathname === item.href`
- Navegación sin recarga de página

### Tooltips
- Aparecen al hacer hover sobre elementos cuando el sidebar está colapsado
- Posicionados a la derecha del elemento
- Animación de fade-in/fade-out

## Header Principal (Complemento del Sidebar)

### Estructura
- Fondo: Gradiente `bg-gradient-to-r from-slate-100 via-gray-50 to-slate-100`
- Border inferior: `border-b border-gray-200`
- Sombra: `shadow-sm`
- Padding: `px-8 py-4`

### Contenido Izquierdo
- Título de la página actual
- Estilo: `text-2xl font-semibold text-gray-900`
- Se obtiene del array `navigation` basado en `location.pathname`

### Contenido Derecho - Menú de Usuario

**Botón de Usuario**:
- Display: `flex items-center gap-3`
- Hover: `hover:bg-gray-50 rounded-lg px-2 py-1.5`
- Contiene:
  - Información de texto (nombre completo o username)
  - Avatar circular con inicial

**Información de Usuario**:
- Nombre: `text-sm font-medium text-gray-900`
- Rol: `text-xs text-gray-500` ("Administrador")

**Avatar**:
- Tamaño: `w-10 h-10` (40px)
- Estilo: `rounded-full bg-primary-600 text-white`
- Contenido: Primera letra del username o nombre en mayúscula
- Hover: `hover:bg-primary-700`

**Dropdown Menu**:
- Posición: `absolute right-0 mt-2`
- Ancho: `w-56`
- Estilo: `bg-white rounded-md shadow-lg ring-1 ring-black ring-opacity-5`
- Z-index: `z-50`
- Visibilidad controlada por estado `showUserMenu`

**Opciones del Menú**:
1. **Cambiar Contraseña**:
   - Icono: `Lock` (18px, `text-gray-400`)
   - Estilo: `text-sm text-gray-700 hover:bg-gray-100`
   - Acción: Navega a `/change-password`

2. **Cerrar Sesión**:
   - Icono: `LogOut` (18px, `text-gray-400`)
   - Estilo: `text-sm text-gray-700 hover:bg-red-50 hover:text-red-600`
   - Acción: Ejecuta `api.logout()` y redirige a `/login`

**Cierre del Menú**:
- Click fuera del contenedor (usando `user-menu-container` class)
- Click en cualquier opción del menú

## Responsive Design

### Desktop
- Sidebar siempre visible
- Ancho fijo según estado (expandido/colapsado)
- Header con información completa del usuario

### Consideraciones Mobile
- El diseño actual no incluye breakpoints específicos para mobile
- Se recomienda implementar:
  - Sidebar overlay en mobile
  - Menú hamburguesa para toggle
  - Sidebar oculto por defecto en pantallas pequeñas

## Dependencias

### Librerías
- **React Router DOM**: Para navegación (`Link`, `useLocation`, `useNavigate`, `Outlet`)
- **Lucide React**: Para iconos (todos los iconos de navegación)
- **Tailwind CSS**: Para estilos

### Servicios
- **api.getCurrentUser()**: Para obtener información del usuario actual
- **api.logout()**: Para cerrar sesión

## Estados del Componente

```typescript
const [isCollapsed, setIsCollapsed] = useState(false);
const [currentUser, setCurrentUser] = useState<{ username?: string; full_name?: string } | null>(null);
const [showUserMenu, setShowUserMenu] = useState(false);
```

## Funciones Principales

### `toggleSidebar()`
- Alterna el estado `isCollapsed`
- No persiste estado en localStorage

### `handleLogout()`
- Ejecuta `api.logout()`
- Navega a `/login`
- Recarga la página para limpiar estado

### `handleChangePassword()`
- Cierra el menú de usuario
- Navega a `/change-password`

## Especificaciones Técnicas

### Clases Tailwind Utilizadas

**Layout**:
- `min-h-screen flex`: Contenedor principal
- `flex-1 overflow-auto`: Área de contenido

**Sidebar**:
- `bg-gray-900 text-white`: Fondo oscuro
- `transition-all duration-300`: Transiciones suaves
- `relative`: Para posicionamiento absoluto de elementos hijos

**Navegación**:
- `group`: Para tooltips en hover
- `transition-colors`: Transiciones de color
- `relative`: Para posicionamiento de tooltips

**Header**:
- `bg-gradient-to-r from-slate-100 via-gray-50 to-slate-100`: Gradiente de fondo
- `border-b border-gray-200`: Borde inferior
- `shadow-sm`: Sombra sutil

### Breakpoints Sugeridos

Para implementación responsive futura:
- `sm`: 640px
- `md`: 768px
- `lg`: 1024px
- `xl`: 1280px

## Ejemplo de Implementación

### Estructura Básica

```tsx
<div className="min-h-screen flex">
  {/* Sidebar */}
  <div className={`${isCollapsed ? 'w-20' : 'w-64'} bg-gray-900 text-white transition-all duration-300 relative`}>
    {/* Toggle Button */}
    <button onClick={toggleSidebar} className="absolute -right-3 top-6 z-10 ...">
      {isCollapsed ? <ChevronRight /> : <ChevronLeft />}
    </button>

    {/* Logo y Título */}
    <div className="p-6">
      <img src={logoImage} className={isCollapsed ? 'w-10 h-10' : 'w-12 h-12'} />
      {!isCollapsed && (
        <>
          <h1>CortexAgentHub</h1>
          <p>Admin Panel</p>
        </>
      )}
    </div>

    {/* Navegación */}
    <nav className="mt-6">
      {navigation.map((item) => (
        <Link
          key={item.name}
          to={item.href}
          className={`... ${isActive ? 'bg-gray-800 border-l-4 border-primary-500' : ''}`}
        >
          <item.icon size={20} />
          {!isCollapsed && <span>{item.name}</span>}
          {isCollapsed && (
            <div className="tooltip">{item.name}</div>
          )}
        </Link>
      ))}
    </nav>

    {/* Footer */}
    <div className="absolute bottom-0 ...">
      {!isCollapsed && (
        <div>
          <p>Version 1.0.0</p>
          <p>© 2025 CortexAgentHub</p>
        </div>
      )}
    </div>
  </div>

  {/* Main Content */}
  <div className="flex-1 overflow-auto">
    <header>...</header>
    <main><Outlet /></main>
  </div>
</div>
```

## Notas de Implementación

1. **Persistencia**: El estado colapsado no se persiste. Considerar agregar localStorage si se requiere.

2. **Accesibilidad**: 
   - Agregar `aria-label` a botones
   - Considerar navegación por teclado
   - Agregar `role="navigation"` al sidebar

3. **Performance**:
   - Los iconos se importan individualmente de lucide-react
   - Las transiciones CSS son más eficientes que animaciones JavaScript

4. **Mantenibilidad**:
   - El array `navigation` centraliza toda la configuración de navegación
   - Fácil agregar/remover elementos modificando solo este array

5. **Testing**:
   - Probar toggle en diferentes tamaños de pantalla
   - Verificar tooltips en estado colapsado
   - Validar navegación y estados activos
   - Probar menú de usuario y sus acciones


