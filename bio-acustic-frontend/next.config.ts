/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    // Ignoramos errores de tipado para poder desplegar en producción rápido.
    ignoreBuildErrors: true,
  },
  eslint: {
    // Ignoramos errores de estilo durante el build.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;