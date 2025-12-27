import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import logoImage from '@/assets/icons/logo.png';

export function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    // If already logged in, redirect to dashboard
    const token = localStorage.getItem('auth_token');
    if (token) {
      // Verify token is valid
      api.getCurrentUser()
        .then(() => navigate('/'))
        .catch(() => localStorage.removeItem('auth_token'));
    }
  }, [navigate]);

  const getErrorMessage = (error: any): string => {
    // Si hay respuesta del servidor con mensaje específico
    if (error.response?.data?.message) {
      const serverMessage = error.response.data.message;
      
      // Mapear mensajes del servidor a mensajes amigables en español
      if (serverMessage.includes('Invalid username or password') || 
          serverMessage.includes('AUTH_FAILED')) {
        return 'Usuario o contraseña incorrectos. Por favor, verifica tus credenciales.';
      }
      
      if (serverMessage.includes('Username and password are required') ||
          serverMessage.includes('VALIDATION_ERROR')) {
        return 'Por favor, ingresa tu usuario y contraseña.';
      }
      
      if (serverMessage.includes('JWT') || serverMessage.includes('CONFIG_ERROR')) {
        return 'Error de configuración del servidor. Por favor, contacta al administrador.';
      }
      
      return serverMessage;
    }
    
    // Si es un error 401 (no autorizado)
    if (error.response?.status === 401) {
      return 'Usuario o contraseña incorrectos. Por favor, verifica tus credenciales.';
    }
    
    // Si es un error 400 (solicitud incorrecta)
    if (error.response?.status === 400) {
      return 'Por favor, completa todos los campos correctamente.';
    }
    
    // Si es un error 500 (error del servidor)
    if (error.response?.status === 500) {
      return 'Error del servidor. Por favor, intenta nuevamente más tarde.';
    }
    
    // Si no hay conexión
    if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      return 'Tiempo de espera agotado. Por favor, verifica tu conexión e intenta nuevamente.';
    }
    
    if (!error.response) {
      return 'No se pudo conectar con el servidor. Por favor, verifica tu conexión.';
    }
    
    // Mensaje genérico
    return 'Error al iniciar sesión. Por favor, intenta nuevamente.';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    // Validación básica en el frontend
    if (!username.trim() || !password.trim()) {
      setError('Por favor, ingresa tu usuario y contraseña.');
      setLoading(false);
      return;
    }

    try {
      await api.login({ username: username.trim(), password });
      navigate('/');
      // Reload to refresh the app state
      window.location.reload();
    } catch (err: any) {
      const friendlyMessage = getErrorMessage(err);
      setError(friendlyMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full space-y-8 p-8 bg-white rounded-lg shadow-lg">
        <div className="text-center">
          <div className="flex justify-center mb-4">
            <img 
              src={logoImage} 
              alt="CortexAgentHub Logo" 
              className="w-20 h-20 object-contain"
            />
          </div>
          <h2 className="text-3xl font-bold text-gray-900">CortexAgentHub</h2>
          <p className="mt-2 text-sm text-gray-600">Panel de Administración</p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          {error && (
            <div className="bg-red-50 border-l-4 border-red-400 p-4 rounded-md">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <p className="text-sm font-medium text-red-800">
                    {error}
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-gray-700">
                Usuario
              </label>
              <input
                id="username"
                name="username"
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                placeholder="Ingresa tu usuario"
                autoComplete="username"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                Contraseña
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                placeholder="Ingresa tu contraseña"
                autoComplete="current-password"
              />
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={loading}
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Iniciando sesión...' : 'Iniciar Sesión'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

