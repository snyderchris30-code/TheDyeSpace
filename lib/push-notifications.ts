import webpush from "web-push";
import type { createAdminClient } from "@/lib/admin-utils";

type PushSourceNotification = {
  user_id: string;
  actor_name: string;
  type: string;
  message: string;
  post_id?: string | null;
};

type StoredPushSubscription = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

function getPushConfig() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() || "";
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim() || "";
  const subject = process.env.VAPID_SUBJECT?.trim() || "";

  if (!publicKey || !privateKey || !subject) {
    return null;
  }

  return { publicKey, privateKey, subject };
}

export function getPushPublicKey() {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() || "";
}

export function buildPushPayload(source: PushSourceNotification) {
  return {
    title: source.type === "admin_report" ? "New report in Moderation Queue" : "New notification",
    body: source.message,
    url: source.type === "admin_report" ? "/admin/reports" : source.post_id ? "/explore" : "/notifications",
    tag: `thedyespace-${source.type}-${source.user_id}`,
  };
}

export async function sendPushNotificationsForSources(
  adminClient: ReturnType<typeof createAdminClient>,
  sources: PushSourceNotification[]
) {
  if (!sources.length) {
    return;
  }

  const config = getPushConfig();
  if (!config) {
    return;
  }

  const userIds = [...new Set(sources.map((source) => source.user_id).filter(Boolean))];
  if (!userIds.length) {
    return;
  }

  const { data: rows, error } = await adminClient
    .from("push_subscriptions")
    .select("id,user_id,endpoint,p256dh,auth")
    .in("user_id", userIds);

  if (error) {
    throw error;
  }

  const subscriptions = (rows || []) as StoredPushSubscription[];
  if (!subscriptions.length) {
    return;
  }

  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);

  const subscriptionsByUserId = new Map<string, StoredPushSubscription[]>();
  for (const subscription of subscriptions) {
    const current = subscriptionsByUserId.get(subscription.user_id) || [];
    current.push(subscription);
    subscriptionsByUserId.set(subscription.user_id, current);
  }

  const staleSubscriptionIds = new Set<string>();

  await Promise.all(
    sources.flatMap((source) => {
      const userSubscriptions = subscriptionsByUserId.get(source.user_id) || [];
      if (!userSubscriptions.length) {
        return [];
      }

      const payload = JSON.stringify(buildPushPayload(source));

      return userSubscriptions.map(async (subscription) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: {
                p256dh: subscription.p256dh,
                auth: subscription.auth,
              },
            },
            payload
          );
        } catch (error: any) {
          if (error?.statusCode === 404 || error?.statusCode === 410) {
            staleSubscriptionIds.add(subscription.id);
            return;
          }

          throw error;
        }
      });
    })
  );

  if (staleSubscriptionIds.size > 0) {
    await adminClient.from("push_subscriptions").delete().in("id", [...staleSubscriptionIds]);
  }
}