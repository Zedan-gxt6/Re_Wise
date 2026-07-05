import express from "express";
import { seedUserConstants } from "../services/problemService.js";
import {
  buildGoogleAuthUrl,
  createGoogleState,
  exchangeGoogleCode,
  fetchGoogleProfile,
  findOrCreateGoogleUser,
  getGoogleRedirectUri,
  isGoogleAuthConfigured,
  safeReturnTo,
} from "../services/googleAuthService.js";

const router = express.Router();

router.get("/auth/google/status", (req, res) => {
  if (process.env.NODE_ENV === "production") return res.status(404).send("Not found");

  res.json({
    configured: isGoogleAuthConfigured(),
    hasClientId: Boolean(process.env.GOOGLE_CLIENT_ID),
    hasClientSecret: Boolean(process.env.GOOGLE_CLIENT_SECRET),
    callbackUrl: process.env.GOOGLE_CALLBACK_URL || null,
  });
});

router.get("/auth/google", (req, res) => {
  if (!isGoogleAuthConfigured()) {
    return res.redirect("/login?error=google_not_configured");
  }

  const state = createGoogleState();
  req.session.googleAuthState = state;
  req.session.googleAuthReturnTo = safeReturnTo(req.query.returnTo);

  const authUrl = buildGoogleAuthUrl({
    state,
    redirectUri: getGoogleRedirectUri(req),
  });

  res.redirect(authUrl);
});

router.get("/auth/google/callback", async (req, res) => {
  const expectedState = req.session.googleAuthState;
  const returnTo = safeReturnTo(req.session.googleAuthReturnTo);

  delete req.session.googleAuthState;
  delete req.session.googleAuthReturnTo;

  if (!isGoogleAuthConfigured()) return res.redirect("/login?error=google_not_configured");
  if (!req.query.code || !req.query.state || req.query.state !== expectedState) {
    return res.redirect("/login?error=google_state_failed");
  }

  try {
    const tokens = await exchangeGoogleCode({
      code: req.query.code,
      redirectUri: getGoogleRedirectUri(req),
    });
    const profile = await fetchGoogleProfile(tokens.access_token);
    const user = await findOrCreateGoogleUser(profile);

    await seedUserConstants(user.id);
    req.session.userId = user.id;
    res.redirect(returnTo);
  } catch (error) {
    console.error("Google auth error:", error);
    res.redirect("/login?error=google_login_failed");
  }
});

export default router;
