import express from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import {
  addProblemCardComment,
  followUser,
  getCardComments,
  getFollowers,
  getFollowing,
  getPendingFollowRequests,
  removeFollower,
  respondToFollowRequest,
  searchUsers,
  toggleProblemCardLike,
  unfollowUser,
} from "../services/socialService.js";
import {
  notifyFollowAccepted,
  notifyFollowRequest,
  notifyProblemCardCommented,
  notifyProblemCardLiked,
} from "../services/notificationService.js";

const router = express.Router();

router.get("/social", requireAuth, async (req, res) => {
  const tab = ["search", "followers", "following"].includes(req.query.tab)
    ? req.query.tab
    : "search";
  const query = (req.query.q || "").trim();

  try {
    const [followers, following, users] = await Promise.all([
      getFollowers(req.session.userId),
      getFollowing(req.session.userId),
      tab === "search" && query ? searchUsers(req.session.userId, query) : [],
    ]);

    res.render("social_circle.ejs", { tab, query, users, followers, following });
  } catch (error) {
    console.error("Social circle error:", error);
    res.status(500).send("Error loading social circle");
  }
});

router.get("/users/search", requireAuth, async (req, res) => {
  const query = (req.query.q || "").trim();

  try {
    const [followers, following, users] = await Promise.all([
      getFollowers(req.session.userId),
      getFollowing(req.session.userId),
      query ? searchUsers(req.session.userId, query) : [],
    ]);
    res.render("social_circle.ejs", { tab: "search", query, users, followers, following });
  } catch (error) {
    console.error("User search error:", error);
    res.status(500).send("Error searching users");
  }
});

router.post("/followers/:id/remove", requireAuth, async (req, res) => {
  const followerId = parseInt(req.params.id, 10);
  if (!Number.isInteger(followerId)) return res.status(400).send("Invalid user id");

  try {
    await removeFollower(req.session.userId, followerId);
    res.redirect(req.get("referer") || "/social?tab=followers");
  } catch (error) {
    console.error("Remove follower error:", error);
    res.status(500).send("Error removing follower");
  }
});

router.post("/users/:id/follow", requireAuth, async (req, res) => {
  const followingId = parseInt(req.params.id, 10);
  if (!Number.isInteger(followingId)) return res.status(400).send("Invalid user id");

  try {
    const result = await followUser(req.session.userId, followingId);
    if (result?.status === "pending") {
      await notifyFollowRequest(req.session.userId, followingId);
    }
    res.redirect(req.get("referer") || `/users/${followingId}`);
  } catch (error) {
    console.error("Follow user error:", error);
    res.status(500).send("Error following user");
  }
});

router.post("/users/:id/unfollow", requireAuth, async (req, res) => {
  const followingId = parseInt(req.params.id, 10);
  if (!Number.isInteger(followingId)) return res.status(400).send("Invalid user id");

  try {
    await unfollowUser(req.session.userId, followingId);
    res.redirect(req.get("referer") || `/users/${followingId}`);
  } catch (error) {
    console.error("Unfollow user error:", error);
    res.status(500).send("Error unfollowing user");
  }
});

router.get("/follow-requests", requireAuth, async (req, res) => {
  try {
    const requests = await getPendingFollowRequests(req.session.userId);
    res.render("follow_requests.ejs", { requests });
  } catch (error) {
    console.error("Follow request load error:", error);
    res.status(500).send("Error loading follow requests");
  }
});

router.post("/follow-requests/:id/respond", requireAuth, async (req, res) => {
  const requestId = parseInt(req.params.id, 10);
  if (!Number.isInteger(requestId)) return res.status(400).send("Invalid request id");

  try {
    const result = await respondToFollowRequest(req.session.userId, requestId, req.body.action);
    if (req.body.action === "accept" && result.rows[0]) {
      await notifyFollowAccepted(req.session.userId, result.rows[0].follower_id);
    }
    res.redirect("/follow-requests");
  } catch (error) {
    console.error("Follow request response error:", error);
    res.status(500).send("Error responding to follow request");
  }
});

router.post("/problem-cards/:id/like", requireAuth, async (req, res) => {
  const cardId = parseInt(req.params.id, 10);
  if (!Number.isInteger(cardId)) return res.status(400).send("Invalid card id");

  try {
    const result = await toggleProblemCardLike(req.session.userId, cardId);
    if (!result) return res.status(403).send("You cannot like this card");
    if (result.liked && result.created) await notifyProblemCardLiked(req.session.userId, cardId);
    if (req.headers.accept?.includes("application/json")) {
      return res.json(result);
    }
    res.redirect(req.get("referer") || "/dashboard");
  } catch (error) {
    console.error("Problem card like error:", error);
    res.status(500).send("Error liking problem card");
  }
});

router.get("/problem-cards/:id/comments", requireAuth, async (req, res) => {
  const cardId = parseInt(req.params.id, 10);
  if (!Number.isInteger(cardId)) return res.status(400).send("Invalid card id");

  try {
    const data = await getCardComments(req.session.userId, cardId);
    if (!data) return res.status(403).send("You cannot view this card");
    res.render("problem_card_comments.ejs", data);
  } catch (error) {
    console.error("Problem card comments error:", error);
    res.status(500).send("Error loading comments");
  }
});

router.post("/problem-cards/:id/comments", requireAuth, async (req, res) => {
  const cardId = parseInt(req.params.id, 10);
  if (!Number.isInteger(cardId)) return res.status(400).send("Invalid card id");

  try {
    const result = await addProblemCardComment(req.session.userId, cardId, req.body.comment);
    if (!result) return res.status(403).send("You cannot comment on this card");
    await notifyProblemCardCommented(req.session.userId, cardId, result.comment);
    if (req.headers.accept?.includes("application/json")) {
      return res.json(result);
    }
    res.redirect(`/problem-cards/${cardId}/comments`);
  } catch (error) {
    console.error("Problem card comment add error:", error);
    res.status(500).send("Error adding comment");
  }
});

export default router;
