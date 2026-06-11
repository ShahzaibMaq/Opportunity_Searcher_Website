"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Bell, BellOff, Loader2 } from "lucide-react";
import type { User } from "@supabase/supabase-js";

export function PushNotificationManager({ user }: { user: User }) {
  const [isSupported, setIsSupported] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    async function loadSubscription() {
      await Promise.resolve();
      if ("serviceWorker" in navigator && "PushManager" in window) {
        setIsSupported(true);
        try {
          const registration = await navigator.serviceWorker.register("/sw.js");
          const subscription = await registration.pushManager.getSubscription();
          setIsSubscribed(!!subscription);
        } catch (err) {
          setErrorMessage(err instanceof Error ? err.message : "Service worker registration failed.");
        } finally {
          setIsLoading(false);
        }
      } else {
        setIsLoading(false);
      }
    }

    loadSubscription();
  }, []);

  // To actually make this work, the user needs to generate VAPID keys 
  // and put the NEXT_PUBLIC_VAPID_PUBLIC_KEY in .env.local
  const publicVapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";

  function urlBase64ToUint8Array(base64String: string) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, '+')
      .replace(/_/g, '/');
  
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
  
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  async function subscribe() {
    if (!publicVapidKey) {
      setErrorMessage("Push notifications require a VAPID public key.");
      return;
    }
    
    setIsLoading(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicVapidKey)
      });

      if (supabase && user) {
        const { error } = await supabase.from("push_subscriptions").upsert({
          user_id: user.id,
          subscription: subscription.toJSON()
        });
        if (error) throw error;
      }

      setIsSubscribed(true);
      setErrorMessage("");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to enable notifications.");
    } finally {
      setIsLoading(false);
    }
  }

  async function unsubscribe() {
    setIsLoading(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await subscription.unsubscribe();
        if (supabase && user) {
          const { error } = await supabase.from("push_subscriptions")
            .delete()
            .eq("user_id", user.id);
          if (error) throw error;
        }
      }
      setIsSubscribed(false);
      setErrorMessage("");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to disable notifications.");
    } finally {
      setIsLoading(false);
    }
  }

  if (!isSupported) {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-500">
        <BellOff size={16} />
        Push notifications are not supported in this browser.
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-md border border-zinc-200 bg-white p-4">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${isSubscribed ? "bg-teal-50 text-teal-800" : "bg-zinc-100 text-zinc-500"}`}>
        {isSubscribed ? <Bell size={18} /> : <BellOff size={18} />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-zinc-900">Deadline alerts</p>
        <p className="text-xs text-zinc-500">{errorMessage || "Get notified when an opportunity is closing soon."}</p>
      </div>
      <button
        onClick={isSubscribed ? unsubscribe : subscribe}
        disabled={isLoading}
        className={`flex min-w-[100px] items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${
          isSubscribed 
            ? "border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
            : "bg-teal-800 text-white"
        } disabled:opacity-50`}
      >
        {isLoading ? <Loader2 size={16} className="animate-spin" /> : (isSubscribed ? "Disable" : "Enable")}
      </button>
    </div>
  );
}
