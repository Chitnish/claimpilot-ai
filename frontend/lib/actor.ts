// Tier-1 demo identity layer. The acting user is chosen in the sidebar switcher
// and sent to the backend on every call via X-Actor-* headers. A real
// deployment replaces this with SSO/IdP auth (Tier 2); the call sites stay the
// same. Default is the manager role so existing flows keep working.

export type Role = "biller" | "supervisor" | "manager";

export interface DemoUser {
  id: string;
  name: string;
  role: Role;
}

export const DEMO_USERS: DemoUser[] = [
  { id: "u-biller", name: "Jordan Lee", role: "biller" },
  { id: "u-supervisor", name: "Sam Rivera", role: "supervisor" },
  { id: "u-manager", name: "Alex Morgan", role: "manager" },
];

const DEFAULT_USER: DemoUser = DEMO_USERS[2]!; // manager
const STORAGE_KEY = "claimpilot.actor";
const ACTOR_EVENT = "claimpilot:actor-changed";

export function getActor(): DemoUser {
  if (typeof window === "undefined") return DEFAULT_USER;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DemoUser>;
      if (parsed && parsed.id && parsed.name && parsed.role) {
        return { id: parsed.id, name: parsed.name, role: parsed.role };
      }
    }
  } catch {
    // fall through to default
  }
  return DEFAULT_USER;
}

export function setActor(user: DemoUser): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  window.dispatchEvent(new CustomEvent<DemoUser>(ACTOR_EVENT, { detail: user }));
}

export function actorHeaders(): Record<string, string> {
  const actor = getActor();
  return {
    "X-Actor-Id": actor.id,
    "X-Actor-Name": actor.name,
    "X-Actor-Role": actor.role,
  };
}

export function onActorChange(callback: (user: DemoUser) => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = (event: Event): void => {
    const detail = (event as CustomEvent<DemoUser>).detail;
    callback(detail ?? getActor());
  };
  window.addEventListener(ACTOR_EVENT, handler);
  return () => window.removeEventListener(ACTOR_EVENT, handler);
}
