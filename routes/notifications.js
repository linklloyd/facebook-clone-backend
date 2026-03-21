import { Router } from "express";
import Notification from "../models/Notification.js";
import auth from "../middleware/auth.js";

const router = Router();

const MAX_NOTIFICATIONS = 50;

// Get notifications (capped at MAX_NOTIFICATIONS)
router.get("/", auth, async (req, res) => {
  try {
    const notifications = await Notification.find({ recipient: req.userId })
      .populate("sender", "firstName lastName profilePicture")
      .sort({ createdAt: -1 })
      .limit(MAX_NOTIFICATIONS);

    // Cleanup: delete any notifications beyond the cap
    const count = await Notification.countDocuments({ recipient: req.userId });
    if (count > MAX_NOTIFICATIONS) {
      const oldest = await Notification.find({ recipient: req.userId })
        .sort({ createdAt: -1 })
        .skip(MAX_NOTIFICATIONS)
        .select("_id");
      const idsToDelete = oldest.map((n) => n._id);
      await Notification.deleteMany({ _id: { $in: idsToDelete } });
    }

    res.json(notifications);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Mark all as read
router.put("/read", auth, async (req, res) => {
  try {
    await Notification.updateMany(
      { recipient: req.userId, read: false },
      { read: true }
    );
    res.json({ message: "Notifications marked as read" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get unread count
router.get("/unread-count", auth, async (req, res) => {
  try {
    const count = await Notification.countDocuments({
      recipient: req.userId,
      read: false,
    });
    res.json({ count });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
