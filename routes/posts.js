import { Router } from "express";
import Post from "../models/Post.js";
import Comment from "../models/Comment.js";
import Notification from "../models/Notification.js";
import User from "../models/User.js";
import auth from "../middleware/auth.js";
import upload from "../middleware/upload.js";
import { uploadToImgur } from "../utils/imgur.js";

const router = Router();

// Helper: parse @[Name](userId) from text, return array of userIds
function parseMentions(text) {
  if (!text) return [];
  const regex = /@\[([^\]]+)\]\(([a-f0-9]{24})\)/g;
  const ids = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    ids.push(match[2]);
  }
  return [...new Set(ids)];
}

// Helper: send mention notifications
async function sendMentionNotifs(mentionIds, senderId, postId, type, req) {
  const io = req.app.get("io");
  const onlineUsers = req.app.get("onlineUsers");
  for (const recipientId of mentionIds) {
    if (recipientId === senderId) continue;
    const notif = await Notification.create({
      recipient: recipientId,
      sender: senderId,
      type,
      reference: postId,
      referenceModel: "Post",
    });
    const recipientSocket = onlineUsers?.get(recipientId);
    if (recipientSocket) {
      await notif.populate("sender", "firstName lastName profilePicture");
      io.to(recipientSocket).emit("notification", notif);
    }
  }
}

// Search posts
router.get("/search", auth, async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.json([]);
    const posts = await Post.find({
      text: { $regex: q, $options: "i" },
    })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate("author", "firstName lastName profilePicture");
    res.json(posts);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Create post
router.post("/", auth, upload.array("media", 10), async (req, res) => {
  try {
    const postData = {
      author: req.userId,
      text: req.body.text || "",
      feeling: req.body.feeling || "",
    };
    // Parse media types sent from client
    let mediaTypes = [];
    try {
      mediaTypes = JSON.parse(req.body.mediaTypes || "[]");
    } catch (_) {}

    // Validate video file sizes (images are pre-compressed by client)
    const MAX_VIDEO = 10 * 1024 * 1024;
    if (req.files) {
      for (const f of req.files) {
        if (f.mimetype.startsWith("video/") && f.size > MAX_VIDEO) {
          return res.status(400).json({
            message: `Video "${f.originalname}" exceeds 10MB limit`,
          });
        }
      }
    }

    // Support multiple media (images + videos)
    if (req.files && req.files.length > 0) {
      const mediaPromises = req.files.map(async (f, i) => {
        const type = mediaTypes[i] || (f.mimetype.startsWith("video/") ? "video" : "image");
        if (type === "video") {
          // Store video as base64 data URI
          const base64 = f.buffer.toString("base64");
          return `data:${f.mimetype};base64,${base64}`;
        }
        // Compress images
        return uploadToImgur(f.buffer);
      });
      postData.images = await Promise.all(mediaPromises);
      postData.mediaTypes = req.files.map((f, i) =>
        mediaTypes[i] || (f.mimetype.startsWith("video/") ? "video" : "image")
      );
      // Keep backward compat: first image also in .image
      const firstImageIdx = postData.mediaTypes.indexOf("image");
      if (firstImageIdx >= 0) postData.image = postData.images[firstImageIdx];
    }
    // Handle poll data
    if (req.body.pollQuestion) {
      let pollOptions = [];
      try { pollOptions = JSON.parse(req.body.pollOptions || "[]"); } catch (_) {}
      if (pollOptions.length >= 2) {
        postData.poll = {
          question: req.body.pollQuestion,
          options: pollOptions.map((text) => ({ text, votes: [] })),
          multipleChoice: req.body.pollMultiple === "true",
        };
        if (req.body.pollDuration) {
          const hours = parseInt(req.body.pollDuration);
          if (hours > 0) {
            postData.poll.endsAt = new Date(Date.now() + hours * 60 * 60 * 1000);
          }
        }
      }
    }

    if (!postData.text && (!postData.images || postData.images.length === 0) && !postData.poll?.question) {
      return res.status(400).json({ message: "Post must have text, media, or a poll" });
    }
    // Parse mentions
    const mentionIds = parseMentions(postData.text);
    if (mentionIds.length) postData.mentions = mentionIds;

    const post = await Post.create(postData);
    const populated = await post.populate("author", "firstName lastName profilePicture");

    // Send mention notifications
    if (mentionIds.length) {
      await sendMentionNotifs(mentionIds, req.userId, post._id, "mention_post", req);
    }

    res.status(201).json(populated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get single post by ID
router.get("/single/:id", auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id)
      .populate("author", "firstName lastName profilePicture")
      .populate("reactions.user", "firstName lastName")
      .populate("poll.options.votes", "firstName lastName profilePicture");
    if (!post) return res.status(404).json({ message: "Post not found" });

    const comments = await Comment.find({ post: post._id })
      .populate("author", "firstName lastName profilePicture")
      .populate("reactions.user", "firstName lastName")
      .sort({ createdAt: 1 });

    const topLevel = comments.filter((c) => !c.parentComment);
    const withReplies = topLevel.map((c) => ({
      ...c.toJSON(),
      replies: comments.filter(
        (r) => r.parentComment?.toString() === c._id.toString()
      ),
    }));

    res.json({ ...post.toJSON(), comments: withReplies });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get news feed (own + friends' posts)
router.get("/feed", auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const posts = await Post.find({
      author: { $in: [req.userId, ...user.friends] },
    })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("author", "firstName lastName profilePicture")
      .populate("reactions.user", "firstName lastName")
      .populate("poll.options.votes", "firstName lastName profilePicture");

    const postIds = posts.map((p) => p._id);
    const comments = await Comment.find({ post: { $in: postIds } })
      .populate("author", "firstName lastName profilePicture")
      .populate("reactions.user", "firstName lastName")
      .sort({ createdAt: 1 });

    const postsWithComments = posts.map((post) => {
      const postComments = comments.filter(
        (c) => c.post.toString() === post._id.toString()
      );
      // Separate top-level comments and replies
      const topLevel = postComments.filter((c) => !c.parentComment);
      const withReplies = topLevel.map((c) => ({
        ...c.toJSON(),
        replies: postComments.filter(
          (r) => r.parentComment?.toString() === c._id.toString()
        ),
      }));
      return { ...post.toJSON(), comments: withReplies };
    });

    res.json(postsWithComments);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get user's posts (private profiles only show to friends)
router.get("/user/:userId", auth, async (req, res) => {
  try {
    const isMe = req.userId === req.params.userId;
    if (!isMe) {
      const profileUser = await User.findById(req.params.userId);
      if (profileUser && !profileUser.isPublicProfile) {
        const isFriend = profileUser.friends.some(
          (f) => f.toString() === req.userId
        );
        if (!isFriend) return res.json([]);
      }
    }

    const posts = await Post.find({ author: req.params.userId })
      .sort({ createdAt: -1 })
      .populate("author", "firstName lastName profilePicture")
      .populate("reactions.user", "firstName lastName")
      .populate("poll.options.votes", "firstName lastName profilePicture");

    const postIds = posts.map((p) => p._id);
    const comments = await Comment.find({ post: { $in: postIds } })
      .populate("author", "firstName lastName profilePicture")
      .populate("reactions.user", "firstName lastName")
      .sort({ createdAt: 1 });

    const postsWithComments = posts.map((post) => {
      const postComments = comments.filter(
        (c) => c.post.toString() === post._id.toString()
      );
      const topLevel = postComments.filter((c) => !c.parentComment);
      const withReplies = topLevel.map((c) => ({
        ...c.toJSON(),
        replies: postComments.filter(
          (r) => r.parentComment?.toString() === c._id.toString()
        ),
      }));
      return { ...post.toJSON(), comments: withReplies };
    });

    res.json(postsWithComments);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Pin / unpin a post
router.put("/:id/pin", auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: "Post not found" });
    if (post.author.toString() !== req.userId) {
      return res.status(403).json({ message: "Not authorized" });
    }
    const user = await User.findById(req.userId);
    if (user.pinnedPost?.toString() === req.params.id) {
      // Unpin
      user.pinnedPost = null;
      await user.save();
      res.json({ pinned: false });
    } else {
      // Pin (replace any existing pin)
      user.pinnedPost = req.params.id;
      await user.save();
      res.json({ pinned: true });
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// React to post (like, love, haha, wow, sad, angry)
router.put("/:id/like", auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: "Post not found" });

    const reactionType = req.body.reaction || "like";
    const existingIdx = post.reactions.findIndex(
      (r) => r.user.toString() === req.userId
    );

    if (existingIdx !== -1) {
      if (post.reactions[existingIdx].type === reactionType) {
        // Same reaction → remove (toggle off)
        post.reactions.splice(existingIdx, 1);
      } else {
        // Different reaction → update
        post.reactions[existingIdx].type = reactionType;
      }
    } else {
      // No reaction yet → add
      post.reactions.push({ user: req.userId, type: reactionType });
      if (post.author.toString() !== req.userId) {
        // Upsert to avoid duplicate notifications from the same user on the same post
        const notif = await Notification.findOneAndUpdate(
          {
            recipient: post.author,
            sender: req.userId,
            type: "like_post",
            reference: post._id,
          },
          {
            recipient: post.author,
            sender: req.userId,
            type: "like_post",
            reference: post._id,
            referenceModel: "Post",
            read: false,
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        const io = req.app.get("io");
        const onlineUsers = req.app.get("onlineUsers");
        const recipientSocket = onlineUsers?.get(post.author.toString());
        if (recipientSocket) {
          await notif.populate("sender", "firstName lastName profilePicture");
          io.to(recipientSocket).emit("notification", notif);
        }
      }
    }
    await post.save();
    await post.populate("reactions.user", "firstName lastName");
    res.json(post);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Add comment
router.post("/:id/comments", auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: "Post not found" });

    const mentionIds = parseMentions(req.body.text);

    const comment = await Comment.create({
      post: req.params.id,
      author: req.userId,
      text: req.body.text,
      mentions: mentionIds,
    });

    if (post.author.toString() !== req.userId) {
      // Strip @mentions from preview text
      const rawText = req.body.text.replace(/@\[([^\]]+)\]\([^)]+\)/g, "$1");
      const preview = rawText.length > 80 ? rawText.slice(0, 80) + "..." : rawText;
      const notif = await Notification.create({
        recipient: post.author,
        sender: req.userId,
        type: "comment_post",
        reference: post._id,
        referenceModel: "Post",
        commentPreview: preview,
      });
      const io = req.app.get("io");
      const onlineUsers = req.app.get("onlineUsers");
      const recipientSocket = onlineUsers?.get(post.author.toString());
      if (recipientSocket) {
        await notif.populate("sender", "firstName lastName profilePicture");
        io.to(recipientSocket).emit("notification", notif);
      }
    }

    // Send mention notifications for comment
    if (mentionIds.length) {
      await sendMentionNotifs(mentionIds, req.userId, post._id, "mention_comment", req);
    }

    const populated = await comment.populate(
      "author",
      "firstName lastName profilePicture"
    );
    res.status(201).json(populated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// React to comment
router.put("/:postId/comments/:commentId/react", auth, async (req, res) => {
  try {
    const comment = await Comment.findById(req.params.commentId);
    if (!comment) return res.status(404).json({ message: "Comment not found" });

    const reactionType = req.body.reaction || "like";
    const existingIdx = comment.reactions.findIndex(
      (r) => r.user.toString() === req.userId
    );

    if (existingIdx !== -1) {
      if (comment.reactions[existingIdx].type === reactionType) {
        comment.reactions.splice(existingIdx, 1);
      } else {
        comment.reactions[existingIdx].type = reactionType;
      }
    } else {
      comment.reactions.push({ user: req.userId, type: reactionType });
    }
    await comment.save();
    await comment.populate("reactions.user", "firstName lastName");
    await comment.populate("author", "firstName lastName profilePicture");
    res.json(comment);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Reply to comment
router.post("/:postId/comments/:commentId/replies", auth, async (req, res) => {
  try {
    const parentComment = await Comment.findById(req.params.commentId);
    if (!parentComment) return res.status(404).json({ message: "Comment not found" });

    const mentionIds = parseMentions(req.body.text);

    const reply = await Comment.create({
      post: req.params.postId,
      author: req.userId,
      text: req.body.text,
      mentions: mentionIds,
      parentComment: req.params.commentId,
    });

    // Notify parent comment author
    if (parentComment.author.toString() !== req.userId) {
      await Notification.create({
        recipient: parentComment.author,
        sender: req.userId,
        type: "comment_post",
        reference: parentComment.post,
        referenceModel: "Post",
      });
      const io = req.app.get("io");
      const onlineUsers = req.app.get("onlineUsers");
      const recipientSocket = onlineUsers?.get(parentComment.author.toString());
      if (recipientSocket) {
        const notif = await Notification.findOne({
          recipient: parentComment.author,
          sender: req.userId,
          type: "comment_post",
        })
          .sort({ createdAt: -1 })
          .populate("sender", "firstName lastName profilePicture");
        io.to(recipientSocket).emit("notification", notif);
      }
    }

    if (mentionIds.length) {
      await sendMentionNotifs(mentionIds, req.userId, parentComment.post, "mention_comment", req);
    }

    const populated = await reply.populate("author", "firstName lastName profilePicture");
    res.status(201).json(populated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Delete comment
router.delete("/:postId/comments/:commentId", auth, async (req, res) => {
  try {
    const comment = await Comment.findById(req.params.commentId);
    if (!comment) return res.status(404).json({ message: "Comment not found" });
    if (comment.author.toString() !== req.userId) {
      return res.status(403).json({ message: "Not authorized" });
    }
    // Delete replies too
    await Comment.deleteMany({ parentComment: req.params.commentId });
    await comment.deleteOne();
    res.json({ message: "Comment deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Vote on poll
router.put("/:id/poll/vote", auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post || !post.poll?.question) {
      return res.status(404).json({ message: "Poll not found" });
    }

    // Check if poll has expired
    if (post.poll.endsAt && new Date() > post.poll.endsAt) {
      return res.status(400).json({ message: "Poll has ended" });
    }

    // Only friends of the author + the author can vote
    const author = await User.findById(post.author);
    const isFriend = author.friends.some((f) => f.toString() === req.userId);
    const isAuthor = post.author.toString() === req.userId;
    if (!isFriend && !isAuthor) {
      return res.status(403).json({ message: "Only friends can vote on this poll" });
    }

    const { optionIndex } = req.body;
    if (optionIndex === undefined || !post.poll.options[optionIndex]) {
      return res.status(400).json({ message: "Invalid option" });
    }

    if (!post.poll.multipleChoice) {
      // Remove any previous vote from this user (single choice)
      post.poll.options.forEach((opt) => {
        opt.votes = opt.votes.filter((v) => v.toString() !== req.userId);
      });
    }

    const option = post.poll.options[optionIndex];
    const alreadyVoted = option.votes.some((v) => v.toString() === req.userId);
    if (alreadyVoted) {
      // Toggle off
      option.votes = option.votes.filter((v) => v.toString() !== req.userId);
    } else {
      option.votes.push(req.userId);
    }

    await post.save();
    await post.populate("author", "firstName lastName profilePicture");
    await post.populate("reactions.user", "firstName lastName");
    await post.populate("poll.options.votes", "firstName lastName profilePicture");
    res.json(post);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Delete post
router.delete("/:id", auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: "Post not found" });
    if (post.author.toString() !== req.userId) {
      return res.status(403).json({ message: "Not authorized" });
    }
    // Unpin if pinned
    await User.updateOne(
      { _id: req.userId, pinnedPost: req.params.id },
      { pinnedPost: null }
    );
    await Comment.deleteMany({ post: req.params.id });
    await post.deleteOne();
    res.json({ message: "Post deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
