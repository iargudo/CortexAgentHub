import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  MessageSquare,
  Brain,
  Wrench,
  Bot,
  FileText,
  Activity,
  Book,
  Database,
  Code,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Lock,
  Users,
  MessageCircle,
  Layers,
} from 'lucide-react';
// Importar logo de Cortex
import logoImage from '@/assets/icons/logo.png';
import { api } from '../services/api';

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

export function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [currentUser, setCurrentUser] = useState<{ username?: string; full_name?: string } | null>(null);
  const [showUserMenu, setShowUserMenu] = useState(false);

  useEffect(() => {
    // Load current user info
    api.getCurrentUser()
      .then((user) => setCurrentUser(user))
      .catch(() => {
        // If error, remove token and redirect to login
        localStorage.removeItem('auth_token');
        navigate('/login');
      });
  }, [navigate]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.user-menu-container')) {
        setShowUserMenu(false);
      }
    };

    if (showUserMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showUserMenu]);

  const toggleSidebar = () => {
    setIsCollapsed(!isCollapsed);
  };

  const handleLogout = () => {
    api.logout();
    navigate('/login');
    // Reload to clear all state
    window.location.reload();
  };

  const handleChangePassword = () => {
    setShowUserMenu(false);
    navigate('/change-password');
  };

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <div className={`${isCollapsed ? 'w-20' : 'w-64'} bg-gray-900 text-white transition-all duration-300 relative`}>
        {/* Toggle Button */}
        <button
          onClick={toggleSidebar}
          className="absolute -right-3 top-6 z-10 bg-gray-800 hover:bg-gray-700 text-white p-1.5 rounded-full border-2 border-gray-900 shadow-lg transition-colors"
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isCollapsed ? (
            <ChevronRight size={16} />
          ) : (
            <ChevronLeft size={16} />
          )}
        </button>

        <div className={`p-6 ${isCollapsed ? 'px-4' : ''}`}>
          <div className={`flex flex-col items-center text-center mb-2 ${isCollapsed ? 'px-0' : ''}`}>
            <img 
              src={logoImage} 
              alt="Cortex Logo" 
              className={`${isCollapsed ? 'w-10 h-10' : 'w-12 h-12'} object-contain mb-3 transition-all`}
            />
            {!isCollapsed && (
              <>
                <h1 className="text-2xl font-bold">CortexAgentHub</h1>
                <p className="text-sm text-gray-400 mt-1">Admin Panel</p>
              </>
            )}
          </div>
        </div>

        <nav className="mt-6">
          {navigation.map((item) => {
            const isActive = location.pathname === item.href;
            const Icon = item.icon;

            return (
              <Link
                key={item.name}
                to={item.href}
                className={`
                  flex items-center gap-3 py-3 text-sm font-medium transition-colors relative group
                  ${isCollapsed ? 'px-4 justify-center' : 'px-6'}
                  ${
                    isActive
                      ? `bg-gray-800 text-white ${isCollapsed ? 'border-l-2' : 'border-l-4'} border-primary-500`
                      : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                  }
                `}
                title={isCollapsed ? item.name : undefined}
              >
                <Icon size={20} />
                {!isCollapsed && <span>{item.name}</span>}
                {/* Tooltip when collapsed */}
                {isCollapsed && (
                  <div className="absolute left-full ml-2 px-2 py-1 bg-gray-800 text-white text-sm rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
                    {item.name}
                  </div>
                )}
              </Link>
            );
          })}
        </nav>

        <div className={`absolute bottom-0 ${isCollapsed ? 'w-20' : 'w-64'} p-6 border-t border-gray-800 transition-all`}>
          {!isCollapsed && (
            <div className="text-xs text-gray-500">
              <p>Version 1.0.0</p>
              <p className="mt-1">© 2025 CortexAgentHub</p>
            </div>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-auto">
        <header className="bg-gradient-to-r from-slate-100 via-gray-50 to-slate-100 border-b border-gray-200 px-8 py-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-semibold text-gray-900">
              {navigation.find((item) => item.href === location.pathname)
                ?.name || 'Dashboard'}
            </h2>

            <div className="flex items-center gap-4">
              <div className="relative user-menu-container">
                <button
                  onClick={() => setShowUserMenu(!showUserMenu)}
                  className="flex items-center gap-3 hover:bg-gray-50 rounded-lg px-2 py-1.5 transition-colors"
                  title="Menú de usuario"
                >
                  <div className="text-right">
                    <p className="text-sm font-medium text-gray-900">
                      {currentUser?.full_name || currentUser?.username || 'Admin User'}
                    </p>
                    <p className="text-xs text-gray-500">Administrador</p>
                  </div>
                  <div className="w-10 h-10 rounded-full bg-primary-600 flex items-center justify-center text-white text-sm font-medium cursor-pointer hover:bg-primary-700 transition-colors">
                    {currentUser?.username?.charAt(0).toUpperCase() || currentUser?.full_name?.charAt(0).toUpperCase() || 'A'}
                  </div>
                </button>

                {/* Dropdown Menu */}
                {showUserMenu && (
                  <div className="absolute right-0 mt-2 w-56 bg-white rounded-md shadow-lg ring-1 ring-black ring-opacity-5 z-50">
                    <div className="py-1" role="menu">
                      <button
                        onClick={handleChangePassword}
                        className="flex items-center gap-3 w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                        role="menuitem"
                      >
                        <Lock size={18} className="text-gray-400" />
                        <span>Cambiar Contraseña</span>
                      </button>
                      <button
                        onClick={handleLogout}
                        className="flex items-center gap-3 w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-red-50 hover:text-red-600 transition-colors"
                        role="menuitem"
                      >
                        <LogOut size={18} className="text-gray-400" />
                        <span>Cerrar Sesión</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        <main className="p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
