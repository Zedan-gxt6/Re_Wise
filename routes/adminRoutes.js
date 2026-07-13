import express from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireOwner } from "../middleware/requireOwner.js";
import {
  getAdminStats,
  resolveAppError,
  resolveFeedback,
  sendOwnerNotification,
} from "../services/adminService.js";

const router = express.Router();

router.get("/admin/stats", requireAuth, requireOwner, asyncHandler(async (req, res) => {
  const stats = await getAdminStats();
  res.render("admin_stats.ejs", {
    ...stats,
    notice: req.query.notice || null,
    error: req.query.error || null,
  });
}));

router.post("/admin/feedback/:id/resolve", requireAuth, requireOwner, asyncHandler(async (req, res) => {
  await resolveFeedback(req.params.id);
  res.redirect("/admin/stats?notice=Feedback marked resolved");
}));

router.post("/admin/errors/:id/resolve", requireAuth, requireOwner, asyncHandler(async (req, res) => {
  await resolveAppError(req.params.id);
  res.redirect("/admin/stats?notice=Error marked resolved");
}));

router.post("/admin/notify", requireAuth, requireOwner, asyncHandler(async (req, res) => {
  const sentCount = await sendOwnerNotification(req.session.userId, req.body.message);
  if (sentCount === 0) return res.redirect("/admin/stats?error=Write a notification message first");
  res.redirect(`/admin/stats?notice=Notification sent to ${sentCount} users`);
}));

export default router;
