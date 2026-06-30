import crypto from "crypto";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import argon2 from "argon2";
import type { AppRole, DocPermission, SessionUser } from "@/types/document";
import { getPool, sql } from "@/lib/db";

const COOKIE_NAME = "doc_session";
const DOC_PERMISSIONS: DocPermission[] = ["DOC_USER", "DOC_TBP", "DOC_ADMIN"];

function secret() {
  return new TextEncoder().encode(process.env.AUTH_SECRET || process.env.ACCESS_TOKEN_SECRET || "dev-secret-change-me");
}

function roleFromPermissions(permissions: DocPermission[]): AppRole {
  if (permissions.includes("DOC_ADMIN")) return "ADMIN";
  if (permissions.includes("DOC_TBP")) return "TBP";
  return "USER";
}

function columnName(value: string | undefined, fallback: string) {
  const name = value || fallback;
  if (!/^[A-Za-z0-9_]+$/.test(name)) return fallback;
  return name;
}

export async function getDocPermissions(userId: number): Promise<DocPermission[]> {
  const pool = await getPool();
  const rs = await pool.request()
    .input("UserId", sql.Int, userId)
    .execute("doc.sp_Auth_GetDocPermissions");
  const found = ((rs.recordset || []) as { MaQuyen: string }[])
    .map((row) => row.MaQuyen)
    .filter((code): code is DocPermission => DOC_PERMISSIONS.includes(code as DocPermission));
  return found.length ? found : ["DOC_USER"];
}

async function findLoginUser(username: string) {
  const usernameColumn = columnName(process.env.TAG_LOGIN_USERNAME_COLUMN, "TenDangNhap");
  const passwordColumn = columnName(process.env.TAG_LOGIN_PASSWORD_COLUMN, "MatKhau");
  const pool = await getPool();
  const rs = await pool.request()
    .input("Username", sql.NVarChar(150), username)
    .input("UsernameColumn", sql.NVarChar(128), usernameColumn)
    .input("PasswordColumn", sql.NVarChar(128), passwordColumn)
    .execute("doc.sp_Auth_FindLoginUser");
  return rs.recordset?.[0] as { id: number; username: string; fullName: string; passwordHash: string | null } | undefined;
}

async function verifyPassword(stored: string | null, password: string) {
  if (!stored) return false;
  const normalizedStored = stored.trim().toLowerCase();
  const md5Password = crypto.createHash("md5").update(password, "utf8").digest("hex");
  if (normalizedStored === md5Password) return true;
  if (stored.startsWith("$argon2")) return argon2.verify(stored, password);
  return stored === password;
}

export async function login(username: string, password: string) {
  const user = await findLoginUser(username);
  if (!user || !(await verifyPassword(user.passwordHash, password))) return null;
  const permissions = await getDocPermissions(Number(user.id));
  const session: SessionUser = {
    userId: Number(user.id),
    username: user.username,
    fullName: user.fullName,
    role: roleFromPermissions(permissions),
    permissions,
  };
  await setSession(session);
  return session;
}

export async function setSession(user: SessionUser) {
  const token = await new SignJWT(user)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(secret());
  (await cookies()).set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
}

export async function clearSession() {
  (await cookies()).delete(COOKIE_NAME);
}

export async function getSession(): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const verified = await jwtVerify(token, secret());
    return verified.payload as SessionUser;
  } catch {
    return null;
  }
}

export function canAdmin(user: SessionUser | null) {
  return user?.role === "ADMIN";
}

export function canCompleteRoleAssignment(user: SessionUser | null, requiredRoleCode: string | null) {
  if (!user || !requiredRoleCode) return false;
  return user.permissions.includes(requiredRoleCode as DocPermission);
}






