import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ 
  subsets: ["latin"],
  variable: '--font-geist-sans',
});

const jetbrainsMono = JetBrains_Mono({ 
  subsets: ["latin"],
  variable: '--font-geist-mono',
});

export const metadata: Metadata = {
  title: "Ontiveros Bio-Alert | Bioacoustic Monitoring System",
  description: "Industrial-grade bioacoustic monitoring platform for livestock operations. Real-time audio analysis, alert management, and predictive insights.",
  keywords: ["bioacoustics", "livestock", "monitoring", "IoT", "agriculture", "Ontiveros"],
  authors: [{ name: "Ontiveros Bio-Alert" }],
  openGraph: {
    title: "Ontiveros Bio-Alert | Bioacoustic Monitoring",
    description: "Next-generation livestock monitoring through AI-powered audio analysis",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" href="/icono.png" />
        <link rel="apple-touch-icon" href="/icono.png" />
        <meta name="theme-color" content="#f59e0b" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Bio-Alert" />
      </head>
      <body className={`${inter.variable} ${jetbrainsMono.variable} font-sans antialiased dark`}>
        {children}
      </body>
    </html>
  );
}

