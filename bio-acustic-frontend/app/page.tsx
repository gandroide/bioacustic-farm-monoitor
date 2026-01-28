"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  
  useEffect(() => {
    router.push('/login');
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="h-12 w-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
    </div>
  );
}

