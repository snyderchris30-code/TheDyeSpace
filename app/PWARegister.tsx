"use client";

import { useEffect } from "react";
import { withVersionParam } from "@/lib/app-config";

export default function PWARegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      return;
    }

    if (!("serviceWorker" in navigator)) {
      return;
    }

    navigator.serviceWorker.register(withVersionParam("/sw.js")).catch(() => {
      // Silent fail: app remains fully functional without offline support.
    });
  }, []);

  return null;
}
