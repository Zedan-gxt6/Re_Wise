import crypto from "crypto";
import { db } from "../db/pool.js";
import { assertUserCapacity } from "./userLimitService.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export function isGoogleAuthConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function createGoogleState() {
  return crypto.randomBytes(24).toString("hex");
}

export function getGoogleRedirectUri(req) {
  if (process.env.GOOGLE_CALLBACK_URL) return process.env.GOOGLE_CALLBACK_URL;
  return `${req.protocol}://${req.get("host")}/auth/google/callback`;
}

export function safeReturnTo(returnTo) {
  const value = String(returnTo || "").trim();
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  return value;
}

export function buildGoogleAuthUrl({ state, redirectUri }) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export async function exchangeGoogleCode({ code, redirectUri }) {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error_description || payload.error || "Google token exchange failed");
  }

  return payload;
}

export async function fetchGoogleProfile(accessToken) {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const profile = await response.json();
  if (!response.ok) throw new Error(profile.error_description || "Google profile fetch failed");

  return {
    googleId: profile.sub,
    email: String(profile.email || "").toLowerCase(),
    emailVerified: profile.email_verified === true || profile.email_verified === "true",
    name: profile.name || "",
    picture: profile.picture || "",
  };
}

export async function findOrCreateGoogleUser(profile) {
  if (!profile.googleId || !profile.email || !profile.emailVerified) {
    throw new Error("Google account must have a verified email");
  }

  const byGoogleId = await db.query(
    `SELECT id FROM users WHERE google_id = $1 LIMIT 1`,
    [profile.googleId]
  );
  if (byGoogleId.rows.length > 0) return byGoogleId.rows[0];

  const byEmail = await db.query(
    `UPDATE users
     SET google_id = $1,
         email = COALESCE(email, $2),
         email_verified = TRUE,
         auth_provider = CASE WHEN auth_provider = 'local' THEN 'local_google' ELSE COALESCE(auth_provider, 'google') END,
         profile_pic_url = COALESCE(NULLIF(profile_pic_url, ''), $3)
     WHERE LOWER(email) = LOWER($2)
     RETURNING id`,
    [profile.googleId, profile.email, profile.picture || null]
  );
  if (byEmail.rows.length > 0) return byEmail.rows[0];

  await assertUserCapacity();

  const username = await createUniqueGoogleUsername(profile.email, profile.name);
  const created = await db.query(
    `INSERT INTO users
       (username, password_hashed, google_id, email, email_verified, auth_provider, profile_pic_url, is_public)
     VALUES ($1, NULL, $2, $3, TRUE, 'google', $4, TRUE)
     RETURNING id`,
    [username, profile.googleId, profile.email, profile.picture || null]
  );

  return created.rows[0];
}

async function createUniqueGoogleUsername(email, name) {
  const baseSource = name || email.split("@")[0] || "google_user";
  const base = baseSource
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 32) || "google_user";

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}_${attempt + 1}`;
    const existing = await db.query("SELECT id FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1", [candidate]);
    if (existing.rows.length === 0) return candidate;
  }

  return `${base}_${crypto.randomBytes(4).toString("hex")}`.slice(0, 50);
}
