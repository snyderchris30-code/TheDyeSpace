export type PrivateRoomKey = "psychonautics" | "admin_room";
export type PrivateRoomSlug = "psychonautics" | "admin-room";

export type PrivateRoomAccessProfile = {
  role?: string | null;
  psychonautics_access?: boolean | null;
  admin_room_access?: boolean | null;
};

export type PrivateRoomDefinition = {
  key: PrivateRoomKey;
  slug: PrivateRoomSlug;
  title: string;
  shortLabel: string;
  description: string;
  accentClassName: string;
  accessField: keyof Pick<PrivateRoomAccessProfile, "psychonautics_access" | "admin_room_access">;
};

export const PRIVATE_ROOM_PROFILE_SELECT = "role, psychonautics_access, admin_room_access";
export const PRIVATE_ROOM_POSTS_BUCKET = "room-posts";
export const PRIVATE_ROOM_POST_LIFETIME_HOURS = 16;

export const PRIVATE_ROOM_DEFINITIONS: Record<PrivateRoomKey, PrivateRoomDefinition> = {
  psychonautics: {
    key: "psychonautics",
    slug: "psychonautics",
    title: "Psychonautics Society",
    shortLabel: "Psychonautics",
    description: "A private gallery for invited members to share short-lived photos and commentary.",
    accentClassName: "from-emerald-500/20 via-cyan-500/10 to-blue-500/20",
    accessField: "psychonautics_access",
  },
  admin_room: {
    key: "admin_room",
    slug: "admin-room",
    title: "ADMINS ROOM",
    shortLabel: "Admins Room",
    description: "A locked private room for invited users and admins only.",
    accentClassName: "from-rose-500/20 via-fuchsia-500/10 to-amber-500/20",
    accessField: "admin_room_access",
  },
};

export function parsePrivateRoomKey(value: string | null | undefined): PrivateRoomKey | null {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "psychonautics") {
    return "psychonautics";
  }

  if (normalized === "admin-room" || normalized === "admin_room") {
    return "admin_room";
  }

  return null;
}

export function getPrivateRoomDefinition(room: PrivateRoomKey) {
  return PRIVATE_ROOM_DEFINITIONS[room];
}

export function canAccessPrivateRoom(profile: PrivateRoomAccessProfile | null | undefined, room: PrivateRoomKey) {
  if (!profile) {
    return false;
  }

  if (profile.role === "admin") {
    return true;
  }

  const definition = getPrivateRoomDefinition(room);
  return profile[definition.accessField] === true;
}

export function getPrivateRoomRoute(room: PrivateRoomKey) {
  return `/${getPrivateRoomDefinition(room).slug}`;
}

export function getPrivateRoomExpiryIso() {
  return new Date(Date.now() + PRIVATE_ROOM_POST_LIFETIME_HOURS * 60 * 60 * 1000).toISOString();
}