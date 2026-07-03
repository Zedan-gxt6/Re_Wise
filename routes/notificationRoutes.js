import express from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import {
  clearNotifications,
  getNotificationForUser,
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notifyFollowAccepted,
} from "../services/notificationService.js";
import { db } from "../db/pool.js";

const router = express.Router();

router.get("/notifications", requireAuth, async (req, res) => {
  try {
    await markAllNotificationsRead(req.session.userId);
    const notifications = await getNotifications(req.session.userId);
    res.locals.unreadNotifications = 0;
    res.render("notifications.ejs", { notifications });
  } catch (error) {
    console.error("Notifications load error:", error);
    res.status(500).send("Error loading notifications");
  }
});

router.post("/notifications/:id/follow-response", requireAuth, async (req, res) => {
  const notificationId = parseInt(req.params.id, 10);
  if (!Number.isInteger(notificationId)) return res.status(400).send("Invalid notification id");

  try {
    const notification = await getNotificationForUser(req.session.userId, notificationId);
    if (!notification || notification.type !== "follow_request") {
      return res.status(404).send("Follow request notification not found");
    }

    const requesterId = parseInt(notification.entity_id, 10);
    if (!Number.isInteger(requesterId)) return res.status(400).send("Invalid requester id");

    if (req.body.action === "accept") {
      const result = await db.query(
        `UPDATE follows
         SET status = 'accepted'
         WHERE follower_id = $1 AND following_id = $2 AND status = 'pending'
         RETURNING follower_id`,
        [requesterId, req.session.userId]
      );

      if (result.rowCount > 0) {
        await notifyFollowAccepted(req.session.userId, requesterId);
      }
    } else {
      await db.query(
        `DELETE FROM follows
         WHERE follower_id = $1 AND following_id = $2 AND status = 'pending'`,
        [requesterId, req.session.userId]
      );
    }

    await markNotificationRead(req.session.userId, notificationId);
    res.redirect("/notifications");
  } catch (error) {
    console.error("Notification follow response error:", error);
    res.status(500).send("Error responding to follow request");
  }
});

router.post("/notifications/clear", requireAuth, async (req, res) => {
  try {
    await clearNotifications(req.session.userId);
    res.locals.unreadNotifications = 0;
    res.redirect("/notifications");
  } catch (error) {
    console.error("Notification clear error:", error);
    res.status(500).send("Error clearing notifications");
  }
});

export default router;
