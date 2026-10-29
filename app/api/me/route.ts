import { getServerSession } from "next-auth";
import { authOptions, isAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email ?? null;
  return Response.json({ email, isAdmin: isAdmin(email) });
}
