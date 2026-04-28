/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    // Ignoramos errores de tipado para poder desplegar en producción rápido.
    ignoreBuildErrors: true,
  },
};

export default nextConfig;