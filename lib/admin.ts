import { getServerSession } from "next-auth";
import { authOptions, isAdmin } from "@/lib/auth";

/** The signed-in admin's email, or null. */
export async function adminEmail(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email ?? null;
  return isAdmin(email) ? email : null;
}
export const deny = () => Response.json({ error: "Sign in with an admin account." }, { status: 401 });
