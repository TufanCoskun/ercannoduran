import { NextResponse, type NextRequest } from "next/server";
import { ROLE_COOKIE, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

function logout(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/login", req.nextUrl.origin), 303);
  res.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  res.cookies.set({ name: ROLE_COOKIE, value: "", path: "/", maxAge: 0 });
  res.headers.set("cache-control", "no-store");
  return res;
}

export const POST = logout;
export const GET = logout;
