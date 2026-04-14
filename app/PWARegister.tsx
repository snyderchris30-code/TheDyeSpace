"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { withVersionParam } from "@/lib/app-config";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index);
  }

  return outputArray;
}

export default function PWARegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    const isProduction = process.env.NODE_ENV === "production";
    if (!isProduction) {
      return;
    }

    const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() || "";
    const supabase = createClient();
    let active = true;

    const registrationPromise = navigator.serviceWorker
      .register(withVersionParam("/sw.js"))
      .catch(() => null);

    const syncPushSubscription = async () => {
      if (!active || !vapidPublicKey || !("PushManager" in window) || Notification.permission !== "granted") {
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        return;
      }

      const registration = await registrationPromise;
      if (!registration) {
        return;
      }

      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        });
      }

      await fetch("/api/push-subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });
    };

    const unsubscribePushSubscription = async () => {
      const registration = await registrationPromise;
      if (!registration) {
        return;
      }

      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        return;
      }

      await subscription.unsubscribe().catch(() => {
        // Best effort cleanup.
      });
    };

    void syncPushSubscription();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) {
        return;
      }

      if (session?.user) {
        void syncPushSubscription();
        return;
      }

      void unsubscribePushSubscription();
    });

    const handleFocus = () => {
      void syncPushSubscription();
    };

    window.addEventListener("focus", handleFocus);

    navigator.serviceWorker.ready
      .then(() => {
        void syncPushSubscription();
      })
      .catch(() => {
        // Silent fail: app remains fully functional without offline support.
      });

    return () => {
      active = false;
      subscription.unsubscribe();
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  return null;
}
