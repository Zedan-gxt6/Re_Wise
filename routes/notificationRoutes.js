import express from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../services/notificationService.js";

const router = express.Router();

router.get("/notifications", requireAuth, async (req, res) => {
  try {
    const notifications = await getNotifications(req.session.userId);
    res.render("notifications.ejs", { notifications });
  } catch (error) {
    console.error("Notifications load error:", error);
    res.status(500).send("Error loading notifications");
  }
});

router.post("/notifications/:id/read", requireAuth, async (req, res) => {
  const notificationId = parseInt(req.params.id, 10);
  if (!Number.isInteger(notificationId)) return res.status(400).send("Invalid notification id");

  try {
    const notification = await markNotificationRead(req.session.userId, notificationId);
    res.redirect(notification?.target_url || "/notifications");
  } catch (error) {
    console.error("Notification read error:", error);
    res.status(500).send("Error opening notification");
  }
});

router.post("/notifications/:id/later", requireAuth, async (req, res) => {
  const notificationId = parseInt(req.params.id, 10);
  if (!Number.isInteger(notificationId)) return res.status(400).send("Invalid notification id");

  try {
    await markNotificationRead(req.session.userId, notificationId);
    res.redirect("/notifications");
  } catch (error) {
    console.error("Notification later error:", error);
    res.status(500).send("Error updating notification");
  }
});

router.post("/notifications/read-all", requireAuth, async (req, res) => {
  try {
    await markAllNotificationsRead(req.session.userId);
    res.redirect("/notifications");
  } catch (error) {
    console.error("Notification read-all error:", error);
    res.status(500).send("Error marking notifications read");
  }
});

export default router;
