import { Router } from "express";
import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";
import auth from "../middleware/auth.js";
import upload from "../middleware/upload.js";
import { uploadToImgur } from "../utils/imgur.js";

const router = Router();

// Get or create 1-on-1 conversation
router.post("/conversations", auth, async (req, res) => {
  try {
    const { receiverId } = req.body;
    let conversation = await Conversation.findOne({
      participants: { $all: [req.userId, receiverId], $size: 2 },
      isGroup: false,
    }).populate("participants", "firstName lastName profilePicture isOnline");

    if (!conversation) {
      conversation = await Conversation.create({
        participants: [req.userId, receiverId],
      });
      conversation = await conversation.populate(
        "participants",
        "firstName lastName profilePicture isOnline"
      );
    }
    res.json(conversation);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Create group conversation
router.post("/conversations/group", auth, async (req, res) => {
  try {
    const { participantIds, groupName } = req.body;
    if (!participantIds || participantIds.length < 2) {
      return res.status(400).json({ message: "Group needs at least 2 other members" });
    }
    const allParticipants = [req.userId, ...participantIds];
    const conversation = await Conversation.create({
      participants: allParticipants,
      isGroup: true,
      groupName: groupName || "Group Chat",
      groupAdmin: req.userId,
    });
    const populated = await conversation.populate(
      "participants",
      "firstName lastName profilePicture isOnline"
    );
    res.status(201).json(populated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get user's conversations
router.get("/conversations", auth, async (req, res) => {
  try {
    const conversations = await Conversation.find({
      participants: req.userId,
    })
      .populate("participants", "firstName lastName profilePicture isOnline")
      .populate("lastMessage")
      .sort({ updatedAt: -1 });
    res.json(conversations);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Send message (text or image)
router.post("/", auth, upload.single("image"), async (req, res) => {
  try {
    const conversationId = req.body.conversationId;
    const text = req.body.text || "";
    let image = "";
    if (req.file) {
      image = await uploadToImgur(req.file.buffer);
    }
    if (!text && !image) {
      return res.status(400).json({ message: "Message must have text or image" });
    }
    const message = await Message.create({
      conversation: conversationId,
      sender: req.userId,
      text,
      image,
      readBy: [req.userId],
    });

    await Conversation.findByIdAndUpdate(conversationId, {
      lastMessage: message._id,
    });

    const populated = await message.populate(
      "sender",
      "firstName lastName profilePicture"
    );

    const conversation = await Conversation.findById(conversationId);
    const io = req.app.get("io");
    const onlineUsers = req.app.get("onlineUsers");

    // Send to all other participants
    for (const p of conversation.participants) {
      if (p.toString() !== req.userId) {
        const receiverSocketId = onlineUsers?.get(p.toString());
        if (receiverSocketId) {
          io.to(receiverSocketId).emit("newMessage", populated);
        }
      }
    }

    res.status(201).json(populated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Mark messages in a conversation as read
router.put("/:conversationId/read", auth, async (req, res) => {
  try {
    await Message.updateMany(
      {
        conversation: req.params.conversationId,
        readBy: { $ne: req.userId },
      },
      { $addToSet: { readBy: req.userId } }
    );

    // Notify the sender(s) that messages were read
    const conversation = await Conversation.findById(req.params.conversationId);
    const io = req.app.get("io");
    const onlineUsers = req.app.get("onlineUsers");
    for (const p of conversation.participants) {
      if (p.toString() !== req.userId) {
        const senderSocket = onlineUsers?.get(p.toString());
        if (senderSocket) {
          io.to(senderSocket).emit("messagesRead", {
            conversationId: req.params.conversationId,
            readBy: req.userId,
          });
        }
      }
    }

    res.json({ message: "Messages marked as read" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get messages in conversation
router.get("/:conversationId", auth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 30;
    const messages = await Message.find({
      conversation: req.params.conversationId,
    })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("sender", "firstName lastName profilePicture");
    res.json(messages.reverse());
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Update group name
router.put("/conversations/:id/name", auth, async (req, res) => {
  try {
    const conv = await Conversation.findById(req.params.id);
    if (!conv || !conv.isGroup) return res.status(404).json({ message: "Group not found" });
    conv.groupName = req.body.groupName || "Group Chat";
    await conv.save();
    const populated = await conv.populate("participants", "firstName lastName profilePicture isOnline");
    res.json(populated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Update group photo
router.put("/conversations/:id/photo", auth, upload.single("image"), async (req, res) => {
  try {
    const conv = await Conversation.findById(req.params.id);
    if (!conv || !conv.isGroup) return res.status(404).json({ message: "Group not found" });
    if (!req.file) return res.status(400).json({ message: "No image" });
    conv.groupPhoto = await uploadToImgur(req.file.buffer);
    await conv.save();
    const populated = await conv.populate("participants", "firstName lastName profilePicture isOnline");
    res.json(populated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Add member to group
router.put("/conversations/:id/members/add", auth, async (req, res) => {
  try {
    const conv = await Conversation.findById(req.params.id);
    if (!conv || !conv.isGroup) return res.status(404).json({ message: "Group not found" });
    const { userId } = req.body;
    if (conv.participants.includes(userId)) {
      return res.status(400).json({ message: "Already a member" });
    }
    conv.participants.push(userId);
    await conv.save();
    const populated = await conv.populate("participants", "firstName lastName profilePicture isOnline");
    res.json(populated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Remove member from group
router.put("/conversations/:id/members/remove", auth, async (req, res) => {
  try {
    const conv = await Conversation.findById(req.params.id);
    if (!conv || !conv.isGroup) return res.status(404).json({ message: "Group not found" });
    const { userId } = req.body;
    if (conv.groupAdmin?.toString() === userId) {
      return res.status(400).json({ message: "Cannot remove admin" });
    }
    conv.participants = conv.participants.filter((p) => p.toString() !== userId);
    await conv.save();
    const populated = await conv.populate("participants", "firstName lastName profilePicture isOnline");
    res.json(populated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Leave group
router.put("/conversations/:id/leave", auth, async (req, res) => {
  try {
    const conv = await Conversation.findById(req.params.id);
    if (!conv || !conv.isGroup) return res.status(404).json({ message: "Group not found" });
    conv.participants = conv.participants.filter((p) => p.toString() !== req.userId);
    if (conv.participants.length === 0) {
      await conv.deleteOne();
      return res.json({ message: "Group deleted" });
    }
    // Transfer admin if admin leaves
    if (conv.groupAdmin?.toString() === req.userId) {
      conv.groupAdmin = conv.participants[0];
    }
    await conv.save();
    res.json({ message: "Left group" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
