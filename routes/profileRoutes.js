import express from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import {
  buildProfilePage,
  getProfileUser,
  updateProfile,
} from "../services/profileService.js";

const router = express.Router();

router.get("/profile/me", requireAuth, (req, res) => {
  res.redirect(`/users/${req.session.userId}`);
});

router.get("/profile/edit", requireAuth, async (req, res) => {
  try {
    const user = await getProfileUser(req.session.userId);
    if (!user) return res.status(404).send("Profile not found");

    res.render("edit_profile.ejs", { user });
  } catch (error) {
    console.error("Edit profile load error:", error);
    res.status(500).send("Error loading profile editor");
  }
});

router.post("/profile/update", requireAuth, async (req, res) => {
  try {
    await updateProfile(req.session.userId, req.body);
    res.redirect("/profile/me");
  } catch (error) {
    console.error("Profile update error:", error);
    res.status(500).send("Error updating profile");
  }
});

router.get("/users/:id", requireAuth, async (req, res) => {
  const profileId = parseInt(req.params.id, 10);
  if (!Number.isInteger(profileId)) return res.status(400).send("Invalid user id");

  try {
    const profile = await buildProfilePage(req.session.userId, profileId);
    if (!profile) return res.status(404).send("Profile not found");

    res.render("profile.ejs", profile);
  } catch (error) {
    console.error("Profile page error:", error);
    res.status(500).send("Error loading profile");
  }
});

export default router;
