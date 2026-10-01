import * as store from "@/lib/store";
import { currentUser } from "@/lib/guard";
import { isAdmin } from "@/lib/session";
import { errorJson, json, readJson, unauthorizedJson } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  if (!user) return unauthorizedJson();

  // A client sees only itself; an operator in the admin group sees the book.
  const clients = isAdmin(user)
    ? store.listClients()
    : store.listClients().filter((c) => c.authentikSubject === user.subject);
  return json({ clients });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return unauthorizedJson();

  const body = (await readJson(request)) as { name?: string; email?: string } | null;
  if (!body?.name || !body?.email) {
    return errorJson("name and email are required.");
  }
  if (!isAdmin(user)) {
    return errorJson("Only an operator can create clients directly.", 403);
  }

  return json({ client: store.createClient({ name: body.name, email: body.email }) }, 201);
}
