"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Bell, BellOff, Loader2 } from "lucide-react";

export function PushNotificationManager({ user }: { user: any }) {
  const [isSupported, setIsSupported] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if ("serviceWorker" in navigator && "PushManager" in window) {
      setIsSupported(true);
      checkSubscription();
    } else {
      setIsLoading(false);
    }
  }, []);

  async function checkSubscription() {
    try {
      const registration = await navigator.serviceWorker.register("/sw.js");
      const subscription = await registration.pushManager.getSubscription();
      setIsSubscribed(!!subscription);
    } catch (err) {
      console.error("Service Worker registration failed: ", err);
    } finally {
      setIsLoading(false);
    }
  }

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
      alert("Push notifications require a VAPID public key. Please configure it in your environment variables.");
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
        // Save subscription to Supabase
        await supabase.from("push_subscriptions").upsert({
          user_id: user.id,
          subscription: subscription.toJSON()
        });
      }

      setIsSubscribed(true);
    } catch (err) {
      console.error("Failed to subscribe", err);
      alert("Failed to enable notifications. Please ensure you granted permission.");
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
          // Remove from Supabase
          await supabase.from("push_subscriptions")
            .delete()
            .eq("user_id", user.id);
        }
      }
      setIsSubscribed(false);
    } catch (err) {
      console.error("Failed to unsubscribe", err);
    } finally {
      setIsLoading(false);
    }
  }

  if (!isSupported) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <BellOff size={16} />
        Push notifications are not supported in this browser.
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 bg-white p-4 rounded-xl border border-slate-200">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${isSubscribed ? "bg-emerald-100 text-emerald-600" : "bg-slate-100 text-slate-500"}`}>
        {isSubscribed ? <Bell size={18} /> : <BellOff size={18} />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-900">Deadline Alerts</p>
        <p className="text-xs text-slate-500">Get notified when an opportunity is closing soon.</p>
      </div>
      <button
        onClick={isSubscribed ? unsubscribe : subscribe}
        disabled={isLoading}
        className={`flex min-w-[100px] items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
          isSubscribed 
            ? "border border-slate-200 text-slate-600 hover:bg-slate-50"
            : "bg-emerald-600 text-white hover:bg-emerald-700"
        } disabled:opacity-50`}
      >
        {isLoading ? <Loader2 size={16} className="animate-spin" /> : (isSubscribed ? "Disable" : "Enable")}
      </button>
    </div>
  );
}
