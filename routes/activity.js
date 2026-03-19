import { Router } from "express";
import Notification from "../models/Notification.js";
import User from "../models/User.js";
import Post from "../models/Post.js";
import Comment from "../models/Comment.js";
import auth from "../middleware/auth.js";

const router = Router();

// Get activity feed — recent actions by friends
router.get("/", auth, async (req, res) => {
  try {
    const me = await User.findById(req.userId);
    const friendIds = me.friends.map((f) => f.toString());
    if (friendIds.length === 0) return res.json([]);

    const page = parseInt(req.query.page) || 1;
    const limit = 20;

    // Get recent notifications SENT by friends (their activity)
    const activities = await Notification.find({
      sender: { $in: friendIds },
      type: { $in: ["like_post", "comment_post", "friend_accepted"] },
    })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("sender", "firstName lastName profilePicture")
      .populate("recipient", "firstName lastName profilePicture");

    // Also get recent posts by friends
    const recentPosts = await Post.find({
      author: { $in: friendIds },
    })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("author", "firstName lastName profilePicture");

    // Merge and sort by date
    const feed = [
      ...activities.map((a) => ({
        _id: a._id,
        type: "activity",
        activityType: a.type,
        user: a.sender,
        target: a.recipient,
        reference: a.reference,
        createdAt: a.createdAt,
      })),
      ...recentPosts.map((p) => ({
        _id: `post_${p._id}`,
        type: "new_post",
        activityType: "new_post",
        user: p.author,
        postText: p.text?.slice(0, 100) || "",
        postImage: !!p.image,
        reference: p._id,
        createdAt: p.createdAt,
      })),
    ];

    feed.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json(feed.slice(0, limit));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
