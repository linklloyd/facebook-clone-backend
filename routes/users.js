import { Router } from "express";
import User from "../models/User.js";
import FriendRequest from "../models/FriendRequest.js";
import Notification from "../models/Notification.js";
import auth from "../middleware/auth.js";
import upload from "../middleware/upload.js";
import { uploadToImgur } from "../utils/imgur.js";

const router = Router();

// Search users — MUST be before /:id to avoid conflict
router.get("/search", auth, async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.json([]);
    const users = await User.find({
      $or: [
        { firstName: { $regex: q, $options: "i" } },
        { lastName: { $regex: q, $options: "i" } },
        {
          $expr: {
            $regexMatch: {
              input: { $concat: ["$firstName", " ", "$lastName"] },
              regex: q,
              options: "i",
            },
          },
        },
      ],
      _id: { $ne: req.userId },
    })
      .select("firstName lastName profilePicture")
      .limit(10);
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get friend suggestions (non-friends) — before /:id
router.get("/suggestions/people", auth, async (req, res) => {
  try {
    const me = await User.findById(req.userId);
    const pending = await FriendRequest.find({
      $or: [{ sender: req.userId }, { receiver: req.userId }],
      status: "pending",
    });
    const excludeIds = [
      req.userId,
      ...me.friends.map((f) => f.toString()),
      ...pending.map((p) =>
        p.sender.toString() === req.userId
          ? p.receiver.toString()
          : p.sender.toString()
      ),
    ];
    const suggestions = await User.find({ _id: { $nin: excludeIds } })
      .select("firstName lastName profilePicture")
      .limit(5);
    res.json(suggestions);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get pending friend requests — before /:id
router.get("/friend-requests/pending", auth, async (req, res) => {
  try {
    const requests = await FriendRequest.find({
      receiver: req.userId,
      status: "pending",
    }).populate("sender", "firstName lastName profilePicture");
    res.json(requests);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get user profile
router.get("/:id", auth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select("-password")
      .populate("friends", "firstName lastName profilePicture isOnline");
    if (!user) return res.status(404).json({ message: "User not found" });

    const isMe = req.userId === req.params.id;
    const isFriend = user.friends.some(
      (f) => (f._id || f).toString() === req.userId
    );

    // If profile is private and not a friend, return limited info
    if (!isMe && !user.isPublicProfile && !isFriend) {
      return res.json({
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        profilePicture: user.profilePicture,
        coverPicture: user.coverPicture,
        isPublicProfile: user.isPublicProfile,
        friends: [],
        friendCount: user.friends.length,
        isPrivate: true,
      });
    }

    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Update profile
router.put("/", auth, async (req, res) => {
  try {
    const { firstName, lastName, bio, city, hometown, workplace, relationship, isPublicProfile } = req.body;
    const updateData = { bio, city, hometown, workplace, relationship };
    if (firstName && firstName.trim()) updateData.firstName = firstName.trim();
    if (lastName && lastName.trim()) updateData.lastName = lastName.trim();
    if (typeof isPublicProfile === "boolean") {
      updateData.isPublicProfile = isPublicProfile;
    }
    const user = await User.findByIdAndUpdate(
      req.userId,
      updateData,
      { new: true }
    )
      .select("-password")
      .populate("friends", "firstName lastName profilePicture isOnline");
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Upload profile picture
router.post("/profile-picture", auth, upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No image uploaded" });
    const imageUrl = await uploadToImgur(req.file.buffer);
    const user = await User.findByIdAndUpdate(
      req.userId,
      { profilePicture: imageUrl },
      { new: true }
    ).select("-password");
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Upload cover picture
router.post("/cover-picture", auth, upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No image uploaded" });
    const imageUrl = await uploadToImgur(req.file.buffer);
    const user = await User.findByIdAndUpdate(
      req.userId,
      { coverPicture: imageUrl },
      { new: true }
    ).select("-password");
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Send friend request
router.post("/friend-request/:id", auth, async (req, res) => {
  try {
    if (req.params.id === req.userId) {
      return res.status(400).json({ message: "Cannot send request to yourself" });
    }
    const existing = await FriendRequest.findOne({
      $or: [
        { sender: req.userId, receiver: req.params.id },
        { sender: req.params.id, receiver: req.userId },
      ],
      status: "pending",
    });
    if (existing) return res.status(400).json({ message: "Request already exists" });

    const me = await User.findById(req.userId);
    if (me.friends.includes(req.params.id)) {
      return res.status(400).json({ message: "Already friends" });
    }

    const request = await FriendRequest.create({
      sender: req.userId,
      receiver: req.params.id,
    });

    const notif = await Notification.create({
      recipient: req.params.id,
      sender: req.userId,
      type: "friend_request",
      reference: request._id,
      referenceModel: "User",
    });

    const io = req.app.get("io");
    const onlineUsers = req.app.get("onlineUsers");
    const receiverSocketId = onlineUsers?.get(req.params.id);
    if (receiverSocketId) {
      await notif.populate("sender", "firstName lastName profilePicture");
      io.to(receiverSocketId).emit("notification", notif);
    }

    res.status(201).json(request);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Accept friend request
router.put("/friend-request/:id/accept", auth, async (req, res) => {
  try {
    const request = await FriendRequest.findById(req.params.id);
    if (!request || request.receiver.toString() !== req.userId) {
      return res.status(404).json({ message: "Request not found" });
    }
    request.status = "accepted";
    await request.save();

    await User.findByIdAndUpdate(req.userId, {
      $addToSet: { friends: request.sender },
    });
    await User.findByIdAndUpdate(request.sender, {
      $addToSet: { friends: req.userId },
    });

    await Notification.create({
      recipient: request.sender.toString(),
      sender: req.userId,
      type: "friend_accepted",
      reference: req.userId,
      referenceModel: "User",
    });

    res.json({ message: "Friend request accepted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Decline friend request
router.put("/friend-request/:id/decline", auth, async (req, res) => {
  try {
    const request = await FriendRequest.findById(req.params.id);
    if (!request || request.receiver.toString() !== req.userId) {
      return res.status(404).json({ message: "Request not found" });
    }
    request.status = "declined";
    await request.save();
    res.json({ message: "Friend request declined" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Unfriend
router.delete("/friend/:id", auth, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.userId, {
      $pull: { friends: req.params.id },
    });
    await User.findByIdAndUpdate(req.params.id, {
      $pull: { friends: req.userId },
    });
    await FriendRequest.findOneAndDelete({
      $or: [
        { sender: req.userId, receiver: req.params.id },
        { sender: req.params.id, receiver: req.userId },
      ],
    });
    res.json({ message: "Unfriended" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
